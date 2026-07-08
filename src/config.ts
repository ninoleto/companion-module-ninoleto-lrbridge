import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	feedbackPort: number
	feedbackTimingPreset: string

	// Hidden/internal timing values. They are normalized in main.ts and intentionally not shown in the normal UI.
	pollIntervalMs: number
	requestTimeoutMs: number
	backgroundFeedbackPollIntervalMs: number
	actionFeedbackDebounceMs: number
	feedbackReadDelayMs: number
	autoActionCooldownMs: number
	contextPollIntervalMs: number
	contextRefreshDelayMs: number
	developChangeQuietMs: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'LRBridge Host / IP',
			width: 8,
			default: '127.0.0.1',
			tooltip:
				'Use 127.0.0.1 when Companion runs on the same Windows PC as LRBridge. Use the Lightroom PC LAN IP when Companion runs elsewhere.',
		},
		{
			type: 'number',
			id: 'port',
			label: 'LRBridge Command API Port',
			width: 4,
			default: 17891,
			min: 1,
			max: 65535,
		},
		{
			type: 'number',
			id: 'feedbackPort',
			label: 'LRBridge Feedback / Web Controller Port',
			width: 4,
			default: 17892,
			min: 1,
			max: 65535,
			tooltip: 'Usually 17892. This is the LRBridge Web Controller/API feedback port.',
		},
		{
			type: 'dropdown',
			id: 'feedbackTimingPreset',
			label: 'Feedback Timing',
			width: 4,
			default: 'normal',
			choices: [
				{ id: 'fast', label: 'Fast, experimental' },
				{ id: 'normal', label: 'Normal, recommended' },
				{ id: 'safe', label: 'Safe, slower' },
			],
			tooltip: 'Normal is recommended. Fast may read old Lightroom values. Safe is slower but more reliable on heavy catalogs.',
		},
	]
}
