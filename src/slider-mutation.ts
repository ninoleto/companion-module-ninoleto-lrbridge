import type { Params } from './controller-catalog.js'

/** Only writes that change slider/curve values; reads and tool navigation stay free. */
export function isSliderMutation(path: string, params: Params): boolean {
	if (['/adjust', '/set', '/reset', '/nudge'].includes(path)) return true
	if (path === '/command')
		return (
			[
				'color_grading.wheel.set',
				'color_grading.value.set',
				'color_grading.value.reset',
				'color_grading.region.reset',
				'photo.crop_angle.set',
				'photo.crop_angle.reset',
			].includes(String(params.command)) ||
			(params.command === 'develop.action' && String(params.action).startsWith('reset'))
		)
	if (/^\/(masking\/)?point-color\/(value|range|range\/translate)$/.test(path)) return true
	// Begin starts Lightroom tracking, so it also needs the guard if End fails.
	if (/^\/masking\/correction\/(reset|gesture\/(begin|end))$/.test(path)) return true
	if (
		/^\/(masking\/)?tone-curve\/(reset|preset|gesture\/(begin|end)|refine-saturation\/(reset|gesture\/(begin|end)))$/.test(
			path,
		)
	)
		return true
	if (['/develop-presets/amount', '/enhance/denoise/amount'].includes(path)) return true
	if (/^\/lens-blur\/(focal-range\/set|brush\/[^/]+\/(set|reset))$/.test(path)) return true
	if (path === '/remove/brush' || path === '/remove/repair') return typeof params.value === 'number'
	return path === '/reflections/set' && params.field === 'amount'
}

export function sensitiveAction(path: string, params: Params): string | undefined {
	if (path !== '/command') return undefined
	if (params.command === 'photo.treatment') return 'photo.treatment'
	if (params.command === 'develop.action' && ['setAutoTone', 'setAutoWhiteBalance'].includes(String(params.action)))
		return String(params.action)
	return undefined
}
