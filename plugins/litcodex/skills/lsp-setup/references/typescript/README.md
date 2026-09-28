# TypeScript / JavaScript — LSP setup

- **Advisory server id:** `typescript` — `typescript-language-server --stdio`
- **Extensions:** `.ts .tsx .js .jsx .mjs .cjs .mts .cts`
- **Install hint:** `npm install -g typescript-language-server typescript`

## Install

- **macOS:** `npm install -g typescript-language-server typescript`
- **Linux:** `npm install -g typescript-language-server typescript`
- **Windows:** `npm install -g typescript-language-server typescript` (PowerShell or cmd)

`typescript-language-server` is only a thin wrapper — it needs the `typescript`
package (`tsserver`) present too, either globally or in the project's
`node_modules`. Always install both.

Confirm it resolves:

```bash
command -v typescript-language-server
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "typescript": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. To favor inlay hints or tweak preferences:

```json
{ "lsp": { "typescript": { "initialization": { "preferences": { "includeInlayParameterNameHints": "all" } } } } }
```

## Alternatives

All are advisory options — pick by toolchain. Raise the alternative's `priority` and/or
`disabled` the default so the file routes to your choice:

| id           | command                                  | when to choose                          |
| ------------ | ---------------------------------------- | --------------------------------------- |
| `deno`       | `deno lsp`                               | Deno projects (handles `.ts/.tsx/.js`)  |
| `biome`      | `biome lsp-proxy --stdio`                | Biome lint/format as the LSP            |
| `eslint`     | `vscode-eslint-language-server --stdio`  | ESLint diagnostics (install below)      |
| `oxlint`     | `oxlint --lsp`                           | fast Oxc-based linting                  |
| `vue`        | `vue-language-server --stdio`            | `.vue` single-file components           |
| `svelte`     | `svelteserver --stdio`                   | `.svelte` files                         |
| `astro`      | `astro-ls --stdio`                       | `.astro` files                          |

`eslint` install: `npm i -g vscode-langservers-extracted`.

Pick Deno or Biome over the default:

```json
{ "lsp": {
  "typescript": { "disabled": true },
  "deno": { "priority": 100 }
} }
```

(Swap `"deno"` for `"biome"` to use Biome instead.)

## Troubleshooting
- **PATH:** `typescript-language-server` must be on PATH; reopen shell after `npm i -g`. Check your global bin with `npm bin -g`.
- **Missing tsserver:** errors like "Could not find tsserver" mean the `typescript` package is absent — install it globally or in the project.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
