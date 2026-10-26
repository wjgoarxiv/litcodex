# LitCodex plugin

This folder is the Codex CLI plugin at the heart of LitCodex. Put `lit` in a prompt and Codex works toward
checks that can pass or fail, keeps the goal and its evidence under the project's `.litcodex/` folder, and
picks the thread up again in a later session. The project README explains the workflow in full:
<https://github.com/wjgoarxiv/litcodex#readme>.

## Install

The recommended route is the npm installer. You need Node.js 22 or later and Codex CLI:

```sh
npm install -g @litfamily/litcodex
litcodex install
```

It copies the runtime files of this folder into `~/.codex/marketplaces/litcodex`, registers the plugin, its hooks and its agent
roles, changes only the keys it manages in `~/.codex/config.toml`, and finishes with a doctor check. The
install guide covers dry runs, a separate Codex home and Windows:
<https://github.com/wjgoarxiv/litcodex/blob/main/docs/install.md>.

Codex can also add the repository as a marketplace and install the plugin from it:

```sh
codex plugin marketplace add wjgoarxiv/litcodex
codex plugin add litcodex@litcodex
```

That route installs this folder only. The agent roles and the managed config keys come from the npm
installer.

## What is in this folder

| Path | Role |
|---|---|
| `.codex-plugin/plugin.json` | Plugin manifest: name, version, skills, hooks, MCP server and the listing details Codex shows |
| `hooks/hooks.json` | Hook commands for `UserPromptSubmit`, `SessionStart`, `PreToolUse`, `PostToolUse`, `PostCompact` and `Stop` |
| `.mcp.json` | The local `litcodex` MCP server that draws the LIT card, started from this folder over stdio |
| `components/*/dist/` | Compiled hook and server code. It is committed because `codex plugin add` copies the folder without a build step |
| `skills/` | The bundled skills, each with its own `SKILL.md`, references and scripts |
| `vendor/` | Third-party material the skills ship, with its licenses under `vendor/licenses/` |

## Security and privacy

Hooks run as local Node processes with your user's permissions whenever Codex fires the matching event.
They read the prompt or tool payload Codex hands them and write project state under `.litcodex/`. The
plugin collects no usage analytics. Its update checks contact the npm registry; set
`LITCODEX_NO_UPDATE_CHECK=1` to turn them off. Details:
<https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md>. Report a vulnerability as described
in [SECURITY.md](./SECURITY.md).

## License

MIT, see [LICENSE](./LICENSE).
