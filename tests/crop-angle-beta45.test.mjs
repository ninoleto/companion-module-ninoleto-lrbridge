import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'

const { ControllerClient } = await import(process.env.LRBRIDGE_CLIENT_MODULE || '../dist/controller-client.js')
const require = createRequire(import.meta.url)
const reference = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const { validateCommand } = require(path.join(reference, 'server/commands.js'))

// Real beta.4 command validation; command execution and SDK feedback are simulated.
// These checks measure request ordering and ownership, not native Lightroom latency.
function fixture() {
	const ctx = {
		activeModule: 'develop',
		selectedPhotoUuid: 'crop-photo',
		contextCounter: 4,
		contextChangedAt: 100,
		developCounter: 12,
	}
	let angle = 0,
		available = true,
		serial = 0,
		pending = null,
		feedbackGate = null
	const requests = [],
		commands = [],
		execution = []
	const client = new ControllerClient({
		async request(url) {
			const u = new URL(url, 'http://fixture')
			requests.push(u.pathname)
			if (u.pathname === '/context') return structuredClone(ctx)
			// This fixture models a command already dequeued by the serial SDK
			// worker; its completion is deliberately held until feedback below.
			if (u.pathname === '/diagnostics/queue')
				return {
					ok: true,
					queue: { length: 0, pending: { byCommand: { 'photo.crop_angle.set': 0, 'photo.crop_angle.reset': 0 } } },
				}
			if (u.pathname === '/feedback/request-many') {
				assert.equal(u.searchParams.get('sliders'), 'CropAngle')
				assert.equal(u.searchParams.get('purpose'), 'edit')
				return { ok: true, request: { id: ++serial } }
			}
			if (u.pathname === '/feedback/snapshot') {
				if (pending) {
					if (feedbackGate) {
						const gate = feedbackGate
						feedbackGate = null
						gate.entered()
						await gate.wait
					}
					angle = pending.command === 'photo.crop_angle.reset' ? 0 : pending.value
					execution.push(pending.command)
					pending = null
				}
				return {
					ok: true,
					snapshot: {
						id: Number(u.searchParams.get('id')),
						complete: true,
						results: { CropAngle: { available, value: available ? angle : null, range: { min: -45, max: 45 } } },
					},
				}
			}
			if (u.pathname === '/command') {
				const command = { command: u.searchParams.get('command') }
				if (u.searchParams.has('value')) {
					const raw = u.searchParams.get('value')
					assert.match(raw, /^-?\d+(?:\.\d{1,2})?$/, 'Crop route requires at most two decimals')
					command.value = Number(raw)
				}
				assert.equal(validateCommand(command), true)
				assert.equal(pending, null, 'Next write must wait for prior command feedback')
				commands.push(command)
				pending = command
				return { ok: true, queued: command }
			}
			throw Error(`Unexpected request ${u.pathname}`)
		},
		changed() {},
		adjust() {
			throw Error('Crop cannot use the legacy SDK-adjust path')
		},
	})
	return {
		client,
		ctx,
		commands,
		requests,
		execution,
		setAngle(value) {
			angle = value
		},
		setAvailable(value) {
			available = value
		},
		reads() {
			return requests.filter((p) => p === '/feedback/request-many').length
		},
		blockFeedback() {
			let release, entered
			const wait = new Promise((resolve) => {
				release = resolve
			})
			const reached = new Promise((resolve) => {
				entered = resolve
			})
			feedbackGate = { wait, entered }
			return { release, reached }
		},
	}
}

test('Crop reuses recent confirmed feedback and confirms asynchronous turns with post-write reads', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 10000 })
	const f = fixture()
	t.after(() => f.client.stop())
	await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.cropAngle.idle()
	assert.equal(f.reads(), 2, 'First turn needs initial and post-write SDK feedback')
	const before = f.requests.length
	await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.cropAngle.idle()
	assert.equal(f.reads(), 3, 'Second turn retains post-write read but avoids redundant pre-read')
	assert.deepEqual(f.requests.slice(before, before + 3), ['/context', '/context', '/command'])
	assert.deepEqual(
		f.commands.map((c) => c.value),
		[0.1, 0.2],
	)
	assert.equal(f.client.numericValues.get('crop_angle').value, 0.2)
})

test('Crop refreshes an expired or unavailable cached SDK baseline', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 10000 })
	const f = fixture()
	t.after(() => f.client.stop())
	await f.client.read('crop')
	f.setAngle(3)
	t.mock.timers.tick(501)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.cropAngle.idle()
	assert.equal(f.commands[0].value, 3.1)
	assert.equal(f.reads(), 3)
	f.setAvailable(false)
	await f.client.read('crop')
	f.setAvailable(true)
	f.setAngle(5)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.cropAngle.idle()
	assert.equal(f.commands[1].value, 5.1)
})

test('Crop refreshes after an external Develop revision and uses the new SDK value', async (t) => {
	const f = fixture()
	t.after(() => f.client.stop())
	await f.client.read('crop')
	f.ctx.developCounter++
	f.setAngle(-5)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.cropAngle.idle()
	assert.equal(f.commands[0].value, -4.9)
	assert.equal(f.reads(), 3)
})

test('Crop rejects changed photo/context or leaving Develop before writing', async (t) => {
	for (const [field, value] of [
		['selectedPhotoUuid', 'another-photo'],
		['contextCounter', 5],
		['contextChangedAt', 101],
		['activeModule', 'library'],
	]) {
		const f = fixture()
		try {
			await f.client.read('crop')
			f.ctx[field] = value
			await f.client.numeric('crop_angle', 'adjust', 1)
			await f.client.cropAngle.idle()
			assert.match(f.client.lastError, /changed|Develop/)
			assert.equal(f.commands.length, 0)
		} finally {
			f.client.stop()
		}
	}
})

test('Crop never turns unavailable feedback into a guessed adjustment', async (t) => {
	const f = fixture()
	t.after(() => f.client.stop())
	f.setAvailable(false)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.cropAngle.idle()
	assert.match(f.client.lastError, /unavailable/)
	assert.equal(f.commands.length, 0)
})

test('Crop rounds higher precision SDK baselines to the dedicated API precision', async (t) => {
	const f = fixture()
	t.after(() => f.client.stop())
	f.setAngle(1.234567)
	await f.client.numeric('crop_angle', 'adjust', 1)
	await f.client.cropAngle.idle()
	assert.equal(f.commands[0].value, 1.33)
	assert.equal(f.client.numericValues.get('crop_angle').value, 1.33)
})

test('Crop Reset remains a confirmation barrier and does not publish the requested value early', async (t) => {
	const f = fixture()
	t.after(() => f.client.stop())
	f.setAngle(5)
	await f.client.read('crop')
	const gate = f.blockFeedback()
	const reset = f.client.numeric('crop_angle', 'reset')
	await gate.reached
	const adjust = f.client.numeric('crop_angle', 'adjust', 1)
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(f.commands.length, 1)
	assert.equal(f.client.numericValues.get('crop_angle').value, 5)
	gate.release()
	await Promise.all([reset, adjust])
	await f.client.cropAngle.idle()
	assert.deepEqual(f.execution, ['photo.crop_angle.reset', 'photo.crop_angle.set'])
	assert.equal(f.commands[1].value, 0.1)
})
