# Look rounds, the gate and Done

A film is finished when it passes the gate, a person-shaped look has checked it against the treatment, and that look saw the final render. This file tells you what a round is, how to record a look, what the gate measures on each path, what the reply says, and when the work counts as done. `R` is the renderer, `O` the output directory.

## One round

Rounds share one counter with renders, 1 to 3.

1. **Round 1 is always a stills round.** `node "$R" stage --out O --stills-only --round 1` (type path: `film`). It writes `O/stills/` (a full-size still at every beat's midpoint, a transition strip of frames -6 / 0 / +6 at every cut, a 12-frame contact sheet and the poster frame) plus `stills/manifest.json`, and the sound cue sheet `O/sound-cues.json`. Nothing is encoded.
2. **Look.** Open every PNG listed in `stills/manifest.json` with `view_image`. Only files you passed to the image tool count as viewed; a file size, a hash, OCR text or a pixel statistic is not a look.
3. **Record the round.** Write an answers file and run `node "$R" look --out O --round 1 --answers <file>`. Round 1 must name the weakest beat and the change you made to it.
4. **Revise.** Change `treatment.json` or `stage/index.html` (or the type-path staging) to fix what the look found.
5. **Full render.** `node "$R" stage --out O --round 2` (give the call a timeout of at least 600 s, or add `--detach` and poll `O/.run/progress.json`). It writes the film, the preview, the poster, the reduced-motion still, the sound, a fresh stills set, and the gate report.
6. **Look again** at the new stills and record `look --round 2`. If an answer asks for another round, revise and render round 3, then record `look --round 3`. After round 3, deliver with the open items stated plainly.

## The answers file

```json
{
  "viewed": ["<every stills file you opened, by name>"],
  "answers": [
    { "q": 1, "verdict": "<yes or no>", "frame": "<stills file>", "observed": "A stranger would say this film is for: <…>" },
    { "q": 2, "verdict": "<yes or no>", "frame": "<stills file>", "observed": "<one sentence naming a concrete visible detail in that frame>" }
  ],
  "weakestBeat": "<beat number, round 1 only>",
  "change": "<what you changed, round 1 only>"
}
```

Answer all nine questions, each with `verdict` (`yes` or `no`), the `frame` you judged it from (a file in the latest stills set; question 6 may cite `sound-cues.json`) and `observed`: at least one sentence naming something you actually saw in that frame. A bare yes or no is refused, and so is any frame that is not in the latest stills set. `look` stamps the round with the SHA-256 of the stills manifest and of every frame it lists.

1. "A stranger would say this film is for: <…>". Write that sentence in `observed`; `verdict` is `yes` when it matches the treatment's audience and idea.
2. Does every beat show its `onScreen` plan?
3. Is the craft at the level `ambition` asks for: transitions, rhythm, depth, hierarchy?
4. Is any request text, meta label, placeholder, file name or internal term on screen?
5. Does the ending land?
6. Does the sound follow the cuts? Answer from `sound-cues.json`: each cue's `delta` against its cut.
7. Name one thing a skilled motion designer, given only the request, would have shown that this film does not. `verdict: yes` means you can name one; name it in `observed` and revise.
8. Is any element on screen without a job in its beat?
9. Could every copy line be pasted unchanged into a film about a different subject? If yes, rewrite the copy from `subject.specifics`.

A `no` on 1, 2, 3, 5 or 6, a `yes` on 4, 8 or 9, or a nameable answer to 7 requires another round. On this host you answer question 1 yourself (`by: self`); where a fresh subagent is available it may answer it from the contact sheet and the beat stills alone, and the round records `by: blind`.

If no image tool is reachable at all, record `{ "blocked": "no-vision-tool" }` for the round. The done-check then reports `DONE_UNVIEWED`, and the reply must say in plain words that nobody viewed the frames.

## Exit codes

| Exit | Meaning | What you do |
| --- | --- | --- |
| 0 | Gate PASS; the exports are at their deliverable names | Look at the new stills and record the round |
| 13 | Gate FAIL; the report names the rules | Fix the cause and render the next round; at round 3 deliver with the failure stated |
| 10 | Chrome missing or would not launch headless | Name the state; stills cannot render either |
| 11 | No WebGL context (type path; stage path only when the page asks for WebGL) | Name the renderer or launch message |
| 12 | ffmpeg or ffprobe missing | The stills set is still written; install ffmpeg for the film |
| 14 | Runtime not pre-warmed, or `--word-timing` models absent | `litcodex motion-runtime install` outside the sandbox |
| 15 | A font fails its sha256 pin | Same command; a mismatched font is never re-fetched during a render |
| 16 | `treatment.json` invalid; the field is named | Fix that field |
| 17 | Stage contract: a forbidden element or API, a flipbook, a wrong frame size, or a copy line never on screen (quoted) | Fix the page |
| 18 | A stage frame differs in a fresh replay; the frame and region are named | Replace the leaking source with `t` or `LitStage.rand` |
| 19 | The page asked for the network | Make the asset local |
| 20 | Sound missing, mistimed, clipping, or a silent start on a generated bed | Fix the sound plan or the track |

## Promote or withhold

- PASS: the exports move from `.run/` to `film.mp4`, `preview.webp` or `.gif`, `poster.png`, `reduced-motion.png`.
- FAIL without a flash FAIL: the exports still move to their deliverable names so the user can inspect them next to the report.
- Flash FAIL (MO-C-03) in any round: all four exports move to `withheld/` as diagnostics, never deliverables. After round 3 say plainly that the film is withheld pending a fix.

## Never downgrade to pass

Do not answer a failure by shortening the film, removing a beat, removing the subject device, switching `sound.mode` to `none`, switching `path` to `type`, or deleting effects. Fix the cause instead: a scrim or a darker ground behind the words, a larger size, a placement inside title-safe, a longer hold on the words, seeded randomness in place of a leak, a slower reveal near a cut. If you cannot fix it, deliver with the failure stated. The done-check compares the final treatment with the first valid one (`.run/treatment-first.json`) and records `downgraded` when the film got more than 20 % shorter, lost subject beats, lost its sound without a request, or moved from the stage path to the type path; the reply must say so.

## When the work counts as done

`node "$R" completion --out O` prints the verdict. A film turn is complete only when all of these hold:

- the gate passed (or round 3 ended with the failed rules named in the report, or with a flash FAIL and the exports withheld);
- `treatment.json` is valid and older than the render, and on the stage path so is `stage/index.html`;
- there are at least two look rounds: the round-1 stills round with a change, then a last round;
- the last round's stills manifest hash equals the final full render's (`stillsManifestSha256` in `manifest.json`);
- the last round viewed the poster, the contact sheet, every beat midpoint and every transition strip;
- nothing in the last round asks for another round, unless it was round 3 (then the open items are printed and go in the reply).

The verdict is `complete`, `not complete` with the reason, or `DONE_UNVIEWED`. It also prints any `downgraded` item and any open look item. This host exposes no tool-event hook, so the check that each frame went through `view_image` is advisory: only list files you really opened.

## What the gate measures

The gate reads recorded data only. `gate --out O` reruns it on an existing output without rendering; the viewed count comes from `look.json`, so a re-run keeps it.

On the **stage path**:

| Rule | Checks |
| --- | --- |
| MO-C-03 | WCAG 2.3.1 excursion audit on the master (non-looping) and the preview (looping); the audit grid is 320 x 180 cells, 180 x 320 for 9:16. Hard FAIL; withholds the film |
| MO-SH-04a | No frame pair steps more than 25 % of the frame by 0.1 luminance |
| MO-C-10/11/12 | Exactly 1920x1080 or 1080x1920 matching `format`, the page's fps (30 or more), duration within ±10 % of `durationSec`, `yuv420p` / `bt709` / `tv` |
| MO-C-13 | Preview at most 3 MB, poster at most 1 MB, MP4 WARN past 100 MB per 10 s |
| MO-C-14 | The reduced-motion still is the final beat's midpoint frame |
| MO-C-09 | 8 to 16 frames re-captured in a fresh Chrome replaying the clock from 0 hash identically (decoded RGBA) |
| MO-D-03 | No near-black run longer than 2x the 2-beat hold floor at `sound.tempo` (+1 s at the edges) |
| QA-CONTRAST | Copy runs (text found in `copy.lines`) 3:1 large (at least 3 % of the short edge) and 4.5:1 body on settled samples; decor and unlisted text only WARN |
| QA-TITLE-SAFE | Copy ink inside the central 90 % of the frame; decor exempt |
| QA-READING | Each copy run stays on screen for its reading floor (measured at 10 fps, 0.1 s tolerance); decor exempt |
| QA-COPY | Every `copy.lines` entry appears on screen (page text or registered canvas text); a missing line exits 17 |
| QA-DECOR | A decor run never carries a copy line; decor is at most 25 % of the visible text |
| QA-META, QA-UNLISTED, QA-CANVAS, QA-STATE, QA-PRESENCE | WARNs the look must answer: meta labels on screen, text that is neither a copy line nor marked decor, unmeasured canvas text, samples discarded because something besides text moved, too little non-text detail |
| QA-FONTS | Every sampled run renders in one of this product's faces (FAIL for copy, WARN for decor) |
| SOUND-* | Stream present, length within 0.1 s of the video, peak at or under -0.5 dBFS, no silent opening on a generated bed |

The text checks run in a separate replay Chrome: at each beat midpoint and two settled frames per beat it captures the frame, hides all text ink, captures again, and treats the difference as the ink mask. The master is never touched.

On the **type path** the Wave 1 rules apply unchanged (MO-C-01 to MO-C-29, MO-D-02 to MO-D-04 and the Section A/B rows), with MO-C-12 as amended (the film meets the treatment's length; a WARN says so when the reading floors force it longer) and the SOUND rules added.

| Rule | Checks |
| --- | --- |
| MO-C-01 | Every frame covered by a look-library pass that issued a draw |
| MO-C-02 | WebGL2 present; a software rasterizer labelled and at 1 sample |
| MO-C-04 / 05 | Glyph ink inside title-safe; furniture inside action-safe |
| MO-C-06 | Contrast on settled frames: 4.5:1 body, 3:1 large |
| MO-C-07/08 | Reading floors for every unit |
| MO-C-09 | Cut-sheet frames re-rendered in a fresh process hash identically |
| MO-C-25..29 | Tracking, line height, measure, one accent colour |
| MO-D-02 / 03 / 04 | Frame-time p95, near-black runs, glyph coverage |

## Reading the report

The first block names the outputs, the path and format, the renderer and the exact Chrome flags, and the per-frame capture time. `QA gate: PASS | FAIL` follows, then one line per rule, the craft round, and the number of frames viewed according to `look.json`. Notes give the sound plan, the preview rung and any warning. Quote the gate line in your reply; do not paste the report unless the user asks.

## The reply

Keep the product's activation line where it is; below it add no second banner and no emoji. Write in plain words with no internal names (no rule ids, file hashes or field names):

- one line on the defaults you chose (format, length, path, sound palette);
- a label on every invention from `inventions` ("example subject", "example copy") and on the generated sound;
- one line on what was checked: flash safety, legibility and the frames you looked at;
- where the copy lives (the `COPY` object in `stage/index.html`, or `copy.lines` in `treatment.json`) and the one command that re-renders;
- any downgrade and any open look item, stated plainly.
