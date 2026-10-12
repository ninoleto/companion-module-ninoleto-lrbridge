import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { ControllerClient, pathWith } from '../dist/controller-client.js'
import { numericControls, reference } from '../dist/controller-catalog.js'

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const maskingDefinition = require(path.join(root, 'server/masking-state.js'))
const maskingCorrections = require(path.join(root, 'app/controller-masking-corrections.js'))
const pointCurveDefinition = require(path.join(root, 'server/point-curve-state.js'))
const pointColorDefinition = require(path.join(root, 'server/point-color-state.js'))
const commands = require(path.join(root, 'server/commands.js'))
const source = fs.readFileSync(path.join(root, 'server/bridge.js'), 'utf8')
const tree = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const routes = new Map(),
	functions = new Map()
function visit(node) {
	if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree))
	if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.get' && ts.isStringLiteral(node.arguments[0]))
		routes.set(node.arguments[0].text, node.arguments.at(-1).getText(tree))
	ts.forEachChild(node, visit)
}
visit(tree)
const fields = [
	'selectedPhotoUuid',
	'contextCounter',
	'developCounter',
	'contextChangedAt',
	'serverEpoch',
	'stateRevision',
]

// Use the exact packaged route handlers, Masking state machine and command validator.
// Only Lightroom execution/feedback is simulated. This is not a native Lightroom test.
function fixture(beforeWrite, pointColor) {
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'photo-one',
		contextCounter: 1,
		developCounter: 3,
		contextChangedAt: 100,
	}
	const masking = maskingDefinition.createMaskingState({ serverEpoch: 'mask-fixture', now: () => 1000 })
	const snapshot = {
		available: true,
		active: true,
		maskGroupCount: 1,
		hasSelectedMaskGroup: true,
		selectedMaskGroupIndex: 1,
		selectedMaskGroupId: 'group-one',
		selectedMaskGroupName: 'Mask 1',
		selectedMaskHidden: false,
		previousAvailable: false,
		nextAvailable: false,
		selectedMaskToolAvailable: true,
		selectedMaskToolId: 'tool-one',
		selectedMaskToolName: 'Brush 1',
		selectedMaskToolType: 'brush',
		selectedMaskToolSubtype: null,
		selectedMaskToolHidden: false,
		selectedMaskToolCount: 1,
		selectedMaskToolIndex: 1,
		previousMaskToolAvailable: false,
		nextMaskToolAvailable: false,
		pointColor: pointColor || { available: false, swatchCount: 0, selectedIndex: 0, selectionTransient: false },
		curves: {
			available: true,
			...Object.fromEntries(['rgb', 'red', 'green', 'blue'].map((k) => [k, [0, 0, 255, 255]])),
		},
		corrections: reference.masking.controls.map(({ parameter }) => ({
			parameter,
			value: ['local_Amount', 'local_RefineSaturation'].includes(parameter) ? 100 : 0,
			min: ['local_Amount', 'local_RefineSaturation', 'local_Grain'].includes(parameter)
				? 0
				: parameter === 'local_Exposure'
					? -4
					: -100,
			max: parameter === 'local_Amount' ? 200 : parameter === 'local_Exposure' ? 4 : 100,
		})),
	}
	function publish() {
		assert.ok(masking.requestRefresh(ctx, true))
		const query = masking.takeRequest()
		assert.ok(masking.acceptQueryResult({ ...query, snapshot: structuredClone(snapshot) }, ctx))
	}
	publish()
	const sent = [],
		accepted = []
	const world = vm.createContext({
		masking,
		maskingDefinition,
		maskingCorrections,
		pointCurveDefinition,
		pointColorDefinition,
		commands,
		context: { getContextFields: () => ctx },
		pollingTrace: { record() {} },
		MASKING_CORRECTION_FIELDS: ['parameter', 'selectedMaskGroupId', ...fields],
		MASKING_EDIT_FIELDS: ['selectedMaskGroupId', ...fields],
		MASKING_TONE_BINDING_FIELDS: [...fields, 'selectedMaskGroupId'],
		exactQueryFields(req, keys) {
			return JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...keys].sort())
		},
		queueCommand(command) {
			assert.ok(commands.validateCommand(command), `Rejected command: ${JSON.stringify(command)}`)
			assert.ok(masking.commandMatches(command, ctx), 'Actual state machine must own the command')
			accepted.push(structuredClone(command))
			if (command.command.endsWith('.begin')) return { accepted: true, queueLength: 1 }
			const result = { ...command, kind: command.command, outcome: 'confirmed', detail: '' }
			if (command.command.startsWith('masking.correction.')) {
				const correction = snapshot.corrections.find((c) => c.parameter === command.parameter)
				correction.value = command.command.endsWith('.reset')
					? command.parameter === 'local_Amount'
						? 100
						: command.parameter === 'local_Exposure'
							? 0.25
							: 0
					: command.value
				assert.ok(
					masking.acceptCorrectionResult(
						{
							...result,
							gestureId: command.gestureId ?? null,
							expectedValue: command.value ?? null,
							snapshot: structuredClone(snapshot),
						},
						ctx,
					),
				)
			} else {
				if (command.command === 'masking.point_color.sample.select')
					snapshot.pointColor.selectedIndex = command.selectedIndex
				else if (command.command === 'masking.point_color.value.set') snapshot.pointColor[command.field] = command.value
				else if (command.command === 'masking.point_color.range.set')
					snapshot.pointColor[command.range][command.boundary] = command.value
				else if (command.command === 'masking.point_color.range.translate') {
					for (const key of pointColorDefinition.boundaries) snapshot.pointColor[command.range][key] = command[key]
				} else if (command.points) snapshot.curves[command.channel] = [...command.points]
				else snapshot.corrections.find((c) => c.parameter === 'local_RefineSaturation').value = command.value
				assert.ok(masking.acceptEditResult({ ...result, snapshot: structuredClone(snapshot) }, ctx))
			}
			return { accepted: true, queueLength: 1 }
		},
	})
	for (const name of [
		'parseStrictFiniteNumber',
		'parseMaskingCounter',
		'maskingBindingFromRequest',
		'correctionSpecification',
		'queueMaskingCorrection',
		'queueMaskingEdit',
		'maskingCurveGesture',
		'maskingRefineGesture',
		'maskingToneCurveName',
		'maskingToneCurveState',
	]) {
		assert.ok(functions.has(name), name)
		vm.runInContext(functions.get(name), world)
	}
	async function request(url) {
		const u = new URL(url, 'http://fixture')
		assert.ok(routes.has(u.pathname), `Reference route ${u.pathname}`)
		if (!u.pathname.endsWith('/state')) {
			sent.push(url)
			await beforeWrite?.({ u, ctx, snapshot, publish, masking })
		}
		let status = 200,
			body
		const res = {
			status(n) {
				status = n
				return this
			},
			set() {
				return this
			},
			json(value) {
				body = value
				return this
			},
		}
		vm.runInContext('(' + routes.get(u.pathname) + ')', world)({ query: Object.fromEntries(u.searchParams) }, res)
		if (status >= 400) throw Error(`${status}: ${body?.error || 'Rejected'}`)
		return structuredClone(body)
	}
	const c = new ControllerClient({
		request,
		changed() {},
		adjust() {
			throw Error('Unexpected native adjustment')
		},
	})
	return { c, request, ctx, masking, snapshot, sent, accepted }
}

function pointColorState() {
	return {
		available: true,
		swatchCount: 8,
		selectedIndex: 1,
		selectionTransient: false,
		HueShift: 0,
		SatScale: 0,
		LumScale: 0,
		Variance: 0,
		RangeAmount: 0.5,
		...Object.fromEntries(
			reference.pointColor.rangeNames.map((range) => [
				range,
				{
					LowerNone: 0.1,
					LowerFull: 0.25,
					UpperFull: 0.75,
					UpperNone: 0.9,
				},
			]),
		),
	}
}

test('masked Point Color swatches and all scalars pass the actual beta.4 handlers and state', async () => {
	const f = fixture(undefined, pointColorState())
	try {
		for (let index = 1; index <= 8; index++) {
			await f.c.button('mask-point-color_swatch_' + index)
			assert.equal(f.snapshot.pointColor.selectedIndex, index)
		}
		for (const field of reference.pointColor.fields) {
			await f.c.numeric('mask-point-color_' + field, 'set', 25)
			assert.equal(f.snapshot.pointColor[field], 0.25)
			await f.c.numeric('mask-point-color_' + field, 'fine', 1)
			assert.equal(f.snapshot.pointColor[field], 0.26)
		}
		assert.equal(f.accepted.length, 18)
		for (const command of f.accepted) assert.equal(command.expectedSelectedMaskId, 'group-one')
	} finally {
		f.c.stop()
	}
})

test('masked Point Color range boundaries and translations pass actual beta.4 admission', async () => {
	const f = fixture(undefined, pointColorState())
	try {
		for (const range of reference.pointColor.rangeNames) {
			for (const boundary of reference.pointColor.boundaries) {
				await f.c.numeric(`mask-point-color_${range}_${boundary}`, 'fine', 1)
			}
			await f.c.translateRange(true, range, 1)
		}
		assert.equal(f.accepted.length, 15)
	} finally {
		f.c.stop()
	}
})

test('beta.4 rejects bare UUIDs for Masking corrections, curves and Refine Saturation', async () => {
	const f = fixture()
	try {
		const s = f.masking.getPublicState(),
			b = { ...s, stateRevision: s.revision }
		const common = Object.fromEntries([...fields, 'selectedMaskGroupId'].map((k) => [k, b[k]]))
		const gestureId = '550e8400-e29b-41d4-a716-446655440000'
		for (const [route, params] of [
			['/masking/correction/gesture/begin', { parameter: 'local_Contrast' }],
			['/masking/tone-curve/gesture/begin', { channel: 'blue', baseline: '0,0,255,255' }],
			['/masking/tone-curve/refine-saturation/gesture/begin', { baseline: 100 }],
		])
			await assert.rejects(f.request(pathWith(route, { ...common, ...params, gestureId })), /409/)
		assert.equal(f.accepted.length, 0, 'Invalid requests never enter the command queue')
	} finally {
		f.c.stop()
	}
})

test('every regular Masking control admits Set, fine ± and Reset through actual beta.4 validation', async () => {
	const f = fixture(),
		controls = numericControls.filter((c) => c.family === 'masking')
	try {
		assert.equal(controls.length, 19)
		for (const control of controls) {
			const target = control.field === 'local_Amount' ? 80 : control.field === 'local_Exposure' ? 1 : 20
			await f.c.numeric(control.id, 'set', target)
			await f.c.numeric(control.id, 'fine', 1)
			assert.equal(f.snapshot.corrections.find((c) => c.parameter === control.field).value, target + control.step)
			await f.c.numeric(control.id, 'fine', -1)
			assert.equal(f.snapshot.corrections.find((c) => c.parameter === control.field).value, target)
			await f.c.numeric(control.id, 'reset', 0)
			assert.equal(f.masking.getPublicState().lastCorrectionResult.outcome, 'confirmed')
		}
		const ids = new Set()
		for (let i = 0; i < f.accepted.length; i += 7) {
			for (let offset = 0; offset < 6; offset += 2) {
				const begin = f.accepted[i + offset],
					end = f.accepted[i + offset + 1]
				assert.match(begin.gestureId, /^mg-[A-Za-z0-9_-]{1,60}$/)
				assert.equal(end.gestureId, begin.gestureId)
				assert.equal(end.expectedSelectedMaskId, begin.expectedSelectedMaskId)
				assert.ok(!ids.has(begin.gestureId), 'Each edit uses a unique gesture ID')
				ids.add(begin.gestureId)
			}
		}
		assert.equal(f.accepted.length, 19 * 7)
		assert.match(f.c.lastStatus, /confirmed after Reset/)
	} finally {
		f.c.stop()
	}
})

test('masked curve edits satisfy the actual curve_ admission rule', async () => {
	const f = fixture()
	try {
		await f.c.curve(true, 'blue', 'add', 2, 100, 120)
		assert.deepEqual(f.snapshot.curves.blue, [0, 0, 100, 120, 255, 255])
		await f.c.curve(true, 'blue', 'delete', 2, 0, 0)
		assert.deepEqual(f.snapshot.curves.blue, [0, 0, 255, 255])
		assert.equal(f.accepted.length, 4)
		for (const command of f.accepted) assert.match(command.gestureId, /^curve_[A-Za-z0-9_-]+$/)
	} finally {
		f.c.stop()
	}
})

test('masked Refine Saturation satisfies the actual refine_ admission rule', async () => {
	const f = fixture()
	try {
		await f.c.numeric('mask-curve_refine', 'set', 50)
		await f.c.numeric('mask-curve_refine', 'fine', 1)
		assert.equal(f.snapshot.corrections.find((c) => c.parameter === 'local_RefineSaturation').value, 51)
		assert.equal(f.accepted.length, 4)
		for (const command of f.accepted) assert.match(command.gestureId, /^refine_[A-Za-z0-9_-]+$/)
	} finally {
		f.c.stop()
	}
})

test('photo and mask changes still reject a pending gesture end', async () => {
	for (const change of ['photo', 'mask']) {
		const f = fixture(({ u, ctx, snapshot, publish }) => {
			if (!u.pathname.endsWith('/end')) return
			if (change === 'photo') {
				ctx.selectedPhotoUuid = 'photo-two'
				ctx.contextCounter++
			} else {
				snapshot.selectedMaskGroupId = 'group-two'
				publish()
			}
		})
		try {
			await assert.rejects(f.c.numeric('local_Contrast', 'set', 20), /409/)
			assert.equal(f.accepted.length, 1, 'Only Begin was admitted; no wrong-owner write')
			assert.equal(f.sent.length, 2, 'Rejected End is not retried')
		} finally {
			f.c.stop()
		}
	}
})

test('an uncertain Masking end failure is not retried', async () => {
	const f = fixture(({ u }) => {
		if (u.pathname.endsWith('/end')) throw Error('Connection lost')
	})
	try {
		await assert.rejects(f.c.numeric('local_Contrast', 'set', 20), /Connection lost/)
		assert.equal(f.sent.length, 2)
		assert.equal(f.accepted.length, 1)
	} finally {
		f.c.stop()
	}
})
