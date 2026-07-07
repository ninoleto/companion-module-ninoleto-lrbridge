import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	bridge_online: {
		type: 'boolean'
		options: Record<string, never>
	}
	slider_value_not_zero: {
		type: 'boolean'
		options: { slider: string }
	}
	slider_value_equals_zero: {
		type: 'boolean'
		options: { slider: string }
	}
	slider_value_compare: {
		type: 'boolean'
		options: { slider: string; operator: string; value: number }
	}
	auto_action_cooldown_active: {
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
		slider_value_not_zero: {
			name: 'LRBridge slider value is not zero',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xff9900,
				color: 0x000000,
			},
			options: [
				{
					id: 'slider',
					type: 'dropdown',
					label: 'Slider',
					default: 'Exposure',
					choices: self.getFeedbackSliderChoices(),
				},
			],
			callback: (feedback) => {
				const value = self.getSliderNumericValue(String(feedback.options.slider))
				return value !== undefined && Math.abs(value) > 0.0001
			},
		},
		slider_value_equals_zero: {
			name: 'LRBridge slider value equals zero',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x333333,
				color: 0xffffff,
			},
			options: [
				{
					id: 'slider',
					type: 'dropdown',
					label: 'Slider',
					default: 'Exposure',
					choices: self.getFeedbackSliderChoices(),
				},
			],
			callback: (feedback) => {
				const value = self.getSliderNumericValue(String(feedback.options.slider))
				return value !== undefined && Math.abs(value) <= 0.0001
			},
		},
		slider_value_compare: {
			name: 'LRBridge slider value comparison',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0x2a6f97,
				color: 0xffffff,
			},
			options: [
				{
					id: 'slider',
					type: 'dropdown',
					label: 'Slider',
					default: 'Exposure',
					choices: self.getFeedbackSliderChoices(),
				},
				{
					id: 'operator',
					type: 'dropdown',
					label: 'Condition',
					default: 'gt',
					choices: [
						{ id: 'gt', label: 'Greater than' },
						{ id: 'gte', label: 'Greater than or equal' },
						{ id: 'lt', label: 'Less than' },
						{ id: 'lte', label: 'Less than or equal' },
						{ id: 'eq', label: 'Equal' },
						{ id: 'neq', label: 'Not equal' },
					],
				},
				{
					id: 'value',
					type: 'number',
					label: 'Value',
					default: 0,
					min: -100000,
					max: 100000,
				},
			],
			callback: (feedback) => {
				const current = self.getSliderNumericValue(String(feedback.options.slider))
				if (current === undefined) return false

				const target = Number(feedback.options.value || 0)
				switch (String(feedback.options.operator)) {
					case 'gt':
						return current > target
					case 'gte':
						return current >= target
					case 'lt':
						return current < target
					case 'lte':
						return current <= target
					case 'eq':
						return Math.abs(current - target) <= 0.0001
					case 'neq':
						return Math.abs(current - target) > 0.0001
					default:
						return false
				}
			},
		},
		auto_action_cooldown_active: {
			name: 'Auto Tone / Auto White Balance cooldown is active',
			type: 'boolean',
			defaultStyle: {
				bgcolor: 0xaa0000,
				color: 0xffffff,
			},
			options: [],
			callback: () => self.isAutoActionCooldownActive(),
		},
	})
}
