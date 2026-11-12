---
name: readme-studio
description: "Create or refresh a verified project README and distinctive static or motion cover; inspect repository facts and build only in the authorized local root."
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: readme-studio
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/readme-studio/SKILL.md
stub_for: wjgoarxiv-skills variants/litcodex/readme-studio/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · readme-studio** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. readme-studio makes a factual project README with an inspected cover and an optional motion cover. It is now a LitFamily extension, kept in **wjgoarxiv-skills** (`video-covers` family); its self-contained Codex edition is `variants/litcodex/readme-studio`. The id stays here so its routes still land: `$litcodex:readme-studio`, the picker and implicit README requests.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `readme-studio` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/readme-studio/SKILL.md`) means the extension is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `readme-studio` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | readme-studio was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted readme-studio | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what readme-studio makes, that it is a LitFamily extension in wjgoarxiv-skills (Codex edition `variants/litcodex/readme-studio`), and give the lines below unchanged. A motion cover is lit-typographic-motion's cover mode (same family).
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

Public repo: clone https://github.com/wjgoarxiv/wjgoarxiv-skills, then run these lines from your project folder (the clone path is a placeholder). One line each: check, move aside, copy, receipt. Or let LitCodex run the same steps: `litcodex extensions install readme-studio` shows the plan, `--yes` runs it, and `litcodex extensions check` names old or competing copies.

```bash
cx="${CODEX_HOME:-$HOME/.codex}"; p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/readme-studio" ] && echo "found: $d/readme-studio"; done; echo "check done"
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/readme-studio" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/readme-studio" ] && mv "$cx/skills/readme-studio" "$b/readme-studio" && echo "moved aside: $b/readme-studio"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/readme-studio" ]; then echo "stopped: $cx/skills/readme-studio still exists"; else mkdir -p "$cx/skills" && cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/readme-studio" "$cx/skills/readme-studio"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; [ -f "$cx/skills/readme-studio/SKILL.md" ] && printf '{"id":"readme-studio","source":"%s","variant":"litcodex","installed_at":"%s"}\n' "<path to your wjgoarxiv-skills clone>/variants/litcodex/readme-studio" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/readme-studio/.litfamily-extension.json"
```

A `found:` line under `${CODEX_HOME:-$HOME/.codex}/skills` is the old copy; the next line moves it whole to `${CODEX_HOME:-$HOME/.codex}/extension-backups/<date-time>/readme-studio`, which Codex does not read. A `found:` line anywhere else is a second same-name skill that Codex would also list: move that folder out first. The copy line stops on an occupied folder, so nothing nests or merges. Then start a **new Codex session**; the copy is listed as `readme-studio` beside this stub (`litcodex:readme-studio`). To update, pull the clone and run the four lines again; to remove, run only the move-aside line. LitCodex install and upgrades never write `${CODEX_HOME:-$HOME/.codex}/skills/`, so the copy outlives them.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `variants/litcodex/readme-studio` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim readme-studio ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
