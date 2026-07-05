export type Choice = { id: string; label: string }

export const FALLBACK_SLIDERS: Choice[] = [
	{ id: 'Exposure', label: 'Basic - Exposure' },
	{ id: 'Contrast', label: 'Basic - Contrast' },
	{ id: 'Highlights', label: 'Basic - Highlights' },
	{ id: 'Shadows', label: 'Basic - Shadows' },
	{ id: 'Whites', label: 'Basic - Whites' },
	{ id: 'Blacks', label: 'Basic - Blacks' },
	{ id: 'Temperature', label: 'Color - Temperature' },
	{ id: 'Tint', label: 'Color - Tint' },
	{ id: 'Texture', label: 'Presence - Texture' },
	{ id: 'Clarity', label: 'Presence - Clarity' },
	{ id: 'Dehaze', label: 'Presence - Dehaze' },
	{ id: 'Vibrance', label: 'Presence - Vibrance' },
	{ id: 'Saturation', label: 'Presence - Saturation' },
	{ id: 'Sharpness', label: 'Detail - Sharpness' },
	{ id: 'LuminanceNR', label: 'Detail - Luminance Noise Reduction' },
	{ id: 'ColorNR', label: 'Detail - Color Noise Reduction' },
]

export const FALLBACK_GROUPS: Choice[] = [
	{ id: 'Basic', label: 'Basic' },
	{ id: 'Color', label: 'Color' },
	{ id: 'Presence', label: 'Presence' },
	{ id: 'Detail', label: 'Detail' },
	{ id: 'Color Mixer / HSL', label: 'Color Mixer / HSL' },
	{ id: 'B&W Mixer', label: 'B&W Mixer' },
	{ id: 'Effects', label: 'Effects' },
	{ id: 'Calibration', label: 'Calibration' },
	{ id: 'Lens / Defringe', label: 'Lens / Defringe' },
	{ id: 'Transform', label: 'Transform' },
	{ id: 'Tone Curve', label: 'Tone Curve' },
]

export const LIGHTROOM_ACTIONS: Choice[] = [
	{ id: 'setAutoTone', label: 'Auto Tone' },
	{ id: 'setAutoWhiteBalance', label: 'Auto White Balance' },
	{ id: 'selectCropTool', label: 'Select Crop Tool' },
	{ id: 'resetCrop', label: 'Reset Crop' },
]
