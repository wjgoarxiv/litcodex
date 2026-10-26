# Sound: the score, the bed, supplied tracks and on-screen events

Read this when you write the treatment's `sound` field, run `node "$R" sound --out <dir>`, rebalance a stem after a look round, or read a `SOUND-*` line in the gate report. Every sound is built in product code from the film itself: no samples, no borrowed melodies, no network, no model weights.

## Pick the mode

| `sound.mode` | When | What the engine does |
|---|---|---|
| `score` | The default for a rich film (stage path and type path alike) | A layered per-film track: nine stems, an arrangement that peaks on the story's turn, sidechain, bus compression and the master stage. The stems are kept. |
| `generated` | A minimal film (the user asked for a quiet, spare or minimal film) | The small bed: a tempo grid, a pulse and a pad on a chord loop in one of four palettes (`air`, `felt`, `glass`, `pulse`), accents only where a beat asks. |
| `supplied` | The user gave an audio file | Fitted to the picture (padded or trimmed, 50 ms fade out) and always muxed; never cut the film short to the track. |
| `authored` | You wrote a track into `stage/` | Treated like `supplied`. |
| `none` | The user asked for silence, or the channel plays muted by design | No audio stream; the gate records `sound none`. |

A rich film that ships a minimal bed, or a minimal film that ships a full score, is a register mismatch: the treatment validator names it. `score` and `generated` are both "built" tracks: the engine writes them to the loudness target, so the gate judges their head and loudness; a `supplied` or `authored` track is only reported.

## The score

The score is a house-family track whose every choice is seeded by the film. Two films never share a score; one film always plans the same score.

- **Genre.** `sound.genre` if the treatment sets it, else the style's own `score.genre`: `swiss-signal` is `house` (120-126 BPM), `tidal` is `deep-house` (118-122), `terminalcore` is `tech-house` (124-128), `paper` is `garage` (130-134, swung). Set `sound.genre` only when the idea calls for a different floor, and say why in `sound.plan`.
- **Seed.** The request, the idea, the story's `turn`, the protagonist's name and every beat's purpose and times. The seed picks the tonic (any of twelve), major or minor, the tempo inside the genre's band, a four-chord loop (six major loops, six minor), a one-bar lead motif walking the pentatonic scale and a sixteen-step percussion pattern.
- **Arrangement.** One section per treatment beat: `intro` (beat 0), `build` (beats before the turn), `drop` (the beat `story.beat` names), `break` (the beat after the drop when three or more beats follow it), a second `drop`, and an `outro` (the last beat). The grid is placed so a **bar line falls exactly on the drop's start**; the grid may begin before 0 s, so a pad bar can start before its section and its filter clamps to the section.
- **Stems, in mix order.**

| Stem | Pattern | Plays in |
|---|---|---|
| `kick` | the genre's kit steps | builds, drops, outro (not the half bar before the drop) |
| `clap` | beats 2 and 4, plus a tightening roll over the bar before the drop | builds and drops |
| `hats` | closed sixteenths, accented offbeats, open hats in the drop | everywhere but the break |
| `perc` | the film's own sixteen-step rim and tom pattern | everywhere but the break's first half |
| `bass` | the sub (one note a bar) and the kit's line on the chord root | builds (after the first quarter of the beat), drops, outro (first half) |
| `chords` | stabs on the kit's steps, and a detuned saw pad per bar whose filter opens over the section | stabs in builds and drops; pad in intro, builds, break, outro and, for pad genres, drops |
| `lead` | the film's motif, lifted in every fourth bar | drops and break (an octave up in the break) |
| `fx` | a riser into each change (the strongest into the drop), the impact on the drop, a downlifter after it, a reverse swell into non-drop changes, plus beat-asked hits, cadences, chimes | at the cuts |
| `events` | one sound per entry of `sound.events` | on the event's own time |

- **Mix.** Each stem has a gain, a pan and a high-pass (hats 5 kHz, bass and kick unfiltered). `bass` (85 %), `chords` (60 %), `lead` (30 %) and `perc` (15 %) are **ducked under the kick** by a sidechain with a 4 ms attack and a 70 ms release, so the low end breathes with the kick. Reverb and tempo-delay sends return into the bus.
- **Bus and master.** The bus is compressed (2.5:1 over -10 dBFS, 10 ms attack, 150 ms release), faded over the last 0.4 s, and goes through `masterTo`: a gain to **-16 LUFS** (ITU-R BS.1770-4, measured in product code) and a **lookahead limiter** (5 ms lookahead, channels linked, 80 ms release) that holds the sample peak at or under **-2 dBFS**. A limiter, not a waveshaper: a waveshaper's harmonics came back from an AAC encode as overshoot; the limiter's output decodes at or under the -0.5 dBFS the gate allows.
- **Files.** `sound/score.wav` (the mix, exactly the picture's length), `sound/stems/<name>.wav` for the nine stems and `return-reverb`, `return-delay`, `sound/stems/manifest.json` (each stem's `rmsDbfs`, `sha256`, gain, pan, high-pass and sidechain depth) and `sound-cues.json`.

### Cues and the look round

`sound-cues.json` lists the cues the look round's sixth question reads. Each cue has `t`, `cutT` and `delta`:

- a section change (`build`, `drop`, `break`, `outro`) sits on its cut: `delta` is 0 and never more than one frame;
- a beat whose `sound` field asks for a hit, a cadence or a chime gets exactly that, on its cut (a chime at the beat's middle);
- an `event` cue is at the event's own time and carries `fromCut`, its distance to the nearest cut. Events follow the picture; they never snap to a cut.

The file also records `genre`, `key`, `tempo`, `progression`, `sections`, `fx`, `sidechainDb` (the bass's dip after a kick against 150-210 ms later; a score whose sidechain is under about 3 dB has lost its pump), `bus`, `lufs` and `peakDb`. Answer the look round from this file, not from memory.

## On-screen events

`sound.events` is a list of `{ t, on, kind }`: `t` seconds into the film, `on` what the picture does at that moment (copy it from the page), `kind` one of `tap`, `hit`, `whoosh`, `chime`.

| Kind | Sound | Use for |
|---|---|---|
| `tap` | a click with a pitched body in the key | a key press, a latch, a card landing, a cursor click |
| `hit` | a low thump with a snap | an impact, a slam, the product landing |
| `whoosh` | air that rises and **ends on `t`** | a fast move whose arrival is the event |
| `chime` | two notes of the key, a fifth apart | something completes: a check, a unlock, the payoff |

Place an event at the frame the picture shows it, to the frame, and make at least half of them at least 0.1 s away from a cut. Events on cuts sound like the music, not like the picture. A film with a drawn UI should have two or more. Events work in `generated` mode too.

## Run it

`node "$R" sound --out <dir>` builds the track from `<dir>/treatment.json` at the film's own frame count and cut times, so it can be heard before a render; the render rebuilds the same bytes. A score takes 1-3 s per 12 s of film. Listen with `afplay <dir>/sound/score.wav` and solo a stem the same way. To rebalance, change the treatment (the genre, the story beat, a beat's `sound` text, the events), not the files in `sound/`; the render overwrites them.

## What the gate checks

| Rule | Passes when |
|---|---|
| `SOUND-STREAM` | a stream is present when the treatment plans sound and it decodes |
| `SOUND-LENGTH` | the stream is within 0.1 s of the video |
| `SOUND-PEAK` | decoded sample peak at or under -0.5 dBFS |
| `SOUND-LEAD` | no run under -50 dBFS RMS longer than 1.5 s in the first 3 s. A FAIL (exit 20) for a built track, a WARN for a supplied one |
| `SOUND-LOUDNESS` | a built track is within 2 LU of -16 LUFS (WARN otherwise); a supplied track is reported only |

## Failure modes

- **Silent opening.** A score whose first section is a long intro with no hats or pad fails `SOUND-LEAD`. The intro always carries hats and a pad; if a custom `sound.genre` is wrong for a 1-beat film, the drop is the whole film and the kick starts at 0 s.
- **Drop off the turn.** The drop lands on `story.beat`'s start. If the picture's turn is not at a beat boundary, move the beat boundary, not the music.
- **Flat sidechain.** `sidechainDb` near 0 means no kick plays in a drop (a film with one beat, or a drop shorter than a quarter second). Lengthen the drop beat.
- **Events too busy.** More than one event a second turns the events stem into noise and buries the kick. Cut them to the moments a viewer would point at.
- **Loudness out of range.** A WARN from `SOUND-LOUDNESS` on a built track after the mux means the AAC encode shifted it; rerun `sound` and the render before blaming the mix.
- **Wrong register.** The treatment validator rejects a minimal film with a full score and a rich film with a bed before any render; fix `register` or `sound.mode`.
- **Reply wording.** Say in the reply that the sound is generated (`score` or `bed`), name its genre, key and tempo, and state that no sample or existing piece was used.
