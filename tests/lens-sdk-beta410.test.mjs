import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { ControllerClient } from '../dist/controller-client.js'
import { buttonById, numericById } from '../dist/controller-catalog.js'
import { controllerFeedbacks } from '../dist/controller-companion.js'

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const definition = require(path.join(root, 'server/lens-blur-state.js'))
const { validateCommand } = require(path.join(root, 'server/commands.js'))
const source = fs.readFileSync(path.join(root, 'server/bridge.js'), 'utf8')
const tree = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true)
const handlers = new Map()
function visit(node) {
	if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.get' && ts.isStringLiteral(node.arguments[0]))
		handlers.set(node.arguments[0].text, node.arguments[1].getText(tree))
	ts.forEachChild(node, visit)
}
visit(tree)
const flush = async () => {
	for (let i = 0; i < 60; i++) await Promise.resolve()
}

// Run the packaged bridge HTTP handlers, state invalidation and command validator.
// Only Windows reading, HTTP transport and Lightroom SDK execution are simulated.
function fixture(options = {}) {
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'photo-one',
		contextCounter: 1,
		contextChangedAt: 10,
		developCounter: 2,
	}
	const lens = definition.createLensBlurState()
	const sdk = {
		activeAvailable: true,
		active: true,
		bokehAvailable: true,
		bokeh: 'Circle',
		selectedToolAvailable: true,
		selectedTool: 'loupe',
		focalRangeSourceAvailable: false,
		focalRangeAvailable: false,
	}
	assert.ok(lens.update(sdk))
	const native = {
		brush: { size: { available: true, value: 20, min: 0, max: 100 } },
		autoMask: { available: true, value: true },
		refinementMode: 'focus',
	}
	const calls = [],
		writes = [],
		waiting = []
	let readCount = 0
	const world = vm.createContext({
		lensBlur: lens,
		lensBlurDefinition: definition,
		context: { getContextFields: () => ({ ...ctx }) },
		exactQueryFields: (req, keys) => JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...keys].sort()),
		windowsNativeBackend: {
			async readState() {
				await options.windowsWait
				return structuredClone(native)
			},
		},
		windowsNativeDefinition: {
			sanitizeNativeState: (s) => s,
			unavailableNativeState: (reason) => ({ available: false, reason }),
		},
		queueOrReject(res, command, _unused, onAdmit) {
			assert.ok(validateCommand(command), 'Real LRBridge accepts the command')
			writes.push(structuredClone(command))
			waiting.push(command)
			onAdmit?.()
			res.json({ ok: true, queued: true })
		},
		rejectInvalidCommand() {
			throw Error('Invalid command')
		},
	})
	function execute() {
		while (waiting.length) {
			const command = waiting.shift()
			if (command.command === 'lens_blur.bokeh.set') sdk.bokeh = command.value
			else if (command.command === 'lens_blur.active.set') sdk.active = command.enabled
			else sdk.selectedTool = command.command.endsWith('.select') ? 'depth_refinement' : 'loupe'
			ctx.developCounter++
			assert.ok(lens.update(sdk))
		}
	}
	const client = new ControllerClient({
		changed() {},
		async adjust() {
			throw Error('Unexpected numeric write')
		},
		async request(url) {
			const u = new URL(url, 'http://fixture')
			calls.push(url)
			if (u.pathname === '/context') return { ...ctx }
			if (u.pathname === '/lens-blur/auto-mask') return { ok: true }
			if (u.pathname === '/lens-blur/state') {
				readCount++
				await options.beforeRead?.({ ctx, readCount })
				if (!options.deferExecution) execute()
			}
			let status = 200,
				body
			const res = {
				status(code) {
					status = code
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
			assert.ok(handlers.has(u.pathname), u.pathname)
			await vm.runInContext('(' + handlers.get(u.pathname) + ')', world)(
				{ query: Object.fromEntries(u.searchParams) },
				res,
			)
			if (u.pathname === '/lens-blur/state' && options.afterRead)
				body = (await options.afterRead(structuredClone(body), readCount)) ?? body
			if (u.pathname !== '/lens-blur/state') await options.afterMutation?.()
			if (status >= 400) throw Error(body.error || `HTTP ${status}`)
			if (options.failAfterAdmission && u.pathname === '/lens-blur/bokeh')
				throw Error('Connection lost after admission')
			return structuredClone(body)
		},
	})
	const feedback = controllerFeedbacks({ controller: client }).controller_selected.callback
	return {
		client,
		ctx,
		lens,
		sdk,
		calls,
		writes,
		execute,
		options,
		feedback(id) {
			return feedback({ id: 'feedback-' + id, options: { control: id } })
		},
	}
}

test('Bokeh press and selected feedback use SDK-only reads and confirm the actual shape', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	const f = fixture({ deferExecution: true })
	try {
		await f.client.button('bokeh_SoapBubble')
		assert.equal(f.writes.length, 1)
		assert.equal(f.writes[0].value, 'SoapBubble')
		assert.equal(f.feedback('bokeh_SoapBubble'), false, 'HTTP admission is not optimistic selected feedback')
		await flush()
		f.execute()
		t.mock.timers.tick(80)
		await flush()
		assert.equal(f.feedback('bokeh_SoapBubble'), true)
		assert.ok(f.calls.filter((url) => url.startsWith('/lens-blur/state')).every((url) => url.endsWith('?sdkOnly=true')))
	} finally {
		f.client.stop()
	}
})

test('A blocked Windows preflight cannot hold Bokeh dispatch or overwrite its SDK feedback', async () => {
	let release
	const windowsWait = new Promise((resolve) => {
		release = resolve
	})
	const f = fixture()
	try {
		await f.client.read('lens-blur')
		f.options.windowsWait = windowsWait
		const slow = f.client.button('blur_auto_mask_true').catch(() => {})
		await flush()
		assert.equal(f.client.isPending('lens-blur'), true)
		await f.client.button('bokeh_Blade')
		assert.equal(f.writes.length, 1, 'Bokeh reaches the bridge while automation read is blocked')
		await f.client.read('lens-blur-sdk')
		assert.equal(f.feedback('bokeh_Blade'), true)
		assert.equal(
			f.client.numericValues.get('blur_brush_size').value,
			20,
			'SDK-only publication does not erase Windows brush feedback',
		)
		release()
		await slow
		assert.equal(f.feedback('bokeh_Blade'), true)
		assert.equal(
			f.client.numericValues.get('blur_brush_size').available,
			false,
			'Bridge rejects Windows state spanning a Develop change',
		)
		f.options.windowsWait = undefined
		await f.client.read('lens-blur')
		assert.equal(f.client.numericValues.get('blur_brush_size').value, 20, 'Windows brush feedback retained separately')
		assert.equal(f.feedback('blur_auto_mask_true'), true)
	} finally {
		release()
		f.client.stop()
	}
})

test('Apply and Depth Refinement tool controls also use SDK-only state', async () => {
	const f = fixture()
	try {
		for (const id of ['blur_apply_false', 'blur_apply_true', 'blur_depth_tool_select', 'blur_depth_tool_close']) {
			await f.client.button(id)
			await f.client.read('lens-blur-sdk')
			assert.equal(f.feedback(id), true)
		}
		assert.equal(f.writes.length, 4)
		assert.ok(f.calls.filter((url) => url.startsWith('/lens-blur/state')).every((url) => url.endsWith('?sdkOnly=true')))
		assert.equal(numericById.get('blur_brush_size').family, 'lens-blur')
		assert.equal(
			buttonById.get('blur_depth_true').family,
			'lens-blur',
			'Visualize Depth still requires its native reader',
		)
	} finally {
		f.client.stop()
	}
})

test('Consecutive Bokeh targets survive developCounter advancing for the preceding edit', async () => {
	const f = fixture()
	try {
		await Promise.all([f.client.button('bokeh_Blade'), f.client.button('bokeh_Ring')])
		assert.deepEqual(
			f.writes.map((v) => v.value),
			['Blade', 'Ring'],
		)
		await f.client.read('lens-blur-sdk')
		assert.equal(f.feedback('bokeh_Ring'), true)
	} finally {
		f.client.stop()
	}
})

test('Photo change after Bokeh invocation cancels before writing', async () => {
	const f = fixture({
		beforeRead({ ctx }) {
			ctx.selectedPhotoUuid = 'photo-two'
			ctx.contextCounter++
		},
	})
	try {
		await assert.rejects(f.client.button('bokeh_Blade'), /Photo or module changed/)
		assert.equal(f.writes.length, 0)
	} finally {
		f.client.stop()
	}
})

test('Targeted Bokeh feedback follows SDK completion beyond the first cached read', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	const f = fixture({ deferExecution: true })
	try {
		await f.client.button('bokeh_Anamorphic')
		t.mock.timers.tick(80)
		await flush()
		assert.equal(f.client.snapshots.get('lens-blur-sdk').bokehAvailable, false)
		f.execute()
		t.mock.timers.tick(80)
		await flush()
		assert.equal(f.feedback('bokeh_Anamorphic'), true)
		assert.equal(f.writes.length, 1)
	} finally {
		f.client.stop()
	}
})

test('An uncertain Bokeh response is never automatically resent', async () => {
	const f = fixture({ failAfterAdmission: true })
	try {
		await assert.rejects(f.client.button('bokeh_Blade'), /Connection lost/)
		assert.equal(f.writes.length, 1)
		assert.match(f.client.lastError, /Connection lost/)
	} finally {
		f.client.stop()
	}
})

test('A warm Bokeh press dispatches after one context check without another SDK preflight', async () => {
	const f = fixture()
	try {
		await f.client.read('lens-blur-sdk')
		f.calls.length = 0
		await f.client.button('bokeh_Blade')
		assert.deepEqual(f.calls.slice(0, 2), ['/context', '/lens-blur/bokeh?value=Blade'])
		assert.equal(f.writes.length, 1)
	} finally {
		f.client.stop()
	}
})

test('Cold or older-than-750ms Bokeh state still requires SDK readiness before dispatch', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	for (const stale of [false, true]) {
		const f = fixture()
		try {
			if (stale) {
				await f.client.read('lens-blur-sdk')
				t.mock.timers.tick(751)
			}
			f.calls.length = 0
			await f.client.button('bokeh_Blade')
			assert.deepEqual(f.calls.slice(0, 3), [
				'/context',
				'/lens-blur/state?sdkOnly=true',
				'/lens-blur/bokeh?value=Blade',
			])
		} finally {
			f.client.stop()
		}
	}
})

test('Explicit Apply works when its current SDK value is unknown and does not pre-read availability', async () => {
	const f = fixture()
	try {
		f.lens.invalidateActive()
		await f.client.button('blur_apply_true')
		assert.deepEqual(f.calls.slice(0, 2), ['/context', '/lens-blur/apply?enabled=true'])
		assert.equal(f.writes.length, 1)
		await flush()
		assert.equal(f.feedback('blur_apply_true'), true)
	} finally {
		f.client.stop()
	}
})

test('SDK confirmation starts immediately and next read is at 80ms, without optimistic selection', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	const f = fixture({ deferExecution: true })
	try {
		await f.client.read('lens-blur-sdk')
		f.calls.length = 0
		await f.client.button('bokeh_Ring')
		await flush()
		assert.equal(Date.now(), 1000)
		assert.deepEqual(f.calls, ['/context', '/lens-blur/bokeh?value=Ring', '/lens-blur/state?sdkOnly=true'])
		assert.equal(f.feedback('bokeh_Ring'), false)
		t.mock.timers.tick(79)
		await flush()
		assert.equal(f.calls.length, 3)
		f.execute()
		t.mock.timers.tick(1)
		await flush()
		assert.equal(f.feedback('bokeh_Ring'), true)
		assert.equal(Date.now(), 1080)
		assert.equal(f.writes.length, 1)
	} finally {
		f.client.stop()
	}
})

test('Queued warm Bokeh and Apply actions recheck current photo before admission', async () => {
	for (const nextId of ['bokeh_Ring', 'blur_apply_false']) {
		let release
		const admitted = new Promise((resolve) => {
			release = resolve
		})
		const f = fixture({ afterMutation: () => admitted })
		try {
			await f.client.read('lens-blur-sdk')
			const first = f.client.button('bokeh_Blade')
			await flush()
			assert.equal(f.writes.length, 1)
			const next = f.client.button(nextId)
			void next.catch(() => {})
			await flush()
			f.ctx.selectedPhotoUuid = 'photo-two'
			f.ctx.contextCounter++
			release()
			await first
			await assert.rejects(next, /Photo or module changed/)
			assert.equal(f.writes.length, 1, 'Queued action must not follow the user to another photo')
		} finally {
			release()
			f.client.stop()
		}
	}
})

test('A pre-admission SDK read cannot overwrite newer Bokeh confirmation', async () => {
	let release
	const blocked = new Promise((resolve) => {
		release = resolve
	})
	const f = fixture()
	try {
		await f.client.read('lens-blur-sdk')
		f.options.afterRead = async (body, count) => {
			if (count === 2) await blocked
			return body
		}
		const old = f.client.read('lens-blur-sdk')
		await flush()
		await f.client.button('bokeh_Blade')
		await flush()
		assert.equal(f.feedback('bokeh_Blade'), true)
		release()
		await old
		assert.equal(f.feedback('bokeh_Blade'), true)
		assert.equal(f.client.snapshots.get('lens-blur-sdk').revision, 2)
	} finally {
		release()
		f.client.stop()
	}
})

test('Lower SDK revisions cannot replace a pending target, and timeout releases the floor after a bridge restart', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	const f = fixture({ deferExecution: true })
	try {
		await f.client.read('lens-blur-sdk')
		f.options.afterRead = (body) => ({
			...body,
			revision: 0,
			state: { ...body.state, bokehAvailable: true, bokeh: 'Circle' },
		})
		await f.client.button('bokeh_Ring')
		await flush()
		assert.equal(f.client.snapshots.get('lens-blur-sdk').bokehAvailable, false)
		for (let i = 0; i < 32; i++) {
			t.mock.timers.tick(80)
			await flush()
		}
		assert.match(f.client.lastError, /timed out/)
		assert.equal(f.client.lensFollowup, undefined)
		assert.equal(f.writes.length, 1, 'No mutation retries on timeout')
		await f.client.read('lens-blur-sdk')
		assert.equal(
			f.client.snapshots.get('lens-blur-sdk').revision,
			0,
			'New bridge revision is accepted after bounded floor expires',
		)
		assert.equal(f.feedback('bokeh_Circle'), true)
	} finally {
		f.client.stop()
	}
})

test('Stopping the client cancels fast SDK follow-up and leaves no revision floor', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	const f = fixture({ deferExecution: true })
	await f.client.button('bokeh_Ring')
	await flush()
	const count = f.calls.length
	f.client.stop()
	t.mock.timers.tick(1000)
	await flush()
	assert.equal(f.calls.length, count)
	assert.equal(f.client.lensFollowup, undefined)
})

test('Rapid next Bokeh press cannot reuse the invalidated pre-admission availability', async () => {
	const f = fixture({ deferExecution: true })
	try {
		await f.client.read('lens-blur-sdk')
		await f.client.button('bokeh_Blade')
		await flush()
		assert.equal(f.client.snapshots.get('lens-blur-sdk').bokehAvailable, false)
		const next = f.client.button('bokeh_Ring')
		await flush()
		assert.equal(f.writes.length, 1)
		f.execute()
		await next
		assert.deepEqual(
			f.writes.map((v) => v.value),
			['Blade', 'Ring'],
		)
	} finally {
		f.client.stop()
	}
})
