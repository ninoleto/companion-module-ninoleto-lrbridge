import assert from 'node:assert/strict'
import test from 'node:test'
import { UpdatePresets } from '../dist/presets.js'
import { UpdateFeedbacks } from '../dist/feedbacks.js'
import { UpdateVariableDefinitions } from '../dist/variables.js'
import { presetStyle, feedbackStyle } from './helpers/preset-graphics.mjs'

const guarded = [
	['develop.action_setAutoTone', 'Auto Tone'],
	['develop.action_setAutoWhiteBalance', 'Auto White Balance'],
	['photo.treatment_color', 'Color'],
	['photo.treatment_grayscale', 'B&W'],
]

function fixture() {
	let presets,
		sections,
		feedbacks,
		variables,
		cooling = false
	const self = {
		label: 'My Lightroom',
		getFeedbackSliderChoices: () => [],
		isAutoActionCooldownActive: () => cooling,
		setPresetDefinitions(s, p) {
			sections = s
			presets = p
		},
		setFeedbackDefinitions(f) {
			feedbacks = f
		},
		setVariableDefinitions(v) {
			variables = v
		},
	}
	UpdatePresets(self)
	UpdateFeedbacks(self)
	UpdateVariableDefinitions(self)
	return {
		presets,
		sections,
		feedbacks,
		variables,
		setCooling(value) {
			cooling = value
		},
	}
}

test('Exactly four existing action presets expose cooldown feedback without changing their press actions', () => {
	const f = fixture()
	assert.deepEqual(
		Object.entries(f.presets)
			.filter(([, p]) => p.feedbacks.some((v) => v.feedbackId === 'auto_action_cooldown_active'))
			.map(([id]) => id)
			.sort(),
		guarded.map(([id]) => `wc_${id}`).sort(),
	)
	for (const [id, label] of guarded) {
		const preset = f.presets[`wc_${id}`]
		assert.equal(presetStyle(preset).text, label)
		assert.deepEqual(preset.steps[0].down[0].options, { control: id, confirmed: false })
		assert.equal(preset.steps[0].down[0].actionId, 'controller_button')
		assert.match(preset.steps[0].down[0].headline, /Waiting for Lightroom to finish the previous adjustment/)
		assert.equal(preset.feedbacks[0].feedbackId, 'controller_selected')
		assert.equal(preset.feedbacks.at(-1).feedbackId, 'auto_action_cooldown_active')
		const text = preset.elements.find((e) => e.id === 'label')
		assert.equal(text.fontsize, 25)
		assert.equal(text.fontsizeAllowShrink, true)
		assert.ok(preset.elements.every((e) => e.opacity === 100))
	}
	assert.match(f.sections.find((s) => s.name === 'Develop actions').description, /Each slider adjustment restarts/)
})

test('WAIT 3s, 2s and 1s overrides ordinary selected style and expiry restores the unchanged label and colour', () => {
	const f = fixture()
	for (const [id, label] of guarded) {
		const preset = f.presets[`wc_${id}`]
		const normal = presetStyle(preset)
		const waiting = feedbackStyle(preset.feedbacks.at(-1))
		for (const selected of [false, true]) {
			const ordinary = { ...normal, ...(selected ? feedbackStyle(preset.feedbacks[0]) : {}) }
			f.setCooling(true)
			assert.equal(f.feedbacks.auto_action_cooldown_active.callback(), true)
			for (const remaining of [3, 2, 1]) {
				const displayed = { ...ordinary, ...waiting }
				assert.equal(
					displayed.text.replace('$(My Lightroom:auto_action_cooldown_remaining_s)', String(remaining)),
					`WAIT\n${remaining}s`,
				)
				assert.equal(displayed.bgcolor, 0xffaa00)
				assert.equal(displayed.color, 0x000000)
			}
			f.setCooling(false)
			assert.equal(f.feedbacks.auto_action_cooldown_active.callback(), false)
			assert.equal(ordinary.text, label)
			assert.equal(ordinary.bgcolor, selected ? 0x174f7a : 0x24364a)
			assert.equal(ordinary.color, 0xffffff)
		}
	}
})

test('Cooldown feedback and variable descriptions cover Color and B&W while preserving public IDs', () => {
	const f = fixture()
	const feedback = f.feedbacks.auto_action_cooldown_active
	assert.match(feedback.name, /Auto Tone \/ Auto White Balance \/ Color \/ B&W/)
	assert.match(feedback.description, /Waiting for Lightroom to finish the previous adjustment/)
	assert.deepEqual(feedback.defaultStyle, { bgcolor: 0xffaa00, color: 0x000000 })
	for (const suffix of ['active', 'remaining_ms', 'remaining_s'])
		assert.match(f.variables[`auto_action_cooldown_${suffix}`].name, /Color \/ B&W/)
})
