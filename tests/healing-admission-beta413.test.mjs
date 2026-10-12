import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ControllerClient, ControllerHttpError } from '../dist/controller-client.js'

const require = createRequire(import.meta.url)
const reference = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const { createRemoveState } = require(path.join(reference, 'server/remove-state.js'))
const installRoutes = require(path.join(reference, 'server/remove-routes.js'))
const admissionMessage = 'Remove tool, mode or context changed, or another operation is pending.'

// Actual bridge cache, native-selection revision, HTTP admission and operation
// result validation. Only Lightroom reads/writes and HTTP transport are simulated.
function fixture(options = {}) {
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'photo-one',
		contextCounter: 1,
		developCounter: 3,
		contextChangedAt: 100,
	}
	let snapshot = {
		available: true,
		selectedTool: 'dust',
		newSpotType: 'heal_patchmatch',
		brushSize: 40,
		brushFeather: 50,
		useGenerativeAI: options.baseline ?? false,
		detectObjects: options.baseline ?? false,
		toolOverlay: 'auto',
		visualizeSpots: false,
		visualizationThreshold: 50,
		repair: { available: false },
	}
	let clock = 10000,
		resolveNative,
		nativeCounter = 0,
		attempts = 0,
		reads = 0
	const accepted = [],
		waiting = [],
		rejections = [],
		readsAtAdmission = []
	const state = createRemoveState({
		serverEpoch: 'healing-admission-test',
		now: () => clock,
		getContext: () => ctx,
		nativeBackend: {
			readRemoveSelection: () =>
				new Promise((resolve) => {
					resolveNative = resolve
				}),
		},
	})
	const nativeSelection = () => ({
		available: true,
		active: false,
		token: `${++nativeCounter}:2:3:4:5:6:7:8`,
		canCancel: false,
		canRemove: false,
		sizeAvailable: false,
	})
	function publish() {
		const query = state.takeRequest()
		if (query) assert.ok(state.acceptQuery({ ...query, ...snapshot }), 'SDK query result must be accepted')
	}
	function execute() {
		const command = waiting.shift()
		if (!command) return
		assert.ok(state.matches(command, 'dequeue'))
		if (options.outcome !== 'failed') snapshot = { ...snapshot, [command.field]: command.value }
		assert.ok(
			state.acceptResult({
				...command,
				...snapshot,
				outcome: options.outcome || 'confirmed',
				detail: options.outcome === 'failed' ? 'SDK rejected the preference' : 'SDK confirmed the preference',
				otherPreferencesPreserved: true,
				repairEditConfirmed: false,
				repairRemovalConfirmed: false,
				targetRepairToken: null,
			}),
			'SDK operation result must be accepted',
		)
	}
	state.get(true)
	publish()
	const routes = new Map()
	installRoutes(
		{ get: (route, handler) => routes.set(route, handler) },
		state,
		{
			ADMISSION_ACCEPTED: 'accepted',
			tryEnqueueCommand(command) {
				assert.ok(state.matches(command, 'admit'))
				accepted.push(structuredClone(command))
				waiting.push(command)
				return { status: 'accepted' }
			},
		},
		(req, keys) => JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...keys].sort()),
		Number,
	)
	const client = new ControllerClient({
		changed() {},
		adjust() {
			throw Error('Unexpected Develop write')
		},
		async request(url) {
			const u = new URL(url, 'http://fixture')
			if (u.pathname === '/context') return structuredClone(ctx)
			if (u.pathname === '/remove/state') {
				reads++
				clock += 401
				if (waiting.length && options.completionError) throw options.completionError()
				execute()
				publish()
			}
			if (u.pathname === '/remove/brush') {
				attempts++
				readsAtAdmission.push(reads)
				if (options.errorBeforeAdmission) throw options.errorBeforeAdmission()
				if (attempts <= (options.raceAttempts ?? 1)) {
					const before = state.get(false)
					// Complete the native observation started by /remove/state only
					// after the client has received its fresh SDK capture/revision.
					const pendingNative = state.refreshSelection(false)
					await Promise.resolve()
					assert.equal(typeof resolveNative, 'function')
					resolveNative(nativeSelection())
					resolveNative = undefined
					await pendingNative
					const after = state.get(false)
					assert.equal(after.capturedAt, before.capturedAt, 'SDK capture remains equally fresh')
					assert.equal(after.useGenerativeAI, before.useGenerativeAI)
					assert.equal(after.detectObjects, before.detectObjects)
					assert.ok(after.revision > Number(u.searchParams.get('stateRevision')))
				}
			}
			assert.ok(routes.has(u.pathname), u.pathname)
			let status = 200,
				body
			await routes.get(u.pathname)(
				{ query: Object.fromEntries(u.searchParams), path: u.pathname },
				{
					status(code) {
						status = code
						return this
					},
					json(value) {
						body = value
						return this
					},
					set() {
						return this
					},
				},
			)
			if (status >= 400) {
				rejections.push({ status, queued: accepted.length, message: body.error })
				if (options.afterRejection) {
					const update = options.afterRejection({ ctx, snapshot })
					if (update) snapshot = update
				}
				throw new ControllerHttpError(status, body.error)
			}
			if (u.pathname === '/remove/brush' && options.errorAfterAdmission) throw options.errorAfterAdmission()
			return structuredClone(body)
		},
	})
	return {
		client,
		state,
		accepted,
		rejections,
		readsAtAdmission,
		get attempts() {
			return attempts
		},
		close() {
			client.stop()
			resolveNative?.(nativeSelection())
		},
	}
}

test('Healing boolean admission recovers once from a real native-selection revision race', async () => {
	for (const field of ['useGenerativeAI', 'detectObjects']) {
		for (const value of [true, false]) {
			const f = fixture({ baseline: !value })
			try {
				await f.client.button(`healing_${field}_${value}`)
				assert.deepEqual(f.rejections, [{ status: 409, queued: 0, message: admissionMessage }])
				assert.equal(f.attempts, 2)
				assert.equal(f.accepted.length, 1, 'Only one mutation reaches the SDK queue')
				assert.ok(f.readsAtAdmission[1] >= f.readsAtAdmission[0] + 2, 'Retry requires another new SDK capture')
				assert.equal(f.state.get(false)[field], value)
				assert.equal(f.state.get(false).lastResult.outcome, 'confirmed')
			} finally {
				f.close()
			}
		}
	}
})

test('Healing boolean repeated admission races stop after one fresh retry', async () => {
	const f = fixture({ raceAttempts: 2 })
	try {
		await assert.rejects(f.client.button('healing_useGenerativeAI_true'), (e) => e instanceof ControllerHttpError)
		assert.equal(f.attempts, 2)
		assert.equal(f.rejections.length, 2)
		assert.equal(f.accepted.length, 0)
	} finally {
		f.close()
	}
})

test('Healing retry preserves photo, Develop context and Remove mode from its first admission attempt', async () => {
	for (const change of ['photo', 'develop', 'mode']) {
		const f = fixture({
			afterRejection({ ctx, snapshot }) {
				if (change === 'photo') {
					ctx.selectedPhotoUuid = 'photo-two'
					ctx.contextCounter++
				} else if (change === 'develop') ctx.developCounter++
				else return { ...snapshot, newSpotType: 'heal' }
			},
		})
		try {
			await assert.rejects(f.client.button('healing_detectObjects_true'), /changed|Remove mode/i)
			assert.equal(f.attempts, 1, `${change} change must prevent the second admission`)
			assert.equal(f.accepted.length, 0)
		} finally {
			f.close()
		}
	}
})

test('Healing boolean does not retry unknown transport errors or other HTTP rejection types', async () => {
	for (const error of [
		() => new Error('Connection reset; delivery unknown'),
		() => new DOMException('Response timed out', 'TimeoutError'),
		() => new ControllerHttpError(503, admissionMessage),
		() => new ControllerHttpError(409, 'The Remove operation could not be queued.'),
		() => new Error(admissionMessage),
	]) {
		const f = fixture({ raceAttempts: 0, errorBeforeAdmission: error })
		try {
			await assert.rejects(f.client.button('healing_useGenerativeAI_true'))
			assert.equal(f.attempts, 1)
			assert.equal(f.accepted.length, 0)
		} finally {
			f.close()
		}
	}
})

test('Healing boolean never resends after an admitted response is lost', async () => {
	const f = fixture({ raceAttempts: 0, errorAfterAdmission: () => new Error('Accepted response lost') })
	try {
		await assert.rejects(f.client.button('healing_detectObjects_true'), /response lost/)
		assert.equal(f.attempts, 1)
		assert.equal(f.accepted.length, 1)
		assert.ok(f.state.get(false).pendingOperation, 'Original admission remains unresolved')
	} finally {
		f.close()
	}
})

test('Healing boolean never retries a typed409 during confirmation or an SDK terminal failure', async () => {
	for (const options of [
		{ completionError: () => new ControllerHttpError(409, admissionMessage) },
		{ outcome: 'failed' },
	]) {
		const f = fixture({ raceAttempts: 0, ...options })
		try {
			await assert.rejects(f.client.button('healing_useGenerativeAI_true'))
			assert.equal(f.attempts, 1)
			assert.equal(f.accepted.length, 1)
		} finally {
			f.close()
		}
	}
})

test('Other Healing brush preferences do not acquire the boolean admission retry', async () => {
	const f = fixture()
	try {
		await assert.rejects(f.client.button('healing_visualizeSpots_true'), (e) => e instanceof ControllerHttpError)
		assert.equal(f.attempts, 1)
		assert.equal(f.accepted.length, 0)
	} finally {
		f.close()
	}
})
