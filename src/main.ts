import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'

import { GetConfigFields, type ModuleConfig } from './config.js'
import {
	AUTO_ACTION_COOLDOWN_ACTIONS,
	AUTO_ACTION_COOLDOWN_MS,
	FALLBACK_GROUPS,
	FALLBACK_SLIDERS,
	FEEDBACK_SUPPORTED_SLIDERS,
	LIGHTROOM_ACTIONS,
	sliderLabel,
	sliderVariableId,
	type Choice,
} from './choices.js'
import { parseGroupChoices, parseSliderChoices, uniqueChoices } from './http.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	bridgeOnline = false

	private pollTimer: NodeJS.Timeout | undefined
	private backgroundFeedbackTimer: NodeJS.Timeout | undefined
	private cooldownTimer: NodeJS.Timeout | undefined
	private backgroundFeedbackSnapshotInFlight = false
	private actionFeedbackTimers = new Map<string, NodeJS.Timeout>()
	private actionFeedbackSerials = new Map<string, number>()
	private autoActionCooldownUntil = 0
	private sliderChoices: Choice[] = FALLBACK_SLIDERS
	private groupChoices: Choice[] = FALLBACK_GROUPS
	private sliderValues: Record<string, unknown> = {}

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = normalizeConfig(config)
		this.updateStatus(InstanceStatus.Connecting, 'Checking LRBridge')

		this.updateVariableDefinitions()
		this.setVariableValues(this.getInitialVariableValues())

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()

		await this.refreshMetadata(false)
		await this.checkStatus(false)
		this.startPolling()
		this.startBackgroundFeedbackPolling()
	}

	async destroy(): Promise<void> {
		this.stopPolling()
		this.stopBackgroundFeedbackPolling()
		this.stopActionFeedbackTimers()
		this.stopCooldownTimer()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = normalizeConfig(config)
		this.stopPolling()
		this.stopBackgroundFeedbackPolling()
		this.stopActionFeedbackTimers()
		await this.refreshMetadata(false)
		await this.checkStatus(false)
		this.startPolling()
		this.startBackgroundFeedbackPolling()
		this.updateCooldownVariables()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	getSliderChoices(): Choice[] {
		return this.sliderChoices.length > 0 ? this.sliderChoices : FALLBACK_SLIDERS
	}

	getFeedbackSliderChoices(): Choice[] {
		const choicesById = new Map(this.getSliderChoices().map((choice) => [choice.id, choice]))
		return FEEDBACK_SUPPORTED_SLIDERS.map((slider) => choicesById.get(slider) || { id: slider, label: sliderLabel(slider) })
	}

	getGroupChoices(): Choice[] {
		return this.groupChoices.length > 0 ? this.groupChoices : FALLBACK_GROUPS
	}

	getLightroomActionChoices(): Choice[] {
		return LIGHTROOM_ACTIONS
	}

	getSliderNumericValue(slider: string): number | undefined {
		const value = this.sliderValues[slider]
		if (typeof value === 'number' && Number.isFinite(value)) return value
		if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
		return undefined
	}

	isAutoActionCooldownActive(): boolean {
		return Date.now() < this.autoActionCooldownUntil
	}

	async runAdjustSlider(slider: string, amount: number): Promise<void> {
		this.noteSliderCommandSent()
		await this.callLRBridge(`/adjust?slider=${encodeURIComponent(slider)}&amount=${encodeURIComponent(String(amount))}`)
		this.queueActionFeedbackForSliders([slider])
	}

	async runResetSlider(slider: string): Promise<void> {
		this.noteSliderCommandSent()
		await this.callLRBridge(`/reset?slider=${encodeURIComponent(slider)}`)
		this.queueActionFeedbackForSliders([slider])
	}

	async runLightroomAction(action: string): Promise<void> {
		if (this.shouldBlockAutoAction(action)) {
			const remainingSeconds = Math.ceil(this.getAutoActionCooldownRemainingMs() / 1000)
			const message = `Auto Tone / Auto White Balance cooldown active, wait ${remainingSeconds}s`
			this.setVariableValues({ last_status: message })
			this.log('info', message)
			return
		}

		await this.callLRBridge(`/action?action=${encodeURIComponent(action)}`)
		this.setVariableValues({ last_status: `Action sent: ${action}`, last_error: '' })
	}

	async refreshMetadata(logErrors = true): Promise<void> {
		try {
			const [sliders, groups] = await Promise.allSettled([this.callLRBridge('/sliders'), this.callLRBridge('/groups')])

			if (sliders.status === 'fulfilled') {
				const parsedSliders = parseSliderChoices(sliders.value)
				if (parsedSliders.length > 0) this.sliderChoices = uniqueChoices(parsedSliders)
			}

			if (groups.status === 'fulfilled') {
				const parsedGroups = parseGroupChoices(groups.value)
				if (parsedGroups.length > 0) this.groupChoices = uniqueChoices(parsedGroups)
			}

			this.setVariableValues({ supported_slider_count: String(this.sliderChoices.length) })
			this.updateActions()
			this.updateFeedbacks()
			this.updatePresets()
		} catch (error) {
			if (logErrors) this.log('warn', `Failed to refresh LRBridge metadata: ${errorToMessage(error)}`)
		}
	}

	async checkStatus(logErrors = true): Promise<void> {
		try {
			const data = await this.callLRBridge('/status')
			this.bridgeOnline = true
			this.updateStatus(InstanceStatus.Ok, 'Connected')
			this.setVariableValues({
				connected: 'yes',
				last_status: 'Connected',
				last_error: '',
				queue_length: String(extractQueueLength(data) ?? ''),
				supported_slider_count: String(this.sliderChoices.length),
				feedback_enabled: 'yes',
			})
		} catch (error) {
			const message = errorToMessage(error)
			this.bridgeOnline = false
			this.updateStatus(InstanceStatus.ConnectionFailure, message)
			this.setVariableValues({
				connected: 'no',
				last_status: 'Connection failure',
				last_error: message,
			})
			if (logErrors) this.log('warn', `LRBridge status check failed: ${message}`)
		} finally {
			this.checkFeedbacks('bridge_online')
		}
	}

	async callLRBridge(path: string): Promise<unknown> {
		return this.callHttp(this.buildUrl(path))
	}

	async callLRBridgeFeedback(path: string): Promise<unknown> {
		return this.callHttp(this.buildFeedbackUrl(path))
	}

	private async callHttp(url: string): Promise<unknown> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs)

		try {
			const response = await fetch(url, { method: 'GET', signal: controller.signal })
			const text = await response.text()

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
			}

			if (!text) return { ok: true }

			try {
				return JSON.parse(text) as unknown
			} catch {
				return { ok: true, text }
			}
		} finally {
			clearTimeout(timeout)
		}
	}

	private getInitialVariableValues(): Record<string, string> {
		return {
			connected: 'no',
			last_status: 'Not checked yet',
			last_error: '',
			queue_length: '',
			supported_slider_count: String(this.sliderChoices.length),
			feedback_enabled: 'yes',
			feedback_slider_count: String(FEEDBACK_SUPPORTED_SLIDERS.length),
			feedback_last_update: '',
			feedback_last_error: '',
			auto_action_cooldown_active: 'no',
			auto_action_cooldown_remaining_ms: '0',
			auto_action_cooldown_remaining_s: '0',
			...Object.fromEntries(FEEDBACK_SUPPORTED_SLIDERS.map((slider) => [sliderVariableId(slider), ''])),
		}
	}

	private buildUrl(path: string): string {
		const host = this.cleanHost(this.config.host || '127.0.0.1')
		const cleanPath = path.startsWith('/') ? path : `/${path}`
		return `http://${host}:${this.config.port}${cleanPath}`
	}

	private buildFeedbackUrl(path: string): string {
		const host = this.cleanHost(this.config.host || '127.0.0.1')
		const cleanPath = path.startsWith('/') ? path : `/${path}`
		return `http://${host}:${this.config.feedbackPort}/api${cleanPath}`
	}

	private cleanHost(host: string): string {
		return String(host || '127.0.0.1')
			.trim()
			.replace(/^https?:\/\//i, '')
			.replace(/\/+$/, '')
	}

	private startPolling(): void {
		const pollIntervalMs = Number(this.config.pollIntervalMs || 0)
		if (pollIntervalMs <= 0) return

		this.pollTimer = setInterval(() => {
			void this.checkStatus(false)
		}, pollIntervalMs)
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = undefined
		}
	}

	private startBackgroundFeedbackPolling(): void {
		const intervalMs = Number(this.config.backgroundFeedbackPollIntervalMs || 0)
		this.setVariableValues({
			feedback_enabled: 'yes',
			feedback_slider_count: String(FEEDBACK_SUPPORTED_SLIDERS.length),
		})

		if (intervalMs <= 0) return

		void this.requestBackgroundFeedbackSnapshot()
		this.backgroundFeedbackTimer = setInterval(() => {
			void this.requestBackgroundFeedbackSnapshot()
		}, intervalMs)
	}

	private stopBackgroundFeedbackPolling(): void {
		if (this.backgroundFeedbackTimer) {
			clearInterval(this.backgroundFeedbackTimer)
			this.backgroundFeedbackTimer = undefined
		}
		this.backgroundFeedbackSnapshotInFlight = false
	}

	private async requestBackgroundFeedbackSnapshot(): Promise<void> {
		if (this.backgroundFeedbackSnapshotInFlight) return

		this.backgroundFeedbackSnapshotInFlight = true
		try {
			await this.requestFeedbackForSliders(FEEDBACK_SUPPORTED_SLIDERS)
		} finally {
			this.backgroundFeedbackSnapshotInFlight = false
		}
	}

	private queueActionFeedbackForSliders(sliders: string[]): void {
		const wanted = uniqueStrings(
			sliders
				.map((slider) => resolveFeedbackSliderName(slider))
				.filter((slider): slider is string => Boolean(slider))
		)

		for (const slider of wanted) {
			const existingTimer = this.actionFeedbackTimers.get(slider)
			if (existingTimer) clearTimeout(existingTimer)

			const serial = (this.actionFeedbackSerials.get(slider) || 0) + 1
			this.actionFeedbackSerials.set(slider, serial)

			const timer = setTimeout(() => {
				this.actionFeedbackTimers.delete(slider)
				void this.requestActionFeedbackForSlider(slider, serial)
			}, Number(this.config.actionFeedbackDebounceMs || 0))

			this.actionFeedbackTimers.set(slider, timer)
		}
	}

	private stopActionFeedbackTimers(): void {
		for (const timer of this.actionFeedbackTimers.values()) clearTimeout(timer)
		this.actionFeedbackTimers.clear()
		this.actionFeedbackSerials.clear()
	}

	private async requestActionFeedbackForSlider(slider: string, serial: number): Promise<void> {
		try {
			if (this.actionFeedbackSerials.get(slider) !== serial) return

			this.setVariableValues({ feedback_last_error: '', last_status: `Feedback request: ${slider}` })
			const requestData = await this.callLRBridgeFeedback(`/feedback/request?slider=${encodeURIComponent(slider)}`)
			const marker = extractFeedbackRequestMarker(requestData)

			const result = await this.pollFreshFeedbackValue(slider, marker, serial, 3000)
			if (!result || this.actionFeedbackSerials.get(slider) !== serial) return

			this.updateSliderFeedbackValue(slider, result)
		} catch (error) {
			const message = errorToMessage(error)
			this.setVariableValues({ feedback_last_error: message })
			this.log('warn', `LRBridge action feedback request failed for ${slider}: ${message}`)
		}
	}

	private async pollFreshFeedbackValue(
		slider: string,
		marker: FeedbackRequestMarker,
		serial: number,
		timeoutMs: number
	): Promise<unknown | undefined> {
		const startedAt = Date.now()

		while (Date.now() - startedAt < timeoutMs) {
			if (this.actionFeedbackSerials.get(slider) !== serial) return undefined

			const data = await this.callLRBridgeFeedback(`/feedback/value?slider=${encodeURIComponent(slider)}`)
			const result = extractFeedbackSingleResult(data)
			const value = extractFeedbackResultValue(result)

			if (value !== undefined && value !== null && value !== 'nil' && isFreshFeedbackResult(result, marker)) {
				return result
			}

			await sleep(120)
		}

		this.setVariableValues({ feedback_last_error: `Feedback timeout for ${slider}` })
		return undefined
	}

	private async requestFeedbackForSliders(sliders: string[]): Promise<void> {
		const requestedSliders = uniqueStrings(
			sliders
				.map((slider) => resolveFeedbackSliderName(slider))
				.filter((slider): slider is string => Boolean(slider))
		)

		if (requestedSliders.length === 0) return

		try {
			for (const chunk of chunkArray(requestedSliders, 35)) {
				await this.callLRBridgeFeedback(`/feedback/request-many?sliders=${encodeURIComponent(chunk.join(','))}`)
			}

			await sleep(Number(this.config.feedbackReadDelayMs || 0))
			await this.updateFeedbackValuesFromCache(requestedSliders)
		} catch (error) {
			const message = errorToMessage(error)
			this.setVariableValues({ feedback_last_error: message })
			this.log('debug', `LRBridge background feedback request failed: ${message}`)
		}
	}

	private async updateFeedbackValuesFromCache(requestedSliders: string[]): Promise<void> {
		const data = await this.callLRBridgeFeedback('/feedback/all')
		const values = extractFeedbackValues(data)
		if (!values) return

		const variableUpdates: Record<string, string> = {}
		let updatedCount = 0

		for (const slider of requestedSliders) {
			const result = values[slider]
			const value = extractFeedbackResultValue(result)
			if (value === undefined || value === null || value === 'nil') continue

			this.sliderValues[slider] = value
			variableUpdates[sliderVariableId(slider)] = formatSliderFeedbackValue(value)
			updatedCount++
		}

		if (updatedCount > 0) {
			variableUpdates.feedback_last_update = new Date().toISOString()
			variableUpdates.feedback_last_error = ''
			this.setVariableValues(variableUpdates)
			this.checkFeedbacks('slider_value_not_zero', 'slider_value_equals_zero', 'slider_value_compare')
		}
	}


	private updateSliderFeedbackValue(slider: string, result: unknown): void {
		const value = extractFeedbackResultValue(result)
		if (value === undefined || value === null || value === 'nil') return

		this.sliderValues[slider] = value
		this.setVariableValues({
			[sliderVariableId(slider)]: formatSliderFeedbackValue(value),
			feedback_last_update: new Date().toISOString(),
			feedback_last_error: '',
		})
		this.checkFeedbacks('slider_value_not_zero', 'slider_value_equals_zero', 'slider_value_compare')
	}

	private noteSliderCommandSent(): void {
		const cooldownMs = Number(this.config.autoActionCooldownMs ?? AUTO_ACTION_COOLDOWN_MS)
		if (cooldownMs <= 0) return

		this.autoActionCooldownUntil = Date.now() + cooldownMs
		this.updateCooldownVariables()
		this.startCooldownTimer()
	}

	private shouldBlockAutoAction(action: string): boolean {
		return AUTO_ACTION_COOLDOWN_ACTIONS.includes(action) && this.isAutoActionCooldownActive()
	}

	private getAutoActionCooldownRemainingMs(): number {
		return Math.max(0, this.autoActionCooldownUntil - Date.now())
	}

	private updateCooldownVariables(): void {
		const remainingMs = this.getAutoActionCooldownRemainingMs()
		this.setVariableValues({
			auto_action_cooldown_active: remainingMs > 0 ? 'yes' : 'no',
			auto_action_cooldown_remaining_ms: String(Math.ceil(remainingMs)),
			auto_action_cooldown_remaining_s: String(Math.ceil(remainingMs / 1000)),
		})
		this.checkFeedbacks('auto_action_cooldown_active')
	}

	private startCooldownTimer(): void {
		if (this.cooldownTimer) return

		this.cooldownTimer = setInterval(() => {
			this.updateCooldownVariables()
			if (!this.isAutoActionCooldownActive()) {
				this.stopCooldownTimer()
				this.updateCooldownVariables()
			}
		}, 250)
	}

	private stopCooldownTimer(): void {
		if (this.cooldownTimer) {
			clearInterval(this.cooldownTimer)
			this.cooldownTimer = undefined
		}
	}
}

function normalizeConfig(config: ModuleConfig): ModuleConfig {
	return {
		host: config.host || '127.0.0.1',
		port: Number(config.port || 17891),
		feedbackPort: Number(config.feedbackPort || 17892),
		pollIntervalMs: Number(config.pollIntervalMs ?? 1000),
		requestTimeoutMs: Number(config.requestTimeoutMs ?? 3000),
		backgroundFeedbackPollIntervalMs: Number(config.backgroundFeedbackPollIntervalMs ?? 0),
		actionFeedbackDebounceMs: Number(config.actionFeedbackDebounceMs ?? 500),
		feedbackReadDelayMs: Number(config.feedbackReadDelayMs ?? 80),
		autoActionCooldownMs: Number(config.autoActionCooldownMs ?? AUTO_ACTION_COOLDOWN_MS),
	}
}

function resolveFeedbackSliderName(slider: string): string | undefined {
	const cleaned = String(slider || '').trim()
	if (!cleaned) return undefined

	const direct = FEEDBACK_SUPPORTED_SLIDERS.find((item) => item === cleaned)
	if (direct) return direct

	const lower = cleaned.toLowerCase()
	return FEEDBACK_SUPPORTED_SLIDERS.find((item) => item.toLowerCase() === lower)
}

function errorToMessage(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === 'AbortError') return 'Request timed out'
		return error.message
	}
	return String(error)
}

function extractQueueLength(data: unknown): number | undefined {
	if (!data || typeof data !== 'object') return undefined
	const record = data as Record<string, unknown>
	const candidates = [record.queueLength, record.queue_length, record.queueSize, record.pending]

	const queue = record.queue
	if (queue && typeof queue === 'object') {
		const queueRecord = queue as Record<string, unknown>
		candidates.push(queueRecord.length, queueRecord.size, queueRecord.pending)
	}

	for (const candidate of candidates) {
		if (typeof candidate === 'number') return candidate
		if (typeof candidate === 'string' && candidate.trim() !== '' && !Number.isNaN(Number(candidate))) return Number(candidate)
	}

	return undefined
}

function extractFeedbackValues(data: unknown): Record<string, unknown> | undefined {
	if (!data || typeof data !== 'object') return undefined
	const record = data as Record<string, unknown>
	const values = record.values
	if (!values || typeof values !== 'object') return undefined
	return values as Record<string, unknown>
}


type FeedbackRequestMarker = { id?: string; requestedAt?: number }

function extractFeedbackRequestMarker(data: unknown): FeedbackRequestMarker {
	if (!data || typeof data !== 'object') return {}
	const record = data as Record<string, unknown>
	const request = record.request
	if (!request || typeof request !== 'object') return {}
	const requestRecord = request as Record<string, unknown>
	return {
		id: normalizeId(requestRecord.id),
		requestedAt: normalizeNumber(requestRecord.requestedAt),
	}
}

function extractFeedbackSingleResult(data: unknown): unknown | undefined {
	if (!data || typeof data !== 'object') return undefined
	const record = data as Record<string, unknown>
	return record.result
}

function isFreshFeedbackResult(result: unknown, marker: FeedbackRequestMarker): boolean {
	if (!result || typeof result !== 'object') return false
	const record = result as Record<string, unknown>
	const resultId = normalizeId(record.id)
	if (marker.id && resultId === marker.id) return true

	const receivedAt = normalizeNumber(record.receivedAt)
	if (marker.requestedAt !== undefined && receivedAt !== undefined && receivedAt >= marker.requestedAt) return true

	return !marker.id && marker.requestedAt === undefined
}

function normalizeId(value: unknown): string | undefined {
	return value !== undefined && value !== null && String(value).trim() !== '' ? String(value) : undefined
}

function normalizeNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
	return undefined
}

function extractFeedbackResultValue(result: unknown): unknown {
	if (!result || typeof result !== 'object') return undefined
	const record = result as Record<string, unknown>
	return record.value
}

function formatSliderFeedbackValue(value: unknown): string {
	const numericValue = Number(value)

	if (Number.isFinite(numericValue)) {
		return String(Math.round(numericValue * 100) / 100)
	}

	if (value === null || value === undefined || value === 'nil') {
		return ''
	}

	return String(value)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
	return chunks
}

function uniqueStrings(items: string[]): string[] {
	return Array.from(new Set(items.filter(Boolean)))
}
