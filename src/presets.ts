import type {
	CompanionPresetDefinitions,
	CompanionPresetSection,
} from '@companion-module/base'
import {
	AUTO_ACTION_COOLDOWN_ACTIONS,
	FEEDBACK_SUPPORTED_SLIDERS,
	LIGHTROOM_ACTIONS,
	SLIDER_GROUPS,
	sliderLabel,
	sliderVariableId,
} from './choices.js'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'

const WHITE = 0xffffff

const ROTARY_TEXT_SIZE = 18
const BUTTON_TEXT_SIZE = 18
const RESET_TEXT_SIZE = 15
const ACTION_TEXT_SIZE = 17
const SWITCH_TEXT_SIZE = 13

const MINUS_BACKGROUND = 0x202428
const RESET_BACKGROUND = 0x59410f
const PLUS_BACKGROUND = 0x202428
const ROTARY_BASE_BACKGROUND = 0x24364a
const NEGATIVE_BACKGROUND = 0x7a2025
const POSITIVE_BACKGROUND = 0x174f7a

const AUTO_ACTION_BACKGROUND = 0x075985
const TOOL_ACTION_BACKGROUND = 0x273c75
const RESET_ACTION_BACKGROUND = 0x7a3700
const COOLDOWN_BACKGROUND = 0x9a5a00
const SWITCH_ON_BACKGROUND = 0x2a9d8f
const SWITCH_OFF_BACKGROUND = 0x174a4d


const SWITCH_CONTROLS = new Set<string>([
	'AutoLateralCA',
	'LensProfileEnable',
])

const SHORT_LABELS: Record<string, string> = {
	Exposure: 'EXP',
	Contrast: 'CNT',
	Highlights: 'HIL',
	Shadows: 'SHD',
	Whites: 'WHT',
	Blacks: 'BLK',

	Temperature: 'TMP',
	Tint: 'TNT',
	Vibrance: 'VIB',
	Saturation: 'SAT',

	Texture: 'TEX',
	Clarity: 'CLA',
	Dehaze: 'DEH',

	Sharpness: 'SHP',
	SharpenRadius: 'RAD',
	SharpenDetail: 'DET',
	SharpenEdgeMasking: 'MASK',

	LuminanceNR: 'LUM NR',
	LuminanceNoiseReductionDetail: 'LUM DET',
	LuminanceNoiseReductionContrast: 'LUM CNT',
	ColorNR: 'COL NR',
	ColorNoiseReductionDetail: 'COL DET',
	ColorNoiseReductionSmoothness: 'COL SMO',

	PostCropVignetteAmount: 'VIG AMT',
	PostCropVignetteMidpoint: 'VIG MID',
	PostCropVignetteFeather: 'VIG FEA',
	PostCropVignetteRoundness: 'VIG RND',
	PostCropVignetteHighlightContrast: 'VIG HIL',

	GrainAmount: 'GRN AMT',
	GrainSize: 'GRN SIZE',
	GrainFrequency: 'GRN RGH',

	ShadowTint: 'SHD TNT',
	RedHue: 'RED HUE',
	RedSaturation: 'RED SAT',
	GreenHue: 'GRN HUE',
	GreenSaturation: 'GRN SAT',
	BlueHue: 'BLU HUE',
	BlueSaturation: 'BLU SAT',

	LensProfileDistortionScale: 'PROF DST',
	LensProfileVignettingScale: 'PROF VIG',
	LensManualDistortionAmount: 'MAN DST',

	DefringePurpleAmount: 'PUR AMT',
	DefringePurpleHueLo: 'PUR LOW',
	DefringePurpleHueHi: 'PUR HIGH',
	DefringeGreenAmount: 'GRN AMT',
	DefringeGreenHueLo: 'GRN LOW',
	DefringeGreenHueHi: 'GRN HIGH',

	AutoLateralCA: 'AUTO CA',
	LensProfileEnable: 'PROFILE',

	PerspectiveVertical: 'VERT',
	PerspectiveHorizontal: 'HORIZ',
	PerspectiveRotate: 'ROTATE',
	PerspectiveScale: 'SCALE',
	PerspectiveAspect: 'ASPECT',
	PerspectiveX: 'X OFFSET',
	PerspectiveY: 'Y OFFSET',

	ParametricDarks: 'DARKS',
	ParametricLights: 'LIGHTS',
	ParametricShadows: 'SHADOWS',
	ParametricHighlights: 'HIGHLTS',
	ParametricShadowSplit: 'SHD SPLIT',
	ParametricMidtoneSplit: 'MID SPLIT',
	ParametricHighlightSplit: 'HIL SPLIT',
}

const ACTION_TEXT: Record<string, string> = {
	setAutoTone: 'AUTO\nTONE',
	setAutoWhiteBalance: 'AUTO\nWB',
	selectUprightTool: 'UPRIGHT\nTOOL',
	resetTransforms: 'RESET\nTRANSFORM',
	selectCropTool: 'CROP\nTOOL',
	resetCrop: 'RESET\nCROP',
	selectHealingTool: 'HEALING\nTOOL',
	resetSpotRemoval: 'RESET\nHEALING',
	selectRedEyeTool: 'RED EYE\nTOOL',
	resetRedeye: 'RESET\nRED EYE',
	selectMaskingTool: 'MASKING\nTOOL',
}

type PresetDefinition = NonNullable<
	CompanionPresetDefinitions<ModuleSchema>[string]
>

type PresetAction =
	| {
			actionId: 'adjust_slider'
			options: {
				slider: string
				amount: number
			}
	  }
	| {
			actionId: 'reset_slider'
			options: {
				slider: string
			}
	  }
	| {
			actionId: 'lightroom_action'
			options: {
				action: string
			}
	  }

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const structure: CompanionPresetSection<ModuleSchema>[] = []

	for (const group of SLIDER_GROUPS) {
		const numericSliders = group.sliders.filter(
			(slider) => !SWITCH_CONTROLS.has(slider)
		)

		if (numericSliders.length === 0) continue

		const groupId = safeId(group.name)
		const controlDefinitions: Array<{
			id: string
			name: string
			description: string
			type: 'simple'
			presets: string[]
		}> = []

		for (const slider of numericSliders) {
			const sliderId = safeId(slider)
			const short = shortLabel(slider)
			const full = sliderLabel(slider)

			const rotaryId = `${sliderId}_rotary`
			const minusId = `${sliderId}_minus`
			const resetId = `${sliderId}_reset`
			const plusId = `${sliderId}_plus`

			presets[rotaryId] = rotaryPreset(
				`${full} rotary control`,
				`⟳\n${short}\n$(this:${sliderVariableId(slider)})`,
				slider,
				ROTARY_BASE_BACKGROUND
			)

			presets[minusId] = pressPreset(
				`${full} decrease`,
				`${short}\n−`,
				MINUS_BACKGROUND,
				BUTTON_TEXT_SIZE,
				{
					actionId: 'adjust_slider',
					options: {
						slider,
						amount: -1,
					},
				}
			)

			presets[resetId] = pressPreset(
				`Reset ${full}`,
				`${short}\nRST`,
				RESET_BACKGROUND,
				RESET_TEXT_SIZE,
				{
					actionId: 'reset_slider',
					options: {
						slider,
					},
				}
			)

			presets[plusId] = pressPreset(
				`${full} increase`,
				`${short}\n+`,
				PLUS_BACKGROUND,
				BUTTON_TEXT_SIZE,
				{
					actionId: 'adjust_slider',
					options: {
						slider,
						amount: 1,
					},
				}
			)

			controlDefinitions.push({
				id: `${groupId}_${sliderId}`,
				name: `${full} (${short})`,
				description:
					`Rotary: turn left (-), turn right (+), press to reset. || Buttons: (-) decreases, RST resets, (+) increases. || Live value code: $(this:${sliderVariableId(slider)})`,
				type: 'simple',
				presets: [
					rotaryId,
					minusId,
					resetId,
					plusId,
				],
			})
		}

		structure.push({
			id: groupId,
			name: group.name,
			definitions: controlDefinitions,
		})
	}

	presets.lens_profile_on = switchValuePreset(
		'Enable Profile Corrections',
		'LENS\nON',
		'LensProfileEnable',
		1
	)

	presets.lens_profile_off = switchValuePreset(
		'Disable Profile Corrections',
		'LENS\nOFF',
		'LensProfileEnable',
		-1
	)

	presets.auto_lateral_ca_on = switchValuePreset(
		'Enable Remove Chromatic Aberration',
		'CA\nON',
		'AutoLateralCA',
		1
	)

	presets.auto_lateral_ca_off = switchValuePreset(
		'Disable Remove Chromatic Aberration',
		'CA\nOFF',
		'AutoLateralCA',
		-1
	)

	structure.push({
		id: 'switches_lens_defringe',
		name: 'Switches - Lens / Defringe',
		definitions: [
			{
				id: 'lens_defringe_switches',
				name: 'Checkbox controls',
				description:
					'Lightroom checkbox commands, not sliders. ON sends 1; OFF sends -1. These buttons do not currently show the real checkbox state from Lightroom.',
				type: 'simple',
				presets: [
					'lens_profile_on',
					'lens_profile_off',
					'auto_lateral_ca_on',
					'auto_lateral_ca_off',
				],
			},
		],
	})

	const actionPresetIds: string[] = []

	for (const action of LIGHTROOM_ACTIONS) {
		const presetId = `action_${safeId(action.id)}`

		presets[presetId] = pressPreset(
			action.label,
			ACTION_TEXT[action.id] ?? action.label.toUpperCase(),
			actionBackground(action.id),
			ACTION_TEXT_SIZE,
			{
				actionId: 'lightroom_action',
				options: {
					action: action.id,
				},
			}
		)

		actionPresetIds.push(presetId)
	}

	structure.push({
		id: 'lightroom_actions',
		name: 'Lightroom Actions',
		definitions: [
			{
				id: 'all_lightroom_actions',
				name: 'Tools and automatic actions',
				description: 'Direct Lightroom commands. Auto Tone and Auto White Balance show WAIT during the cooldown after slider changes.',
				type: 'simple',
				presets: actionPresetIds,
			},
		],
	})

	self.setPresetDefinitions(structure, presets)
}

function switchValuePreset(
	name: string,
	text: string,
	control: string,
	value: -1 | 1
): PresetDefinition {
	const enabled = value === 1

	return {
		type: 'simple',
		name,
		keywords: [
			'checkbox',
			'switch',
			'lens',
			'profile',
			'chromatic',
			enabled ? 'on' : 'off',
		],
		style: {
			text,
			size: SWITCH_TEXT_SIZE,
			color: WHITE,
			bgcolor: enabled ? SWITCH_ON_BACKGROUND : SWITCH_OFF_BACKGROUND,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'adjust_slider',
						options: {
							slider: control,
							amount: value,
						},
						headline: enabled
							? 'Lightroom checkbox command — sends 1 to enable it.'
							: 'Lightroom checkbox command — sends -1 to disable it.',
					},
				],
				up: [],
			},
		],
		feedbacks: [],
	} as PresetDefinition
}

function rotaryPreset(
	name: string,
	text: string,
	slider: string,
	bgcolor: number
): PresetDefinition {
	return {
		type: 'simple',
		name,
		style: {
			text,
			size: 'auto',
			color: WHITE,
			bgcolor,
			show_topbar: false,
		},
		steps: [
			{
				down: [
					{
						actionId: 'reset_slider',
						options: {
							slider,
						},
					},
				],
				up: [],
				rotate_left: [
					{
						actionId: 'adjust_slider',
						options: {
							slider,
							amount: -1,
						},
					},
				],
				rotate_right: [
					{
						actionId: 'adjust_slider',
						options: {
							slider,
							amount: 1,
						},
					},
				],
			},
		],
		feedbacks: sliderDirectionFeedbacks(slider),
	} as PresetDefinition
}

function pressPreset(
	name: string,
	text: string,
	bgcolor: number,
	size: number,
	action: PresetAction
): PresetDefinition {
	return {
		type: 'simple',
		name,
		style: {
			text,
			size,
			color: WHITE,
			bgcolor,
			show_topbar: false,
		},
		steps: [
			{
				down: [action],
				up: [],
			},
		],
		feedbacks: actionFeedbacks(action),
	} as PresetDefinition
}


type PresetFeedback =
	| {
			feedbackId: 'slider_value_compare'
			options: {
				slider: string
				operator: string
				value: number
			}
			style: {
				bgcolor: number
				color: number
			}
	  }
	| {
			feedbackId: 'auto_action_cooldown_active'
			options: Record<string, never>
			style: {
				bgcolor: number
				color: number
				text: string
			}
	  }

type FeedbackDirection = 'negative' | 'positive' | 'both'

const NON_ZERO_BASELINE_SLIDERS = new Set<string>([
	'Temperature',

	'Sharpness',
	'SharpenRadius',
	'SharpenDetail',
	'SharpenEdgeMasking',
	'LuminanceNR',
	'LuminanceNoiseReductionDetail',
	'LuminanceNoiseReductionContrast',
	'ColorNR',
	'ColorNoiseReductionDetail',
	'ColorNoiseReductionSmoothness',

	'GrayMixerRed',
	'GrayMixerOrange',
	'GrayMixerYellow',
	'GrayMixerGreen',
	'GrayMixerAqua',
	'GrayMixerBlue',
	'GrayMixerPurple',
	'GrayMixerMagenta',

	'PostCropVignetteMidpoint',
	'PostCropVignetteFeather',
	'GrainSize',
	'GrainFrequency',

	'LensProfileDistortionScale',
	'LensProfileVignettingScale',
	'DefringePurpleHueLo',
	'DefringePurpleHueHi',
	'DefringeGreenHueLo',
	'DefringeGreenHueHi',

	'PerspectiveScale',

	'ParametricShadowSplit',
	'ParametricMidtoneSplit',
	'ParametricHighlightSplit',
])

function actionFeedbacks(action: PresetAction): PresetFeedback[] {
	if (action.actionId === 'adjust_slider') {
		return sliderDirectionFeedbacks(
			action.options.slider,
			action.options.amount > 0 ? 'positive' : 'negative'
		)
	}

	if (
		action.actionId === 'lightroom_action' &&
		AUTO_ACTION_COOLDOWN_ACTIONS.includes(action.options.action)
	) {
		return [autoActionCooldownFeedback()]
	}

	return []
}

function autoActionCooldownFeedback(): PresetFeedback {
	return {
		feedbackId: 'auto_action_cooldown_active',
		options: {},
		style: {
			bgcolor: COOLDOWN_BACKGROUND,
			color: WHITE,
			text: 'WAIT\n$(this:auto_action_cooldown_remaining_s)s',
		},
	}
}

function sliderDirectionFeedbacks(
	slider: string,
	direction: FeedbackDirection = 'both'
): PresetFeedback[] {
	if (!supportsSignFeedback(slider)) {
		return []
	}

	const feedbacks: PresetFeedback[] = []

	if (direction === 'negative' || direction === 'both') {
		feedbacks.push(
			comparisonFeedback(slider, 'lt', NEGATIVE_BACKGROUND)
		)
	}

	if (direction === 'positive' || direction === 'both') {
		feedbacks.push(
			comparisonFeedback(slider, 'gt', POSITIVE_BACKGROUND)
		)
	}

	return feedbacks
}

function comparisonFeedback(
	slider: string,
	operator: 'lt' | 'gt',
	bgcolor: number
): PresetFeedback {
	return {
		feedbackId: 'slider_value_compare',
		options: {
			slider,
			operator,
			value: 0,
		},
		style: {
			bgcolor,
			color: WHITE,
		},
	}
}

function supportsSignFeedback(slider: string): boolean {
	return (
		FEEDBACK_SUPPORTED_SLIDERS.includes(slider) &&
		!NON_ZERO_BASELINE_SLIDERS.has(slider)
	)
}

function shortLabel(slider: string): string {
	const exact = SHORT_LABELS[slider]
	if (exact) return exact

	const hslMatch = slider.match(
		/^(Hue|Saturation|Luminance)Adjustment(Red|Orange|Yellow|Green|Aqua|Blue|Purple|Magenta)$/
	)

	if (hslMatch) {
		const type = hslMatch[1]
		const color = hslMatch[2]

		const typeLabel =
			type === 'Hue'
				? 'HUE'
				: type === 'Saturation'
					? 'SAT'
					: 'LUM'

		return `${typeLabel} ${colorCode(color)}`
	}

	const grayMatch = slider.match(
		/^GrayMixer(Red|Orange|Yellow|Green|Aqua|Blue|Purple|Magenta)$/
	)

	if (grayMatch) {
		return `B&W ${colorCode(grayMatch[1])}`
	}

	const words = sliderLabel(slider)
		.toUpperCase()
		.replace(/[^A-Z0-9&]+/g, ' ')
		.trim()
		.split(/\s+/)

	if (words.length === 1) {
		return words[0].slice(0, 8)
	}

	return words
		.map((word) => word.slice(0, 3))
		.join(' ')
		.slice(0, 11)
}

function colorCode(color: string): string {
	const codes: Record<string, string> = {
		Red: 'R',
		Orange: 'O',
		Yellow: 'Y',
		Green: 'G',
		Aqua: 'A',
		Blue: 'B',
		Purple: 'P',
		Magenta: 'M',
	}

	return codes[color] ?? color.slice(0, 1).toUpperCase()
}

function actionBackground(actionId: string): number {
	if (actionId.startsWith('reset')) {
		return RESET_ACTION_BACKGROUND
	}

	if (actionId.startsWith('setAuto')) {
		return AUTO_ACTION_BACKGROUND
	}

	return TOOL_ACTION_BACKGROUND
}

function safeId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
}
