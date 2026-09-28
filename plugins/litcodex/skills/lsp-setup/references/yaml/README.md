# YAML — LSP setup

- **Advisory server id:** `yaml-ls` — `yaml-language-server --stdio`
- **Extensions:** `.yaml .yml`
- **Install hint:** `npm install -g yaml-language-server`

## Install

- **macOS:** `npm install -g yaml-language-server`
- **Linux:** `npm install -g yaml-language-server`
- **Windows:** `npm install -g yaml-language-server` (PowerShell)

Confirm it resolves:

```bash
command -v yaml-language-server
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "yaml-ls": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

Schema association is the main reason to configure yaml-ls. Map globs to a schema URL or local path under `yaml.schemas`:

```json
{
  "lsp": {
    "yaml-ls": {
      "initialization": {
        "yaml": {
          "schemas": {
            "https://json.schemastore.org/github-workflow.json": ".github/workflows/*.yml",
            "https://json.schemastore.org/kustomization.json": "kustomization.yaml",
            "./schemas/my-config.schema.json": "config/*.yaml"
          },
          "validate": true,
          "completion": true,
          "format": { "enable": true }
        }
      }
    }
  }
}
```

Set `"yaml.schemaStore": { "enable": true }` to auto-resolve schemas from SchemaStore (catalog at https://www.schemastore.org/). Inline `# yaml-language-server: $schema=<url>` modelines also work without config.

## Alternatives

- `redhat.vscode-yaml` bundles the same server in editors.
- `yamllint` standalone for style/lint-only checks.

## Troubleshooting
- **PATH:** `yaml-language-server` on PATH; reopen shell after `npm -g` install.
- **No validation:** no schema matched — add a `yaml.schemas` glob or a `$schema` modeline.
- **Wrong schema applied:** SchemaStore guessed by filename; pin explicitly under `yaml.schemas`.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
