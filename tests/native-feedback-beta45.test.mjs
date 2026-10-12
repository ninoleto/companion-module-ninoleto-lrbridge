import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import path from 'node:path'
import ModuleInstance from '../dist/main.js'
import { NativeFeedback } from '../dist/native-feedback.js'
import { controllerFeedbacks } from '../dist/controller-companion.js'
import { sliderVariableId } from '../dist/choices.js'

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const { createNumericNudge } = require(path.join(root, 'server/numeric-nudge.js'))
const ctx = {
	activeModule: 'develop',
	selectedPhotoUuid: 'photo-a',
	selectedPhotoKey: 'photo-a',
	contextCounter: 1,
	contextChangedAt: 10,
	developCounter: 2,
}
const result = (id, value, available = true) => ({ id, value, available, receivedAt: 1000 })
function moduleFixture() {
	const m = Object.create(ModuleInstance.prototype),
		variables = {},
		calls = []
	Object.assign(m, {
		nativeFeedback: new NativeFeedback(),
		config: { requestTimeoutMs: 2000, feedbackReadDelayMs: 0 },
		actionFeedbackSerials: new Map(),
		feedbackRefreshInFlight: false,
		setVariableValues: (v) => Object.assign(variables, v),
		checkFeedbacks: () => {},
		log: () => {},
		buildUrl: (u) => 'http://fixture' + u,
		callLRBridge: async (u) => {
			calls.push(u)
			assert.equal(u, '/context')
			return { ...ctx }
		},
	})
	m.controller = m.createController()
	m.observeNativeContext(ctx)
	return { m, variables, calls }
}

test('confirmed SDK value updates both ordinary slider and Controller variables without waiting for broad polling', async (t) => {
	const { m, variables } = moduleFixture()
	let command, nudge
	nudge = createNumericNudge({
		serverEpoch: 'epoch-a',
		getContext: () => ctx,
		enqueue: (c) => {
			command = c
			assert.equal(nudge.matches(c, 'admit'), true)
			return { accepted: true }
		},
	})
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		const u = new URL(url)
		let data
		if (u.pathname === '/context') data = ctx
		else if (u.pathname === '/nudge/capabilities') data = nudge.capabilities()
		else if (u.pathname === '/nudge') {
			data = nudge.admit(JSON.parse(options.body))
			assert.equal(data.status, 202)
		} else if (u.pathname === '/nudge/result') {
			const key = { ...Object.fromEntries(u.searchParams), operationId: command.operationId }
			assert.equal(nudge.matches(command, 'dequeue'), true)
			assert.equal(nudge.claim(key), true)
			assert.equal(
				nudge.acceptResult({
					...key,
					outcome: 'observed',
					invoked: true,
					executionDevelopCounter: ctx.developCounter,
					baselineValue: 20,
					requestedValue: 21,
					sdkValue: 21,
					min: -100,
					max: 100,
				}),
				true,
			)
			data = { receipt: nudge.get(key) }
		} else throw Error(url)
		return { ok: true, json: async () => ({ ok: true, ...data }) }
	})
	try {
		const ticket = m.nativeFeedback.version
		assert.equal(m.nativeFeedback.accept('Contrast', result(1, 20), { id: '1' }, ticket, ctx, ctx), true)
		await m.controller.numeric('Contrast', 'fine', 1)
		assert.equal(m.getSliderNumericValue('Contrast'), 21)
		assert.equal(variables[sliderVariableId('Contrast')], '21')
		assert.equal(variables.control_contrast, '21')
		const feedback = controllerFeedbacks(m).controller_value
		assert.equal(
			feedback.callback({ id: 'comparison', options: { control: 'Contrast', condition: 'equals', value: 21 } }),
			true,
		)
		assert.equal(m.nativeFeedback.accept('Contrast', result(2, 20), { id: '2' }, ticket, ctx, ctx), false)
		assert.equal(m.getSliderNumericValue('Contrast'), 21)
	} finally {
		m.controller.stop()
	}
})

test('background read already in flight cannot overwrite a newer exact completion', async () => {
	const { m, variables } = moduleFixture()
	let resolveSnapshot, entered
	const waiting = new Promise((r) => (entered = r)),
		blocked = new Promise((r) => (resolveSnapshot = r))
	m.callLRBridgeFeedback = async (u) => {
		if (u.startsWith('/feedback/request-many')) return { request: { id: 10 } }
		assert.match(u, /^\/feedback\/snapshot\?id=10&wait=1$/)
		entered()
		return blocked
	}
	try {
		const read = m.requestFeedbackForSliders(['Contrast'])
		await waiting
		assert.equal(
			m.nativeFeedback.complete({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx }),
			true,
		)
		m.publishNativeFeedback()
		resolveSnapshot({ snapshot: { id: 10, complete: true, context: ctx, results: { Contrast: result(10, 20) } } })
		await read
		assert.equal(m.getSliderNumericValue('Contrast'), 21)
		assert.equal(variables[sliderVariableId('Contrast')], '21')
	} finally {
		m.controller.stop()
	}
})

test('coalesced queued lower-ID feedback reads use their exact snapshot, never higher-ID stale global cache', async () => {
	const { m, calls } = moduleFixture()
	assert.equal(
		m.nativeFeedback.accept('Contrast', result(101, 20), { id: '101' }, m.nativeFeedback.version, ctx, ctx),
		true,
	)
	m.nativeFeedback.complete({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx })
	m.callLRBridgeFeedback = async (u) => {
		calls.push(u)
		if (u.startsWith('/feedback/request-many')) {
			assert.match(u, /purpose=edit/)
			return { request: { id: 100 } }
		}
		if (u === '/feedback/all') return { values: { Contrast: result(101, 20) } }
		assert.equal(u, '/feedback/snapshot?id=100&wait=1')
		return { snapshot: { id: 100, complete: true, context: ctx, results: { Contrast: result(100, 22) } } }
	}
	try {
		await m.requestFeedbackForSliders(['Contrast'])
		assert.equal(m.getSliderNumericValue('Contrast'), 22, 'External Lightroom changes still refresh')
		assert.equal(calls.includes('/feedback/all'), false)
	} finally {
		m.controller.stop()
	}
})

test('legacy single-slider refresh also uses the exact owned snapshot and can mark a control unavailable', async () => {
	const { m, variables } = moduleFixture()
	m.nativeFeedback.complete({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx })
	m.actionFeedbackSerials.set('Contrast', 1)
	m.callLRBridgeFeedback = async (u) => {
		if (u.startsWith('/feedback/request?')) {
			assert.match(u, /purpose=edit/)
			return { request: { id: 42 } }
		}
		assert.equal(u, '/feedback/snapshot?id=42&wait=1')
		return { snapshot: { id: 42, complete: true, context: ctx, results: { Contrast: result(42, null, false) } } }
	}
	try {
		await m.requestActionFeedbackForSlider('Contrast', 1)
		assert.equal(m.getSliderNumericValue('Contrast'), undefined)
		assert.equal(variables[sliderVariableId('Contrast')], '')
	} finally {
		m.controller.stop()
	}
})

test('wrong snapshot ownership or a changed photo cannot publish feedback', () => {
	const store = new NativeFeedback()
	store.observe(ctx)
	const ticket = store.version,
		other = { ...ctx, selectedPhotoUuid: 'photo-b', contextCounter: 2 }
	assert.equal(store.accept('Contrast', result(2, 99), { id: '2' }, ticket, ctx, other), false)
	store.complete({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx })
	store.observe(other)
	assert.equal(store.values.Contrast, undefined)
	assert.equal(store.complete({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx }), false)
	assert.equal(store.accept('Contrast', result(2, 99), { id: '2' }, ticket, ctx, ctx), false)
})

test('stale context responses cannot clear a newer observed SDK completion', () => {
	const store = new NativeFeedback()
	store.observe(ctx)
	const ticket = store.version
	store.complete({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx })
	assert.equal(store.observe({ ...ctx, selectedPhotoUuid: 'old-photo' }, ticket), false)
	assert.equal(store.values.Contrast, 21)
})

test('server epoch or connection reset invalidates all old values and read tickets', () => {
	const store = new NativeFeedback()
	store.observe(ctx)
	store.complete({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx })
	const ticket = store.version
	assert.equal(
		store.complete({ slider: 'Exposure', value: 0.1, serverEpoch: 'epoch-b', context: { ...ctx, contextCounter: 0 } }),
		true,
	)
	assert.equal(store.values.Contrast, undefined)
	assert.equal(store.accept('Contrast', result(20, 21), { id: '20' }, ticket, ctx, ctx), false)
	store.reset()
	assert.deepEqual(store.values, {})
})

test('old connection client cannot publish a completion into its replacement', () => {
	const { m } = moduleFixture(),
		old = m.controller
	try {
		m.controller = m.createController()
		assert.equal(old.io.nativeConfirmed({ slider: 'Contrast', value: 21, serverEpoch: 'epoch-a', context: ctx }), false)
		assert.equal(m.getSliderNumericValue('Contrast'), undefined)
	} finally {
		old.stop()
		m.controller.stop()
	}
})
