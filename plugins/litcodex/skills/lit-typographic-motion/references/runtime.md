# Runtime, pre-warm and blocked states

The LitCodex motion runtime is pinned and installed before a session, then only read during a render. A Codex session under `--sandbox workspace-write` usually has no network and cannot write outside its workspace, so an install attempted mid-render would fail in a way that looks like a broken engine. This skill therefore never installs, fetches or repairs anything while rendering.

## Commands

| Command | What it does |
| --- | --- |
| `litcodex motion-runtime install` | Copies the pinned `runtime/package.json` and `runtime/package-lock.json` into the cache and runs `npm ci --omit=dev --ignore-scripts`, fetches Galmuri9 and MesloLGS NF with their licence files from pinned URLs and verifies every sha256, then writes a receipt. |
| `litcodex motion-runtime install --audio` | Also creates the Tier 2 venv with `python3 -m venv` and `pip install --require-hashes --only-binary=:all: -r runtime/requirements-audio.txt` (librosa, ISC; no aubio, essentia or madmom). |
| `litcodex motion-runtime install --word-timing` | States the download size and the pinned models first. This release pins none, so it fails closed. |
| `litcodex motion-runtime status` | Prints the five probes below plus the audio and word-timing tiers; exit 0 only when pre-warm is ready. |
| `litcodex doctor` | Prints the same five motion probes with the rest of the install diagnosis. |

The render commands themselves (`stage`, `film`, `sound`, `look`, `gate`, `completion`) live in `scripts/render.mjs`; `node scripts/render.mjs --help` prints them with every exit code.

`litcodex install` and the package's global postinstall both attempt the pre-warm. A failed pre-warm (offline, no npm) never fails the product install; it prints one receipt line naming `litcodex motion-runtime install`. Inside a skill session the same installed script is `node <skills>/lit-typographic-motion/scripts/runtime.mjs install|status`.

## Where the cache lives

`${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime/<id>`, where `<id>` is derived from the pinned lockfile and the font pin list, so a new release gets a fresh directory. An install lock (`.install.lock`) keeps two installs from racing. The render resolves the cache with the same `HOME` and `XDG_CACHE_HOME` it runs under: pre-warm with the environment the session will use. A cache warmed under your real home is invisible to a session that runs with an isolated home.

## The five probes

1. Chrome: the resolved executable and its version, or `not found on PATH / not installed`. `CHROME_PATH` overrides discovery.
2. ffmpeg: its path and version line plus the preview encoder rung available here (`libwebp_anim` when ffmpeg lists it, else `img2webp`, else GIF), or `not found on PATH`.
3. WebGL2 renderer: the `UNMASKED_RENDERER_WEBGL` string from a real headless page, tried on the launch ladder; `unknown (debug-info extension unavailable)` when Chrome hides it.
4. Renderer warning: none for a real GPU; a software-GL warning (SwiftShader, llvmpipe, softpipe, lavapipe, Apple Software Renderer, Microsoft Basic Render Driver) saying samples are lowered; or the unknown-renderer warning.
5. Pre-warm: `ready` with the cache path, or the exact missing or hash-mismatched dependencies and fonts and the command that fixes them. LitCodex's reused PretendardGOV files are checked against LitCodex's own recorded hashes.

## Chrome launch ladder

The **stage path** launches one rung only: the software rung (SwiftShader, CPU raster) with the anti-throttling and keychain flags, plus `--run-all-compositor-stages-before-draw`, `--disable-checker-imaging`, `--disable-new-content-rendering-timeout`, `--disable-threaded-animation`, `--disable-threaded-scrolling`, `--disable-image-animation-resync`, `--disable-lcd-text`, `--force-color-profile=srgb`, `--hide-scrollbars`, `--mute-audio`, `--force-device-scale-factor=1`, `--window-size=<w>,<h>`, `--disable-background-networking`, `--disable-component-update`, `--disable-sync`, `--no-pings`, `--metrics-recording-only` and `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE lit.stage"`. The page is served on the synthetic origin `http://lit.stage/` through Playwright request routing with service workers blocked, so nothing listens on a port; a refused `listen` never blocks the stage path. The master, the determinism replay and the text QA replay each get their own Chrome and profile under `.run/`.

On the **type path** the renderer drives Chrome over the pipe transport, so no control port listens. It tries, in order, the platform GPU rung (`--use-angle=metal --enable-gpu-rasterization --ignore-gpu-blocklist` on macOS, `--use-angle=gl ...` on Linux, `--use-angle=d3d11 --enable-gpu-rasterization` on Windows) and then the software rung (`--use-angle=swiftshader --enable-unsafe-swiftshader`), always with the three anti-throttling flags. A rung counts only when `getContext('webgl2')` and a half-float render target succeed in the page, re-checked at every render launch. The winning flags are recorded as `chromeFlags`. The Chrome profile lives in a short unique directory under the run's own `.run/` and is removed on exit. No extra flags such as `--no-sandbox` are ever added.

## Frame egress

Frames leave the page as raw RGBA over a WebSocket bound to `127.0.0.1` on an OS-assigned port. If the host refuses a local listen, the renderer pulls the same readback buffer per frame over the CDP session instead and notes it in the report; if that also fails, the message quotes the listen error. Either way the hashed bytes, the flash-audit input and the ffmpeg input are the same bytes.

## Blocked states

| Exit | Name | Real cause it reports |
| --- | --- | --- |
| 10 | `BLOCKED_NO_CHROME` | Chrome not found, or Chrome's first launch error line (a sandbox that forbids launching Chrome lands here) |
| 11 | `BLOCKED_NO_WEBGL2` | Chrome ran, but no rung produced WebGL2 with a half-float target |
| 12 | `BLOCKED_NO_FFMPEG_FOR_VIDEO` | ffmpeg or ffprobe missing for the film, preview or poster; stills and the sheet still exit 0 |
| 13 | `GATE_FAIL_QA` | The pre-flight or full gate rejected the render; the report names the rules |
| 14 | `BLOCKED_DEPS_NOT_PREWARMED` | Pinned dependencies or word-timing models absent |
| 15 | `BLOCKED_FONT_FETCH` | A required font or licence missing or failing its sha256 pin |
| 16 | `BLOCKED_TREATMENT_INVALID` | `treatment.json` missing or invalid; the message names the field |
| 17 | `STAGE_CONTRACT_ERROR` | The stage page used a forbidden element or API, a flipbook or animated raster, a wrong frame size, a link out of `stage/`, or left a copy line off screen |
| 18 | `STAGE_NONDETERMINISTIC` | A stage frame differed between the master and a fresh sequential replay; the frame and region are named |
| 19 | `STAGE_NETWORK_REQUEST` | The stage page named or requested anything outside its own folder, or opened a connection |
| 20 | `SOUND_INVALID` | The planned sound is missing from the film, runs long or short, clips, or a generated bed opens silent |

Report the exit name, its message and the fix command. Never describe one cause as another: a sandbox that refuses Chrome is exit 10 with Chrome's own error, not a missing file or a WebGL problem.

## Host notes for Codex

- In a `workspace-write` Codex session, run `status` first. If pre-warm is missing, ask the user to run `litcodex motion-runtime install` outside the sandbox, or request escalation for that single command when the host allows it.
- If Chrome cannot launch inside the sandbox, the render exits 10 with Chrome's message. Keep the treatment and the command, report the state, and give the user the exact command to run outside the sandbox.
- A full stage render of a 15 s 9:16 film takes about two to four minutes here. Give the command a timeout of at least 600 s, or pass `--detach` and poll `.run/progress.json`; never shorten the film to save render time.
- Renders write only into the output directory you pass with `--out`.

## Credit

Typographic-motion engine adapted from mexicat/pdoom-video (MIT, Giacomo Magnanini), commit `ca251e3`. The verbatim MIT notice ships in `engine/NOTICE`; every bundled and cached font licence is listed in `engine/THIRD_PARTY_NOTICES`.
