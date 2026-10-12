import assert from 'node:assert/strict'
import test from 'node:test'
import { ControllerClient } from '../dist/controller-client.js'
import { controllerFeedbacks, publishControllerValues } from '../dist/controller-companion.js'
import { variableId } from '../dist/controller-catalog.js'

const flush = async () => {
	for (let i = 0; i < 60; i++) await Promise.resolve()
}
const context = {
	activeModule: 'develop',
	selectedPhotoUuid: 'photo-one',
	contextCounter: 1,
	contextChangedAt: 100,
	developCounter: 2,
	serverEpoch: 'point-epoch',
	stateRevision: 3,
}
const pc = (index = 1, hue = 0) => ({
	available: true,
	swatchCount: 2,
	selectedIndex: index,
	selectionTransient: false,
	HueShift: hue,
	SatScale: 0,
	LumScale: 0,
	Variance: 0,
	RangeAmount: 0.5,
	...Object.fromEntries(
		['HueRange', 'SatRange', 'LumRange'].map((name) => [
			name,
			{ LowerNone: 0.1, LowerFull: 0.3, UpperFull: 0.6, UpperNone: 0.9 },
		]),
	),
})
function fixture(options = {}) {
	const states = { global: pc(), masked: pc() },
		calls = [],
		variables = {}
	let activeGeneral = 0,
		activePoint = 0,
		maximumGeneral = 0,
		maximumPoint = 0,
		maximumTotal = 0
	let self
	const client = new ControllerClient({
		changed() {
			if (self) publishControllerValues(self)
		},
		async adjust() {
			throw Error('No edits are part of background feedback')
		},
		async request(url) {
			calls.push(url)
			const isPoint = url === '/point-color/state' || url === '/masking/state'
			if (isPoint) activePoint++
			else activeGeneral++
			maximumGeneral = Math.max(maximumGeneral, activeGeneral)
			maximumPoint = Math.max(maximumPoint, activePoint)
			maximumTotal = Math.max(maximumTotal, activePoint + activeGeneral)
			try {
				if (url === '/lens-blur/state' || url === '/color-grading/request') {
					await options.generalWait
					return url === '/color-grading/request' ? { request: { id: 'grading' } } : { state: {}, context }
				}
				if (url.startsWith('/color-grading/snapshot')) return { snapshot: { complete: true, context, parameters: {} } }
				assert.ok(isPoint, url)
				const result =
					url === '/point-color/state'
						? { state: structuredClone(states.global), context, contextOwned: true }
						: {
								...context,
								available: true,
								selectedMaskGroupId: 'mask-one',
								selectedMaskToolId: 'component-one',
								pointColor: structuredClone(states.masked),
							}
				await options.beforePointReturn?.(url)
				return result
			} finally {
				if (isPoint) activePoint--
				else activeGeneral--
			}
		},
	})
	self = {
		controller: client,
		getSliderNumericValue() {},
		setVariableValues: (v) => Object.assign(variables, v),
		checkFeedbacks() {},
	}
	const selected = controllerFeedbacks(self).controller_selected.callback
	return {
		client,
		calls,
		states,
		variables,
		options,
		selected(masked, index) {
			return selected({
				id: `${masked}-swatch-${index}`,
				options: { control: `${masked ? 'mask-point-color' : 'point-color'}_swatch_${index}` },
			})
		},
		maximum() {
			return { general: maximumGeneral, point: maximumPoint, total: maximumTotal }
		},
	}
}

test('Lightroom swatch changes update global and masked selected feedback while both general slots are blocked', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	let release
	const generalWait = new Promise((resolve) => {
		release = resolve
	})
	const f = fixture({ generalWait })
	try {
		f.client.watch('slow-windows', 'lens-blur')
		f.client.watch('slow-sdk', 'grading')
		f.selected(false, 2)
		f.selected(true, 2)
		for (let i = 0; i < 50; i++) f.client.watch('range-' + i, 'point-color')
		t.mock.timers.tick(250)
		await flush()
		assert.equal(f.selected(false, 1), true)
		t.mock.timers.tick(250)
		await flush()
		assert.equal(f.selected(true, 1), true)
		f.states.global = pc(2, 0.25)
		f.states.masked = pc(2, -0.15)
		f.states.global.HueRange.LowerFull = 0.35
		f.states.masked.HueRange.LowerFull = 0.4
		t.mock.timers.tick(250)
		await flush()
		assert.equal(f.selected(false, 2), true, 'External global swatch selection is confirmed within its next 500ms poll')
		assert.equal(f.selected(false, 1), false)
		assert.equal(f.variables[variableId('point-color_HueShift')], '25')
		assert.equal(f.variables[variableId('point-color_HueRange_LowerFull')], '35')
		t.mock.timers.tick(250)
		await flush()
		assert.equal(f.selected(true, 2), true)
		assert.equal(f.selected(true, 1), false)
		assert.equal(f.variables[variableId('mask-point-color_HueShift')], '-15')
		assert.equal(f.variables[variableId('mask-point-color_HueRange_LowerFull')], '40')
		assert.deepEqual(
			f.calls.filter((u) => ['/point-color/state', '/masking/state'].includes(u)),
			['/point-color/state', '/masking/state', '/point-color/state', '/masking/state'],
		)
		assert.deepEqual(f.maximum(), { general: 2, point: 1, total: 3 })
	} finally {
		f.client.stop()
		release()
		await flush()
	}
})

test('One Point Color slot prevents duplicate reads and rotates to the other observed family', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	let release
	const blocked = new Promise((resolve) => {
		release = resolve
	})
	const f = fixture({ beforePointReturn: () => blocked })
	try {
		f.selected(false, 2)
		f.selected(true, 2)
		t.mock.timers.tick(250)
		await flush()
		t.mock.timers.tick(1500)
		await flush()
		assert.deepEqual(f.calls, ['/point-color/state'])
		assert.equal(f.maximum().point, 1)
		release()
		await flush()
		f.options.beforePointReturn = undefined
		t.mock.timers.tick(250)
		await flush()
		assert.equal(f.calls.at(-1), '/masking/state')
	} finally {
		release()
		f.client.stop()
	}
})

test('An older failed Point Color poll cannot erase a newer confirmed swatch snapshot', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	let rejectOld
	const blocked = new Promise((_resolve, reject) => {
		rejectOld = reject
	})
	const f = fixture({ beforePointReturn: () => blocked })
	try {
		f.selected(false, 2)
		t.mock.timers.tick(250)
		await flush()
		f.options.beforePointReturn = undefined
		f.states.global = pc(2, 0.25)
		await f.client.read('point-color')
		rejectOld(Error('Older request failed'))
		await flush()
		assert.equal(f.selected(false, 2), true)
		assert.equal(f.variables[variableId('point-color_HueShift')], '25')
	} finally {
		f.client.stop()
	}
})

test('Unobserved Point Color families are not polled and stopping cancels scheduled reads', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
	const f = fixture()
	f.selected(false, 2)
	t.mock.timers.tick(250)
	await flush()
	assert.deepEqual(f.calls, ['/point-color/state'])
	f.client.unwatch('false-swatch-2')
	t.mock.timers.tick(1500)
	await flush()
	assert.deepEqual(f.calls, ['/point-color/state'])
	f.selected(true, 2)
	f.client.stop()
	t.mock.timers.tick(1500)
	await flush()
	assert.deepEqual(f.calls, ['/point-color/state'])
})
