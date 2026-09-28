# Go — LSP setup

- **Advisory server id:** `gopls` — `gopls`
- **Extensions:** `.go`
- **Install hint:** `go install golang.org/x/tools/gopls@latest`

## Install

- **macOS:** `go install golang.org/x/tools/gopls@latest` (or `brew install gopls`)
- **Linux:** `go install golang.org/x/tools/gopls@latest`
- **Windows:** `go install golang.org/x/tools/gopls@latest`

Requires the Go toolchain. `go install` drops the binary in `$GOPATH/bin`
(default `~/go/bin`) — that directory must be on PATH.

```bash
export PATH="$PATH:$(go env GOPATH)/bin"
```

Confirm it resolves:

```bash
command -v gopls
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "gopls": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. To enable extra analyses or staticcheck:

```json
{ "lsp": { "gopls": { "initialization": { "staticcheck": true } } } }
```

## Alternatives

None — `gopls` is the official and de facto sole Go language server.

## Troubleshooting
- **PATH:** `gopls` must be on PATH; ensure `$(go env GOPATH)/bin` is exported, then reopen the shell.
- **No diagnostics / "no required module":** open the directory containing `go.mod` as the workspace root. Outside a module, gopls degrades. Run `go mod tidy` if dependencies are unresolved.
- **Stale toolchain:** reinstall with `go install golang.org/x/tools/gopls@latest` after upgrading Go.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
