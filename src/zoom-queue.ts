import { setTimeout as delay } from 'node:timers/promises'

export type ZoomDirection = 'zoom_in' | 'zoom_out'
export const ZOOM_INTENT_TTL_MS = 1000
export const ZOOM_QUEUE_POLL_MS = 80

export interface ZoomQueueIO {
	request(path: string): Promise<Record<string, any>>
	now?(): number
	sleep?(ms: number, signal?: AbortSignal): Promise<void>
	admitted?(direction: ZoomDirection): void
	failed?(error: unknown): void
}

type ZoomIntent = { direction: ZoomDirection; expiresAt: number }

/**
 * Zoom has no value or completion feedback in the beta.4 protocol. Keep only
 * the latest unsent direction and admit it when the bridge queue is empty.
 * An empty queue means dequeued, not SDK completion: this bounds our traffic
 * to one executing command and one queued command, without inventing a level.
 */
export class ZoomQueue {
	private pending?: ZoomIntent
	private worker?: Promise<void>
	private waitAbort?: AbortController
	private generation = 0
	private stopped = false

	constructor(private readonly io: ZoomQueueIO) {}

	/** Return immediately so an awaited Companion callback cannot hide reversal. */
	turn(direction: ZoomDirection): void {
		if (this.stopped) throw new Error('Connection stopped')
		if (direction !== 'zoom_in' && direction !== 'zoom_out') throw new Error('Unknown zoom direction')
		this.pending = { direction, expiresAt: this.now() + ZOOM_INTENT_TTL_MS }
		if (!this.worker) this.worker = Promise.resolve().then(() => this.run())
	}

	/** Discard only unsent input; an admitted SDK command cannot be recalled. */
	clear(): void {
		this.pending = undefined
		this.generation++
		this.waitAbort?.abort()
	}

	stop(): void {
		this.stopped = true
		this.clear()
	}

	/** Diagnostics/tests can await drainage; action callbacks must not await it. */
	idle(): Promise<void> {
		return this.worker ?? Promise.resolve()
	}

	private now(): number {
		return this.io.now?.() ?? Date.now()
	}

	private current(): ZoomIntent | undefined {
		if (this.pending && this.now() >= this.pending.expiresAt) this.pending = undefined
		return this.stopped ? undefined : this.pending
	}

	private async pause(): Promise<void> {
		const abort = new AbortController()
		this.waitAbort = abort
		try {
			if (this.io.sleep) await this.io.sleep(ZOOM_QUEUE_POLL_MS, abort.signal)
			else await delay(ZOOM_QUEUE_POLL_MS, undefined, { signal: abort.signal })
		} catch (error) {
			if (!abort.signal.aborted) throw error
		} finally {
			if (this.waitAbort === abort) this.waitAbort = undefined
		}
	}

	private async run(): Promise<void> {
		try {
			while (this.current()) {
				const generation = this.generation
				let diagnostics: Record<string, any>
				try {
					diagnostics = await this.io.request('/diagnostics/queue')
				} catch (error) {
					// A cancelled gesture's failed read cannot discard newer input.
					if (generation !== this.generation || this.stopped) continue
					throw error
				}
				if (!this.current()) return
				// Clear/Fit/100% or a connection change invalidates this read.
				if (generation !== this.generation) continue
				const length = diagnostics?.queue?.length
				const applications = diagnostics?.queue?.pending?.byCommand?.['application.action']
				if (
					diagnostics?.ok !== true ||
					!Number.isSafeInteger(length) ||
					length < 0 ||
					!Number.isSafeInteger(applications) ||
					applications < 0 ||
					applications > length
				)
					throw new Error('Zoom queue state is unavailable; unsent knob turns were discarded')
				if (length !== 0 || applications !== 0) {
					await this.pause()
					continue
				}
				// Read the latest direction after the HTTP read. Reversal replaces
				// earlier turns; it never has to repay their accumulated step count.
				const intent = this.current()
				if (!intent) return
				this.pending = undefined
				const result = await this.io.request(`/command?command=application.action&action=${intent.direction}`)
				if (!result || result.ok !== true) throw new Error(result?.error || 'LRBridge rejected the zoom request')
				if (!this.stopped && generation === this.generation) this.io.admitted?.(intent.direction)
			}
		} catch (error) {
			// A failed HTTP mutation may already have reached LRBridge. Never
			// replay it, nor send input accumulated while its result was unknown.
			this.pending = undefined
			if (!this.stopped) {
				try {
					this.io.failed?.(error)
				} catch {
					// A reporting callback must not leave an unhandled worker rejection.
				}
			}
		} finally {
			this.worker = undefined
		}
	}
}
