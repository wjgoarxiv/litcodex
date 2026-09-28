# Elixir — LSP setup

- **Advisory server id:** `elixir-ls` — `elixir-ls`
- **Extensions:** `.ex .exs`
- **Install hint:** `https://github.com/elixir-lsp/elixir-ls`

## Install

ElixirLS needs Erlang/OTP and Elixir installed first. Build the release from
`https://github.com/elixir-lsp/elixir-ls` and put the `elixir-ls` launcher script on PATH.

- **macOS:** `brew install elixir-ls` (Homebrew provides the launcher), or build the release manually
- **Linux:** clone elixir-ls, run `mix deps.get && mix compile && mix elixir_ls.release2 -o release`, then add `release/` to PATH
- **Windows:** build the release and add the `release` dir (use the `.bat` launcher) to PATH

Confirm it resolves:

```bash
command -v elixir-ls
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "elixir-ls": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required.

## Alternatives

- **lexical** (not in the advisory default table): `lexical` — fast, modern alternative LSP.
- **next-ls** (not in the advisory default table): `nextls --stdio` — from the elixir-tools project.

## Troubleshooting
- **PATH:** `elixir-ls` must be on PATH; reopen the shell after install.
- **asdf users:** the launcher is a shim — after `asdf install`, run `asdf reshim elixir` so the `elixir-ls` shim resolves, and ensure the Erlang/Elixir versions match the build.
- **First start is slow:** ElixirLS compiles your deps on first run; initial diagnostics can take a while on large projects.
- **OTP mismatch:** build elixir-ls with the same Erlang/Elixir versions you use for the project to avoid bytecode errors.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
