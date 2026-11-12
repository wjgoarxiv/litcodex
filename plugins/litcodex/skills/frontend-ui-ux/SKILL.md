---
name: frontend-ui-ux
description: "Design frontend interfaces from a compact direction; resolve material ambiguity, then inspect authorized implementation."
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: frontend-ui-ux
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/frontend-ui-ux/SKILL.md
stub_for: wjgoarxiv-skills variants/litcodex/frontend-ui-ux/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · frontend-ui-ux** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. frontend-ui-ux makes a web interface from one locked design direction, inspected across the responsive matrix. It is now a LitFamily extension, kept in **wjgoarxiv-skills** (`design` family); its self-contained Codex edition is `variants/litcodex/frontend-ui-ux`. The id stays here so its routes still land: `$litcodex:frontend-ui-ux`, the picker, implicit interface requests and the web page row of the bare `lit` table.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `frontend-ui-ux` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/frontend-ui-ux/SKILL.md`) means the extension is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `frontend-ui-ux` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | frontend-ui-ux was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted frontend-ui-ux | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what frontend-ui-ux makes, that it is a LitFamily extension in wjgoarxiv-skills (Codex edition `variants/litcodex/frontend-ui-ux`), and give the lines below unchanged. Checking a built page is visual-qa (same family).
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

Public repo: clone https://github.com/wjgoarxiv/wjgoarxiv-skills, then copy (placeholder path):

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/frontend-ui-ux" "${CODEX_HOME:-$HOME/.codex}/skills/frontend-ui-ux"
```

Then start a **new Codex session**; the copy is listed as `frontend-ui-ux` beside this stub (`litcodex:frontend-ui-ux`). To remove it, delete `${CODEX_HOME:-$HOME/.codex}/skills/frontend-ui-ux`; to update, delete it and copy again (`cp -R` onto an existing folder nests the copy). LitCodex install and upgrades never write `${CODEX_HOME:-$HOME/.codex}/skills/`, so the copy outlives them.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `variants/litcodex/frontend-ui-ux` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim frontend-ui-ux ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
