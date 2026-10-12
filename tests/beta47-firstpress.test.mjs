import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import ModuleInstance from '../dist/main.js'

const { ControllerClient } = await import(process.env.LRBRIDGE_CLIENT_MODULE || '../dist/controller-client.js')
const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')

// Real bridge admission, cache expiry, context ownership and result validation;
// only the Lightroom SDK work and its query/result callbacks are simulated.
async function fixture(family, options = {}) {
	const definition = require(path.join(root, `server/${family}-state.js`))
	const install = require(path.join(root, `server/${family}-routes.js`))
	const create = Object.entries(definition).find(([key]) => /^create.*State$/.test(key))[1]
	const ctx = {
		activeModule: options.module || 'develop',
		selectedPhotoUuid: 'photo-one',
		contextCounter: 1,
		developCounter: 3,
		contextChangedAt: 100,
	}
	let clock = 10000
	const queries = [],
		writes = [],
		waiting = [],
		reads = []
	let snapshot =
		family === 'remove'
			? { available: false, selectedTool: 'loupe', reason: 'tool_closed', repair: { available: false } }
			: {
					available: true,
					selectionToken: 'selection-one',
					selectionCount: 1,
					...(family === 'clipboard'
						? { copySupported: true, pasteSupported: true }
						: { dialogSupported: true, previousSupported: true }),
				}
	const state = create({
		serverEpoch: family + '-firstpress',
		getContext: () => ctx,
		now: () => clock,
		enqueue(command) {
			assert.ok(state.matches(command, 'admit'))
			queries.push(command)
			return true
		},
	})
	function publish() {
		const query = family === 'remove' ? state.takeRequest() : queries.shift()
		if (!query) return
		if (family !== 'remove' && !state.matches(query, 'dequeue')) return
		assert.ok(state.acceptQuery({ ...query, ...snapshot }), 'real bridge accepts SDK snapshot')
	}
	function finish() {
		const command = waiting.shift()
		if (!command) return
		assert.ok(state.matches(command, 'dequeue'))
		if (family === 'remove') {
			snapshot =
				command.value === 'dust'
					? {
							available: true,
							selectedTool: 'dust',
							newSpotType: 'heal_patchmatch',
							brushSize: 40,
							brushFeather: 50,
							useGenerativeAI: false,
							detectObjects: false,
							toolOverlay: 'auto',
							visualizeSpots: false,
							visualizationThreshold: 50,
							repair: { available: false },
						}
					: { available: false, selectedTool: 'loupe', reason: 'tool_closed', repair: { available: false } }
			assert.ok(
				state.acceptResult({
					...command,
					...snapshot,
					outcome: options.outcome || 'confirmed',
					detail: 'SDK tool readback',
					otherPreferencesPreserved: true,
					repairEditConfirmed: false,
					repairRemovalConfirmed: false,
					targetRepairToken: null,
				}),
			)
		} else {
			assert.ok(state.claim(command))
			assert.ok(
				state.acceptResult({
					...command,
					outcome: options.outcome || (family === 'clipboard' ? 'success' : 'requested'),
					invoked: true,
					...(family === 'clipboard'
						? { sdkResult: options.outcome === 'uncertain' ? null : true, aiCheckedCount: 0, aiPendingCount: null }
						: {}),
				}),
			)
		}
	}
	if (family === 'remove') await state.refreshSelection()
	state.get(true)
	publish()
	const routes = new Map()
	install(
		{ use() {}, get: (route, handler) => routes.set(route, handler) },
		state,
		{
			ADMISSION_ACCEPTED: 'accepted',
			tryEnqueueCommand(command) {
				assert.ok(definition.validCommand(command))
				assert.ok(state.matches(command, 'admit'))
				writes.push(structuredClone(command))
				waiting.push(command)
				return { status: 'accepted' }
			},
		},
		(req, fields) => JSON.stringify(Object.keys(req.query).sort()) === JSON.stringify([...fields].sort()),
		Number,
	)
	const client = new ControllerClient({
		changed() {},
		async adjust() {
			throw Error('Unexpected Develop write')
		},
		async request(url) {
			const u = new URL(url, 'http://fixture')
			if (u.pathname === '/context') return structuredClone(ctx)
			if (u.pathname === `/${family}/state`) {
				reads.push(url)
				// Model progress of Lightroom's SDK clock. Healing panel preflight
				// requires a genuinely newer query capture, even for a real Open write.
				if (family === 'remove') clock += 401
				await options.beforeRead?.({ ctx, client, state })
				finish()
				publish()
			}
			assert.ok(routes.has(u.pathname), u.pathname)
			let code = 200,
				body
			await routes.get(u.pathname)(
				{ query: Object.fromEntries(u.searchParams) },
				{
					status(value) {
						code = value
						return this
					},
					set() {
						return this
					},
					json(value) {
						body = value
						return this
					},
				},
			)
			if (code >= 400) throw Error(body.error || `HTTP ${code}`)
			return structuredClone(body)
		},
	})
	return {
		client,
		ctx,
		state,
		writes,
		reads,
		options,
		advance(ms) {
			clock += ms
		},
		changePhoto() {
			ctx.selectedPhotoUuid = 'photo-two'
			ctx.contextCounter++
			ctx.developCounter++
			ctx.contextChangedAt++
		},
		closeToolNatively() {
			snapshot = { available: false, selectedTool: 'loupe', reason: 'tool_closed', repair: { available: false } }
		},
		selectToolNatively(tool) {
			snapshot = { available: false, selectedTool: tool, reason: 'tool_closed', repair: { available: false } }
		},
	}
}

for (const [family, id] of [
	['clipboard', 'clipboard_copy'],
	['clipboard', 'clipboard_paste'],
	['export', 'export_dialog'],
	['export', 'export_previous'],
	['remove', 'healing_panel_dust'],
]) {
	test(`${id}: first press uses current photo despite stale Companion family feedback`, async () => {
		const f = await fixture(family)
		try {
			await f.client.read(family)
			f.changePhoto()
			await f.client.button(id)
			assert.equal(f.writes.length, 1)
			assert.equal(f.writes[0].expectedSelectedPhotoUuid, 'photo-two')
		} finally {
			f.client.stop()
		}
	})
	test(`${id}: photo change after invocation cancels before mutation`, async () => {
		const f = await fixture(family)
		try {
			f.options.beforeRead = () => {
				f.options.beforeRead = null
				f.changePhoto()
			}
			await assert.rejects(f.client.button(id), /Photo|photo/)
			assert.equal(f.writes.length, 0)
		} finally {
			f.client.stop()
		}
	})
}

for (const [family, id] of [
	['clipboard', 'clipboard_copy'],
	['clipboard', 'clipboard_paste'],
	['export', 'export_dialog'],
	['export', 'export_previous'],
]) {
	test(`${id}: one press waits for expired available SDK cache to refresh`, async () => {
		const f = await fixture(family)
		try {
			await f.client.read(family)
			f.advance(6001)
			assert.equal(f.state.get(false).available, true)
			assert.equal(f.state.get(false).ageMs, 6001)
			await f.client.button(id)
			assert.equal(f.writes.length, 1)
			assert.ok(f.reads.length >= 3, 'readiness refresh precedes one mutation and completion read')
		} finally {
			f.client.stop()
		}
	})
	test(`${id}: Library module remains supported`, async () => {
		const f = await fixture(family, { module: 'library' })
		try {
			await f.client.button(id)
			assert.equal(f.writes.length, 1)
			assert.equal(f.writes[0].expectedActiveModule, 'library')
		} finally {
			f.client.stop()
		}
	})
	test(`${id}: uncertain completion is never automatically retried`, async () => {
		const f = await fixture(family, { outcome: 'uncertain' })
		try {
			await assert.rejects(f.client.button(id), /confirm|review|retry/i)
			assert.equal(f.writes.length, 1)
			assert.equal(f.state.get(false).needsReview, true)
			await assert.rejects(f.client.button(id))
			assert.equal(f.writes.length, 1, 'review state blocks another mutation')
		} finally {
			f.client.stop()
		}
	})
}

test('Close Healing also uses invocation photo instead of stale Companion family feedback', async () => {
	const f = await fixture('remove')
	try {
		await f.client.button('healing_panel_dust')
		f.changePhoto()
		await f.client.button('healing_panel_loupe')
		assert.equal(f.writes.length, 2)
		assert.equal(f.writes[1].expectedSelectedPhotoUuid, 'photo-two')
		assert.equal(f.writes[1].value, 'loupe')
	} finally {
		f.client.stop()
	}
})

test('Open Healing refreshes an apparent already-open cache after the tool was closed directly in Lightroom', async () => {
	const f = await fixture('remove')
	try {
		await f.client.button('healing_panel_dust')
		await f.client.read('remove')
		f.closeToolNatively()
		f.advance(501)
		f.options.beforeRead = () => f.advance(401)
		assert.equal(f.state.get(false).selectedTool, 'dust', 'bridge still has old tool feedback')
		await f.client.button('healing_panel_dust')
		assert.equal(f.writes.length, 2, 'one new press opens the natively closed tool')
		assert.equal(f.writes[1].expectedValue, 'loupe')
	} finally {
		f.client.stop()
	}
})

test('Open Healing remains a no-op when a newer SDK snapshot confirms the tool is already open', async () => {
	const f = await fixture('remove')
	try {
		await f.client.button('healing_panel_dust')
		await f.client.read('remove')
		f.advance(501)
		f.options.beforeRead = () => f.advance(401)
		await f.client.button('healing_panel_dust')
		assert.equal(f.writes.length, 1)
		assert.match(f.client.lastStatus, /already open/)
	} finally {
		f.client.stop()
	}
})

for (const tool of ['crop', 'masking']) {
	for (const id of ['healing_panel_dust', 'develop.action_selectHealingTool', 'legacy-run-action']) {
		test(`Healing first press opens from actual ${tool} despite recent closed Loupe cache via ${id}`, async () => {
			const f = await fixture('remove')
			try {
				await f.client.read('remove')
				f.selectToolNatively(tool)
				const cached = f.state.get(false)
				assert.equal(cached.selectedTool, 'loupe')
				assert.ok(cached.ageMs < 5000, 'old readiness accepted this recent but obsolete tool')
				if (id === 'legacy-run-action') {
					const module = Object.create(ModuleInstance.prototype)
					Object.assign(module, {
						controller: f.client,
						allowSensitiveAction: () => true,
						setVariableValues() {},
						async callLRBridge() {
							throw Error('Healing must not use the legacy unguarded /action')
						},
					})
					await module.runLightroomAction('selectHealingTool')
				} else await f.client.button(id)
				assert.equal(f.writes.length, 1)
				assert.equal(f.writes[0].expectedValue, tool, 'mutation owns the new SDK tool baseline')
				assert.equal(f.state.get(false).selectedTool, 'dust')
				assert.match(f.client.lastStatus, /confirmed/)
			} finally {
				f.client.stop()
			}
		})
	}
}

test('Healing never resends an uncertain panel write', async () => {
	const f = await fixture('remove', { outcome: 'failed' })
	try {
		await assert.rejects(f.client.button('healing_panel_dust'), /SDK tool readback|failed/)
		assert.equal(f.writes.length, 1)
		assert.match(f.client.lastError, /SDK tool readback|failed/)
	} finally {
		f.client.stop()
	}
})

test('Healing ignores a newer unowned capture before confirming an already-open no-op', async () => {
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'photo',
		contextCounter: 1,
		contextChangedAt: 10,
		developCounter: 2,
	}
	let reads = 0
	const client = new ControllerClient({
		changed() {},
		async adjust() {
			throw Error('Unexpected write')
		},
		async action() {
			throw Error('Legacy action must not bypass panel readiness')
		},
		async request(url) {
			if (url === '/context') return ctx
			assert.equal(url, '/remove/state', 'No mutation should be needed')
			reads++
			return {
				...ctx,
				selectedTool: 'dust',
				available: true,
				capturedAt: 100 + reads,
				ageMs: 0,
				contextOwned: reads !== 2,
			}
		},
	})
	try {
		await client.button('develop.action_selectHealingTool')
		assert.equal(reads, 3, 'Unowned newer snapshot was not accepted')
		assert.match(client.lastStatus, /already open/)
	} finally {
		client.stop()
	}
})

test('New and legacy Healing Open preserve pending-operation and review guards', async () => {
	for (const guard of [{ pendingOperation: { operationId: 'earlier' } }, { needsReview: true }]) {
		for (const id of ['healing_panel_dust', 'develop.action_selectHealingTool']) {
			const ctx = { activeModule: 'develop', selectedPhotoUuid: 'photo', contextCounter: 1, contextChangedAt: 10 }
			const client = new ControllerClient({
				changed() {},
				async adjust() {
					throw Error('Unexpected write')
				},
				async request(url) {
					if (url === '/context') return ctx
					assert.equal(url, '/remove/state', 'Guard must prevent a mutation')
					return { ...ctx, selectedTool: 'crop', capturedAt: 100, ageMs: 0, ...guard }
				},
			})
			try {
				await assert.rejects(client.button(id), /unavailable|pending|Check Lightroom/)
			} finally {
				client.stop()
			}
		}
	}
})
