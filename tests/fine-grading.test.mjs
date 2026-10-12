import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { ControllerClient } from '../dist/controller-client.js'
import { numericById, reference } from '../dist/controller-catalog.js'
import { appendControllerPresets, controllerActions } from '../dist/controller-companion.js'

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const { createNumericNudge } = require(path.join(root, 'server/numeric-nudge.js'))
const { createResetCompletion } = require(path.join(root, 'server/reset-completion.js'))
const { validateCommand } = require(path.join(root, 'server/commands.js'))
const context = {
	activeModule: 'develop',
	selectedPhotoUuid: 'photo-a',
	selectedPhotoKey: 'photo-a',
	contextCounter: 1,
	contextChangedAt: 100,
	developCounter: 2,
}
const waitFor = async (f) => {
	for (let i = 0; i < 50 && !f(); i++) await delay(5)
	assert.ok(f(), 'Expected dispatch before SDK feedback arrives')
}

function gradingFixture(onCommand) {
	const parameters = Object.fromEntries(
		[
			...Object.values(reference.grading.regions).flatMap((r) => [r.hue, r.saturation, r.luminance]),
			...Object.values(reference.grading.scalarControls).map((r) => r.parameter),
		].map((field) => [
			field,
			{
				available: true,
				value: field.endsWith('Hue') ? 10 : field.endsWith('Saturation') || field.endsWith('Sat') ? 20 : 0,
				range: {
					min: field.endsWith('Hue') || field.endsWith('Saturation') || field.endsWith('Sat') ? 0 : -100,
					max: field.endsWith('Hue') ? 360 : 100,
				},
			},
		]),
	)
	let serial = 0,
		reads = 0
	const writes = [],
		ctx = { ...context }
	const c = new ControllerClient({
		changed() {},
		adjust() {
			throw Error('Unexpected SDK adjustment')
		},
		async request(url) {
			const u = new URL(url, 'http://fixture')
			if (u.pathname === '/context') return { ...ctx }
			if (u.pathname === '/color-grading/request') {
				reads++
				return { request: { id: ++serial } }
			}
			if (u.pathname === '/color-grading/snapshot')
				return { snapshot: { complete: true, context: { ...ctx }, parameters: structuredClone(parameters) } }
			if (u.pathname === '/command') {
				const p = Object.fromEntries(u.searchParams)
				for (const k of ['hue', 'saturation', 'value']) if (k in p) p[k] = Number(p[k])
				assert.equal(validateCommand(p), true)
				writes.push(p)
				await onCommand?.(p, parameters)
				return { ok: true }
			}
			throw Error(url)
		},
	})
	return { c, writes, parameters, ctx, reads: () => reads }
}

test('Color Grading successive turns dispatch while SDK feedback still reports the previous values', async () => {
	const f = gradingFixture(),
		pending = []
	try {
		await f.c.read('grading')
		pending.push(f.c.numeric('grading_midtones_hue', 'adjust', 1).catch((e) => e))
		await waitFor(() => f.writes.length === 1)
		pending.push(f.c.numeric('grading_midtones_hue', 'adjust', 1).catch((e) => e))
		await waitFor(() => f.writes.length === 2)
		assert.deepEqual(
			f.writes.map((x) => [x.hue, x.saturation]),
			[
				[11, 20],
				[12, 20],
			],
		)
		assert.equal(f.reads(), 1, 'No full grading read between encoder turns')
		assert.equal(
			f.c.numericValues.get('grading_midtones_hue').value,
			10,
			'Pending target must not pretend to be confirmed SDK feedback',
		)
	} finally {
		f.c.stop()
		await Promise.all(pending)
	}
})

test('Color Grading alternating Hue/Saturation retains both pending axes', async () => {
	const f = gradingFixture()
	try {
		await f.c.numeric('grading_midtones_hue', 'adjust', 2)
		await f.c.numeric('grading_midtones_saturation', 'adjust', 3)
		await f.c.numeric('grading_midtones_hue', 'adjust', -1)
		assert.deepEqual(
			f.writes.map((x) => [x.hue, x.saturation]),
			[
				[12, 20],
				[12, 23],
				[11, 23],
			],
		)
	} finally {
		f.c.stop()
	}
})

test('Every Color Grading region and scalar dispatches the existing Web Controller command', async () => {
	const f = gradingFixture()
	try {
		for (const region of Object.keys(reference.grading.regions)) {
			await f.c.numeric(`grading_${region}_hue`, 'fine', 1)
			await f.c.numeric(`grading_${region}_saturation`, 'fine', 1)
			assert.deepEqual(f.writes.at(-1), { command: 'color_grading.wheel.set', region, hue: 11, saturation: 21 })
		}
		for (const control of Object.keys(reference.grading.scalarControls)) {
			await f.c.numeric(`grading_${control}`, 'fine', 1)
			assert.deepEqual(f.writes.at(-1), { command: 'color_grading.value.set', control, value: 1 })
		}
	} finally {
		f.c.stop()
	}
})

test('Delayed grading feedback remains pending, then external Lightroom changes become the new baseline', async () => {
	const f = gradingFixture(),
		hue = reference.grading.regions.midtones.hue
	try {
		await f.c.numeric('grading_midtones_hue', 'fine', 1)
		await f.c.read('grading')
		assert.equal(f.c.isPending('grading'), true)
		await f.c.numeric('grading_midtones_hue', 'fine', 1)
		assert.equal(f.writes.at(-1).hue, 12)
		f.parameters[hue].value = 12
		await f.c.read('grading')
		assert.equal(f.c.isPending('grading'), false)
		f.parameters[hue].value = 90 // Changed in Lightroom after our edit was confirmed.
		f.ctx.developCounter++ // Fresh context must force a new baseline even with a recent cache.
		await f.c.numeric('grading_midtones_hue', 'fine', 1)
		assert.equal(f.writes.at(-1).hue, 91)
	} finally {
		f.c.stop()
	}
})

test('A queued grading edit cannot cross a photo change', async () => {
	let release
	const blocked = new Promise((r) => (release = r)),
		f = gradingFixture(() => blocked)
	const first = f.c.numeric('grading_midtones_hue', 'fine', 1)
	try {
		await waitFor(() => f.writes.length === 1)
		const second = f.c.numeric('grading_midtones_hue', 'fine', 1)
		const rejected = assert.rejects(second, /Photo changed/)
		f.ctx.selectedPhotoUuid = 'photo-b'
		f.ctx.contextCounter++
		release()
		await first
		await rejected
		assert.equal(f.writes.length, 1)
	} finally {
		release()
		f.c.stop()
		await first.catch(() => {})
	}
})

test('A failed grading request cancels waiting turns without replaying any command', async () => {
	let release
	const blocked = new Promise((r) => (release = r)),
		f = gradingFixture(async () => {
			await blocked
			throw Error('Connection lost after dispatch')
		})
	const first = f.c.numeric('grading_midtones_hue', 'fine', 1)
	const rejectedFirst = assert.rejects(first, /Connection lost/)
	try {
		await waitFor(() => f.writes.length === 1)
		const second = f.c.numeric('grading_midtones_hue', 'fine', 1)
		const rejectedSecond = assert.rejects(second, /cancelled after an earlier failure/)
		release()
		await rejectedFirst
		await rejectedSecond
		assert.equal(f.writes.length, 1)
	} finally {
		release()
		f.c.stop()
		await rejectedFirst
	}
})

test('Color Grading region Reset separates previous targets from the following turn', async () => {
	const f = gradingFixture((p, parameters) => {
		if (p.command === 'color_grading.region.reset') {
			const region = reference.grading.regions[p.region]
			for (const field of [region.hue, region.saturation, region.luminance]) parameters[field].value = 0
		}
	})
	try {
		await f.c.numeric('grading_midtones_hue', 'fine', 2)
		const reset = f.c.button('grading_midtones_reset'),
			next = f.c.numeric('grading_midtones_hue', 'fine', 1)
		await Promise.all([reset, next])
		assert.equal(f.writes.at(-2).command, 'color_grading.region.reset')
		assert.deepEqual(f.writes.at(-1), { command: 'color_grading.wheel.set', region: 'midtones', hue: 1, saturation: 0 })
	} finally {
		f.c.stop()
	}
})

test('Color Grading scalar Reset is confirmed before applying a following fine turn', async () => {
	const f = gradingFixture((p, parameters) => {
		if (p.command === 'color_grading.value.reset')
			parameters[reference.grading.scalarControls[p.control].parameter].value = p.control === 'blending' ? 50 : 0
	})
	try {
		await f.c.numeric('grading_blending', 'set', 70)
		await Promise.all([f.c.numeric('grading_blending', 'reset'), f.c.numeric('grading_blending', 'fine', 1)])
		assert.deepEqual(f.writes.at(-1), { command: 'color_grading.value.set', control: 'blending', value: 51 })
	} finally {
		f.c.stop()
	}
})

test('Fine batch preserves direction changes at the maximum instead of summing them away', async () => {
	let state,
		value = 100
	const commands = [],
		requests = new Map()
	state = createNumericNudge({
		serverEpoch: 'e',
		getContext: () => context,
		enqueue(c) {
			commands.push(c)
			assert.equal(state.matches(c, 'admit'), true)
			requests.set(c.requestId, c)
			return { accepted: true }
		},
	})
	const c = new ControllerClient({
		changed() {},
		adjust() {
			throw Error('Unexpected SDK step')
		},
		async request(url, body) {
			const u = new URL(url, 'http://fixture')
			if (u.pathname === '/nudge/capabilities') return state.capabilities()
			if (u.pathname === '/nudge') {
				const r = state.admit(body)
				assert.equal(r.status, 202)
				return { ok: true, ...r }
			}
			if (u.pathname === '/context') return context
			if (u.pathname === '/nudge/result') {
				const command = requests.get(u.searchParams.get('requestId')),
					key = { ...Object.fromEntries(u.searchParams), operationId: command.operationId },
					start = value
				assert.equal(state.matches(command, 'dequeue'), true)
				assert.equal(state.claim(key), true)
				for (const count of command.steps) value = Math.min(100, Math.max(-100, value + count * command.numericStep))
				assert.equal(
					state.acceptResult({
						...key,
						outcome: 'observed',
						invoked: true,
						executionDevelopCounter: context.developCounter,
						baselineValue: start,
						requestedValue: value,
						sdkValue: value,
						min: -100,
						max: 100,
					}),
					true,
				)
				return { ok: true, receipt: state.get(key) }
			}
			throw Error(url)
		},
	})
	try {
		await Promise.all([c.numeric('Contrast', 'fine', 1), c.numeric('Contrast', 'fine', -1)])
		assert.equal(commands.length, 1)
		assert.deepEqual(commands[0].steps, [1, -1])
		assert.equal(value, 99)
	} finally {
		c.stop()
	}
})

for (const [slider, start, end, steps] of [
	['Exposure', 0, 0.1, 10],
	['Contrast', 20, 21, 1],
	['Temperature', 6200, 6201, 1],
	['ProfileAmount', 100, 101, 1],
]) {
	test(`Fine button matches the Web Controller step for ${slider}`, async () => {
		let command,
			state,
			value = start,
			sent = 0
		state = createNumericNudge({
			serverEpoch: 'nudge-epoch',
			getContext: () => context,
			enqueue(c) {
				command = c
				assert.equal(state.matches(c, 'admit'), true)
				return { accepted: true }
			},
		})
		const c = new ControllerClient({
			changed() {},
			adjust() {
				throw Error('Fine buttons must not use Adobe increment/decrement')
			},
			async request(url, body) {
				const u = new URL(url, 'http://fixture')
				if (u.pathname === '/nudge/capabilities') return state.capabilities()
				if (u.pathname === '/context') return context
				if (u.pathname === '/nudge') {
					sent++
					const r = state.admit(body)
					assert.equal(r.status, 202)
					assert.deepEqual(command.steps, [steps])
					return { ok: true, ...r }
				}
				if (u.pathname === '/nudge/result') {
					const key = { ...Object.fromEntries(u.searchParams), operationId: command.operationId }
					if (state.get(key).phase !== 'complete') {
						assert.equal(state.matches(command, 'dequeue'), true)
						assert.equal(state.claim(key), true)
						value = Number(
							(value + command.steps.reduce((a, b) => a + b, 0) * command.numericStep).toFixed(command.precision),
						)
						assert.equal(
							state.acceptResult({
								...key,
								outcome: 'observed',
								invoked: true,
								executionDevelopCounter: context.developCounter,
								baselineValue: start,
								requestedValue: value,
								sdkValue: value,
								min: slider === 'Temperature' ? 2000 : -100,
								max: slider === 'Temperature' ? 50000 : 200,
							}),
							true,
						)
					}
					return { ok: true, receipt: state.get(key) }
				}
				throw Error(url)
			},
		})
		try {
			await c.numeric(slider, 'fine', 1)
			assert.equal(sent, 1)
			assert.equal(value, end)
			assert.equal(c.numericValues.get(slider).value, end)
		} finally {
			c.stop()
		}
	})
}

test('New Controller button and rotary presets explicitly use Fine steps', () => {
	const presets = {},
		self = { label: 'lrbridge', getFeedbackSliderChoices: () => [] }
	appendControllerPresets(self, [], presets)
	for (const id of ['Exposure', 'Contrast']) {
		assert.equal(presets[`wc_${id}_plus`].steps[0].down[0].options.mode, 'fine')
		assert.equal(presets[`wc_${id}_rotary`].steps[0].rotate_left[0].options.mode, 'fine')
	}
	assert.equal(controllerActions(self).controller_numeric.options.find((o) => o.id === 'mode').default, 'fine')
})

test('Fine turns on either side of Reset use the actual serial-worker Reset baseline', async () => {
	let value = 6300
	const events = [],
		queued = new Map(),
		states = {}
	for (const [route, create] of [
		['reset', createResetCompletion],
		['nudge', createNumericNudge],
	]) {
		states[route] = create({
			serverEpoch: `${route}-epoch`,
			getContext: () => context,
			enqueue(command) {
				queued.set(command.requestId, command)
				assert.equal(states[route].matches(command, 'admit'), true)
				return { accepted: true }
			},
		})
	}
	const c = new ControllerClient({
		changed() {},
		adjust() {
			throw Error('No coarse SDK adjustment')
		},
		async request(url, body) {
			const u = new URL(url, 'http://fixture'),
				[route, verb] = u.pathname.slice(1).split('/'),
				state = states[route]
			if (route === 'context') return context
			if (verb === 'capabilities') return state.capabilities()
			if (!verb) {
				const r = state.admit(body)
				assert.equal(r.status, 202)
				return { ok: true, ...r }
			}
			assert.equal(verb, 'result')
			const command = queued.get(u.searchParams.get('requestId')),
				key = { ...Object.fromEntries(u.searchParams), operationId: command.operationId }
			assert.equal(state.matches(command, 'dequeue'), true)
			assert.equal(state.claim(key), true)
			const start = value
			if (route === 'reset')
				value = 6200 // Actual Lightroom reset; no metadata/client default.
			else for (const count of command.steps) value += count * command.numericStep
			events.push([route, start, value])
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
			else Object.assign(result, { baselineValue: start, requestedValue: value, min: 2000, max: 50000 })
			assert.equal(state.acceptResult(result), true)
			return { ok: true, receipt: state.get(key) }
		},
	})
	try {
		await Promise.all([
			c.numeric('Temperature', 'fine', 1),
			c.numeric('Temperature', 'reset'),
			c.numeric('Temperature', 'fine', 1),
		])
		assert.deepEqual(events, [
			['nudge', 6300, 6301],
			['reset', 6301, 6200],
			['nudge', 6200, 6201],
		])
		assert.equal(c.numericValues.get('Temperature').value, 6201)
	} finally {
		c.stop()
	}
})

test('Fine Nudge rejects a completion from a different server epoch without replay', async () => {
	let commandBody,
		writes = 0
	const c = new ControllerClient({
		changed() {},
		adjust() {
			throw Error('No coarse SDK adjustment')
		},
		async request(url, body) {
			if (url === '/nudge/capabilities') return { supported: true, serverEpoch: 'correct', context }
			if (url === '/nudge') {
				writes++
				commandBody = body
				return { receipt: { operationId: 'nn-1' } }
			}
			if (url.startsWith('/nudge/result'))
				return {
					receipt: {
						serverEpoch: 'wrong',
						requestId: commandBody.requestId,
						operationId: 'nn-1',
						phase: 'complete',
						result: { ...commandBody, outcome: 'observed', sdkValue: 1 },
					},
				}
			throw Error(url)
		},
	})
	try {
		await assert.rejects(c.numeric('Contrast', 'fine', 1), /Mismatched operation result identity/)
		assert.equal(writes, 1)
		assert.equal(c.numericValues.get('Contrast')?.available, false)
	} finally {
		c.stop()
	}
})
