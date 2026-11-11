---
name: lit-pptx
description: PowerPoint slides and presentations from Markdown in a named design direction, with layout QA. Use for decks, PPTX, 발표자료, 슬라이드, 피피티.
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: lit-pptx
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/lit-pptx/SKILL.md
stub_for: wjgoarxiv-skills plugins/decks/skills/lit-pptx/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · lit-pptx** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. lit-pptx makes an editable PowerPoint deck (.pptx) from Markdown slide source, with native charts, embedded fonts and a layout QA gate. It moved out of LitCodex into **wjgoarxiv-skills**, as `plugins/decks/skills/lit-pptx` in the `decks` family. The id stays here so its routes still land: `$litcodex:lit-pptx`, the picker, implicit deck requests and the slides row of the bare `lit` table.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `lit-pptx` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/lit-pptx/SKILL.md`) means the moved skill is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `lit-pptx` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | lit-pptx was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted lit-pptx | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what lit-pptx makes, that it moved to wjgoarxiv-skills (`plugins/decks/skills/lit-pptx`), and give the lines below unchanged. A Word report is lit-docx (documents family).
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

wjgoarxiv-skills is **not published yet**: copy from a local clone (the path is a placeholder).

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/decks/skills/lit-pptx" "${CODEX_HOME:-$HOME/.codex}/skills/lit-pptx"
```

Then start a **new Codex session**; the copy is listed as `lit-pptx` beside this stub (`litcodex:lit-pptx`). To remove it, delete `${CODEX_HOME:-$HOME/.codex}/skills/lit-pptx`.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `plugins/decks/skills/lit-pptx` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim lit-pptx ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
