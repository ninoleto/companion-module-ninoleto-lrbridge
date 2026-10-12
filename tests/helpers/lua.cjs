const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari')

// Execute the actual plugin Lua under an isolated, mocked Lightroom SDK.
// Lua assertion/runtime failures propagate to node:test; print output is returned.
function runLua(script) {
	const state = lauxlib.luaL_newstate()
	const output = []
	try {
		lualib.luaL_openlibs(state)
		lua.lua_pushcfunction(state, (L) => {
			const parts = []
			for (let index = 1, count = lua.lua_gettop(L); index <= count; index++) {
				parts.push(to_jsstring(lauxlib.luaL_tolstring(L, index)))
				lua.lua_pop(L, 1)
			}
			output.push(parts.join('\t'))
			return 0
		})
		lua.lua_setglobal(state, to_luastring('print'))
		const source = to_luastring(script)
		let status = lauxlib.luaL_loadbuffer(state, source, source.length, to_luastring('@companion-lua-test'))
		if (status === lua.LUA_OK) status = lua.lua_pcall(state, 0, 0, 0)
		if (status !== lua.LUA_OK) {
			const failure = lua.lua_tolstring(state, -1)
			throw new Error(failure ? to_jsstring(failure) : `Lua execution failed (${status})`)
		}
		return output.join('\n')
	} finally {
		lua.lua_close(state)
	}
}

module.exports = { runLua }
