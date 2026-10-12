import assert from 'node:assert/strict'
import test from 'node:test'
import { numericControls, numericById, variableId } from '../dist/controller-catalog.js'
import { publishControllerValues } from '../dist/controller-companion.js'

const { ControllerClient } = await import(process.env.LRBRIDGE_CLIENT_MODULE || '../dist/controller-client.js')
const flush = async () => {
	for (let i = 0; i < 30; i++) await Promise.resolve()
}
const ctx = {
	activeModule: 'develop',
	selectedPhotoUuid: 'photo-one',
	contextCounter: 1,
	contextChangedAt: 100,
	developCounter: 2,
	serverEpoch: 'feedback-epoch',
	stateRevision: 5,
}
const range = { LowerNone: 0, LowerFull: 0.33, UpperFull: 0.67, UpperNone: 1 }
const pointColor = () => ({
	available: true,
	selectedIndex: 1,
	swatchCount: 2,
	selectionTransient: false,
	HueShift: 0,
	SatScale: 0,
	LumScale: 0,
	Variance: 0,
	RangeAmount: 0.5,
	HueRange: { ...range },
	SatRange: { ...range },
	LumRange: { ...range },
})
const client = (request) =>
	new ControllerClient({
		request,
		changed() {},
		async adjust() {
			throw Error('Unexpected write')
		},
	})

test('background polling is bounded, deduplicates observers and a blocked family does not stall others', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	const calls = []
	let active = 0,
		maximum = 0,
		release
	const blocked = new Promise((resolve) => {
		release = resolve
	})
	const c = client(async (url) => {
		calls.push(url)
		maximum = Math.max(maximum, ++active)
		if (url === '/lens-blur/state') await blocked
		active--
		return { ...ctx, available: true }
	})
	try {
		c.watch('slow', 'lens-blur')
		for (let i = 0; i < 100; i++) c.watch(`range-${i}`, 'point-color')
		c.watch('process', 'categorical')
		t.mock.timers.tick(250)
		await flush()
		assert.deepEqual(calls, ['/lens-blur/state', '/develop-categorical/state', '/point-color/state'])
		t.mock.timers.tick(250)
		await flush()
		assert.ok(calls.includes('/develop-categorical/state'), 'Process state runs before slow automation completes')
		assert.ok(maximum <= 3, 'At most two general requests plus one independent Point Color read')
		assert.equal(calls.filter((v) => v === '/point-color/state').length, 1, 'Many presets share one family read')
		c.unwatch('process')
		for (let i = 0; i < 100; i++) c.unwatch(`range-${i}`)
		t.mock.timers.tick(1000)
		await flush()
		assert.equal(calls.filter((v) => v === '/point-color/state').length, 1, 'Removed observers are no longer polled')
	} finally {
		c.stop()
		release()
		await flush()
	}
})

test('Process Version follows delayed authoritative feedback without replaying the command', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	let process = 'Version 6',
		writes = 0,
		reads = 0
	const c = client(async (url) => {
		if (url === '/develop-categorical/state') {
			reads++
			return { state: { processAvailable: true, process } }
		}
		assert.match(url, /^\/develop-categorical\/process\?/)
		writes++
		return { ok: true }
	})
	try {
		await c.button('categorical_process_Version 4')
		assert.equal(writes, 1)
		t.mock.timers.tick(250)
		await flush()
		assert.equal(c.snapshots.get('categorical').process, 'Version 6', 'HTTP acceptance is not feedback')
		process = 'Version 4'
		t.mock.timers.tick(250)
		await flush()
		assert.equal(c.snapshots.get('categorical').process, 'Version 4', 'Does not wait for a full family rotation')
		const confirmedReads = reads
		t.mock.timers.tick(4000)
		await flush()
		assert.equal(reads, confirmedReads, 'Targeted follow-up stops when the SDK value is observed')
		assert.equal(writes, 1)
	} finally {
		c.stop()
	}
})

test('categorical follow-up has a finite budget when Lightroom does not change', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	let reads = 0,
		writes = 0
	const c = client(async (url) => {
		if (url === '/develop-categorical/state') {
			reads++
			return { state: { processAvailable: true, process: 'Version 6' } }
		}
		writes++
		return { ok: true }
	})
	try {
		await c.button('categorical_process_Version 4')
		for (let i = 0; i < 16; i++) {
			t.mock.timers.tick(250)
			await flush()
		}
		assert.equal(reads, 9, 'One readiness read plus at most eight feedback-only reads')
		assert.equal(writes, 1)
		assert.equal(c.snapshots.get('categorical').process, 'Version 6')
	} finally {
		c.stop()
	}
})

for (const kind of ['background poll', 'post-action follow-up'])
	test(`a failed older ${kind} cannot erase newer authoritative feedback`, async (t) => {
		t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
		let rejectOld,
			calls = 0
		const blocked = new Promise((_, reject) => {
			rejectOld = reject
		})
		const c = client(async (url) => {
			if (url.includes('/process?')) return { ok: true }
			calls++
			if (calls === (kind === 'background poll' ? 1 : 2)) return blocked
			return { state: { processAvailable: true, process: 'Version 4' } }
		})
		try {
			if (kind === 'background poll') c.watch('process', 'categorical')
			else await c.button('categorical_process_Version 4')
			t.mock.timers.tick(250)
			await flush()
			await c.read('categorical')
			rejectOld(Error('Old request connection lost'))
			await flush()
			assert.equal(c.snapshots.get('categorical')?.process, 'Version 4')
		} finally {
			c.stop()
			rejectOld(Error('stopped'))
			await flush()
		}
	})

const healing = () => ({
	...ctx,
	available: true,
	ageMs: 20,
	selectedTool: 'dust',
	newSpotType: 'heal',
	brushSize: 40,
	brushFeather: 50,
	visualizeSpots: false,
	visualizationThreshold: 40,
	repair: { available: true, selected: true, token: 'repair-one', opacity: 0.5, feather: 0.4 },
})

test('Healing keeps the last SDK values visible during a same-owner pending edit without weakening admission', async () => {
	let state = healing()
	const c = client(async () => structuredClone(state))
	try {
		await c.read('remove')
		state.pendingOperation = { operationId: 'remove-one', field: 'selectedRepairOpacity', value: 0.8 }
		await c.read('remove')
		assert.deepEqual(c.numericValues.get('remove_selectedRepairOpacity'), { value: 50, available: true })
		assert.deepEqual(c.numericValues.get('remove_selectedRepairFeather'), { value: 40, available: true })
		assert.throws(() => c.readNumeric(numericById.get('remove_selectedRepairOpacity'), state), /pending/)
		state.pendingOperation = null
		state.repair.opacity = 0.8
		await c.read('remove')
		assert.deepEqual(c.numericValues.get('remove_selectedRepairOpacity'), { value: 80, available: true })
	} finally {
		c.stop()
	}
})

for (const [label, change] of [
	[
		'photo',
		(s) => {
			s.selectedPhotoUuid = 'photo-two'
			s.contextCounter++
		},
	],
	[
		'tool',
		(s) => {
			s.selectedTool = 'loupe'
		},
	],
	[
		'mode',
		(s) => {
			s.newSpotType = 'clone'
		},
	],
	[
		'repair',
		(s) => {
			s.repair.token = 'repair-two'
		},
	],
	[
		'expired snapshot',
		(s) => {
			s.ageMs = 5000
		},
	],
	[
		'unavailable state',
		(s) => {
			s.available = false
		},
	],
])
	test(`pending Healing feedback is cleared after ${label} changes`, async () => {
		let state = healing()
		const c = client(async () => structuredClone(state))
		try {
			await c.read('remove')
			state.pendingOperation = { operationId: 'remove-one', field: 'selectedRepairOpacity', value: 0.8 }
			change(state)
			await c.read('remove')
			assert.equal(c.numericValues.get('remove_selectedRepairOpacity')?.available, false)
		} finally {
			c.stop()
		}
	})

for (const masked of [false, true])
	test(`${masked ? 'masked' : 'global'} Point Color publishes all 12 range boundaries and clears transient selections`, async () => {
		const family = masked ? 'mask-point-color' : 'point-color'
		let pc = pointColor(),
			published
		const c = client(async (url) => {
			assert.equal(url, masked ? '/masking/state' : '/point-color/state')
			return masked
				? { ...ctx, available: true, selectedMaskGroupId: 'mask-one', pointColor: structuredClone(pc) }
				: { state: structuredClone(pc), context: ctx, contextOwned: true }
		})
		const self = {
			controller: c,
			getSliderNumericValue() {},
			setVariableValues(values) {
				published = values
			},
			checkFeedbacks() {},
		}
		const ranges = numericControls.filter((control) => control.family === family && control.range)
		try {
			assert.equal(ranges.length, 12)
			await c.read(family)
			publishControllerValues(self)
			for (const control of ranges)
				assert.equal(published[variableId(control.id)], String(range[control.field] * 100), control.id)
			pc = { ...pc, selectedIndex: 0, selectionTransient: true }
			await c.read(family)
			publishControllerValues(self)
			for (const control of ranges)
				assert.equal(published[variableId(control.id)], '', 'No old swatch values during a transient selection')
		} finally {
			c.stop()
		}
	})
