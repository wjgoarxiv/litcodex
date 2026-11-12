---
name: lit-docx
description: Word report or document in a named restrained direction or publisher profile, with a page gate. Use for 보고서, 기획서, 제안서, 문서, 워드.
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: lit-docx
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/lit-docx/SKILL.md
stub_for: wjgoarxiv-skills variants/litcodex/lit-docx/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · lit-docx** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. lit-docx makes a finished Word document (.docx) in a chosen direction or publisher profile, plus DOCX or PDF to Markdown and in-place edits. It is now a LitFamily extension, kept in **wjgoarxiv-skills** (`documents` family); its self-contained Codex edition is `variants/litcodex/lit-docx`. The id stays here so its routes still land: `$litcodex:lit-docx`, the picker, implicit document requests and the document row of the bare `lit` table.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `lit-docx` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/lit-docx/SKILL.md`) means the extension is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `lit-docx` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | lit-docx was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted lit-docx | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what lit-docx makes, that it is a LitFamily extension in wjgoarxiv-skills (Codex edition `variants/litcodex/lit-docx`), and give the lines below unchanged. A deck is lit-pptx (decks family); LitCodex no longer prepares an Office runtime.
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

Public repo: clone https://github.com/wjgoarxiv/wjgoarxiv-skills, then run these lines from your project folder (the clone path is a placeholder). One line each: check, move aside, copy, receipt. Or let LitCodex run the same steps: `litcodex extensions install lit-docx` shows the plan, `--yes` runs it, and `litcodex extensions check` names old or competing copies.

```bash
cx="${CODEX_HOME:-$HOME/.codex}"; p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/lit-docx" ] && echo "found: $d/lit-docx"; done; echo "check done"
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-docx" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/lit-docx" ] && mv "$cx/skills/lit-docx" "$b/lit-docx" && echo "moved aside: $b/lit-docx"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-docx" ]; then echo "stopped: $cx/skills/lit-docx still exists"; else mkdir -p "$cx/skills" && cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-docx" "$cx/skills/lit-docx"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; [ -f "$cx/skills/lit-docx/SKILL.md" ] && printf '{"id":"lit-docx","source":"%s","variant":"litcodex","installed_at":"%s"}\n' "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-docx" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/lit-docx/.litfamily-extension.json"
```

A `found:` line under `${CODEX_HOME:-$HOME/.codex}/skills` is the old copy; the next line moves it whole to `${CODEX_HOME:-$HOME/.codex}/extension-backups/<date-time>/lit-docx`, which Codex does not read. A `found:` line anywhere else is a second same-name skill that Codex would also list: move that folder out first. The copy line stops on an occupied folder, so nothing nests or merges. Then start a **new Codex session**; the copy is listed as `lit-docx` beside this stub (`litcodex:lit-docx`). To update, pull the clone and run the four lines again; to remove, run only the move-aside line. LitCodex install and upgrades never write `${CODEX_HOME:-$HOME/.codex}/skills/`, so the copy outlives them.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `variants/litcodex/lit-docx` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim lit-docx ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
