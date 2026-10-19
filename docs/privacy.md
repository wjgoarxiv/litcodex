# Privacy and network behavior

This page describes LitCodex source behavior. It does not replace the policies of
Codex CLI, your model provider, npm, or tools that you choose to run.

## Telemetry and local records

The bundled [telemetry SessionStart handler](../plugins/litcodex/components/telemetry/src/codex-hook.ts)
is an inert compatibility stub: it returns empty output and does not write a
record or send the hook payload to an analytics service. This specific guarantee
does not mean that every LitCodex route is offline.

Workflows keep goals, evidence, and ledgers under project `.litcodex/` paths.
Research workflows can also create local result tables and reports in their
chosen output directory; for example,
[autoresearch initialization](../plugins/litcodex/skills/autoresearch/scripts/init_research.py)
creates `autoresearch-results.tsv`. These task metrics are local artifacts, not
analytics uploads. Their contents may include user-provided descriptions and
paths. Review them before sharing, backing up, or committing them. See
[state and recovery](usage.md#loop-state) for the native state layout.

## Registry traffic and updates

npm installation fetches the package and dependencies using npm. Separately, the
[update notifier](../packages/litcodex-ai/src/update-check.ts) checks a fixed npm
registry endpoint for package version metadata and caches its result at
`~/.litcodex/update-check.json`. It is eligible only after successful interactive
install or doctor commands; CI, non-TTY, JSON, dry-run, and opt-out paths skip it.
The detached notifier itself never installs an update.

The [foreground updater](../plugins/litcodex/components/auto-update/src/auto-update.ts)
is a separate active feature. Eligible management commands and the
[SessionStart updater hook](../plugins/litcodex/components/auto-update/src/cli.ts)
can check the registry, install a newer global package, refresh the managed
integration, and verify it. Its default local receipt directory is
`~/.litcodex/auto-update/`. The scoped candidate targets `@litfamily/litcodex`; this
statement does not establish that the candidate is publicly available.

Set `LITCODEX_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1` in the environment
inherited by LitCodex and Codex to disable both update paths.
`LITCODEX_NO_AUTO_UPDATE=1` disables the foreground updater while leaving the
separate notifier eligible. The CLI also accepts `--no-auto-update` on management
commands. These controls do not stop npm from downloading an explicitly requested
package, or prevent an external tool from making network requests.

## Automatic handoff

The [automatic handoff](./auto-handoff.md) is off by default and sends nothing anywhere. It
uses four local files and no network:

- `.litcodex/auto-handoff/settings.json` holds your choice: a format version, whether the option is on, and the
  percent you picked.
- `.litcodex/auto-handoff/<session id>.json` is a per-session record. It holds the session id, which step the
  session is in (idle, asked for a handoff, compacted, reloaded), the time of the request, the percent that
  triggered it, and the last percent seen. It holds no prompt text and no handoff content. LitCodex does not read
  or write either file through a symlink.
- `.codex/config.toml` in the project gets one marked line, `model_post_turn_compact_threshold_percent`, only when
  you turn the option on with the `lit-handoff auto on` command. `lit-handoff auto off` removes exactly that line.
  A value you wrote there yourself is left alone.
- The hook and `litcodex doctor` read your Codex `config.toml` (from `CODEX_HOME`, else `~/.codex`) and never write
  it. They look only for the trust setting of the current project, to tell you whether Codex will compact by itself.
- The Stop hook reads the session transcript that Codex keeps under `~/.codex/sessions`, only to find the latest
  token count. It reads the last part of the file and copies nothing out of it.

After a compaction, the hook reads the project's `.handoff/HANDOFF.md` or `HANDOFF.md`, and only when the file
was written after the trigger and names this session. It passes the first 3,000 characters to the model in the
same session. Project `.litcodex/` state is gitignored and excluded from npm and marketplace payloads.

## Card colour

`litcodex screen-status` is off by default and sends nothing anywhere. It keeps one local file,
`$CODEX_HOME/litcodex/screen-status.json`, with a format version and whether the card is coloured.

## Model and tool work

Running model work uses your configured Codex host and provider. Prompts, selected
repository content, and tool results can enter that session's model context.
Research, public-page retrieval, browser tools, and commands you authorize may
contact their own external services. LitCodex's inert telemetry hook does not
disable those host or tool paths. Check the effective permissions and provider
configuration before using sensitive data.

Installation writes managed Codex integration files; workflow artifacts remain
local until a host, user, backup service, or authorized command shares them.
Uninstalling the plugin is not a data-erasure request to model providers or other
services. For reports, share minimal sanitized excerpts rather than whole homes,
transcripts, or evidence directories. See [support](../SUPPORT.md) and
[security reporting](../SECURITY.md).
