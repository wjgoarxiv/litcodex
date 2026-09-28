# The treatment

Every film starts here. Before any render, write `treatment.json` in the run's output directory (the directory you pass as `--out`). It is the director's plan: what the film is about, who it is for, what each beat shows, how it sounds and which render path draws it. The renderer validates it before every render, `--stills-only` included, and exits 16 `BLOCKED_TREATMENT_INVALID` naming the first field to fix. Validation checks structure and honesty, not taste; taste is what the look rounds are for.

Load this file first. Load the path reference only after `path` is set: `references/stage.md` for the stage path, `references/style-bibles.md` and `references/type-and-timing.md` for the type path.

## Path rule

- **type**: only when the words themselves are the film. The user asked for kinetic type, a lyric or quote video, a title sequence or typographic motion, or supplied words with no other subject, and the film is 16:9. The validator refuses `path: type` unless `copy.source` is `user` or the request carries a type-led cue (a type compound or word, or a quoted span of two or more words), and refuses it at 9:16.
- **stage**: every other film, including any film that needs shapes, drawn objects, diagrams or imagery beyond type. You author the visuals as a page (`stage/index.html`) and the renderer captures it frame by frame. Words the user supplied become stage copy.
- A 9:16 film always takes the stage path.

State the reason in `pathReason` in one plain sentence.

## Field reference

Normalization, used below: NFC, lowercase, then every whitespace, punctuation and symbol character removed. Before a field is compared with `request`, every quoted span (`"…"`, `“…”`, `'…'`, `「…」`) is removed from the request. The restatement limit is min(10, half the normalized request length) characters.

| Field | Rule |
| --- | --- |
| `request` | The user's words, verbatim, including the trailing `lit` if there was one. Never paraphrase it. |
| `genre` | `announcement`, `brand-mood`, `event`, `explainer`, `motion-graphics`, `type-led` or `other`. |
| `path`, `pathReason` | `type` or `stage` per the path rule, and why. |
| `idea` | One sentence that says what the film shows or does. It may not share a normalized run of the restatement limit with the request: an idea that repeats the request is not an idea. |
| `audience`, `channel` | Who watches, and where it plays. These decide format, sound and pacing. |
| `format`, `formatReason` | `16:9` or `9:16`, with the reason tied to the channel. |
| `durationSec` | 4 to 90. Unless the user asked for a length, `announcement`, `event`, `explainer` and `motion-graphics` films run at least 10 s. |
| `beats[]` | `{t0, t1, purpose, onScreen, motion, sound}` in seconds. Beats cover 0 to `durationSec` with no gap over 0.25 s; every beat lasts at least 1.2 s; there are at least as many beats as the genre's arc has stages (type-led: one per supplied line). `onScreen` says what is drawn, `motion` how it moves, `sound` what the ear hears at that moment. |
| `subject` | `{name, source, specifics[]}`. `source` is `user` when the request names the subject. When it names no specific subject, invent one: a name plus at least 2 concrete specifics (what it is or does, for whom, one distinctive detail). |
| `visualDevices[]` | `{kind, role, beats[]}`. `kind` is one of `illustration`, `diagram`, `chart`, `icon`, `shape`, `path`, `mask`, `depth3d`, `particles`, `grid`, `gradient`, `photo-texture`. `role` is `subject`, `support` or `texture`; `grid`, `gradient`, `particles` and `photo-texture` are always `texture`. On the stage path at least one `subject` device must be a drawn depiction of what the film is about (not a background), its beats must cover at least half the film, and the devices must span at least 2 distinct non-texture kinds. |
| `typePlan` | `{faces[], hierarchy, maxWordsOnScreen}`. Faces come from this product's verified set: Archivo, PretendardGOV, VT323, Galmuri9, MesloLGS NF. On the type path it may also carry `preset`, `presetSource` (`user` only when the user named the style; otherwise the report says "agent default"), `filmName` (printed on the end card only when it is the film's own name) and `showIndex` (a shot counter, off unless the film asks for it). |
| `palette[]` | 3 to 6 `{hex, role}` entries. |
| `sound` | `{mode, plan, palette, key, tempo}`. `mode` is `generated`, `supplied`, `authored` or `none`. Under bare `lit` the default is `generated` on both paths. `none` is allowed only when the user asked for silence or the channel plays muted by design. `supplied` and `authored` name `file`; an authored track is a WAV you wrote into the stage directory. For `generated`, `palette` is `air`, `felt`, `glass` or `pulse`, `key` looks like `D minor`, and `tempo` is 60 to 160 BPM. |
| `copy` | `{source, lines[]}`. With `user`, every normalized line must appear in the normalized request (quoted spans included). With `invented`, no line may share the restatement limit with the request: write the copy from `subject.specifics`. |
| `inventions[]` | Every invented name, fact and line, so the reply can label them. Required and non-empty when `copy.source` or `subject.source` is `invented`; it must contain `subject.name` when the subject is invented. Use `[]` when nothing is invented. |
| `ambition` | One or two sentences, in craft terms, on what would make this film excellent for this request: the transitions, rhythm, depth and hierarchy you are aiming for. The look rounds hold the film to it. |

## Placeholder example

This example only shows the shape of the file; do not copy its values. Every value is a placeholder, so it can never validate as-is, and a treatment whose free-text fields match it (after the brackets are removed) half or more exits 16 with `copiedExample`.

```json
{
  "request": "<the user's words, verbatim>",
  "genre": "<one genre>",
  "path": "<stage or type>",
  "pathReason": "<one sentence from the path rule>",
  "idea": "<one sentence>",
  "audience": "<who watches>",
  "channel": "<where it plays>",
  "format": "<16:9 or 9:16>",
  "formatReason": "<why, from the channel>",
  "durationSec": "<4–90>",
  "subject": { "name": "<name>", "source": "<user or invented>", "specifics": ["<what it is or does>", "<for whom>", "<one distinctive detail>"] },
  "beats": [
    { "t0": "<seconds>", "t1": "<seconds>", "purpose": "<arc stage>", "onScreen": "<what is drawn>", "motion": "<how it moves>", "sound": "<what the ear hears>" }
  ],
  "visualDevices": [{ "kind": "<kind>", "role": "<subject, support or texture>", "beats": ["<beat index>"] }],
  "typePlan": { "faces": ["<face>"], "hierarchy": "<which line leads and why>", "maxWordsOnScreen": "<count>" },
  "palette": [{ "hex": "<#RRGGBB>", "role": "<role>" }],
  "sound": { "mode": "<mode>", "plan": "<how the sound follows the arc>", "palette": "<timbre palette>", "key": "<key>", "tempo": "<BPM>" },
  "copy": { "source": "<user or invented>", "lines": ["<line>"] },
  "inventions": ["<each invented name, fact or line>"],
  "ambition": "<1–2 sentences in craft terms>"
}
```

## Genre arcs

Length comes from the arc. Give every stage at least one beat, and more beats where the subject has more to show.

- **announcement:** hook → context → key moment → details → close.
- **brand-mood:** motif → variation → peak → resolve.
- **event:** hook → what, when, where → highlight → close.
- **explainer:** question → steps → result → recap.
- **motion-graphics:** opening motif → set piece → set piece → peak → resolve.
- **type-led:** one breath per line, with emphasis and pause.
- **other:** at least three beats that set up, develop and land.

## Craft rules

Show the subject; do not only name it. With the sound muted and every word hidden, the drawn subject alone should still suggest what the film is about.

Aim for professional motion-design craft in every film: varied transitions (match cuts, masks, morphs), rhythm locked to the sound, layered depth, clear hierarchy, deliberate easing. Every beat shows something new. Length comes from the arc; never shorten the film or merge beats to pass a check.

When the request supplies words, keep them exactly and put them where the arc needs them. When it supplies no words, write the copy from `subject.specifics`: concrete nouns, numbers and actions that belong to this subject and no other. A line that could be pasted unchanged into a film about something else is not copy yet.

When the request names no subject, facts or words, invent a plausible, specific example subject and list every invented part in `inventions`. The reply labels them as examples, so the user can swap in the real ones. Never present an invention as a fact about the user.

Pick the format from the channel: a vertical feed is 9:16; a page embed, a talk or a screen is 16:9. Pick the duration from the arc and the genre floor, then give every beat enough time to read its words and see its motion.

Write `sound` beat by beat: a hit on a cut, a rise into a change, a closing cadence. The generated bed follows the beats' `sound` fields, so a vague field gives a vague bed.

## Sound

Under bare `lit` every film gets a generated bed unless the user asked for silence or supplied a track. The renderer builds it in code from `sound` and the beats, so two renders of one treatment give the same bytes: a tempo grid at `sound.tempo`, a pulse on every beat, and a pad that plays a chord progression in `sound.key` (minor: i, VI, III, VII; major: I, V, vi, IV), changing chord on every cut and resolving home on the last beat. It is normalized to -16 LUFS integrated (ITU-R BS.1770-4) with the sample peak at or under -2 dBFS, and it is exactly as long as the picture.

| `sound.palette` | Timbre |
| --- | --- |
| `air` | a breathy noise-and-sine pad over a brushed pulse |
| `felt` | a soft sine pad with a muted low thump and pluck |
| `glass` | bell-like FM tones with glassy ticks |
| `pulse` | a saw pad under a kick with offbeat hats |

Accents come only from the beats' `sound` fields, so write each one as the moment you want to hear:

| Words in a beat's `sound` | What the bed does |
| --- | --- |
| hit, impact, thump, punch, boom, 타격, 쿵 | a low hit exactly on that beat's cut |
| rise, build, swell, lift, sweep, 고조, 상승 | a rising sweep that lands on the beat's end |
| cadence, resolve, close, final, land, 마무리 | the home chord rung out from that beat's start |
| chime, bell, sparkle, shimmer, 반짝 | a bell arpeggio at the beat's middle |
| drop, hush, silence, pause, 쉼, 정적 | pad and pulse duck for that beat |

`node "$R" sound --out <dir>` writes the bed to `sound/bed.wav` and every cue (chord changes and accents, each with its time against its cut) to `sound-cues.json`; the look round reads that file to answer whether the sound follows the cuts. A supplied or authored track is always muxed: it is padded or trimmed to the picture with a 50 ms fade, never cutting the film short. The gate decodes the muxed stream and checks that it exists, matches the video's length within 0.1 s and peaks at or under -0.5 dBFS; a generated bed may not sit silent (under -50 dBFS) for more than 1.5 s in its first 3 s. A failed sound check exits 20. Label a generated bed as generated in the reply.

## When the treatment changes

Edit `treatment.json` whenever a look round asks for a change, then render again. The first valid treatment is kept in `.run/treatment-first.json`; the done-check compares the final one with it and records a downgrade when the film got more than 20 % shorter, lost subject beats, lost its sound without a request, or moved from the stage path to the type path. Fix the cause of a failed check instead of cutting the film.
