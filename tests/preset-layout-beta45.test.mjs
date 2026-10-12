import assert from 'node:assert/strict'
import test from 'node:test'
import { buttonById, buttonControls, numericControls } from '../dist/controller-catalog.js'
import { controllerActions, controllerFeedbacks } from '../dist/controller-companion.js'
import { presetStyle, feedbackStyle } from './helpers/preset-graphics.mjs'
import { UpdatePresets } from '../dist/presets.js'

function fixture() {
	let sections, presets
	const self = {
		label: 'LRBridge',
		getFeedbackSliderChoices: () => [],
		getSliderNumericValue: () => undefined,
		controller: {
			numericValues: new Map(),
			snapshots: new Map(),
			watch() {},
			unwatch() {},
		},
		setPresetDefinitions(s, p) {
			sections = s
			presets = p
		},
	}
	UpdatePresets(self)
	return { self, sections, presets }
}

test('Develop actions contains only the requested five clearly labelled controls', () => {
	const { sections, presets } = fixture()
	const ids = sections.find((s) => s.name === 'Develop actions').definitions[0].presets
	assert.deepEqual(
		ids.map((id) => presetStyle(presets[id]).text),
		['Reset All', 'Auto Tone', 'Color', 'B&W', 'Auto White Balance'],
	)
	for (const [id, group] of [
		['develop.action_resetCrop', 'Crop'],
		['develop.action_resetTransforms', 'Transform'],
		['develop.action_resetSpotRemoval', 'Healing / Dust'],
		['red_eye_reset', 'Red Eye'],
		['mask_panel_true', 'Masking'],
		['healing_panel_dust', 'Healing / Dust'],
	])
		assert.ok(sections.find((s) => s.name === group).definitions[0].presets.includes(`wc_${id}`), id)
})

test('Application follows the Web Controller groups and includes a Zoom rotary and secondary display controls', () => {
	const { sections, presets } = fixture()
	const app = sections.filter((s) => s.name.startsWith('Application'))
	assert.deepEqual(
		app.map((s) => s.name),
		[
			'Application · Modules',
			'Application · Library Views',
			'Application · Develop Views',
			'Application · Zoom',
			'Application · Screen',
			'Application · Secondary Display',
		],
	)
	assert.ok(app[0].definitions[0].presets.includes('wc_application.module_develop'))
	assert.ok(app[1].definitions[0].presets.includes('wc_application.view_grid'))
	assert.ok(app[2].definitions[0].presets.includes('wc_application.view_develop_before_after_vert'))
	const secondary = app.at(-1).definitions[0].presets
	assert.ok(secondary.includes('wc_application.action_toggle_secondary_display'))
	assert.ok(secondary.includes('wc_application.action_toggle_secondary_fullscreen'))
	const zoom = presets.wc_application_zoom_rotary.steps[0]
	assert.equal(app[3].definitions[0].presets[0], 'wc_application_zoom_rotary')
	assert.equal(zoom.down.length, 1)
	assert.equal(zoom.down[0].options.control, 'application.action_toggle_zoom')
	assert.match(zoom.down[0].headline, /Fit or Fill/)
	assert.match(zoom.down[0].headline, /pressing again while fitted zooms in/)
	assert.equal(zoom.rotate_left[0].options.control, 'application.action_zoom_out')
	assert.equal(zoom.rotate_right[0].options.control, 'application.action_zoom_in')
	for (const a of [...zoom.down, ...zoom.rotate_left, ...zoom.rotate_right]) {
		const button = buttonById.get(a.options.control)
		assert.equal(button.path, '/command')
		assert.equal(button.params.command, 'application.action')
	}
})

test('Mask creation, addition and subtraction have independent complete sections', () => {
	const { sections, presets } = fixture()
	for (const [name, route] of [
		['Masking · Create Mask', '/masking/create'],
		['Masking · Add Component', '/masking/component/add'],
		['Masking · Subtract Component', '/masking/component/subtract'],
	]) {
		const ids = sections.find((s) => s.name === name).definitions[0].presets
		assert.equal(ids.length, 12)
		for (const id of ids) assert.equal(buttonById.get(presets[id].steps[0].down[0].options.control).path, route)
	}
})

test('Windows Healing Add/Subtract are omitted from new presets and choices while existing IDs remain callable', () => {
	const { presets, self } = fixture()
	const choices = controllerActions(self).controller_button.options.find((o) => o.id === 'control').choices
	for (const id of ['healing_selection_add', 'healing_selection_subtract']) {
		assert.equal(presets[`wc_${id}`], undefined)
		assert.equal(
			choices.some((c) => c.id === id),
			false,
		)
		assert.equal(buttonById.get(id).path, '/remove/selection')
	}
	for (const c of buttonControls.filter(
		(c) => c.path === '/masking/component/add' || c.path === '/masking/component/subtract',
	))
		assert.ok(presets[`wc_${c.id}`], c.id)
})

test('Red Eye and Pet Eye use the packaged route operation names', () => {
	const { presets } = fixture()
	assert.equal(buttonById.get('red_eye_open').params.operationKind, 'red_eye')
	assert.equal(buttonById.get('red_eye_pet_eye').params.operationKind, 'pet_eye')
	assert.equal(presetStyle(presets.wc_red_eye_pet_eye).text, 'Open Pet Eye')
	assert.equal(buttonById.get('red_eye_close').params.operationKind, 'close')
	assert.equal(buttonById.get('red_eye_reset').params.operationKind, 'reset')
})

test('Signed rotary feedback follows the value; minus and plus only highlight their own sign', () => {
	const { self, presets } = fixture()
	const feedbacks = controllerFeedbacks(self)
	const id = 'point-color_HueShift'
	function styleFor(presetId, value) {
		self.controller.numericValues.set(id, { available: value !== undefined, value: value ?? 0 })
		const p = presets[presetId]
		let style = { ...presetStyle(p) }
		for (const [i, f] of p.feedbacks.entries()) {
			if (feedbacks[f.feedbackId].callback({ id: String(i), options: f.options }))
				style = { ...style, ...feedbackStyle(f) }
		}
		return style
	}
	for (const [suffix, base, negative, positive] of [
		['rotary', 0x24364a, 0x9a4f16, 0x174f7a],
		['minus', 0x202428, 0x9a4f16, 0x202428],
		['plus', 0x202428, 0x202428, 0x174f7a],
	]) {
		const preset = `wc_${id}_${suffix}`
		assert.equal(styleFor(preset, -12).bgcolor, negative)
		assert.equal(styleFor(preset, 12).bgcolor, positive)
		assert.equal(styleFor(preset, 0).bgcolor, base)
		assert.equal(styleFor(preset, undefined).bgcolor, 0x333333)
	}
	assert.equal(styleFor(`wc_${id}_reset`, -12).bgcolor, 0x59410f)
	assert.equal(styleFor(`wc_${id}_reset`, undefined).bgcolor, 0x333333)
})

test('On/Off, Delete, Reset and ordinary button styles communicate distinct meanings', () => {
	const { presets } = fixture()
	for (const [id, base, active] of [
		['wc_denoise_true', 0x24645d, 0x287250],
		['wc_denoise_false', 0x651f23, 0x651f23],
		['wc_healing_panel_loupe', 0x651f23, 0x651f23],
		['wc_mask_selected_delete', 0x8b1e2d, 0x8b1e2d],
		['wc_develop.action_resetAllDevelopAdjustments', 0x59410f, 0x59410f],
		['wc_application.module_develop', 0x24364a, 0x174f7a],
	]) {
		assert.equal(presetStyle(presets[id]).bgcolor, base, id)
		assert.equal(feedbackStyle(presets[id].feedbacks[0]).bgcolor, active, id)
	}
	for (const c of numericControls.filter((c) => c.family === 'native' && c.max - c.min === 1)) {
		assert.equal(presetStyle(presets[`wc_${c.id}_0`]).bgcolor, 0x651f23)
		assert.equal(feedbackStyle(presets[`wc_${c.id}_0`].feedbacks[0]).bgcolor, 0x651f23)
	}
})

test('Reset All remains explicitly armed and tells the preset user how to enable it', () => {
	const { presets } = fixture()
	const p = presets['wc_develop.action_resetAllDevelopAdjustments']
	assert.equal(presetStyle(p).text, 'Reset All')
	assert.match(p.name, /enable permission/i)
	assert.equal(p.steps[0].down[0].options.confirmed, false)
	assert.match(p.steps[0].down[0].headline, /Allow destructive action/)
})

test('Every generated preset uses Text Size 25 plus Shrink to fit through the supported layered API', () => {
	const { presets } = fixture()
	for (const p of Object.values(presets)) {
		assert.equal(p.type, 'layered', p.name)
		assert.equal(Object.hasOwn(p, 'style'), false)
		const ids = new Set(p.elements.map((e) => e.id))
		assert.equal(ids.size, p.elements.length)
		for (const element of p.elements) {
			assert.equal(element.opacity, 100, `${p.name}: explicit full opacity required by Companion 5.0.1`)
			if (element.type !== 'text') continue
			assert.equal(element.fontsize, 25, p.name)
			assert.equal(element.fontsizeAllowShrink, true, p.name)
			assert.equal(element.font, 'companion-sans', p.name)
		}
		for (const feedback of p.feedbacks) {
			assert.ok(feedback.styleOverrides.length > 0, p.name)
			for (const entry of feedback.styleOverrides) {
				assert.ok(ids.has(entry.elementId), p.name)
				assert.equal(entry.override.isExpression, false, p.name)
				if (entry.elementProperty === 'text') {
					assert.equal(feedback.feedbackId, 'auto_action_cooldown_active', p.name)
					assert.equal(entry.elementId, 'label', p.name)
					assert.equal(typeof entry.override.value, 'string', p.name)
				} else {
					assert.equal(entry.elementProperty, 'color', p.name)
					assert.equal(typeof entry.override.value, 'number', p.name)
				}
			}
		}
	}
})
