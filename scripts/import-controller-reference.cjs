// Extract declarative metadata from the exact LRBridge package under test.
// Does not execute the server or change LRBridge.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const root = path.resolve(process.argv[2])
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const commands = read('server/commands.js')
const enums = {}
for (const m of commands.matchAll(/const (allowed\w+) = (\[[\s\S]*?\]);/g))
	enums[m[1]] = vm.runInNewContext(m[2], {}, { timeout: 100 })
const categorical = require(path.join(root, 'server/develop-categorical-state.js'))
const mask = require(path.join(root, 'app/controller-masking-corrections.js'))
const point = require(path.join(root, 'server/point-color-state.js'))
const curve = require(path.join(root, 'server/point-curve-state.js'))
const data = {
	version: JSON.parse(read('package.json')).version,
	enums,
	sliders: require(path.join(root, 'server/sliders.js'))
		.getAll()
		.filter((s) => s.feedbackSupported),
	grading: require(path.join(root, 'server/color-grading.js')).getMetadata(),
	categorical: Object.fromEntries(
		['whiteBalanceOptions', 'processOptions', 'vignetteStyleOptions', 'uprightModeOptions'].map((k) => [
			k,
			categorical[k],
		]),
	),
	masking: { controls: mask.definitions, creation: mask.creationTypes },
	pointColor: {
		fields: point.fields,
		ranges: point.ranges,
		rangeNames: point.rangeNames,
		boundaries: point.boundaries,
	},
	curve: { channels: curve.CHANNELS, presets: curve.PRESET_CURVES },
	bokeh: require(path.join(root, 'server/lens-blur-state.js')).bokehValues,
	sourceHashes: Object.fromEntries(
		[
			'app/controller.html',
			'server/bridge.js',
			'server/commands.js',
			'server/guarded-set.js',
			'server/reset-completion.js',
		].map((p) => [p, crypto.createHash('sha256').update(read(p)).digest('hex')]),
	),
}
fs.writeFileSync(path.join(__dirname, '../src/beta4-data.json'), JSON.stringify(data, null, 2) + '\n')
console.log(
	JSON.stringify({
		version: data.version,
		sliders: data.sliders.length,
		masking: data.masking.controls.length,
		enums: Object.keys(enums).length,
	}),
)
