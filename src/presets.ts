import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import { appendControllerPresets } from './controller-companion.js'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const structure: CompanionPresetSection<ModuleSchema>[] = []
	// Presets are templates copied onto a page. Existing placed buttons retain their
	// actions; those legacy action IDs remain supported in actions.ts/main.ts.
	appendControllerPresets(self, structure, presets)
	self.setPresetDefinitions(structure, presets)
}
