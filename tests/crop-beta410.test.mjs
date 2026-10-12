import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ControllerClient } from '../dist/controller-client.js'
const require = createRequire(import.meta.url)
const reference = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const commands = require(path.join(reference, 'server/commands.js'))
const { runLua } = require('./helpers/lua.cjs')
const flush = async () => {
	for (let i = 0; i < 60; i++) await Promise.resolve()
}
const deferred = () => {
	let resolve
	const promise = new Promise((r) => {
		resolve = r
	})
	return { promise, resolve }
}

// Actual beta.4 admission/coalescing queue; SDK execution and fresh feedback are
// simulated independently from HTTP acknowledgement, including deliberately slow replies.
function fixture(t, options = {}) {
	t.mock.method(console, 'log', () => {})
	commands.resetQueueForTests()
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'a',
		contextCounter: 1,
		contextChangedAt: 10,
		developCounter: 3,
	}
	let angle = options.angle ?? 0,
		reads = 0,
		holds = 0,
		highWater = 0
	const writes = [],
		execution = [],
		dequeued = [],
		requests = []
	const client = new ControllerClient({
		changed() {},
		async adjust() {
			throw Error('Crop must use its dedicated absolute SDK route')
		},
		sliderMutationStarted() {
			holds++
			let active = true
			return () => {
				if (active) holds--
				active = false
			}
		},
		async request(url) {
			const u = new URL(url, 'http://fixture')
			requests.push(u.pathname)
			if (u.pathname === '/context') return structuredClone(ctx)
			if (u.pathname === '/diagnostics/queue') {
				if (options.dequeue !== false) {
					let command
					while ((command = commands.getNextCommand())) dequeued.push(command)
				}
				return commands.getQueueDiagnostics()
			}
			if (u.pathname === '/feedback/request-many') {
				assert.equal(u.searchParams.get('sliders'), 'CropAngle')
				return { ok: true, request: { id: ++reads } }
			}
			if (u.pathname === '/feedback/snapshot') {
				await options.beforeFeedback?.(writes.length, Number(u.searchParams.get('id')))
				if (options.consume !== false) {
					let command
					while ((command = dequeued.shift() || commands.getNextCommand())) {
						angle = command.command === 'photo.crop_angle.reset' ? 0 : command.value
						execution.push(command)
					}
				}
				return {
					ok: true,
					snapshot: {
						complete: true,
						results: {
							CropAngle: { available: options.available !== false, value: angle, range: { min: -45, max: 45 } },
						},
					},
				}
			}
			if (u.pathname === '/command') {
				const command = Object.fromEntries(u.searchParams)
				if (command.value !== undefined) {
					assert.match(command.value, /^-?\d+(?:\.\d{1,2})?$/)
					command.value = Number(command.value)
				}
				assert.equal(commands.validateCommand(command), true)
				writes.push(command)
				assert.equal(commands.tryEnqueueCommand(command).accepted, true)
				highWater = Math.max(highWater, commands.getStatus().queueLength)
				await options.afterAdmission?.(writes.length)
				if (options.failWrite) throw Error('Lost Crop response after admission')
				return { ok: true, queued: command }
			}
			throw Error(`Unexpected request ${u.pathname}`)
		},
	})
	t.after(() => client.stop())
	return {
		client,
		ctx,
		writes,
		execution,
		requests,
		setAngle(value) {
			angle = value
		},
		get holds() {
			return holds
		},
		get highWater() {
			return highWater
		},
		get reads() {
			return reads
		},
	}
}

test('Crop sequential awaited callbacks remain responsive during a slow HTTP acknowledgement and coalesce latest intent', async (t) => {
	const gate = deferred()
	const f = fixture(t, { afterAdmission: (n) => (n === 1 ? gate.promise : undefined) })
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	assert.equal(f.writes.length, 1)
	for (let i = 0; i < 100; i++) await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.numeric('crop_angle', 'adjust', -1)
	assert.equal(f.writes.length, 1)
	assert.ok(f.holds > 0)
	assert.equal(f.client.numericValues.get('crop_angle').value, 0, 'Intent is not displayed as confirmed feedback')
	gate.resolve()
	await f.client.cropAngle.idle()
	assert.deepEqual(
		f.writes.map((x) => x.value),
		[0.1, 10],
	)
	assert.ok(f.highWater <= 1, 'Bridge retains at most its latest unsent Crop command')
	assert.equal(f.client.numericValues.get('crop_angle').value, 10)
	assert.equal(f.holds, 0)
})

test('Crop preserves immediate reversal at both end stops while the initial SDK baseline is delayed', async (t) => {
	for (const [angle, sign, expected] of [
		[45, 1, 44.9],
		[-45, -1, -44.9],
	]) {
		const gate = deferred()
		let first = true
		const f = fixture(t, {
			angle,
			beforeFeedback: () => {
				if (first) {
					first = false
					return gate.promise
				}
			},
		})
		for (let i = 0; i < 200; i++) await f.client.numeric('crop_angle', 'adjust', sign)
		await f.client.numeric('crop_angle', 'adjust', -sign)
		gate.resolve()
		await f.client.cropAngle.idle()
		assert.deepEqual(
			f.writes.map((x) => x.value),
			[expected],
		)
		f.client.stop()
	}
})

test('Crop Reset discards unsent turns, fences bridge coalescing and bases later turns on confirmed zero', async (t) => {
	const writeGate = deferred(),
		resetGate = deferred()
	const f = fixture(t, {
		angle: 5,
		afterAdmission: (n) => (n === 1 ? writeGate.promise : undefined),
		beforeFeedback: (n) => (n === 2 ? resetGate.promise : undefined),
	})
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	await f.client.numeric('crop_angle', 'adjust', 100)
	const reset = f.client.numeric('crop_angle', 'reset')
	await f.client.numeric('crop_angle', 'adjust', 1)
	writeGate.resolve()
	await flush()
	assert.equal(f.writes.length, 2)
	assert.equal(f.writes[1].command, 'photo.crop_angle.reset')
	assert.equal(f.client.numericValues.get('crop_angle').value, 5)
	resetGate.resolve()
	await reset
	await f.client.cropAngle.idle()
	assert.equal(f.writes[2].value, 0.1)
	assert.ok(
		f.execution.some((x) => x.command === 'photo.crop_angle.reset'),
		'Reset executes before next set can coalesce it away',
	)
	assert.equal(f.client.numericValues.get('crop_angle').value, 0.1)
})

test('Crop Reset cannot be replaced while queued even when independent SDK feedback already reads zero', async (t) => {
	const options = { consume: false, dequeue: false }
	const f = fixture(t, options)
	await f.client.read('crop')
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	const executing = commands.getNextCommand()
	assert.equal(executing.value, 0.1, 'Previous set has left queue but its SDK execution is still pending')
	let resetDone = false
	const reset = f.client.numeric('crop_angle', 'reset').then(() => {
		resetDone = true
	})
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	assert.equal(f.writes.length, 2)
	assert.equal(f.writes[1].command, 'photo.crop_angle.reset')
	assert.equal(commands.getQueueDiagnostics().queue.pending.byCommand['photo.crop_angle.reset'], 1)
	assert.equal(resetDone, false)
	assert.ok(f.holds > 0)
	f.setAngle(executing.value)
	options.dequeue = true
	options.consume = true
	await reset
	await f.client.cropAngle.idle()
	assert.equal(f.execution[0].command, 'photo.crop_angle.reset')
	assert.equal(f.writes[2].value, 0.1)
	assert.equal(f.holds, 0)
})

test('Crop rejects a photo change before sending retained turns and never carries a target to another photo', async (t) => {
	const gate = deferred()
	const f = fixture(t, { afterAdmission: (n) => (n === 1 ? gate.promise : undefined) })
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	await f.client.numeric('crop_angle', 'adjust', 1)
	f.ctx.selectedPhotoUuid = 'b'
	f.ctx.contextCounter++
	gate.resolve()
	await f.client.cropAngle.idle()
	assert.equal(f.writes.length, 1)
	assert.match(f.client.lastError, /Photo changed/)
	assert.equal(f.holds, 0)
})

test('Crop uncertain admission discards retained turns without retry and releases cooldown hold', async (t) => {
	const gate = deferred()
	const f = fixture(t, { failWrite: true, afterAdmission: () => gate.promise })
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	for (let i = 0; i < 10; i++) await f.client.numeric('crop_angle', 'adjust', 1)
	gate.resolve()
	await f.client.cropAngle.idle()
	assert.equal(f.writes.length, 1)
	assert.match(f.client.lastError, /Lost Crop response/)
	assert.equal(f.holds, 0)
})

test('Crop late feedback after failure restarts confirmation for a new gesture without releasing its Reset barrier', async (t) => {
	const oldRead = deferred(),
		newRead = deferred()
	const f = fixture(t, {
		beforeFeedback: (writes, id) => (id === 2 ? oldRead.promise : writes >= 3 ? newRead.promise : undefined),
		afterAdmission: (n) => {
			if (n === 2) throw Error('Lost second Crop response')
		},
	})
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	assert.equal(f.reads, 2)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	assert.match(f.client.lastError, /Lost second/)
	let resetDone = false
	const reset = f.client.numeric('crop_angle', 'reset').then(() => {
		resetDone = true
	})
	await flush()
	assert.equal(f.writes.length, 3)
	oldRead.resolve()
	await flush()
	assert.ok(f.reads >= 4, 'Old feedback retirement starts current gesture confirmation')
	assert.equal(resetDone, false, 'Old generation result cannot satisfy new Reset promise')
	assert.ok(f.holds > 0)
	newRead.resolve()
	await reset
	await f.client.cropAngle.idle()
	assert.equal(f.holds, 0)
	assert.equal(f.client.numericValues.get('crop_angle').value, 0)
})

test('Crop a stale pre-admission read cannot confirm a newer target even when its value matches', async (t) => {
	const gate = deferred()
	let held = false
	const f = fixture(t, {
		beforeFeedback: (n) => {
			if (n === 1 && !held) {
				held = true
				return gate.promise
			}
		},
	})
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	assert.equal(f.reads, 2)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	assert.equal(f.writes.length, 2)
	gate.resolve()
	await f.client.cropAngle.idle()
	assert.ok(f.reads >= 3, 'New target requires a read initiated after its admission')
	assert.equal(f.client.numericValues.get('crop_angle').value, 0.2)
})

test('Crop superseded post-Reset feedback cannot use old cached zero to release the Reset barrier', async (t) => {
	const postReset = deferred(),
		newerPoll = deferred()
	const options = {
		consume: false,
		beforeFeedback: (_writes, id) => (id === 2 ? postReset.promise : id === 3 ? newerPoll.promise : undefined),
	}
	const f = fixture(t, options)
	await f.client.read('crop')
	assert.equal(f.client.numericValues.get('crop_angle').value, 0)
	f.setAngle(5)
	let resetDone = false
	const reset = f.client.numeric('crop_angle', 'reset').then(() => {
		resetDone = true
	})
	await flush()
	assert.equal(f.reads, 2)
	const poll = f.client.read('crop')
	await flush()
	assert.equal(f.reads, 3)
	await f.client.numeric('crop_angle', 'adjust', 1)
	postReset.resolve()
	await flush()
	assert.equal(resetDone, false, 'Fresh SDK angle 5 cannot be replaced by cached 0 to confirm Reset')
	assert.equal(f.writes.length, 1, 'Queued turn stays behind Reset instead of replacing it in the bridge queue')
	assert.ok(f.holds > 0)
	options.consume = true
	newerPoll.resolve()
	await poll
	await reset
	await f.client.cropAngle.idle()
	assert.equal(f.writes[1].value, 0.1)
	assert.equal(f.holds, 0)
})

test('Crop stop during an admitted write cancels unsent turns and releases its hold without later feedback', async (t) => {
	const gate = deferred()
	const f = fixture(t, { afterAdmission: () => gate.promise })
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	await f.client.numeric('crop_angle', 'adjust', 1)
	f.client.stop()
	const count = f.requests.length
	gate.resolve()
	await f.client.cropAngle.idle()
	assert.equal(f.writes.length, 1)
	assert.equal(f.requests.length, count)
	assert.equal(f.holds, 0)
	assert.equal(f.client.numericValues.size, 0)
})

test('Crop unconfirmed target expires without retrying and old target cannot seed a later gesture', async (t) => {
	const gate = deferred()
	const options = { consume: false, beforeFeedback: (n) => (n ? gate.promise : undefined) }
	const f = fixture(t, options)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await flush()
	f.client.cropAngle.session.expires = 0
	gate.resolve()
	await f.client.cropAngle.idle()
	assert.equal(f.writes.length, 1)
	assert.match(f.client.lastError, /did not confirm/)
	assert.equal(f.holds, 0)
	commands.resetQueueForTests()
	options.consume = true
	await f.client.numeric('crop_angle', 'adjust', -1)
	await f.client.cropAngle.idle()
	assert.equal(f.writes.at(-1).value, -0.1)
})

function luaFixture(assertions) {
	runLua(`
local moduleName = "develop"
local photoA, photoB = {}, {}
local photo = photoA
local sleeps, switches, writes, resets = {}, {}, {}, {}
local onSleep, onRange, onTracking
local switchSucceeds = true
local sdk = {
 LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return photo end } end },
 LrApplicationView = { getCurrentModuleName = function() return moduleName end,
 switchToModule = function(name) switches[#switches+1] = name; if switchSucceeds then moduleName = name end end },
 LrTasks = { sleep = function(seconds) sleeps[#sleeps+1] = seconds; if onSleep then onSleep() end end },
 LrDevelopController = {
 getRange = function(parameter) assert(parameter == "straightenAngle"); if onRange then onRange() end; return -45,45 end,
 startTracking = function(parameter) assert(parameter == "straightenAngle"); if onTracking then onTracking() end end,
 setValue = function(parameter, value) writes[#writes+1] = {parameter = parameter, value = value, photo = photo} end,
 resetToDefault = function(parameter) resets[#resets+1] = parameter end }
}
function import(name) return assert(sdk[name], name) end
local Crop = assert(loadfile(${JSON.stringify(path.join(reference, 'lightroom/LRBridge.lrplugin/Crop.lua'))}))()
local function rejects(call) assert(not pcall(call), "Expected refusal before writing") end
${assertions}
`)
}

test('Actual Crop Lua eliminates per-turn module pause while Develop is already active', () => {
	luaFixture(`
assert(Crop.setAngle(12.34)); assert(Crop.setAngle(-45)); assert(Crop.setAngle(45)); assert(Crop.resetAngle())
assert(#sleeps == 0 and #switches == 0)
assert(#writes == 3 and #resets == 1 and resets[1] == "straightenAngle")
assert(writes[1].parameter == "straightenAngle" and writes[1].value == 12.34 and writes[1].photo == photoA)
`)
})

test('Actual Crop Lua retains the module transition wait and verifies photo after all yielding SDK calls', () => {
	luaFixture(
		`moduleName = "library"; assert(Crop.setAngle(0.1)); assert(#sleeps == 1 and sleeps[1] == 0.2 and #writes == 1)`,
	)
	for (const setup of [
		'moduleName = "library"; onSleep = function() photo = photoB end',
		'moduleName = "library"; switchSucceeds = false',
		'onRange = function() photo = photoB end',
		'onRange = function() moduleName = "library" end',
		'onTracking = function() photo = photoB end',
		'onTracking = function() moduleName = "library" end',
	])
		luaFixture(`${setup}; rejects(function() Crop.setAngle(1) end); assert(#writes == 0)`)
})

test('Actual Crop Lua retains dedicated range and two-decimal input validation, including Reset context safety', () => {
	luaFixture(`
for _,value in ipairs({45.01,-45.01,1.001,math.huge}) do rejects(function() Crop.setAngle(value) end) end
assert(#writes == 0 and #sleeps == 0)
onRange = function() photo = photoB end
rejects(function() Crop.resetAngle() end); assert(#resets == 0)
`)
})
