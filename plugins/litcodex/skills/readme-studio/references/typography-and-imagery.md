# Background, local fonts, and outlined typography

## Image-generation branch

Generate a text-free, original background before composing type. On Codex, call its supported native image-generation tool and inspect the actual result. Copy only that result into the task-owned output directory; record the original tool result and copied path. If the active host has no supported native generator, stop at `IMAGE_GENERATION_UNAVAILABLE` and ask for a user-supplied background. Do not substitute a CSS gradient, stock URL, generated-looking hand-authored SVG, fake tool result, API request, or request for an API key. A gradient, grain, glow, and lighting falloff may be added later as composition effects, but they are not a generated background.

Keep the background free of words, logos, UI, and baked-in captions so its crop and typography remain editable. Inspect the image at the intended wide and mobile crops before using it. Preserve the supplied/generated source unmodified and write composition effects into a separate layer.

## Font identity and license

Use user-provided/task-local Pretendard and Meslo LGS NF files by explicit path. Before outlining, record the exact filename, family/style/version when readable, SHA-256, license text/source, and any font-file hash. Verify the selected font covers every character in its run; missing Korean/Latin/punctuation glyphs are a blocker for that font, not a reason to accept tofu or substitute silently. Keep the upstream font license notice with any distributed font copy. Do not install fonts into the operating system, add them to the product package, or bundle bytes whose license/provenance is unclear.

The shaper is self-contained in `templates/typography/`. Copy `package.json`, `package-lock.json`, and `shape-text-to-svg.mjs` into a new task-owned helper directory, then install only there with `npm ci --ignore-scripts --no-audit --no-fund`. The lock pins `fontkit@2.0.4`; it is a one-off asset tool, not an application dependency. Use the selected font path explicitly, for example:

```bash
node .readme-studio/typography/shape-text-to-svg.mjs \
  --font "/explicit/path/Pretendard-Regular.otf" \
  --text "Editable Korean and English source" \
  --output-root "$PWD" \
  --output assets/readme-cover/title-outline-dark.svg \
  --font-size 72 --tracking 0
```

The task-local helper requires an explicit existing output root and a relative output path. It walks the canonical parent chain, rejects symlinks/out-of-root paths, and creates the SVG exclusively without overwriting. Font input must be a non-empty regular, non-symlink file no larger than 64 MiB; FIFOs/devices are rejected before font parsing. The `viewBox` is the padded union of font metrics, shaped advances, tracking, and every transformed glyph bounding box, so negative bearings and overhangs remain visible; malformed/non-finite bounds or non-positive geometry fail closed.

Generate each palette explicitly because external SVG images do not inherit the Remotion component's CSS text color. For example, write the dark-ink variant using `--fill '#15242A'` as above, then rerun with `--fill '#F4F1E9'` and a distinct `--output ...-light.svg` for the dark field. Use matching `title-outline-{light,dark}.svg`, `subtitle-outline-{light,dark}.svg`, and `micro-label-outline-{light,dark}.svg` files. Use a fresh output name for every variant and revision. Keep editable wording and font identity/license/SHA in `cover-source.json`; the SVG path is not the editable text source. Keep accessibility text in the README and/or SVG `<title>/<desc>` metadata. Check the SVG contains paths and no `<text>`, `@font-face`, data URL, or remote font reference. If the background is raster, say “raster background with outlined SVG typography,” not “all-vector.”

## Focal depth and secondary light

Keep the supplied/generated artwork as an overscanned, softly blurred depth background, then place a separately masked copy above it as the sharp focal plane. Fade the seam with a gradient mask instead of a hard crop; keep the focal crop away from the title's safe area. The wide treatment can place the sharp plane toward the artwork side, while the mobile treatment can stage it below the text field. Adjust masks and object position against the actual source image, not a generic crop.

Add one directional rim-light or vignette layer as a separate overlay alongside the existing gradient veil, gaussian glow, and grain. Keep the light on the artwork side and below essential text. In Remotion, derive any intensity change from the frame and keep noise seeded; do not add CSS animation. In HyperFrames, use a finite animation with matching first and last keyframes. These layers must be visible as static pixels in the selected poster; a reduced-motion user receives that poster through the README's static source selection, without depending on motion or a browser preference inside the renderer.

Inspect every theme and wide/mobile crop at the start, readable hold, and final frame. Check the blurred field stays soft, the focal plane stays crisp, the lighting layer does not wash out outlines, and the title remains legible at the smallest intended width. Keep the documented static poster from a held frame with the complete depth and lighting composition.
