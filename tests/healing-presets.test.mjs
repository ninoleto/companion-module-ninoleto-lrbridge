import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { numericControls, buttonControls, buttonById } from '../dist/controller-catalog.js'
import { UpdatePresets } from '../dist/presets.js'

const { ControllerClient } = await import(process.env.LRBRIDGE_CLIENT_MODULE || '../dist/controller-client.js')
const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const definition = require(path.join(root, 'server/remove-state.js'))
const installRoutes = require(path.join(root, 'server/remove-routes.js'))
const commandDefinition = require(path.join(root, 'server/commands.js'))

// Real beta.4 routes, state admission, command validation and result validation.
// Lightroom execution and SDK snapshots alone are simulated.
async function fixture(selectedTool = 'loupe', beforeWrite) {
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'photo-one',
		contextCounter: 1,
		developCounter: 3,
		contextChangedAt: 100,
	}
	const preferences = {
		newSpotType: 'heal_patchmatch',
		brushSize: 40,
		brushFeather: 50,
		useGenerativeAI: false,
		detectObjects: false,
		toolOverlay: 'auto',
		visualizeSpots: false,
		visualizationThreshold: 50,
	}
	let snapshot = {
		available: selectedTool === 'dust',
		selectedTool,
		...(selectedTool === 'dust' ? preferences : { reason: 'tool_closed' }),
	}
	let clock = 1000
	const state = definition.createRemoveState({ serverEpoch: 'remove-fixture', now: () => clock, getContext: () => ctx })
	await state.refreshSelection()
	function publish() {
		clock += 500
		state.get(true)
		const request = state.takeRequest()
		assert.ok(request)
		assert.ok(state.acceptQuery({ ...request, ...snapshot }))
	}
	publish()
	const routes = new Map(),
		accepted = [],
		sent = [],
		waiting = []
	installRoutes(
		{
			get(route, handler) {
				routes.set(route, handler)
			},
		},
		state,
		{
			ADMISSION_ACCEPTED: 'accepted',
			tryEnqueueCommand(command) {
				assert.ok(commandDefinition.validateCommand(command), 'Packaged command validator accepts the envelope')
				assert.ok(state.matches(command, 'admit'))
				accepted.push(structuredClone(command))
				waiting.push(command)
				return { status: 'accepted' }
			},
		},
		(req, keys) => JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...keys].sort()),
		Number,
	)
	function execute() {
		const command = waiting.shift()
		if (!command) return
		assert.ok(state.matches(command, 'dequeue'))
		if (command.field === 'selectedTool')
			snapshot =
				command.value === 'dust'
					? { available: true, selectedTool: 'dust', ...preferences }
					: { available: false, selectedTool: 'loupe', reason: 'tool_closed' }
		else snapshot = { ...snapshot, [command.field]: command.value }
		assert.ok(
			state.acceptResult({
				...command,
				...snapshot,
				outcome: 'confirmed',
				detail: '',
				otherPreferencesPreserved: true,
			}),
		)
	}
	const client = new ControllerClient({
		async request(url) {
			const u = new URL(url, 'http://fixture')
			sent.push(u)
			if (u.pathname === '/context') return structuredClone(ctx)
			if (u.pathname === '/remove/state') {
				execute()
				if (!state.get(false).pendingOperation) publish()
			} else await beforeWrite?.({ ctx, state, u })
			let status = 200,
				body
			assert.ok(routes.has(u.pathname), u.pathname)
			await routes.get(u.pathname)(
				{ query: Object.fromEntries(u.searchParams), path: u.pathname },
				{
					status(code) {
						status = code
						return this
					},
					json(value) {
						body = value
						return this
					},
					set() {
						return this
					},
				},
			)
			if (status >= 400) throw Error(`${status}: ${body?.error || 'Rejected'}`)
			return structuredClone(body)
		},
		changed() {},
		adjust() {
			throw Error('Unexpected legacy adjustment')
		},
	})
	return {
		client,
		state,
		ctx,
		accepted,
		sent,
		setUnavailable() {
			snapshot = { available: false, selectedTool: 'dust', reason: 'preferences_unavailable' }
			publish()
		},
	}
}

test('Open Healing works while brush preferences are unavailable because another tool is selected', async () => {
	for (const tool of ['loupe', 'crop', 'redeye', 'masking', 'point_color', 'local_point_color', 'depth_refinement']) {
		const f = await fixture(tool)
		try {
			await f.client.button('healing_panel_dust')
			assert.equal(f.accepted.length, 1)
			assert.equal(f.accepted[0].command, 'remove.panel.set')
			assert.equal(f.accepted[0].expectedValue, tool)
			assert.equal(f.accepted[0].expectedRemoveMode, null)
			assert.equal(f.state.get(false).selectedTool, 'dust')
			assert.equal(f.state.get(false).lastResult.outcome, 'confirmed')
			assert.equal(f.sent.find((u) => u.pathname === '/remove/panel').searchParams.get('mode'), 'null')
		} finally {
			f.client.stop()
		}
	}
})

test('Close Healing works with normal or unavailable brush preferences', async () => {
	for (const unavailable of [false, true]) {
		const f = await fixture('dust')
		try {
			if (unavailable) f.setUnavailable()
			await f.client.button('healing_panel_loupe')
			assert.equal(f.accepted.length, 1)
			assert.equal(f.state.get(false).selectedTool, 'loupe')
			assert.equal(f.state.get(false).lastResult.outcome, 'confirmed')
		} finally {
			f.client.stop()
		}
	}
})

test('Explicit Open and Close are idempotent and Close preserves another selected tool', async () => {
	for (const [tool, button] of [
		['dust', 'healing_panel_dust'],
		['loupe', 'healing_panel_loupe'],
		['crop', 'healing_panel_loupe'],
	]) {
		const f = await fixture(tool)
		try {
			await f.client.button(button)
			assert.equal(f.accepted.length, 0)
			assert.equal(f.state.get(false).selectedTool, tool)
		} finally {
			f.client.stop()
		}
	}
})

test('Open Healing preserves binding checks and does not retry a rejected photo change', async () => {
	const f = await fixture('loupe', ({ ctx }) => {
		ctx.selectedPhotoUuid = 'photo-two'
		ctx.contextCounter++
	})
	try {
		await assert.rejects(f.client.button('healing_panel_dust'), /409/)
		assert.equal(f.accepted.length, 0)
		assert.equal(f.sent.filter((u) => u.pathname === '/remove/panel').length, 1)
	} finally {
		f.client.stop()
	}
})

test('Open/Close still refuses a pending Healing operation', async () => {
	const f = await fixture('dust')
	try {
		const s = f.state.get(false)
		assert.ok(f.state.admit('newSpotType', 'heal', { ...s, stateRevision: s.revision, mode: s.newSpotType }))
		await assert.rejects(f.client.button('healing_panel_loupe'), /pending/)
		assert.equal(f.sent.filter((u) => !['/remove/state', '/context'].includes(u.pathname)).length, 0)
	} finally {
		f.client.stop()
	}
})

test('Opening exception does not enable brush edits while Healing is closed', async () => {
	const f = await fixture('loupe')
	try {
		await assert.rejects(f.client.button('healing_mode_heal'), /confirmation is unavailable/)
		assert.equal(f.accepted.length, 0)
		assert.equal(f.sent.filter((u) => u.pathname !== '/remove/state').length, 0)
	} finally {
		f.client.stop()
	}
})

test('Remove, Heal and Clone retain supported SDK values with readable labels', async () => {
	const f = await fixture('dust')
	try {
		for (const [mode, label] of [
			['heal', 'Heal'],
			['clone', 'Clone'],
			['heal_patchmatch', 'Remove'],
		]) {
			assert.equal(buttonById.get(`healing_mode_${mode}`).label, label)
			await f.client.button(`healing_mode_${mode}`)
			assert.equal(f.state.get(false).newSpotType, mode)
		}
		assert.equal(f.accepted.length, 3)
	} finally {
		f.client.stop()
	}
})

test('Unified preset browser has one template set: Rotary, minus, supported Reset, plus; buttons last', () => {
	let sections, presets
	UpdatePresets({
		label: 'LRBridge',
		getFeedbackSliderChoices: () => [],
		setPresetDefinitions(s, p) {
			sections = s
			presets = p
		},
	})
	const ids = sections.flatMap((s) => s.definitions.flatMap((d) => d.presets))
	assert.equal(new Set(ids).size, ids.length, 'No repeated templates')
	assert.deepEqual(new Set(ids), new Set(Object.keys(presets)), 'Every template is browsable once')
	assert.ok(
		ids.every((id) => id.startsWith('wc_')),
		'No separate old duplicate set',
	)
	assert.equal(new Set(sections.map((s) => s.name)).size, sections.length)
	for (const c of numericControls) {
		if (c.family === 'native' && c.max - c.min === 1) {
			for (const value of [0, 1]) assert.ok(ids.includes(`wc_${c.id}_${value}`))
			continue
		}
		const expected = ['rotary', 'minus', ...(c.reset === undefined ? [] : ['reset']), 'plus'].map(
			(s) => `wc_${c.id}_${s}`,
		)
		assert.deepEqual(ids.slice(ids.indexOf(expected[0]), ids.indexOf(expected[0]) + expected.length), expected, c.id)
		assert.equal(presets[expected[0]].steps[0].rotate_right[0].options.mode, 'fine')
	}
	for (const c of buttonControls) assert.equal(ids.includes(`wc_${c.id}`), !c.hiddenPreset, c.id)
	for (const section of sections) {
		let sawButton = false
		for (const id of section.definitions.flatMap((d) => d.presets)) {
			const p = presets[id],
				a = p.steps[0].down[0]
			const isSlider = p.steps[0].rotate_left || (a?.actionId === 'controller_numeric' && a.options.mode !== 'set')
			if (!isSlider) sawButton = true
			else assert.equal(sawButton, false, `Slider after a button in ${section.name}`)
		}
	}
	const hdr = sections.find((s) => s.name === 'HDR / SDR Rendition').definitions[0].presets
	assert.deepEqual(
		hdr.slice(0, 4),
		['rotary', 'minus', 'reset', 'plus'].map((s) => `wc_HDRMaxValue_${s}`),
	)
	assert.deepEqual(hdr.slice(-2), ['wc_HDREditMode_0', 'wc_HDREditMode_1'])
	assert.ok(
		sections
			.find((s) => s.name === 'Calibration')
			.definitions[0].presets.some((id) =>
				presets[id].steps[0].down[0]?.options.control?.startsWith('categorical_process_'),
			),
	)
})
