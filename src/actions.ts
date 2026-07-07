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
				await self.runAdjustSlider(String(event.options.slider), Number(event.options.amount || 0))
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
				await self.runResetSlider(String(event.options.slider))
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
				await self.runLightroomAction(String(event.options.action))
			},
		},
	})
}
