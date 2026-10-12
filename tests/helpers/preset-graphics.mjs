import assert from 'node:assert/strict'

// Read the public layered preset fields as Companion does; retain the compact
// style shape used by existing behavioral regression assertions.
export function presetStyle(preset) {
	assert.equal(preset.type, 'layered')
	const text = preset.elements.find((e) => e.id === 'label')
	const background = preset.elements.find((e) => e.id === 'background')
	assert.equal(text?.type, 'text')
	assert.equal(background?.type, 'box')
	return { text: text.text, color: text.color, bgcolor: background.color }
}

export function feedbackStyle(feedback) {
	return Object.fromEntries(
		feedback.styleOverrides.map((entry) => {
			assert.equal(entry.override.isExpression, false)
			return [entry.elementId === 'background' ? 'bgcolor' : entry.elementProperty, entry.override.value]
		}),
	)
}
