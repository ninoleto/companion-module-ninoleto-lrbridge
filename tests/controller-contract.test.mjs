import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { ControllerClient, pathWith } from '../dist/controller-client.js'
import { numericControls, numericById, buttonControls, reference } from '../dist/controller-catalog.js'
import { controllerActions, appendControllerPresets } from '../dist/controller-companion.js'
const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const source = fs.readFileSync(path.join(root, 'server/bridge.js'), 'utf8')
const commands = require(path.join(root, 'server/commands.js'))
const curveDefinition = require(path.join(root, 'server/point-curve-state.js'))
const { createResetCompletion } = require(path.join(root, 'server/reset-completion.js'))
const ctx = {
	activeModule: 'develop',
	selectedPhotoUuid: 'photo-one',
	selectedPhotoKey: 'photo-one',
	contextCounter: 1,
	developCounter: 3,
	contextChangedAt: 100,
}
const binding = { ...ctx, serverEpoch: 'test-epoch', revision: 5, stateRevision: 5 }
const pc = () => ({
	available: true,
	swatchCount: 3,
	selectedIndex: 1,
	selectionTransient: false,
	HueShift: 0,
	SatScale: 0,
	LumScale: 0,
	Variance: 0,
	RangeAmount: 0.5,
	...Object.fromEntries(
		reference.pointColor.rangeNames.map((r) => [r, { LowerNone: 0, LowerFull: 0.25, UpperFull: 0.75, UpperNone: 1 }]),
	),
})
const mask = () => ({
	...binding,
	available: true,
	active: true,
	hasSelectedMaskGroup: true,
	selectedMaskGroupId: 'group-one',
	selectedMaskToolId: 'tool-one',
	pointColor: pc(),
	corrections: reference.masking.controls.map((c) => ({ parameter: c.parameter, value: 0, min: -100, max: 100 })),
})
const ownCurve = () => ({
	...binding,
	available: true,
	curves: { rgb: [0, 0, 255, 255], red: [0, 0, 255, 255], green: [0, 0, 255, 255], blue: [2, 0, 80, 64, 255, 255] },
	refineSaturation: { value: 100, min: 0, max: 100 },
})
const requestResult = { ok: true }
const exact = (req, keys) => assert.deepEqual(Object.keys(req.query).sort(), [...keys].sort())
// Compile real packaged route handlers to verify the client's query contract.
// No backend is started and no Lightroom/photo writes are made.
const tree = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const routeNodes = new Map(),
	functions = new Map()
function visit(node) {
	if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree))
	if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.get' && ts.isStringLiteral(node.arguments[0]))
		routeNodes.set(node.arguments[0].text, node.arguments.at(-1).getText(tree))
	ts.forEachChild(node, visit)
}
visit(tree)
const maskFields = [
	'selectedPhotoUuid',
	'contextCounter',
	'developCounter',
	'contextChangedAt',
	'serverEpoch',
	'stateRevision',
]
const sandbox = {
	MASKING_COMMAND_BINDING_FIELDS: maskFields,
	MASKING_CORRECTION_FIELDS: ['parameter', 'selectedMaskGroupId', ...maskFields],
	MASKING_EDIT_FIELDS: ['selectedMaskGroupId', ...maskFields],
	MASKING_TONE_BINDING_FIELDS: [...maskFields, 'selectedMaskGroupId'],
	parseStrictFiniteNumber: (x) => (x === undefined ? null : Number(x)),
	parseMaskingCounter: (x) => Number(x),
	pointCurveDefinition: curveDefinition,
	pointColorDefinition: require(path.join(root, 'server/point-color-state.js')),
	queueMaskingEdit: (req, res, spec, keys) => {
		exact(req, keys)
		res.json({ ok: true, spec })
	},
	queueMaskingCorrection: (req, res, spec, keys) => {
		exact(req, keys)
		res.json({ ok: true, spec })
	},
	queueMaskingOperation: (req, res, spec, keys) => {
		exact(req, keys)
		res.json({ ok: true, spec })
	},
}
const context = vm.createContext(sandbox)
for (const name of ['maskingCurveGesture', 'maskingRefineGesture', 'correctionSpecification'])
	vm.runInContext(functions.get(name), context)
function checkMaskRoute(url) {
	const u = new URL(url, 'http://fixture'),
		handler = routeNodes.get(u.pathname)
	assert.ok(handler, `Reference route ${u.pathname}`)
	const fn = vm.runInContext('(' + handler + ')', context),
		res = {
			status(n) {
				assert.ok(n < 400, `Route rejects ${url}`)
				return this
			},
			json(v) {
				return v
			},
		}
	return fn({ query: Object.fromEntries(u.searchParams) }, res)
}
function client(request, adjust = async () => {}) {
	return new ControllerClient({ request, adjust, changed() {} })
}

test('all ordinary catalog buttons pass the actual beta.4 command validator', () => {
	for (const b of buttonControls.filter((b) => b.path === '/command'))
		assert.equal(commands.validateCommand(b.params), true, b.id)
})
test('catalog covers every supported numeric slider and masking correction without duplicates', () => {
	assert.equal(numericById.size, numericControls.length)
	assert.equal(new Set(buttonControls.map((b) => b.id)).size, buttonControls.length)
	for (const d of reference.sliders) assert.ok(numericById.has(d.id), d.id)
	for (const d of reference.masking.controls)
		assert.ok(
			numericById.has(d.parameter) ||
				(d.parameter === 'local_RefineSaturation' && numericById.has('mask-curve_refine')),
			d.parameter,
		)
})
test('native ±5 dispatch immediately while an unrelated state read is blocked', async () => {
	let release
	const blocked = new Promise((r) => (release = r)),
		events = []
	const c = client(
		async () => {
			await blocked
			return { ok: true, state: pc(), context: ctx, contextOwned: true }
		},
		async (s, n) => events.push([s, n]),
	)
	const pending = c.read('point-color')
	await c.numeric('Exposure', 'adjust', 5)
	await c.numeric('Contrast', 'adjust', -5)
	assert.deepEqual(events, [
		['Exposure', 5],
		['Contrast', -5],
	])
	release()
	await pending
	c.stop()
})
test('baseline native adjustment still dispatches directly without additional awaited work', () => {
	const src = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
	const method = src.match(/async runAdjustSlider\([^]*?\n\t}/)[0]
	assert.equal((method.match(/await /g) || []).length, 1)
	assert.match(method, /await this.callLRBridge\(\s*`\/adjust\?slider=/)
	assert.doesNotMatch(method, /controller|queue\(|receipt|nudge|snapshot/)
})
for (const [slider, value] of [
	['Exposure', 0],
	['Contrast', 0],
	['Vibrance', 0],
	['Temperature', 6200],
	['ProfileAmount', 100],
])
	test(`real Reset receipt contract: ${slider} result follows worker execution`, async () => {
		let queued,
			completed = false,
			reset,
			sent = 0
		const state = createResetCompletion({
			serverEpoch: 'reset-epoch',
			getContext: () => ctx,
			enqueue: (c) => {
				queued = c
				assert.equal(state.matches(c, 'admit'), true)
				return { accepted: true }
			},
		})
		const c = client(async (url, body) => {
			const u = new URL(url, 'http://fixture')
			if (u.pathname === '/reset/capabilities') return state.capabilities()
			if (u.pathname === '/reset') {
				sent++
				reset = body
				const r = state.admit(body)
				assert.equal(r.status, 202)
				return { ok: true, ...r }
			}
			if (u.pathname === '/reset/result') {
				const key = Object.fromEntries(u.searchParams)
				let receipt = state.get(key)
				if (!completed) {
					assert.notEqual(receipt.phase, 'complete')
					assert.equal(receipt.result, null)
					assert.equal(state.matches(queued, 'dequeue'), true)
					const identity = { ...key, operationId: queued.operationId }
					assert.equal(state.claim(identity), true)
					assert.equal(
						state.acceptResult({
							...identity,
							slider,
							selectedPhotoUuid: ctx.selectedPhotoUuid,
							contextCounter: ctx.contextCounter,
							contextChangedAt: ctx.contextChangedAt,
							executionDevelopCounter: ctx.developCounter,
							invoked: true,
							resetSucceeded: true,
							outcome: 'observed',
							sdkValue: value,
						}),
						true,
					)
					completed = true
				}
				return { ok: true, receipt: state.get(key) }
			}
			if (u.pathname === '/context') return ctx
			throw new Error(url)
		})
		await c.numeric(slider, 'reset')
		assert.equal(sent, 1)
		assert.equal(c.numericValues.get(slider).value, value)
		assert.ok(reset.requestId)
		c.stop()
	})
test('wrongly owned Reset result is rejected and never used as baseline', async () => {
	const c = client(async (url, body) => {
		if (url === '/reset/capabilities') return { supported: true, serverEpoch: 'e', context: ctx }
		if (url === '/reset') return { receipt: { operationId: 'op', phase: 'queued' } }
		if (url.startsWith('/reset/result'))
			return {
				receipt: {
					phase: 'complete',
					result: { requestId: 'someone-elses-request', sdkValue: 12, outcome: 'observed' },
				},
			}
		throw Error(url)
	})
	await assert.rejects(c.numeric('Exposure', 'reset'), /Mismatched/)
	assert.notEqual(c.numericValues.get('Exposure')?.available, true)
	c.stop()
})
test('network failure does not replay a guarded Export action', async () => {
	let writes = 0
	const c = client(async (url) => {
		if (url === '/context') return { ...ctx }
		if (url === '/export/state')
			return { ...binding, available: true, ageMs: 0, previousSupported: true, selectionToken: 'selection' }
		if (url.startsWith('/export/action')) {
			writes++
			throw Error('network lost after sending')
		}
		throw Error(url)
	})
	await assert.rejects(c.button('export_previous'), /network lost/)
	assert.equal(writes, 1)
	c.stop()
})
test('masked Point Color scales values and supplies exact ownership to the real handler', async () => {
	const s = mask(),
		requests = []
	const c = client(async (url) => {
		if (url === '/masking/state') return structuredClone(s)
		requests.push(url)
		checkMaskRoute(url)
		const q = new URL(url, 'http://fixture').searchParams
		s.pointColor[q.get('field')] = Number(q.get('value'))
		return requestResult
	})
	for (const id of ['HueShift', 'SatScale', 'LumScale']) await c.numeric('mask-point-color_' + id, 'set', 25)
	assert.equal(requests.length, 3)
	for (const url of requests) {
		const q = new URL(url, 'http://fixture').searchParams
		assert.equal(q.get('value'), '0.25')
		assert.equal(q.get('selectedMaskGroupId'), 'group-one')
		assert.equal(q.get('selectedIndex'), '1')
	}
	c.stop()
})
test('regular Masking uses one begin/end with the same original binding', async () => {
	const s = mask(),
		requests = []
	const c = client(async (url) => {
		if (url === '/masking/state') return structuredClone(s)
		requests.push(url)
		checkMaskRoute(url)
		const u = new URL(url, 'http://fixture')
		if (u.pathname.endsWith('/end'))
			s.corrections.find((x) => x.parameter === 'local_Texture').value = Number(u.searchParams.get('value'))
		return requestResult
	})
	await c.numeric('local_Texture', 'set', 30)
	assert.equal(requests.length, 2)
	const a = new URL(requests[0], 'http://fixture'),
		b = new URL(requests[1], 'http://fixture')
	assert.ok(a.pathname.endsWith('/begin'))
	assert.ok(b.pathname.endsWith('/end'))
	for (const key of [...maskFields, 'gestureId', 'selectedMaskGroupId'])
		assert.equal(a.searchParams.get(key), b.searchParams.get(key))
	c.stop()
})
test('Blue curve inset endpoint survives adding/deleting interior points', async () => {
	const s = ownCurve(),
		requests = []
	const c = client(async (url) => {
		if (url === '/tone-curve/state') return { ok: true, pointCurve: structuredClone(s) }
		requests.push(url)
		const u = new URL(url, 'http://fixture')
		if (u.pathname.endsWith('/end')) {
			const points = curveDefinition.parseCurve(u.searchParams.get('points'))
			assert.ok(points)
			s.curves.blue = points
		}
		return requestResult
	})
	await c.curve(false, 'blue', 'add', 2, 120, 125)
	assert.equal(s.curves.blue[0], 2)
	await c.curve(false, 'blue', 'delete', 2, 0, 0)
	assert.equal(s.curves.blue[0], 2)
	assert.equal(requests.length, 4)
	c.stop()
})
test('missing swatch is rejected without a write', async () => {
	let writes = 0
	const c = client(async (url) => {
		if (url === '/point-color/state') return { state: pc(), context: ctx, contextOwned: true }
		writes++
		return requestResult
	})
	await assert.rejects(c.button('point-color_swatch_8'), /does not exist/)
	assert.equal(writes, 0)
	c.stop()
})
test('Companion presets reference actual action IDs and the connection label', () => {
	const self = {
			label: 'My LRBridge',
			getFeedbackSliderChoices: () => reference.sliders.map((x) => ({ id: x.id, label: x.label })),
		},
		sections = [],
		presets = {}
	appendControllerPresets(self, sections, presets)
	const actions = controllerActions(self)
	for (const [id, p] of Object.entries(presets)) {
		assert.doesNotMatch(p.elements.find((e) => e.type === 'text').text, /\$\(this:/, id)
		for (const s of p.steps)
			for (const list of Object.values(s)) for (const a of list) assert.ok(actions[a.actionId], `${id}: ${a.actionId}`)
	}
	assert.ok(sections.length > 20)
	assert.ok(Object.keys(presets).length > 900)
})

test('global swatch selection satisfies the real beta.4 ownership contract', async () => {
	const s = pc()
	let written
	const pointFields = ['selectedPhotoUuid', 'contextCounter', 'developCounter', 'contextChangedAt', 'serverEpoch']
	const world = {
		...sandbox,
		POINT_COLOR_BINDING_FIELDS: pointFields,
		pointColor: { get: () => s, requestRefresh() {} },
		pointColorObservedBinding: binding,
		pointColorBinding: () => binding,
		pointColorBindingMatches: (b) => pointFields.every((k) => String(b[k]) === String(binding[k])),
		exactQueryFields: (req, k) => {
			exact(req, k)
			return true
		},
		rejectInvalidCommand: () => assert.fail('invalid swatch request'),
		queueOrReject: (res, command) => {
			written = command
			s.selectedIndex = command.selectedIndex
			return res.json({ ok: true })
		},
	}
	const fn = vm.runInNewContext('(' + routeNodes.get('/point-color/sample') + ')', world)
	const c = client(async (url) => {
		if (url === '/point-color/state') return { state: structuredClone(s), context: binding, contextOwned: true }
		const req = { query: Object.fromEntries(new URL(url, 'http://fixture').searchParams) }
		let response
		fn(req, {
			status(n) {
				assert.ok(n < 400)
				return this
			},
			json(v) {
				response = v
				return this
			},
		})
		return response
	})
	await c.button('point-color_swatch_3')
	assert.equal(written.selectedIndex, 3)
	assert.equal(written.expectedSelectedPhotoUuid, 'photo-one')
	c.stop()
})
test('export requested result is accepted without claiming exported files are complete', async () => {
	let id
	const c = client(async (url) => {
		const u = new URL(url, 'http://fixture')
		if (u.pathname === '/context') return { ...ctx }
		if (u.pathname === '/export/state')
			return {
				...binding,
				available: true,
				ageMs: 0,
				previousSupported: true,
				selectionToken: 'selection',
				...(id ? { lastResult: { requestId: id, outcome: 'requested' } } : {}),
			}
		id = u.searchParams.get('requestId')
		return { ok: true }
	})
	await c.button('export_previous')
	assert.match(c.lastStatus, /accepted the export request/)
	c.stop()
})
test('disabled and ambiguous profiles produce no write', async () => {
	let writes = 0
	const s = {
		profile: {
			options: [
				{ label: 'Disabled', token: 'a', enabled: false, writable: true },
				{ label: 'Duplicate', token: 'b', enabled: true, writable: true },
				{ label: 'Duplicate', token: 'c', enabled: true, writable: true },
			],
		},
	}
	const c = client(async (url) => {
		if (url === '/develop-categorical/state') return { state: {}, profile: s.profile }
		writes++
		return requestResult
	})
	await assert.rejects(c.choose('profile', 'Disabled'), /unavailable/)
	await assert.rejects(c.choose('profile', 'Duplicate'), /ambiguous/)
	assert.equal(writes, 0)
	c.stop()
})
test('native Reset admission blocks only its own slider and releases before completion', async () => {
	let release, body
	const events = [],
		capabilities = new Promise((r) => (release = r))
	const c = client(
		async (url, b) => {
			if (url === '/reset/capabilities') return capabilities
			if (url === '/reset') {
				body = b
				events.push('reset admitted')
				return { receipt: { operationId: 'rc-1' } }
			}
			if (url.startsWith('/reset/result')) {
				await new Promise((r) => setTimeout(r, 20))
				return {
					receipt: {
						serverEpoch: body.serverEpoch,
						requestId: body.requestId,
						operationId: 'rc-1',
						phase: 'complete',
						result: { ...body, operationId: 'rc-1', outcome: 'observed', sdkValue: 0 },
					},
				}
			}
			if (url === '/context') return ctx
			throw Error(url)
		},
		async (slider) => events.push(slider),
	)
	const reset = c.numeric('Exposure', 'reset'),
		same = c.numeric('Exposure', 'adjust', 1),
		other = c.numeric('Contrast', 'adjust', 5)
	await other
	assert.deepEqual(events, ['Contrast'])
	release({ supported: true, serverEpoch: 'test-epoch', context: ctx })
	await same
	assert.deepEqual(events, ['Contrast', 'reset admitted', 'Exposure'])
	await reset
	c.stop()
})
test('adjacent queued encoder ticks coalesce and keep the resulting displayed units', async () => {
	const s = pc()
	let unblock,
		writes = 0
	const blocked = new Promise((r) => (unblock = r))
	const c = client(async (url) => {
		if (url === '/point-color/state') return { state: structuredClone(s), context: binding, contextOwned: true }
		const u = new URL(url, 'http://fixture')
		writes++
		if (writes === 1) await blocked
		s[u.searchParams.get('field')] = Number(u.searchParams.get('value'))
		return requestResult
	})
	const first = c.numeric('point-color_HueShift', 'adjust', 1)
	await new Promise((r) => setTimeout(r, 0))
	const remaining = Array.from({ length: 20 }, () => c.numeric('point-color_HueShift', 'adjust', 1))
	unblock()
	await Promise.all([first, ...remaining])
	assert.equal(writes, 2)
	assert.equal(s.HueShift, 0.21)
	c.stop()
})
test('brush Reset uses returned native value rather than a guessed zero', async () => {
	const s = {
		...binding,
		windowsNative: { available: true, brush: { size: { available: true, value: 40, min: 1, max: 100 } } },
	}
	const c = client(async (url) => {
		if (url === '/lens-blur/state') return { state: s, context: ctx }
		assert.equal(url, '/lens-blur/brush/size/reset')
		return { windowsNative: { available: true, brush: { size: { available: true, value: 17, min: 1, max: 100 } } } }
	})
	await c.numeric('blur_brush_size', 'reset')
	assert.equal(c.numericValues.get('blur_brush_size').value, 17)
	c.stop()
})
test('regular Masking Reset consumes its exact correction result and actual value', async () => {
	const s = mask()
	let sent = false
	const c = client(async (url) => {
		if (url === '/masking/state') return structuredClone(s)
		assert.ok(url.startsWith('/masking/correction/reset?'))
		checkMaskRoute(url)
		sent = true
		s.corrections.find((x) => x.parameter === 'local_Texture').value = 12
		s.correctionResults = [{ parameter: 'local_Texture', sequence: 8, outcome: 'confirmed' }]
		return { ok: true, correctionSequence: 8 }
	})
	await c.numeric('local_Texture', 'reset')
	assert.ok(sent)
	assert.equal(c.numericValues.get('local_Texture').value, 12)
	c.stop()
})
