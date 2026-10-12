import assert from 'node:assert/strict'
import test from 'node:test'
import { numericControls, numericById, buttonById } from '../dist/controller-catalog.js'
import { ControllerClient } from '../dist/controller-client.js'
import { controllerActions, controllerFeedbacks } from '../dist/controller-companion.js'
import { presetStyle, feedbackStyle } from './helpers/preset-graphics.mjs'
import { UpdatePresets } from '../dist/presets.js'
import { UpgradeScripts } from '../dist/upgrades.js'

function fixture() {
	let sections, presets
	const nativeValues = new Map()
	const self = {
		label: 'LRBridge',
		getFeedbackSliderChoices: () => [],
		getSliderNumericValue: (id) => nativeValues.get(id),
		controller: { numericValues: new Map(), snapshots: new Map(), watch() {}, unwatch() {} },
		setPresetDefinitions(s, p) {
			sections = s
			presets = p
		},
	}
	UpdatePresets(self)
	const feedbacks = controllerFeedbacks(self)
	function style(id) {
		const preset = presets[id]
		return preset.feedbacks.reduce(
			(s, f, i) =>
				feedbacks[f.feedbackId].callback({ id: String(i), options: f.options }) ? { ...s, ...feedbackStyle(f) } : s,
			{ ...presetStyle(preset) },
		)
	}
	function value(c, next) {
		self.controller.numericValues.set(c.id, { available: next !== undefined, value: next ?? 0 })
		if (next === undefined) nativeValues.delete(c.field)
		else nativeValues.set(c.field, next)
	}
	return { self, sections, presets, nativeValues, style, value }
}

test('Every generated minus/plus pair follows authoritative value sign and availability', () => {
	const f = fixture()
	for (const c of numericControls) {
		const base = `wc_${c.id}`
		if (!f.presets[`${base}_minus`]) continue
		// Exercise actual external values in each control's legal range, then
		// invalidate feedback as happens when a photo/context becomes unavailable.
		for (const next of [c.min, c.max, ...(c.min <= 0 && c.max >= 0 ? [0] : []), undefined]) {
			f.value(c, next)
			assert.equal(
				f.style(`${base}_minus`).bgcolor,
				next === undefined ? 0x333333 : next < 0 ? 0x9a4f16 : 0x202428,
				`${c.id} minus at ${next}`,
			)
			assert.equal(
				f.style(`${base}_plus`).bgcolor,
				next === undefined ? 0x333333 : next > 0 ? 0x174f7a : 0x202428,
				`${c.id} plus at ${next}`,
			)
			if (f.presets[`${base}_reset`])
				assert.equal(f.style(`${base}_reset`).bgcolor, next === undefined ? 0x333333 : 0x59410f, `${c.id} reset`)
		}
	}
	// Native confirmed feedback wins over a conflicting auxiliary cached value.
	f.self.controller.numericValues.set('Contrast', { available: true, value: 20 })
	f.nativeValues.set('Contrast', -10)
	assert.equal(f.style('wc_Contrast_minus').bgcolor, 0x9a4f16)
	assert.equal(f.style('wc_Contrast_plus').bgcolor, 0x202428)
	f.nativeValues.set('Contrast', 10)
	assert.equal(f.style('wc_Contrast_minus').bgcolor, 0x202428)
	assert.equal(f.style('wc_Contrast_plus').bgcolor, 0x174f7a)
})

test('Tone Curve labels keep deliberate whole-word lines and live values', () => {
	const { presets } = fixture()
	for (const family of ['curve', 'mask-curve']) {
		assert.equal(presetStyle(presets[`wc_${family}_preset_Linear`]).text, 'Linear')
		for (const strength of ['Medium', 'Strong']) {
			const p = presets[`wc_${family}_preset_${strength} Contrast`]
			assert.equal(presetStyle(p).text, `${strength}\nContrast`)
		}
		assert.equal(presetStyle(presets[`wc_${family}_reset_green`]).text, 'Reset\nGREEN\ncurve')
	}
	for (const c of numericControls.filter((c) => /(?:^|· )Tone Curve$/.test(c.group))) {
		for (const suffix of ['rotary', 'minus', 'reset', 'plus']) {
			const p = presets[`wc_${c.id}_${suffix}`]
			if (!p) continue
			assert.doesNotMatch(presetStyle(p).text, /Curve /)
			assert.match(presetStyle(p).text.split('\n').at(-1), /^\$\(LRBridge:/)
			assert.ok(presetStyle(p).text.split('\n').length <= 4, p.name)
			for (const line of presetStyle(p).text.split('\n').slice(0, -1))
				assert.ok(line.length <= 12, `${p.name}: ${line}`)
		}
	}
	assert.match(presetStyle(presets.wc_ParametricShadowSplit_rotary).text, /Shadow\nSplit/)
})

test('Destructive setup is prominent and never pre-arms actions; automation warnings are specific', () => {
	const { sections, presets, self } = fixture()
	for (const group of ['Develop actions', 'Masking']) {
		assert.match(sections.find((s) => s.name === group).description, /IMPORTANT.*Allow destructive action/)
	}
	for (const p of Object.values(presets)) {
		for (const a of p.steps.flatMap((s) => s.down)) {
			if (a.actionId !== 'controller_button' || !buttonById.get(a.options.control)?.confirm) continue
			assert.equal(a.options.confirmed, false)
			assert.match(a.headline, /IMPORTANT.*Allow destructive action/)
		}
	}
	const options = controllerActions(self).controller_button.options
	assert.equal(options.find((o) => o.id === 'confirmed').default, false)
	assert.match(presets['wc_blur_focus_point-area'].steps[0].down[0].headline, /Windows automation/)
	assert.match(presets.wc_blur_refinement_focus.steps[0].down[0].headline, /Windows automation/)
	assert.equal(presets.wc_healing_mode_clone.steps[0].down[0].headline, undefined)
	assert.equal(presets.wc_blur_apply_true.steps[0].down[0].headline, undefined)
})

test('Focus Range disappears from choices and presets while remaining Lens Blur controls stay', () => {
	const { sections, presets, self } = fixture()
	const actions = controllerActions(self)
	assert.equal(actions.controller_focus_range, undefined)
	assert.equal(
		sections.some((s) => s.name === 'Lens Blur · Focus Range'),
		false,
	)
	const numericChoices = actions.controller_numeric.options.find((o) => o.id === 'control').choices
	for (const part of ['nearOuter', 'nearInner', 'farInner', 'farOuter']) {
		const id = `blur_focus_${part}`
		assert.equal(numericById.has(id), false)
		assert.equal(
			numericChoices.some((c) => c.id === id),
			false,
		)
		assert.equal(
			Object.keys(presets).some((p) => p.startsWith(`wc_${id}_`)),
			false,
		)
	}
	for (const id of ['wc_blur_apply_true', 'wc_blur_depth_true', 'wc_blur_focus_subject', 'wc_blur_brush_size_rotary'])
		assert.ok(presets[id], id)
})

test('Saved Focus Range shifts migrate to a clear safe failure and old numeric IDs cannot send commands', async () => {
	const oldShift = {
		id: 'old-shift',
		controlId: '1/0/0',
		actionId: 'controller_focus_range',
		options: {
			part: { isExpression: false, value: 'whole' },
			amount: { isExpression: false, value: 1 },
		},
	}
	const unchanged = {
		id: 'working',
		controlId: '1/0/1',
		actionId: 'controller_numeric',
		options: {
			control: { isExpression: false, value: 'Exposure' },
		},
	}
	const before = structuredClone([oldShift, unchanged])
	const upgraded = UpgradeScripts[0]({}, { actions: [oldShift, unchanged], feedbacks: [], config: null, secrets: null })
	assert.equal(upgraded.updatedActions.length, 1)
	assert.deepEqual([oldShift, unchanged], before)
	assert.equal(upgraded.updatedConfig, null)
	assert.deepEqual(upgraded.updatedFeedbacks, [])
	const action = upgraded.updatedActions[0]
	assert.equal(action.id, oldShift.id)
	assert.equal(action.controlId, oldShift.controlId)
	assert.equal(action.actionId, 'controller_numeric')
	assert.deepEqual(
		UpgradeScripts[0]({}, { actions: [action], feedbacks: [], config: null, secrets: null }).updatedActions,
		[],
	)
	let calls = 0
	const c = new ControllerClient({
		request: async () => {
			calls++
			throw new Error('Unexpected request')
		},
	})
	try {
		for (const id of [
			'blur_focus_retired',
			...['nearOuter', 'nearInner', 'farInner', 'farOuter'].map((p) => `blur_focus_${p}`),
		])
			await assert.rejects(c.numeric(id, 'set', 0), /Focus Range.*removed.*Web Controller/)
		await assert.rejects(c.focusRange('whole', 1), /Focus Range.*removed.*Web Controller/)
		assert.equal(calls, 0)
		const errors = []
		const self = { controller: c, log: (_level, message) => errors.push(message), setVariableValues() {} }
		const options = Object.fromEntries(Object.entries(action.options).map(([key, option]) => [key, option.value]))
		await controllerActions(self).controller_numeric.callback({ ...action, options })
		assert.match(errors[0], /Focus Range.*removed.*Web Controller/)
		assert.equal(calls, 0)
	} finally {
		c.stop()
	}
})
