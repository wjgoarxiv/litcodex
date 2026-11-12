---
name: lit-scientific-visualization
description: "Create publication-quality scientific figures. Use when source-backed scripts, styles, and visual QA are required."
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: lit-scientific-visualization
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/lit-scientific-visualization/SKILL.md
stub_for: wjgoarxiv-skills variants/litcodex/lit-scientific-visualization/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. lit-scientific-visualization makes a publication-quality plot of measured data on the authored scientific-visualization source. It is now a LitFamily extension, kept in **wjgoarxiv-skills** (`figures` family); its self-contained Codex edition is `variants/litcodex/lit-scientific-visualization`. The id stays here so its routes still land: the exact bare `lit-scientific-visualization` hook route, `$litcodex:lit-scientific-visualization` and the picker.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `lit-scientific-visualization` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/lit-scientific-visualization/SKILL.md`) means the extension is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `lit-scientific-visualization` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | lit-scientific-visualization was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted lit-scientific-visualization | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what lit-scientific-visualization makes, that it is a LitFamily extension in wjgoarxiv-skills (Codex edition `variants/litcodex/lit-scientific-visualization`), and give the lines below unchanged. Its authored source ships inside that folder (`vendor/scientific-visualization`), so one copy is the whole install.
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

Public repo: clone https://github.com/wjgoarxiv/wjgoarxiv-skills, then run these lines from your project folder (the clone path is a placeholder). One line each: check, move aside, copy, receipt. Or let LitCodex run the same steps: `litcodex extensions install lit-scientific-visualization` shows the plan, `--yes` runs it, and `litcodex extensions check` names old or competing copies.

```bash
cx="${CODEX_HOME:-$HOME/.codex}"; p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/lit-scientific-visualization" ] && echo "found: $d/lit-scientific-visualization"; done; echo "check done"
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-scientific-visualization" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/lit-scientific-visualization" ] && mv "$cx/skills/lit-scientific-visualization" "$b/lit-scientific-visualization" && echo "moved aside: $b/lit-scientific-visualization"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-scientific-visualization" ]; then echo "stopped: $cx/skills/lit-scientific-visualization still exists"; else mkdir -p "$cx/skills" && cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-scientific-visualization" "$cx/skills/lit-scientific-visualization"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; [ -f "$cx/skills/lit-scientific-visualization/SKILL.md" ] && printf '{"id":"lit-scientific-visualization","source":"%s","variant":"litcodex","installed_at":"%s"}\n' "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-scientific-visualization" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/lit-scientific-visualization/.litfamily-extension.json"
```

A `found:` line under `${CODEX_HOME:-$HOME/.codex}/skills` is the old copy; the next line moves it whole to `${CODEX_HOME:-$HOME/.codex}/extension-backups/<date-time>/lit-scientific-visualization`, which Codex does not read. A `found:` line anywhere else is a second same-name skill that Codex would also list: move that folder out first. The copy line stops on an occupied folder, so nothing nests or merges. Then start a **new Codex session**; the copy is listed as `lit-scientific-visualization` beside this stub (`litcodex:lit-scientific-visualization`). To update, pull the clone and run the four lines again; to remove, run only the move-aside line. LitCodex install and upgrades never write `${CODEX_HOME:-$HOME/.codex}/skills/`, so the copy outlives them.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `variants/litcodex/lit-scientific-visualization` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim lit-scientific-visualization ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
