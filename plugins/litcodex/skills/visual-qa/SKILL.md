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
stub_for: wjgoarxiv-skills plugins/design/skills/visual-qa/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · visual-qa** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. visual-qa makes a check of a built interface: states at several viewports, screenshots and a PASS, FAIL or BLOCKED receipt. It moved out of LitCodex into **wjgoarxiv-skills**, as `plugins/design/skills/visual-qa` in the `design` family. The id stays here so its routes still land: `$litcodex:visual-qa`, the picker, implicit visual checks and the visual steps of lit-loop, litwork and review-work.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `visual-qa` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/visual-qa/SKILL.md`) means the moved skill is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `visual-qa` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | visual-qa was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted visual-qa | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what visual-qa makes, that it moved to wjgoarxiv-skills (`plugins/design/skills/visual-qa`), and give the lines below unchanged. Building the page is frontend-ui-ux (same family).
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

wjgoarxiv-skills is **not published yet**: copy from a local clone (the path is a placeholder).

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/design/skills/visual-qa" "${CODEX_HOME:-$HOME/.codex}/skills/visual-qa"
```

Then start a **new Codex session**; the copy is listed as `visual-qa` beside this stub (`litcodex:visual-qa`). To remove it, delete `${CODEX_HOME:-$HOME/.codex}/skills/visual-qa`.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `plugins/design/skills/visual-qa` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim visual-qa ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
