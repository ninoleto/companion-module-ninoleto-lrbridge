import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { runLua } = require('./helpers/lua.cjs')
const bridge = path.resolve(process.env.LRBRIDGE_REFERENCE || '../lrbridge-beta4-reference')
const source = path.join(bridge, 'lightroom/LRBridge.lrplugin/Remove.lua')

// Execute the actual bridge Lua. The mocked SDK controls its native reads,
// writes and yields; it does not synthesize successful operation results.
const fixture = `
local preferences = { newSpotType = "clone", brushSize = 38.018, brushFeather = 0.523 * 100,
    useGenerativeAI = false, detectObjects = false, toolOverlay = "auto",
    visualizeSpots = true, visualizationThreshold = 40 }
local module, photoUuid, tool = "develop", "photo-one", "dust"
local preferenceReads, repairReads, dustReads, writes, validations, sleeps = 0, 0, 0, 0, 0, 0
local onPreferenceRead, onRepairRead, onValidation, onWrite
local result, queryResult, command
local function copy(value)
    if type(value) ~= "table" then return value end
    local out = {}; for k,v in pairs(value) do out[k] = copy(v) end; return out
end
local function decode(value)
    return (string.gsub(value, "%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end
local function params(url)
    local out = {}
    for k,v in string.gmatch(url, "[?&]([^=&]+)=([^&]*)") do out[k] = decode(v) end
    return out
end
local function json(value)
    if type(value) == "string" then return '"' .. value .. '"' end
    if type(value) ~= "table" then return tostring(value) end
    local out = {}; for k,v in pairs(value) do out[#out+1] = '"' .. k .. '":' .. json(v) end
    return "{" .. table.concat(out, ",") .. "}"
end
local photo = { getRawMetadata = function() return photoUuid end }
local SDK = {
    getSelectedTool = function() return tool end,
    getRemovePanelPreferences = function()
        preferenceReads = preferenceReads + 1
        if onPreferenceRead then onPreferenceRead(preferenceReads) end
        return preferences -- The real SDK may reuse its table; baseline must be frozen.
    end,
    setRemovePanelPreferences = function(update)
        writes = writes + 1
        local count = 0; for k in pairs(update) do count = count + 1; assert(k == command.field) end
        assert(count == 1, "Only the requested brush preference may be written")
        if onWrite then return onWrite(update) end
        for k,v in pairs(update) do preferences[k] = v end
        return true
    end,
    setSelectedSpotParams = function() error("A new-brush edit must never edit a selected repair") end,
    selectTool = function() error("A brush edit must never select a tool") end,
}
local libraries = {
    LrApplication = { activeCatalog = function() return { getTargetPhoto = function() return photo end } end },
    LrApplicationView = { getCurrentModuleName = function() return module end },
    LrDevelopController = SDK,
    LrTasks = { pcall = pcall, sleep = function(seconds) assert(seconds == 0.05); sleeps = sleeps + 1 end },
    LrHttp = { get = function(url)
        if string.find(url, "/validate?", 1, true) then
            validations = validations + 1
            if onValidation then onValidation(validations) end
            return '{"valid":true}'
        end
        if string.find(url, "/operation-result?", 1, true) then
            assert(not result, "One terminal result only")
            result = params(url)
            assert(#result.detail <= 300)
            assert(result.repair == '{"available":true}', "The public result must include full repair state")
            assert(result.dust == '{"available":true}', "The public result must include full Dust state")
            return '{"ok":true}'
        end
        if string.find(url, "/query-result?", 1, true) then queryResult = params(url); return '{"ok":true}' end
        error("Unexpected HTTP request: " .. url)
    end },
}
function import(name) assert(libraries[name], name); return libraries[name] end
package.loaded.Parser = { parse = function() return command end }
package.loaded.RemoveRepair = {
    diagnostics = function() return {} end,
    observe = function(_, _, getter) return getter() end,
    read = function()
        repairReads = repairReads + 1
        if onRepairRead then onRepairRead() end
        return { available = true }
    end,
    public = function(value) return value end,
    json = json,
}
package.loaded.Dust = { read = function() dustReads = dustReads + 1; return { available = true } end }
local Remove = assert(loadfile(${JSON.stringify(source)}))()
command = { command = "remove.brush.set", operationId = "rb-test", field = "brushFeather", value = 51.3,
    expectedValue = tonumber(string.format("%.14g", preferences.brushFeather)), expectedRemoveMode = "clone",
    expectedServerEpoch = "epoch", expectedRemoveRevision = 4, expectedActiveModule = "develop",
    expectedSelectedPhotoUuid = "photo-one", expectedContextCounter = 1, expectedDevelopCounter = 2,
    expectedContextChangedAt = 3 }
local function execute() Remove.setBrushPreference(command); assert(result, "Missing terminal result") end
local function fullOnce()
    assert(repairReads == 1, "Repair inventory should be read once, got " .. repairReads)
    assert(dustReads == 1, "Dust discovery should run once, got " .. dustReads)
end
`

function check(script) {
	runLua(fixture + '\n' + script)
}

test('Healing Lua accepts fractional baseline serialization in Heal and Clone with one full snapshot', () => {
	for (const mode of ['heal', 'clone']) {
		check(`
      preferences.newSpotType = ${JSON.stringify(mode)}; command.expectedRemoveMode = preferences.newSpotType
      assert(preferences.brushFeather ~= command.expectedValue, "Fixture must exercise the precision mismatch")
      execute()
      assert(result.outcome == "confirmed", result.detail)
      assert(writes == 1 and preferenceReads == 5 and sleeps == 0)
      assert(tonumber(result.brushFeather) == command.value)
      assert(result.otherPreferencesPreserved == "true")
      fullOnce()
    `)
	}
})

test('Healing Lua retains precise stale-baseline rejection for real changes', () => {
	check(`
    command.expectedValue = 52.31
    execute()
    assert(writes == 0 and result.outcome == "stale")
    assert(string.find(result.detail, "field=brushFeather", 1, true))
    assert(string.find(result.detail, "observed=52.300000000000004", 1, true))
    fullOnce()
  `)
})

test('Healing Lua rechecks photo, tool, mode and value after yielding admission validation', () => {
	for (const mutation of [
		'photoUuid = "photo-two"',
		'module = "library"',
		'tool = "loupe"',
		'preferences.newSpotType = "heal"',
		'preferences.brushFeather = 30',
	]) {
		check(`
      onValidation = function(n) if n == 2 then ${mutation} end end
      execute()
      assert(writes == 0 and result.outcome == "stale", result.detail)
      fullOnce()
    `)
	}
})

test('Healing Lua reports unchanged SDK readback without retrying the write or rescanning inventories', () => {
	check(`
    onWrite = function() return true end
    execute()
    assert(result.outcome == "failed" and writes == 1 and sleeps == 7)
    assert(preferenceReads == 11)
    assert(string.find(result.detail, "requested=", 1, true))
    assert(string.find(result.detail, "observed=52.300000000000004", 1, true))
    assert(string.find(result.detail, "setter=true", 1, true))
    fullOnce()
  `)
})

test('Healing Lua reports setter rejection once, with full public state', () => {
	for (const response of ['false', 'nil']) {
		check(`
      onWrite = function() return ${response} end
      execute()
      assert(result.outcome == "failed" and writes == 1 and sleeps == 0)
      assert(string.find(result.detail, "setter=${response}", 1, true))
      fullOnce()
    `)
	}
})

test('Healing Lua confirms only after checking the full final snapshot and preserved preferences', () => {
	for (const mutation of ['preferences.newSpotType = "heal"', 'preferences.brushSize = 60']) {
		check(`
      onPreferenceRead = function(n) if n == 4 then ${mutation} end end
      execute()
      assert(result.outcome ~= "confirmed" and writes == 1)
      assert(result.otherPreferencesPreserved == "false")
      fullOnce()
    `)
	}
	check(`
    onRepairRead = function() photoUuid = "photo-two" end
    execute()
    assert(result.outcome == "stale" and writes == 1)
    fullOnce()
  `)
	check(`
    onRepairRead = function() preferences.brushSize = 60 end
    execute()
    assert(result.outcome == "failed" and writes == 1)
    assert(tonumber(result.brushSize) == 60)
    fullOnce()
  `)
})

test('Healing Lua preserves Remove-mode Feather rejection and threshold availability guard', () => {
	check(`
    preferences.newSpotType = "heal_patchmatch"; command.expectedRemoveMode = preferences.newSpotType
    execute()
    assert(result.outcome == "failed" and writes == 0)
    fullOnce()
  `)
	check(`
    preferences.visualizeSpots = false
    command.field = "visualizationThreshold"; command.expectedValue = 40; command.value = 41
    execute()
    assert(result.outcome == "stale" and writes == 0)
    fullOnce()
  `)
})

test('Healing Lua Size, threshold, and mode writes preserve their public result contract', () => {
	for (const [field, value] of [
		['brushSize', 39.018],
		['visualizationThreshold', 41],
		['newSpotType', 'heal'],
	]) {
		check(`
      command.field = ${JSON.stringify(field)}; command.expectedValue = preferences[command.field]
      command.value = ${JSON.stringify(value)}
      execute()
      assert(result.outcome == "confirmed", result.detail)
      assert(writes == 1 and preferenceReads == 5)
      fullOnce()
    `)
	}
})

test('Healing Lua ordinary state queries still publish complete repair and Dust snapshots', () => {
	check(`
    command.requestId = "rq-test"
    assert(Remove.sendRequestedSnapshot("mock request"))
    assert(queryResult and queryResult.repair == '{"available":true}' and queryResult.dust == '{"available":true}')
    assert(preferenceReads == 1 and writes == 0)
    fullOnce()
  `)
})
