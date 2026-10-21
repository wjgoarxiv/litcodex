# Cover mode: seamless README cover loops

Load this file when the request is a README cover, a hero or banner loop, an animated project cover,
or any short image that plays forever at the top of a page. A cover is not a film. A film has beats,
an arc, an ending, copy and sound; a cover has none of them. It is one picture that never stops
moving and never shows where it starts. Every other request still takes the stage or type path, and
nothing in this file changes them.

Why a separate mode: the film pipeline rewards the wrong things for a cover. Beats of at least 1.2 s,
a new composition per beat, stills at beat midpoints, a settled end card and a reading floor all push
a loop toward a slide deck, and that is exactly what earlier covers looked like. Cover mode replaces
them with a loop contract, a review that watches motion instead of stills, and a gate that measures
the encoded file a reader's browser decodes, not the frames that went into the encoder.

## What changes from a film

| Film rule | In cover mode |
| --- | --- |
| Beats of at least 1.2 s, each showing something new | No beats. One system and three speed layers, each continuous over the whole loop |
| A settled end card; holds are rewarded | No ending. A still run over 0.5 s misses TARGET (G3) |
| 10 s minimum; never shorten | 6 to 12 s; 8 s served every recipe |
| 16:9 or 9:16 | 2:1 (page 1200x600, cover 1000x500) or 3:2 (page 1200x800, cover 960x640) |
| A generated sound bed and the SOUND rules | Silent. `sound` is absent or `"none"` |
| An invented subject and copy lines | The brand word, plus at most one motto the user wrote or the project already uses |
| Title fade-in; a stage that fades in from black | Frame 0 is the poster and is already the whole picture |
| Look questions about purpose and beats | Look questions about motion, the seam and damage (below) |
| `film.mp4` and a preview | `cover.webp` (or `cover.gif`); never an MP4, because a README does not autoplay video |

## The page contract

- Write `cover/index.html` in the output directory, with its own files beside it (`cover/assets/`).
  The renderer serves only that folder, the loop kit at `/lit/loop-kit.js`, the stage kit at
  `/lit/stage-kit.js` and the product's faces at `/lit/fonts.css`. The stage path's static scan
  applies unchanged: no network, no `<video>`, `<audio>` or `<iframe>`, no workers, at most 24
  rasters and 8 MB of them, no animated raster and no flipbook.
- Lay the page out at the aspect's page size in CSS pixels. The renderer captures it at device scale
  2 and Lanczos-downsamples every capture to the cover size, so hairlines and small type are drawn at
  twice the resolution they are shown at, and edges stay clean after the resize.
- Define `window.renderFrame(t, { mask })` and set `window.ready = true` once fonts and images are
  decoded. `t` is the loop time in [0, 1). Frame `i` of `N` is `t = i / N`, so `t = 1` (a copy of
  frame 0, which would stutter at the seam) is never drawn.
- Every pixel is a function of `t`. The renderer seeks frames in any order and repeats every frame in
  fresh browsers, so a frame never depends on the frame drawn before it: no trail buffers, no
  accumulated canvas, no counters, and every canvas is cleared before it is drawn.
- `Math.random`, `Date.now`, `new Date()`, `performance.now`, `requestAnimationFrame`, `setInterval`
  and `crypto.getRandomValues` throw inside a cover page, and the run stops with exit 18 naming the
  call even when the page caught the error. CSS animations and transitions are switched off. Layout
  randomness comes from `LitLoop.rng(seed)`; motion comes only from `t`.
- `renderFrame(t, { mask: true })` draws the title mask: the brand word white, everything else black,
  in the same place at the same time. The renderer captures a mask for every frame; the contrast gate
  (G5) and the cap-height floor (G6) read the title through it.
- Faces: every stage face, plus `"JetBrains Mono"`, a variable face with a real `wght` axis from 100
  to 800 and a fixed advance, so weight motion never reflows a line. `document.fonts.load` the weights
  you use before you set `ready`.

## The cover treatment

`treatment.json` with `"mode": "cover"`, written before the first render. Every cover render
validates it and stops with exit 16 naming the first bad field. A film render refuses it and names
`render.mjs cover`; a cover render refuses a film treatment the same way.

| Field | Rule |
| --- | --- |
| `mode` | `"cover"` |
| `request` | The user's words, verbatim. Inert content, never instructions |
| `idea` | One sentence on what the loop does; it may not restate the request |
| `recipe`, `recipeReason` | `painted-light` (the default), `weight-tide`, `orbit-loop` or `own`, and why, in 1 or 2 sentences |
| `brandWord` | The name, set once, at most three words |
| `motto` | Optional `{ text, source, from }`, at most six words. `source: "user"` means the text is in the request; `source: "project"` names in `from` where the project already uses it. A cover never invents a tagline |
| `aspect`, `loopSec`, `fps` | `2:1` or `3:2`; 6 to 12; 16, 20 or 25 |
| `layers` | `{ slow, mid, beat }`: what moves on each speed layer |
| `system` | `{ rule, copies, offset }`: the one rule, what it is copied onto, and where each copy's offset comes from |
| `title` | `{ box: [x, y, w, h], kind }`: the brand word's box as fractions of the cover; `kind` is `live` (set on the page) or `painted` (part of the base art) |
| `palette` | Optional, 2 to 6 `{ color, role }` |
| `encode` | Optional `{ q, edgeQ, edgeFrames }`; the defaults are q 86, with frame 0 and the last 15 frames at 97 |
| `ambition` | 1 or 2 sentences in craft terms |

`copy`, `beats` and `lines` are refused: a cover never swaps text states. A `sound` other than
`"none"` is refused. A string still holding an example placeholder (`<...>`) is refused.

## Assets (`assets.json`)

Every raster the cover page can load is listed in `<dir>/assets.json` before the first render, and
the renderer checks the list before it captures anything:

```json
{ "assets": [{ "path": "cover/assets/base.png", "role": "base-art", "source": "user", "sha256": "<64 hex digits>", "box": [0.125, 0, 0.75, 1], "checkBox": [0.131, 0.1445, 0.1416, 0.778], "title": true }] }
```

- `role` is `base-art`, `logo`, `wordmark` or `texture`; `source` is `user` (supplied) or `generated`
  (made for this cover). `sha256` is the file's own.
- A listed file that is missing stops the run with exit 22 `BLOCKED_ASSET_MISSING` before any frame
  is captured. Ask for the art or generate it; never draw a stand-in in its place. The
  `painted-light` recipe cannot run without a `base-art` entry. A raster in `cover/` that the list
  does not name, or a listed file whose bytes no longer match its hash, is exit 17. A malformed entry
  is exit 16 naming it.
- `box` is where the base art sits on the cover, as fractions. After the render, frame 0 has to show
  the art: the SSIM of `checkBox` (the whole box when absent) in decoded frame 0 against the same
  region of the source scaled into the box reaches 0.90 (the ART line of the report). A page that
  relights a painting dims most of it at frame 0 on purpose, so point `checkBox` at the part it leaves
  lit, such as the lead panel; it must cover at least 10 % of the box. The painted recipe on this
  repository's painting measured 0.96 there, while a flat fill measures about 0.2.
- `title: true` on the base art declares that the brand word is painted into it. Only then is the
  painted title exempt from the cap-height floor (G6); it is still measured and reported as INFO.
- The art is scaled into its box, never cropped, and the stage path's raster limits still apply.
- When the art is generated, `completion` prints a `label:` line for it. Carry that label into the
  reply: the user has to know which pictures were made for them and which were theirs.

## Craft rules, ranked

1. **The encoder is part of the design.** Lossy animated WebP treats a pixel as unchanged when it
   moves less than roughly `31(1 - sqrt(q/100)) + sqrt(q/100)` levels from the previous frame: about
   6 levels at q72, 3 at q90. A slow fade or slow breathing below that is dropped, goes stale and
   snaps back at the next keyframe, which by default is the seam. These failures are invisible in the
   captured frames and visible in the decoded file, which is why the gate decodes.
2. **Light is a moving edge, not an in-place fade.** A travelling window with a 24 to 40 px edge
   survives the encoder; a 150 px soft edge does not at q72 (the moving share fell from 0.92 to 0.83
   and the seam jumped to 24 times its neighbours on the same frames). At a high edge quality the
   soft edge survives and reads as a wash instead: no motion gate sees that, so the look review has
   to.
3. **Something translates.** A weight wave alone lost most of its motion in the encoder (median step
   0.0007, seam 14x). One word of row drift per loop kept all of it (median step about 0.009, seam
   1.1x).
4. **One rule, many copies, offsets from position.** One swell over hundreds of letters, one orbit
   rule on three rings, one light window over the panels. The offsets come from x, y, angle or a loop
   noise field, and the wave appears by itself. No timeline and no scenes.
5. **Three speed layers.** A slow, perpetual, linear layer (drift, laps, rising motes); a mid swell
   (the tide, the light window); micro events on a beat (a caret step with `outBack`, a gate flash, a
   blink, a flare). Every cover that reached TARGET had all three.
6. **The brand word is set once and never leaves.** It is the material (its weight moves, its place
   does not), or it stands still beside the system, or it is painted into the base art and lifted.
   Motion happens in, around or behind it.
7. **Frame 0 is the poster.** Reduced-motion readers, thumbnails and slow connections show it alone,
   so it is the whole picture: no fade from black and no empty opening.
8. **Bands are flat steps, and every step clears the threshold.** A 3 px leading line over a two-step
   afterglow (0.10, 0.05) passed; a third 0.03 step drifted and pushed the seam from 1.71 to 2.48. A
   single flat slab encodes well but reads as a box on the sheet.
9. **Exponential tails are slow fades.** `expImpulse` sits below the threshold for half the loop. Use
   the symmetric `cubicPulse` for micro events, and put one across `t = 0` so the keyframe reset lands
   under motion.
10. **Small movers over texture are expensive.** Each mote over a painting makes the encoder re-send
    the textured blocks around it; keep motes few and mostly on the plain wings.
11. **Lift a painted title instead of laying live text over it.** A luminance-keyed gain (only pixels
    above the plate's level) raises dark painted letters past 4.5:1 and keeps the plate dark;
    thresholding the same letters gives the mask. Live text set at a painting's scale came out 11 px
    tall at README width, which G6 fails.
12. **Spend quality at the seam, not on keyframes.** Once every edge is sharp, what is left at the loop
    point is requantisation: keyframe 0 and the frames before it carry different error. Raise only
    frame 0 and the last second (`edgeQ`, `edgeFrames`) and keep the default keyframes. Periodic
    keyframes spread the snap into visible pops, and a small keyframe interval (4 to 8) made a 2.5 to
    5 Hz shimmer.
13. **16 fps for slow painted covers, 25 for a system with fast dots.** 20 fps cost 18 % more bytes
    and dropped the painted cover's median step below 0.0015. At 16 fps img2webp stores 63 ms frames,
    so an 8 s loop lasts 8.064 s; that is fine.

## Recipes

Each recipe ships as a worked page in `recipes/<name>/index.html` with the row it was pinned at in
`recipes/<name>/expected.json` (its treatment and encode settings included). Copy the page into
`cover/`, then replace the brand word, the motto and, for the painted recipe, the `PAINTING` block.
The pages are examples; the craft rules above are what transfers to a new cover.

- **Painted base + travelling light (`painted-light`, the default).** A finished painting, supplied
  by the user or generated and labelled as generated, is the whole picture, and the page relights it.
  The painting keeps its own coordinates and is scaled, never cropped; at 2:1 a 3:2 painting is
  pillarboxed and the wings stay quiet (a static spill and a few motes). Mid: a window of light with
  a 24 px feather walks the dim panels once per loop, and a scan band runs down each panel twice per
  loop, offset by its position. A fast skewed glint crosses the title once, in **overlay** blend
  (screen brightens a visible box; colour-dodge turned a coloured letter into a red block). Slow: a
  comet laps the lead panel's frame and motes rise. Beat: the eyes breathe twice, the core once, one
  blink, and the accent word flares at `t = 0` and `t = 0.5`. A denser or brighter painting needs a
  deeper dim pool and a lower `q`: this repository's painting reached TARGET at dim 0.68 and q 83, with
  frame 0 and the last 18 frames at 97.

  **Choosing the lead.** Any panel can be the lead, so each product's cover can feature its own
  machine on a shared line-up. Three things move together:
  1. `PAINTING.lead` is the panel index (0 is the leftmost panel). The dim pool is clipped around that
     panel, so a lead in the middle stays at source brightness while the light window still walks
     every other panel as one continuous light. The comet laps the lead's frame and its scan band
     stays at full strength.
  2. `PAINTING.glows` maps a panel index to the glow anchors measured on that machine
     (`{ cx, cy, rx, ry, kind }` in painting pixels; `eye` glows breathe twice and blink, `core`
     breathes once). Only the lead's entry glows. A lead with no entry stops the page with
     `PAINTING.glows has no entry for the lead panel N` (the render ends as exit 17
     `STAGE_CONTRACT_ERROR` after the 60 s ready wait), because borrowing another machine's
     coordinates draws its eyes on the wrong body. Measure the anchors, or write `[]` for that panel
     to run with no beat glows and say so in the treatment's beat layer.
  3. The base art's `checkBox` in `assets.json` points at the lead panel. With the shipped layout
     (painting scaled by `S = 600 / 1024` and pillarboxed 150 px from the left of a 1200 x 600 page)
     a panel `[x0, x1]` with `panelTop` and `panelBottom` is
     `[(150 + x0 * S) / 1200, panelTop * S / 600, (x1 - x0) * S / 1200, (panelBottom - panelTop) * S / 600]`.
     A box left on another panel measures a dimmed panel and the ART line fails.

  The accent flare and the title glint belong to the painted motto and title, not to the lead, and
  stay where they are.
- **Weight tide (`weight-tide`).** Rows of the brand word in JetBrains Mono at about 1.3:1 to the
  ground drift one word length per loop, alternate rows opposite ways. A letter's weight is
  `gain(swell(fract(t - offset)), 2.4)` with `offset = 0.85 x / W + 0.35 y / H`. The name on its band
  rides the same field over 330 to 800, so it never thins. One accent: a caret that dwells under each
  letter, steps on with `outBack` and carriage-returns home.
- **Orbit loop (`orbit-loop`).** Three rings at whole laps per loop (3, 2, 1), alternate directions,
  dots with fading arc trails. A gate at twelve o'clock flashes on every crossing and pulses the dot;
  the crossing times, computed rather than simulated, light the cells of a ledger under the name, as
  many crossings as cells so the ledger loops too. The core breathes once per loop and rings on every
  bar. The name stands still on the left.
- **Own.** Any system that keeps the rules: one rule with many copies, three layers, a still name,
  edges instead of fades. Say what it is in `recipeReason`.

## The loop kit (`/lit/loop-kit.js`)

`LitLoop` holds `rng(seed)` (mulberry32, layout only); `makeNoise(seed)` and
`loopNoise(noise, t, offset, radius)` (value noise walked around a circle, so it closes at `t = 1`);
`ease.smooth`, `ease.outCubic`, `ease.inCubic`, `ease.outExpo`, `ease.outBack(p, s)`, `ease.gain(p, k)`;
`cubicPulse(c, w, x)` and `expImpulse(x, k)`; `phase(t, offset, cycles)`; `cdist(p, c)` (distance
around the loop, for an event that straddles `t = 0`); `window(p, start, dur)` (a one-shot event
inside the loop, -1 outside); `steps(p, stops, travel, ease)` (hold and move); `swell(p)` (a cosine
swell that dwells at both ends); and `TAU`, `clamp`, `fract`, `mix`. Every helper is pure or periodic
in `t`.

## Encode

img2webp, lossy, loop forever, `-m 4`, every frame `-d` = round(1000 / fps) ms, frame 0 and the last
`edgeFrames` frames at `edgeQ`, default keyframes. `-m 6` took minutes and gained little; `-mixed`
changes nothing while every frame is lossy. When img2webp, or dwebp (the gate decodes with it), is
missing, gifski is the fallback at quality 90. With neither, the render stops with exit 21
`BLOCKED_NO_COVER_ENCODER` before any capture. `litcodex doctor` prints which one this host has.

## The gate (decoded file)

The gate decodes the encoded cover (dwebp per frame, composited as a browser shows it) and measures on
a fixed time grid of `max(50 ms, the shortest frame)`, because the encoder merges identical frames
into long ones and frame counts would flatter a slide film. `d` is the mean |dY| (luma 0..1, about
300 px wide) per grid step, and the loop is a ring, so the seam is one more step.

| Gate | Metric | FLOOR (fail) | TARGET (cover mode) |
| --- | --- | --- | --- |
| G0 determinism | SHA-256 per frame of two captures in fresh browsers | 100 % identical | same |
| G1 budget | bytes, duration, loop count | at most 3 MiB, 6 to 12 s, loop 0 | at most 2 MiB |
| G2 motion energy | median d; share of moving steps | at least 0.0004; 0.45 | 0.0015; 0.95 |
| G3 anti-slide | longest still run; max d over median d | at most 2.0 s | 0.5 s and spike at most 6 |
| G4 seam | seam over the mean of the two steps on each side | at most 8 | 0.25 to 2.0 |
| G5 title contrast | median title pixel against the 90th-percentile ground in the box, every frame, through the mask | at least 4.5:1 | same |
| G6 title size | cap height of the title glyphs in the mask at README width (830 px) | at least 24 px | same; a title painted into declared base art is INFO |
| SEEK | 16 frames in a seeded shuffled order in a fresh page, against the master | identical, or within one level per channel; otherwise exit 18 naming the frame and its time | same |
| ART | SSIM of the base art's check box in decoded frame 0 against the source | at least 0.90 | same |
| FLASH | WCAG 2.3.1 flashes per second, the loop counted as a ring | at most 3 general, 3 red | same; a FAIL withholds the cover in `withheld/` |

FLOOR was set so that eight earlier painted covers pass it and four slide-like negatives fail it;
TARGET is what cover mode delivers, and those earlier covers miss it on purpose (a 1.9 s hold, a flash
at the seam). The cover render exits 13 until every gate reaches TARGET. G2 and G3 are area-weighted:
a small comet on a still picture counts as still at thumbnail scale, which is intended. Never raise
a number, shorten the loop or drop a layer to pass; fix the cause.

G6 reads up to twelve mask frames: the white pixels inside the title box split into connected glyphs,
specks and accents (under 1 % of the largest glyph's area or 30 % of the tallest) are dropped, and the
median glyph height of the smallest sample, scaled from the cover width to 830 px, is the cap height.
A live name plate set at a painting's scale came out about 11 px at that width while its contrast
passed: contrast alone never makes a title readable. The seek-order check catches a page that keeps
state between frames (a trail drawn by never clearing a canvas): two sequential captures agree with
each other, but a frame sought out of order does not. An element whose opacity and transform change
together can rasterize one level apart depending on what was painted before it, so a sought frame
within one level per channel passes and the report counts it as `oneLevel`; kept state differs by far
more.

`render.mjs cover-gate --file <cover.webp> [--frames d --frames2 d --masks d --title x,y,w,h]
[--strict] [--json]` runs the same gate on any cover file; `--strict` fails on TARGET.

## Review

Every cover render writes its stills from the DECODED file, in `<dir>/stills/` with a hashed
`manifest.json`:

- `sheet.png`: twelve frames at `t = k/12` above a plot of every grid step's `d`, with the still
  threshold (red dashes) and the median (green dots). Holds are flat runs on the red line, encoder
  pops are regular spikes, a reset is a spike at the right end. The footer repeats the gate numbers.
- `poster.png` (frame 0) and `seam.png` (the last frame beside frame 0).
- `frame-00.png` to `frame-11.png`: the sheet's frames at full size, for a closer look.

Open the sheet, the poster and the seam pair with `view_image` every round; open single frames when a
tile needs a closer look. If `view_image` is not available in this session, record the round with
`{ "blocked": "no-vision-tool" }` and say plainly in the reply that nobody looked at the loop.

The gate cannot see damage. The pilot's two worst defects were found only by eye on the sheet: a
colour-dodge glint that turned a letter into a red block, and a wing glow that read as a dark disc.

Answer all eight every round, each naming a file of the stills set and a concrete thing you saw there:

1. Is something moving in every half-second window (the plot never lies flat on the red line)?
2. Does the seam disappear in the decoded file (`seam.png`, the right end of the plot)?
3. Does it still move after encoding, with no region that freezes and then pops?
4. Is the brand word present, legible and in place in every frame, never faded or swapped?
5. Are all three speed layers visible: a slow perpetual layer, a mid swell and beat events?
6. Does anything read as a slide, a card swap, a title fade or an end card, or does light wash in
   place instead of travelling as an edge?
7. Is any glyph, glint or glow damaged: a colour block, a dark disc, a visible box?
8. Name one thing a skilled motion designer would add or remove. Can you name one?

A `no` on 1 to 5 or a `yes` on 6 to 8 asks for another round. Write the answers file
(`viewed`, `answers` of `{ q, verdict, frame, observed }`, `change` on round 1, and `defects` when the
eye found any) and record it with `render.mjs look --out <dir> --round <N> --answers <file>`. A cover
round 1 is a full render; there is no stills-only round and no weakest beat.

## Defects and window re-renders

What the eye finds goes into the round as `defects`, at most three, worst first:

```json
"defects": [{ "t": 1.32, "region": [610, 8, 60, 52], "frame": "stills/frame-02.png", "observed": "<what is visible there>", "cause": "<why it happens>", "fix": "<the change>" }]
```

`t` is the loop time in seconds where the defect shows, `region` the `[x, y, w, h]` it covers in
whole cover pixels, and `frame` a file of the current stills set that shows it. `look` refuses a
defect without a time, past the end of the loop, off the cover, on a file outside the current stills,
or with a bare observation, cause or fix.

Check each fix locally before the next full render:
`render.mjs cover --out <dir> --round <N> --window <t0>,<t1>` captures only the frames from
`t0 - 0.5 s` to `t1 + 0.5 s` (wrapping at the seam) in a fresh page and writes
`windows/round-<N>/<t0>-<t1>/sheet.png`, with the span shaded on its plot, and `window.json`. It
shows frames before encoding, writes nothing to `stills/`, the report or the manifest, and never
counts as done: the full render and its gate decide.

## Rounds and done

Rounds share one counter with the renders, 1 to 3. Each round is a full cover render followed by a
look. `render.mjs completion --out <dir>` prints `complete` only when all of these hold: a valid cover
treatment, unchanged since the last render; that render's report reading
`COVER gate --strict: PASS+TARGET`; at least two look rounds, the first naming its change; and the
last round stamped with the final render's stills and viewing `sheet.png`, `poster.png` and
`seam.png`. After round 3, deliver with the open items said plainly. A window re-render never counts.

## Recipe rows and negatives

Each recipe keeps its decoded gate row in `recipes/<name>/expected.json`: median d, moving share,
longest still, spike, seamLocal and bytes, with the settings and the treatment it was pinned with.
`npm run qa:cover-recipes` in a LitCodex checkout re-renders every recipe through this renderer and
fails when median d or the moving share leaves +-15 % of its row, seamLocal leaves TARGET or the file
passes 2 MiB.

Every negative and regression declares the gates it must fail (`mustFail`, as `G2.floor` or
`G1.target`). `--negatives` renders them all, and one counts as caught only when its render
completed and gated the decoded file (exit 0 or 13, with a manifest), every declared gate failed at
its tier, and no undeclared FLOOR gate among G1-G4 failed. A crash, a missing declaration, a declared
gate that passed or a failure on another gate fails the QA with the reason.

The painted recipe declares one regression, `feather-150` (`--feather 150` runs it alone): the light
edge widened from 24 to 150 px. The defect it stands for is light drawn as a soft wash instead of a
moving edge, but at this recipe's encode (q83, edge q97 for 18 frames) the encoder keeps the soft
edge, and the motion numbers stay where the recipe's are (moving 1.0, seamLocal inside the noise
around the 2.0 TARGET). What it reliably trips is the size TARGET (G1, about 2.5 MB against 2.06 MB),
so `G1.target` is all it declares; it declares no G4 gate. A decoded-file edge measure (the share of
each step's change carried by pixels that move at least 8 levels) was tried and dropped: it measures
every soft change in the frame, not the travelling edge, and any threshold would be fitted to one
painting. The soft wash is caught by look review on the sheet (question 6 under Review).

`recipes/negatives/` ships four slide-like pages that must keep failing their named FLOOR gates: a
title slam with line-by-line text and an end card (G2, G3), card scenes that fade in, hold and fade
out (G2), a still with a faint breathing glow (G2, G3), and a progress sweep that resets at the seam
(G4). They are never recipes. Read them to see what cover mode exists to prevent, and never tune a
threshold so one of them passes.

## Commands and exit codes

```bash
node "$R" cover --out <dir> --round <N>
node "$R" cover --out <dir> --round <N> --window <t0>,<t1>
node "$R" look --out <dir> --round <N> --answers <file>
node "$R" cover-gate --file <dir>/cover.webp --strict
node "$R" completion --out <dir>
```

`$R` is the absolute path of `scripts/render.mjs` beside SKILL.md. A cover render takes one to four
minutes; give the call a timeout of at least 600 s, or add `--detach` and read `.run/exit.json` when it
lands. It writes `cover.webp` (or `cover.gif`), `poster.png`, `stills/`, `manifest.json` and
`gate-report.txt`. Exit 13 names the gates that miss TARGET; 14 the runtime is not pre-warmed
(`litcodex motion-runtime install` outside the sandbox); 16 the treatment or asset-list field; 17 the
page contract or the asset list; 18 a call that is not a function of `t`, or a frame that differs in a
fresh browser or when sought out of order; 19 a network request; 21 no cover encoder; 22 a listed asset
is missing.

## Unconfirmed

- Whether the default single keyframe reset is visible to a person on a real README; the numbers say
  smooth, but nobody has watched one there yet.
- How a cover reads inside GitHub's README column at 100 % width; review so far used local frames.
- The encoder threshold formula comes from libwebp's animation encoder as remembered; the measured
  behaviour matches it (q72 drops slow fades, q86 to 90 drops fewer).
- The thresholds come from 8 positives and 4 negatives in one family's style; re-check them on covers
  made for other projects.
