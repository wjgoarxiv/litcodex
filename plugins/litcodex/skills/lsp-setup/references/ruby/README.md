# Ruby — LSP setup

- **Advisory server id:** `ruby-lsp` — `rubocop --lsp`
- **Extensions:** `.rb .rake .gemspec .ru`
- **Install hint:** `gem install ruby-lsp`

> **Note:** the advisory id is `ruby-lsp`, but the executable shown here is **`rubocop`** (`rubocop --lsp`). RuboCop must be installed: `gem install rubocop`.

## Install

- **macOS:** `gem install rubocop` (and `gem install ruby-lsp` for the install hint's gem)
- **Linux:** `gem install rubocop`
- **Windows:** `gem install rubocop`

In a Bundler project, prefer adding `rubocop` to the `Gemfile` and running via `bundle exec`.

Confirm it resolves (check `rubocop`, since that is what runs):

```bash
command -v rubocop
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "ruby-lsp": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. Behavior is driven by your `.rubocop.yml`; the server surfaces RuboCop diagnostics, formatting, and code actions over LSP.

## Alternatives

- **`ruby-lsp` gem server** (not in the advisory default table) — the standalone Shopify Ruby LSP binary (`ruby-lsp` executable), richer navigation than RuboCop alone. Configure as a custom server with `command: ["ruby-lsp"]` in an external client.
- **`solargraph`** (not in the advisory default table) — older completion/type server; install with `gem install solargraph`, custom `command: ["solargraph", "stdio"]`.

## Troubleshooting

- **PATH:** `rubocop` on PATH (that is the invoked binary, not `ruby-lsp`); reopen shell after install.
- **`rubocop` not found:** the advisory command fails even if the `ruby-lsp` gem is installed — install RuboCop with `gem install rubocop`.
- **Bundler mismatch:** if the project pins RuboCop in its `Gemfile`, run inside the bundle so versions match.
- **No diagnostics:** check `.rubocop.yml` is valid and not disabling everything.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
