import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ControllerClient } from '../dist/controller-client.js'
import { controllerActions } from '../dist/controller-companion.js'
import { UpdatePresets } from '../dist/presets.js'

const require = createRequire(import.meta.url)
const root = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const commands = require(path.join(root, 'server/commands.js'))
const flush = async () => {
	for (let i = 0; i < 40; i++) await Promise.resolve()
}
const deferred = () => {
	let resolve, reject
	const promise = new Promise((r, fail) => {
		resolve = r
		reject = fail
	})
	return { promise, resolve, reject }
}

// The actual beta.4 bridge FIFO accepts HTTP requests immediately. Only the
// Lightroom consumer is simulated: one SDK call per tick and native end stops.
// This deliberately does not pretend that HTTP acceptance confirms execution.
function fixture(t, options = {}) {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 })
	t.mock.method(console, 'log', () => {})
	commands.resetQueueForTests()
	const writes = [],
		executed = [],
		requests = [],
		errors = []
	let level = options.level ?? 5
	let highWater = 0
	let nextConsume = Date.now() + 100
	const client = new ControllerClient({
		changed() {},
		async adjust() {
			throw Error('Unexpected Develop write')
		},
		async request(url) {
			requests.push(url)
			const parsed = new URL(url, 'http://fixture')
			if (parsed.pathname === '/diagnostics/queue') {
				await options.beforeDiagnostics?.()
				return options.diagnostics ?? commands.getQueueDiagnostics()
			}
			assert.equal(parsed.pathname, '/command', 'Zoom uses the existing application command contract')
			const command = Object.fromEntries(parsed.searchParams)
			writes.push(command)
			if (options.failBeforeEnqueue) throw Error('Zoom transport failed before acknowledgement')
			const admitted = commands.tryEnqueueCommand(command)
			assert.equal(admitted.accepted, true, 'The actual bridge accepts the exact application command')
			highWater = Math.max(highWater, commands.getStatus().queueLength)
			await options.afterEnqueue?.()
			if (options.failAfterEnqueue) throw Error('Zoom reply lost after bridge acceptance')
			return { ok: true, queued: command }
		},
	})
	// The production node:timers/promises import is captured before MockTimers
	// starts. Inject the scheduler's supported sleep hook to advance all waiting
	// with this fake clock while exercising real Companion callbacks unchanged.
	client.zoom.io.sleep = (ms, signal) =>
		new Promise((resolve) => {
			let timer
			const finish = () => {
				clearTimeout(timer)
				signal?.removeEventListener('abort', finish)
				resolve()
			}
			timer = setTimeout(finish, ms)
			if (signal?.aborted) finish()
			else signal?.addEventListener('abort', finish, { once: true })
		})
	const callback = controllerActions({
		controller: client,
		log: (...args) => errors.push(args),
		setVariableValues() {},
	}).controller_button.callback
	t.after(() => client.stop())
	function consume() {
		const command = commands.getNextCommand()
		if (!command) return
		executed.push(command)
		if (command.action === 'zoom_in') level = Math.min(10, level + 1)
		else if (command.action === 'zoom_out') level = Math.max(0, level - 1)
		else if (command.action === 'zoom_100') level = 5
	}
	return {
		client,
		callback,
		options,
		writes,
		executed,
		requests,
		errors,
		consume,
		get level() {
			return level
		},
		get highWater() {
			return highWater
		},
		async turn(action) {
			let completed = false
			const result = callback({ options: { control: 'application.action_' + action, confirmed: false } })
			Promise.resolve(result).then(() => {
				completed = true
			})
			await flush()
			assert.equal(completed, true, 'Awaited Companion callback accepts intent without waiting for the bridge')
			await result
		},
		async advance(ms, consumeCommands = true) {
			const end = Date.now() + ms
			while (Date.now() < end) {
				t.mock.timers.tick(Math.min(5, end - Date.now()))
				await flush()
				if (Date.now() >= nextConsume) {
					if (consumeCommands) consume()
					nextConsume = Date.now() + 100
				}
				await flush()
			}
		},
	}
}

test('real bridge FIFO reproduces zoom debt when many accepted commands arrive before SDK consumption', (t) => {
	t.mock.method(console, 'log', () => {})
	commands.resetQueueForTests()
	for (let i = 0; i < 60; i++)
		assert.equal(commands.tryEnqueueCommand({ command: 'application.action', action: 'zoom_in' }).accepted, true)
	commands.tryEnqueueCommand({ command: 'application.action', action: 'zoom_out' })
	assert.equal(commands.getQueueDiagnostics().queue.length, 61)
	for (let i = 0; i < 60; i++) assert.equal(commands.getNextCommand().action, 'zoom_in')
	assert.equal(commands.getNextCommand().action, 'zoom_out', 'Reverse waits behind all sixty obsolete zoom-ins')
})

for (const [outward, reverse, level, expected] of [
	['zoom_in', 'zoom_out', 10, 9],
	['zoom_out', 'zoom_in', 0, 1],
]) {
	test(`rotary ${outward} at its end stop stays bounded and reverses without accumulated debt`, async (t) => {
		const f = fixture(t, { level })
		for (let i = 0; i < 120; i++) {
			await f.turn(outward)
			await f.advance(5)
		}
		assert.equal(f.level, level, 'The simulated native end stop does not create a false zoom value')
		assert.equal(f.highWater, 1, 'Instant HTTP replies never create more than one queued command')
		const beforeReverse = f.executed.length
		await f.turn(reverse)
		await f.advance(400)
		const followup = f.executed.slice(beforeReverse).map((c) => c.action)
		assert.ok(followup.length <= 2, 'At most one previously issued step can precede the reverse')
		assert.equal(followup.at(-1), reverse)
		assert.equal(f.level, expected, 'One reverse detent moves away from the end stop')
		const count = f.executed.length
		await f.advance(1000)
		assert.equal(f.executed.length, count, 'Stopping the knob does not auto-repeat')
	})
}

test('serially awaited Companion callbacks retain only the newest direction while Lightroom is stalled', async (t) => {
	const f = fixture(t, { level: 10 })
	await f.turn('zoom_in')
	assert.equal(f.writes.length, 1)
	for (let i = 0; i < 200; i++) await f.turn('zoom_in')
	await f.turn('zoom_out')
	await f.advance(300, false)
	assert.equal(f.writes.length, 1, 'A slow consumer cannot be flooded by fast enqueue acknowledgements')
	assert.equal(commands.getQueueDiagnostics().queue.length, 1)
	f.consume()
	await f.advance(300)
	assert.deepEqual(
		f.executed.map((c) => c.action),
		['zoom_in', 'zoom_out'],
	)
	assert.equal(f.level, 9)
})

test('a slow enqueue reply does not block acceptance of a newer reverse gesture', async (t) => {
	const held = deferred()
	const f = fixture(t, { afterEnqueue: () => held.promise, level: 10 })
	await f.turn('zoom_in')
	for (let i = 0; i < 50; i++) await f.turn('zoom_in')
	await f.turn('zoom_out')
	assert.equal(f.writes.length, 1)
	f.consume()
	held.resolve()
	await flush()
	await f.advance(300)
	assert.deepEqual(
		f.executed.map((c) => c.action),
		['zoom_in', 'zoom_out'],
	)
	assert.equal(f.highWater, 1)
})

test('existing unrelated bridge work holds zoom locally without appending a delayed gesture', async (t) => {
	const f = fixture(t)
	commands.tryEnqueueCommand({ command: 'selection.navigate', direction: 'next' })
	await f.turn('zoom_in')
	await f.advance(1500, false)
	assert.equal(f.writes.length, 0)
	f.consume()
	await f.advance(300)
	assert.equal(f.writes.length, 0, 'Expired movement is not replayed after an unrelated backlog clears')
	await f.turn('zoom_out')
	await f.advance(200)
	assert.deepEqual(
		f.writes.map((c) => c.action),
		['zoom_out'],
		'Fresh input starts normally after expiry',
	)
})

test('input expiring during a slow diagnostics response cannot later dispatch', async (t) => {
	const held = deferred()
	const f = fixture(t, { beforeDiagnostics: () => held.promise })
	await f.turn('zoom_in')
	await f.advance(1500, false)
	held.resolve()
	await flush()
	await f.advance(200)
	assert.equal(f.writes.length, 0)
})

test('stop discards movement waiting on a bridge read and prevents later dispatch', async (t) => {
	const held = deferred()
	const f = fixture(t, { beforeDiagnostics: () => held.promise })
	await f.turn('zoom_in')
	await f.turn('zoom_out')
	f.client.stop()
	held.resolve()
	await flush()
	await f.advance(500)
	assert.equal(f.writes.length, 0)
})

test('stop during a slow enqueue response preserves only the already accepted command', async (t) => {
	const held = deferred()
	const f = fixture(t, { afterEnqueue: () => held.promise })
	await f.turn('zoom_in')
	await f.turn('zoom_out')
	f.client.stop()
	held.resolve()
	await flush()
	await f.advance(500)
	assert.deepEqual(
		f.writes.map((c) => c.action),
		['zoom_in'],
	)
})

for (const failure of ['failBeforeEnqueue', 'failAfterEnqueue']) {
	test(`${failure}: ambiguous or failed zoom is reported and never automatically retried`, async (t) => {
		const held = deferred()
		const f = fixture(t, { [failure]: true, afterEnqueue: () => held.promise })
		await f.turn('zoom_in')
		if (failure === 'failAfterEnqueue') {
			await f.turn('zoom_out')
			held.resolve()
		}
		await flush()
		await f.advance(2000)
		assert.equal(f.writes.length, 1, 'Neither the uncertain write nor its pending reverse is replayed')
		assert.match(f.client.lastError, /Zoom (transport failed|reply lost)/)
	})
}

test('malformed queue diagnostics fail closed without a zoom write', async (t) => {
	const f = fixture(t, {
		diagnostics: { ok: true, queue: { length: 0, pending: { byCommand: { 'application.action': -1 } } } },
	})
	await f.turn('zoom_in')
	await f.advance(500)
	assert.equal(f.writes.length, 0)
	assert.ok(f.client.lastError, 'Malformed telemetry is surfaced as an error')
})

test('100 percent command clears any unsent rotary direction', async (t) => {
	const held = deferred()
	const f = fixture(t, { beforeDiagnostics: () => held.promise })
	await f.turn('zoom_in')
	await f.turn('zoom_out')
	await f.client.button('application.action_zoom_100')
	held.resolve()
	await flush()
	await f.advance(500)
	assert.deepEqual(
		f.writes.map((c) => c.action),
		['zoom_100'],
	)
})

test('a failed obsolete diagnostics read cannot discard a fresh gesture after 100 percent clears it', async (t) => {
	const held = deferred()
	let reads = 0
	const f = fixture(t, {
		beforeDiagnostics: () => (++reads === 1 ? held.promise : undefined),
	})
	await f.turn('zoom_in')
	await f.client.button('application.action_zoom_100')
	f.consume()
	await f.turn('zoom_out')
	held.reject(Error('Obsolete diagnostic read failed'))
	await flush()
	await f.advance(300)
	assert.ok(reads >= 2, 'A fresh read authorizes the post-reset gesture')
	assert.deepEqual(
		f.writes.map((c) => c.action),
		['zoom_100', 'zoom_out'],
	)
	assert.equal(f.client.lastError, '', 'Obsolete read failure does not poison the current gesture')
})

function zoomPress(f) {
	let presets
	UpdatePresets({
		label: 'LRBridge',
		getFeedbackSliderChoices: () => [],
		getSliderNumericValue: () => undefined,
		controller: f.client,
		setPresetDefinitions(_sections, definitions) {
			presets = definitions
		},
	})
	const down = presets.wc_application_zoom_rotary.steps[0].down
	assert.equal(down.length, 1, 'One press issues one existing SDK toggle, not a simulated Fit sequence')
	return f.callback(down[0])
}

test('rotary preset press cancels unsent turns and sends exactly one Navigator zoom toggle', async (t) => {
	const held = deferred()
	const f = fixture(t, { beforeDiagnostics: () => held.promise })
	await f.turn('zoom_in')
	await f.turn('zoom_out')
	await zoomPress(f)
	held.resolve()
	await flush()
	await f.advance(1500)
	assert.deepEqual(f.writes.map((c) => c.action), ['toggle_zoom'])
	assert.deepEqual(f.executed.map((c) => c.action), ['toggle_zoom'])
})

test('rotary preset press preserves already admitted SDK command ordering without replaying pending turns', async (t) => {
	const f = fixture(t)
	await f.turn('zoom_in')
	await f.turn('zoom_in')
	await zoomPress(f)
	await f.advance(1500)
	assert.deepEqual(f.writes.map((c) => c.action), ['zoom_in', 'toggle_zoom'])
	assert.deepEqual(f.executed.map((c) => c.action), ['zoom_in', 'toggle_zoom'])
})
