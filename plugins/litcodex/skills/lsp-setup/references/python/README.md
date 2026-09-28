# Python — LSP setup

- **Advisory server id:** `basedpyright` — `basedpyright-langserver --stdio`
- **Extensions:** `.py .pyi`
- **Install hint:** `pip install basedpyright`

## Install

- **macOS:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Linux:** `pip install basedpyright` (or `uv tool install basedpyright`)
- **Windows:** `pip install basedpyright`

Prefer `uv tool install basedpyright` when the project uses uv — it keeps the
server isolated from project venvs and always on PATH.

Confirm it resolves:

```bash
command -v basedpyright-langserver
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "basedpyright": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. Type-check mode is usually set via `pyrightconfig.json`
or `[tool.basedpyright]` in `pyproject.toml`, not the LSP config.

## Choosing a server

All four are advisory options. Type checkers and the linter serve different roles — run a
type server, and optionally `ruff` ALONGSIDE it (not instead).

| id            | command                       | install                | role                                    |
| ------------- | ----------------------------- | ---------------------- | --------------------------------------- |
| `basedpyright`| `basedpyright-langserver --stdio` | `pip install basedpyright` | strictest types, **default**       |
| `pyright`     | `pyright-langserver --stdio`  | `pip install pyright`  | upstream Microsoft type checker         |
| `ty`          | `ty server`                   | `pip install ty`       | Astral, very fast, pre-1.0/experimental |
| `ruff`        | `ruff server`                 | `pip install ruff`     | lint + format only, complements a type server |

Recommended priority: **basedpyright** (default) > pyright > ty (experimental).
`ruff` complements via priority — it does not type-check, so keep a type server
enabled.

Enable ruff alongside basedpyright, disabling pyright:

```json
{ "lsp": {
  "basedpyright": { "priority": 100 },
  "ruff": { "priority": 90 },
  "pyright": { "disabled": true }
} }
```

## Troubleshooting
- **PATH:** `basedpyright-langserver` must be on PATH; reopen shell after install. `uv tool install` writes to `~/.local/bin`.
- **Wrong interpreter / missing imports:** the server must see the project venv. Set `python.pythonPath` / `venvPath` in `pyrightconfig.json`, or activate the venv before launching.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
