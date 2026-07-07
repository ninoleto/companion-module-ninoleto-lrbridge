import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	feedbackPort: number
	pollIntervalMs: number
	requestTimeoutMs: number
	backgroundFeedbackPollIntervalMs: number
	actionFeedbackDebounceMs: number
	feedbackReadDelayMs: number
	autoActionCooldownMs: number
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'LRBridge Host / IP',
			width: 8,
			default: '127.0.0.1',
			tooltip: 'Use 127.0.0.1 when Companion runs on the same Windows PC as LRBridge. Use the Lightroom PC LAN IP when Companion runs elsewhere.',
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
			tooltip: 'Feedback uses the Web Controller API path on this port, normally 17892. Commands still use the command API port, normally 17891.',
		},
		{
			type: 'number',
			id: 'pollIntervalMs',
			label: 'Status Poll Interval (ms)',
			width: 6,
			default: 1000,
			min: 0,
			max: 60000,
			tooltip: 'Checks only LRBridge server status. Set to 0 to disable.',
		},
		{
			type: 'number',
			id: 'requestTimeoutMs',
			label: 'HTTP Timeout (ms)',
			width: 6,
			default: 3000,
			min: 250,
			max: 30000,
		},
		{
			type: 'number',
			id: 'backgroundFeedbackPollIntervalMs',
			label: 'Background All Slider Feedback Poll Interval (ms, 0 disabled)',
			width: 6,
			default: 0,
			min: 0,
			max: 60000,
			tooltip: 'Optional slow mode. Polls all Web Controller feedback-supported sliders in the background. Leave at 0 for fast action-triggered feedback only.',
		},
		{
			type: 'number',
			id: 'actionFeedbackDebounceMs',
			label: 'Action Feedback Debounce After Slider Move (ms)',
			width: 6,
			default: 500,
			min: 0,
			max: 5000,
			tooltip: 'After moving/resetting a slider, wait this long after the last command, then request feedback only for that touched slider. 500 ms is a reliable default for Lightroom Classic.',
		},
		{
			type: 'number',
			id: 'feedbackReadDelayMs',
			label: 'Feedback Read Delay After Request (ms)',
			width: 6,
			default: 80,
			min: 0,
			max: 5000,
			tooltip: 'Small delay between asking LRBridge to read Lightroom feedback and reading LRBridge cached feedback values.',
		},
		{
			type: 'number',
			id: 'autoActionCooldownMs',
			label: 'Auto Tone / Auto WB Cooldown After Slider Command (ms)',
			width: 6,
			default: 2200,
			min: 0,
			max: 30000,
			tooltip: 'Blocks Auto Tone and Auto White Balance briefly after slider changes so Lightroom can finish applying slider commands. Set to 0 to disable.',
		},
	]
}
