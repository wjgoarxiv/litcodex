# C / C++ — LSP setup

- **Advisory server id:** `clangd` — `clangd --background-index --clang-tidy`
- **Extensions:** `.c .cpp .cc .cxx .c++ .h .hpp .hh .hxx .h++`
- **Install hint:** `https://clangd.llvm.org/installation`

## Install

- **macOS:** `brew install llvm` (clangd ships in the LLVM keg; add its `bin` to PATH)
- **Linux:** `apt install clangd` (Debian/Ubuntu); use your distro package elsewhere
- **Windows:** install LLVM from `https://releases.llvm.org` or `winget install LLVM.LLVM`

See `https://clangd.llvm.org/installation` for other platforms.

Confirm it resolves:

```bash
command -v clangd
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "clangd": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. clangd reads flags from a project `.clangd` file rather
than initializationOptions. The advisory command shown above already passes
`--background-index --clang-tidy`.

## Compile commands

clangd needs a `compile_commands.json` at the project root (or in `build/`) for
accurate diagnostics and cross-file navigation. Generate it with:

- **CMake:** `cmake -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` (symlink/copy `build/compile_commands.json` to the root)
- **Make / other:** `bear -- make`

Without it, clangd falls back to heuristic flags and reports spurious errors.

## Alternatives

No alternate advisory default. `ccls` exists as a third-party server and would need a custom external-client
config with `command` + `extensions`.

## Troubleshooting
- **PATH:** `clangd` must be on PATH; reopen shell after install. Homebrew LLVM is keg-only — add `$(brew --prefix llvm)/bin` to PATH.
- **Spurious "file not found" / unknown flags:** missing or stale `compile_commands.json` — regenerate it after changing the build.
- **Header-only diagnostics wrong:** ensure the header's translation unit appears in the compile database, or add a `.clangd` `CompileFlags` block.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
