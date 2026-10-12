import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig } from './config.js'

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig>[] = [
	(_context, props) => ({
		updatedConfig: null,
		// The action-definition API cannot hide a legacy action from the menu.
		// Route saved Focus Range shifts to the numeric retired-control guard so
		// they report a useful error without sending a Lightroom command.
		updatedActions: props.actions
			.filter((action) => action.actionId === 'controller_focus_range')
			.map((action) => ({
				...action,
				actionId: 'controller_numeric',
				options: {
					control: { isExpression: false, value: 'blur_focus_retired' },
					mode: { isExpression: false, value: 'set' },
					value: { isExpression: false, value: 0 },
				},
			})),
		updatedFeedbacks: [],
	}),
]
