# The stage path

Load this file after `treatment.json` says `path: stage`. On the stage path you are the motion designer and the renderer is the camera: you author the film as a web page, `stage/index.html` in the output directory, and `node "$R" stage --out <dir>` steps the page on a virtual clock, captures every frame in a headless Chrome, encodes the pinned MP4, and runs the gate. You never need a type-path reference here.

## What you write

```
<out>/
  treatment.json        the plan (references/treatment.md)
  stage/
    index.html          the film
    *.svg *.png *.jpg *.webp *.js *.css *.wav   your own local assets
```

Assets are your own work: SVG you draw, small rasters you make as textures or stills, your own scripts and styles, and, when the treatment's sound is `authored`, a WAV you wrote. Never install, download or copy a third-party library into `stage/`; use the kit below and your own code. The renderer refuses:

- `<video>`, `<audio>`, `<iframe>`, `<object>`, `<embed>`, `<frame>` (exit 17);
- `new Audio()`, `AudioContext`, `OfflineAudioContext`, workers and service workers (exit 17);
- `WebSocket`, `WebTransport`, `RTCPeerConnection`, `EventSource`, any absolute or protocol-relative URL other than an XML namespace, and preconnect or prefetch links (exit 19);
- more than 24 raster images or 8 MB of rasters, 10 or more rasters of one size (a flipbook), and any animated GIF, APNG or WebP (exit 17). Rasters are textures and stills, never a frame sequence;
- any file type outside html, js, mjs, css, svg, png, jpg, webp, gif, wav, woff, woff2, ttf, otf and json, a `node_modules` folder, and links that leave `stage/` (exit 17).

The page loads two product routes:

```html
<link rel="stylesheet" href="/lit/fonts.css">
<script src="/lit/stage-kit.js"></script>
```

`/lit/fonts.css` declares this product's verified faces with `font-display: block`: `"Archivo"` (weights 400, 700, 900; `font-stretch` 75 %, 100 %, 125 %), `"PretendardGOV"` (400, 700) for Hangul, `"VT323"`, `"Galmuri9"` and `"MesloLGS NF"`. Name only these families; any other face is a system fallback the text check reports.

## The contract

Declare the film once, synchronously while the page loads:

```html
<script>
const COPY = { hook: "<line>", close: "<line>" };
LitStage.define({ width: 1920, height: 1080, fps: 60, duration: 12, render(t) { /* draw frame t */ } });
</script>
```

- `width` and `height` are exactly 1920 x 1080 for 16:9 or 1080 x 1920 for 9:16, matching `format`.
- `fps` is 60; 30 only when the treatment sets `"fps": 30`.
- `duration` is the film's length in seconds. The gate fails a film more than 10 % away from `durationSec`.
- `render(t)` draws the frame at time `t` seconds. Compute everything from `t`; never keep a running total that depends on how often `render` ran.

Keep every on-screen word in one `COPY` object at the top of `index.html`, so a later change is one edit. The reply tells the user where it lives.

CSS animations and transitions, the Web Animations API (including `finished.then` chains), SVG SMIL, `setTimeout`, `setInterval`, `requestAnimationFrame` loops with Canvas2D or WebGL all work: the renderer drives them from the same virtual clock. `Date`, `performance.now()`, `document.timeline.currentTime` and `Math.random()` read that clock and a seed taken from the treatment. Anything else that varies between runs (`performance.timeOrigin`, `crypto.getRandomValues`, reading real time any other way) breaks determinism and the render exits 18 naming the frame and the region that differed.

Mark text so the checks can find it:

```js
LitStage.text(document.querySelector("#hook"));                 // copy (default)
LitStage.text(document.querySelector("#label"), { decor: true }); // illustrative text inside the drawn subject
LitStage.text({ content: "7 min", x: 820, y: 400, w: 180, h: 60 }); // canvas or WebGL text, call inside render(t)
```

Copy is held to contrast, title-safe and reading time; decor text drawn inside the subject is not, but it may never carry a copy line.

## How a frame is made

For frame `f`, `t = f / fps`. The renderer sets the clock, sets every running animation's current time from when it first appeared, finishes animations that crossed their end (so `finished` promises resolve), runs due timers and then `requestAnimationFrame` callbacks, calls `render(t)`, registers any animation the frame created (a transition started by a timer at 2 s is born at 2 s), lays out, waits for fonts and image decodes and two native frames, and captures the surface. Before frame 0 every product face is loaded and every raster in `stage/` is decoded, so the first frame never shows a fallback font or a blank image.

Pages must declare the film at load. A `define` hidden behind a timer never runs, because timers only run while the renderer steps.

## The kit

`LitStage` holds motion primitives only. It has no scene, layout, object or copy for any subject: you draw what the treatment calls for.

**Eases.** `LitStage.ease.<name>(p)` for `linear`, `in/out/inOut` + `Quad`, `Cubic`, `Quart`, `Quint`, `Sine`, `Expo`, `Back`, plus `slam`, `drift`, `snap` and `anticipate`. `LitStage.cubicBezier(x1, y1, x2, y2)` builds your own.

```js
el.style.opacity = LitStage.ease.outCubic(p);
```

**Windows.** `LitStage.at(t, start, dur, ease)` is progress 0..1 of a window; `LitStage.remap(t, a, b, from, to, ease)` maps a range.

```js
const p = LitStage.at(t, 2.4, 0.6, "outQuart");
```

**Spring.** `LitStage.spring(t, { from, to, stiffness, damping, mass, velocity })` is an analytic damped spring, exact at any `t`.

```js
el.style.transform = `scale(${LitStage.spring(t - 1.2, { from: 0.8, to: 1, stiffness: 180, damping: 14 })})`;
```

**Keyframes.** `LitStage.kf(t, [{ t, v, ease }])` interpolates numbers, arrays or `#RRGGBB` colours; the ease on a key shapes the segment ending there.

```js
const x = LitStage.kf(t, [{ t: 0, v: -200 }, { t: 1.5, v: 640, ease: "outBack" }, { t: 4, v: 700 }]);
```

**Sequencing.** `LitStage.seq([{ name, dur, gap }])` lays segments end to end; `LitStage.stagger(i, { each, from, count })` spaces items.

```js
const s = LitStage.seq([{ name: "in", dur: 0.8 }, { name: "hold", dur: 2 }, { name: "out", dur: 0.6 }]);
const delay = LitStage.stagger(i, { each: 0.06, from: "center", count: n });
```

**Seeded randomness.** `LitStage.rand(seed)` returns a generator with `.range(lo, hi)` and `.pick(list)`; the same seed gives the same sequence in every run.

```js
const r = LitStage.rand("layer-2"); const dots = Array.from({ length: 80 }, () => [r.range(0, 1920), r.range(0, 1080)]);
```

**Text splitting.** `LitStage.splitText(el, { by: "grapheme" | "word" | "eojeol" })` wraps units in inline-block spans (Intl.Segmenter; `eojeol` keeps Korean 어절 whole) and returns them.

```js
LitStage.splitText(hook, { by: "eojeol" }).forEach((w, i) => { w.style.opacity = LitStage.at(t, 0.3 + i * 0.12, 0.4); });
```

**Path draw.** `LitStage.drawPath(pathEl, p)` reveals an SVG stroke from 0 to `p` of its length.

```js
LitStage.drawPath(stroke, LitStage.at(t, 1, 2, "inOutSine"));
```

**Morph.** `LitStage.morph(fromD, toD, { points })` returns `p => d`. Both paths are normalized to cubics (lines, quadratics and arcs included), resampled by arc length, and closed shapes are rotated to the best start point. Multi-subpath morphs are unsupported and throw; morph one subpath, and cross-fade or mask the rest.

```js
const m = LitStage.morph(shapeA, shapeB); shape.setAttribute("d", m(LitStage.at(t, 3, 1.2, "inOutCubic")));
```

**Masks and clips.** `LitStage.clip.circle(el, p, { x, y })`, `.inset(el, top, right, bottom, left, round)`, `.wipe(el, p, "right" | "left" | "up" | "down")`, `.polygon(el, points)` and `LitStage.maskSweep(el, p, { angle, softness })`.

```js
LitStage.clip.wipe(panel, LitStage.at(t, 5, 0.5, "snap"), "up");
```

**Colour.** `LitStage.mix(a, b, p)` mixes `#RRGGBB` colours in linear light; `LitStage.alpha(hex, a)` gives an `rgba()` string.

```js
document.body.style.background = LitStage.mix(palette.dusk, palette.night, LitStage.at(t, 8, 3));
```

## Craft on the stage

Build the film beat by beat from the treatment: each beat's `onScreen` is a drawing you make, its `motion` is a curve you choose, and its `sound` is a moment the cut lands on. Draw the subject with SVG, Canvas or CSS shapes in layers (a far layer, the subject, a near layer) and move them at different rates for depth. Change the transition from beat to beat: a match cut on a shape that carries over, a mask wipe, a morph from one form to the next, a push, a hard cut on the pulse. Give type a clear hierarchy (one line leads, the rest support) and let it enter with its own ease rather than a shared fade. Every beat should show something the previous one did not.

Plan at the frame's real size. Title-safe is the central 90 % of the frame (5 % inset each side) and action-safe the central 95 %; keep copy inside title-safe in 9:16 too, where the safe box is tall and narrow. Contrast is judged at the frame's scale (short edge / 1080), and "large" text starts at 3 % of the short edge (32 px at 1080).

Keep flashes out: no full-frame colour swap in one frame, no strobing, no more than three light-dark alternations in any second. The flash audit is a hard fail and withholds the film.

## Commands and outputs

```
node "$R" stage --out <dir> --stills-only --round 1   # stills set only, no encode (seconds)
node "$R" look  --out <dir> --round 1 --answers <file>  # record what you saw (references/quality-gate.md)
node "$R" stage --out <dir> --round 2                  # full render; give the call at least 600 s
node "$R" gate  --out <dir>                            # recheck without rendering
```

`--detach` runs a full render in the background and writes `<dir>/.run/progress.json`; poll that file instead of shortening the film to save time.

Every render writes `stills/`: one full-size midpoint still per beat (`beat-NN.png`), a transition strip per cut (`cut-NN-MM.png`, frames -6 / 0 / +6), a 12-frame `contact-sheet.png`, `poster.png` and `manifest.json` with each file's hash. A full render adds `film.mp4`, `preview.webp` (or `.gif`), `poster.png`, `reduced-motion.png` (the final beat's midpoint), `manifest.json`, `render.jsonl` and `gate-report.txt`.

The gate checks the flash audit on the master and the looping preview (the audit grid transposes to 180 x 320 cells for 9:16), the exact frame size, fps and duration against the treatment, file sizes, the reduced-motion still, near-black runs, and determinism: 8 to 16 frames (frame 0, the last frame, every beat's first frame) are re-captured in a fresh Chrome replaying the clock from 0 and compared by the SHA-256 of the decoded pixels.

## Exit codes on this path

| Exit | Meaning | What to do |
| --- | --- | --- |
| 10 | Chrome missing or failed to launch | Report it and the command that fixes it |
| 11 | The page asked for WebGL and got none | Draw without WebGL or report the state |
| 12 | No ffmpeg: the stills set was written | Install ffmpeg outside the session |
| 13 | A gate rule failed | Fix the named cause and render the next round |
| 14 / 15 | Runtime or fonts not pre-warmed / pin mismatch | `litcodex motion-runtime install` outside the sandbox |
| 16 | Treatment invalid (field named) | Fix that field |
| 17 | Stage contract (element, API, asset, size, define) | Remove or redraw the named thing |
| 18 | Nondeterministic frame (frame and region named) | Replace the leaking source with `t` or `LitStage.rand` |
| 19 | Network request or connection | Make the asset local |
| 20 | Sound invalid | See the sound plan in the treatment |
