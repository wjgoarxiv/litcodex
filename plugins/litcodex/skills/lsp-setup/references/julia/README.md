# Julia — LSP setup

- **Advisory server id:** `julials` — `julia --startup-file=no --history-file=no -e using LanguageServer; runserver()`
- **Extensions:** `.jl`
- **Install hint:** `julia -e 'using Pkg; Pkg.add("LanguageServer")'`

The PATH executable is `julia`; LanguageServer.jl is launched through the `-e` snippet, not as its own binary.

## Install

Install Julia (juliaup recommended), then add the `LanguageServer` package:

- **macOS:** `brew install juliaup && juliaup add release`
- **Linux:** `curl -fsSL https://install.julialang.org | sh` (installs juliaup)
- **Windows:** `winget install julia -s msstore` (installs juliaup)

Then add the package — ideally into a shared `@lsp` environment so it is not tied to one project:

```bash
julia --project=@lsp -e 'using Pkg; Pkg.add("LanguageServer")'
```

Confirm Julia resolves (the LSP binary IS `julia`):

```bash
command -v julia
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "julials": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. To pin which environment hosts LanguageServer.jl, set `JULIA_PROJECT` (or `JULIA_DEPOT_PATH`) via `env`:

```json
{ "lsp": { "julials": { "env": { "JULIA_PROJECT": "@lsp" } } } }
```

## Alternatives

- The VS Code Julia extension bundles the same LanguageServer.jl server.

## Troubleshooting
- **PATH:** `julia` on PATH (not a `julials` binary); reopen shell after juliaup install.
- **First run precompiles — be patient:** the initial launch compiles LanguageServer.jl and may take minutes with no output; do not kill it. Subsequent starts are fast.
- **Package not found:** `LanguageServer` must be installed in the environment the server runs in (e.g. `@lsp`); add it there and set `JULIA_PROJECT`.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
