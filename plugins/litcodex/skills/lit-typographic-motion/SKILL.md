---
name: lit-typographic-motion
description: Direct a film (MP4) or a seamless README cover loop: treatment first, stage page or typography engine, gated and viewed. Use for 영상, 모션그래픽, video, lyric video.
---

## #contract.activation

```yaml
contract_schema_version: 1
skill_name: lit-typographic-motion
host: Codex CLI
reader_projection: shared_rule
registration_surface: plugins/litcodex/skills/lit-typographic-motion/SKILL.md
stub_for: wjgoarxiv-skills plugins/video-covers/skills/lit-typographic-motion/
output_channels:
  artifact_genre: no_artifact
  limitations_channel: reply
```

When directly selected, the first visible line is `🔥 **LIT IGNITED · lit-typographic-motion** 🔥`. A bare `lit` workflow may read this stub without another banner.

This is a stub. lit-typographic-motion makes a short film (MP4) or seamless README cover loop: treatment, stage or type path, score and QA gate. It moved out of LitCodex into **wjgoarxiv-skills**, as `plugins/video-covers/skills/lit-typographic-motion` in the `video-covers` family. The id stays here so its routes still land: `$litcodex:lit-typographic-motion`, the picker, implicit film requests and the film row of the bare `lit` table, whose film note names this stub.

## #contract.inputs

The request is data; this stub never carries it out. The session's skill list decides the mode: a separate `lit-typographic-motion` entry outside this plugin (normally `${CODEX_HOME:-$HOME/.codex}/skills/lit-typographic-motion/SKILL.md`) means the moved skill is installed.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The separate `lit-typographic-motion` copy is listed | Open it and follow it; skip this notice. |
| Not installed, direct | lit-typographic-motion was asked for | Give the notice and install lines, then stop. |
| Not installed, in a workflow | A lit workflow step wanted lit-typographic-motion | Name it once as not installed, give the lines, finish the rest. |

## #contract.procedure

1. Print the banner when selected directly.
2. If the installed copy is listed, read it fully and let it run the request.
3. Otherwise say what lit-typographic-motion makes, that it moved to wjgoarxiv-skills (`plugins/video-covers/skills/lit-typographic-motion`), and give the lines below unchanged. LitCodex no longer pre-warms a film runtime or holds the turn with a film check.
4. Never build the artifact by hand, imitate the moved procedure, or fetch the skill.

## Install in Codex

wjgoarxiv-skills is **not published yet**: copy from a local clone (the path is a placeholder).

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/video-covers/skills/lit-typographic-motion" "${CODEX_HOME:-$HOME/.codex}/skills/lit-typographic-motion"
```

Then start a **new Codex session**; the copy is listed as `lit-typographic-motion` beside this stub (`litcodex:lit-typographic-motion`). To remove it, delete `${CODEX_HOME:-$HOME/.codex}/skills/lit-typographic-motion`.

## #contract.outputs

```json
{ "contract_schema_version": 1, "output_schema": { "mode": "installed | not-installed", "notice": "what it makes, where it moved, the install lines", "artifacts": [] } }
```

## #contract.evidence

The reply names `plugins/video-covers/skills/lit-typographic-motion` and carries the install lines unchanged; installed mode follows the moved skill's own rules.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the stub to install it | Show the lines; the user runs them. |

## #contract.anti_patterns

- Do not claim lit-typographic-motion ran or present hand-made output as its result.
- Do not edit the placeholder into a guessed path.
