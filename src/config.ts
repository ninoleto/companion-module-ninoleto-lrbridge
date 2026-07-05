import type { SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	port: number
	pollIntervalMs: number
	requestTimeoutMs: number
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
			label: 'LRBridge API Port',
			width: 4,
			default: 17891,
			min: 1,
			max: 65535,
		},
		{
			type: 'number',
			id: 'pollIntervalMs',
			label: 'Status Poll Interval (ms)',
			width: 6,
			default: 2000,
			min: 0,
			max: 60000,
			tooltip: 'Set to 0 to disable status polling. This checks only LRBridge server status, not live Lightroom slider values.',
		},
		{
			type: 'number',
			id: 'requestTimeoutMs',
			label: 'HTTP Timeout (ms)',
			width: 6,
			default: 2000,
			min: 250,
			max: 30000,
		},
	]
}
