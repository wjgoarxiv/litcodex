# Rust — LSP setup

- **Advisory server id:** `rust` — `rust-analyzer`
- **Extensions:** `.rs`
- **Install hint:** `rustup component add rust-analyzer`

## Install

- **macOS:** `rustup component add rust-analyzer` (or `brew install rust-analyzer`)
- **Linux:** `rustup component add rust-analyzer`
- **Windows:** `rustup component add rust-analyzer`

The rustup component is the recommended path — it stays pinned to your toolchain.
`rust-analyzer` also needs the `rust-src` component to index the standard library
(`rustup component add rust-src`).

Confirm it resolves:

```bash
command -v rust-analyzer
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "rust": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. To switch the check command to clippy:

```json
{ "lsp": { "rust": { "initialization": { "check": { "command": "clippy" } } } } }
```

## Alternatives

None — `rust-analyzer` is the official and sole Rust language server.

## Troubleshooting
- **PATH:** `rust-analyzer` must be on PATH; reopen shell after install. The rustup shim lives in `~/.cargo/bin`.
- **Exits while loading rust-src:** if rust-analyzer crashes during stdlib indexing, reinstall the source component:

  ```bash
  rustup component remove rust-src && rustup component add rust-src
  ```

- **No proc-macro / build script support:** ensure the project builds with `cargo check`; rust-analyzer reuses the same toolchain.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
