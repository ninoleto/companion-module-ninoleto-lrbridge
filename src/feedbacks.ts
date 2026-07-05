import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	bridge_online: {
		type: 'boolean'
		options: Record<string, never>
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		bridge_online: {
			name: 'LRBridge server is online',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x00aa00,
				color: 0xffffff,
			},
			options: [],
			callback: () => self.bridgeOnline,
		},
	})
}
