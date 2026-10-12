import assert from 'node:assert/strict'
import test from 'node:test'
import { controllerActions, controllerFeedbacks, publishControllerValues } from '../dist/controller-companion.js'
import { numericById, variableId } from '../dist/controller-catalog.js'
import { UpdatePresets } from '../dist/presets.js'
import { presetStyle, feedbackStyle } from './helpers/preset-graphics.mjs'

function fixture() {
	let sections, presets, variables
	const watched = [],
		unwatched = []
	const self = {
		label: 'LRBridge',
		getFeedbackSliderChoices: () => [],
		getSliderNumericValue: () => undefined,
		controller: {
			numericValues: new Map(),
			snapshots: new Map(),
			lastStatus: '',
			lastError: '',
			watch: (...args) => watched.push(args),
			unwatch: (id) => unwatched.push(id),
		},
		setPresetDefinitions(s, p) {
			sections = s
			presets = p
		},
		setVariableValues(v) {
			variables = v
		},
		checkFeedbacks() {},
	}
	UpdatePresets(self)
	return { self, sections, presets, watched, unwatched, variables: () => variables }
}

test('Automation warnings identify actual Windows paths and preserve destructive opt-in', () => {
	const { presets, sections, self } = fixture()
	for (const id of [
		'blur_focus_subject',
		'blur_focus_point-area',
		'blur_refinement_focus',
		'blur_refinement_blur',
		'blur_refinement_disclosure_true',
		'blur_refinement_disclosure_false',
		'blur_refinement_reset',
		'blur_auto_mask_true',
		'blur_auto_mask_false',
		'healing_selection_remove',
		'healing_selection_cancel',
	]) {
		const action = presets[`wc_${id}`].steps[0].down[0]
		assert.match(action.headline, /🔴 Windows automation.*may be unreliable/)
		assert.match(action.headline, /directly in Lightroom/)
		assert.equal(action.options.confirmed, false)
	}
	for (const field of ['amount', 'size', 'feather', 'flow']) {
		const steps = presets[`wc_blur_brush_${field}_rotary`].steps[0]
		for (const action of [...steps.down, ...steps.rotate_left, ...steps.rotate_right])
			assert.match(action.headline, /🔴 Windows automation.*suitable keyboard shortcut.*VICREO Listener/)
	}
	for (const id of [
		'blur_apply_true',
		'blur_depth_true',
		'blur_depth_tool_select',
		'healing_panel_dust',
		'healing_mode_clone',
		'healing_repair_refresh',
	])
		assert.equal(presets[`wc_${id}`].steps[0].down[0].headline, undefined, id)
	assert.doesNotMatch(presets.wc_healing_repair_delete.steps[0].down[0].headline, /automation/)
	assert.match(
		sections.find((s) => s.name === 'Lens Blur · Refinement').description,
		/🔴.*IMPORTANT.*Allow destructive action/,
	)
	assert.match(sections.find((s) => s.name === 'Healing \/ Dust').description, /Selected Remove \/ Cancel: 🔴/)
	const actions = controllerActions(self)
	assert.match(
		actions.controller_numeric.options.find((o) => o.id === 'numeric_automation_note').value,
		/Lens Blur brush Amount, Size, Feather and Flow only/,
	)
	assert.match(
		actions.controller_button.options.find((o) => o.id === 'button_automation_note').value,
		/Healing Selected Remove \/ Cancel/,
	)
})

test('Healing wheel workaround is restricted to new-brush Size and Feather', () => {
	const { presets } = fixture()
	for (const field of ['brushSize', 'brushFeather']) {
		const action = presets[`wc_remove_${field}_rotary`].steps[0].rotate_right[0]
		assert.match(action.headline, /VICREO Listener mouse wheel for Size, Shift \+ mouse wheel for Feather/)
		assert.match(action.headline, /Healing tool active and the pointer over the photo/)
		assert.doesNotMatch(action.headline, /Windows automation/)
	}
	for (const field of ['selectedRepairOpacity', 'selectedRepairFeather', 'visualizationThreshold'])
		assert.equal(presets[`wc_remove_${field}_rotary`].steps[0].rotate_right[0].headline, undefined)
})

test('Favorite preset setup note appears in Presets and corresponding actions', () => {
	const { sections, presets, self } = fixture()
	assert.match(
		sections.find((s) => s.name === 'Presets').description,
		/Setup required:.*favorite Lightroom presets.*LRBridge Web Controller/,
	)
	for (const direction of ['previous', 'next'])
		assert.match(
			presets[`wc_preset_${direction}`].steps[0].down[0].headline,
			/Setup required:.*LRBridge Web Controller/,
		)
	assert.match(presets.wc_preset_amount_rotary.steps[0].rotate_right[0].headline, /Setup required/)
	const actions = controllerActions(self)
	assert.match(actions.controller_favorite.description, /Setup required:.*LRBridge Web Controller/)
	assert.match(
		actions.controller_button.options.find((o) => o.id === 'button_favorites_setup').value,
		/LRBridge Web Controller/,
	)
})

test('Six read-only Point Color range overviews publish all four boundaries and watch live availability', () => {
	const f = fixture(),
		feedbacks = controllerFeedbacks(f.self)
	for (const family of ['point-color', 'mask-point-color']) {
		for (const range of ['HueRange', 'SatRange', 'LumRange']) {
			const preset = f.presets[`wc_${family}_${range}_overview`]
			assert.deepEqual(preset.steps, [{ down: [], up: [] }])
			assert.equal(preset.feedbacks.length, 4)
			const ids = ['LowerNone', 'LowerFull', 'UpperFull', 'UpperNone'].map((b) => `${family}_${range}_${b}`)
			for (const [i, id] of ids.entries()) {
				assert.ok(numericById.has(id))
				f.self.controller.numericValues.set(id, { available: true, value: [0, 25, 75, 100][i] })
			}
			publishControllerValues(f.self)
			const text = presetStyle(preset).text.replace(/\$\(LRBridge:([^)]*)\)/g, (_, name) => f.variables()[name])
			assert.match(text, /range\n0 \/ 25\n75 \/ 100$/)
			for (const [i, feedback] of preset.feedbacks.entries()) {
				assert.equal(feedback.options.control, ids[i])
				assert.equal(feedbacks.controller_value.callback({ id: `range-${i}`, options: feedback.options }), false)
				assert.deepEqual(f.watched.at(-1), [`range-${i}`, family, ids[i]])
				f.self.controller.numericValues.set(ids[i], { available: false, value: 0 })
				assert.equal(feedbacks.controller_value.callback({ id: `range-${i}`, options: feedback.options }), true)
				assert.equal(feedbackStyle(feedback).bgcolor, 0x333333)
			}
			publishControllerValues(f.self)
			for (const id of ids) assert.equal(f.variables()[variableId(id)], '')
		}
	}
})

test('Custom whole-range actions subscribe to the selected global or mask context', () => {
	const f = fixture(),
		action = controllerActions(f.self).controller_range
	assert.deepEqual(action.optionsToMonitorForSubscribe, ['masked'])
	for (const masked of [false, true]) {
		action.subscribe({ id: 'range-action', options: { masked, range: 'HueRange', amount: 1 } })
		assert.deepEqual(f.watched.at(-1), ['range-action', masked ? 'mask-point-color' : 'point-color'])
		action.unsubscribe({ id: 'range-action' })
		assert.equal(f.unwatched.at(-1), 'range-action')
	}
})
