import type { Choice } from './choices.js'

export type JsonObject = Record<string, unknown>

export function uniqueChoices(choices: Choice[]): Choice[] {
	const seen = new Set<string>()
	const result: Choice[] = []

	for (const choice of choices) {
		const id = String(choice.id)
		if (seen.has(id)) continue
		seen.add(id)
		result.push({ id, label: String(choice.label ?? id) })
	}

	return result.sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

export function parseSliderChoices(input: unknown): Choice[] {
	const result: Choice[] = []
	const root = asRecord(input)
	const candidates = collectCandidates(input, ['sliders', 'supportedSliders', 'items'])

	for (const item of candidates) {
		const choice = itemToChoice(item)
		if (choice) result.push(choice)
	}

	const groups = root?.groups
	if (groups && typeof groups === 'object' && !Array.isArray(groups)) {
		for (const [groupName, groupValue] of Object.entries(groups as JsonObject)) {
			const groupItems = Array.isArray(groupValue) ? groupValue : collectCandidates(groupValue, ['sliders', 'items'])
			for (const item of groupItems) {
				const choice = itemToChoice(item, groupName)
				if (choice) result.push(choice)
			}
		}
	}

	return uniqueChoices(result)
}

export function parseGroupChoices(input: unknown): Choice[] {
	const result: Choice[] = []
	const root = asRecord(input)
	const groups = root?.groups ?? input

	if (Array.isArray(groups)) {
		for (const item of groups) {
			const choice = itemToChoice(item)
			if (choice) result.push(choice)
		}
	} else if (groups && typeof groups === 'object') {
		for (const key of Object.keys(groups as JsonObject)) {
			result.push({ id: key, label: key })
		}
	}

	return uniqueChoices(result)
}

function collectCandidates(input: unknown, propertyNames: string[]): unknown[] {
	if (Array.isArray(input)) return input

	const root = asRecord(input)
	if (!root) return []

	for (const propertyName of propertyNames) {
		const value = root[propertyName]
		if (Array.isArray(value)) return value
		if (value && typeof value === 'object') return Object.entries(value as JsonObject).map(([key, val]) => ({ key, value: val }))
	}

	return Object.entries(root).map(([key, val]) => ({ key, value: val }))
}

function itemToChoice(item: unknown, groupName?: string): Choice | undefined {
	if (typeof item === 'string') return { id: item, label: groupName ? `${groupName} - ${item}` : item }

	const record = asRecord(item)
	if (!record) return undefined

	const nested = record.value
	const nestedRecord = asRecord(nested)
	const id = String(
		record.id ??
			record.key ??
			record.name ??
			record.slider ??
			record.param ??
			nestedRecord?.id ??
			nestedRecord?.name ??
			nestedRecord?.slider ??
			''
	)

	if (!id) return undefined

	const label = String(record.label ?? nestedRecord?.label ?? nestedRecord?.name ?? id)
	const group = String(record.group ?? nestedRecord?.group ?? groupName ?? '')

	return { id, label: group ? `${group} - ${label}` : label }
}

function asRecord(value: unknown): JsonObject | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}
