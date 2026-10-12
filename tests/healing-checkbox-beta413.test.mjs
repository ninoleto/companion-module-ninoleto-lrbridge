import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ControllerClient, ControllerHttpError } from '../dist/controller-client.js'
import ModuleInstance from '../dist/main.js'

const require = createRequire(import.meta.url)
const reference = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const definition = require(path.join(reference, 'server/remove-state.js'))
const installRoutes = require(path.join(reference, 'server/remove-routes.js'))

// Real bridge cache, admission and completion; the SDK query deliberately arrives
// two GETs after it was scheduled, rather than refreshing synchronously on GET.
async function fixture(options = {}) {
	const context = {
		activeModule: 'develop',
		selectedPhotoUuid: 'photo-one',
		contextCounter: 1,
		developCounter: 2,
		contextChangedAt: 10,
	}
	let native = {
		available: true,
		selectedTool: 'dust',
		newSpotType: 'heal_patchmatch',
		brushSize: 40,
		brushFeather: 50,
		useGenerativeAI: false,
		detectObjects: false,
		toolOverlay: 'auto',
		visualizeSpots: false,
		visualizationThreshold: 50,
		repair: { available: false },
		...options.cached,
	}
	let clock = 10000,
		reads = 0,
		query
	const accepted = [],
		waiting = [],
		returned = []
	const state = definition.createRemoveState({
		serverEpoch: 'checkbox-fixture',
		now: () => clock,
		getContext: () => context,
	})
	await state.refreshSelection()
	state.get(true)
	assert.ok(state.acceptQuery({ ...state.takeRequest(), ...native }))
	native = { ...native, ...options.actual }
	const routes = new Map()
	installRoutes(
		{ get: (route, handler) => routes.set(route, handler) },
		state,
		{
			ADMISSION_ACCEPTED: 'accepted',
			tryEnqueueCommand(command) {
				assert.ok(definition.validCommand(command))
				assert.ok(state.matches(command, 'admit'))
				accepted.push(structuredClone(command))
				waiting.push(command)
				return { status: 'accepted' }
			},
		},
		(req, fields) => JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...fields].sort()),
		Number,
	)
	const client = new ControllerClient({
		changed() {},
		async adjust() {
			throw Error('Unexpected legacy write')
		},
		async request(url) {
			const u = new URL(url, 'http://fixture')
			if (u.pathname === '/context') return structuredClone(context)
			if (u.pathname === '/remove/state') {
				reads++
				clock += 401
				options.beforeRead?.({ reads, context })
				const command = waiting.shift()
				if (command) {
					assert.ok(state.matches(command, 'dequeue'))
					assert.equal(command.expectedRemoveMode, native.newSpotType, 'Current SDK mode supplied at admission')
					assert.equal(command.expectedValue, native[command.field], 'Current SDK value supplied at admission')
					native = { ...native, [command.field]: command.value }
					assert.ok(
						state.acceptResult({
							...command,
							...native,
							outcome: 'confirmed',
							detail: 'SDK checkbox confirmed',
							otherPreferencesPreserved: true,
							repairEditConfirmed: false,
							repairRemovalConfirmed: false,
							targetRepairToken: null,
						}),
					)
					query = undefined
				} else if (query && reads >= query.after) {
					state.acceptQuery({ ...query.request, ...native })
					query = undefined
				}
			}
			let status = 200,
				body
			assert.ok(routes.has(u.pathname), u.pathname)
			await routes.get(u.pathname)(
				{ query: Object.fromEntries(u.searchParams), path: u.pathname },
				{
					status(value) {
						status = value
						return this
					},
					json(value) {
						body = value
						return this
					},
				},
			)
			if (u.pathname === '/remove/state') {
				if (!query) {
					const request = state.takeRequest()
					if (request) query = { request, after: reads + 2 }
				}
				options.mapState?.(body, reads)
				returned.push(structuredClone(body))
			}
			if (status >= 400) throw new ControllerHttpError(status, body.error || `HTTP ${status}`)
			return structuredClone(body)
		},
	})
	return { client, accepted, returned, state }
}

for (const field of ['useGenerativeAI', 'detectObjects']) {
	for (const value of [true, false]) {
		test(`${field} ${value}: first press refreshes a stale apparent no-op before its one SDK write`, async () => {
			const f = await fixture({ cached: { [field]: value }, actual: { [field]: !value } })
			try {
				await f.client.button(`healing_${field}_${value}`)
				assert.equal(f.accepted.length, 1)
				assert.equal(f.accepted[0].value, value)
				assert.equal(f.accepted[0].expectedValue, !value)
				assert.equal(f.returned[0].capturedAt, f.returned[1].capturedAt, 'First two GETs are cached')
				assert.ok(f.returned[2].capturedAt > f.returned[0].capturedAt, 'SDK capture advanced before dispatch')
				assert.equal(f.state.get(false)[field], value)
				assert.match(f.client.lastStatus, /confirmed/)
			} finally {
				f.client.stop()
			}
		})
	}
}

test('Checkbox no-op requires a newer owned capture even when the cached value already matches', async () => {
	const f = await fixture({
		cached: { useGenerativeAI: true },
		mapState(state, reads) {
			if (reads === 3) state.contextOwned = false
		},
	})
	try {
		await f.client.button('healing_useGenerativeAI_true')
		assert.equal(f.accepted.length, 0)
		assert.equal(f.returned.length, 4, 'Newer but unowned capture was ignored')
		assert.ok(f.returned.at(-1).capturedAt > f.returned[0].capturedAt)
		assert.match(f.client.lastStatus, /already confirmed/)
	} finally {
		f.client.stop()
	}
})

test('Checkbox mode is checked after refreshing a stale Heal-mode cache', async () => {
	const f = await fixture({ cached: { newSpotType: 'heal' }, actual: { newSpotType: 'heal_patchmatch' } })
	try {
		await f.client.button('healing_detectObjects_true')
		assert.equal(f.accepted.length, 1)
		assert.equal(f.accepted[0].expectedRemoveMode, 'heal_patchmatch')
	} finally {
		f.client.stop()
	}
})

test('Checkbox fresh preflight preserves pending and review guards', async () => {
	for (const guard of [{ pendingOperation: { operationId: 'other' } }, { needsReview: true }]) {
		const f = await fixture({ mapState: (state) => Object.assign(state, guard) })
		try {
			await assert.rejects(f.client.button('healing_useGenerativeAI_true'), /unavailable|pending|Check Lightroom/)
			assert.equal(f.accepted.length, 0)
		} finally {
			f.client.stop()
		}
	}
})

test('Photo changes during checkbox fresh preflight cancel without a write', async () => {
	const f = await fixture({
		beforeRead({ reads, context }) {
			if (reads === 2) {
				context.selectedPhotoUuid = 'photo-two'
				context.contextCounter++
			}
		},
	})
	try {
		await assert.rejects(f.client.button('healing_detectObjects_true'), /Photo or module changed/)
		assert.equal(f.accepted.length, 0)
	} finally {
		f.client.stop()
	}
})

test('Controller transport types only the known brush admission rejection', async (t) => {
	const message = 'Remove tool, mode or context changed, or another operation is pending.'
	t.mock.method(globalThis, 'fetch', async () => ({
		ok: false,
		status: 409,
		json: async () => ({ ok: false, error: message }),
	}))
	const module = Object.create(ModuleInstance.prototype)
	module.config = { requestTimeoutMs: 4000 }
	module.buildUrl = (url) => `http://fixture${url}`
	const client = module.createController()
	try {
		await assert.rejects(client.request('/remove/brush', { field: 'useGenerativeAI', value: true }), (error) => {
			assert.ok(error instanceof ControllerHttpError)
			assert.equal(error.status, 409)
			assert.equal(error.message, message)
			return true
		})
		await assert.rejects(client.read('remove'), (error) => {
			assert.equal(error.constructor, Error, 'Other routes retain the existing plain error')
			return true
		})
	} finally {
		client.stop()
	}
})
