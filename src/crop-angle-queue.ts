import { setTimeout as delay } from 'node:timers/promises'

export interface CropAngleState {
	owner: string
	value: number
}
export interface CropAngleIO {
	ready(): Promise<CropAngleState>
	context(): Promise<string>
	read(): Promise<CropAngleState>
	write(value: number, reset: boolean): Promise<void>
	dequeued(): Promise<boolean>
	hold(): () => void
	changed(status: string): void
	failed(error: unknown): void
}
type Turns = { offset: number; low: number; high: number; owner?: string }
type Barrier = { value: number; reset: boolean; owner?: string; resolve(): void; reject(error: unknown): void }
type Session = CropAngleState & { active: boolean; admitted: boolean; revision: number; expires: number }
const clamp = (v: number, low = -4500, high = 4500) => Math.max(low, Math.min(high, v))

/** Latest absolute intent is separate from displayed SDK feedback. One HTTP
 * mutation runs at a time; LRBridge coalesces its unsent Crop Angle commands.
 * Reset waits for a newly requested SDK snapshot before admitting later turns.
 */
export class CropAngleQueue {
	private turns?: Turns
	private barrier?: Barrier
	private activeBarrier?: Barrier
	private session?: Session
	private worker?: Promise<void>
	private feedback?: Promise<void>
	private release?: () => void
	private stopped = false
	private generation = 0

	constructor(private readonly io: CropAngleIO) {}

	turn(amount: number, owner?: string): void {
		if (this.stopped) throw new Error('Connection stopped')
		if (!Number.isFinite(amount)) throw new Error('Invalid Crop Angle adjustment')
		if (!amount) return
		// Compose clamped functions rather than summing ticks: + at the end stop
		// followed by - must reverse immediately, including during the first read.
		const step = clamp(Math.round(amount * 100), -9000, 9000)
		const turns = (this.turns ??= { offset: 0, low: -4500, high: 4500, owner })
		turns.offset += step
		turns.low = clamp(turns.low + step)
		turns.high = clamp(turns.high + step)
		if (turns.low === turns.high) turns.offset = 0
		this.start()
	}

	set(value: number, reset: boolean, owner?: string): Promise<void> {
		if (this.stopped) return Promise.reject(new Error('Connection stopped'))
		if (!Number.isFinite(value) || value < -45 || value > 45)
			return Promise.reject(new Error('Crop Angle must be between -45 and 45'))
		this.turns = undefined
		this.barrier?.reject(new Error('Crop Angle command superseded before admission'))
		const promise = new Promise<void>((resolve, reject) => {
			this.barrier = { value: Number(value.toFixed(2)), reset, owner, resolve, reject }
		})
		this.start()
		return promise
	}

	isPending(): boolean {
		return Boolean(this.turns || this.barrier || this.worker || this.session?.active)
	}
	stop(): void {
		this.stopped = true
		this.fail(new Error('Connection stopped'))
	}
	async idle(): Promise<void> {
		while (this.worker || this.feedback) await Promise.all([this.worker, this.feedback])
	}
	private start(): void {
		this.release ??= this.io.hold()
		if (!this.worker) this.worker = Promise.resolve().then(() => this.run())
	}
	private finish(): void {
		if (this.worker || this.feedback || this.turns || this.barrier || this.session?.active) return
		this.session = undefined
		this.release?.()
		this.release = undefined
	}
	private fail(error: unknown): void {
		this.generation++
		this.turns = undefined
		this.barrier?.reject(error)
		this.activeBarrier?.reject(error)
		this.barrier = this.activeBarrier = undefined
		this.session = undefined
		this.release?.()
		this.release = undefined
		if (!this.stopped) this.io.failed(error)
	}
	private valid(generation: number): boolean {
		return !this.stopped && generation === this.generation
	}
	private async run(): Promise<void> {
		const generation = this.generation
		try {
			while (this.valid(generation) && (this.turns || this.barrier)) {
				if (!this.session) {
					const state = await this.io.ready()
					if (!this.valid(generation)) return
					if (!Number.isFinite(state.value) || state.value < -45 || state.value > 45)
						throw new Error('Crop Angle SDK feedback is unavailable')
					this.session = { ...state, active: false, admitted: false, revision: 0, expires: 0 }
				}
				const context = await this.io.context()
				if (!this.valid(generation)) return
				const session = this.session!
				const intent = this.barrier || this.turns
				if (!intent) continue
				if (context !== session.owner || (intent.owner && intent.owner !== session.owner))
					throw new Error('Photo changed; pending Crop Angle adjustment discarded')
				const barrier = this.barrier
				let value: number
				if (barrier) {
					this.barrier = undefined
					this.activeBarrier = barrier
					value = barrier.value
				} else {
					const turns = this.turns!
					this.turns = undefined
					value = clamp(Math.round(session.value * 100) + turns.offset, turns.low, turns.high) / 100
				}
				session.value = value
				session.revision++
				session.active = true
				session.admitted = false
				await this.io.write(value, barrier?.reset ?? false)
				if (!this.valid(generation)) return
				session.expires = Date.now() + 4000
				if (barrier) {
					// Feedback has its own SDK polling loop, so a fresh read alone
					// cannot prove an unsent Reset left the coalescing command queue.
					// Once dequeued it cannot be replaced by our following turn; the
					// SDK feedback loop also waits for command-busy plus settling.
					while (!(await this.io.dequeued())) {
						if (!this.valid(generation)) return
						if (Date.now() >= session.expires)
							throw new Error('Crop Angle command remains queued; later turns discarded')
						await delay(40)
					}
					if (!this.valid(generation)) return
				}
				session.admitted = true
				this.io.changed(`Crop Angle: ${value} sent; awaiting Lightroom feedback`)
				this.confirm(generation)
				if (barrier) {
					// An admitted reset must execute before a following set can replace
					// it in the bridge's coalescing queue.
					while (this.valid(generation) && session.active) {
						this.confirm(generation)
						await this.feedback
					}
					if (!this.valid(generation)) return
					this.activeBarrier = undefined
					barrier.resolve()
				}
			}
		} catch (error) {
			if (this.valid(generation)) this.fail(error)
		} finally {
			this.worker = undefined
			if (!this.stopped && (this.turns || this.barrier)) this.start()
			this.finish()
		}
	}
	private confirm(generation: number): void {
		if (this.feedback) return
		this.feedback = Promise.resolve().then(async () => {
			try {
				while (this.valid(generation) && this.session?.active) {
					const session = this.session
					if (!session.admitted) {
						await delay(40)
						continue
					}
					const revision = session.revision
					// This SDK request begins after HTTP admission. A read started for
					// an older target may publish real feedback, but cannot confirm a
					// later target, even if their numeric values happen to match.
					const state = await this.io.read()
					if (!this.valid(generation)) return
					if (state.owner !== session.owner) throw new Error('Photo changed during Crop Angle feedback')
					if (revision !== session.revision || !session.admitted) continue
					if (Number.isFinite(state.value) && Math.abs(state.value - session.value) < 0.00001) {
						session.active = false
						this.io.changed(`Crop Angle: ${state.value} confirmed by Lightroom`)
						return
					}
					if (Date.now() >= session.expires)
						throw new Error('Crop Angle feedback did not confirm the change. Check Lightroom; no automatic retry.')
					await delay(80)
				}
			} catch (error) {
				if (this.valid(generation)) this.fail(error)
			} finally {
				this.feedback = undefined
				// A failed gesture's read may finish after a new explicit gesture
				// has started. Retire the old reader, then confirm the current one;
				// never let the old promise satisfy the new Reset barrier.
				if (!this.stopped && this.session?.active && this.session.admitted) this.confirm(this.generation)
				this.finish()
			}
		})
	}
}
