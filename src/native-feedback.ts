// Display-only coordination. Commands and Lightroom's polling cadence are unchanged.
export type NativeContext = Record<string, any>
export type NativeCompletion = {
	slider: string
	value: number
	context: NativeContext
	serverEpoch: string
	completedAt?: number
}
export type FeedbackMarker = { id?: string; requestedAt?: number }

function contextKey(s: NativeContext): string {
	return JSON.stringify([
		s.activeModule ?? '',
		s.selectedPhotoUuid ?? s.selectedPhotoKey ?? '',
		s.contextCounter ?? '',
		s.contextChangedAt ?? '',
	])
}

export class NativeFeedback {
	readonly values: Record<string, number | undefined> = {}
	version = 0
	contextRevision = 0
	private context?: NativeContext
	private epoch?: string
	private floors = new Map<string, number>()
	private ids = new Map<string, number>()

	reset(): void {
		this.version++
		this.contextRevision++
		for (const key of Object.keys(this.values)) delete this.values[key]
		this.context = undefined
		this.epoch = undefined
		this.floors.clear()
		this.ids.clear()
	}
	observe(context: NativeContext, ticket = this.version): boolean {
		if (ticket !== this.version) return false
		if (!this.context || contextKey(context) !== contextKey(this.context)) {
			this.version++
			this.contextRevision++
			for (const key of Object.keys(this.values)) delete this.values[key]
			this.floors.clear()
			this.ids.clear()
		}
		this.context = { ...context }
		return true
	}
	complete(completion: NativeCompletion): boolean {
		if (!Number.isFinite(completion.value) || completion.context.activeModule !== 'develop') return false
		if (this.epoch && this.epoch !== completion.serverEpoch) this.reset()
		// A late completion cannot take the display back to an earlier photo.
		if (this.context && Number(this.context.contextCounter) > Number(completion.context.contextCounter)) return false
		this.epoch = completion.serverEpoch
		this.observe(completion.context)
		this.version++ // Invalidate reads started before this exact SDK completion.
		this.ids.delete(completion.slider) // A queued post-completion read may reuse a lower ID.
		this.values[completion.slider] = completion.value
		if (Number.isFinite(completion.completedAt)) this.floors.set(completion.slider, completion.completedAt!)
		return true
	}
	accept(
		slider: string,
		result: any,
		marker: FeedbackMarker,
		ticket: number,
		context: NativeContext,
		snapshotContext: NativeContext,
	): boolean {
		if (contextKey(context) !== contextKey(snapshotContext)) return false
		if (ticket !== this.version || !this.context || contextKey(context) !== contextKey(this.context)) return false
		if (context.activeModule !== 'develop' || !(context.selectedPhotoUuid || context.selectedPhotoKey)) return false
		// Only an exact owned snapshot is admissible. Request IDs can be reused
		// for queued reads; a higher ID in /feedback/all may still be an older read.
		const id = Number(result?.id),
			expected = Number(marker.id)
		if (!marker.id || !Number.isFinite(id) || !Number.isFinite(expected) || id !== expected) return false
		if (id < (this.ids.get(slider) ?? -Infinity)) return false
		if (Number(result.receivedAt) < (this.floors.get(slider) ?? -Infinity)) return false
		if (result.available !== false && (typeof result.value !== 'number' || !Number.isFinite(result.value))) return false
		this.ids.set(slider, id)
		this.values[slider] = result.available === false ? undefined : result.value
		return true
	}
}
