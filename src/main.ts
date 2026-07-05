import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'

import { GetConfigFields, type ModuleConfig } from './config.js'
import { FALLBACK_GROUPS, FALLBACK_SLIDERS, LIGHTROOM_ACTIONS, type Choice } from './choices.js'
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
	private sliderChoices: Choice[] = FALLBACK_SLIDERS
	private groupChoices: Choice[] = FALLBACK_GROUPS

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = normalizeConfig(config)
		this.updateStatus(InstanceStatus.Connecting, 'Checking LRBridge')

		this.updateVariableDefinitions()
		this.setVariableValues({
			connected: 'no',
			last_status: 'Not checked yet',
			last_error: '',
			queue_length: '',
			supported_slider_count: String(this.sliderChoices.length),
		})

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()

		await this.refreshMetadata(false)
		await this.checkStatus(false)
		this.startPolling()
	}

	async destroy(): Promise<void> {
		this.stopPolling()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = normalizeConfig(config)
		this.stopPolling()
		await this.refreshMetadata(false)
		await this.checkStatus(false)
		this.startPolling()
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

	getGroupChoices(): Choice[] {
		return this.groupChoices.length > 0 ? this.groupChoices : FALLBACK_GROUPS
	}

	getLightroomActionChoices(): Choice[] {
		return LIGHTROOM_ACTIONS
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
		const url = this.buildUrl(path)
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

	private buildUrl(path: string): string {
		const host = String(this.config.host || '127.0.0.1')
			.trim()
			.replace(/^https?:\/\//i, '')
			.replace(/\/+$/, '')
		const cleanPath = path.startsWith('/') ? path : `/${path}`
		return `http://${host}:${this.config.port}${cleanPath}`
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
}

function normalizeConfig(config: ModuleConfig): ModuleConfig {
	return {
		host: config.host || '127.0.0.1',
		port: Number(config.port || 17891),
		pollIntervalMs: Number(config.pollIntervalMs ?? 2000),
		requestTimeoutMs: Number(config.requestTimeoutMs ?? 2000),
	}
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
