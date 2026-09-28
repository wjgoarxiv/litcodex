# PHP — LSP setup

- **Advisory server id:** `php` — `intelephense --stdio`
- **Extensions:** `.php`
- **Install hint:** `npm install -g intelephense`

## Install

Intelephense is a Node package, so Node.js (and npm) must be installed first.

- **macOS:** `npm install -g intelephense`
- **Linux:** `npm install -g intelephense`
- **Windows:** `npm install -g intelephense`

Confirm it resolves:

```bash
command -v intelephense
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "php": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

Intelephense's premium features (rename, find-all-implementations, declaration providers, etc.) require a licence key. Supply it via `initialization`:

```json
{
  "lsp": {
    "php": {
      "initialization": {
        "licenceKey": "YOUR-LICENCE-KEY"
      }
    }
  }
}
```

Without a key the server runs fine in free mode.

## Alternatives

- **phpactor** (not in the advisory default table): `phpactor language-server`. Pure-PHP, no Node dependency.

## Troubleshooting
- **PATH:** `intelephense` must be on PATH; reopen the shell after a global npm install. If missing, check `npm bin -g` is on PATH.
- **No Node:** Intelephense fails to start without Node.js. Install Node, then reinstall.
- **Wrong PHP version inference:** set `intelephense.environment.phpVersion` via `initialization` to match your project.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
