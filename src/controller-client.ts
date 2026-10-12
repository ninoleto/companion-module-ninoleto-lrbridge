import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import {
	numericById,
	buttonById,
	numericControls,
	type Family,
	type NumericControl,
	type Params,
} from './controller-catalog.js'
import { FEEDBACK_SUPPORTED_SLIDERS } from './choices.js'
import type { NativeCompletion } from './native-feedback.js'
import { ZoomQueue } from './zoom-queue.js'
import { CropAngleQueue } from './crop-angle-queue.js'
import { isSliderMutation, sensitiveAction } from './slider-mutation.js'

// The response bodies are heterogeneous, versioned LRBridge API snapshots.
// Every value used for a write is validated below; unknown fields are never sent.
export type State = Record<string, any>
export class ControllerHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message)
		this.name = 'ControllerHttpError'
	}
}
type SliderMutationScope = { release?: () => void; closed: boolean }
type GradingTarget = { value: number; owner: string; afterRead: number; expires: number; admitted: boolean }
type RemoveIntent = { base: string; tool: string; mode: string | null; repairToken?: string }
type LensFollowup = { intent: State; revision: number; deadline: number; observed: (state: State) => boolean }
type SpecialFamily = 'reflections' | 'people' | 'red-eye'
const specialFamily = (f: Family): f is SpecialFamily => ['reflections', 'people', 'red-eye'].includes(f)
const pointColorFamily = (f: Family) => f === 'point-color' || f === 'mask-point-color'
const retiredFocusRange =
	'Lens Blur Focus Range was removed from Companion. Use LRBridge Web Controller for Focus Range.'
export interface Transport {
	request(path: string, body?: State): Promise<State>
	adjust(slider: string, steps: number): Promise<void>
	action?(name: string): Promise<void>
	nativeConfirmed?(completion: NativeCompletion): boolean | void
	sliderMutationStarted?(): () => void
	beforeSensitiveAction?(name: string): boolean
	changed(): void
}
const fields = [
	'selectedPhotoUuid',
	'contextCounter',
	'developCounter',
	'contextChangedAt',
	'serverEpoch',
	'stateRevision',
]
export function pick(state: State, keys: string[]): Params {
	const result: Params = {}
	for (const key of keys) {
		const value = key === 'stateRevision' ? (state.stateRevision ?? state.revision) : state[key]
		if (
			!['string', 'number', 'boolean'].includes(typeof value) ||
			(typeof value === 'number' && !Number.isFinite(value))
		)
			throw new Error(`Current Lightroom ${key} is unavailable`)
		result[key] = value
	}
	return result
}
export const pathWith = (path: string, params: Params = {}) =>
	path +
	(Object.keys(params).length
		? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
		: '')
export const owner = (s: State) =>
	JSON.stringify([
		s.serverEpoch ?? '',
		s.selectedPhotoUuid ?? '',
		s.contextCounter ?? '',
		s.contextChangedAt ?? '',
		s.selectedMaskGroupId ?? '',
		s.selectedMaskToolId ?? '',
		s.pointColor?.selectedIndex ?? s.selectedIndex ?? '',
	])
const familyKey = (f: Family) => (f.startsWith('mask') ? 'masking' : f)
const photoOwner = (s: State) => JSON.stringify([s.selectedPhotoUuid, s.contextCounter, s.contextChangedAt])
const curvePath = (f: Family) => (f === 'mask-curve' ? '/masking/tone-curve' : '/tone-curve')
const curveBinding = (f: Family, s: State) =>
	pick(
		s,
		f === 'mask-curve' ? [...fields, 'selectedMaskGroupId'] : ['selectedPhotoUuid', 'contextCounter', 'developCounter'],
	)
function requireAvailable(s: State) {
	if (s.available === false || s.contextOwned === false || s.needsReview || s.pendingOperation || s.pendingApplication)
		throw new Error(
			s.reason ||
				s.error ||
				'Control is unavailable or a previous operation is still pending. Check Lightroom before trying again.',
		)
}
function finite(v: unknown): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Current Lightroom value is unavailable')
	return v
}
function bounds(v: number, min: number, max: number) {
	if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Value must be between ${min} and ${max}`)
	return Number(v.toFixed(6))
}
export class ControllerClient {
	readonly snapshots = new Map<Family, State>()
	readonly numericValues = new Map<string, { value: number; available: boolean }>()
	readonly pending = new Set<string>()
	lastStatus = ''
	lastError = ''
	private tails = new Map<string, Promise<unknown>>()
	private counts = new Map<string, number>()
	private observers = new Map<string, Family>()
	private watchedNumeric = new Map<string, string>()
	private refreshTimers = new Map<Family, NodeJS.Timeout>()
	private readSerial = new Map<Family, number>()
	private specialReads = new Map<SpecialFamily, Promise<State>>()
	private timer?: NodeJS.Timeout
	private cursor = 0
	private pointColorCursor = 0
	private stopped = false
	private generation = 0
	private polling = new Set<Family>()
	private pollAt = new Map<Family, number>()
	private adjustmentBatches = new Map<string, { amount: number; promise: Promise<void> }>()
	private nativeGates = new Map<string, Promise<void>>()
	private fineBatches = new Map<string, { steps: number[]; promise: Promise<void> }>()
	private fineSessions = new Map<string, { owner?: string; failed: boolean }>()
	private gradingTargets = new Map<string, GradingTarget>()
	private gradingGeneration = 0
	private readAt = new Map<Family, number>()
	private removeIntents = new Set<RemoveIntent>()
	private removeGeneration = 0
	private lensFollowup?: LensFollowup
	private readonly mutationScope = new AsyncLocalStorage<SliderMutationScope>()
	private readonly activeMutationScopes = new Set<SliderMutationScope>()
	private readonly gradingMutationReleases = new Set<() => void>()
	private readonly zoom: ZoomQueue
	private readonly cropAngle: CropAngleQueue
	constructor(private readonly io: Transport) {
		const crop = numericById.get('crop_angle')!
		this.cropAngle = new CropAngleQueue({
			ready: async () => {
				const s = await this.readyCrop(crop)
				return { owner: photoOwner(s), value: this.readNumeric(crop, s).value }
			},
			context: async () => {
				const s = await this.request('/context')
				if (s.activeModule !== 'develop') throw new Error('Crop Angle requires the Develop module')
				pick(s, ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt'])
				return photoOwner(s)
			},
			read: async () => {
				const s = await this.read('crop')
				return { owner: photoOwner(s), value: this.readNumeric(crop, s).value }
			},
			write: async (value, reset) => {
				await this.writeNumeric(crop, {}, value, reset)
			},
			dequeued: async () => {
				const diagnostics = await this.request('/diagnostics/queue')
				const length = diagnostics.queue?.length
				const counts = ['photo.crop_angle.set', 'photo.crop_angle.reset'].map(
					(command) => diagnostics.queue?.pending?.byCommand?.[command],
				)
				if (
					diagnostics.ok !== true ||
					!Number.isSafeInteger(length) ||
					length < 0 ||
					counts.some((n) => !Number.isSafeInteger(n) || n < 0 || n > length) ||
					counts[0] + counts[1] > length
				)
					throw new Error('Crop Angle queue state is unavailable; later turns discarded')
				return counts.every((n) => n === 0)
			},
			hold: () => this.io.sliderMutationStarted?.() ?? (() => {}),
			changed: (status) => {
				this.lastStatus = status
				this.lastError = ''
				this.io.changed()
			},
			failed: (error) => {
				this.lastError = error instanceof Error ? error.message : String(error)
				this.invalidate('crop')
			},
		})
		this.zoom = new ZoomQueue({
			request: (path) => this.request(path),
			admitted: (direction) => {
				this.lastStatus = `${direction === 'zoom_in' ? 'Zoom In' : 'Zoom Out'}: command accepted`
				this.lastError = ''
				this.io.changed()
			},
			failed: (error) => {
				this.lastError = error instanceof Error ? error.message : String(error)
				this.io.changed()
			},
		})
	}
	stop() {
		this.stopped = true
		this.lensFollowup = undefined
		this.generation++
		this.zoom.stop()
		this.cropAngle.stop()
		for (const scope of this.activeMutationScopes) {
			scope.closed = true
			scope.release?.()
		}
		this.activeMutationScopes.clear()
		this.finishGradingMutations()
		if (this.timer) clearTimeout(this.timer)
		for (const timer of this.refreshTimers.values()) clearTimeout(timer)
		this.refreshTimers.clear()
		this.specialReads.clear()
		this.polling.clear()
		this.pollAt.clear()
		this.snapshots.clear()
		this.numericValues.clear()
		this.observers.clear()
		this.watchedNumeric.clear()
		this.gradingTargets.clear()
		this.fineBatches.clear()
		this.fineSessions.clear()
		this.removeIntents.clear()
	}
	clearNativeFeedback() {
		this.readSerial.set('native', (this.readSerial.get('native') || 0) + 1)
		this.snapshots.delete('native')
		for (const c of numericControls.filter((c) => c.family === 'native')) this.numericValues.delete(c.id)
	}
	watch(id: string, family: Family, control?: string) {
		this.observers.set(id, family)
		if (control) this.watchedNumeric.set(id, control)
		else this.watchedNumeric.delete(id)
		this.schedule()
	}
	unwatch(id: string) {
		this.observers.delete(id)
		this.watchedNumeric.delete(id)
	}
	private refreshAfterAction(f: Family, observed?: (s: State) => boolean, attempts = observed ? 8 : 1) {
		if (f === 'command' || f === 'native' || this.stopped) return
		const previous = this.refreshTimers.get(f)
		if (previous) clearTimeout(previous)
		const timer = setTimeout(() => {
			this.refreshTimers.delete(f)
			const read = this.read(f),
				serial = this.readSerial.get(f)
			void read
				.then((s) => {
					if (this.stopped || this.readSerial.get(f) !== serial) return
					// A state GET can return the previous cache while scheduling an SDK
					// read. Follow up only this edited family, without resending the edit.
					if (observed && !observed(s) && attempts > 1 && !this.refreshTimers.has(f))
						this.refreshAfterAction(f, observed, attempts - 1)
				})
				.catch((e) => {
					if (this.stopped || this.readSerial.get(f) !== serial) return
					if (f === 'grading' && this.gradingTargets.size) this.failGrading(e)
					this.invalidate(f)
				})
		}, 250)
		this.refreshTimers.set(f, timer)
	}
	private schedule() {
		if (this.stopped || this.timer || !this.observers.size) return
		this.timer = setTimeout(() => {
			this.timer = undefined
			void this.poll()
		}, 250)
	}
	private async poll() {
		if (this.stopped) return
		const families = [...new Set(this.observers.values())].filter((f) => f !== 'command')
		const pointFamilies = families.filter(pointColorFamily)
		const generalFamilies = families.filter((f) => !pointColorFamily(f))
		// Bound background work to two families. A slow native/UI state read must
		// not block every other family; duplicate observers still cost one read.
		for (
			let scanned = 0;
			scanned < generalFamilies.length && [...this.polling].filter((f) => !pointColorFamily(f)).length < 2;
			scanned++
		) {
			const family = generalFamilies[this.cursor++ % generalFamilies.length]!
			const lastRead = Math.max(this.pollAt.get(family) ?? -Infinity, this.readAt.get(family) ?? -Infinity)
			if (
				this.polling.has(family) ||
				this.tails.has(familyKey(family)) ||
				(family === 'lens-blur-sdk' && this.lensFollowup) ||
				Date.now() - lastRead < 750
			)
				continue
			this.pollFamily(family)
		}
		// Point Color has one bounded read slot independent of the two general
		// slots: slow Windows/native reads must not starve range/swatch feedback.
		// Global and masked observers share it fairly at the Web mask cadence.
		if (![...this.polling].some(pointColorFamily)) {
			for (let scanned = 0; scanned < pointFamilies.length; scanned++) {
				const family = pointFamilies[this.pointColorCursor++ % pointFamilies.length]!
				const lastRead = Math.max(this.pollAt.get(family) ?? -Infinity, this.readAt.get(family) ?? -Infinity)
				if (this.tails.has(familyKey(family)) || Date.now() - lastRead < 450) continue
				this.pollFamily(family)
				break
			}
		}
		this.schedule()
	}
	private pollFamily(family: Family): void {
		this.polling.add(family)
		this.pollAt.set(family, Date.now())
		const read = this.read(family),
			serial = this.readSerial.get(family)
		void read
			.catch(() => {
				if (!this.stopped && this.readSerial.get(family) === serial) this.invalidate(family)
			})
			.finally(() => this.polling.delete(family))
	}
	private invalidate(f: Family) {
		this.snapshots.delete(f)
		this.readAt.delete(f)
		for (const c of numericControls.filter((c) => c.family === f))
			this.numericValues.set(c.id, { value: 0, available: false })
		this.io.changed()
	}
	isPending(f: Family) {
		return (
			this.pending.has(familyKey(f)) ||
			(f === 'grading' && this.gradingTargets.size > 0) ||
			(f === 'crop' && this.cropAngle.isPending())
		)
	}
	private finishGradingMutations() {
		for (const release of this.gradingMutationReleases) release()
		this.gradingMutationReleases.clear()
	}
	private failGrading(e: unknown) {
		this.finishGradingMutations()
		this.gradingGeneration++
		this.gradingTargets.clear()
		this.readAt.delete('grading')
		this.lastError = e instanceof Error ? e.message : String(e)
		this.io.changed()
	}
	private async request(path: string, params: Params = {}, body?: State): Promise<State> {
		if (this.stopped) throw new Error('Connection stopped')
		const guarded = sensitiveAction(path, params)
		if (guarded && this.io.beforeSensitiveAction?.(guarded) === false)
			throw new Error('Waiting for Lightroom to finish the previous adjustment; press again after the countdown')
		let release: (() => void) | undefined
		if (isSliderMutation(path, params)) {
			const scope = this.mutationScope.getStore()
			if (scope && !scope.closed) scope.release ??= this.io.sliderMutationStarted?.()
			else release = this.io.sliderMutationStarted?.()
		}
		try {
			const result = await this.io.request(pathWith(path, params), body)
			if (!result || result.ok === false) throw new Error(result?.error || 'LRBridge rejected the request')
			return result
		} finally {
			release?.()
		}
	}
	private async withMutationScope<T>(family: Family, work: () => Promise<T>): Promise<T> {
		const scope: SliderMutationScope = { closed: false }
		this.activeMutationScopes.add(scope)
		return this.mutationScope.run(scope, async () => {
			try {
				return await work()
			} finally {
				scope.closed = true
				this.activeMutationScopes.delete(scope)
				if (scope.release) {
					// Color Grading deliberately returns at HTTP admission for responsive
					// knobs. Its existing feedback loop owns completion of these holds.
					if (family === 'grading' && this.gradingTargets.size && !this.stopped)
						this.gradingMutationReleases.add(scope.release)
					else scope.release()
				}
			}
		})
	}

	private queue<T>(family: Family, work: () => Promise<T>, lane = ''): Promise<T> {
		const key = familyKey(family) + (lane ? ':' + lane : ''),
			count = this.counts.get(key) || 0,
			generation = this.generation
		if (count >= 32) return Promise.reject(new Error('Too many pending actions; wait for Lightroom'))
		this.counts.set(key, count + 1)
		const previous = this.tails.get(key) || Promise.resolve()
		const task = previous
			.catch(() => {})
			.then(async () => {
				if (this.stopped || generation !== this.generation)
					throw new Error('Connection changed; queued action cancelled')
				this.pending.add(key)
				this.io.changed()
				try {
					const r = await this.withMutationScope(family, work)
					this.lastError = ''
					return r
				} catch (e) {
					this.lastError = e instanceof Error ? e.message : String(e)
					if (family === 'grading') this.failGrading(e)
					const fineSession = family === 'native' ? this.fineSessions.get(lane) : undefined
					if (fineSession) fineSession.failed = true
					this.invalidate(family)
					throw e
				} finally {
					this.pending.delete(key)
					this.counts.set(key, (this.counts.get(key) || 1) - 1)
					this.io.changed()
				}
			})
		this.tails.set(key, task)
		void task
			.finally(() => {
				if (this.tails.get(key) === task) this.tails.delete(key)
			})
			.catch(() => {})
		return task
	}
	async read(f: Family): Promise<State> {
		if (!specialFamily(f)) return this.readState(f)
		const existing = this.specialReads.get(f)
		if (existing) return existing
		const read = this.readState(f)
		this.specialReads.set(f, read)
		try {
			return await read
		} finally {
			if (this.specialReads.get(f) === read) this.specialReads.delete(f)
		}
	}
	private afterSpecialAdmission(f: SpecialFamily) {
		// A pre-write read must never satisfy post-write confirmation. Retire it,
		// including its publication serial, before sharing subsequent reads.
		this.specialReads.delete(f)
		this.readSerial.set(f, (this.readSerial.get(f) || 0) + 1)
		const timer = this.refreshTimers.get(f)
		if (timer) clearTimeout(timer)
		this.refreshTimers.delete(f)
	}
	private async readState(f: Family): Promise<State> {
		const serial = (this.readSerial.get(f) || 0) + 1
		this.readSerial.set(f, serial)
		let root: State, s: State
		if (f === 'native' || f === 'crop' || f === 'mask-global') {
			const watched = new Set(this.watchedNumeric.values())
			const ids = numericControls
				.filter(
					(c) =>
						c.family === f && (f !== 'native' || (watched.has(c.id) && !FEEDBACK_SUPPORTED_SLIDERS.includes(c.field))),
				)
				.map((c) => c.field)
			if (!ids.length) return {}
			const before = f === 'mask-global' ? await this.request('/masking/state') : await this.request('/context')
			const r = await this.request('/feedback/request-many', { sliders: ids.join(','), purpose: 'edit' })
			root = await this.until(
				() => this.request('/feedback/snapshot', { id: r.request.id, wait: 1 }),
				(r) => r.snapshot?.complete,
			)
			const after = await this.request('/context')
			for (const k of ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt'])
				if (before[k] !== after[k]) throw new Error('Photo changed during feedback read')
			s = { ...before, ...root.snapshot }
		} else if (f === 'grading') {
			const request = await this.request('/color-grading/request')
			const id = request.request?.id ?? request.id
			root = await this.until(
				async () => this.request('/color-grading/snapshot', { id }),
				(r) => r.snapshot?.complete === true,
			)
			s = { ...root.snapshot, ...root.snapshot.context }
		} else if (f === 'mask-point-color') {
			root = await this.request('/masking/state')
			s = { ...root, pointColor: root.pointColor }
		} else if (f === 'mask-curve') {
			root = await this.request('/masking/tone-curve/state')
			s = root.pointCurve
		} else if (f === 'curve') {
			root = await this.request('/tone-curve/state')
			s = root.pointCurve
		} else {
			// SDK buttons have their own snapshot and queue. A slow Windows reader
			// cannot hold their preflight or overwrite newer Bokeh feedback, while
			// refinement controls retain the complete Windows state unchanged.
			const route =
				f === 'lens-blur-sdk'
					? '/lens-blur/state?sdkOnly=true'
					: f === 'categorical'
						? '/develop-categorical/state'
						: `/${f}/state`
			root = await this.request(route)
			s = { ...(root.state || root), ...(root.context || {}) }
			if (f === 'lens-blur-sdk') s.revision = root.revision
			if ('contextOwned' in root) s.contextOwned = root.contextOwned
			if (root.profile) s.profile = root.profile
		}
		if (!s || typeof s !== 'object') throw new Error(`Missing ${f} state`)
		if (f === 'develop-presets' || f === 'enhance') {
			const ctx = await this.request('/context')
			s = { ...s, ...pick(ctx, ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt', 'developCounter']) }
		}
		if (this.stopped) throw new Error('Connection stopped')
		// Crop completion needs the SDK result requested after admission, even if
		// a concurrent poll now owns publication. An older cached value must not
		// satisfy a Reset barrier merely because its number happens to match.
		if (this.readSerial.get(f) !== serial) return f === 'crop' ? s : this.snapshots.get(f) || s
		const previous = this.snapshots.get(f)
		if (f === 'lens-blur-sdk' && this.lensFollowup) {
			const followup = this.lensFollowup
			if (!this.sameLensOwner(s, followup.intent)) this.lensFollowup = undefined
			else if (
				previous &&
				Number.isSafeInteger(s.revision) &&
				s.revision < Math.max(followup.revision, Number.isSafeInteger(previous.revision) ? previous.revision : -1) &&
				Date.now() < followup.deadline
			)
				return previous
		}
		this.snapshots.set(f, s)
		this.readAt.set(f, Date.now())
		for (const c of numericControls.filter((c) => c.family === f)) {
			try {
				// A pending Healing operation does not invalidate its last SDK values.
				// Keep those values only for the same photo, tool, mode and repair;
				// admission still uses readNumeric's strict pending-operation guard.
				const retainHealing =
					f === 'remove' &&
					s.pendingOperation &&
					previous &&
					previous.available === true &&
					this.numericValues.get(c.id)?.available === true &&
					this.removeBase(previous) === this.removeBase(s) &&
					previous.selectedTool === s.selectedTool &&
					previous.newSpotType === s.newSpotType &&
					Number.isFinite(s.ageMs) &&
					s.ageMs >= 0 &&
					s.ageMs < 5000 &&
					(!c.field.startsWith('selectedRepair') || previous.repair?.token === s.repair?.token)
				const v = this.readNumeric(c, retainHealing ? { ...s, pendingOperation: null } : s)
				this.numericValues.set(c.id, { value: v.value, available: true })
			} catch {
				this.numericValues.set(c.id, { value: 0, available: false })
			}
		}
		if (f === 'grading') this.reconcileGrading(s, serial)
		this.io.changed()
		return s
	}
	private reconcileGrading(s: State, serial: number) {
		const hadTargets = this.gradingTargets.size > 0
		for (const [id, target] of this.gradingTargets) {
			if (target.owner !== owner(s)) {
				this.failGrading(new Error('Photo changed; pending Color Grading targets discarded'))
				return
			}
			if (!target.admitted || serial <= target.afterRead) continue
			try {
				if (Math.abs(this.readNumeric(numericById.get(id)!, s).value - target.value) < 0.001) {
					this.gradingTargets.delete(id)
					continue
				}
			} catch {
				/* Unavailable feedback never confirms an edit. */
			}
			if (Date.now() >= target.expires) {
				this.failGrading(
					new Error('Color Grading feedback did not confirm the change. Check Lightroom; no automatic retry.'),
				)
				return
			}
		}
		if (this.gradingTargets.size) this.refreshAfterAction('grading')
		else {
			this.finishGradingMutations()
			if (hadTargets) this.lastStatus = 'Color Grading: confirmed by Lightroom'
		}
	}
	private gradingNumeric(c: NumericControl, mode: 'set' | 'adjust' | 'reset', input: number): Promise<void> {
		const generation = this.gradingGeneration
		const cached = this.snapshots.get('grading'),
			expectedOwner = cached ? owner(cached) : null
		return this.queue('grading', async () => {
			if (generation !== this.gradingGeneration)
				throw new Error('Color Grading adjustment cancelled after an earlier failure; try again')
			let s = this.snapshots.get('grading')
			if (!s || (!this.gradingTargets.size && Date.now() - (this.readAt.get('grading') || 0) > 1000))
				s = await this.ready('grading')
			let ctx = await this.request('/context')
			if (!this.gradingTargets.size && s.developCounter !== ctx.developCounter) {
				s = await this.ready('grading')
				ctx = await this.request('/context')
			}
			if (
				ctx.activeModule !== 'develop' ||
				photoOwner(s) !== photoOwner(ctx) ||
				(expectedOwner && expectedOwner !== owner(s))
			)
				throw new Error('Photo changed; Color Grading adjustment was not sent')
			// Intent is separate from authoritative feedback. Keep both wheel axes while
			// delayed reads catch up, exactly as the Web Controller retains its local pair.
			const working: State = { ...s, parameters: { ...s.parameters } }
			for (const [id, target] of this.gradingTargets) {
				if (target.owner !== owner(s) || Date.now() >= target.expires)
					throw new Error('Color Grading feedback is no longer current; wait for Lightroom before trying again')
				const control = numericById.get(id)!
				working.parameters[control.field] = { ...working.parameters[control.field], value: target.value }
			}
			const current = this.readNumeric(c, working)
			const value = bounds(
				mode === 'reset'
					? c.reset!
					: mode === 'adjust'
						? Math.max(current.min, Math.min(current.max, current.value + input * c.step))
						: input,
				current.min,
				current.max,
			)
			const paired = c.id.endsWith('_hue') || c.id.endsWith('_saturation')
			const peers = paired ? numericControls.filter((n) => n.family === 'grading' && n.region === c.region) : [c]
			const targets = peers.map<[string, GradingTarget]>((peer) => [
				peer.id,
				{
					value: peer.id === c.id ? value : this.readNumeric(peer, working).value,
					owner: owner(s),
					afterRead: this.readSerial.get('grading') || 0,
					expires: Date.now() + 4000,
					admitted: false,
				},
			])
			for (const [id, target] of targets) this.gradingTargets.set(id, target)
			await this.writeNumeric(c, working, value, mode === 'reset')
			for (const [, target] of targets) {
				target.admitted = true
				target.afterRead = this.readSerial.get('grading') || 0
			}
			this.lastStatus = `${c.label}: ${value} sent; awaiting Lightroom feedback`
			this.refreshAfterAction('grading')
			// Reset is a baseline barrier. Ordinary turns wait only for HTTP admission,
			// never for a complete fourteen-parameter snapshot after every tick.
			if (mode === 'reset') {
				await this.until(
					() => this.read('grading'),
					(r) => owner(r) === owner(s) && Math.abs(this.readNumeric(c, r).value - value) < 0.001,
				)
			}
		})
	}
	private fineNumeric(c: NumericControl, count: number): Promise<void> {
		const ratio = (c.webStep ?? c.step) / c.step
		if (!Number.isSafeInteger(count) || !Number.isSafeInteger(ratio) || c.max - c.min <= 1)
			return Promise.reject(new Error('Fine steps require a whole step count and a numeric slider'))
		if (!count) return Promise.resolve()
		const steps = count * ratio
		if (!Number.isSafeInteger(steps) || Math.abs(steps) > 1000)
			return Promise.reject(new Error('Too many fine steps in one action'))
		const batch = this.fineBatches.get(c.id)
		if (
			batch &&
			batch.steps.length < 64 &&
			batch.steps.reduce((n, s) => n + Math.abs(s), 0) + Math.abs(steps) <= 4096
		) {
			// Preserve direction changes at bounds. Summing +1/-1 would lose a real edit.
			batch.steps.push(steps)
			return batch.promise
		}
		const item = { steps: [steps], promise: Promise.resolve() }
		const session = this.fineSessions.get(c.id) || { failed: false }
		this.fineSessions.set(c.id, session)
		item.promise = this.queue(
			'native',
			async () => {
				if (this.fineBatches.get(c.id) === item) this.fineBatches.delete(c.id)
				if (session.failed)
					throw new Error('Fine adjustment cancelled after an earlier failure; check Lightroom before trying again')
				await this.receipted(c, 'nudge', item.steps, undefined, session)
			},
			c.field,
		)
		void item.promise
			.finally(() => {
				if (!this.tails.has('native:' + c.id) && this.fineSessions.get(c.id) === session) this.fineSessions.delete(c.id)
			})
			.catch(() => {})
		this.fineBatches.set(c.id, item)
		return item.promise
	}
	private async until<T>(read: () => Promise<T>, ready: (v: T) => boolean, timeout = 3000): Promise<T> {
		const deadline = Date.now() + timeout
		do {
			const value = await read()
			if (ready(value)) return value
			await delay(65)
		} while (!this.stopped && Date.now() < deadline)
		throw new Error(
			'Lightroom confirmation is unavailable. Check Lightroom; the command will not be sent again automatically.',
		)
	}
	private async ready(f: Family): Promise<State> {
		// A first state request can schedule the SDK read and return an empty cache.
		// Wait for that read; never send an edit using a guessed initial value.
		const first = await this.read(f)
		if (first.available !== false && first.contextOwned !== false) return first
		return this.until(
			() => this.read(f),
			(s) => s.available !== false && s.contextOwned !== false,
			2500,
		)
	}
	private capturePhotoIntent(): Promise<string> {
		const intent = this.request('/context').then((ctx) => {
			pick(ctx, ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt'])
			if (ctx.activeModule !== 'develop' || !ctx.selectedPhotoUuid)
				throw new Error('Select a photo in Lightroom Develop before using this control')
			return photoOwner(ctx)
		})
		// It may wait behind an earlier operation; attach rejection handling now.
		void intent.catch(() => {})
		return intent
	}
	private captureSelectionButtonIntent(libraryAllowed: boolean): Promise<State> {
		const intent = this.request('/context').then((ctx) => {
			pick(ctx, ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt'])
			if (!ctx.selectedPhotoUuid || !(libraryAllowed ? ['library', 'develop'] : ['develop']).includes(ctx.activeModule))
				throw new Error(
					libraryAllowed ? 'Select a photo in Lightroom Library or Develop' : 'Select a photo in Lightroom Develop',
				)
			return ctx
		})
		void intent.catch(() => {})
		return intent
	}
	private requireSelectionButtonIntent(s: State, intent: State): void {
		if (photoOwner(s) !== photoOwner(intent) || s.activeModule !== intent.activeModule)
			throw new Error('Photo or module changed while this button action was waiting; action was not sent')
	}
	private async readySelectionButton(f: 'clipboard' | 'export', intent: State, command: string): Promise<State> {
		return this.until(
			() => this.read(f),
			(s) => {
				this.requireSelectionButtonIntent(s, intent)
				// A state read schedules an SDK query but can still return the old cache.
				// Wait for usable feedback before the one mutation; never retry a mutation.
				requireAvailable({ ...s, available: true, contextOwned: true })
				if (
					s.available !== true ||
					s.contextOwned === false ||
					!Number.isFinite(s.ageMs) ||
					s.ageMs < 0 ||
					s.ageMs >= 5000
				)
					return false
				const supported =
					command === 'clipboard.copy'
						? 'copySupported'
						: command === 'clipboard.paste'
							? 'pasteSupported'
							: command === 'export.dialog'
								? 'dialogSupported'
								: 'previousSupported'
				if (s[supported] !== true) throw new Error('This action is unavailable for the current Lightroom selection')
				return true
			},
			2500,
		)
	}
	private async readySpecial(f: SpecialFamily, expectedPhoto: string, operationKind?: string): Promise<State> {
		let reason = 'Waiting for fresh Lightroom state'
		try {
			return await this.until(
				() => this.read(f),
				(s) => {
					if (photoOwner(s) !== expectedPhoto || s.activeModule !== 'develop')
						throw new Error('Photo changed while this control was waiting; action was not sent')
					reason = s.removalReason || s.reason || reason
					if (s.pendingOperation)
						throw new Error('A Lightroom operation is still pending; no additional command was sent')
					if (
						s.available !== true ||
						s.contextOwned === false ||
						!Number.isFinite(s.ageMs) ||
						s.ageMs < 0 ||
						s.ageMs >= 5000
					)
						return false
					if (f === 'people' && operationKind !== 'open') {
						if (!s.toolOpen) throw new Error('Open the People panel before detection or removal')
						if (operationKind === 'remove' && s.removalAvailable !== true) {
							if (s.refreshRequired === true) return false
							throw new Error(s.removalReason || 'Review detected People in Lightroom before removal')
						}
					}
					return true
				},
				2500,
			)
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Lightroom confirmation is unavailable'))
				throw new Error(`${reason}; action was not sent`)
			throw error
		}
	}
	private async completeSpecial(
		f: SpecialFamily,
		before: State,
		admitted: State | undefined,
		params: Params,
	): Promise<State> {
		const pending = admitted?.pendingOperation
		const sameContext = (s: State) =>
			s.serverEpoch === before.serverEpoch &&
			photoOwner(s) === photoOwner(before) &&
			s.developCounter === before.developCounter &&
			s.activeModule === 'develop'
		const sameOperation = (r: State) =>
			f === 'reflections'
				? r.field === params.field && r.value === params.value
				: r.operationKind === params.operationKind
		if (!admitted || !pending?.operationId || !sameContext(admitted) || !sameOperation(pending))
			throw new Error('Missing or mismatched Lightroom operation receipt; no retry was sent')
		this.afterSpecialAdmission(f)
		// Match the bridge's operation lifetime: AI callbacks may legitimately take
		// longer than the old generic six-second button deadline.
		const timeout =
			f === 'reflections' || (f === 'people' && params.operationKind === 'remove')
				? 125000
				: f === 'red-eye'
					? 16000
					: 11000
		const latest = await this.until(
			() => this.read(f),
			(s) => {
				if (!sameContext(s))
					throw new Error('Photo or Lightroom context changed during confirmation; no retry was sent')
				if (s.pendingOperation && s.pendingOperation.operationId !== pending.operationId)
					throw new Error('Another Lightroom operation replaced this request; no retry was sent')
				const result = s.lastResult
				if (!result || result.operationId !== pending.operationId) return false
				if (!sameOperation(result)) throw new Error('Mismatched Lightroom operation result; no retry was sent')
				const requested =
					result.outcome === 'requested' &&
					result.invoked === true &&
					((f === 'people' && ['open', 'detect'].includes(String(params.operationKind))) ||
						(f === 'red-eye' && params.operationKind === 'reset'))
				if (result.outcome !== 'confirmed' && !requested)
					throw new Error(result.detail || `Lightroom operation ${result.outcome || 'failed'}; no retry was sent`)
				if (s.pendingOperation) return false
				if (
					f === 'reflections' &&
					(s.available !== true ||
						s.isSupported !== true ||
						s[String(params.field)] !== params.value ||
						(result.invoked && params.field !== 'amount' && result.callbackCompleted !== true))
				)
					throw new Error('Lightroom did not confirm the requested Reflections state')
				if (
					f === 'people' &&
					params.operationKind === 'remove' &&
					(result.invoked !== true || result.callbackCompleted !== true)
				)
					throw new Error('People removal callback is unconfirmed; review Lightroom')
				return true
			},
			timeout,
		)
		return latest
	}
	private async readyRemoveButton(intent: State): Promise<State> {
		// A closed Healing tool has available=false for its editing preferences.
		// Open/Close needs only a fresh, owned photo/tool snapshot. Checkbox
		// actions also use this capture, then require available brush preferences.
		const panelReady = (s: State) => {
			this.requireSelectionButtonIntent(s, intent)
			requireAvailable({ ...s, available: true, contextOwned: true })
			return (
				s.activeModule === 'develop' &&
				typeof s.selectedPhotoUuid === 'string' &&
				s.selectedPhotoUuid.length > 0 &&
				['loupe', 'crop', 'dust', 'redeye', 'masking', 'point_color', 'local_point_color', 'depth_refinement'].includes(
					s.selectedTool,
				) &&
				s.contextOwned !== false &&
				Number.isFinite(s.ageMs) &&
				s.ageMs >= 0 &&
				s.ageMs < 5000
			)
		}
		const first = await this.read('remove')
		panelReady(first)
		// GET schedules an SDK refresh but returns a cache. Even a recent closed
		// cache can name an obsolete tool or checkbox value. Both writes and
		// apparent no-ops need a new owned capture before choosing a baseline.
		const capturedAt = first.capturedAt
		const state = await this.until(
			() => this.read('remove'),
			(s) =>
				panelReady(s) && Number.isFinite(s.capturedAt) && (!Number.isFinite(capturedAt) || s.capturedAt > capturedAt),
			2500,
		)
		// Keep pending-operation/review guards; only brush availability is irrelevant here.
		requireAvailable({ ...state, available: true })
		return state
	}
	private async readyLensBlurSdk(intent: State, path: string): Promise<State> {
		const cached = this.snapshots.get('lens-blur-sdk')
		const available = (s: State) =>
			path.endsWith('/bokeh') ? s.bokehAvailable === true : s.selectedToolAvailable === true
		// Apply is an explicit boolean command. Like the Web Controller it can
		// enable Lens Blur even before Lightroom reports the current Apply value.
		if (path.endsWith('/apply')) return cached && this.sameLensOwner(cached, intent) ? cached : intent
		if (
			cached &&
			this.sameLensOwner(cached, intent) &&
			Date.now() - (this.readAt.get('lens-blur-sdk') ?? -Infinity) < 750 &&
			available(cached)
		) {
			requireAvailable(cached)
			return cached
		}
		return this.until(
			() => this.read('lens-blur-sdk'),
			(s) => {
				// This older bridge endpoint exposes these context fields but no
				// contextChangedAt. Check the fields it actually supplies.
				// developCounter can advance after the preceding edit on this same
				// photo; that must not discard the user's next explicit shape target.
				if (!this.sameLensOwner(s, intent))
					throw new Error('Photo or module changed while this button action was waiting; action was not sent')
				requireAvailable(s)
				return available(s)
			},
			2500,
		)
	}
	private sameLensOwner(a: State, b: State): boolean {
		return ['activeModule', 'selectedPhotoUuid', 'contextCounter'].every((key) => a[key] === b[key])
	}
	private refreshLensBlurSdk(before: State, path: string, params: Params): void {
		const family = 'lens-blur-sdk'
		const field = path.endsWith('/bokeh') ? 'bokeh' : path.endsWith('/apply') ? 'active' : 'selectedTool'
		const followup: LensFollowup = {
			intent: before,
			revision: Number.isSafeInteger(before.revision) ? before.revision : -1,
			deadline: Date.now() + 2500,
			observed: (s) =>
				s[field + 'Available'] === true &&
				(field === 'selectedTool'
					? path.endsWith('/select')
						? s.selectedTool === 'depth_refinement'
						: s.selectedTool !== 'depth_refinement'
					: s[field] === (params.value ?? params.enabled)),
		}
		this.lensFollowup = followup
		// Retire any state request started before admission. Never let a warm
		// snapshot bypass the bridge's field invalidation on a rapid next press.
		this.readSerial.set(family, (this.readSerial.get(family) || 0) + 1)
		const cached = this.snapshots.get(family)
		if (cached && this.sameLensOwner(cached, before))
			this.snapshots.set(family, { ...cached, [field + 'Available']: false })
		this.io.changed()
		const previous = this.refreshTimers.get(family)
		if (previous) clearTimeout(previous)
		this.refreshTimers.delete(family)
		const read = async () => {
			if (this.stopped || this.lensFollowup !== followup) return
			try {
				const s = await this.read(family)
				if (this.stopped || this.lensFollowup !== followup) return
				if (!this.sameLensOwner(s, before)) {
					this.lensFollowup = undefined
					return
				}
				if (Number.isSafeInteger(s.revision) && s.revision > followup.revision && followup.observed(s)) {
					this.lensFollowup = undefined
					return
				}
				if (Date.now() >= followup.deadline) {
					this.lensFollowup = undefined
					this.lastError = 'Lens Blur confirmation timed out; check Lightroom. No command was resent.'
					this.invalidate(family)
					return
				}
				const timer = setTimeout(() => {
					this.refreshTimers.delete(family)
					void read()
				}, 80)
				this.refreshTimers.set(family, timer)
			} catch (error) {
				if (this.stopped || this.lensFollowup !== followup) return
				this.lensFollowup = undefined
				this.lastError = error instanceof Error ? error.message : String(error)
				this.invalidate(family)
			}
		}
		// The Web Controller starts confirmation immediately, then polls at 80ms.
		// Keep this targeted cadence independent of the general family scheduler.
		void read()
	}
	private removeBase(s: State): string {
		return JSON.stringify([
			s.serverEpoch,
			s.activeModule,
			s.selectedPhotoUuid,
			s.contextCounter,
			s.developCounter,
			s.contextChangedAt,
		])
	}
	private removeIntent(s: State, repair: boolean): RemoveIntent {
		return {
			base: this.removeBase(s),
			tool: s.selectedTool,
			mode: s.newSpotType ?? null,
			...(repair ? { repairToken: s.repair?.token } : {}),
		}
	}
	private async readyRemove(): Promise<State> {
		const s = await this.ready('remove')
		requireAvailable(s)
		if (Number.isFinite(s.ageMs) && s.ageMs < 5000) return s
		return this.until(
			() => this.read('remove'),
			(latest) => {
				requireAvailable(latest)
				return Number.isFinite(latest.ageMs) && latest.ageMs < 5000
			},
			2500,
		)
	}
	private requireRemoveField(s: State, field: string): void {
		if (s.selectedTool !== 'dust') throw new Error('Open Healing in Lightroom before using this control')
		if (field.startsWith('selectedRepair')) {
			if (!s.repair?.available || !s.repair?.selected || typeof s.repair?.token !== 'string')
				throw new Error('Select an existing repair in Lightroom before adjusting it')
		} else if (field === 'brushFeather' && s.newSpotType === 'heal_patchmatch')
			throw new Error('Brush Feather is available in Heal or Clone mode')
		else if (['useGenerativeAI', 'detectObjects'].includes(field) && s.newSpotType !== 'heal_patchmatch')
			throw new Error('Generative AI and Detect Objects are available in Remove mode')
		else if (field === 'visualizationThreshold' && !s.visualizeSpots)
			throw new Error('Enable Visualize Spots before adjusting its threshold')
	}
	private async completeRemove(s: State, admitted: State | undefined, field: string, value: unknown): Promise<State> {
		const base = this.removeBase(s),
			repair = field.startsWith('selectedRepair'),
			pending = admitted?.pendingOperation
		const equal = (a: unknown, b: unknown) =>
			typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.000001 : a === b
		if (
			!pending?.operationId ||
			pending.field !== field ||
			!equal(pending.value, value) ||
			this.removeBase(admitted!) !== base ||
			(admitted!.newSpotType ?? null) !== (s.newSpotType ?? null) ||
			(repair && pending.targetRepairToken !== s.repair?.token)
		)
			throw new Error('Lightroom did not acknowledge this Healing operation; it will not be retried automatically')
		const latest = await this.until(
			() => this.read('remove'),
			(r) => {
				if (this.removeBase(r) !== base)
					throw new Error('Photo or Develop context changed during the Healing operation')
				const result = r.lastResult
				if (result?.operationId !== pending.operationId) return false
				if (
					result.field !== field ||
					!equal(result.value, value) ||
					(repair && result.targetRepairToken !== s.repair?.token)
				)
					throw new Error('Healing completion does not match the submitted operation')
				const requested =
					result.outcome === 'requested' &&
					(field === 'dustClose' ||
						(field === 'selectedRepair' && value === 'refresh') ||
						(field === 'selectedSelection' && ['add', 'subtract'].includes(String(value))))
				if (result.outcome !== 'confirmed' && !requested)
					throw new Error(result.detail || `Healing operation ${result.outcome || 'failed'}; no automatic retry`)
				if (requested) return true
				if (field === 'selectedRepair' || field === 'selectedSelection') return true
				if (
					!equal(r[field], value) ||
					(field === 'selectedTool'
						? value === 'dust' && (!r.available || r.newSpotType !== 'heal_patchmatch')
						: !r.available ||
							r.selectedTool !== 'dust' ||
							r.newSpotType !== (field === 'newSpotType' ? value : s.newSpotType)) ||
					(repair && (!r.repair?.selected || result.resultRepairToken !== r.repair.token))
				)
					throw new Error('Lightroom did not confirm the Healing value and its original target')
				return true
			},
			6000,
		)
		// A selected-repair edit changes its native token. Carry only our exact,
		// confirmed token transition into edits already queued for that repair.
		if (repair && ['selectedRepairOpacity', 'selectedRepairFeather'].includes(field)) {
			for (const intent of this.removeIntents)
				if (intent.base === base && intent.repairToken === s.repair.token) intent.repairToken = latest.repair.token
		}
		return latest
	}
	readNumeric(c: NumericControl, s: State): { value: number; min: number; max: number } {
		requireAvailable(s)
		let entry: State | undefined, raw: unknown
		switch (c.family) {
			case 'native':
			case 'crop':
			case 'mask-global':
				entry = s.results?.[c.field]
				break
			case 'grading':
				entry = s.parameters?.[c.field]
				break
			case 'point-color':
			case 'mask-point-color': {
				const pc = c.family === 'mask-point-color' ? s.pointColor : s
				if (!pc?.available || !pc.selectedIndex || pc.selectionTransient)
					throw new Error('Select an existing Point Color swatch in Lightroom')
				raw = c.range ? pc[c.range]?.[c.field] : pc[c.field]
				break
			}
			case 'masking':
				entry = s.corrections?.find((v: State) => v.parameter === c.field)
				break
			case 'curve':
			case 'mask-curve':
				entry = s.refineSaturation
				break
			case 'develop-presets':
				entry = s.amountFeedback
				break
			case 'enhance':
				if (!s.denoiseState) throw new Error('Denoise is off')
				raw = s.denoiseAmount
				break
			case 'lens-blur': {
				if (['nearOuter', 'nearInner', 'farInner', 'farOuter'].includes(c.field)) {
					if (!s.focalRangeAvailable) throw new Error('Focus Range unavailable')
					raw = s.focalRange?.[c.field]
				} else {
					entry = s.windowsNative?.brush?.[c.field] ?? s.windowsNative?.[c.field]
				}
				break
			}
			case 'remove':
				this.requireRemoveField(s, c.field)
				raw =
					c.field === 'selectedRepairOpacity'
						? s.repair?.opacity
						: c.field === 'selectedRepairFeather'
							? s.repair?.feather
							: s[c.field]
				break
			case 'reflections':
				entry = s[c.field]
				break
			default:
				entry = s
		}
		if (typeof entry === 'number') raw = entry
		else if (entry) {
			if (entry.available === false || entry.enabled === false) throw new Error('Control unavailable')
			raw = entry.value
		}
		const scale = c.scale || 1
		const min =
			typeof entry?.min === 'number'
				? entry.min * scale
				: typeof entry?.range?.min === 'number'
					? entry.range.min * scale
					: c.min
		const max =
			typeof entry?.max === 'number'
				? entry.max * scale
				: typeof entry?.range?.max === 'number'
					? entry.range.max * scale
					: c.max
		return { value: finite(raw) * scale, min, max }
	}
	async numeric(id: string, mode: 'set' | 'adjust' | 'reset' | 'fine', input = 0): Promise<void> {
		if (/^blur_focus_(nearOuter|nearInner|farOuter|farInner|retired)$/.test(id)) throw new Error(retiredFocusRange)
		const c = numericById.get(id)
		if (!c) throw new Error('Unknown control')
		if (this.stopped) throw new Error('Connection stopped')
		if (!['set', 'adjust', 'reset', 'fine'].includes(mode)) throw new Error('Unknown numeric operation')
		if (mode === 'reset' && c.reset === undefined) throw new Error('This control has no Reset action')
		if (!Number.isFinite(input)) throw new Error('Invalid value')
		if (c.family === 'native' && mode === 'fine') return this.fineNumeric(c, input)
		if (c.family === 'native') this.fineBatches.delete(c.id)
		if (mode === 'fine') mode = 'adjust'
		if (c.family === 'grading') return this.gradingNumeric(c, mode, input)
		if (c.family === 'crop') {
			const snapshot = this.snapshots.get('crop')
			const expectedOwner = snapshot ? photoOwner(snapshot) : undefined
			if (mode === 'adjust') this.cropAngle.turn(input * c.step, expectedOwner)
			else await this.cropAngle.set(mode === 'reset' ? c.reset! : input, mode === 'reset', expectedOwner)
			return
		}
		// Critical compatibility boundary: no state request, queue or new timer here.
		if (c.family === 'native' && mode === 'adjust' && c.nativeAdjust) {
			if (!Number.isSafeInteger(input)) throw new Error('Lightroom steps must be whole numbers')
			const gate = this.nativeGates.get(c.field)
			if (gate) await gate
			if (this.stopped) throw new Error('Connection stopped')
			await this.io.adjust(c.field, input)
			return
		}
		let admissionDone = () => {},
			admissionFailed = (_e: unknown) => {}
		if (c.family === 'native' && mode === 'reset') {
			const gate = new Promise<void>((resolve, reject) => {
				admissionDone = resolve
				admissionFailed = reject
			})
			this.nativeGates.set(c.field, gate)
			void gate
				.finally(() => {
					if (this.nativeGates.get(c.field) === gate) this.nativeGates.delete(c.field)
				})
				.catch(() => {})
		}
		// Merge only adjacent waiting encoder ticks. Resets and buttons are barriers.
		const batchKey = familyKey(c.family) + ':' + id
		const batch = mode === 'adjust' ? this.adjustmentBatches.get(batchKey) : undefined
		if (batch) {
			batch.amount += input
			return batch.promise
		}
		if (mode !== 'adjust') this.clearBatches(c.family)
		const specialIntent = c.family === 'reflections' ? this.capturePhotoIntent() : null
		const captured = this.snapshots.get(c.family),
			expectedOwner = captured ? owner(captured) : null
		const removeGeneration = this.removeGeneration
		const removeIntent =
			c.family === 'remove' && captured ? this.removeIntent(captured, c.field.startsWith('selectedRepair')) : undefined
		if (removeIntent) this.removeIntents.add(removeIntent)
		const item = { amount: input, promise: Promise.resolve() }
		item.promise = this.queue(
			c.family,
			async () => {
				if (this.adjustmentBatches.get(batchKey) === item) this.adjustmentBatches.delete(batchKey)
				if (c.family === 'remove' && removeGeneration !== this.removeGeneration)
					throw new Error(
						'Earlier Healing operation failed; queued adjustment cancelled. Check Lightroom before trying again.',
					)
				input = item.amount
				if (mode === 'adjust' && input === 0) return
				if (c.family === 'native') {
					if (mode === 'adjust' && c.max - c.min === 1) throw new Error('Use Set 0 or Set 1 for this switch')
					if (mode === 'reset' || mode === 'adjust') {
						await this.receipted(c, mode === 'reset' ? 'reset' : 'nudge', input, admissionDone)
						return
					}
					const r = await this.request('/feedback/request', { slider: c.field, purpose: 'edit' })
					const snapshot = await this.until(
						() => this.request('/feedback/snapshot', { id: r.request.id, wait: 1 }),
						(r) => r.snapshot?.complete,
					)
					const v = snapshot.snapshot.results[c.field]
					if (!v?.available) throw new Error('Slider unavailable')
					bounds(input, finite(v.range?.min), finite(v.range?.max))
					await this.request('/set', { slider: c.field, value: input })
					this.lastStatus = `${c.label}: command sent`
					return
				}
				const s =
					c.family === 'reflections'
						? await this.readySpecial('reflections', await specialIntent!)
						: c.family === 'remove'
							? await this.readyRemove()
							: await this.ready(c.family)
				if (c.family !== 'reflections' && expectedOwner && owner(s) !== expectedOwner)
					throw new Error('Selection changed while adjustment was queued')
				if (
					removeIntent &&
					(removeIntent.base !== this.removeBase(s) ||
						removeIntent.tool !== s.selectedTool ||
						removeIntent.mode !== (s.newSpotType ?? null) ||
						(c.field.startsWith('selectedRepair') && removeIntent.repairToken !== s.repair?.token))
				)
					throw new Error('Healing tool, mode or selected repair changed while the adjustment was queued')
				const current = this.readNumeric(c, s)
				if (mode === 'reset' && c.family === 'masking') {
					const receipt = await this.request('/masking/correction/reset', {
						...pick(s, [...fields, 'selectedMaskGroupId']),
						parameter: c.field,
					})
					const latest = await this.until(
						() => this.read('masking'),
						(r) => {
							if (owner(r) !== owner(s)) throw new Error('Mask changed during Reset')
							const result = r.correctionResults?.find(
								(v: State) => v.parameter === c.field && v.sequence === receipt.correctionSequence,
							)
							if (result && result.outcome !== 'confirmed')
								throw new Error(result.detail || 'Mask Reset was not confirmed')
							return Boolean(result)
						},
					)
					this.lastStatus = `${c.label}: ${this.readNumeric(c, latest).value} confirmed after Reset`
					return
				}
				if (mode === 'reset' && c.family === 'lens-blur') {
					const result = await this.request(`/lens-blur/brush/${c.field}/reset`)
					const actual = this.readNumeric(c, { ...s, windowsNative: result.windowsNative })
					this.numericValues.set(c.id, { value: actual.value, available: true })
					this.lastStatus = `${c.label}: ${actual.value} confirmed after Reset`
					return
				}
				let value = bounds(
					mode === 'reset'
						? (c.reset ?? NaN)
						: mode === 'adjust'
							? Math.max(current.min, Math.min(current.max, current.value + input * c.step))
							: input,
					current.min,
					current.max,
				)
				if (c.family === 'remove' && Math.abs(current.value - value) < 0.000001) {
					this.lastStatus = `${c.label}: ${current.value} already confirmed`
					return
				}
				const receipt = await this.writeNumeric(c, s, value, mode === 'reset')
				if (c.family === 'reflections') {
					await this.completeSpecial('reflections', s, receipt, { field: c.field, value })
					this.lastStatus = `${c.label}: ${value} confirmed`
					return
				}
				if (c.family === 'remove') {
					const latest = await this.completeRemove(s, receipt, c.field, value / (c.scale || 1))
					this.lastStatus = `${c.label}: ${this.readNumeric(c, latest).value} confirmed`
					return
				}
				const key = owner(s)
				await this.until(
					async () => {
						const latest = await this.read(c.family)
						if (owner(latest) !== key)
							throw new Error('Photo or selected mask changed; previous adjustment is no longer current')
						return latest
					},
					(latest) => {
						try {
							return Math.abs(this.readNumeric(c, latest).value - value) < 0.00001
						} catch {
							return false
						}
					},
				)
				this.lastStatus = `${c.label}: ${value} confirmed`
			},
			c.family === 'native' ? c.field : '',
		)
		void item.promise.catch(admissionFailed)
		if (c.family === 'remove')
			void item.promise
				.catch(() => {
					if (removeGeneration === this.removeGeneration) {
						this.removeGeneration++
						this.clearBatches('remove')
					}
				})
				.finally(() => {
					if (removeIntent) this.removeIntents.delete(removeIntent)
				})
		if (mode === 'adjust') this.adjustmentBatches.set(batchKey, item)
		return item.promise
	}
	private clearBatches(f: Family) {
		for (const key of this.adjustmentBatches.keys())
			if (key.startsWith(familyKey(f) + ':')) this.adjustmentBatches.delete(key)
	}
	private async receipted(
		c: NumericControl,
		route: 'reset' | 'nudge',
		input: number | number[],
		admitted = () => {},
		session?: { owner?: string; failed: boolean },
	) {
		const capabilities = await this.request(`/${route}/capabilities`),
			requestId = randomUUID()
		if (capabilities.supported !== true) throw new Error(`This LRBridge version does not support ${route} completion`)
		if (session) {
			const currentOwner = JSON.stringify([capabilities.serverEpoch, photoOwner(capabilities.context)])
			if (session.owner && session.owner !== currentOwner)
				throw new Error('Photo changed; queued fine adjustment was cancelled')
			session.owner = currentOwner
		}
		const body: State = {
			requestId,
			serverEpoch: capabilities.serverEpoch,
			slider: c.field,
			...pick(capabilities.context, ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt']),
		}
		if (route === 'nudge') {
			const steps = Array.isArray(input) ? input : [input]
			if (
				!steps.length ||
				steps.length > 64 ||
				steps.some((v) => !Number.isSafeInteger(v) || v === 0 || Math.abs(v) > 1000) ||
				steps.reduce((sum, v) => sum + Math.abs(v), 0) > 4096
			)
				throw new Error('Invalid numeric step sequence')
			body.steps = steps
		}
		const admission = await this.request(`/${route}`, {}, body),
			receipt = admission.receipt
		if (!receipt?.operationId) throw new Error('Missing operation receipt')
		admitted()
		const completed = await this.until(
			() => this.request(`/${route}/result`, { serverEpoch: body.serverEpoch, requestId }),
			(r) => r.receipt?.phase === 'complete',
			4000,
		)
		const result = completed.receipt.result
		// Numeric Nudge binds the epoch on the receipt envelope; Reset also repeats it
		// inside result. Validate the actual beta.4 formats, not an invented result field.
		if (
			completed.receipt.serverEpoch !== body.serverEpoch ||
			completed.receipt.requestId !== requestId ||
			completed.receipt.operationId !== receipt.operationId
		)
			throw new Error('Mismatched operation result identity')
		if (route === 'reset' && result?.serverEpoch !== body.serverEpoch) throw new Error('Mismatched Reset epoch')
		for (const key of ['requestId', 'slider', 'selectedPhotoUuid', 'contextCounter', 'contextChangedAt'])
			if (result?.[key] !== body[key]) throw new Error('Mismatched operation result')
		if (result.operationId !== receipt.operationId || result.outcome !== 'observed')
			throw new Error(`${route}: ${result?.outcome || 'unconfirmed'} — ${result?.detail || 'inspect Lightroom'}`)
		const ctx = await this.request('/context')
		for (const key of ['selectedPhotoUuid', 'contextCounter', 'contextChangedAt'])
			if (ctx[key] !== body[key]) throw new Error('Photo changed after operation; old result was discarded')
		const value = finite(result.sdkValue)
		if (
			this.stopped ||
			this.io.nativeConfirmed?.({
				slider: c.field,
				value,
				context: ctx,
				serverEpoch: body.serverEpoch,
				completedAt: result.completedAt,
			}) === false
		)
			throw new Error('Connection or photo changed; old result was discarded')
		// An older family read must not replace this exact, validated SDK result.
		this.readSerial.set('native', (this.readSerial.get('native') || 0) + 1)
		this.numericValues.set(c.id, { value, available: true })
		this.lastStatus = `${c.label}: ${result.sdkValue} confirmed after ${route}`
		this.io.changed()
	}
	private async gesture(prefix: string, binding: Params, payload: Params, value: Params) {
		// beta.4 validates a distinct ID prefix for each Masking gesture family.
		const idPrefix =
			prefix === '/masking/correction/gesture'
				? 'mg-'
				: prefix === '/masking/tone-curve/gesture'
					? 'curve_'
					: prefix === '/masking/tone-curve/refine-saturation/gesture'
						? 'refine_'
						: ''
		const gestureId = idPrefix + randomUUID(),
			common = { ...binding, ...payload, gestureId }
		await this.request(`${prefix}/begin`, common)
		// Never retry an end after an uncertain network failure: it may have executed.
		await this.request(`${prefix}/end`, { ...common, ...value })
	}
	private async readyCrop(c: NumericControl): Promise<State> {
		const cached = this.snapshots.get('crop')
		const readAt = this.readAt.get('crop')
		const age = readAt === undefined ? Infinity : Date.now() - readAt
		if (
			cached?.complete === true &&
			age >= 0 &&
			age <= 500 &&
			typeof cached.selectedPhotoUuid === 'string' &&
			cached.selectedPhotoUuid.length > 0 &&
			['contextCounter', 'contextChangedAt', 'developCounter'].every((k) => Number.isSafeInteger(cached[k]))
		) {
			const ctx = await this.request('/context')
			if (ctx.activeModule !== 'develop') throw new Error('Crop Angle requires the Develop module')
			if (
				cached.activeModule === 'develop' &&
				['selectedPhotoUuid', 'contextCounter', 'contextChangedAt', 'developCounter'].every((k) => cached[k] === ctx[k])
			) {
				try {
					this.readNumeric(c, cached)
					// Reuse only SDK feedback, never the requested target. The normal
					// post-write confirmation and Reset barrier remain in place.
					return cached
				} catch {
					/* Refresh unavailable feedback rather than guessing. */
				}
			}
		}
		return this.ready('crop')
	}
	private async writeNumeric(c: NumericControl, s: State, value: number, reset: boolean) {
		const v = value / (c.scale || 1)
		switch (c.family) {
			case 'crop':
				await this.request('/command', {
					command: reset ? 'photo.crop_angle.reset' : 'photo.crop_angle.set',
					...(reset ? {} : { value }),
				})
				break
			case 'mask-global':
				await this.request(reset ? '/reset' : '/set', {
					slider: c.field,
					...(reset ? {} : { value }),
					preserveMaskingPanel: true,
					...pick(s, ['selectedPhotoUuid', 'contextCounter']),
				})
				break
			case 'grading': {
				if (c.field.endsWith('Hue') || c.field.endsWith('Saturation') || c.field.endsWith('Sat')) {
					const region = c.region!,
						peers = numericControls.filter((x) => x.family === 'grading' && x.region === region)
					const hue = peers.find((x) => x.field.endsWith('Hue'))!,
						saturation = peers.find((x) => x.id.endsWith('_saturation'))!
					await this.request('/command', {
						command: 'color_grading.wheel.set',
						region,
						hue: c.id === hue.id ? value : this.readNumeric(hue, s).value,
						saturation: c.id === saturation.id ? value : this.readNumeric(saturation, s).value,
					})
				} else
					await this.request('/command', {
						command: reset ? 'color_grading.value.reset' : 'color_grading.value.set',
						control: c.region!,
						...(reset ? {} : { value }),
					})
				break
			}
			case 'point-color':
			case 'mask-point-color': {
				const masked = c.family === 'mask-point-color',
					pc = masked ? s.pointColor : s,
					prefix = masked ? '/masking/point-color' : '/point-color'
				const binding = masked
					? { ...pick(s, [...fields, 'selectedMaskGroupId']), selectedIndex: pc.selectedIndex }
					: {}
				await this.request(prefix + (c.range ? '/range' : '/value'), {
					...binding,
					...(c.range ? { range: c.range, boundary: c.field } : { field: c.field }),
					value: v,
				})
				break
			}
			case 'masking': {
				const binding = { ...pick(s, [...fields, 'selectedMaskGroupId']), parameter: c.field }
				if (reset) await this.request('/masking/correction/reset', binding)
				else await this.gesture('/masking/correction/gesture', binding, {}, { value })
				break
			}
			case 'curve':
			case 'mask-curve': {
				const prefix = curvePath(c.family) + '/refine-saturation',
					binding = curveBinding(c.family, s),
					baseline = finite(s.refineSaturation?.value)
				if (reset) await this.request(prefix + '/reset', { ...binding, baseline })
				else await this.gesture(prefix + '/gesture', binding, { baseline }, { value })
				break
			}
			case 'develop-presets':
				await this.request('/develop-presets/amount', {
					...pick(
						s,
						fields.filter((f) => f !== 'stateRevision'),
					),
					presetAmount: value,
					feedbackId: s.amountFeedback.id,
				})
				break
			case 'enhance':
				await this.request('/enhance/denoise/amount', { amount: value })
				break
			case 'lens-blur': {
				if (['nearOuter', 'nearInner', 'farInner', 'farOuter'].includes(c.field)) {
					const range = { ...s.focalRange, [c.field]: value }
					const keys = ['nearOuter', 'nearInner', 'farInner', 'farOuter']
					await this.request('/lens-blur/focal-range/set', {
						...pick(range, keys),
						expected: keys.map((k) => s.focalRange[k]).join(' '),
					})
				} else await this.request(`/lens-blur/brush/${c.field}/${reset ? 'reset' : 'set'}`, reset ? {} : { value })
				break
			}
			case 'remove': {
				const repair = c.field.startsWith('selectedRepair'),
					p = { ...pick(s, fields), mode: s.newSpotType, field: c.field, value: v }
				return await this.request(`/remove/${repair ? 'repair' : 'brush'}`, {
					...p,
					...(repair ? { repairToken: s.repair?.token } : {}),
				})
			}
			case 'reflections':
				return await this.request('/reflections/set', { ...pick(s, fields), field: c.field, value })
			default:
				throw new Error('Unsupported numeric route')
		}
	}
	async button(id: string, confirmed = false): Promise<void> {
		// Retained old presets must use the same explicit, guarded Open action.
		const c = buttonById.get(id === 'develop.action_selectHealingTool' ? 'healing_panel_dust' : id)
		if (!c) throw new Error('Unknown button')
		const guarded = sensitiveAction(c.path, c.params)
		if (guarded && this.io.beforeSensitiveAction?.(guarded) === false) return
		this.clearBatches(c.family)
		if (c.confirm && !confirmed) throw new Error('Enable confirmation in this action to allow it')
		if (c.params.command === 'application.action') {
			if (c.params.action === 'zoom_in' || c.params.action === 'zoom_out') {
				this.zoom.turn(c.params.action)
				return
			}
			if (c.params.action === 'toggle_zoom' || c.params.action === 'zoom_100') this.zoom.clear()
		}
		if (c.params.command === 'develop.action' && !c.params.target && this.io.action) {
			await this.io.action(String(c.params.action))
			return
		}
		const intent = specialFamily(c.family) ? this.capturePhotoIntent() : null
		const removeCheckbox =
			c.family === 'remove' &&
			c.path === '/remove/brush' &&
			['useGenerativeAI', 'detectObjects'].includes(String(c.params.field))
		const selectionIntent =
			c.family === 'clipboard' ||
			c.family === 'export' ||
			c.family === 'lens-blur-sdk' ||
			(c.family === 'remove' && (c.path === '/remove/panel' || removeCheckbox))
				? this.captureSelectionButtonIntent(c.family === 'clipboard' || c.family === 'export')
				: null
		const cached = this.snapshots.get(c.family),
			expectedPhoto = cached?.selectedPhotoUuid ? photoOwner(cached) : null
		const removeGeneration = this.removeGeneration
		const lensQueued = c.family === 'lens-blur-sdk' && this.tails.has(familyKey(c.family))
		return this.queue(c.family, async () => {
			if (c.family === 'remove' && removeGeneration !== this.removeGeneration)
				throw new Error(
					'Earlier Healing operation failed; queued button cancelled. Check Lightroom before trying again.',
				)
			let p = { ...c.params },
				s: State = {}
			if (specialFamily(c.family)) {
				s = await this.readySpecial(c.family, await intent!, String(p.operationKind || ''))
				requireAvailable(s)
			} else if (c.family === 'remove' && (c.path === '/remove/panel' || removeCheckbox)) {
				s = await this.readyRemoveButton(await selectionIntent!)
				if (removeCheckbox) requireAvailable(s)
			} else if (c.family === 'lens-blur-sdk') {
				const intent = await selectionIntent!
				if (lensQueued) {
					const current = await this.request('/context')
					if (!this.sameLensOwner(current, intent))
						throw new Error('Photo or module changed while this button action was waiting; action was not sent')
				}
				s = await this.readyLensBlurSdk(intent, c.path)
			} else if (c.family === 'clipboard' || c.family === 'export') {
				s = await this.readySelectionButton(c.family, await selectionIntent!, String(p.command))
			} else if (c.family !== 'command') {
				s = c.family === 'remove' ? await this.readyRemove() : await this.ready(c.family)
				requireAvailable(s)
			}
			if (!specialFamily(c.family) && !selectionIntent && expectedPhoto && photoOwner(s) !== expectedPhoto)
				throw new Error('Photo changed while this button action was waiting')
			switch (c.family) {
				case 'masking':
				case 'mask-point-color': {
					p = { ...p, ...pick(s, fields) }
					if (c.scope === 'group' || c.scope === 'tool' || c.scope === 'point')
						p.selectedMaskGroupId = pick(s, ['selectedMaskGroupId']).selectedMaskGroupId
					if (c.scope === 'tool') p.selectedMaskToolId = pick(s, ['selectedMaskToolId']).selectedMaskToolId
					if (c.path.endsWith('/sample') && Number(p.selectedIndex) > Number(s.pointColor?.swatchCount))
						throw new Error('That Point Color swatch does not exist')
					break
				}
				case 'point-color':
					if (c.path.endsWith('/sample')) {
						if (Number(p.selectedIndex) > Number(s.swatchCount))
							throw new Error('That Point Color swatch does not exist')
						p = {
							...p,
							...pick(
								s,
								fields.filter((k) => k !== 'stateRevision'),
							),
						}
					}
					break
				case 'curve':
				case 'mask-curve': {
					const channel = String(p.channel || 'rgb')
					p = { ...p, ...curveBinding(c.family, s), baseline: this.points(s, channel).join(',') }
					break
				}
				case 'clipboard':
				case 'export':
					p = { ...p, ...pick(s, [...fields, 'selectionToken', 'activeModule']), requestId: randomUUID() }
					break
				case 'develop-presets':
					if (!c.path.endsWith('/refresh'))
						p = {
							...p,
							...pick(
								s,
								fields.filter((f) => f !== 'stateRevision'),
							),
						}
					break
				case 'remove': {
					if (
						c.path === '/remove/panel' &&
						(p.value === 'dust' ? s.selectedTool === 'dust' : s.selectedTool !== 'dust')
					) {
						this.lastStatus = p.value === 'dust' ? 'Healing is already open' : 'Healing is already closed'
						return
					}
					if (c.path !== '/remove/panel') this.requireRemoveField(s, String(p.field))
					if (c.path === '/remove/brush' && s[String(p.field)] === p.value) {
						this.lastStatus = `${c.label}: already confirmed`
						return
					}
					p = { ...p, ...pick(s, fields), mode: c.path === '/remove/panel' ? (s.newSpotType ?? 'null') : s.newSpotType }
					if (c.scope === 'repair') p.repairToken = s.repair?.token
					if (c.scope === 'selection')
						p.selectionToken = ['add', 'subtract'].includes(String(p.value))
							? s.selection?.refinementToken
							: s.selection?.token
					break
				}
				case 'people':
				case 'red-eye':
				case 'reflections':
					p = { ...p, ...pick(s, fields) }
					break
				case 'lens-blur':
					if (c.path.endsWith('/visualize-depth'))
						p = { ...p, ...pick(s, ['selectedPhotoUuid', 'contextCounter', 'developCounter']) }
					break
				case 'enhance':
					if (c.path === '/enhance/denoise/set') p.amount = typeof s.denoiseAmount === 'number' ? s.denoiseAmount : 50
					break
				case 'history':
					if (s[String(p.command).endsWith('undo') ? 'canUndo' : 'canRedo'] !== true)
						throw new Error('History action unavailable')
					break
			}
			for (const [key, value] of Object.entries(p))
				if (value === undefined || value === null) throw new Error(`Current ${key} is unavailable`)
			let result: State
			if (removeCheckbox) {
				try {
					result = await this.request(c.path, p)
				} catch (error) {
					// This exact bridge response means admission rejected the request
					// before queuing a command. Native selection discovery can advance
					// the shared revision without changing the SDK checkbox baseline.
					if (
						!(error instanceof ControllerHttpError) ||
						error.status !== 409 ||
						error.message !== 'Remove tool, mode or context changed, or another operation is pending.'
					)
						throw error
					const previous = s
					s = await this.readyRemoveButton(await selectionIntent!)
					requireAvailable(s)
					if (this.removeBase(s) !== this.removeBase(previous) || s.newSpotType !== previous.newSpotType)
						throw new Error('Healing context or mode changed after rejected admission; action was not sent again')
					this.requireRemoveField(s, String(p.field))
					if (s[String(p.field)] === p.value) {
						this.lastStatus = `${c.label}: already confirmed`
						return
					}
					p = { ...p, ...pick(s, fields), mode: s.newSpotType }
					// One new admission only. Transport uncertainty, a second rejection
					// and all operation-completion failures leave this catch untouched.
					result = await this.request(c.path, p)
				}
			} else result = await this.request(c.path, p)
			if (c.family === 'lens-blur-sdk') {
				this.lastStatus = `${c.label}: command accepted`
				this.refreshLensBlurSdk(s, c.path, p)
				return
			}
			if (specialFamily(c.family)) {
				const latest = await this.completeSpecial(c.family, s, result, p)
				this.lastStatus = `${c.label}: ${latest.lastResult.detail || (latest.lastResult.outcome === 'requested' ? 'request delivered; review Lightroom' : 'confirmed')}`
				return
			}
			if (c.family === 'remove') {
				try {
					const latest = await this.completeRemove(s, result, String(p.field), p.value)
					this.lastStatus = `${c.label}: ${latest.lastResult.outcome === 'requested' ? 'requested; completion is not exposed by Lightroom' : 'confirmed'}`
				} catch (error) {
					if (removeGeneration === this.removeGeneration) {
						this.removeGeneration++
						this.clearBatches('remove')
					}
					throw error
				}
				return
			}
			const categoricalField =
				c.family === 'categorical'
					? (
							{
								'white-balance': 'whiteBalance',
								process: 'process',
								'vignette-style': 'vignetteStyle',
								'upright-mode': 'uprightMode',
								'constrain-crop': 'constrainCrop',
								'upright-tool': 'selectedTool',
							} as Record<string, string>
						)[c.path.split('/').at(-1)!]
					: undefined
			this.refreshAfterAction(
				c.family,
				categoricalField
					? (latest) =>
							latest[categoricalField + 'Available'] === true && latest[categoricalField] === (p.value ?? p.target)
					: undefined,
			)
			this.lastStatus = `${c.label}: command accepted`
			if (c.family === 'clipboard' || c.family === 'export') {
				const latest = await this.until(
					() => this.read(c.family),
					(r) => r.lastResult?.requestId === p.requestId || r.needsReview,
					6000,
				)
				const success = c.family === 'export' ? 'requested' : 'success'
				if (latest.needsReview || latest.lastResult?.outcome !== success)
					throw new Error(latest.lastResult?.detail || 'Result needs review in Lightroom; not automatically retried')
				this.lastStatus =
					c.family === 'export'
						? `${c.label}: Lightroom accepted the export request`
						: `${c.label}: Lightroom reported success`
			} else if (result.operationId || result.pendingOperation?.operationId) {
				const operationId = result.operationId || result.pendingOperation.operationId
				const key = c.family === 'develop-presets' ? 'lastApplication' : 'lastResult'
				const latest = await this.until(
					() => this.read(c.family),
					(r) => r[key]?.operationId === operationId && r[key]?.outcome,
					6000,
				)
				if (
					![
						'confirmed',
						'success',
						'SDK call completed and covered effect observed',
						'SDK call completed with no detectable change',
					].includes(latest[key]?.outcome)
				)
					throw new Error(latest[key]?.detail || `${c.label}: ${latest[key]?.outcome}`)
				this.lastStatus = `${c.label}: confirmed`
			} else if (c.path.endsWith('/sample')) {
				await this.until(
					() => this.read(c.family),
					(r) => (c.family === 'mask-point-color' ? r.pointColor?.selectedIndex : r.selectedIndex) === p.selectedIndex,
				)
				this.lastStatus = `${c.label}: selected`
			} else if (c.params.command === 'color_grading.region.reset') {
				const controls = numericControls.filter(
					(n) =>
						n.family === 'grading' &&
						(n.region === p.region ||
							(n.field.toLowerCase().includes(String(p.region).replace(/s$/, '')) && n.id.includes('luminance'))),
				)
				for (const n of controls) this.gradingTargets.delete(n.id)
				await this.until(
					() => this.read('grading'),
					(r) =>
						controls.every((n) => {
							try {
								return this.readNumeric(n, r).value === 0
							} catch {
								return false
							}
						}),
				)
				this.lastStatus = `${c.label}: confirmed`
			}
		})
	}
	private points(s: State, channel: string): number[] {
		const a = s.curves?.[channel]
		if (!Array.isArray(a) || a.length < 4 || a.length % 2 || !a.every(Number.isFinite))
			throw new Error('Current curve is unavailable')
		return a.slice()
	}
	async curve(
		masked: boolean,
		channel: string,
		operation: 'add' | 'move' | 'delete',
		index: number,
		x: number,
		y: number,
	): Promise<void> {
		const family: Family = masked ? 'mask-curve' : 'curve'
		return this.queue(family, async () => {
			const s = await this.ready(family)
			requireAvailable(s)
			const baseline = this.points(s, channel),
				points = baseline.slice(),
				count = points.length / 2
			if (operation !== 'add' && (!Number.isInteger(index) || index < 1 || index > count))
				throw new Error(`Point number must be 1–${count}`)
			if (operation === 'delete') {
				if (count <= 2 || index === 1 || index === count) throw new Error('Select an interior point to delete')
				points.splice((index - 1) * 2, 2)
			} else {
				bounds(x, 0, 255)
				bounds(y, 0, 255)
				if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Curve coordinates must be whole numbers')
				if (operation === 'add') {
					let i = 0
					while (i < points.length && points[i] < x) i += 2
					if (i === 0 || i === points.length || points[i] === x)
						throw new Error('New point must lie between existing endpoints at a distinct input')
					points.splice(i, 0, x, y)
				} else {
					points[(index - 1) * 2] = x
					points[(index - 1) * 2 + 1] = y
				}
				for (let i = 2; i < points.length; i += 2)
					if (points[i] <= points[i - 2]) throw new Error('Curve points must remain ordered')
			}
			// Preserve native endpoint inputs; e.g. Deep Blue starts at input 2, not 0.
			await this.gesture(
				curvePath(family) + '/gesture',
				curveBinding(family, s),
				{ channel, baseline: baseline.join(',') },
				{ points: points.join(',') },
			)
			const expectedOwner = owner(s)
			await this.until(
				() => this.read(family),
				(n) => {
					if (owner(n) !== expectedOwner) throw new Error('Curve ownership changed')
					return JSON.stringify(n.curves?.[channel]) === JSON.stringify(points)
				},
			)
			this.lastStatus = 'Curve edit confirmed'
		})
	}
	async choose(kind: 'profile' | 'preset' | 'mask-preset', name: string): Promise<void> {
		const family: Family = kind === 'profile' ? 'categorical' : kind === 'preset' ? 'develop-presets' : 'masking'
		return this.queue(family, async () => {
			const s = await this.ready(family)
			requireAvailable(s)
			const inventory =
				kind === 'profile'
					? s.profile?.options
					: kind === 'preset'
						? s.inventory
						: (await this.request('/masking/presets')).presets
			const matches = (inventory || []).filter((v: State) => [v.uuid, v.id, v.label, v.name].includes(name))
			if (matches.length !== 1) throw new Error('Choice missing or ambiguous; use its exact unique name or UUID')
			const choice = matches[0]
			if (
				choice.available === false ||
				choice.enabled === false ||
				choice.supported === false ||
				choice.writable === false
			)
				throw new Error('Choice is unavailable; select it in Lightroom')
			if (kind === 'profile') await this.request('/develop-categorical/profile', { token: choice.token })
			else if (kind === 'preset') {
				if (!s.configuration?.presets?.some((v: State) => v.uuid === choice.uuid))
					throw new Error('Add this preset to Favorites in the Web Controller or with the Favorite action first')
				await this.request('/develop-presets/apply', {
					uuid: choice.uuid,
					...pick(
						s,
						fields.filter((f) => f !== 'stateRevision'),
					),
				})
			} else
				await this.request('/masking/preset/apply', {
					preset: choice.id,
					...pick(s, [...fields, 'selectedMaskGroupId', 'selectedMaskToolId']),
				})
			this.lastStatus = `${name}: command accepted`
			this.refreshAfterAction(family)
		})
	}
	async crop(mode: string, w: number, h: number): Promise<void> {
		if (mode === 'custom') {
			if (![w, h].every((v) => Number.isInteger(v) && v >= 1 && v <= 10000))
				throw new Error('Aspect width and height must be whole numbers from 1 to 10000')
			await this.request('/command', { command: 'photo.crop_aspect', mode, w, h })
		} else if (mode === 'angle') await this.numeric('crop_angle', 'set', w)
		else if (mode === 'reset-angle') await this.numeric('crop_angle', 'reset')
		else throw new Error('Unknown crop operation')
		this.lastStatus = 'Crop command accepted'
		this.io.changed()
	}
	async translateRange(masked: boolean, range: string, amount: number): Promise<void> {
		const family: Family = masked ? 'mask-point-color' : 'point-color'
		this.clearBatches(family)
		return this.queue(family, async () => {
			if (!['HueRange', 'SatRange', 'LumRange'].includes(range) || !Number.isFinite(amount))
				throw new Error('Invalid Point Color range adjustment')
			const s = await this.read(family)
			requireAvailable(s)
			const pc = masked ? s.pointColor : s
			if (!pc?.selectedIndex || !pc[range]) throw new Error('Select a Point Color swatch first')
			const keys = ['LowerNone', 'LowerFull', 'UpperFull', 'UpperNone'],
				values: Params = {}
			const delta = Math.max(-pc[range].LowerNone, Math.min(1 - pc[range].UpperNone, amount / 100))
			for (const k of keys) values[k] = Number((finite(pc[range][k]) + delta).toFixed(6))
			await this.request((masked ? '/masking' : '') + '/point-color/range/translate', {
				range,
				...values,
				...(masked ? { ...pick(s, [...fields, 'selectedMaskGroupId']), selectedIndex: pc.selectedIndex } : {}),
			})
			this.lastStatus = 'Range translation sent'
			this.io.changed()
		})
	}
	async favorite(
		operation: 'add' | 'remove' | 'update',
		uuid: string,
		alias: string,
		amountEnabled: boolean,
		updateAISettings: boolean,
	): Promise<void> {
		return this.queue('develop-presets', async () => {
			const s = await this.read('develop-presets')
			requireAvailable(s)
			if (!['add', 'remove', 'update'].includes(operation)) throw new Error('Unknown favorite operation')
			const inventory = (s.inventory || []).filter((p: State) => p.uuid === uuid || p.name === uuid)
			if (inventory.length === 1) uuid = inventory[0].uuid
			else if (inventory.length > 1) throw new Error('Duplicate preset names; use the exact UUID')
			const presets = (s.configuration?.presets || []).map((p: State) => ({ ...p })),
				index = presets.findIndex((p: State) => p.uuid === uuid)
			if (operation === 'remove') {
				if (index < 0) throw new Error('Preset is not a favorite')
				presets.splice(index, 1)
			} else {
				if (!(s.inventory || []).some((p: State) => p.uuid === uuid))
					throw new Error('Choose a UUID from the current preset inventory')
				const entry = { uuid, ...(alias.trim() ? { alias: alias.trim() } : {}), amountEnabled, updateAISettings }
				if (index < 0) presets.push(entry)
				else presets[index] = entry
			}
			await this.request('/develop-presets/config', {}, { version: 1, presets })
			this.lastStatus = 'Preset favorites saved'
			this.io.changed()
		})
	}
	async focusRange(_part: string, _amount: number): Promise<void> {
		throw new Error(retiredFocusRange)
	}
	async acknowledge(family: 'clipboard' | 'export'): Promise<void> {
		return this.queue(family, async () => {
			const s = await this.read(family)
			if (!s.needsReview) throw new Error('No result awaiting review')
			await this.request(`/${family}/acknowledge`, {
				serverEpoch: s.serverEpoch,
				operationId: s.lastResult?.operationId,
			})
			this.lastStatus = 'Review acknowledged; no command replayed'
		})
	}
}
