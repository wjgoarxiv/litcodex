---
name: lit-diagram-drawer
description: Create diagrams for architecture and workflows; use frontend-ui-ux for interfaces, lit-schematic for equipment and lit-scientific-visualization for measured data.
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: lit-diagram-drawer
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/lit-diagram-drawer/SKILL.md
stub_for: wjgoarxiv-skills variants/litcodex/lit-diagram-drawer/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · lit-diagram-drawer** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. lit-diagram-drawer makes an architecture, workflow, sequence or concept diagram as checked HTML and SVG with PNG export. It moved out of LitCodex into **wjgoarxiv-skills**, in the `figures` family; its self-contained Codex edition is `variants/litcodex/lit-diagram-drawer`. The id stays here so its routes still land: `$litcodex:lit-diagram-drawer`, the picker, implicit diagram requests and the diagram row of the bare `lit` table.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `lit-diagram-drawer` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/lit-diagram-drawer/SKILL.md`) means the moved skill is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `lit-diagram-drawer` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | lit-diagram-drawer was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted lit-diagram-drawer | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what lit-diagram-drawer makes, that it moved to wjgoarxiv-skills (Codex edition `variants/litcodex/lit-diagram-drawer`), and give the lines below unchanged. Equipment drawings and data plots moved to the same family.
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

Public repo: clone https://github.com/wjgoarxiv/wjgoarxiv-skills, then copy (placeholder path):

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-diagram-drawer" "${CODEX_HOME:-$HOME/.codex}/skills/lit-diagram-drawer"
```

Then start a **new Codex session**; the copy is listed as `lit-diagram-drawer` beside this stub (`litcodex:lit-diagram-drawer`). To remove it, delete `${CODEX_HOME:-$HOME/.codex}/skills/lit-diagram-drawer`; to update, delete it and copy again (`cp -R` onto an existing folder nests the copy). LitCodex install and upgrades never write `${CODEX_HOME:-$HOME/.codex}/skills/`, so the copy outlives them.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `variants/litcodex/lit-diagram-drawer` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim lit-diagram-drawer ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
