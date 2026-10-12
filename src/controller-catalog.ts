import source from './beta4-data.json' with { type: 'json' }

export const reference = source
export type Params = Record<string, string | number | boolean>
export type Family =
	| 'native'
	| 'grading'
	| 'point-color'
	| 'masking'
	| 'mask-point-color'
	| 'curve'
	| 'mask-curve'
	| 'mask-global'
	| 'crop'
	| 'lens-blur'
	| 'lens-blur-sdk'
	| 'enhance'
	| 'remove'
	| 'reflections'
	| 'people'
	| 'red-eye'
	| 'develop-presets'
	| 'categorical'
	| 'clipboard'
	| 'export'
	| 'history'
	| 'command'
export interface NumericControl {
	id: string
	label: string
	group: string
	family: Family
	field: string
	min: number
	max: number
	step: number
	webStep?: number
	reset?: number
	nativeAdjust?: boolean
	region?: string
	range?: string
	scale?: number
}
export interface ButtonControl {
	id: string
	label: string
	group: string
	family: Family
	path: string
	params: Params
	scope?: 'group' | 'tool' | 'point' | 'curve' | 'repair' | 'selection'
	confirm?: boolean
	/** Keep an existing action ID callable while omitting duplicate/retired templates. */
	hiddenPreset?: boolean
	/** Retired actions stay addressable by old buttons, but are not offered for new actions. */
	hiddenChoice?: boolean
}
export const numericControls: NumericControl[] = []
export const buttonControls: ButtonControl[] = []
const num = (c: NumericControl) => numericControls.push(c)
const button = (
	id: string,
	label: string,
	group: string,
	family: Family,
	path: string,
	params: Params = {},
	extra: Partial<ButtonControl> = {},
) => buttonControls.push({ id, label, group, family, path, params, ...extra })
const label = (s: string) => s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')

for (const s of source.sliders) {
	const m = s as typeof s & {
		adjustSupported?: boolean
		resetSupported?: boolean
		numericStep?: number
		default?: number
	}
	num({
		id: s.id,
		label: s.label,
		group: s.group,
		family: 'native',
		field: s.id,
		min: s.min,
		max: s.max,
		step: m.numericStep || 1,
		webStep: s.rangeStep,
		nativeAdjust: m.adjustSupported !== false,
		...(m.resetSupported === false ? {} : { reset: m.default ?? 0 }),
	})
}
num({
	id: 'crop_angle',
	label: 'Angle',
	group: 'Crop',
	family: 'crop',
	field: 'CropAngle',
	min: -45,
	max: 45,
	step: 0.1,
	reset: 0,
})
for (const field of ['GrainSize', 'GrainFrequency'])
	num({
		id: 'mask_' + field,
		label: field === 'GrainSize' ? 'Grain Size (global)' : 'Grain Roughness (global)',
		group: 'Masking · Effects',
		family: 'mask-global',
		field,
		min: 0,
		max: 100,
		step: 1,
		reset: field === 'GrainSize' ? 25 : 50,
	})
for (const [region, r] of Object.entries(source.grading.regions)) {
	for (const field of ['hue', 'saturation'] as const)
		num({
			id: `grading_${region}_${field}`,
			label: `${r.label} ${label(field)}`,
			group: 'Color Grading',
			family: 'grading',
			field: r[field],
			region,
			min: 0,
			max: field === 'hue' ? 360 : 100,
			step: 1,
			reset: 0,
		})
	button(`grading_${region}_reset`, `Reset ${r.label} region`, 'Color Grading', 'grading', '/command', {
		command: 'color_grading.region.reset',
		region,
	})
}
for (const [control, r] of Object.entries(source.grading.scalarControls))
	num({
		id: `grading_${control}`,
		label: r.label,
		group: 'Color Grading',
		family: 'grading',
		field: r.parameter,
		region: control,
		min: control === 'blending' ? 0 : -100,
		max: 100,
		step: 1,
		reset: control === 'blending' ? 50 : 0,
	})
for (const view of source.grading.views)
	button(`grading_view_${view}`, `View ${view}`, 'Color Grading', 'grading', '/command', {
		command: 'color_grading.view.set',
		view,
	})

for (const masked of [false, true]) {
	const family: Family = masked ? 'mask-point-color' : 'point-color',
		prefix = masked ? '/masking/point-color' : '/point-color',
		group = masked ? 'Masking · Point Color' : 'Point Color'
	for (const field of source.pointColor.fields) {
		const range = source.pointColor.ranges[field as keyof typeof source.pointColor.ranges]
		num({
			id: `${family}_${field}`,
			label: label(field),
			group,
			family,
			field,
			min: range[0] * 100,
			max: range[1] * 100,
			step: 1,
			reset: field === 'RangeAmount' ? 50 : 0,
			scale: 100,
		})
	}
	for (const range of source.pointColor.rangeNames)
		for (const field of source.pointColor.boundaries)
			num({
				id: `${family}_${range}_${field}`,
				label: `${label(range)} · ${label(field)}`,
				group: `${group} · Ranges`,
				family,
				range,
				field,
				min: 0,
				max: 100,
				step: 1,
				scale: 100,
			})
	for (let selectedIndex = 1; selectedIndex <= 8; selectedIndex++)
		button(
			`${family}_swatch_${selectedIndex}`,
			`Swatch ${selectedIndex}`,
			group,
			family,
			`${prefix}/sample`,
			{ selectedIndex },
			{ scope: 'point' },
		)
	button(`${family}_picker`, 'Open color picker', group, family, `${prefix}/tool/select`, {}, { scope: 'point' })
	button(
		`${family}_visualize`,
		'Toggle Visualize Range',
		group,
		family,
		`${prefix}/range-visualization/toggle`,
		{},
		{ scope: 'point' },
	)
}
for (const c of source.masking.controls.filter((c) => c.parameter !== 'local_RefineSaturation'))
	num({
		id: c.parameter,
		label: c.label,
		group: `Masking · ${c.group}`,
		family: 'masking',
		field: c.parameter,
		min: -100,
		max: 100,
		step: c.parameter === 'local_Exposure' ? 0.1 : 1,
		reset: c.parameter === 'local_Amount' ? 100 : 0,
	})
for (const kind of source.masking.creation)
	for (const operation of ['create', 'component/add', 'component/subtract'])
		button(
			`mask_${operation.replace('/', '_')}_${kind.maskType}_${kind.maskSubtype}`,
			`${operation === 'create' ? 'New' : operation.endsWith('add') ? 'Add' : 'Subtract'} ${kind.label}`,
			operation === 'create'
				? 'Masking · Create Mask'
				: operation.endsWith('add')
					? 'Masking · Add Component'
					: 'Masking · Subtract Component',
			'masking',
			`/masking/${operation}`,
			{ maskType: kind.maskType, maskSubtype: kind.maskSubtype },
			operation === 'create' ? {} : { scope: 'group' },
		)
for (const open of [true, false])
	button(`mask_panel_${open}`, open ? 'Open Masking' : 'Close Masking', 'Masking', 'masking', '/masking/panel', {
		open,
	})
for (const target of ['group', 'tool']) {
	for (const direction of ['previous', 'next'])
		button(
			`mask_${target}_${direction}`,
			`${direction} ${target === 'group' ? 'mask' : 'component'}`,
			'Masking',
			'masking',
			`/masking/${target}/navigate`,
			{ direction },
		)
	for (const hidden of [true, false])
		button(
			`mask_${target}_hidden_${hidden}`,
			`${hidden ? 'Hide' : 'Show'} ${target === 'group' ? 'mask' : 'component'}`,
			'Masking',
			'masking',
			`/masking/${target}/visibility`,
			{ hidden },
		)
}
for (const [path, text, scope, confirm] of [
	['selected/reset', 'Reset mask adjustments', 'group', true],
	['selected/delete', 'Delete selected mask', 'group', true],
	['all/delete', 'Delete all masks', '', true],
	['component/delete', 'Delete selected component', 'tool', true],
	['component/invert', 'Invert selected component', 'tool', false],
] as const)
	button(
		`mask_${path.replace('/', '_')}`,
		text,
		'Masking',
		'masking',
		`/masking/${path}`,
		{},
		{ ...(scope ? { scope } : {}), confirm },
	)

for (const masked of [false, true]) {
	const family: Family = masked ? 'mask-curve' : 'curve',
		prefix = masked ? '/masking/tone-curve' : '/tone-curve',
		group = masked ? 'Masking · Tone Curve' : 'Tone Curve'
	num({
		id: `${family}_refine`,
		label: 'Refine Saturation',
		group,
		family,
		field: 'refineSaturation',
		min: 0,
		max: 100,
		step: 1,
		reset: 100,
	})
	for (const channel of source.curve.channels)
		button(
			`${family}_reset_${channel}`,
			`Reset ${channel.toUpperCase()} curve`,
			group,
			family,
			`${prefix}/reset`,
			{ channel },
			{ scope: 'curve' },
		)
	for (const preset of Object.keys(source.curve.presets))
		button(`${family}_preset_${preset}`, preset, group, family, `${prefix}/preset`, { preset }, { scope: 'curve' })
}
for (const [key, path] of [
	['whiteBalanceOptions', 'white-balance'],
	['processOptions', 'process'],
	['vignetteStyleOptions', 'vignette-style'],
	['uprightModeOptions', 'upright-mode'],
] as const)
	for (const o of source.categorical[key]) {
		if ('writable' in o && !o.writable) continue
		button(
			`categorical_${path}_${o.value}`,
			o.label,
			`Develop · ${label(path)}`,
			'categorical',
			`/develop-categorical/${path}`,
			{ value: o.value },
		)
	}
for (const value of [0, 1])
	button(
		`constrain_crop_${value}`,
		`Constrain Crop ${value ? 'On' : 'Off'}`,
		'Transform',
		'categorical',
		'/develop-categorical/constrain-crop',
		{ value },
	)
for (const target of ['upright', 'loupe'])
	button(
		`upright_tool_${target}`,
		target === 'upright' ? 'Open Guided Upright' : 'Close Guided Upright',
		'Transform',
		'categorical',
		'/develop-categorical/upright-tool',
		{ target },
	)

for (const enabled of [true, false]) {
	button(
		`blur_apply_${enabled}`,
		`Lens Blur ${enabled ? 'On' : 'Off'}`,
		'Lens Blur',
		'lens-blur-sdk',
		'/lens-blur/apply',
		{
			enabled,
		},
	)
	button(
		`blur_depth_${enabled}`,
		`Visualize Depth ${enabled ? 'On' : 'Off'}`,
		'Lens Blur',
		'lens-blur',
		'/lens-blur/visualize-depth',
		{ enabled },
	)
	button(
		`blur_auto_mask_${enabled}`,
		`Auto Mask ${enabled ? 'On' : 'Off'}`,
		'Lens Blur · Refinement',
		'lens-blur',
		'/lens-blur/auto-mask',
		{ enabled },
	)
	for (const path of ['raw-details', 'super-resolution'])
		button(
			`enhance_${path}_${enabled}`,
			`${label(path)} ${enabled ? 'On' : 'Off'}`,
			'Enhance',
			'enhance',
			`/enhance/${path}/set`,
			{ enabled },
		)
	button(`denoise_${enabled}`, `Denoise ${enabled ? 'On' : 'Off'}`, 'Enhance', 'enhance', '/enhance/denoise/set', {
		enabled,
	})
}
num({
	id: 'denoise_amount',
	label: 'Denoise Amount',
	group: 'Enhance',
	family: 'enhance',
	field: 'denoiseAmount',
	min: 1,
	max: 100,
	step: 1,
	reset: 50,
})
for (const value of source.bokeh)
	button(`bokeh_${value}`, value, 'Lens Blur · Bokeh', 'lens-blur-sdk', '/lens-blur/bokeh', { value })
for (const value of ['focus', 'blur'])
	button(
		`blur_refinement_${value}`,
		`${label(value)} refinement`,
		'Lens Blur · Refinement',
		'lens-blur',
		'/lens-blur/refinement-mode',
		{ value },
	)
for (const open of [true, false])
	button(
		`blur_refinement_disclosure_${open}`,
		`${open ? 'Open' : 'Close'} brush refinement`,
		'Lens Blur · Refinement',
		'lens-blur',
		'/lens-blur/refinement-disclosure',
		{ open },
	)
button(
	'blur_refinement_reset',
	'Reset brush refinement',
	'Lens Blur · Refinement',
	'lens-blur',
	'/lens-blur/refinement-reset',
	{ confirmed: true },
	{ confirm: true },
)
for (const value of ['subject', 'point-area'])
	button(`blur_focus_${value}`, `Focus ${value}`, 'Lens Blur', 'lens-blur', '/lens-blur/focus-action', { value })
for (const action of ['select', 'close'])
	button(
		`blur_depth_tool_${action}`,
		`${label(action)} Depth Refinement`,
		'Lens Blur',
		'lens-blur-sdk',
		`/lens-blur/depth-refinement/${action}`,
	)
for (const field of ['amount', 'size', 'feather', 'flow'])
	num({
		id: `blur_brush_${field}`,
		label: `Brush ${field}`,
		group: 'Lens Blur · Refinement',
		family: 'lens-blur',
		field,
		min: 0,
		max: 100,
		step: field === 'size' ? 0.1 : 1,
		reset: 0,
	})
// Numeric Focus Range is intentionally absent from Companion. LRBridge's Web
// Controller keeps its SDK implementation; legacy Companion IDs fail safely.

const removal = (
	id: string,
	text: string,
	path: string,
	field: string,
	value: string | number | boolean,
	scope?: ButtonControl['scope'],
) =>
	button(
		id,
		text,
		'Healing / Dust',
		'remove',
		`/remove/${path}`,
		{ field, value },
		{ ...(scope ? { scope } : {}), confirm: field === 'selectedRepair' && value === 'delete' },
	)
for (const [value, name] of [
	['heal_patchmatch', 'Remove'],
	['heal', 'Heal'],
	['clone', 'Clone'],
])
	removal(`healing_mode_${value}`, name, 'brush', 'newSpotType', value)
for (const value of ['dust', 'loupe'])
	removal(`healing_panel_${value}`, value === 'dust' ? 'Open Healing' : 'Close Healing', 'panel', 'selectedTool', value)
for (const field of ['useGenerativeAI', 'detectObjects', 'visualizeSpots', 'dustApply'])
	for (const value of [true, false])
		removal(
			`healing_${field}_${value}`,
			`${label(field)} ${value ? 'On' : 'Off'}`,
			field === 'dustApply' ? 'dust' : 'brush',
			field,
			value,
		)
removal('dust_close', 'Close Dust', 'dust', 'dustClose', 'manualRemove')
for (const value of ['always', 'auto', 'selected', 'never'])
	removal(`healing_overlay_${value}`, `Tool Overlay ${value}`, 'brush', 'toolOverlay', value)
for (const value of ['refresh', 'delete'])
	removal(`healing_repair_${value}`, `${label(value)} repair`, 'repair', 'selectedRepair', value, 'repair')
for (const value of ['remove', 'heal', 'clone', 'generative_remove'])
	removal(`healing_fill_${value}`, `Selected repair: ${label(value)}`, 'repair', 'selectedRepairFill', value, 'repair')
for (const value of ['add', 'subtract', 'cancel', 'remove'])
	removal(`healing_selection_${value}`, `Selected ${value}`, 'selection', 'selectedSelection', value, 'selection')
// These two controls use Windows automation. Preserve old configured actions,
// but do not advertise them as SDK Healing controls in new presets/actions.
for (const value of ['add', 'subtract']) {
	const c = buttonControls.find((c) => c.id === `healing_selection_${value}`)!
	c.hiddenPreset = true
	c.hiddenChoice = true
}
for (const field of [
	'brushSize',
	'brushFeather',
	'visualizationThreshold',
	'selectedRepairOpacity',
	'selectedRepairFeather',
])
	num({
		id: `remove_${field}`,
		label: label(field),
		group: 'Healing / Dust',
		family: 'remove',
		field,
		min: field === 'brushSize' ? 1 : 0,
		max: 100,
		step: 1,
		scale: field.startsWith('selected') ? 100 : 1,
	})
for (const value of [true, false])
	button(
		`reflections_${value}`,
		`Reflections ${value ? 'On' : 'Off'}`,
		'Reflections',
		'reflections',
		'/reflections/set',
		{ field: 'checkboxState', value },
	)
for (const value of ['preview', 'standard', 'best'])
	button(`reflections_quality_${value}`, `Quality ${value}`, 'Reflections', 'reflections', '/reflections/set', {
		field: 'quality',
		value,
	})
num({
	id: 'reflections_amount',
	label: 'Amount',
	group: 'Reflections',
	family: 'reflections',
	field: 'amount',
	min: -100,
	max: 100,
	step: 1,
})
for (const operationKind of ['open', 'detect', 'remove'])
	button(
		`people_${operationKind}`,
		`${label(operationKind)} People Removal`,
		'People Removal',
		'people',
		'/people/action',
		{ operationKind },
	)
for (const operationKind of ['open', 'pet_eye', 'close', 'reset'])
	button(
		`red_eye_${operationKind}`,
		operationKind === 'pet_eye' ? 'Open Pet Eye' : `${label(operationKind)} Red Eye`,
		'Red Eye',
		'red-eye',
		'/red-eye/action',
		{ operationKind: operationKind === 'open' ? 'red_eye' : operationKind },
		{ confirm: operationKind === 'reset' },
	)
for (const family of ['clipboard', 'export'] as const)
	for (const action of family === 'clipboard' ? ['copy', 'paste'] : ['dialog', 'previous'])
		button(
			`${family}_${action}`,
			family === 'clipboard'
				? action === 'copy'
					? 'Quick Copy Settings'
					: 'Paste Settings'
				: action === 'dialog'
					? 'Open Export dialog'
					: 'Export with previous settings',
			family === 'clipboard' ? 'Copy / Paste Settings' : 'Export',
			family,
			`/${family}/action`,
			{ command: `${family}.${action}` },
		)
for (const direction of ['previous', 'next'])
	button(
		`preset_${direction}`,
		`${label(direction)} favorite preset`,
		'Presets',
		'develop-presets',
		'/develop-presets/navigate',
		{ direction },
	)
button('preset_refresh', 'Refresh preset inventory', 'Presets', 'develop-presets', '/develop-presets/inventory/refresh')
num({
	id: 'preset_amount',
	label: 'Preset Amount',
	group: 'Presets',
	family: 'develop-presets',
	field: 'presetAmount',
	min: 0,
	max: 200,
	step: 1,
})

const choices = (command: string, field: string, values: readonly (string | number)[], group: string, prefix = '') =>
	values.forEach((value) =>
		button(`${command}_${value}`, `${prefix}${label(String(value))}`, group, 'command', '/command', {
			command,
			[field]: value,
		}),
	)
choices('develop.action', 'action', source.enums.allowedActions, 'Develop actions')
buttonControls.find((c) => c.id === 'develop.action_resetAllDevelopAdjustments')!.confirm = true
choices('selection.navigate', 'direction', source.enums.allowedSelectionDirections, 'Selection', 'Photo ')
choices('selection.flag', 'flag', source.enums.allowedFlags, 'Selection', 'Flag ')
choices('selection.rating.set', 'rating', [0, 1, 2, 3, 4, 5], 'Selection', 'Rating ')
choices('selection.rating.adjust', 'direction', source.enums.allowedRatingDirections, 'Selection', 'Rating ')
choices('selection.label.set', 'label', source.enums.allowedLabels, 'Selection', 'Label ')
choices('selection.label.toggle', 'label', source.enums.allowedToggleLabels, 'Selection', 'Toggle label ')
choices('selection.operation', 'operation', source.enums.allowedSelectionOperations, 'Selection')
choices('photo.rotate', 'direction', source.enums.allowedPhotoRotateDirections, 'Photo', 'Rotate ')
choices('photo.treatment', 'value', source.enums.allowedPhotoTreatments, 'Photo')
choices('photo.crop_aspect', 'mode', source.enums.allowedPhotoCropAspects, 'Crop')
choices('photo.reveal', 'scope', source.enums.allowedPhotoRevealScopes, 'Photo', 'Reveal ')
choices('application.module', 'module', source.enums.allowedApplicationModules, 'Application · Modules')
for (const view of source.enums.allowedApplicationViews)
	choices(
		'application.view',
		'view',
		[view],
		view.startsWith('develop_') ? 'Application · Develop Views' : 'Application · Library Views',
	)
choices('application.action', 'action', source.enums.allowedApplicationActions, 'Application')
choices('application.secondary_view', 'view', source.enums.allowedSecondaryViews, 'Application · Secondary Display')
for (const direction of source.enums.allowedExtendDirections)
	button(`selection_extend_${direction}`, `Extend selection ${direction}`, 'Selection', 'command', '/command', {
		command: 'selection.extend',
		direction,
		amount: 1,
	})
for (const target of ['crop', 'loupe'])
	button(`crop_tool_${target}`, target === 'crop' ? 'Open Crop' : 'Close Crop', 'Crop', 'command', '/command', {
		command: 'develop.action',
		action: 'selectCropTool',
		target,
	})
for (const action of ['undo', 'redo'])
	button(action, label(action), 'History', 'history', '/command', { command: `lightroom.${action}` })

// Keep public IDs stable while presenting each action beside its controls.
const developPresentation: Record<string, [string, string, boolean?]> = {
	resetAllDevelopAdjustments: ['Develop actions', 'Reset All'],
	setAutoTone: ['Develop actions', 'Auto Tone'],
	setAutoWhiteBalance: ['Develop actions', 'Auto White Balance'],
	resetCrop: ['Crop', 'Reset Crop'],
	resetTransforms: ['Transform', 'Reset Transforms'],
	resetSpotRemoval: ['Healing / Dust', 'Reset Spot Removal'],
	resetRedeye: ['Red Eye', 'Reset Red Eye', true],
	selectCropTool: ['Crop', 'Open Crop', true],
	selectHealingTool: ['Healing / Dust', 'Open Healing', true],
	selectRedEyeTool: ['Red Eye', 'Open Red Eye', true],
	selectUprightTool: ['Transform', 'Open Guided Upright', true],
	selectMaskingTool: ['Masking', 'Open Masking', true],
}
const applicationActionPresentation: Record<string, [string, string]> = {
	toggle_zoom: ['Zoom', 'Zoom toggle (Fit/Fill ↔ zoomed)'],
	zoom_in: ['Zoom', 'Zoom In'],
	zoom_out: ['Zoom', 'Zoom Out'],
	zoom_100: ['Zoom', 'Zoom 100%'],
	fullscreen_preview: ['Screen', 'Fullscreen Preview'],
	fullscreen_hide_panels: ['Screen', 'Fullscreen + Hide Panels'],
	next_screen_mode: ['Screen', 'Cycle Screen Modes'],
	cycle_loupe_info: ['Library Views', 'Cycle Loupe Info'],
	toggle_secondary_display: ['Secondary Display', 'Show / Hide Display'],
	toggle_secondary_fullscreen: ['Secondary Display', 'Full Screen / Windowed'],
}
const viewLabels: Record<string, string> = {
	develop_loupe: 'Develop Loupe',
	develop_before_after_horiz: 'Before/After Horizontal',
	develop_before_after_vert: 'Before/After Vertical',
	develop_before: 'Before Only',
	develop_reference_horiz: 'Reference Horizontal',
	develop_reference_vert: 'Reference Vertical',
}
for (const c of buttonControls) {
	if (c.params.command === 'develop.action') {
		const info = developPresentation[String(c.params.action)]
		if (info && c.id.startsWith('develop.action_')) {
			;[c.group, c.label, c.hiddenPreset] = info
		}
	}
	if (c.params.command === 'photo.treatment') {
		c.group = 'Develop actions'
		c.label = c.params.value === 'grayscale' ? 'B&W' : 'Color'
	}
	if (c.params.command === 'application.action') {
		const info = applicationActionPresentation[String(c.params.action)]
		if (info) {
			c.group = `Application · ${info[0]}`
			c.label = info[1]
		}
	}
	if (c.params.command === 'application.view')
		c.label = viewLabels[String(c.params.view)] ?? label(String(c.params.view)).replace(/^./, (s) => s.toUpperCase())
	if (c.params.command === 'application.module' || c.params.command === 'application.secondary_view')
		c.label = c.label.replace(/^./, (s) => s.toUpperCase())
}
export const numericById = new Map(numericControls.map((c) => [c.id, c]))
export const buttonById = new Map(buttonControls.map((c) => [c.id, c]))
export const variableId = (id: string) => `control_${id.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`
