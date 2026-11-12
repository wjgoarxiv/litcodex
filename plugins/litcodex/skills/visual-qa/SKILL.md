---
name: visual-qa
description: "Validate material visual evidence. Use for visual QA or an exact blocked receipt."
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: visual-qa
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/visual-qa/SKILL.md
stub_for: wjgoarxiv-skills variants/litcodex/visual-qa/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · visual-qa** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. visual-qa makes a check of a built interface: states at several viewports, screenshots and a PASS, FAIL or BLOCKED receipt. It is now a LitFamily extension, kept in **wjgoarxiv-skills** (`design` family); its self-contained Codex edition is `variants/litcodex/visual-qa`. The id stays here so its routes still land: `$litcodex:visual-qa`, the picker, implicit visual checks and the visual steps of lit-loop, litwork and review-work.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `visual-qa` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/visual-qa/SKILL.md`) means the extension is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `visual-qa` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | visual-qa was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted visual-qa | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what visual-qa makes, that it is a LitFamily extension in wjgoarxiv-skills (Codex edition `variants/litcodex/visual-qa`), and give the lines below unchanged. Building the page is frontend-ui-ux (same family).
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

Public repo: clone https://github.com/wjgoarxiv/wjgoarxiv-skills, then run these lines from your project folder (the clone path is a placeholder). One line each: check, move aside, copy, receipt.

```bash
cx="${CODEX_HOME:-$HOME/.codex}"; p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/visual-qa" ] && echo "found: $d/visual-qa"; done; echo "check done"
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/visual-qa" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/visual-qa" ] && mv "$cx/skills/visual-qa" "$b/visual-qa" && echo "moved aside: $b/visual-qa"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/visual-qa" ]; then echo "stopped: $cx/skills/visual-qa still exists"; else mkdir -p "$cx/skills" && cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/visual-qa" "$cx/skills/visual-qa"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; [ -f "$cx/skills/visual-qa/SKILL.md" ] && printf '{"id":"visual-qa","source":"%s","variant":"litcodex","installed_at":"%s"}\n' "<path to your wjgoarxiv-skills clone>/variants/litcodex/visual-qa" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/visual-qa/.litfamily-extension.json"
```

A `found:` line under `${CODEX_HOME:-$HOME/.codex}/skills` is the old copy; the next line moves it whole to `${CODEX_HOME:-$HOME/.codex}/extension-backups/<date-time>/visual-qa`, which Codex does not read. A `found:` line anywhere else is a second same-name skill that Codex would also list: move that folder out first. The copy line stops on an occupied folder, so nothing nests or merges. Then start a **new Codex session**; the copy is listed as `visual-qa` beside this stub (`litcodex:visual-qa`). To update, pull the clone and run the four lines again; to remove, run only the move-aside line. LitCodex install and upgrades never write `${CODEX_HOME:-$HOME/.codex}/skills/`, so the copy outlives them.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `variants/litcodex/visual-qa` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim visual-qa ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
