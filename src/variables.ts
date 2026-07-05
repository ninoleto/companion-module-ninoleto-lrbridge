import type ModuleInstance from './main.js'

export type VariablesSchema = {
	connected: string
	last_status: string
	last_error: string
	queue_length: string
	supported_slider_count: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		connected: { name: 'LRBridge connected yes/no' },
		last_status: { name: 'Last LRBridge status message' },
		last_error: { name: 'Last LRBridge error' },
		queue_length: { name: 'LRBridge queue length' },
		supported_slider_count: { name: 'Number of supported sliders loaded' },
	})
}
