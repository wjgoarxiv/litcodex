# Lua — LSP setup

- **Advisory server id:** `lua-ls` — `lua-language-server`
- **Extensions:** `.lua`
- **Install hint:** `https://github.com/LuaLS/lua-language-server`

## Install

See `https://github.com/LuaLS/lua-language-server`.

- **macOS:** `brew install lua-language-server`
- **Linux:** download a release from GitHub, or `pacman -S lua-language-server` (Arch) / AUR
- **Windows:** download a release from the GitHub releases page and add its `bin` to PATH

Confirm it resolves:

```bash
command -v lua-language-server
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "lua-ls": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

For Neovim config development, point the server at the Neovim runtime and set the Lua runtime version so `vim` globals and stdlib resolve:

```json
{
  "lsp": {
    "lua-ls": {
      "initialization": {
        "Lua": {
          "runtime": { "version": "LuaJIT" },
          "workspace": {
            "library": ["/usr/share/nvim/runtime/lua"]
          },
          "diagnostics": { "globals": ["vim"] }
        }
      }
    }
  }
}
```

## Alternatives

None.

## Troubleshooting
- **PATH:** `lua-language-server` must be on PATH; reopen the shell after install.
- **Undefined `vim` global:** add `vim` to `Lua.diagnostics.globals` and set `Lua.workspace.library` (see above) for Neovim work.
- **Wrong runtime version:** set `Lua.runtime.version` (`LuaJIT`, `Lua 5.4`, etc.) to match your interpreter, or stdlib functions report as undefined.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
