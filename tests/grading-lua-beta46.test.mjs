import test from 'node:test'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { runLua } = require('./helpers/lua.cjs')
const reference = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const plugin = path.join(reference, 'lightroom/LRBridge.lrplugin')
const metadata = readFileSync(path.join(plugin, 'color-grading.properties'), 'utf8')

function fixture(assertions) {
	runLua(`
local moduleName = "develop"
local photoA, photoB = {}, {}
local photo = photoA
local sleeps, switches, writes, resets, tracking, views = {}, {}, {}, {}, {}, {}
local onSleep, onRange, onTracking, onWrite
local switchSucceeds = true
local sdk = {
    LrApplication = { activeCatalog = function()
        return { getTargetPhoto = function() return photo end }
    end },
    LrApplicationView = {
        getCurrentModuleName = function() return moduleName end,
        switchToModule = function(name)
            switches[#switches + 1] = name
            if switchSucceeds then moduleName = name end
        end
    },
    LrDevelopController = {
        getRange = function(parameter)
            if onRange then onRange(parameter) end
            if string.match(parameter, "Hue$") then return 0, 360 end
            if string.match(parameter, "Saturation$") or string.match(parameter, "Sat$") or parameter == "ColorGradeBlending" then
                return 0, 100
            end
            return -100, 100
        end,
        startTracking = function(parameter)
            tracking[#tracking + 1] = parameter
            if onTracking then onTracking(parameter) end
        end,
        setValue = function(parameter, value)
            writes[#writes + 1] = { parameter = parameter, value = value, photo = photo }
            if onWrite then onWrite(parameter) end
        end,
        resetToDefault = function(parameter)
            resets[#resets + 1] = { parameter = parameter, photo = photo }
        end,
        setActiveColorGradingView = function(view) views[#views + 1] = view end
    },
    LrTasks = { sleep = function(seconds)
        sleeps[#sleeps + 1] = seconds
        if onSleep then onSleep(seconds) end
    end },
    LrFileUtils = { readFile = function() return [====[${metadata}]====] end },
    LrPathUtils = { child = function(parent, name) return parent .. "/" .. name end }
}
function import(name) return assert(sdk[name], name) end
_PLUGIN = { path = ${JSON.stringify(plugin)} }
local ColorGrading = assert(loadfile(${JSON.stringify(path.join(plugin, 'ColorGrading.lua'))}))()
local function rejects(call)
    local ok, failure = pcall(call)
    assert(not ok, "Expected context/validation rejection")
    assert(type(failure) == "string")
end
${assertions}
`)
}

test('Actual grading Lua writes all wheel/scalar mappings immediately when Develop is ready', () => {
	fixture(`
local regions, controls = ColorGrading.getParameters()
for name, mapping in pairs(regions) do
    local count = #writes
    assert(ColorGrading.setWheel(name, 42, 17))
    assert(#writes == count + 2)
    assert(writes[count + 1].parameter == mapping.hue and writes[count + 1].value == 42)
    assert(writes[count + 2].parameter == mapping.saturation and writes[count + 2].value == 17)
end
for name, parameter in pairs(controls) do
    assert(ColorGrading.setValue(name, 23))
    assert(writes[#writes].parameter == parameter and writes[#writes].value == 23)
end
assert(#sleeps == 0 and #switches == 0, "Ready Develop must not incur a module-transition delay")
assert(#tracking == #writes)
for _, write in ipairs(writes) do assert(write.photo == photoA) end
`)
})

test('Actual grading Lua retains the 200ms wait when entering Develop', () => {
	for (const call of ['ColorGrading.setWheel("shadows", 42, 17)', 'ColorGrading.setValue("blending", 23)']) {
		fixture(`
moduleName = "library"
assert(${call})
assert(#switches == 1 and switches[1] == "develop")
assert(#sleeps == 1 and sleeps[1] == 0.2)
assert(#writes > 0 and writes[1].photo == photoA)
`)
	}
})

test('Actual grading Lua refuses a changed photo or failed module transition before writing', () => {
	for (const setup of ['onSleep = function() photo = photoB end', 'switchSucceeds = false']) {
		fixture(`
moduleName = "library"
${setup}
rejects(function() ColorGrading.setWheel("shadows", 42, 17) end)
assert(#sleeps == 1 and sleeps[1] == 0.2)
assert(#writes == 0 and #tracking == 0)
`)
	}
})

test('Actual grading Lua revalidates photo/module after SDK range and tracking calls', () => {
	for (const setup of [
		'onRange = function() photo = photoB end',
		'onRange = function() moduleName = "library" end',
		'onTracking = function() photo = photoB end',
	]) {
		for (const call of ['ColorGrading.setWheel("shadows", 42, 17)', 'ColorGrading.setValue("blending", 23)']) {
			fixture(`
${setup}
rejects(function() ${call} end)
assert(#writes == 0, "A stale target must never be written")
assert(#sleeps == 0 and #switches == 0)
`)
		}
	}
})

test('Actual grading Lua prevents the second wheel axis from crossing a photo change', () => {
	fixture(`
onWrite = function() photo = photoB end
rejects(function() ColorGrading.setWheel("shadows", 42, 17) end)
assert(#writes == 1 and writes[1].photo == photoA)
`)
})

test('Actual grading Lua preserves SDK reset mappings and view selection', () => {
	fixture(`
local regions, controls = ColorGrading.getParameters()
assert(ColorGrading.resetValue("balance"))
assert(#resets == 1 and resets[1].parameter == controls.balance)
assert(ColorGrading.resetRegion("midtones"))
assert(#resets == 4)
assert(resets[2].parameter == regions.midtones.hue)
assert(resets[3].parameter == regions.midtones.saturation)
assert(resets[4].parameter == regions.midtones.luminance)
assert(ColorGrading.setView("3-way"))
assert(#views == 1 and views[1] == "3-way")
assert(#writes == 0 and #sleeps == 0 and #switches == 0)
`)
	for (const call of ['ColorGrading.resetValue("balance")', 'ColorGrading.resetRegion("midtones")']) {
		fixture(`
onRange = function() photo = photoB end
rejects(function() ${call} end)
assert(#resets == 0)
`)
		fixture(`
moduleName = "library"
assert(${call})
assert(#sleeps == 1 and sleeps[1] == 0.2)
assert(#resets > 0 and resets[1].photo == photoA)
`)
	}
})

test('Actual grading Lua preserves range validation and rejects invalid controls without writes', () => {
	fixture(`
rejects(function() ColorGrading.setWheel("shadows", 361, 17) end)
rejects(function() ColorGrading.setWheel("shadows", 42, -1) end)
rejects(function() ColorGrading.setValue("blending", 101) end)
rejects(function() ColorGrading.setValue("blending", 0/0) end)
rejects(function() ColorGrading.setWheel("unknown", 42, 17) end)
rejects(function() ColorGrading.setValue("unknown", 23) end)
rejects(function() ColorGrading.setView("unknown") end)
assert(#writes == 0 and #tracking == 0 and #views == 0)
`)
})
