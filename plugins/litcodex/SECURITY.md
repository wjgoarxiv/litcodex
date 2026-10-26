# Security policy for the LitCodex plugin folder

This folder is the Codex plugin that LitCodex installs: the manifest in `.codex-plugin/`, the hook
commands in `hooks/hooks.json`, the local MCP server declared in `.mcp.json`, the compiled components
under `components/*/dist/`, and the bundled skills. Reports about any of these are in scope, as are
reports about how the plugin reads or writes project `.litcodex/` state.

The full policy, including how to reach a maintainer privately, lives in the repository:
<https://github.com/wjgoarxiv/litcodex/blob/main/SECURITY.md>.

## Reporting

- Use the repository's private vulnerability reporting if its Security tab offers it. Otherwise open a
  non-sensitive issue that asks for a private contact route, and wait for that route before sharing
  details.
- Name the LitCodex version (`version` in `.codex-plugin/plugin.json`), the Codex CLI version, the
  platform, the affected hook, component or skill, and a minimal reproducer with synthetic data.
- Do not post credentials, private transcripts or complete `.codex` / `.litcodex` directories.

## What the plugin trusts

Hooks run as local Node processes with your user's permissions whenever Codex fires the matching event.
The MCP server starts from this folder and speaks over stdio only. What the plugin and its installer send
over the network, and what they keep on disk, is described in
<https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md>; `LITCODEX_NO_UPDATE_CHECK=1` turns off
both update paths.
