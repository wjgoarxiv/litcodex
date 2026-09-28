# Haskell — LSP setup

- **Advisory server id:** `haskell-language-server` — `haskell-language-server-wrapper --lsp`
- **Extensions:** `.hs .lhs`
- **Install hint:** `ghcup install hls`

The `-wrapper` binary detects your project's GHC version and dispatches to the matching HLS build.

## Install

- **macOS:** `ghcup install hls` (install ghcup via `brew install ghcup` or the official script)
- **Linux:** `ghcup install hls` (ghcup script from https://www.haskell.org/ghcup/)
- **Windows:** `ghcup install hls` (ghcup is installed via the Windows installer / PowerShell bootstrap)

HLS needs a working GHC plus Cabal and/or Stack. Install a matching toolchain first:

```bash
ghcup install ghc
ghcup install cabal
```

Confirm it resolves:

```bash
command -v haskell-language-server-wrapper
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "haskell-language-server": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. Per-project plugin/formatter settings normally live in a `hie.yaml` (cradle) and `.haskell-language-server` files rather than init options.

## Alternatives

- `ghcide` (the core HLS engine, standalone) — largely superseded by HLS.
- `hlint` standalone for lint-only checks; `ormolu`/`fourmolu` for formatting.

## Troubleshooting
- **PATH:** `haskell-language-server-wrapper` on PATH; reopen shell after `ghcup install`.
- **GHC mismatch:** the installed HLS must support your project's GHC version — run `ghcup install hls` for that GHC, or align GHC to a supported one.
- **No cradle:** multi-package repos may need a `hie.yaml`; generate one with `gen-hie > hie.yaml`.
- **Slow first load:** HLS compiles dependencies on first open; let it finish indexing.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
