# Direction step

A deck's look is decided once, at the start, and written down. The decision names a tonality: a
pack of palette, faces, title treatments, layout families, decoration and two dials (density,
variance) that the compiler reads as data. Thirteen tonalities ship with this skill; four older
single-look templates stay available for users who ask for them by name. Skipping the step is
how every deck ends up blue and white regardless of subject, so the build does not start until
the direction card below exists.

The step costs a few minutes. Close the brief, take the deck type's candidates, count the outline,
reorder, ask the user to choose with the SKILL.md "Choose the design first" step (the ranked pick first, the
two alternatives, a compare option and the slide frame; skipped when the brief names them or hands the choice
over, and under a bare `lit`), write the card from the answer, and tell the user the pick with two
alternatives. The ranking only proposes. A brief that leaves the look open on purpose also gets the compare
strip, and a dial needs the user when it must move further than the skill is allowed to move it unasked.

## Inputs: four facts about the brief

Write these down before ranking. Where the brief is silent, infer from the request and the
attached material, and mark the line `(inferred)` so the user can overrule it.

| Fact | What to record | Why it matters |
|---|---|---|
| Deck type | one of the thirteen rows below, or "other, closest to …" | picks the candidate list |
| Reader | who, in what setting, for how long ("투자 심사역 4명, 회의실, 15분") | presented vs read, glyph budget |
| Delivery | spoken live, sent ahead and read alone, or both | moves Gazette and Ledger |
| Language | Korean, English, mixed | Korean bodies carry about half the characters of Latin ones |

## Candidates by deck type

Each type has an ordered list. The first entry wins when no signal moves the order. Every pack
now starts at density 10 (the compact step); the variance shown is the pack default.

| Deck type | First | Second | Third |
|---|---|---|---|
| 투자·제안 피치 (pitch) | Signal, v6 | Studio, v8 | Atlas, v7 when the product is something people look at |
| 경영 실적 보고 (business review) | Ledger, v5 | Gazette, v4 when circulated in Korean and read alone | Night, v6 when shown on a stage screen |
| 연구 발표 (research talk) | Paper, v5 | Night, v6 for a keynote hall | Chalk, v6 for a tutorial-style talk |
| 강의 (lecture, teaching) | Chalk, v6 | Paper, v5 | Studio, v8 for a public lecture |
| 데이터 리뷰 (data-heavy review) | Night, v6 | Ledger, v5 | Paper, v5 for a written analysis |
| 이미지 중심 (product, site, portfolio) | Atlas, v7 | Studio, v8 | Signal, v6 for a launch with few pictures |
| 보고서형 덱 (Korean text briefing) | Gazette, v4 | Ledger, v5 | — |
| 주간·월간 보고 (status update) | Ledger, v5 | Gazette, v4 | Night, v6 |
| 런칭·데모데이·캠페인 (launch, demo day, campaign) | Neo-Brutalism, v7 | Signal, v6 | Studio, v7 |
| 아키텍처·인프라 리뷰 (engineering or developer review) | Computational Brutalism, v7 | Night, v6 | Ledger, v5 |
| 디자인·건축·전시 강의 (design or culture lecture) | Bauhaus, v7 | Studio, v8 | Atlas, v7 |
| 커뮤니티·문화·교육 프로그램 (community or education programme) | Riso, v7 | Studio, v7 | Bauhaus, v7 for a design programme |
| 주민·독자 대상 데이터 브리핑 (data story for the public) | Newsroom, v6 | Gazette, v4 when read alone | Ledger, v5 |

## Reordering signals

Draft the outline first: one line per slide with its message and the visual it needs (table,
chart, picture, steps, quote). Count on that outline, never on the raw source. Apply the rows in
this order; a tie keeps the deck-type order, which makes the result repeatable.

| # | Signal | Fires when | Effect |
|---|---|---|---|
| 1 | Named tonality | the brief or an earlier turn names one, or names its style: 네오 브루탈리즘 / neo-brutalism, 컴퓨테이셔널 브루탈리즘 / terminal / retro-futurist, 바우하우스 / Bauhaus, 리소 / risograph / zine, 뉴스룸 / data journalism | use it; the card is still written. A bare 브루탈리즘 / brutalist means Neo-Brutalism for a pitch or launch and Computational Brutalism for a technical deck |
| 2 | Named legacy template | AZURE-PRO, AZURE-A2Z, BOILERPLATE-PRETENDARD or BOILERPLATE-A2Z is asked for | use it as named; offer two tonalities as alternatives |
| 3 | Read, not presented | "미리 배포", "보고서", "circulated", "pre-read" | Gazette (Korean) or Ledger (other languages) to the front |
| 4 | Table share | 30 % of content slides or more carry a table | Ledger or Gazette up one |
| 5 | Chart share | 30 % or more carry a chart | Ledger, Night or Paper up one |
| 6 | Picture share | 30 % or more carry a photo, render or screenshot | Atlas or Studio up one; Gazette down one |
| 7 | Long bodies | average 150 Korean glyphs (300 Latin characters) or more per content slide | Gazette or Ledger up; Signal down |
| 8 | Short bodies | average 40 Korean glyphs (80 Latin characters) or fewer | Signal or Studio up; density stays 10, because source strips and basis rows fill the room |
| 9 | Citations | numbered references, DOIs or a references slide | Paper up one |
| 10 | Teaching structure | definitions, formulas, or a how-it-works sequence of three steps or more | Chalk or Paper up one |
| 11 | Dark room | keynote, stage, demo day | Night up one |
| 12 | Missing shape | the pack has no family or treatment for one of the outline's slides | drop that pack |
| 13 | Engineering content | metrics with units, versions or identifiers (p99, rps, v3), commands in the text | Computational Brutalism up one |
| 14 | Launch audience | a young or consumer audience with a sign-up or funding ask | Neo-Brutalism up one |
| 15 | Works and makers | works, makers, periods, a sequence of ideas | Bauhaus up one |
| 16 | Community programme | participants, sessions, dates and places for a public audience | Riso up one |
| 17 | Public data story | one chart per idea for readers outside the field, a source on every figure | Newsroom up one |
| 18 | Weighty subject | a board, finance, public-sector, grief, safety or HR topic | Neo-Brutalism, Computational Brutalism, Bauhaus and Riso drop out |

Row 12 decides more often than it seems. Computational Brutalism sets Hangul in Pretendard inside a mono face, so a long Korean reading deck loses most of its look. Newsroom needs figures: a deck with no chart or table has nothing to colour. Atlas carries no table family. Ledger and Gazette have no
`statement` treatment or family. Signal has no `ledger-table` and no `dashboard-grid`. Paper has no
`kpi-row`. Chalk has no chart family. Gazette has no picture family. Check with `--list-layouts`
before committing:

```bash
node "$OFFICE" pptx compile --list-tonalities
node "$OFFICE" pptx compile --list-layouts night
```

**Worked case.** A twelve-slide English review of a city water network's leak programme, for the
utility board and its analysts, presented in the board room and filed afterwards. Type: data-heavy
review, so Night, Ledger, Paper. Of ten content slides, five hold a chart (50 %) and two a table
(20 %). Row 5 fires and lifts all three candidates alike, so it leaves their order unchanged; row 4
stays below its threshold. Bodies average about 210 Latin characters, so neither text row fires,
and nothing says the file is sent ahead. Night stays first. Had a third table slide been planned,
row 4 would have lifted Ledger past Night; the card says so in its "wrong if" line, together with
the printed board pack, which favours Ledger's white pages.

## The direction card

The card is the decision on record. Every field is filled; a build that cannot write the tonality
and its reason stops and asks, because there is no silent default look.

| Field | Content |
|---|---|
| Deck type | the type row used, or "other, closest to …" |
| Reader | who, where, how long |
| Tonality | the chosen pack id, then the two alternatives |
| Reason | one sentence linking the pick to the reader and to the signals that fired |
| Signals fired | the row numbers or names from the table above |
| Dials | density and variance, with any move from the pack default and its reason |
| Treatments | the role → treatment map from the tonality sheet, with any planned pins |
| Families planned | one family per slide, in deck order, each from the pack's list |
| Wrong if | the one fact that, if true, means the other alternative should have won |

```text
Direction card
  Deck type        data-heavy review (데이터 리뷰)
  Reader           utility board and two analysts, board room projector, 20 minutes; filed afterwards
  Tonality         night        alternatives: ledger, paper
  Reason           chart-led review watched on a projector: 50 % chart slides, tables under 30 %
  Signals fired    5 chart share
  Dials            density 10, variance 6 (pack defaults)
  Treatments       content top-plain-large · data band · data-takeaway side-rail · sequence kicker-numeral
  Families planned cover-figures, kpi-row, full-chart, chart-insight, chart-insight, dashboard-grid,
                   section-numeral, big-number, timeline, comparison, kpi-over-chart, closing-decision-box
  Wrong if         the deck is printed into the board pack, or a third table slide joins; then Ledger
```

**Dials.** Density (1-10) sets margins, gaps, body size and the empty band a slide may leave.
Variance (1-10) caps how many title treatments and families one deck mixes and how often a family
may repeat. Moves of 1 or 2 on either dial are the skill's own call and go on the card; bigger
moves wait for the user. The usual move is density 10 → 8 for a deck shown to a
large hall. Variance under 4 happens only when the user wants a uniform deck; the gate then notes
the reduced variety rather than passing it quietly. See `density-and-fill.md`.

**Treatments and families.** Copy the role map from the tonality sheet; pick a family per slide
from the pack's list. The compiler may still choose another allowed treatment for a slide whose
body fills better under it, and the compile log names each such move.

## Telling the user, keeping the log

The reply states the pick, the reason in plain words, and the two alternatives, in two or three
sentences, before or with the files. For example: "Night로 만들었습니다. 차트가 슬라이드 절반이고
이사회가 프로젝터로 보는 자료라서입니다. 인쇄해서 배포한다면 Ledger, 서면 분석으로 남긴다면 Paper가
더 맞습니다."

Keep a build log next to the source. It holds the card, the compile output's `note:`, `fill:`,
`variety:` and `Treatments:` lines, and the gate result. It is working evidence; it is not a slide
and is handed over only when the user asks for the audit trail.

```text
<deck>.md          source with tonality: in the frontmatter
<deck>.build.md    direction card, compile lines, gate result
<deck>.pptx        compiled deck
```

## Compare strip

Build one when the user asks to see options, or the brief leaves the look open on purpose ("어떤
느낌이 좋을지 모르겠어요", "show me a couple of styles"). Take the deck's frontmatter and its first
three slides, compile them under the chosen pack and both alternatives, render, and show three
labelled rows before writing the rest. Content and order are identical across rows; only
`tonality:` changes.

```bash
for t in night ledger paper; do
  sed "s/^tonality: .*/tonality: $t/" strip.md > "strip-$t.md"
  node "$OFFICE" pptx compile "strip-$t.md" --pptx "strip-$t.pptx"
  soffice -env:UserInstallation="file://$PWD/.lo" --headless --convert-to pdf "strip-$t.pptx"
done
```

Do not lobby for a row in the message beyond the card's reason. When the user picks, rewrite the
card's reason as "chosen by the user from the compare strip" and build the deck under that pack.

## Named legacy templates

AZURE-PRO, AZURE-A2Z, BOILERPLATE-PRETENDARD and BOILERPLATE-A2Z keep their single look. They are
used only when the user names one or an existing source already carries `template:`; they are
never picked by the table. The card still gets written (Tonality: the template name), the reply
still offers two tonalities, and the gate downgrades the variety and median-band checks to
advisories, since asking for a template by name means asking for its one look.

## What goes wrong

- Picking by topic ("a startup, so Signal") without counting the outline.
- A reply that names one look and no alternatives, or names none.
- A reason that repeats the deck type instead of naming the signals.
- A dial moved by three or more without the user's word.
- Forcing a slide into a family the pack lacks; the compile notes the substitution, and the fix is
  another family for that slide or another pack.
- Swapping the tonality after all slides are built without updating the card and the reply.
- A card whose "wrong if" line could never be checked ("if the user dislikes it").

## Example library

Every file in `examples/` compiles under its tonality and passes `node "$OFFICE" pptx qa`. Read the
closest one before writing a new deck. Data in all of them is invented and marked as such.

| File | Deck type | Tonality | Alternatives |
|---|---|---|---|
| `01-pitch-signal-ko.md` | pitch | Signal | Studio, Atlas |
| `02-pitch-studio-en.md` | pitch for a physical product | Studio | Signal, Atlas |
| `03-business-review-ledger-ko.md` | business review | Ledger | Gazette, Night |
| `04-research-talk-paper-en.md` | research talk | Paper | Night, Chalk |
| `05-research-keynote-night-ko.md` | research talk in a keynote hall | Night | Paper, Chalk |
| `06-lecture-chalk-ko.md` | lecture | Chalk | Paper, Studio |
| `07-data-review-night-en.md` | data-heavy review | Night | Ledger, Paper |
| `08-field-report-atlas-ko.md` | image-led field report | Atlas | Studio, Signal |
| `09-briefing-gazette-ko.md` | Korean text briefing | Gazette | Ledger |
| `10-status-update-ledger-en.md` | status update | Ledger | Gazette, Night |
| `11-portfolio-studio-ko.md` | image-led portfolio | Studio | Atlas, Signal |
| `12-tutorial-chalk-en.md` | technical tutorial | Chalk | Paper, Night |
| `13-status-update-gazette-ko.md` | status update read at a desk | Gazette | Ledger, Night |
| `14-engineering-review-computational-brutalism-ko.md` | engineering review | Computational Brutalism | Night, Ledger |
| `15-launch-pitch-neo-brutalism-ko.md` | launch pitch | Neo-Brutalism | Signal, Studio |
| `16-design-lecture-bauhaus-ko.md` | design lecture | Bauhaus | Studio, Atlas |
| `17-community-programme-riso-ko.md` | community programme | Riso | Studio, Bauhaus |
| `18-public-data-briefing-newsroom-ko.md` | data story for the public | Newsroom | Gazette, Ledger |

Examples that place pictures reference `assets/example-a.png`, `assets/example-b.png` and
`assets/example-c.png` next to the source. Put real images under those names, or change the paths,
before compiling one of them.
