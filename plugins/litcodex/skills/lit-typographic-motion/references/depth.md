# Depth: the 3D route

Read this when the treatment's subject is a `depth3d` device (`depth: "3d"`), when a film asks for
path-traced light (`render3d: "blender"`), or when a cover takes the `hero-3d` recipe. A 3D object is
the right subject when the film is about a thing that has a back and an inside: a product that turns,
opens, unfolds or is assembled. A flat diagram, a chart or a line of type does not need it; keep those
on the 2D page, where every frame is cheaper and the gates read the DOM directly.

## When 3D, and which kind

| The subject | Take |
| --- | --- |
| A diagram, chart, UI screen, timeline or type | 2D (`depth: "2d"`, the default) |
| A product, device, package or tool that turns, opens or assembles | `depth: "3d"` with `render3d: "three"` |
| The request asks for high-quality, cinematic or photoreal 3D, and Blender is installed | `depth: "3d"` with `render3d: "blender"` |
| The same, and Blender is missing | `render3d: "three"` and say so in the reply |
| A README cover with no user art | the `hero-3d` cover recipe |

Never take 3D to decorate a flat idea. The `depth3d` device must be the depiction of what the film is
about (the `subject` role), with its beats covering at least half the film.

## What the renderer gives you

- **A pinned three.js.** The skill ships three.js r170 (npm `three@0.170.0`, MIT) unminified in
  `engine/vendor/three/`: `three.module.js` plus two addons, `environments/RoomEnvironment.js` and
  `geometries/RoundedBoxGeometry.js`. The stage router serves them at `/lit/three/`; a page imports
  them through an import map:

  ```html
  <script type="importmap">{ "imports": { "three": "/lit/three/three.module.js", "three/addons/": "/lit/three/addons/" } }</script>
  <script type="module">
    import * as THREE from "three";
    import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
    import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
  </script>
  ```

  Any other path under `/lit/three/` is refused and recorded as a missing file, and the network rules
  still hold: never load three.js, a model or a texture from a CDN. The file hashes and the licence are
  in `engine/THIRD_PARTY_NOTICES`, and a test recomputes the hashes.
- **The GPU rung.** A `depth: "3d"` film with `render3d: "three"` and a `hero-3d` cover start Chrome on
  the platform's GPU rung (ANGLE on Metal on macOS, GL on Linux, D3D11 on Windows). Page rasterization
  stays on the CPU (`--disable-gpu-rasterization --disable-partial-raster`), so text and DOM layers
  rasterize exactly as on the software rung; only WebGL is hardware. The renderer probes the rung on
  an empty page first: it must give a WebGL2 context on a hardware renderer string. The WebGL renderer
  is recorded, and MO-C-02 names the rung and the renderer.
- **One rung per round.** The master pass and every replay (the determinism replay, the QA replay,
  the cover's seek pass) run on the same rung, because pixels from two rungs are not comparable. A
  replay on the GPU rung must reproduce the sampled frames byte for byte, or the render stops with
  exit 18, exactly as on the software rung. The rung is chosen from the treatment or the recipe, never
  by the page.
- **A labelled fallback.** When the GPU rung does not start, gives the page no WebGL2 or hands it a
  software renderer, the whole round reopens on the software rung (SwiftShader). The notice goes into
  the report, the manifest (`notices`, `rung: "software"`) and, for a cover, a `warning:` line. The
  film still renders, only slower. Say in the reply that it rendered without the GPU. Only when no
  rung has WebGL is it exit 11 `BLOCKED_NO_WEBGL2`. A context that the page creates lazily, after the
  probe, is caught by the post-load WebGL report instead of the probe.

## The scaffold's world

`render.mjs scaffold` on a `depth: "3d"` treatment adds, on top of the 2D shots, a world the shots
share:

- a `<canvas id="world">` behind every shot's section, so the type stays DOM text the QA can read;
- one renderer for the whole film (alpha, `preserveDrawingBuffer`, pixel ratio 1, ACES tone mapping,
  soft shadows), a `RoomEnvironment` for reflections, a key light with a biased shadow, a hemisphere
  light in the style's colours and a shadow-only floor;
- `HERO`, a group that holds the protagonist from the first frame to the last, posed per shot.

Build the protagonist once, in `HERO`, and only pose it per shot: that is what makes it the same
object across the film. Everything is a function of the film time the stage hands the page: no
`Math.random`, no clock, no physics that integrates across frames. Re-pose from scratch every
`render(t)`.

For a named product, start from its real logo and screens (`render.mjs assets`, see
`references/cover.md`, Named products): a fetched logo or screenshot goes on a plane or a face of the
object as a texture (`TextureLoader` on the file under `stage/assets/`), and a simple logo shape can be
traced into a `THREE.Shape` and given depth with `ExtrudeGeometry`. The `ASSET-USED` gate rule fails
the film when a product treatment fetched assets and no page file references one.

## Craft and the gate

- **Turn slowly.** A full turn takes the loop (a cover) or a whole shot (a film). Fast spins, flickering
  specular highlights and shadow acne all read as flashes and fail MO-C-03.
- **Bias the shadow.** On a turning object set `shadow.bias` about -0.0004 and `shadow.normalBias`
  about 0.03; without them the self-shadow flickers from frame to frame.
- **Ease every open and close.** A lid, a drawer or an exploded view eases in and out (`ease.smooth`),
  holds, and returns; the move is the beat, so it happens once, where the treatment's story puts it.
- **Keep the type in the DOM.** Copy stays in the shot's type zone as HTML text over the canvas; text
  drawn inside the 3D scene is invisible to the QA unless registered with `LitStage.text`.
- **Mind the dead air.** A small object on a large empty ground is `DEAD-AIR`; frame it with the `hero`
  layout or move the camera in.
- **Covers at 20 fps and q94.** The cover gate measures on a 50 ms grid; at 25 fps a smooth turn lands
  two frames on one step at the seam (FLOOR), while at 20 fps every step is one frame. Smooth lit
  surfaces blotch at the default q86, so the `hero-3d` recipe encodes at q94 with frame 0 and the last
  15 frames at 97.

## Camera moves and the flash audit

A rich film moves its camera in at least half its shots, and the flash audit stays exactly as it is.
When a move fails MO-C-03, keep the move and change what it passes over: slow the light change (a
highlight that sweeps over 0.5 s or more, not one frame), lower the contrast of the detail behind the
move, add motion blur (the Blender rung renders it; on the GPU rung average 4 to 8 sub-frame poses),
or cut instead of whipping. Removing the camera move is a downgrade.

## The Blender rung (`render3d: "blender"`)

For path-traced light (bevels that catch it, soft global illumination, depth of field, motion blur) a
3D film renders its world once in Blender with Cycles. The page then shows the rendered plate and keeps
its type, labels and 2D layers in the DOM over it.

**When to take it.** Only when the request asks for high-quality, cinematic or photoreal 3D (high
quality, cinematic, photoreal, Blender, or the Korean equivalents) and `findBlender()` finds an
install. A plate is expensive: on an Apple M-series GPU a hero scene takes several seconds per 1080p
frame at 160 samples, so a 13 s plate at 30 fps (390 frames) takes the better part of an hour. That
cost buys light the three.js route cannot draw, and nothing else; a film that does not ask for it
stays on `three`. Settle the scene on the preview stills first, since a fix after the final means
rendering the plate again, and build the page's panels while the plate renders.

**One plate per film.** The plate is rendered once, from a fixed scene and a fixed seed (the treatment's
`seed`, else a hash of the request and idea, modulo 2^31, so the same treatment gives the same noise).
Every round, replay and look pass reuses it. A look round that changes only the page, its type or its
2D layers never re-renders the plate; one that changes `scene.py` renders it again and says so.

**Finding Blender.** `findBlender()` tries `LITCODEX_BLENDER` (used only when that file exists), the
macOS app (`/Applications/Blender.app/Contents/MacOS/Blender`), then `blender` on PATH. It is never
assumed. It runs `blender -b --factory-startup -P engine/blender/runner.py -- ...` on Metal when the
build has it, another GPU backend next and the CPU last; the receipt names which.

1. Set `depth: "3d"`, a `depth3d` subject device and `render3d: "blender"`.
2. Write `stage/scene.py`, a Blender Python scene. It runs inside the bundled runner with `bpy`, `math`,
   `Vector` and `lit` in scope; times are film seconds and the plate starts at frame 1:
   `lit.camera(location, target, lens, dof=(distance, fstop))`, `lit.area_light(name, location, target,
   power, size, color)`, `lit.world(color, strength)`, `lit.material(name, color, roughness, metallic,
   emission, strength)`, `lit.rounded_box(name, size, radius, segments, material, location)`,
   `lit.image_card(name, path, width, location)` (a fetched product image as a card) and
   `lit.key(obj, prop, t, value)`. The scene must set a camera. The command line sets size, samples,
   device, fps and frames; the scene sets everything else.
3. `node "$R" blender --out <dir>` (or `--preview`) renders preview stills at the beat midpoints (50 %
   size, 40 samples) into `stage/plate-preview/`. Open them, compare them with any reference frames
   the user gave, and fix `scene.py` before the final.
4. `node "$R" blender --out <dir> --final` renders the plate (full size, 160 samples, motion blur, 30
   fps) into `stage/plate/000001.png ...` and writes `plate.json`, which lists every frame by name and
   size with the Blender version, device and samples. Run it as a background command and read its
   progress; it can take most of an hour. `--preview` and `--final` together are a usage error.
5. On the page, `const show = LitStage.plate({ parent, count, fps: 30 })` returns `show(t)`, which
   swaps one `<img>` per frame (`floor(t * 30)` of the 1-based, six-digit names) and waits for its
   decode; call it from `render(t)`. Plate frames listed in `plate.json` are not counted as page
   rasters; any other frame sequence in `stage/` is still a flipbook and fails the scan (exit 17).
6. The round's rung is `software` under a plate: the page needs only DOM raster, and the plate is
   already pixels. The stage refuses to start (exit 17) when `plate.json` is missing or does not match
   its frames, and the manifest and report name the plate (Blender version, Cycles device, samples).

**No Blender.** The command renders nothing and prints `FALLBACK`; it exits 0. Set `render3d` to
`three`, build the world in three.js on the GPU rung, and say in the reply that the Blender rung was
skipped and why.
