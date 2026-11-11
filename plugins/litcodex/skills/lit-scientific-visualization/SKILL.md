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
stub_for: wjgoarxiv-skills plugins/figures/skills/lit-scientific-visualization/
vendor_source: wjgoarxiv-skills plugins/figures/vendor/scientific-visualization/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. lit-scientific-visualization makes a publication-quality plot of measured data on the authored scientific-visualization source. It moved out of LitCodex into **wjgoarxiv-skills**, as `plugins/figures/skills/lit-scientific-visualization` in the `figures` family. The id stays here so its routes still land: the exact bare `lit-scientific-visualization` hook route, `$litcodex:lit-scientific-visualization` and the picker.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `lit-scientific-visualization` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/lit-scientific-visualization/SKILL.md`) means the moved skill is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `lit-scientific-visualization` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | lit-scientific-visualization was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted lit-scientific-visualization | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what lit-scientific-visualization makes, that it moved to wjgoarxiv-skills (`plugins/figures/skills/lit-scientific-visualization`), and give the lines below unchanged. Its authored source, `plugins/figures/vendor/scientific-visualization` in the same repository, is copied below into the vendor folder the skill reads.
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

wjgoarxiv-skills is **not published yet**: copy from a local clone (the path is a placeholder).

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/figures/skills/lit-scientific-visualization" "${CODEX_HOME:-$HOME/.codex}/skills/lit-scientific-visualization"
mkdir -p "${CODEX_HOME:-$HOME/.codex}/vendor"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/figures/vendor/scientific-visualization" "${CODEX_HOME:-$HOME/.codex}/vendor/scientific-visualization"
```

Then start a **new Codex session**; the copy is listed as `lit-scientific-visualization` beside this stub (`litcodex:lit-scientific-visualization`). To remove it, delete `${CODEX_HOME:-$HOME/.codex}/skills/lit-scientific-visualization` and the vendor folder copied with it.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `plugins/figures/skills/lit-scientific-visualization` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim lit-scientific-visualization ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
