# Style bibles and the type-path brief

Load this file only after `treatment.json` says `path: type`. On the type path the words are the film, so the engine's brief comes straight from the treatment: `film --out <dir>` reads `<dir>/treatment.json`, validates it, and builds the brief from `copy.lines`, `durationSec`, `typePlan` and `sound.tempo`. The style bible is a decision record you keep in your notes, not prose for the viewer. Everything here is original guidance written for this LitCodex engine; no other film's treatment, palette or scene list is reused.

## The brief file

You normally write no brief at all. `--brief brief.json` is an optional staging file that may only add per-line detail; its `lines` must be the treatment's `copy.lines`, in the same order, or the render exits 16 naming `copy.lines`.

| Source | Field | Meaning |
| --- | --- | --- |
| treatment | `copy.lines` | The film's copy, one shot per line, in order (1-8 lines, up to 160 characters each). |
| treatment | `durationSec` | The target length. Holds scale up to meet it; the reading floors are never cut, and when they force a longer film the gate WARNs and says by how much. |
| treatment | `sound.tempo` | The beat grid's BPM when the sound is generated, so cuts land on the bed's pulse. |
| treatment | `typePlan.preset` | `swiss-signal`, `terminalcore` or `tidal`. The report labels it "agent default" unless `typePlan.presetSource` is `user`, which you set only when the user named the style. |
| treatment | `typePlan.filmName` | The film's own name. It prints on the end card only when it is set; a working title or the request never prints. |
| treatment | `typePlan.showIndex` | `true` puts a shot counter on screen; it is off unless the film asks for one. |
| brief | `lines[]` objects | `{ "text": "...", "scene": "word-line", "accent": true, "font": "ems-tech" }` to pick a scene, the accent line or a stroke face for one line. |
| brief | `seed` | Run seed for every pass seed (uint32). Change it only to try a different noise field or hit schedule. |

When the user supplied the words, `copy.source` is `user` and every line is theirs, verbatim. When the request is type-led but brings no words (a title sequence for a named subject, for instance), write the lines from `subject.specifics` and list them in `inventions`; the reply labels them as examples. Long lines are fine: the reading floor lengthens the shot rather than shortening the words.

Scene assignment is automatic unless a line names `scene`: the first line becomes `title-slam`; with three or more lines the last becomes `end-card`; a line with three or more list items becomes `kinetic-list`; a short line built around one number becomes `number-counter`; everything else becomes the karaoke `word-line`. `stroke-signature` is chosen only explicitly and only for Latin text (Hangul falls back to `word-line`, because the EMS stroke faces have no Hangul).

## Preset auto-pick

The engine applies this table itself and prints the result in `gate-report.txt`; you apply the same table when writing the bible so the two agree. The first matching row wins. Latin keywords match whole words; Korean keywords match only at the start of a word, so they never fire inside a longer compound.

| The copy lines mention | Preset |
| --- | --- |
| 터미널, 해커 / terminal, hacker, CRT | `terminalcore` |
| 물결, 파도, 잔잔한, 흐름 / gradient, wave, tide, calm | `tidal` |
| none of the above | `swiss-signal` |

`system`, `status` and a bare `flow` are deliberately not keywords: they appear in briefs about payment systems or workflows that have nothing to do with a terminal or a tide. An explicit style from the user (in words, or `preset` in the brief) always wins. State the pick and its reason in your reply exactly as the report prints it.

## Style bible template

Write these fields before the first stills run. One line each is enough; the point is to make every later craft decision traceable.

1. Viewer and purpose: who watches, where (a README, a talk opener, a social clip) and what they should feel.
2. Message: one sentence.
3. Text hierarchy: which line is the hook, which lines are support, which is the sign-off.
4. Scripts: Hangul, Latin or mixed per line, and which voice each run takes.
5. Preset and reason.
6. Palette pairs in use and their contrast (the tables below give the computed ratios).
7. Motion tokens you rely on and why.
8. Shot list with the scene each line gets and the beat it lands on.
9. Pass stack (from the preset) and any risk it carries for flashes.
10. Reduced-motion composition: what the still shows.
11. Audio tier: text reading time, or a beat grid from the user's own file.
12. QA risks to look for in the stills: long Korean lines, tight holds, small type on a moving background.

## swiss-signal

An editorial print idiom: one ink, one bone, one teal signal, and a single gold moment.

| Role | Hex | Use |
| --- | --- | --- |
| background (ink) | `#0C0E13` | every frame |
| type (bone) | `#E9EBE4` | all primary type; 16.06:1 on ink |
| secondary | `#A3A8AE` | small machine labels (index, footer); clears 4.5:1 |
| pending | `#6B7078` | karaoke words not yet revealed; large type only (above 3:1) |
| signal (teal) | `#0F7A82` | list indices and counter figures at 32 px or more; 3.79:1 on ink, so never small body copy |
| accent (gold) | `#D9A441` | one short mark in one timeline entry, at most 10% of frames |
| rule (graphite) | `#4B5058` | swiss-grid hairlines |

Voices: Archivo display for Latin (static instances at widths 75/100/125 and weights 400/700/900; the title slams from wide to condensed in discrete width steps), PretendardGOV for Hangul (Regular for pending or body, Bold for display; never synthetically condensed or emboldened), MesloLGS NF for machine annotations. Motion tokens: `slam` 180 ms with the family's deceleration curve `cubic-bezier(0.16,1,0.3,1)`, entrance scale 1.04 settling to 1.0 (never growing from nothing), `hold` 600-900 ms of stillness after a hit, `snap-cut` 0 ms on the beat. Passes: `swiss-grid` draws real GLSL hairline rules on the 12-column, 24 px gutter, 96 px margin, 8 px baseline grid (debug guides stay off in every export), then a low-strength Bayer `dither` for a printed texture, then the common post chain. Anti-slop: centred fade-ins as the only move, one ease for every beat, glitch without a reason, any second signal hue, bloom on anything except the signal, and holds that feel stalled rather than deliberate.

## terminalcore

A terminal-interface look: dark navy, one phosphor signal, crisp window chrome, CRT optics.

| Role | Hex | Use |
| --- | --- | --- |
| background (navy) | `#05070A` | every frame |
| panel | `#0C1116` | window fill |
| type and signal (phosphor green) | `#39FF6A` | all display type; 15.07:1 on navy, 14.16:1 on the panel |
| grey | `#7C8B93` | list indices and pending words (large type only); 5.73:1 on navy before CRT optics |
| secondary (green) | `#39FF6A` | window labels and footers: small grey text measured under 4.5:1 once scanlines, 2 px dither cells and the corner vignette act on it |
| electric blue `#2FB6FF` | alternate signal | only if the user asks for blue; never both hues in one film |

Voices: Galmuri9 for Hangul pixel display (fetched at pre-warm; the bitmap-strike variant is never used because its outlines are empty), VT323 for Latin pixel display, MesloLGS NF for machine readouts. Galmuri and VT323 never share one line cell for cell: each run keeps its own face. Motion: `type-in` reveals characters linearly at 22 per second with a blinking caret block (1.2 Hz), a 250 ms `boot-flicker` at the start of the first shot whose amplitude stays inside the CRT flicker cap, and hard cuts on the beat. Passes, in order: `terminal-ui` (one Canvas2D layer: window, title bar, two meters, caret), `crt` (scanlines, barrel curvature, triad mask, a 3% flicker, phosphor persistence), Bayer `dither` at 2 px cells for a pixel grid, and a rare `glitch` whose hits land on word boundaries or beats. Phosphor persistence makes every terminalcore shot stateful: a seeked still replays its shot from the first frame so it matches the sequential film exactly. Anti-slop: falling code rain, neon purple haze, continuous glitch, mixing green and blue, pixel type too small for its grid.

## tidal

Calm flowing colour under large, quiet type.

| Role | Hex | Use |
| --- | --- | --- |
| background (indigo) | `#0E1420` | base of the field |
| type (off-white) | `#E8ECEF` | all type; 15.51:1 on indigo, 8.75:1 on teal, 8.19:1 on violet |
| gradient stop A (teal) | `#124559` | flow field |
| gradient stop B (violet) | `#4C3B6E` | flow field |
| secondary | `#AEB6BF` | list indices, footer, pending words |
| accent (coral) | `#E07856` | one punctuation mark in one entry, at most 10% of frames |

Voices: Archivo display at width 100 weight 700 for Latin, PretendardGOV for Hangul, MesloLGS NF for footnotes. Motion: `drift` uses `cubic-bezier(0.37,0,0.63,1)` over the reveal, with a small vertical settle so type rides the flow instead of snapping; a tidal `surge` brightens the field over at least 0.1 s attack and 0.1 s decay, at most once in any window budget. Passes: `tidal-gradient` (domain-warped fractal noise with a curl term, seeded per shot, 4 octaves), `swiss-grid` for layout hairlines with guides off, and `glitch` capped at 0.4 hits per second as rare punctuation. Anti-slop: spectrum cycling, heavy glow on the field, glitch as texture, blur through held type.

## Shared rules for every preset

- One signal cluster and at most one accent cluster per film (MO-C-29). Saturated means HSL saturation of 50% or more; fills smaller than 24x24 px do not count.
- The poster and the reduced-motion still are rendered with grain and random noise at 0; the Bayer dither stays.
- An explicit user style that is none of these three keeps the engine, the gate and the exports; describe how you mapped it to the nearest preset and which colours you could not honour.
