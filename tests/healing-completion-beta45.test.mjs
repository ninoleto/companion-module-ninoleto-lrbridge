import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'

const { ControllerClient } = await import(process.env.LRBRIDGE_CLIENT_MODULE || '../dist/controller-client.js')

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const definition = require(path.join(root, 'server/remove-state.js'))
const installRoutes = require(path.join(root, 'server/remove-routes.js'))
const commandDefinition = require(path.join(root, 'server/commands.js'))
const token = (n) => `1:${n.toString(16).padStart(64, '0')}`

// Admission, serial dequeue, command validation and SDK-result acceptance use
// the matching beta.4 server. Only Lightroom execution/snapshots are simulated.
async function fixture(options = {}) {
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'photo-one',
		contextCounter: 1,
		developCounter: 3,
		contextChangedAt: 100,
	}
	const preferences = {
		newSpotType: options.mode || 'heal',
		brushSize: 40,
		brushFeather: 50,
		useGenerativeAI: false,
		detectObjects: false,
		toolOverlay: 'auto',
		visualizeSpots: false,
		visualizationThreshold: 50,
	}
	let snapshot = {
		available: true,
		selectedTool: 'dust',
		...preferences,
		repair: {
			available: true,
			selected: true,
			count: 1,
			index: 1,
			token: token(1),
			spotType: 'heal',
			opacity: 0.5,
			feather: 0.4,
			useGenAI: false,
		},
	}
	let clock = 1000,
		tokenCounter = 1
	const state = definition.createRemoveState({ serverEpoch: 'remove-fixture', now: () => clock, getContext: () => ctx })
	await state.refreshSelection()
	const routes = new Map(),
		accepted = [],
		sent = [],
		waiting = [],
		completed = []
	function publish() {
		clock += 500
		state.get(true)
		const request = state.takeRequest()
		if (request) assert.ok(state.acceptQuery({ ...request, ...snapshot }))
	}
	publish()
	installRoutes(
		{ get: (route, handler) => routes.set(route, handler) },
		state,
		{
			ADMISSION_ACCEPTED: 'accepted',
			tryEnqueueCommand(command) {
				assert.ok(commandDefinition.validateCommand(command))
				assert.ok(state.matches(command, 'admit'))
				accepted.push(structuredClone(command))
				waiting.push(command)
				options.onAdmit?.(command)
				return { status: 'accepted' }
			},
		},
		(req, keys) => JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...keys].sort()),
		Number,
	)
	function execute() {
		if (options.hold) return
		const command = waiting.shift()
		if (!command) return
		if (options.changePhoto) {
			ctx.selectedPhotoUuid = 'photo-two'
			ctx.contextCounter++
			return
		}
		assert.ok(state.matches(command, 'dequeue'))
		const outcome = options.outcome || 'confirmed'
		if (outcome === 'confirmed') {
			if (command.field === 'selectedTool')
				snapshot =
					command.value === 'dust'
						? { ...snapshot, available: true, selectedTool: 'dust', ...preferences, newSpotType: 'heal_patchmatch' }
						: { available: false, selectedTool: 'loupe', reason: 'tool_closed', repair: snapshot.repair }
			else if (command.field.startsWith('selectedRepair')) {
				const key = definition.repairParameters[command.field]
				if (key)
					snapshot.repair = {
						...snapshot.repair,
						[key]: command.value + (options.nativeEpsilon || 0),
						token: token(++tokenCounter),
					}
			} else snapshot = { ...snapshot, [command.field]: command.value }
		}
		const result = {
			...command,
			...snapshot,
			outcome,
			detail: options.detail || '',
			otherPreferencesPreserved: true,
			targetRepairToken: command.field.startsWith('selectedRepair') ? command.expectedValue : null,
			repairEditConfirmed: command.field.startsWith('selectedRepair'),
		}
		assert.ok(state.acceptResult(result), 'Real server accepts the simulated SDK result')
		completed.push(command.operationId)
	}
	const client = new ControllerClient({
		async request(url) {
			const u = new URL(url, 'http://fixture')
			sent.push(u)
			if (u.pathname === '/context') return structuredClone(ctx)
			if (u.pathname === '/remove/state') {
				execute()
				publish()
			}
			let status = 200,
				body
			assert.ok(routes.has(u.pathname), u.pathname)
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
			if (status >= 400) throw Error(`${status}: ${body?.error || 'Rejected'}`)
			const result = structuredClone(body)
			options.mapResponse?.(u.pathname, result)
			return result
		},
		changed() {},
		adjust() {
			throw Error('Unexpected legacy adjustment')
		},
	})
	return {
		client,
		state,
		accepted,
		completed,
		sent,
		options,
		ctx,
		setSnapshot(update) {
			snapshot = update(snapshot)
			publish()
		},
	}
}

test('Healing Size and Feather use exact operation completions and retain serial ordering', async () => {
	const f = await fixture()
	try {
		await f.client.read('remove')
		await Promise.all([
			f.client.numeric('remove_brushSize', 'adjust', 3),
			f.client.numeric('remove_brushFeather', 'adjust', -2),
		])
		assert.deepEqual(
			f.accepted.map((c) => [c.field, c.value]),
			[
				['brushSize', 43],
				['brushFeather', 48],
			],
		)
		assert.deepEqual(
			f.completed,
			f.accepted.map((c) => c.operationId),
		)
		assert.equal(f.client.numericValues.get('remove_brushFeather').value, 48)
	} finally {
		f.client.stop()
	}
})

test('SDK failure ends immediately, preserves its reason and cancels already-queued Healing edits', async () => {
	const f = await fixture({ outcome: 'failed', detail: 'Lightroom rejected the brush preference.' })
	try {
		await f.client.read('remove')
		const results = await Promise.allSettled([
			f.client.numeric('remove_brushSize', 'adjust', 1),
			f.client.numeric('remove_brushFeather', 'adjust', 1),
		])
		assert.match(results[0].reason.message, /Lightroom rejected the brush preference/)
		assert.match(results[1].reason.message, /Earlier Healing operation failed/)
		assert.equal(f.accepted.length, 1, 'No guessed/retried follow-up write after a failed operation')
		assert.ok(
			f.sent.filter((u) => u.pathname === '/remove/state').length <= 3,
			'Failure does not burn the old three-second value wait',
		)
	} finally {
		f.client.stop()
	}
})

test('A displayed matching value cannot finish before its exact SDK operation completes', async () => {
	let sawPending
	const pendingRead = new Promise((resolve) => {
		sawPending = resolve
	})
	const f = await fixture({
		hold: true,
		mapResponse(route, body) {
			if (route === '/remove/state' && body.pendingOperation) {
				body.brushSize = body.pendingOperation.value
				sawPending()
			}
		},
	})
	try {
		let resolved = false
		const action = f.client.numeric('remove_brushSize', 'adjust', 1).then(() => {
			resolved = true
		})
		await pendingRead
		await Promise.resolve()
		assert.equal(resolved, false)
		assert.equal(f.completed.length, 0)
		f.options.hold = false
		await action
		assert.deepEqual(
			f.completed,
			f.accepted.map((c) => c.operationId),
		)
	} finally {
		f.client.stop()
	}
})

test('Selected Opacity and Feather keep SDK units, native precision and exact repair-token transitions', async () => {
	const f = await fixture({ nativeEpsilon: 0.0000005 })
	try {
		await f.client.read('remove')
		await Promise.all([
			f.client.numeric('remove_selectedRepairOpacity', 'adjust', 1),
			f.client.numeric('remove_selectedRepairFeather', 'adjust', 2),
		])
		assert.deepEqual(
			f.accepted.map((c) => [c.field, c.value]),
			[
				['selectedRepairOpacity', 0.51],
				['selectedRepairFeather', 0.42],
			],
		)
		assert.equal(f.accepted[0].expectedValue, token(1))
		assert.equal(f.accepted[1].expectedValue, token(2), 'Only the confirmed first edit advances ownership')
		assert.ok(Math.abs(f.client.numericValues.get('remove_selectedRepairFeather').value - 42.00005) < 1e-8)
	} finally {
		f.client.stop()
	}
})

test('Changing the selected repair before a queued edit cancels it without sending', async () => {
	const f = await fixture()
	try {
		await f.client.read('remove')
		f.setSnapshot((s) => ({ ...s, repair: { ...s.repair, token: token(42) } }))
		await assert.rejects(f.client.numeric('remove_selectedRepairOpacity', 'adjust', 1), /selected repair changed/)
		assert.equal(f.accepted.length, 0)
	} finally {
		f.client.stop()
	}
})

test('Healing preferences follow Lightroom mode availability before any write', async () => {
	for (const [mode, operation, expected] of [
		['heal_patchmatch', (c) => c.numeric('remove_brushFeather', 'adjust', 1), /Heal or Clone/],
		['heal', (c) => c.button('healing_useGenerativeAI_true'), /Remove mode/],
		['clone', (c) => c.button('healing_detectObjects_true'), /Remove mode/],
	]) {
		const f = await fixture({ mode })
		try {
			await assert.rejects(operation(f.client), expected)
			assert.equal(f.accepted.length, 0)
		} finally {
			f.client.stop()
		}
	}
})

test('Generative AI and Detect Objects serialize exact confirmations and do not resend already-active On', async () => {
	const f = await fixture({ mode: 'heal_patchmatch' })
	try {
		await Promise.all([
			f.client.button('healing_useGenerativeAI_true'),
			f.client.button('healing_detectObjects_true'),
			f.client.button('healing_detectObjects_true'),
		])
		assert.deepEqual(
			f.accepted.map((c) => [c.field, c.value]),
			[
				['useGenerativeAI', true],
				['detectObjects', true],
			],
		)
		assert.equal(f.state.get(false).detectObjects, true)
	} finally {
		f.client.stop()
	}
})

test('An operation completion from another photo cannot confirm Healing', async () => {
	const f = await fixture({ changePhoto: true })
	try {
		await assert.rejects(f.client.numeric('remove_brushSize', 'adjust', 1), /Photo or Develop context changed/)
		assert.equal(f.accepted.length, 1)
	} finally {
		f.client.stop()
	}
})

test('A matching value without the exact operation receipt is not accepted as success', async () => {
	const f = await fixture({
		mapResponse(route, body) {
			if (route === '/remove/brush') body.pendingOperation.field = 'brushFeather'
		},
	})
	try {
		await assert.rejects(f.client.numeric('remove_brushSize', 'adjust', 1), /did not acknowledge/)
		assert.equal(f.accepted.length, 1, 'Rejected receipt is never retried')
	} finally {
		f.client.stop()
	}
})

test('Repair completion must name the resulting selected repair token', async () => {
	const f = await fixture({
		mapResponse(route, body) {
			if (route === '/remove/state' && body.lastResult?.outcome === 'confirmed')
				body.lastResult.resultRepairToken = token(99)
		},
	})
	try {
		await assert.rejects(f.client.numeric('remove_selectedRepairOpacity', 'adjust', 1), /original target/)
		assert.equal(f.accepted.length, 1)
	} finally {
		f.client.stop()
	}
})

test('Rapid Close then Open waits for exact serial completions and reaches open state', async () => {
	const f = await fixture()
	try {
		await Promise.all([f.client.button('healing_panel_loupe'), f.client.button('healing_panel_dust')])
		assert.deepEqual(
			f.accepted.map((c) => [c.field, c.value]),
			[
				['selectedTool', 'loupe'],
				['selectedTool', 'dust'],
			],
		)
		assert.equal(f.state.get(false).selectedTool, 'dust')
	} finally {
		f.client.stop()
	}
})

test('Refresh selected repair reports requested rather than inventing native completion', async () => {
	const f = await fixture({ outcome: 'requested', detail: 'Refresh requested; completion is unavailable.' })
	try {
		await f.client.button('healing_repair_refresh')
		assert.match(f.client.lastStatus, /requested; completion is not exposed/)
		assert.equal(f.accepted.length, 1)
	} finally {
		f.client.stop()
	}
})
