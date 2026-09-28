# Scenes and the engine contract

This is the type path's scene reference; load it only when `treatment.json` says `path: type`. Every copy line is one shot of one of six original starter scenes, and the installed engine renders them. Films that need drawn subjects, shapes or diagrams take the stage path instead (`references/stage.md`). Do not edit the installed engine files during a session; they are pinned payload and a changed file would no longer match the product's recorded hashes.

## How the engine renders a frame

- Time `t` is the only input a frame depends on, together with fixed run parameters (seed, samples, shutter, scale, preset). Nothing reads the clock, an unseeded random source, or the network.
- Each timeline shot instantiates its scene once. A scene exposes a pure `render(frame)` that returns a display list (glyph outlines, strokes, rules, terminal furniture) and optional post overrides for that instant. The frame carries `t`, local time `lt`, progress `p` through the shot, the beat length and beat phase. Every internal beat is anchored to `lt` or `p`, never to a literal frame number.
- Node computes the display list and lays out type from real font outlines (opentype.js). Headless Chrome rasterizes the glyph layer, runs the preset's GLSL passes on half-float linear-light targets, averages the sub-frame samples, applies the post chain once and converts to sRGB once. The exact 8-bit bytes are read back through a fenced pixel-pack buffer.
- Sub-frame samples sit at fixed offsets: sample `i` of `N` is at `t + (shutter / fps) * ((i + 0.5) / N - 0.5)`, clamped at 0. The master uses 4 samples and a 0.5 shutter; stills and the perf run use 1. Post overrides come from sample `floor(N / 2)`.
- Post chain order is fixed: bloom and halation, chromatic aberration, tone shoulder, film grain, vignette, flash, shake and zoom, invert. Override fields keep fixed ranges (bloom, grain, vignette 0-1; fade 0-1 with 1 neutral; zoom above 0 with 1 neutral; invert is a boolean that may change only on a cut and must then hold 2 beats; each rise of flash above 0.1 counts as an event).
- A stateful scene (every terminalcore shot, because of CRT phosphor persistence) replays its shot from its first frame whenever a still or seek lands inside it, so a seeked frame is byte-identical to the same frame of the sequential film.

## The six starter scenes

| Scene | What it does | Brief cues |
| --- | --- | --- |
| `title-slam` | The hook. swiss-signal slams the line in over 180 ms from 1.04 scale with discrete Archivo width steps (wide to condensed) and a Hangul weight step from Regular to Bold at the landing, draws a hairline rule under it, and sets a small mono shot index only when `typePlan.showIndex` is true. terminalcore types it in with a caret; tidal drifts it into place. | First line by default. |
| `word-line` | A karaoke line: the whole line is visible in the pending tone and each 어절 or word turns to full colour on its reveal step. Split pieces keep their kerned positions. | Any sentence-like line. Korean works well here. |
| `kinetic-list` | Items slide in 48 px from the right on their reveal steps, each with a mono index; the block is set at 1.5 or 1.6 line height. | Three or more items separated by ` · `, `, ` or `; `. |
| `number-counter` | Counts from 0 to the figure in the line over 60% of the hold with the slam curve, right-aligned so the digits do not jitter, with the rest of the line as a label. | A short line built around one number, such as `1,280 listeners`. |
| `stroke-signature` | Writes the line with a single-stroke EMS face; pen travel follows each character's own time slice, never a fixed speed. | Only when a line object sets `"scene": "stroke-signature"`; Latin only. Choose a face with `"font": "ems-allure"` (default, connected script), `ems-felix`, `ems-osmotron`, `ems-readability` or `ems-tech`. |
| `end-card` | The sign-off line, a mono footer with `typePlan.filmName` only when that is the film's own name, and the film's one accent mark for a short window. | Last line by default when there are three or more lines. |

Set `"accent": true` on a line object to move the accent moment to that shot; otherwise the end card owns it. The accent appears for at most 9% of the film.

## Staging the copy in these scenes

- Give the hook its own line; a long hook wraps onto two lines at a smaller size, so let the next line carry the detail.
- Put the idea that needs the most reading time in a `word-line`; its hold grows with its syllables and words.
- Use one list and at most one counter; two counters in a row read as a dashboard, not a film.
- End on a line that can stand still: it becomes the poster-adjacent sign-off and the reduced-motion still shows its final frame.
- For mixed Korean and English copy, keep each language in whole 어절 or words; the engine picks faces per script run.

## Transitions and easing

Cuts are hard and land on the beat grid; there is no crossfade in the starter set, which keeps flashes at cuts to one transition. Easing uses one named set only: `slam` (the proven deceleration `cubic-bezier(0.16,1,0.3,1)`), `drift` (`cubic-bezier(0.37,0,0.63,1)`), `surge`, `exit` and a symmetric in-out. Entrances never start fully collapsed (the smallest entrance scale is 0.95 and the slam starts at 1.04). A deliberate spring overshoot exists in the engine's helpers but no starter scene uses it.

## GLSL passes

Every frame must be covered by at least one look-library pass that issued a draw; the swiss preset's `dither`, the terminal preset's `crt` and `dither`, and the tidal preset's `tidal-gradient` each run full-screen on every frame. Pass seeds are `fnv1a32("<runSeed>:<sceneId>:<shotIndex>:<pass>")` as a uint uniform; `swiss-grid` has no seed. Event schedules (glitch hits, tidal surges, the boot flicker) are precomputed per shot so that all sources together never exceed 2 events in any 1-second window of a shot. The caps: glitch at most 2.0 hits per second over at most 20% of the frame; surges at most 2 per second with attack and decay of at least 0.1 s; CRT flicker at most 0.06 peak to peak; dither reseeds once per shot; swiss-grid guides off; at most 2 terminal layers. On a software rasterizer the engine lowers samples to 1, halves tidal octaves (minimum 3), turns CRT persistence off and marks those passes `downgraded`.

## Outputs of a render

| Path in the output directory | Content |
| --- | --- |
| `film.mp4` | 1920x1080, 60 fps, H.264 CRF 16 with `-tune grain`, BT.709 matrix, `tv` range, `yuv420p`, `+faststart`; with the generated bed, or your supplied track fitted to the picture, as 256k AAC |
| `preview.webp` (or `preview.gif`) | Looping preview at most 3 MB: encoder `libwebp_anim`, then `img2webp`, then GIF; size ladder 960, 720 then 540 px wide at 30, 24 then 20 fps |
| `poster.png` | Midpoint of the first text shot, grain and noise off, at most 1 MB |
| `reduced-motion.png` | The final text shot's settled last frame, grain and noise off |
| `manifest.json` | The run manifest: preset, seed, fps, samples, renderer, Chrome flags, preview encoder, audio tier, BPM or beat grid, pass ranges, the canonical timeline, round |
| `render.jsonl` | One line per pass per frame (`draws`, uniforms) and one frame line per frame (`rgbaSha256`, text boxes, glyph ink, flash records) |
| `gate-report.txt` | The render report and every gate rule |
| `stills/` | One still at every shot's midpoint, a -6 / 0 / +6 strip at every cut, a 12-frame contact sheet, the poster frame and `manifest.json` with each file's hash; the look rounds read it |
| `sound/`, `sound-cues.json` | The muxed track and every cue against its cut |
| `.run/` | Staging exports, masks and contrast frames, perf and determinism records |
| `withheld/` | Present only after a flash FAIL: the exports as diagnostics, never deliverables |
