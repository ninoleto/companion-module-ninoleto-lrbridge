import type {
	CompanionActionDefinitions,
	CompanionFeedbackDefinitions,
	CompanionPresetDefinitions,
	CompanionPresetSection,
} from '@companion-module/base'
import type ModuleInstance from './main.js'
import { layeredPreset } from './preset-graphics.js'
import {
	numericControls,
	buttonControls,
	numericById,
	buttonById,
	variableId,
	type Family,
} from './controller-catalog.js'
import { AUTO_ACTION_COOLDOWN_ACTIONS, FEEDBACK_SUPPORTED_SLIDERS, sliderVariableId } from './choices.js'

export type ControllerActions = {
	controller_numeric: {
		options: {
			control: string
			mode: string
			value: number
			numeric_automation_note?: string
			healing_wheel_note?: string
			numeric_favorites_setup?: string
		}
	}
	controller_button: {
		options: { control: string; confirmed: boolean; button_automation_note?: string; button_favorites_setup?: string }
	}
	controller_choose: { options: { kind: string; name: string } }
	controller_curve: {
		options: { masked: boolean; channel: string; operation: string; point: number; x: number; y: number }
	}
	controller_review: { options: { family: string; confirmed: boolean } }
	controller_crop: { options: { mode: string; width: number; height: number } }
	controller_range: { options: { masked: boolean; range: string; amount: number } }
	controller_favorite: {
		options: { operation: string; uuid: string; alias: string; amountEnabled: boolean; updateAISettings: boolean }
	}
}
export type ControllerFeedbacks = {
	controller_selected: { type: 'boolean'; options: { control: string } }
	controller_value: { type: 'boolean'; options: { control: string; condition: string; value: number } }
	controller_state: { type: 'boolean'; options: { family: string; condition: string } }
}
const numericChoices = numericControls.map((c) => ({ id: c.id, label: `${c.group} · ${c.label}` }))
const buttonChoices = buttonControls
	.filter((c) => !c.hiddenChoice)
	.map((c) => ({ id: c.id, label: `${c.group} · ${c.label}` }))
const familyChoices = [...new Set([...numericControls, ...buttonControls].map((c) => c.family))]
	.filter((f) => !['native', 'command'].includes(f))
	.map((f) => ({ id: f, label: f }))
const automationWarning =
	'🔴 Windows automation — may be unreliable. Use the control directly in Lightroom, or, where a suitable keyboard shortcut exists, trigger it from Companion using VICREO Listener. Separate setup is required.'
const healingWheelNote =
	'If Healing brush Size / Feather causes cursor flicker, use Lightroom directly. Optional workaround: VICREO Listener mouse wheel for Size, Shift + mouse wheel for Feather, with the Healing tool active and the pointer over the photo. Separate setup is required.'
const favoritesSetupNote =
	'Setup required: Configure your favorite Lightroom presets in the LRBridge Web Controller before using favorite preset controls in Companion.'
const cooldownNote =
	'Waiting for Lightroom to finish the previous adjustment. Auto Tone, Auto White Balance, Color and B&W become available when the countdown ends. Each slider adjustment restarts the countdown.'
const numericAutomationIds = numericControls.filter((c) => c.id.startsWith('blur_brush_')).map((c) => c.id)
const buttonAutomationIds = buttonControls
	.filter(
		(c) =>
			(c.family === 'lens-blur' && (c.group === 'Lens Blur · Refinement' || c.path === '/lens-blur/focus-action')) ||
			c.path === '/remove/selection',
	)
	.map((c) => c.id)

export function controllerActions(self: ModuleInstance): CompanionActionDefinitions<ControllerActions> {
	const run = async (work: () => Promise<void>) => {
		try {
			await work()
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e)
			self.log('warn', error)
			self.setVariableValues({ controller_error: error })
		}
	}
	return {
		controller_favorite: {
			name: 'Presets · Add / update / remove favorite',
			description: `${favoritesSetupNote} Updates the same Favorites list; other favorites are preserved.`,
			options: [
				{
					id: 'operation',
					type: 'dropdown',
					label: 'Operation',
					default: 'add',
					choices: ['add', 'update', 'remove'].map((id) => ({ id, label: id })),
				},
				{ id: 'uuid', type: 'textinput', label: 'Exact unique preset name or UUID', default: '' },
				{ id: 'alias', type: 'textinput', label: 'Favorite label (optional)', default: '' },
				{ id: 'amountEnabled', type: 'checkbox', label: 'Enable Preset Amount', default: false },
				{ id: 'updateAISettings', type: 'checkbox', label: 'Update AI settings after applying', default: false },
			],
			callback: (e) =>
				run(() =>
					self.controller.favorite(
						e.options.operation as 'add' | 'remove' | 'update',
						e.options.uuid,
						e.options.alias,
						e.options.amountEnabled,
						e.options.updateAISettings,
					),
				),
		},
		controller_range: {
			name: 'Point Color · Shift whole range',
			options: [
				{ id: 'masked', type: 'checkbox', label: 'Selected mask Point Color', default: false },
				{
					id: 'range',
					type: 'dropdown',
					label: 'Range',
					default: 'HueRange',
					choices: ['HueRange', 'SatRange', 'LumRange'].map((id) => ({ id, label: id })),
				},
				{
					id: 'amount',
					type: 'number',
					label: 'Shift in displayed units (0–100 scale)',
					default: 1,
					min: -100,
					max: 100,
					step: 1,
				},
			],
			optionsToMonitorForSubscribe: ['masked'],
			subscribe: (e) => self.controller.watch(e.id, e.options.masked ? 'mask-point-color' : 'point-color'),
			unsubscribe: (e) => self.controller.unwatch(e.id),
			callback: (e) => run(() => self.controller.translateRange(e.options.masked, e.options.range, e.options.amount)),
		},
		controller_crop: {
			name: 'Crop · Custom aspect / angle',
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Operation',
					default: 'custom',
					choices: [
						{ id: 'custom', label: 'Custom aspect ratio' },
						{ id: 'angle', label: 'Set angle' },
						{ id: 'reset-angle', label: 'Reset angle' },
					],
				},
				{
					id: 'width',
					type: 'number',
					label: 'Width (aspect) or angle in degrees',
					default: 16,
					min: -45,
					max: 10000,
					step: 0.01,
				},
				{ id: 'height', type: 'number', label: 'Height (aspect)', default: 9, min: 1, max: 10000 },
			],
			callback: (e) => run(() => self.controller.crop(e.options.mode, e.options.width, e.options.height)),
		},
		controller_numeric: {
			name: 'Web Controller · Slider / numeric control',
			description:
				'Fine steps match the Web Controller ± buttons (Exposure 0.1, Contrast 1). Legacy steps retain Adobe SDK increments for ordinary sliders. Use a step count of 1 or -1 for buttons/encoders.',
			options: [
				{ id: 'control', type: 'dropdown', label: 'Control', choices: numericChoices, default: 'Exposure' },
				{
					id: 'numeric_automation_note',
					type: 'static-text',
					label: '🔴 Lens Blur refinement warning',
					value: `**Lens Blur brush Amount, Size, Feather and Flow only:** ${automationWarning}`,
				},
				{
					id: 'healing_wheel_note',
					type: 'static-text',
					label: 'Healing brush Size / Feather',
					value: healingWheelNote,
				},
				{ id: 'numeric_favorites_setup', type: 'static-text', label: 'Preset Amount setup', value: favoritesSetupNote },
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Operation',
					default: 'fine',
					choices: [
						{ id: 'fine', label: 'Fine steps (Web Controller ±)' },
						{ id: 'adjust', label: 'Legacy steps (Adobe SDK for ordinary sliders)' },
						{ id: 'set', label: 'Set displayed value' },
						{ id: 'reset', label: 'Reset' },
					],
				},
				{
					id: 'value',
					type: 'number',
					label: 'Step count (Fine / Legacy) or displayed value (Set)',
					default: 1,
					min: -1000000,
					max: 1000000,
					step: 0.01,
				},
			],
			optionsToMonitorForSubscribe: ['control'],
			subscribe: (e) => {
				const c = numericById.get(e.options.control)
				if (c) self.controller.watch(e.id, c.family, c.id)
			},
			unsubscribe: (e) => self.controller.unwatch(e.id),
			callback: (e) =>
				run(() =>
					self.controller.numeric(
						e.options.control,
						e.options.mode as 'set' | 'adjust' | 'reset' | 'fine',
						Number(e.options.value),
					),
				),
		},
		controller_button: {
			name: 'Web Controller · Button / switch',
			description:
				'IMPORTANT: For Delete and Reset All actions, enable Allow destructive action in the Companion press action settings. Otherwise, the command will not execute. Lens Blur Subject/Point-area focus and brush refinement use Windows automation; see module Help.',
			options: [
				{
					id: 'control',
					type: 'dropdown',
					label: 'Control',
					choices: buttonChoices,
					default: 'develop.action_setAutoTone',
				},
				{
					id: 'button_automation_note',
					type: 'static-text',
					label: '🔴 Windows automation warning',
					value: `**Applies to Lens Blur Subject/Point-area focus, refinement mode/open/close/reset and Auto Mask; Healing Selected Remove / Cancel (and legacy Selected Add / Subtract).** ${automationWarning}`,
				},
				{
					id: 'button_favorites_setup',
					type: 'static-text',
					label: 'Favorite preset setup',
					value: favoritesSetupNote,
				},
				{ id: 'confirmed', type: 'checkbox', label: 'Allow destructive action (delete/reset all)', default: false },
			],
			optionsToMonitorForSubscribe: ['control'],
			subscribe: (e) => {
				const c = buttonById.get(e.options.control)
				if (c) self.controller.watch(e.id, c.family, c.id)
			},
			unsubscribe: (e) => self.controller.unwatch(e.id),
			callback: (e) => run(() => self.controller.button(e.options.control, e.options.confirmed)),
		},
		controller_choose: {
			name: 'Web Controller · Apply profile / preset',
			description:
				'Use the exact unique name or UUID. The current inventory is checked before sending; missing or ambiguous names are rejected.',
			options: [
				{
					id: 'kind',
					type: 'dropdown',
					label: 'Choice',
					default: 'preset',
					choices: [
						{ id: 'preset', label: 'Develop preset' },
						{ id: 'profile', label: 'Profile' },
						{ id: 'mask-preset', label: 'Masking preset' },
					],
				},
				{ id: 'name', type: 'textinput', label: 'Name or UUID', default: '', useVariables: true },
			],
			callback: (e) =>
				run(() => self.controller.choose(e.options.kind as 'profile' | 'preset' | 'mask-preset', e.options.name)),
		},
		controller_curve: {
			name: 'Web Controller · Edit Point Curve',
			description:
				'Point numbers start at 1 from left to right. Input and output are 0–255. Existing native endpoints are preserved; select an interior point to delete.',
			options: [
				{ id: 'masked', type: 'checkbox', label: 'Selected mask curve', default: false },
				{
					id: 'channel',
					type: 'dropdown',
					label: 'Channel',
					default: 'rgb',
					choices: ['rgb', 'red', 'green', 'blue'].map((id) => ({ id, label: id.toUpperCase() })),
				},
				{
					id: 'operation',
					type: 'dropdown',
					label: 'Edit',
					default: 'add',
					choices: ['add', 'move', 'delete'].map((id) => ({ id, label: id })),
				},
				{ id: 'point', type: 'number', label: 'Point number (move/delete)', default: 2, min: 1, max: 64 },
				{ id: 'x', type: 'number', label: 'Input', default: 128, min: 0, max: 255, step: 1 },
				{ id: 'y', type: 'number', label: 'Output', default: 128, min: 0, max: 255, step: 1 },
			],
			optionsToMonitorForSubscribe: ['masked'],
			subscribe: (e) => self.controller.watch(e.id, e.options.masked ? 'mask-curve' : 'curve'),
			unsubscribe: (e) => self.controller.unwatch(e.id),
			callback: (e) =>
				run(() =>
					self.controller.curve(
						e.options.masked,
						e.options.channel,
						e.options.operation as 'add' | 'move' | 'delete',
						e.options.point,
						e.options.x,
						e.options.y,
					),
				),
		},
		controller_review: {
			name: 'Copy/Paste or Export · Acknowledge reviewed result',
			description: 'Use only after inspecting Lightroom. Does not send the original action again.',
			options: [
				{
					id: 'family',
					type: 'dropdown',
					label: 'Workflow',
					default: 'clipboard',
					choices: [
						{ id: 'clipboard', label: 'Copy/Paste' },
						{ id: 'export', label: 'Export' },
					],
				},
				{ id: 'confirmed', type: 'checkbox', label: 'I have checked the result in Lightroom', default: false },
			],
			callback: (e) =>
				run(async () => {
					if (!e.options.confirmed) throw new Error('Review Lightroom first')
					await self.controller.acknowledge(e.options.family as 'clipboard' | 'export')
				}),
		},
	}
}
export function controllerFeedbacks(self: ModuleInstance): CompanionFeedbackDefinitions<ControllerFeedbacks> {
	return {
		controller_selected: {
			type: 'boolean',
			name: 'Web Controller · Button is selected',
			description:
				'Only authoritative states exposed by LRBridge are shown. Command-only tools do not pretend to have active-state feedback.',
			defaultStyle: { bgcolor: 0x287250, color: 0xffffff },
			options: [
				{ id: 'control', type: 'dropdown', label: 'Button', choices: buttonChoices, default: 'point-color_swatch_1' },
			],
			unsubscribe: (e) => self.controller.unwatch(e.id),
			callback: (e) => {
				const c = buttonById.get(e.options.control)
				if (!c) return false
				self.controller.watch(e.id, c.family, c.id)
				const s = self.controller.snapshots.get(c.family)
				if (!s || s.available === false || s.contextOwned === false) return false
				const p = c.params,
					leaf = c.path.split('/').at(-1)
				if (leaf === 'sample')
					return (c.family === 'mask-point-color' ? s.pointColor?.selectedIndex : s.selectedIndex) === p.selectedIndex
				if (c.family === 'grading' && p.command === 'color_grading.view.set')
					return s.view?.available === true && s.view.value === p.view
				if (c.family === 'categorical') {
					const key = (
						{
							'white-balance': 'whiteBalance',
							process: 'process',
							'vignette-style': 'vignetteStyle',
							'upright-mode': 'uprightMode',
							'constrain-crop': 'constrainCrop',
							'upright-tool': 'selectedTool',
						} as Record<string, string>
					)[leaf!]
					return !!key && s[key + 'Available'] === true && s[key] === (p.value ?? p.target)
				}
				if (c.family === 'enhance') {
					const key = c.path.includes('denoise')
						? 'denoiseState'
						: c.path.includes('raw-details')
							? 'rawDetailsState'
							: 'superResState'
					return s.available === true && s[key] === p.enabled
				}
				if (c.family === 'lens-blur' || c.family === 'lens-blur-sdk') {
					if (leaf === 'bokeh') return s.bokehAvailable === true && s.bokeh === p.value
					if (leaf === 'apply') return s.activeAvailable === true && s.active === p.enabled
					if (c.path.includes('/depth-refinement/'))
						return (
							s.selectedToolAvailable === true &&
							(leaf === 'select' ? s.selectedTool === 'depth_refinement' : s.selectedTool !== 'depth_refinement')
						)
					const field = (
							{
								'visualize-depth': 'visualizeDepth',
								'auto-mask': 'autoMask',
								'refinement-disclosure': 'refinementDisclosure',
							} as Record<string, string>
						)[leaf!],
						v = s.windowsNative?.[field]
					if (field) return v?.available === true && v.value === (p.enabled ?? p.open)
					if (leaf === 'refinement-mode') return s.windowsNative?.refinementMode === p.value
				}
				if (c.family === 'remove') {
					if (p.field === 'dustApply') return s.dust?.available === true && s.dust.applied === p.value
					if (p.field === 'selectedRepairFill') return s.repair?.selected === true && s.repair.spotType === p.value
					return p.field !== 'selectedSelection' && s[String(p.field)] !== undefined && s[String(p.field)] === p.value
				}
				if (c.family === 'reflections') return s[String(p.field)] === p.value
				if (c.family === 'masking' && leaf === 'panel') return s.active === p.open
				return false
			},
		},
		controller_value: {
			type: 'boolean',
			name: 'Web Controller · Value or availability',
			defaultStyle: { bgcolor: 0x24645d, color: 0xffffff },
			options: [
				{ id: 'control', type: 'dropdown', label: 'Control', choices: numericChoices, default: 'point-color_HueShift' },
				{
					id: 'condition',
					type: 'dropdown',
					label: 'Condition',
					default: 'available',
					choices: ['available', 'unavailable', 'equals', 'above', 'below'].map((id) => ({ id, label: id })),
				},
				{ id: 'value', type: 'number', label: 'Comparison value', default: 0, min: -1000000, max: 1000000 },
			],
			unsubscribe: (e) => self.controller.unwatch(e.id),
			callback: (e) => {
				const watched = numericById.get(e.options.control)
				if (watched) self.controller.watch(e.id, watched.family, watched.id)
				const c = numericById.get(e.options.control),
					saved = self.controller.numericValues.get(e.options.control),
					native = c?.family === 'native' ? self.getSliderNumericValue(c.field) : undefined
				const value =
					c?.family === 'native' && FEEDBACK_SUPPORTED_SLIDERS.includes(c.field)
						? native
						: saved?.available
							? saved.value
							: undefined
				switch (e.options.condition) {
					case 'available':
						return value !== undefined
					case 'unavailable':
						return value === undefined
					case 'equals':
						return value !== undefined && Math.abs(value - e.options.value) < 0.00001
					case 'above':
						return value !== undefined && value > e.options.value
					case 'below':
						return value !== undefined && value < e.options.value
					default:
						return false
				}
			},
		},
		controller_state: {
			type: 'boolean',
			name: 'Web Controller · Section ready / busy',
			defaultStyle: { bgcolor: 0x7a5118, color: 0xffffff },
			options: [
				{ id: 'family', type: 'dropdown', label: 'Section', choices: familyChoices, default: 'masking' },
				{
					id: 'condition',
					type: 'dropdown',
					label: 'Condition',
					default: 'busy',
					choices: [
						{ id: 'busy', label: 'Command pending' },
						{ id: 'available', label: 'Section available' },
						{ id: 'review', label: 'Result needs review' },
					],
				},
			],
			unsubscribe: (e) => self.controller.unwatch(e.id),
			callback: (e) => {
				self.controller.watch(e.id, e.options.family as Family)
				const s = self.controller.snapshots.get(e.options.family as Family)
				if (e.options.condition === 'busy')
					return self.controller.isPending(e.options.family as Family) || Boolean(s?.pendingOperation)
				if (e.options.condition === 'review') return s?.needsReview === true
				return s?.available === true
			},
		},
	}
}
export function controllerVariables() {
	return {
		controller_status: { name: 'Last expanded Controller action status' },
		controller_error: { name: 'Last expanded Controller action error' },
		controller_profile: { name: 'Current Lightroom profile' },
		controller_preset: { name: 'Current preset UUID' },
		controller_point_color_swatch: { name: 'Point Color selected swatch' },
		controller_mask_point_color_swatch: { name: 'Mask Point Color selected swatch' },
		...Object.fromEntries(
			numericControls.map((c) => [variableId(c.id), { name: `${c.group} · ${c.label} (confirmed)` }]),
		),
	}
}
export function publishControllerValues(self: ModuleInstance) {
	if (!self.controller) return
	const values: Record<string, string> = {
		controller_status: self.controller.lastStatus,
		controller_error: self.controller.lastError,
		controller_profile: String(self.controller.snapshots.get('categorical')?.profile?.selectedLabel ?? ''),
		controller_preset: String(self.controller.snapshots.get('develop-presets')?.cursorUuid ?? ''),
		controller_point_color_swatch: String(self.controller.snapshots.get('point-color')?.selectedIndex ?? ''),
		controller_mask_point_color_swatch: String(
			self.controller.snapshots.get('mask-point-color')?.pointColor?.selectedIndex ?? '',
		),
	}
	for (const c of numericControls) {
		const v = self.controller.numericValues.get(c.id)
		const value =
			c.family === 'native' && FEEDBACK_SUPPORTED_SLIDERS.includes(c.field)
				? self.getSliderNumericValue(c.field)
				: v?.available
					? v.value
					: undefined
		values[variableId(c.id)] = value !== undefined ? String(Number(value.toFixed(4))) : ''
	}
	self.setVariableValues(values)
	self.checkFeedbacks('controller_value', 'controller_state', 'controller_selected')
}
export function appendControllerPresets(
	self: ModuleInstance,
	structure: CompanionPresetSection[],
	presets: CompanionPresetDefinitions<any>,
) {
	const groupAliases: Record<string, string> = {
		'Develop · white-balance': 'Color',
		'Develop · process': 'Calibration',
		'Develop · vignette-style': 'Effects',
		'Develop · upright-mode': 'Transform',
		'Lens Blur · Bokeh': 'Lens Blur',
	}
	const groupOrder = [
		'Develop actions',
		'Profile',
		'Basic',
		'Color',
		'HDR / SDR Rendition',
		'Presence',
		'Tone Curve',
		'Color Mixer / HSL',
		'B&W Mixer',
		'Point Color',
		'Point Color · Ranges',
		'Color Grading',
		'Detail',
		'Enhance',
		'Lens / Defringe',
		'Transform',
		'Lens Blur',
		'Lens Blur · Refinement',
		'Effects',
		'Calibration',
		'Crop',
		'Masking',
		'Masking · Create Mask',
		'Masking · Add Component',
		'Masking · Subtract Component',
		'Masking · Amount',
		'Masking · Tone',
		'Masking · Color',
		'Masking · Point Color',
		'Masking · Point Color · Ranges',
		'Masking · Tone Curve',
		'Masking · Detail',
		'Masking · Effects',
		'Healing / Dust',
		'Reflections',
		'People Removal',
		'Red Eye',
		'Presets',
		'Photo',
		'Selection',
		'Copy / Paste Settings',
		'Export',
		'History',
		'Application · Modules',
		'Application · Library Views',
		'Application · Develop Views',
		'Application · Zoom',
		'Application · Screen',
		'Application · Secondary Display',
	]
	const palette = {
		base: 0x24364a,
		active: 0x174f7a,
		negative: 0x9a4f16,
		on: 0x24645d,
		onActive: 0x287250,
		off: 0x651f23,
		delete: 0x8b1e2d,
		reset: 0x59410f,
	}
	// Label layout is shared by all presets; layeredPreset applies the exact
	// Companion 5 font cap and shrink setting at the preset boundary.
	const textSize = 'auto' as const
	const wrapLabel = (label: string, width = 10) => {
		const lines = ['']
		for (const word of label.split(/\s+/)) {
			const last = lines.length - 1
			if (lines[last] && lines[last].length + word.length + 1 > width) lines.push(word)
			else lines[last] += `${lines[last] ? ' ' : ''}${word}`
		}
		return lines.join('\n')
	}
	const numericLabel = (label: string, group: string, prefix: string, variable: string) => {
		const curve = group === 'Tone Curve' || group === 'Masking · Tone Curve'
		const bounded = curve || label.length > 20
		const compact = curve
			? label.replace(/^Curve /, '').replace('Refine Saturation', 'Refine Sat.')
			: bounded
				? label
						.replace(/Luminance/g, 'Lum.')
						.replace(/Noise Reduction/g, 'NR')
						.replace('Manual Lens ', 'Manual ')
						.replace('Vignetting', 'Vignette')
						.replace(/selected Repair/i, 'Repair')
				: label
		return {
			text: `${bounded ? wrapLabel(`${prefix} ${compact}`) : `${prefix} ${compact}`}\n$(${self.label}:${variable})`,
			size: textSize,
		}
	}
	const buttonLabel = (label: string, family: Family) => {
		if (family === 'curve' || family === 'mask-curve') {
			const reset = /^Reset (RGB|RED|GREEN|BLUE) curve$/.exec(label)
			if (reset) return { text: `Reset\n${reset[1]}\ncurve`, size: textSize }
			return { text: label.replace(' ', '\n'), size: textSize }
		}
		if (label.length > 18)
			return { text: wrapLabel(label.replace(/super-resolution/i, 'Super Resolution')), size: textSize }
		return { text: label, size: textSize }
	}
	const valueFeedback = (id: string, sign: 'both' | 'minus' | 'plus' | 'none' = 'both') => [
		...(sign === 'both' || sign === 'minus'
			? [
					{
						feedbackId: 'controller_value',
						options: { control: id, condition: 'below', value: 0 },
						style: { bgcolor: palette.negative },
					},
				]
			: []),
		...(sign === 'both' || sign === 'plus'
			? [
					{
						feedbackId: 'controller_value',
						options: { control: id, condition: 'above', value: 0 },
						style: { bgcolor: palette.active },
					},
				]
			: []),
		{
			feedbackId: 'controller_value',
			options: { control: id, condition: 'unavailable', value: 0 },
			style: { bgcolor: 0x333333, color: 0x999999 },
		},
	]
	const groups = new Map<string, { sliders: string[]; buttons: string[] }>()
	const add = (group: string, id: string, p: any, kind: 'sliders' | 'buttons' = 'buttons') => {
		group = groupAliases[group] ?? group
		presets[id] = layeredPreset(p)
		if (!groups.has(group)) groups.set(group, { sliders: [], buttons: [] })
		groups.get(group)![kind].push(id)
	}
	for (const c of numericControls) {
		const variable =
			c.family === 'native' && self.getFeedbackSliderChoices().some((v) => v.id === c.field)
				? sliderVariableId(c.field)
				: variableId(c.id)
		const numericNote = numericAutomationIds.includes(c.id)
			? automationWarning
			: ['remove_brushSize', 'remove_brushFeather'].includes(c.id)
				? healingWheelNote
				: c.id === 'preset_amount'
					? favoritesSetupNote
					: undefined
		const action = (mode: string, value: number) => ({
			actionId: 'controller_numeric',
			options: { control: c.id, mode, value },
			...(numericNote ? { headline: numericNote } : {}),
		})
		if (c.family === 'native' && c.max - c.min === 1) {
			for (const value of [0, 1])
				add(c.group, `wc_${c.id}_${value}`, {
					type: 'simple',
					name: `${c.label} ${value ? 'On' : 'Off'}`,
					style: {
						text: `${c.label}\n${value ? 'On' : 'Off'}`,
						size: textSize,
						color: 0xffffff,
						bgcolor: value ? palette.on : palette.off,
					},
					steps: [{ down: [action('set', value)], up: [] }],
					feedbacks: [
						{
							feedbackId: 'controller_value',
							options: { control: c.id, condition: 'equals', value },
							style: { bgcolor: value ? palette.onActive : palette.off },
						},
						...valueFeedback(c.id, 'none'),
					],
				})
			continue
		}
		add(
			c.group,
			`wc_${c.id}_rotary`,
			{
				type: 'simple',
				name: `${c.label} rotary (step ${c.webStep ?? c.step})`,
				style: { ...numericLabel(c.label, c.group, '⟳', variable), color: 0xffffff, bgcolor: palette.base },
				steps: [
					{
						down: c.reset === undefined ? [] : [action('reset', 0)],
						up: [],
						rotate_left: [action('fine', -1)],
						rotate_right: [action('fine', 1)],
					},
				],
				feedbacks: valueFeedback(c.id),
			},
			'sliders',
		)
		for (const [suffix, mode, value] of [
			['minus', 'fine', -1],
			...(c.reset === undefined ? [] : [['reset', 'reset', 0]]),
			['plus', 'fine', 1],
		] as [string, string, number][]) {
			add(
				c.group,
				`wc_${c.id}_${suffix}`,
				{
					type: 'simple',
					name: `${c.label} ${suffix}${suffix === 'reset' ? '' : ` (step ${c.webStep ?? c.step})`}`,
					style: {
						...numericLabel(c.label, c.group, suffix === 'minus' ? '−' : suffix === 'plus' ? '+' : 'Reset', variable),
						color: 0xffffff,
						bgcolor: suffix === 'reset' ? palette.reset : 0x202428,
					},
					steps: [{ down: [action(mode, value)], up: [] }],
					feedbacks: valueFeedback(c.id, suffix === 'reset' ? 'none' : suffix === 'minus' ? 'minus' : 'plus'),
				},
				'sliders',
			)
		}
	}
	for (const masked of [false, true]) {
		const family = masked ? 'mask-point-color' : 'point-color'
		const group = `${masked ? 'Masking · ' : ''}Point Color · Ranges`
		for (const [range, title] of [
			['HueRange', 'Hue'],
			['SatRange', 'Saturation'],
			['LumRange', 'Luminance'],
		]) {
			const controls = ['LowerNone', 'LowerFull', 'UpperFull', 'UpperNone'].map(
				(field) => `${family}_${range}_${field}`,
			)
			const values = controls.map((id) => `$(${self.label}:${variableId(id)})`)
			add(group, `wc_${family}_${range}_overview`, {
				type: 'simple',
				name: `${title} range overview (read-only)`,
				style: {
					text: `${title} range\n${values[0]} / ${values[1]}\n${values[2]} / ${values[3]}`,
					size: textSize,
					color: 0xffffff,
					bgcolor: palette.base,
				},
				steps: [{ down: [], up: [] }],
				feedbacks: controls.flatMap((id) => valueFeedback(id, 'none')),
			})
		}
	}
	for (const c of buttonControls.filter((c) => !c.hiddenPreset)) {
		const needsCooldown =
				c.params.command === 'photo.treatment' ||
				(c.params.command === 'develop.action' && AUTO_ACTION_COOLDOWN_ACTIONS.includes(String(c.params.action))),
			isDelete = /^Delete\b/i.test(c.label),
			isReset = /^Reset\b/i.test(c.label),
			isOff = /\bOff$/.test(c.label) || /^Close\b/.test(c.label),
			isOn = /\bOn$/.test(c.label),
			base = isDelete
				? palette.delete
				: isReset
					? palette.reset
					: isOff
						? palette.off
						: isOn
							? palette.on
							: palette.base,
			active = isDelete || isReset || isOff ? base : isOn ? palette.onActive : palette.active,
			permissionNote = c.confirm
				? 'IMPORTANT: Enable “Allow destructive action” in the Companion press action settings. Otherwise, this command will not execute.'
				: undefined,
			automationNote = buttonAutomationIds.includes(c.id) ? automationWarning : undefined,
			setupNote = c.path === '/develop-presets/navigate' ? favoritesSetupNote : undefined,
			actionNote = [permissionNote, automationNote, setupNote, needsCooldown ? cooldownNote : undefined]
				.filter(Boolean)
				.join(' ')
		add(c.group, `wc_${c.id}`, {
			type: 'simple',
			name: c.confirm ? `${c.label} — enable permission in action` : c.label,
			style: { ...buttonLabel(c.label, c.family), color: 0xffffff, bgcolor: base },
			steps: [
				{
					down: [
						{
							actionId: 'controller_button',
							options: { control: c.id, confirmed: false },
							...(actionNote ? { headline: actionNote } : {}),
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{ feedbackId: 'controller_selected', options: { control: c.id }, style: { bgcolor: active } },
				// Keep this last so a selected-state colour cannot hide the wait state.
				...(needsCooldown
					? [
							{
								feedbackId: 'auto_action_cooldown_active',
								options: {},
								style: {
									text: `WAIT\n$(${self.label}:auto_action_cooldown_remaining_s)s`,
									bgcolor: 0xffaa00,
									color: 0x000000,
								},
							},
						]
					: []),
			],
		})
	}
	add(
		'Application · Zoom',
		'wc_application_zoom_rotary',
		{
			type: 'simple',
			name: 'Zoom rotary — turn to zoom, press Fit / zoom toggle',
			style: { text: '⟳ Zoom\nFit / Zoom', size: textSize, color: 0xffffff, bgcolor: palette.base },
			steps: [
				{
					down: [
						{
							actionId: 'controller_button',
							options: { control: 'application.action_toggle_zoom', confirmed: false },
							headline:
								'Press toggles between zoomed in and Lightroom Navigator’s zoomed-out setting (Fit or Fill). Select Fit in Navigator to return to Fit; pressing again while fitted zooms in.',
						},
					],
					up: [],
					rotate_left: [
						{ actionId: 'controller_button', options: { control: 'application.action_zoom_out', confirmed: false } },
					],
					rotate_right: [
						{ actionId: 'controller_button', options: { control: 'application.action_zoom_in', confirmed: false } },
					],
				},
			],
			feedbacks: [],
		},
		'sliders',
	)
	const developOrder = [
		'wc_develop.action_resetAllDevelopAdjustments',
		'wc_develop.action_setAutoTone',
		'wc_photo.treatment_color',
		'wc_photo.treatment_grayscale',
		'wc_develop.action_setAutoWhiteBalance',
	]
	groups.get('Develop actions')?.buttons.sort((a, b) => developOrder.indexOf(a) - developOrder.indexOf(b))
	const rank = (name: string) => (groupOrder.includes(name) ? groupOrder.indexOf(name) : groupOrder.length)
	for (const [group, ids] of [...groups].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))) {
		const notes = [
			...(group === 'Develop actions' ? [cooldownNote] : []),
			...(group === 'Lens Blur'
				? [
						`Subject/Point-area focus: ${automationWarning} Numeric Focus Range is available in the LRBridge Web Controller only.`,
					]
				: []),
			...(group === 'Lens Blur · Refinement' ? [automationWarning] : []),
			...(group === 'Healing / Dust' ? [`Selected Remove / Cancel: ${automationWarning}`, healingWheelNote] : []),
			...(group === 'Presets' ? [favoritesSetupNote] : []),
			...(group.endsWith('Point Color · Ranges')
				? [
						'Range overview buttons show all four confirmed boundaries on a 0–100 scale: lower outer / lower inner, then upper inner / upper outer. Select a Point Color swatch first. Overview buttons are read-only; use the adjacent boundary controls to adjust values.',
					]
				: []),
			...(ids.buttons.some((id) => buttonById.get(id.slice(3))?.confirm)
				? [
						'IMPORTANT: For Delete and Reset All actions, enable “Allow destructive action” in the Companion press action settings. Otherwise, the command will not execute.',
					]
				: []),
		]
		structure.push({
			id: `wc_${group.replace(/[^\w]/g, '_')}`,
			name: group,
			...(notes.length ? { description: notes.join(' ') } : {}),
			definitions: [
				{
					id: `wc_defs_${group.replace(/[^\w]/g, '_')}`,
					name: group,
					type: 'simple',
					presets: [...ids.sliders, ...ids.buttons],
				},
			],
		})
	}
}
