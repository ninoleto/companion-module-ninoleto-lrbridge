import type { CompanionLayeredButtonPresetDefinition, CompanionSimplePresetDefinition } from '@companion-module/base'

/**
 * Companion 5 interprets legacy `size: 'auto'` as Text Size 100. Its layered
 * API is required to retain an exact Text Size 25 with Shrink to fit enabled.
 * Keep this conversion at the preset boundary so actions and subscriptions
 * retain their existing IDs/options and feedback ordering.
 */
export function layeredPreset(
	preset: CompanionSimplePresetDefinition<any>,
): CompanionLayeredButtonPresetDefinition<any> {
	const { type: _type, style, feedbacks, ...rest } = preset
	return {
		...rest,
		type: 'layered',
		elements: [
			{
				id: 'background',
				name: 'Background',
				type: 'box',
				opacity: 100,
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				color: style.bgcolor,
			},
			{
				id: 'label',
				name: 'Label and value',
				type: 'text',
				opacity: 100,
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				text: style.text,
				color: style.color,
				font: 'companion-sans',
				fontsize: 25,
				fontsizeAllowShrink: true,
				halign: 'center',
				valign: 'center',
			},
		],
		feedbacks: feedbacks.map(({ style: feedbackStyle, ...feedback }) => ({
			...feedback,
			styleOverrides: Object.entries(feedbackStyle ?? {}).map(([property, value]) => ({
				elementId: property === 'bgcolor' ? 'background' : 'label',
				elementProperty: property === 'bgcolor' ? 'color' : property,
				// Companion 5.0.1 ignores plain-valued feedback overrides. Unlike
				// element properties, each override must use this explicit wrapper.
				override: { isExpression: false as const, value },
			})),
		})),
	}
}
