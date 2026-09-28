# Bash — LSP setup

- **Advisory server id:** `bash` — `bash-language-server start`
- **Extensions:** `.sh .bash .zsh .ksh`
- **Install hint:** `npm install -g bash-language-server`

An alias id `bash-ls` exists with the identical command; either id works.

## Install

- **macOS:** `npm install -g bash-language-server`
- **Linux:** `npm install -g bash-language-server`
- **Windows:** `npm install -g bash-language-server` (PowerShell)

For real diagnostics, also install `shellcheck`:

- **macOS:** `brew install shellcheck`
- **Linux:** `apt install shellcheck` (or `dnf install ShellCheck`)
- **Windows:** `scoop install shellcheck`

Confirm it resolves:

```bash
command -v bash-language-server
command -v shellcheck
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "bash": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. `bash-language-server` can discover `shellcheck` on PATH. To point at a non-PATH binary, export `SHELLCHECK_PATH` via `env`:

```json
{ "lsp": { "bash": { "env": { "SHELLCHECK_PATH": "/opt/bin/shellcheck" } } } }
```

## Alternatives

- `shellcheck` standalone as a linter-only flow (no LSP).
- `shfmt` for formatting (complements, does not replace, the LSP).

## Troubleshooting
- **PATH:** `bash-language-server` on PATH; reopen shell after `npm -g` install.
- **No diagnostics:** `shellcheck` missing — diagnostics are powered by it; install and reopen.
- **Wrong shell dialect:** `.zsh`/`.ksh` are linted as bash; shellcheck may flag shell-specific syntax.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
