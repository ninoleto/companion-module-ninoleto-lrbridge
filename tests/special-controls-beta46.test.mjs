import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ControllerClient } from '../dist/controller-client.js'

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const pause = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
	let resolve
	const promise = new Promise((r) => (resolve = r))
	return { promise, resolve }
}
const context = () => ({
	activeModule: 'develop',
	selectedPhotoUuid: 'photo-one',
	contextCounter: 1,
	developCounter: 3,
	contextChangedAt: 100,
})

// Real beta.4 route admission, state ownership and result validation. Only the
// SDK execution and its snapshots are simulated; no Lightroom writes occur.
function fixture(family, options = {}) {
	const definition = require(path.join(root, `server/${family}-state.js`))
	const create = Object.entries(definition).find(([key]) => /^create.*State$/.test(key))[1]
	const install = require(path.join(root, `server/${family}-routes.js`))
	const ctx = context()
	let clock = 10000
	let snapshot =
		family === 'red-eye'
			? {
					available: true,
					selectedTool: 'loupe',
					openSupported: true,
					closeSupported: true,
					resetSupported: true,
					reason: null,
				}
			: family === 'reflections'
				? { available: true, checkboxState: true, amount: 50, quality: 'preview', enabled: true, isSupported: true }
				: {
						available: true,
						toolOpen: true,
						count: 2,
						inventoryToken: 'a'.repeat(64),
						selectionReadable: false,
						selectedIndex: null,
						selectedToken: null,
						navigationSupported: true,
						detectSupported: true,
						removeSupported: true,
					}
	const state = create({ serverEpoch: family + '-epoch', getContext: () => ctx, now: () => clock })
	const routes = new Map(),
		writes = [],
		reads = [],
		waiting = []
	function publish() {
		const query = state.takeRequest()
		if (query) assert.ok(state.acceptQuery({ ...query, ...snapshot }), 'actual server accepts SDK snapshot')
	}
	function finish() {
		const command = waiting.shift()
		if (!command) return
		assert.ok(state.matches(command, 'dequeue'))
		const outcome =
			options.outcome ||
			((family === 'people' && command.operationKind !== 'remove') || command.operationKind === 'reset'
				? 'requested'
				: 'confirmed')
		if (outcome === 'confirmed') {
			if (family === 'reflections') snapshot = { ...snapshot, [command.field]: command.value }
			if (family === 'red-eye')
				snapshot = { ...snapshot, selectedTool: command.operationKind === 'close' ? 'loupe' : 'redeye' }
		}
		assert.ok(
			state.acceptResult({
				...command,
				...snapshot,
				outcome,
				detail:
					options.detail ||
					(outcome === 'requested' ? 'Request delivered; review Lightroom.' : 'Confirmed by SDK readback.'),
				invoked: true,
				callbackCompleted: true,
				preserved: true,
				inventoryChanged: true,
				manualRepairsPreserved: true,
				removePreferencesPreserved: true,
				reflectionsPreserved: true,
			}),
			'actual server accepts SDK result',
		)
	}
	state.get(true)
	publish()
	install(
		{ get: (route, handler) => routes.set(route, handler) },
		state,
		{
			ADMISSION_ACCEPTED: 'accepted',
			tryEnqueueCommand(command) {
				assert.ok(definition.validCommand(command))
				assert.ok(state.matches(command, 'admit'))
				writes.push(structuredClone(command))
				waiting.push(command)
				options.onAdmit?.(command)
				return { status: 'accepted' }
			},
		},
		(req, fields) => JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...fields].sort()),
		Number,
	)
	const client = new ControllerClient({
		changed() {},
		async adjust() {
			throw Error('Unexpected Develop write')
		},
		async request(url) {
			const u = new URL(url, 'http://fixture')
			if (u.pathname === '/context') return structuredClone(ctx)
			if (u.pathname === `/${family}/state`) {
				reads.push(url)
				await options.beforeRead?.({ state, ctx, writes, waiting, client })
				if (!options.hold) finish()
				publish()
			}
			assert.ok(routes.has(u.pathname), u.pathname)
			let code = 200,
				body
			routes.get(u.pathname)(
				{ query: Object.fromEntries(u.searchParams) },
				{
					status(value) {
						code = value
						return this
					},
					set() {
						return this
					},
					json(value) {
						body = value
						return this
					},
				},
			)
			if (code >= 400) throw Error(body.error || `HTTP ${code}`)
			const result = structuredClone(body)
			options.mapResponse?.(u.pathname, result)
			return result
		},
	})
	return {
		client,
		ctx,
		state,
		writes,
		reads,
		waiting,
		options,
		finish,
		advance(ms) {
			clock += ms
		},
		changePhoto() {
			ctx.selectedPhotoUuid = 'photo-two'
			ctx.contextCounter++
			ctx.developCounter++
			ctx.contextChangedAt++
		},
	}
}

test('Red Eye opens on the first new press after photo change despite stale family feedback', async () => {
	const f = fixture('red-eye')
	try {
		await f.client.read('red-eye')
		f.changePhoto()
		await f.client.button('red_eye_open')
		assert.equal(f.writes.length, 1)
		assert.equal(f.writes[0].expectedSelectedPhotoUuid, 'photo-two')
		assert.match(f.client.lastStatus, /tool open/)
	} finally {
		f.client.stop()
	}
})

test('Red Eye intent queued on old photo is cancelled instead of applied to the new photo', async () => {
	const entered = deferred(),
		release = deferred()
	let block = true
	const f = fixture('red-eye', {
		beforeRead: async () => {
			if (block) {
				block = false
				entered.resolve()
				await release.promise
			}
		},
	})
	try {
		const first = f.client.button('red_eye_open')
		await entered.promise
		const second = f.client.button('red_eye_pet_eye')
		await pause()
		f.changePhoto()
		release.resolve()
		const results = await Promise.allSettled([first, second])
		for (const result of results) assert.match(result.reason?.message || '', /Photo changed/)
		assert.equal(f.writes.length, 0)
	} finally {
		release.resolve()
		f.client.stop()
	}
})

for (const id of ['people_open', 'people_detect', 'red_eye_reset'])
	test(`${id} accepts delivered requested outcome without claiming completion`, async () => {
		const f = fixture(id.startsWith('people') ? 'people' : 'red-eye')
		try {
			await f.client.button(id, true)
			assert.equal(f.writes.length, 1)
			assert.equal(f.client.lastError, '')
			assert.match(f.client.lastStatus, /requested|Request delivered/)
			assert.doesNotMatch(f.client.lastStatus, /confirmed/i)
		} finally {
			f.client.stop()
		}
	})

test('People Remove waits for required inventory refresh, then sends exactly once', async () => {
	const f = fixture('people')
	try {
		await f.client.button('people_detect')
		assert.equal(f.state.get(false).refreshRequired, true)
		const before = f.reads.length
		await f.client.button('people_remove')
		assert.equal(f.writes.length, 2)
		assert.equal(f.writes[1].operationKind, 'remove')
		assert.ok(f.reads.length > before)
	} finally {
		f.client.stop()
	}
})

test('Reflections waits for a fresh SDK snapshot before admitting an idle stale-state adjustment', async () => {
	const f = fixture('reflections')
	try {
		f.advance(6000)
		await f.client.numeric('reflections_amount', 'adjust', 2)
		assert.equal(f.writes.length, 1)
		assert.equal(f.writes[0].value, 52)
		assert.ok(f.reads.length >= 3, 'stale read, fresh read, exact completion')
	} finally {
		f.client.stop()
	}
})

test('Reflections numeric failure uses the exact operation result immediately and never replays', async () => {
	const f = fixture('reflections', { outcome: 'failed', detail: 'Native amount rejected.' })
	try {
		await assert.rejects(f.client.numeric('reflections_amount', 'adjust', 1), /Native amount rejected/)
		assert.equal(f.writes.length, 1)
		assert.ok(f.reads.length <= 2)
	} finally {
		f.client.stop()
	}
})

test('Matching Reflections value cannot confirm an operation while its callback is still pending', async () => {
	const seen = deferred()
	const f = fixture('reflections', {
		hold: true,
		mapResponse(route, result) {
			if (route === '/reflections/state' && result.pendingOperation) {
				result.amount = result.pendingOperation.value
				seen.resolve()
			}
		},
	})
	try {
		let completed = false
		const action = f.client.numeric('reflections_amount', 'set', 75).then(() => {
			completed = true
		})
		await seen.promise
		await pause()
		assert.equal(completed, false)
		assert.equal(f.client.isPending('reflections'), true)
		f.finish()
		await action
		assert.equal(f.writes.length, 1)
	} finally {
		f.client.stop()
	}
})

test('Quality continues tracking beyond six seconds and accepts one late callback without duplicate write', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 10000 })
	let delayed = false
	const f = fixture('reflections', {
		hold: true,
		mapResponse(route, result) {
			if (route === '/reflections/state' && result.pendingOperation && !delayed) {
				delayed = true
				t.mock.timers.setTime(17001)
				f.finish()
			}
		},
	})
	try {
		await f.client.button('reflections_quality_best')
		assert.equal(delayed, true)
		assert.equal(f.writes.length, 1)
		assert.match(f.client.lastStatus, /Confirmed|confirmed/)
	} finally {
		f.client.stop()
	}
})

test('Long Reflections timeout preserves uncertainty and sends no retry', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 10000 })
	const f = fixture('reflections', {
		hold: true,
		mapResponse(route, result) {
			if (route === '/reflections/state' && result.pendingOperation) t.mock.timers.setTime(136000)
		},
	})
	try {
		await assert.rejects(f.client.button('reflections_false'), /confirmation is unavailable/)
		assert.equal(f.writes.length, 1)
		assert.ok(f.state.get(false).pendingOperation, 'bridge still owns the uncertain operation')
		await assert.rejects(f.client.button('reflections_false'), /still pending/)
		assert.equal(f.writes.length, 1)
	} finally {
		f.client.stop()
	}
})

test('Concurrent special-family readers share one read without hiding later fresh reads', async () => {
	const entered = deferred(),
		release = deferred()
	let block = true
	const f = fixture('reflections', {
		beforeRead: async () => {
			if (block) {
				block = false
				entered.resolve()
				await release.promise
			}
		},
	})
	try {
		const first = f.client.read('reflections')
		await entered.promise
		const second = f.client.read('reflections')
		assert.equal(f.reads.length, 1)
		release.resolve()
		await Promise.all([first, second])
		await f.client.read('reflections')
		assert.equal(f.reads.length, 2)
	} finally {
		release.resolve()
		f.client.stop()
	}
})

test('Retired saved Focus Range controls reject clearly without any network request', async () => {
	let requests = 0
	const client = new ControllerClient({
		async request() {
			requests++
			return {}
		},
		async adjust() {},
		changed() {},
	})
	try {
		for (const field of ['nearOuter', 'nearInner', 'farOuter', 'farInner', 'retired'])
			await assert.rejects(client.numeric(`blur_focus_${field}`, 'set', 0), /removed from Companion.*Web Controller/)
		await assert.rejects(client.focusRange('whole', 1), /removed from Companion.*Web Controller/)
		assert.equal(requests, 0)
	} finally {
		client.stop()
	}
})

test('Post-admission confirmation never joins or republishes a pre-action state read', async () => {
	const staleStarted = deferred(),
		releaseStale = deferred(),
		admitted = deferred()
	const binding = {
		...context(),
		serverEpoch: 'epoch',
		revision: 5,
		ageMs: 0,
		available: true,
		isSupported: true,
		enabled: true,
		checkboxState: true,
		quality: 'preview',
		amount: 50,
	}
	let reads = 0,
		staleRead,
		mutation = false
	const client = new ControllerClient({
		changed() {},
		async adjust() {},
		async request(url) {
			if (url === '/context') return context()
			if (url === '/reflections/state') {
				reads++
				if (reads === 2) {
					const captured = structuredClone(binding)
					staleStarted.resolve()
					await releaseStale.promise
					return captured
				}
				return mutation
					? {
							...binding,
							amount: 75,
							lastResult: { operationId: 'rf-1', field: 'amount', value: 75, outcome: 'confirmed', invoked: true },
						}
					: structuredClone(binding)
			}
			if (url.startsWith('/reflections/set?')) {
				staleRead = client.read('reflections')
				await staleStarted.promise
				mutation = true
				admitted.resolve()
				return { ...binding, pendingOperation: { operationId: 'rf-1', field: 'amount', value: 75 } }
			}
			throw Error(url)
		},
	})
	try {
		const action = client.numeric('reflections_amount', 'set', 75)
		await admitted.promise
		await pause()
		assert.equal(reads, 3, 'a new post-admission read starts while the old read remains blocked')
		await action
		releaseStale.resolve()
		await staleRead
		assert.equal(
			client.numericValues.get('reflections_amount').value,
			75,
			'late pre-action response does not overwrite confirmed feedback',
		)
	} finally {
		releaseStale.resolve()
		client.stop()
	}
})

test('Operation ID reuse from a different bridge epoch never confirms Reflections', async () => {
	const f = fixture('reflections', {
		mapResponse(route, result) {
			if (route === '/reflections/state' && result.lastResult) result.serverEpoch = 'restarted-epoch'
		},
	})
	try {
		await assert.rejects(f.client.numeric('reflections_amount', 'set', 60), /context changed/)
		assert.equal(f.writes.length, 1)
		assert.equal(f.client.numericValues.get('reflections_amount').available, false)
	} finally {
		f.client.stop()
	}
})
