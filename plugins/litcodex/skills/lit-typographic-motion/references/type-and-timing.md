# Type and timing

This file covers Phase 1 (timing) and the type rules the LitCodex engine enforces while it lays out and paces your lines. Every number below is the one in `engine/constants.mjs`; where the spec marks a number as a proposed default, the engine and the gate report label it `[provisional]`.

## The one reading floor

Every timeline unit gets a floor from one function. Count three things in the unit's displayed text (after typographic punctuation is applied):

- `H`: Hangul syllables (U+AC00 to U+D7A3);
- `W`: Latin words, meaning runs of letters, digits, apostrophes and hyphens;
- `C`: characters inside Latin script runs, spaces included.

| Unit kind | Floor |
| --- | --- |
| `line` or `scene` | `max(H > 0 ? 1.0 : 0.9, 0.2 * H + W / 3.3)` seconds, plus a cross-check of at most 17 Latin characters per second |
| `word` (a unit shown alone) | `max(0.5, 0.2 * H + W / 3.3)` |
| `reveal` (a karaoke or list step inside a line that stays visible) | 0.35 s; the containing line carries the rate floor |

A unit fails when its hold is shorter than the floor by more than one frame. Worked example: a four-어절 Korean line with 14 syllables has a floor of `max(1.0, 0.2 * 14) = 2.8 s`.

## How Tier 1 paces the film

With no audio file, the engine builds the timeline from the text and a beat grid:

1. Each shot needs `1.25 x floor` seconds; a karaoke line or list also needs room for its reveal steps (`steps x 1.25 x 0.35 / 0.7`), and 17 cps is honoured.
2. The need is rounded up to whole beats of the brief's BPM (default 100 BPM, 0.6 s per beat), and never below 2 beats.
3. Shots are placed end to end, so every cut lands exactly on a beat; the film starts at 0.
4. If `durationSec` asks for more, extra beats go to the shots round-robin.
5. Reveal steps spread over the first 70% of their shot, one whole 어절 or item per step, so the last word still gets a settled hold.

The pre-flight gate re-checks the result (MO-C-07/08, MO-A-13, MO-A-15, MO-A-16 and glyph coverage) before any frame renders. A pre-flight failure exits 13 and writes `gate-report.txt` naming the unit, its hold and its floor; shorten the line or split it, then rerun with the next round.

## Tier 2: your own audio

`--audio <file>` asks for a beat grid from that file. It runs only if `litcodex motion-runtime install --audio` created the hash-pinned librosa venv earlier, outside the session. The analysis writes `.run/beat-grid.json` for this run only; it is never cached or reused. Shot starts then snap forward to the analysed beats instead of the regular grid, the same holds and floors apply, and the audio is muxed into the MP4. If the venv is absent or its pins changed, the render continues on Tier 1 with the warning `audio analysis not prewarmed: run litcodex motion-runtime install --audio`; if the analysis itself fails (for example a corrupt file) it also falls back to Tier 1 with the reason. The engine never installs or repairs the venv during a render.

## Tier 3: word timing

Word-level alignment is opt-in with `--word-timing` and never part of bare `lit`. This release pins no licence-verified Korean-capable alignment model, so the tier fails closed: the render exits 14 and names `litcodex motion-runtime install --word-timing`, and that install command states the download size and the (empty) pin list before refusing. Non-commercial weights are never pinned.

## Script runs

The type kit splits every string into script runs before choosing faces.

- Hangul syllables and jamo form Hangul runs; Latin letters form Latin runs.
- Digits, punctuation and spaces belong to no script of their own. Each joins the run beside it; between two different runs it joins the run on its left; with nothing on the left it joins the run on its right. So `2026년` is one Hangul run, and `LIT팀` splits exactly at the boundary into `LIT` and `팀`.
- Each run takes its face from the voice: for example the swiss display voice uses Archivo for Latin runs and PretendardGOV Bold for Hangul runs, in the same line.

## Korean type rules (hard)

- Line breaks and reveal steps happen only at whitespace between 어절. A long Korean line shrinks in size before it would ever break inside a 어절.
- Hangul runs never get tracking or width motion; their tracking is 0 even when the Latin run beside them animates.
- Weight steps on Hangul only move between LitCodex's own lit-pptx PretendardGOV Regular (400) and Bold (700), reused by path and checked against LitCodex's recorded hashes. Nothing between or beyond is synthesised, and no horizontal scale is applied.
- Galmuri9 needs a large grid multiple to stay crisp: keep it at 36 px or more on screen.

## Latin type rules

- Per-glyph positions come from the kerned run: when a word is split into separately coloured pieces (the karaoke reveal), each piece is drawn at its position inside the whole kerned line, never at the width of a measured slice.
- The display voice may track as tight as -0.04 em (the title uses -0.02 em); the machine voice and body copy never track negative.
- Archivo width steps are real static instances; there is no live variable-font interpolation at render time.
- `smart()` turns typewriter quotes and `...` into typographic marks for display; `plain()` reverses it for a typed-input mono voice.
- No outlined or haloed type, ever: legibility comes from the palette contrast, not strokes around letters.

## Size, measure and line height

- Title-safe is the inner 90% (96 px left and right, 54 px top and bottom at 1080p); every glyph's ink box must stay inside on every frame. Non-type furniture must stay inside action-safe (48 px and 27 px).
- Contrast is measured on rendered pixels: body type needs 4.5:1, large type 3:1, where large means 32 px or more, or 25 px or more at weight 700.
- A block showing two or more lines at once needs line-height of at least 1.5 (Latin) or 1.6 (Hangul or mixed), and at least 1.4 from three lines on; the scenes use 1.5 and 1.6.
- A Latin paragraph card must run 60-75 characters per line; a Korean card is only advised to stay within 30-45.
- The smallest type the engine draws is 28 px, so the 960 px and 720 px preview rungs keep every glyph at 10 px or more.

## Fonts

| Face | Where it comes from | Licence file |
| --- | --- | --- |
| Archivo, 9 static instances | bundled in `fonts/archivo/`, instanced at development time with a recorded recipe (`fonts/archivo/SHA256SUMS`) | `fonts/archivo/OFL.txt` |
| VT323 | bundled in `fonts/vt323/` | `fonts/vt323/OFL.txt` |
| EMS Allure, Felix, Osmotron, Readability, Tech | bundled SVG single-stroke faces in `fonts/stroke/` | `fonts/stroke/OFL.txt`, `fonts/stroke/CREDITS` |
| PretendardGOV Regular and Bold | reused from `../lit-pptx/pretendard-font/` | `../lit-pptx/pretendard-font/LICENSE.txt` |
| Galmuri9 | fetched at pre-warm, pinned URL and sha256 | cached `fonts/licenses/Galmuri-ofl.md` |
| MesloLGS NF | fetched at pre-warm, pinned URL and sha256 | three cached files: the Meslo Apache notice, the Apache-2.0 text and the DejaVu Bitstream Vera notice |

Glyph coverage is checked before the first frame: every character in the brief must exist in the face its script run uses, including the digits a counter will show. A missing glyph is a pre-flight FAIL that names the face and the codepoint.
