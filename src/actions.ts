import type ModuleInstance from './main.js'

export type ActionsSchema = {
	adjust_slider: { options: { slider: string; amount: number } }
	reset_slider: { options: { slider: string } }
	lightroom_action: { options: { action: string } }
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		adjust_slider: {
			name: 'Adjust Lightroom slider',
			options: [
				{
					id: 'slider',
					type: 'dropdown',
					label: 'Slider',
					default: 'Exposure',
					choices: self.getSliderChoices(),
				},
				{
					id: 'amount',
					type: 'number',
					label: 'Amount / Lightroom steps',
					default: 1,
					min: -100,
					max: 100,
				},
			],
			callback: async (event) => {
				await self.callLRBridge(
					`/adjust?slider=${encodeURIComponent(String(event.options.slider))}&amount=${encodeURIComponent(String(event.options.amount))}`
				)
			},
		},
		reset_slider: {
			name: 'Reset Lightroom slider',
			options: [
				{
					id: 'slider',
					type: 'dropdown',
					label: 'Slider',
					default: 'Exposure',
					choices: self.getSliderChoices(),
				},
			],
			callback: async (event) => {
				await self.callLRBridge(`/reset?slider=${encodeURIComponent(String(event.options.slider))}`)
			},
		},
		lightroom_action: {
			name: 'Run LRBridge action',
			options: [
				{
					id: 'action',
					type: 'dropdown',
					label: 'Action',
					default: 'setAutoTone',
					choices: self.getLightroomActionChoices(),
				},
			],
			callback: async (event) => {
				await self.callLRBridge(`/action?action=${encodeURIComponent(String(event.options.action))}`)
			},
		},
	})
}
