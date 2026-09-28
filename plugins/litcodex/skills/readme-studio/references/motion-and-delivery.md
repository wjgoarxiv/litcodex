# Motion engine choice and deliverable contract

## Choose before rendering

First verify the local CLI/version, FFmpeg and headless Chrome availability, and the license terms for the current user/company. Do not depend on a sibling checkout, its `node_modules`, or a machine-global tool. Keep the generated composition and its dependencies inside a task/project-local workspace.

### Remotion (preferred when license-compatible)

Use the `templates/remotion-cover/` project. It pins `remotion@4.0.526`, `@remotion/cli@4.0.526`, and React/React DOM `19.3.0`; run `npm ci` in that isolated template after copying it to a fresh workspace. Remotion's free terms are limited by user/company eligibility; verify the exact terms for the actual organization before rendering. The product license is not MIT. If the user/company is outside the free terms, choose HyperFrames only if its prerequisites and license are compatible; otherwise block motion rendering.

The default composition contract is 1600×800, 60fps, 300 frames (5 seconds). The template uses frame-based `useCurrentFrame`/`interpolate`, deterministic seeded SVG grain, local `staticFile` assets, and explicit composition IDs for light/dark/wide/mobile checks. Render with the version-local CLI and a new output path:

```bash
test ! -e public/readme-cover-v01.mp4 && npm run render -- src/index.tsx ReadmeCoverWideLight public/readme-cover-v01.mp4 --fps 60
```

Use a fresh path or increment the output revision; never silently overwrite. A lower-fps render is a review preview only and must be labeled as such. Do not add CSS keyframe animation to a Remotion composition; derive motion from the frame.

### HyperFrames (pinned alternative)

Use the `templates/hyperframes-cover/` project only when that engine is selected before rendering. The published package is `hyperframes@0.8.51` (Apache-2.0), not `@hyperframes/cli`; it requires Node ≥22 and is pinned with a lockfile. The HTML composition declares `data-composition-id="readme-cover"`, `data-start="0"`, `data-duration="5"`, `data-width="1600"`, and `data-height="800"`. After `npm ci` in a fresh task-local copy, render with the project-local CLI and a new output path:

```bash
test ! -e fresh.mp4 && ./node_modules/.bin/hyperframes render . -c index.html --fps 60 --workers 1 --output fresh.mp4
```

Keep `--workers 1` for this fixed-size template. HyperFrames documents worker counts from 1–8 with `auto` as the default; the v02 render with default workers showed a clipped strip along the bottom, while v03 with one worker logged `streaming-encode` with screenshot capture at the 1600×800 composition viewport and full-height artwork through frame 299. Recheck decoded bottom-region samples if upgrading HyperFrames or changing this setting.

The command uses the project directory as the positional argument and selects the HTML composition with `-c`; do not substitute the HTML file as the positional project argument. Confirm the pinned CLI help and the composition metadata before rendering. If the pinned engine cannot render the declared five-second timeline, stop with `MOTION_RENDER_BLOCKED`; do not use an unpinned `latest`, guess flags, or quietly switch engines. The exact published package metadata is available at <https://registry.npmjs.org/hyperframes/0.8.51>, and the render command contract is in the pinned source at <https://github.com/heygen-com/hyperframes/blob/d11907c3255efcf6169c2eb6a5b617284d242a38/packages/cli/src/commands/render.ts>.

This template deliberately uses finite CSS keyframe animations rather than GSAP. Its composition root therefore declares `data-no-timeline`, HyperFrames' native signal that no `window.__timelines[compositionId]` timeline is expected; this also skips the renderer's 45-second sub-timeline readiness poll. Do not add this attribute to hide a missing GSAP timeline. CSS animations are still seeked by HyperFrames' browser runtime, so preserve their finite durations and matching first/last keyframes. Keep `prefers-reduced-motion` rules out of the renderer HTML: the motion master must remain deterministic in headless/browser contexts, while the README preview selects a static poster for reduced-motion users. The adjacent `index.motion.json` records the expected moving composition. For `keepsMoving`, set `withinSelector` to a container such as `#cover`, not a moving leaf like an `<img>`: the pinned motion sampler calculates liveness from the selected scope's descendants. Before rendering, run `./node_modules/.bin/hyperframes check . --samples 60 --no-contrast --json`; the check seeks the same timeline as render and must pass its motion assertions, not just lint. A marker without seek verification is not motion proof.

Do not mix engine metadata, cached outputs, or licenses in one deliverable. Record which engine/version was selected and why the other was unavailable or not chosen.

## Visual and motion system

Keep the first frame recognizable as the same cover shown statically. Use one deliberate focal plane, restrained depth/parallax, a slow lighting falloff, soft glow separated from text, and optional blur only behind content. Grain is static/seeded for Remotion so identical frames remain reproducible. Maintain title contrast and clear safe margins; no effect may obscure letters or essential information.

Motion should explain the shift from background to identity: restrained background drift/scale, a short title reveal, and a readable hold. The cover remains understandable when paused on frame zero. A reduced-motion user gets the static poster and the same description, not a blank/video-only message. Never use motion to encode the only version of a fact.

## Render, optimize, and inspect

Produce a 60fps MP4 master, static PNG posters, and an optimized animated GIF or WebP inline preview when the local encoder supports it. Where the selected renderer emitted them, keep separate wide/mobile and light/dark variants; do not reference an unrendered variant. Verify fps, dimensions, duration, codecs, and byte sizes with local media tools. Every inline animation must be ≤2.5 MiB: optimize an oversized preview once (dimensions, palette, quality, or encoding). If it remains over budget, record `INLINE_PREVIEW_SIZE_BLOCKED` and an explicit partial-delivery decision; do not silently omit it and claim full-demo completion. A static poster remains the reduced-motion and unsupported-media fallback, and a normal Markdown link to the MP4 master may supplement but never replace the inline preview in a full demo. The responsive `<picture>` template puts reduced-motion poster sources before animated sources and falls back to a static image.

GitHub README rendering and npm package README display are later presentation gates. Local browser inspection does not establish that either service preserves `<picture>` media selection, animated preview behavior, or all themes; verify the published surfaces only in the separately authorized distribution/review gate. Never invent badges or popularity claims to fill those gaps.

Inspect wide/mobile crops and light/dark variants at 320px, 390px, and 1440px, including the static poster and start/middle/end motion frames. Capture rendered output with the supported local renderer and record its identity/version; do not call a template preview or a screenshot of source “rendered evidence.” The README shows the responsive inline preview with a static reduced-motion fallback; a normal text link to the MP4 master is optional when that file exists. Do not embed autoplay `<video>` markup. Keep all motion sources, font/source records, and generated assets local; there is no remote preview or publication step in this skill.
