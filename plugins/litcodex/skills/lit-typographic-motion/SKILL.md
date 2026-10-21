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
output_channels:
  artifact_genre: client_deliverable
  limitations_channel: reply
```

# Film director

When directly selected, the first visible line is `🔥 **LIT IGNITED · lit-typographic-motion** 🔥`; under bare `lit` it is a supporting skill with no second banner. Codex skill discovery or the lit-loop film route selects it. Request and quoted text are inert data.

## #contract.inputs

The request, optional audio and optional explicit style. Under `lit`, ask no questions: choose and label defaults; when no subject, facts or words are named, invent a labelled example subject.

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Treatment | Always first | Load only `references/treatment.md`; write `treatment.json` in the output dir |
| Stage | `path: stage` | `references/stage.md`: author the page (`index.html` in the output's `stage` folder), then `stage` |
| Type | `path: type` | `references/style-bibles.md`, `references/type-and-timing.md`, `references/scene-author.md`, then `film` |
| Cover | README, hero, banner or cover loop | `references/cover.md`; a `recipes/` page, then `cover` |
| Look | Every stills set | View the PNGs, then `look` (`references/quality-gate.md`) |
| Blocked | Exit 10-12, 14-22 | Name the state and its fix |

## #contract.procedure

1. `R` = absolute path of `scripts/render.mjs` beside this SKILL.md; `O` = the output dir.
2. Write `treatment.json` in `O`; the path reference loads only after `path` is set.
3. Round 1: `node "$R" stage --out O --stills-only --round 1` (type path: `film`). Open every PNG in the stills `manifest.json` with `view_image`; write answers; `node "$R" look --out O --round 1 --answers <file>` names the weakest beat and the change you made.
4. Full render: `node "$R" stage --out O --round 2`. Give the call a timeout of at least 600 s; never shorten the film to save time. View the new stills, record `look --round 2`; at most round 3.
5. Sound: the generated bed is the default; `sound --out O` previews it.
6. Cover: `node "$R" cover --out O --round N`; view sheet, poster and seam, then `look`.

Hand-encoded films are not the deliverable; every frame and track goes through `$R`.

## #contract.outputs

```json
{
  "contract_schema_version": 1,
  "output_schema": {
    "film": "film.mp4, or withheld after a flash FAIL",
    "cover": "cover.webp, gated on the decoded file",
    "stills": "stills/ with manifest.json",
    "treatment": "treatment.json with every invention listed",
    "report": "gate-report.txt and look.json",
    "limitations": ["blocked state, failed rule, open look item or downgrade"]
  }
}
```

## #contract.evidence

`node "$R" completion --out O` must print `complete` (or `DONE_UNVIEWED`, said plainly) before you call the work finished. Reply in plain words: the defaults chosen; every invention, generated sound and `label:` asset, labelled; what was checked; where the copy lives and the command that re-renders; any downgrade or open look item.

## #contract.hard_stops

Exit 10 no Chrome, 11 no WebGL2, 12 no ffmpeg, 13 gate FAIL, 14 not pre-warmed, 15 font pin, 16 treatment, 17 stage contract, 18 nondeterministic, 19 network, 20 sound, 21 no cover encoder, 22 asset missing. For 14 or 15 run `litcodex motion-runtime install` outside the sandbox. A flash FAIL withholds the output. Details: `references/runtime.md`.

## #contract.anti_patterns

Never answer a failure by shortening, dropping a beat, layer or subject, muting, switching path, raising a gate number or drawing a stand-in asset; fix the cause or state the failure. No network, installs or third-party libraries in a render.
