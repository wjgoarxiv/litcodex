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

This is a stub. readme-studio makes a factual project README with an inspected cover and an optional motion cover. It moved out of LitCodex into **wjgoarxiv-skills**, in the `video-covers` family; its self-contained Codex edition is `variants/litcodex/readme-studio`. The id stays here so its routes still land: `$litcodex:readme-studio`, the picker and implicit README requests.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `readme-studio` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/readme-studio/SKILL.md`) means the moved skill is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `readme-studio` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | readme-studio was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted readme-studio | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what readme-studio makes, that it moved to wjgoarxiv-skills (Codex edition `variants/litcodex/readme-studio`), and give the lines below unchanged. A motion cover is lit-typographic-motion's cover mode (same family).
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

wjgoarxiv-skills is **not published yet**: copy from a local clone (the path is a placeholder).

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/readme-studio" "${CODEX_HOME:-$HOME/.codex}/skills/readme-studio"
```

Then start a **new Codex session**; the copy is listed as `readme-studio` beside this stub (`litcodex:readme-studio`). To remove it, delete `${CODEX_HOME:-$HOME/.codex}/skills/readme-studio`; to update, delete it and copy again (`cp -R` onto an existing folder nests the copy). LitCodex install and upgrades never write `${CODEX_HOME:-$HOME/.codex}/skills/`, so the copy outlives them.

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
