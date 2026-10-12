import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import path from 'node:path'
import ModuleInstance from '../dist/main.js'
import { NativeFeedback } from '../dist/native-feedback.js'
import { controllerActions } from '../dist/controller-companion.js'
import { reference } from '../dist/controller-catalog.js'

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const { createNumericNudge } = require(path.join(root, 'server/numeric-nudge.js'))
const { createResetCompletion } = require(path.join(root, 'server/reset-completion.js'))
const { validateCommand } = require(path.join(root, 'server/commands.js'))
const flush = async () => {
	for (let i = 0; i < 80; i++) await Promise.resolve()
}
const sensitive = [
	'develop.action_setAutoTone',
	'develop.action_setAutoWhiteBalance',
	'photo.treatment_color',
	'photo.treatment_grayscale',
]
const isSensitiveWrite = ({ pathname, searchParams }) =>
	(pathname === '/action' && ['setAutoTone', 'setAutoWhiteBalance'].includes(searchParams.get('action'))) ||
	(pathname === '/command' && searchParams.get('command') === 'photo.treatment')

// The real module and Companion callbacks dispatch through the real LRBridge
// receipt state machines/command validator. Only HTTP and Lightroom are simulated.
function fixture(t) {
	t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 })
	const context = {
		activeModule: 'develop',
		selectedPhotoUuid: 'cooldown-photo',
		selectedPhotoKey: 'cooldown-photo',
		contextCounter: 1,
		contextChangedAt: 100,
		developCounter: 2,
	}
	const pointColor = {
		...context,
		available: true,
		selectedIndex: 1,
		swatchCount: 1,
		selectionTransient: false,
		HueShift: 0,
		SatScale: 0,
		LumScale: 0,
		Variance: 0,
		RangeAmount: 0.5,
		...Object.fromEntries(
			reference.pointColor.rangeNames.map((name) => [
				name,
				{ LowerNone: 0, LowerFull: 0.25, UpperFull: 0.75, UpperNone: 1 },
			]),
		),
	}
	const parameters = Object.fromEntries(
		[
			...Object.values(reference.grading.regions).flatMap((r) => [r.hue, r.saturation, r.luminance]),
			...Object.values(reference.grading.scalarControls).map((r) => r.parameter),
		].map((field) => [
			field,
			{
				available: true,
				value: 0,
				range: {
					min: field.endsWith('Hue') || field.endsWith('Saturation') || field.endsWith('Sat') ? 0 : -100,
					max: field.endsWith('Hue') ? 360 : 100,
				},
			},
		]),
	)
	const variables = {},
		requests = [],
		feedbackChecks = [],
		queued = new Map(),
		receipts = {}
	let serial = 0,
		value = 20,
		angle = 0,
		gate,
		failurePath,
		blockedRoute,
		deferGrading = false
	for (const [route, create] of [
		['nudge', createNumericNudge],
		['reset', createResetCompletion],
	]) {
		receipts[route] = create({
			serverEpoch: 'cooldown-epoch',
			getContext: () => context,
			enqueue(command) {
				assert.equal(receipts[route].matches(command, 'admit'), true)
				queued.set(command.requestId, command)
				return { accepted: true }
			},
		})
	}
	async function request(url, body) {
		const u = new URL(url, 'http://fixture')
		requests.push(u)
		if (blockedRoute?.path === u.pathname) await blockedRoute.wait
		if (u.pathname === failurePath) throw Error('Connection lost after dispatch')
		if (u.pathname === '/context') return { ...context }
		if (u.pathname === '/adjust' || (u.pathname === '/reset' && !body) || u.pathname === '/action') return { ok: true }
		if (u.pathname === '/set') {
			value = Number(u.searchParams.get('value'))
			return { ok: true }
		}
		if (u.pathname === '/feedback/request' || u.pathname === '/feedback/request-many')
			return { request: { id: ++serial } }
		if (u.pathname === '/feedback/snapshot')
			return {
				snapshot: {
					complete: true,
					context,
					results: {
						Contrast: { available: true, value, range: { min: -100, max: 100 } },
						CropAngle: { available: true, value: angle, range: { min: -45, max: 45 } },
					},
				},
			}
		if (u.pathname === '/point-color/state') return structuredClone(pointColor)
		if (u.pathname === '/point-color/value') {
			pointColor[u.searchParams.get('field')] = Number(u.searchParams.get('value'))
			return { ok: true }
		}
		if (u.pathname === '/color-grading/request') return { request: { id: ++serial } }
		if (u.pathname === '/color-grading/snapshot')
			return { snapshot: { complete: true, context, parameters: structuredClone(parameters) } }
		if (u.pathname === '/develop-categorical/state')
			return { state: { ...context, processAvailable: true, process: 'Version 6' } }
		if (u.pathname === '/tone-curve/state')
			return {
				pointCurve: {
					...context,
					available: true,
					curves: { rgb: [0, 0, 255, 255] },
					refineSaturation: { value: 100, min: 0, max: 100 },
				},
			}
		if (u.pathname === '/command') {
			const command = Object.fromEntries(u.searchParams)
			for (const field of ['hue', 'saturation', 'value'])
				if (field in command && command.command !== 'photo.treatment') command[field] = Number(command[field])
			assert.equal(validateCommand(command), true, 'Existing LRBridge command contract')
			if (command.command === 'photo.crop_angle.set') angle = command.value
			if (command.command === 'photo.crop_angle.reset') angle = 0
			if (command.command === 'color_grading.wheel.set' && !deferGrading) {
				const region = reference.grading.regions[command.region]
				parameters[region.hue].value = command.hue
				parameters[region.saturation].value = command.saturation
			}
			if (command.command === 'color_grading.region.reset') {
				const region = reference.grading.regions[command.region]
				for (const field of [region.hue, region.saturation, region.luminance]) parameters[field].value = 0
			}
			return { ok: true }
		}
		const [route, verb] = u.pathname.slice(1).split('/'),
			state = receipts[route]
		if (state) {
			if (verb === 'capabilities') return state.capabilities()
			if (!verb) {
				const admitted = state.admit(body)
				assert.equal(admitted.status, 202)
				return { ok: true, ...admitted }
			}
			assert.equal(verb, 'result')
			if (gate) await gate.wait
			const command = queued.get(u.searchParams.get('requestId'))
			const key = { ...Object.fromEntries(u.searchParams), operationId: command.operationId }
			if (state.get(key).phase !== 'complete') {
				assert.equal(state.matches(command, 'dequeue'), true)
				assert.equal(state.claim(key), true)
				const before = value
				value = route === 'reset' ? 0 : value + command.steps.reduce((sum, n) => sum + n, 0) * command.numericStep
				const result = {
					...key,
					outcome: 'observed',
					invoked: true,
					executionDevelopCounter: context.developCounter,
					sdkValue: value,
				}
				if (route === 'reset')
					Object.assign(result, {
						slider: command.slider,
						selectedPhotoUuid: context.selectedPhotoUuid,
						contextCounter: context.contextCounter,
						contextChangedAt: context.contextChangedAt,
						resetSucceeded: true,
					})
				else Object.assign(result, { baselineValue: before, requestedValue: value, min: -100, max: 100 })
				assert.equal(state.acceptResult(result), true)
			}
			return { ok: true, receipt: state.get(key) }
		}
		throw Error(`Unexpected fixture route ${u.pathname}`)
	}
	const m = Object.create(ModuleInstance.prototype)
	Object.assign(m, {
		nativeFeedback: new NativeFeedback(),
		config: { requestTimeoutMs: 2000, feedbackReadDelayMs: 0, autoActionCooldownMs: 2200 },
		autoActionCooldownUntil: 0,
		lastLocalSliderCommandAt: 0,
		actionFeedbackSerials: new Map(),
		actionFeedbackTimers: new Map(),
		feedbackRefreshInFlight: false,
		setVariableValues: (v) => Object.assign(variables, v),
		checkFeedbacks: (...ids) => feedbackChecks.push(ids),
		log: () => {},
		buildUrl: (u) => 'http://fixture' + u,
		callLRBridge: request,
		queueActionFeedbackForSliders: () => {},
	})
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		const data = await request(url, options.body ? JSON.parse(options.body) : undefined)
		return { ok: true, json: async () => ({ ok: true, ...data }) }
	})
	m.controller = m.createController()
	m.observeNativeContext(context)
	const actions = controllerActions(m)
	return {
		m,
		variables,
		requests,
		feedbackChecks,
		press: (control) => actions.controller_button.callback({ options: { control, confirmed: true } }),
		writes: () => requests.filter(isSensitiveWrite),
		blockResult() {
			let release
			const wait = new Promise((r) => {
				release = r
			})
			gate = { wait }
			return () => {
				gate = null
				release()
			}
		},
		fail(path) {
			failurePath = path
		},
		deferGrading() {
			deferGrading = true
		},
		blockPath(path) {
			let release
			const wait = new Promise((r) => {
				release = r
			})
			blockedRoute = { path, wait }
			return () => {
				blockedRoute = null
				release()
			}
		},
		async tick(ms) {
			t.mock.timers.tick(ms)
			await flush()
		},
		close: () => m.destroy(),
	}
}

for (const kind of ['adjust', 'reset'])
	test(`legacy ${kind}: all four sensitive buttons are blocked immediately and never replayed`, async (t) => {
		const f = fixture(t)
		try {
			await (kind === 'adjust' ? f.m.runAdjustSlider('Contrast', 1) : f.m.runResetSlider('Contrast'))
			assert.equal(f.variables.auto_action_cooldown_remaining_s, '3')
			for (const id of sensitive) await f.press(id)
			assert.equal(f.writes().length, 0)
			await f.tick(250)
			assert.equal(f.variables.auto_action_cooldown_remaining_s, '2')
			await f.tick(1000)
			assert.equal(f.variables.auto_action_cooldown_remaining_s, '1')
			await f.tick(1000)
			assert.equal(f.variables.auto_action_cooldown_active, 'no')
			assert.equal(f.writes().length, 0, 'Expiry does not execute earlier presses')
			for (const id of sensitive) await f.press(id)
			assert.equal(f.writes().length, 4, 'Each new press sends exactly one command')
		} finally {
			await f.close()
		}
	})

test('Web Controller parity: settling shows 2 at the first 250ms tick and all four actions unlock at exactly 2200ms', async (t) => {
	const f = fixture(t)
	try {
		await f.m.runAdjustSlider('Contrast', 1)
		assert.equal(f.variables.auto_action_cooldown_remaining_ms, '2200')
		assert.equal(f.variables.auto_action_cooldown_remaining_s, '3')
		await f.tick(199)
		assert.equal(f.m.getAutoActionCooldownRemainingMs(), 2001)
		await f.tick(1)
		assert.equal(f.m.getAutoActionCooldownRemainingMs(), 2000, 'The third second lasts only 200ms')
		await f.tick(50)
		assert.equal(f.variables.auto_action_cooldown_remaining_s, '2', 'The existing 250ms display tick publishes 2')
		await f.tick(1949)
		assert.equal(f.m.getAutoActionCooldownRemainingMs(), 1)
		for (const id of sensitive) await f.press(id)
		assert.equal(f.writes().length, 0, 'All four actions remain blocked until the entire settling interval expires')
		await f.tick(1)
		assert.equal(f.m.isAutoActionCooldownActive(), false)
		for (const id of sensitive) await f.press(id)
		assert.equal(f.writes().length, 4, 'Each new press works at 2200ms without waiting for the next display tick')
		await f.tick(50)
		assert.equal(f.variables.auto_action_cooldown_active, 'no')
	} finally {
		await f.close()
	}
})

test('another slider adjustment restarts the shared countdown from the latest write', async (t) => {
	const f = fixture(t)
	try {
		await f.m.runAdjustSlider('Contrast', 1)
		await f.tick(2000)
		await f.m.runAdjustSlider('Exposure', -1)
		assert.equal(f.variables.auto_action_cooldown_remaining_s, '3')
		await f.tick(2000)
		await f.press('photo.treatment_grayscale')
		assert.equal(f.writes().length, 0)
		assert.equal(f.variables.auto_action_cooldown_remaining_s, '1')
		await f.tick(1000)
		await f.press('photo.treatment_grayscale')
		assert.equal(f.writes().length, 1)
	} finally {
		await f.close()
	}
})

for (const mode of ['fine', 'reset'])
	test(`native ${mode}: delayed real receipt keeps cooldown active through SDK completion`, async (t) => {
		const f = fixture(t),
			release = f.blockResult()
		const pending = f.m.controller.numeric('Contrast', mode, 1)
		try {
			await flush()
			assert.ok(f.requests.some((u) => u.pathname === `/${mode === 'fine' ? 'nudge' : 'reset'}/result`))
			assert.equal(f.m.isAutoActionCooldownActive(), true, 'Starts when the mutation is dispatched')
			await f.tick(3500)
			for (const id of sensitive) await f.press(id)
			assert.equal(f.writes().length, 0, 'Slow SDK completion cannot outlive the guard')
			release()
			await pending
			assert.equal(f.variables.auto_action_cooldown_remaining_s, '3', 'Recovery starts after confirmed completion')
			await f.tick(2199)
			await f.press('develop.action_setAutoTone')
			assert.equal(f.writes().length, 0)
			await f.tick(1)
			await f.press('develop.action_setAutoTone')
			assert.equal(f.writes().length, 1)
		} finally {
			release()
			await pending.catch(() => {})
			await f.close()
		}
	})

for (const [label, id, mode, input, route] of [
	['native Set', 'Contrast', 'set', 30, '/set'],
	['Color Grading', 'grading_midtones_hue', 'fine', 1, '/command'],
	['Crop Angle', 'crop_angle', 'adjust', 1, '/command'],
	['Point Color', 'point-color_HueShift', 'adjust', 1, '/point-color/value'],
])
	test(`${label} starts the same cooldown via its actual numeric action`, async (t) => {
		const f = fixture(t)
		try {
			await f.m.controller.numeric(id, mode, input)
			if (id === 'crop_angle') await f.m.controller.cropAngle.idle()
			if (id.startsWith('grading_')) await f.m.controller.read('grading')
			assert.ok(f.requests.some((u) => u.pathname === route))
			assert.equal(f.variables.auto_action_cooldown_remaining_s, '3')
			for (const button of sensitive) await f.press(button)
			assert.equal(f.writes().length, 0)
			await f.tick(2200)
			assert.equal(f.m.isAutoActionCooldownActive(), false)
		} finally {
			await f.close()
		}
	})

test('read-only feedback and application navigation do not start or extend the countdown', async (t) => {
	const f = fixture(t)
	try {
		await f.m.controller.read('point-color')
		await f.press('application.module_develop')
		assert.equal(f.m.isAutoActionCooldownActive(), false)
		await f.m.runAdjustSlider('Contrast', 1)
		await f.tick(2000)
		await f.m.controller.read('point-color')
		await f.m.controller.read('grading')
		await f.m.controller.read('categorical')
		await f.press('application.module_develop')
		await f.tick(1000)
		assert.equal(f.m.isAutoActionCooldownActive(), false)
		await f.press('photo.treatment_color')
		assert.equal(f.writes().length, 1)
	} finally {
		await f.close()
	}
})

test('invalid or zero fine input never disables the sensitive buttons', async (t) => {
	const f = fixture(t)
	try {
		await f.m.controller.numeric('Contrast', 'fine', 0)
		await assert.rejects(f.m.controller.numeric('Contrast', 'fine', 0.5), /whole step/)
		await assert.rejects(f.m.controller.numeric('Contrast', 'set', 101), /between/)
		assert.equal(f.m.isAutoActionCooldownActive(), false)
		assert.equal(f.requests.filter((u) => ['/nudge', '/set'].includes(u.pathname)).length, 0)
	} finally {
		await f.close()
	}
})

test('uncertain mutation failure retains recovery time but never retries the write', async (t) => {
	const f = fixture(t)
	try {
		f.fail('/set')
		await assert.rejects(f.m.controller.numeric('Contrast', 'set', 30), /Connection lost/)
		assert.equal(f.m.isAutoActionCooldownActive(), true)
		for (const id of sensitive) await f.press(id)
		await f.tick(2200)
		assert.equal(f.m.isAutoActionCooldownActive(), false)
		assert.equal(f.requests.filter((u) => u.pathname === '/set').length, 1)
		assert.equal(f.writes().length, 0)
	} finally {
		await f.close()
	}
})

test('destroy stops countdown publication and old receipt completion cannot restart it', async (t) => {
	const f = fixture(t),
		release = f.blockResult()
	const pending = f.m.controller.numeric('Contrast', 'fine', 1)
	const rejected = assert.rejects(pending, /Connection|stopped|discarded/)
	try {
		await flush()
		await f.close()
		const cooldownChecks = () => f.feedbackChecks.filter((ids) => ids.includes('auto_action_cooldown_active')).length
		const checksAfterStop = cooldownChecks()
		release()
		await rejected
		await f.tick(10000)
		assert.equal(cooldownChecks(), checksAfterStop, 'No countdown callbacks survive the connection')
	} finally {
		release()
		await pending.catch(() => {})
		await f.close()
	}
})

test('Color Grading region Reset releases the previous pending slider hold after its own confirmation', async (t) => {
	const f = fixture(t)
	try {
		f.deferGrading()
		await f.m.controller.numeric('grading_midtones_hue', 'fine', 1)
		assert.equal(f.m.controller.isPending('grading'), true, 'Prior numeric target has no SDK confirmation yet')
		await f.m.controller.button('grading_midtones_reset')
		assert.equal(f.m.controller.isPending('grading'), false, 'Reset confirms zero and replaces the pending target')
		assert.equal(f.variables.auto_action_cooldown_remaining_s, '3')
		await f.tick(2200)
		assert.equal(f.m.isAutoActionCooldownActive(), false, 'No orphaned prior target can hold WAIT forever')
		await f.press('photo.treatment_grayscale')
		assert.equal(f.writes().length, 1)
	} finally {
		await f.close()
	}
})

test('gesture Begin holds cooldown while pending and retains recovery after an uncertain failure', async (t) => {
	const f = fixture(t),
		route = '/tone-curve/gesture/begin',
		release = f.blockPath(route)
	f.fail(route)
	const pending = f.m.controller.curve(false, 'rgb', 'add', 0, 128, 128)
	const rejected = assert.rejects(pending, /Connection lost/)
	try {
		await flush()
		assert.ok(
			f.requests.some((u) => u.pathname === route),
			'Gesture Begin was dispatched',
		)
		await f.tick(3500)
		assert.equal(f.m.isAutoActionCooldownActive(), true, 'Begin can already start SDK tracking')
		for (const id of sensitive) await f.press(id)
		assert.equal(f.writes().length, 0)
		release()
		await rejected
		assert.equal(f.variables.auto_action_cooldown_remaining_s, '3')
		await f.tick(2200)
		assert.equal(f.m.isAutoActionCooldownActive(), false)
		assert.equal(f.requests.filter((u) => u.pathname === route).length, 1)
		assert.equal(f.requests.filter((u) => u.pathname === '/tone-curve/gesture/end').length, 0)
	} finally {
		release()
		await pending.catch(() => {})
		await f.close()
	}
})
