# Zig — LSP setup

- **Advisory server id:** `zls` — `zls`
- **Extensions:** `.zig .zon`
- **Install hint:** `https://github.com/zigtools/zls`

## Install

ZLS (the Zig Language Server) must be built against the **same Zig version** you use.
See `https://github.com/zigtools/zls`.

- **macOS:** `brew install zls`
- **Linux:** download a prebuilt release matching your Zig version, or `zig build -Doptimize=ReleaseSafe` from the zls source
- **Windows:** download the matching release from the zls GitHub releases, or build from source

Confirm it resolves:

```bash
command -v zls
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "zls": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required.

## Alternatives

None.

## Troubleshooting
- **VERSION MATCH (critical):** zls version MUST match your zig version — build/install zls against the exact same Zig. A mismatch causes crashes, parse errors, or silent failures. After upgrading Zig, upgrade/rebuild zls too.
- **PATH:** `zls` must be on PATH; reopen the shell after install.
- **zig not found:** zls invokes `zig` for builds — make sure `zig` itself is also on PATH.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
