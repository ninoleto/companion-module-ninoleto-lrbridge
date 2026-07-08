import { FEEDBACK_SUPPORTED_SLIDERS, sliderLabel, sliderVariableId } from './choices.js'
import type ModuleInstance from './main.js'

export type VariablesSchema = Record<string, string>

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		connected: { name: 'LRBridge connected yes/no' },
		last_status: { name: 'Last LRBridge status message' },
		last_error: { name: 'Last LRBridge error' },
		queue_length: { name: 'LRBridge queue length' },
		supported_slider_count: { name: 'Number of supported sliders loaded' },
		feedback_enabled: { name: 'Slider feedback enabled yes/no' },
		feedback_slider_count: { name: 'Number of feedback sliders' },
		feedback_last_update: { name: 'Last slider feedback update timestamp' },
		feedback_last_error: { name: 'Last slider feedback error' },
		context_active_module: { name: 'LRBridge active Lightroom module' },
		context_selected_photo_key: { name: 'LRBridge selected photo key' },
		context_counter: { name: 'LRBridge photo/module context counter' },
		context_changed_at: { name: 'LRBridge context changed timestamp' },
		context_last_reason: { name: 'LRBridge last context change reason' },
		develop_counter: { name: 'LRBridge develop settings counter' },
		context_last_update: { name: 'Last LRBridge context poll timestamp' },
		context_last_error: { name: 'Last LRBridge context poll error' },
		auto_action_cooldown_active: { name: 'Auto Tone / Auto White Balance cooldown active yes/no' },
		auto_action_cooldown_remaining_ms: { name: 'Auto Tone / Auto White Balance cooldown remaining milliseconds' },
		auto_action_cooldown_remaining_s: { name: 'Auto Tone / Auto White Balance cooldown remaining seconds' },
		...Object.fromEntries(
			FEEDBACK_SUPPORTED_SLIDERS.map((slider) => [
				sliderVariableId(slider),
				{ name: `Lightroom slider value: ${sliderLabel(slider)}` },
			])
		),
	})
}
