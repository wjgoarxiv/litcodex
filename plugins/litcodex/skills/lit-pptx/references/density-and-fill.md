# Density and fill

Two dials govern how a deck uses its pages. **Density** sets how much a page holds and how tightly
it is set. **Variance** sets how many title treatments and families one deck mixes. Every pack
ships with defaults (density 10 in all thirteen; variance 4-8), and the direction card records the
values actually used. Moves of 1 or 2 on either dial are the skill's call, noted on the card;
anything further waits for the user.

Fill is the reason density exists. Earlier decks put a short table at the top of a slide, stretched
cards to the height of their two lines, ended on a bare thank-you, and left the lower half of most
pages empty. The compiler now measures the empty band under each slide's last block, tries to
close it with the pack's fill policies, and the gate fails a deck whose median slide still wastes
more than a fifth of its body. The compiler can only grow what the source gives it, so most fill
is won or lost in how the source is written.

## The density dial

| Density | Grid, 16:9 side margin | Ramp | Body | Gaps item / group / block | Padding | Min table row | Empty band allowed |
|---|---|---|---|---|---|---|---|
| 1-2 | airy, 60 pt | presented | 24 for four items or fewer, else 18 | 18 / 36 / 48 | 24 | 36 | 28 % |
| 3-4 | standard, 48 pt | presented | 18, may step to 24 | 12 / 24 / 36 | 24 | 32 | 24 % |
| 5-6 | standard, 48 pt | reading | 14, may step to 18 | 6 / 18 / 24 | 18 | 24 | 18 % |
| 7-8 | dense, 36 pt | reading | 14, may step to 18 | 6 / 12 / 24 | 12 | 22 | 14 % |
| 9 | dense, 36 pt | reading | 14 | 6 / 12 / 24 | 12 | 20 | 12 % |
| **10 (default)** | compact, 24 pt | compact | 13 | 6 / 12 / 18 | 12 | 18 | 12 % |

**The compact step.** Density 10 uses the compact grid (24 pt margins, 54 pt columns, 24 pt
gutters, 78 pt pitch on 16:9) and the compact ramp: source 9, label 11, body 13, lead 18, title 26,
display 36, cover 44. The body starts at y 120 on every slide: the slide grid has one title zone (y 36-108)
and no treatment buys the body room by shrinking it. Up to 22 lines fit a text column. Type is never enlarged to fill on
this step. The readable floor holds everywhere: body 12 pt or more, table cells and captions 11 pt
or more, sources 9 pt or more.

**When to lower it.** Drop to 8 (dense grid, body 14 pt) for a deck shown on a stage or to a large
room and not read afterwards. Going below 8 needs the user's word. Never raise legibility by
shrinking content instead: cut or split the slide.

## The variance dial

| Variance | Treatments per deck | Same family back to back |
|---|---|---|
| 1-3 (only on request) | 1-2; the gate records "variety lowered by the user" | — |
| 4 | 3 | up to 3 |
| 5-6 | 3-4 | up to 3 |
| 7-8 | 4-5 | up to 2 |
| 9-10 | 5 | up to 2, and no family more than twice in the deck |

The ceiling is also bounded by how many treatments the pack owns (four in Chalk, Gazette, Ledger,
Paper and Signal; five in Atlas, Bauhaus, Computational Brutalism, Neo-Brutalism, Newsroom, Night, Riso
and Studio).

## Fill policies

When a content slide's empty band exceeds its density's allowance, the compiler walks the pack's
`fill-order` and keeps a step only if nothing overflows.

| Policy | What it does | Limits |
|---|---|---|
| `step-up` | body one ramp step larger, table data from label to body size, KPI values one step up | one step; never on the compact step; titles never shrink to make room |
| `distribute` | opens item, group and block gaps one step each, top edge fixed | peers keep equal heights; the body is never centred vertically |
| `anchor-visual` | lets a chart, figure or picture take the remaining height; table rows grow up to a quarter over the minimum | only when the slide has a visual |
| `change-family` | none by itself: the log says "choose a fuller family" | the author changes the source |

| Pack | fill-order |
|---|---|
| Atlas | anchor-visual, change-family, distribute, step-up |
| Chalk | distribute, step-up, change-family, anchor-visual |
| Gazette | step-up, distribute, change-family, anchor-visual |
| Ledger | step-up, distribute, anchor-visual, change-family |
| Night | anchor-visual, step-up, distribute, change-family |
| Paper | anchor-visual, distribute, step-up, change-family |
| Signal | step-up, change-family, anchor-visual, distribute |
| Studio | change-family, step-up, anchor-visual, distribute |

Each filled or unfillable slide leaves a line in the compile output, which belongs in the build log:

```text
fill: slide 6 band 0.38 -> 0.11 (distribute)
fill: slide 11 band 0.33 -> 0.33 (none: nothing on the slide can grow; choose a fuller family)
```

A column can stand empty beside a full one even when the body's last block reaches the floor: two
short takeaways beside a chart, a source line at the column's foot and nothing between. The engine
reads each text or picture column against the column beside it (its largest empty band, from the top
of the pair down to where the longer column ends) and fills a column that leaves more than 40 % of the
body empty, by layout only and in this order. When the compact step sets a chart's values as a small
table under the takeaways, that table belongs to their column: it moves down with them and takes a
share of the room like a point does.

- the visual takes columns: a narrower takeaway column wraps onto more lines while a wider chart or
  picture grows (down to three columns of takeaways; a picture keeps taking columns while either side
  leaves a fifth of the body empty), and no takeaway loses size for it;
- the takeaways step up to lead size when they fit and keep twelve glyphs a line;
- the room left is shared between the points, never more than a sixth of the body in one gap;
- two short points that still leave the column empty beside a chart stand under it side by side, and
  the chart with its values takes the body's width;
- a short sidebar note beside a long main column runs across the top at lead size, with the main
  points in two columns under it;
- summary groups of unequal length, split by count, can leave one column far shorter than the other;
  the split then moves to the group boundary that evens the columns most, and a head never leaves its
  points;
- a title under which a column still stays empty is unfit for the slide when another title fits.

The source strip at a column's foot counts as a block but never hides the band above it, and the
gate measures the same way (OF-115), with two additions: it reads a takeaway column that holds the
chart's values table (at the table's drawn height), and it reads every pair of columns whatever the
longer one's length, so a short note beside points that stop at two thirds of the body still fails.
Beside the figure rows of a kpi-row or big-number slide both read the takeaways' column down to the
body floor, since the rows stop where their spacing ends: short points run under the rows, or share
the room beside them when running under would leave a band between rows and points.
What the engine cannot refill, the source fixes: two or three takeaways computed from the slide's own
figures, or a real further group where the slide's subject has one; never smaller type or a decoration.

The treatment choice is also a fill decision: a slide whose body stays short under its role default
may be drawn under a side rail or a bottom title. Both draw in the same title zone as every other
treatment, so the body keeps its start at y 120 and its width; what changes is the surface the title
is set on. No policy adds decoration or pads a card to cover space.

A point written after two columns (`:::: columns` closing, then a bullet) is kept under them at the
body's full width, never dropped and never squeezed into a column, in `comparison` and
`text-two-column` alike.

**Two registers.** A report pack reads at the compact ramp above. A pack that declares `register: bold`
(Neo-Brutalism) sets the presented ramp instead (body 18 pt, labels 14, sources 12, titles 32, display
44) and may take the 72 pt hero step on a statement or a big figure. The compiler refuses presented
type in any other pack. Every pack takes its own hero step on a cover or statement title that fits
(60 pt on the report packs); a deck sets `hero: false` in its front matter to keep the calmer display
step. The register changes the size inside a zone, never the zone, so a bold deck holds fewer words per
slide and still starts its body at y 120.

## Writing a source that fills

Every rule below hands the compiler something real to place lower on the page.

- **Five supporting facts per content slide.** Beside the main point, give what a careful reader
  checks: the basis of each figure, a comparison (prior period, plan, peer), the period, the source,
  and the implication or next action.
- **End data slides with a strip.** A line `출처: …` / `Source: …` naming origin and date; optionally
  `주: …` / `Note: …` with a definition or a data fact (what a figure counts, its period, what it leaves out). A `주:` line never says what the slide is not for. These cost the takeaways no room, and the compiler
  moves them to the foot wherever they stand in the slide text. The examples keep a Korean `출처:`
  line directly under the table or picture it describes, so the attribution sits next to its
  evidence in the source file. On slides without a table or picture, and on the first slides after
  a section (whose opening lines a section page may preview), they fold the source into the `주:`
  line instead ("주: … 자료는 …").
- **KPI rows of four to six.** The table's second body row is each figure's basis ("목표 대비 +2.1%p",
  "전년 동기 1,940건"). Without it the row reads as decoration and the slide under-fills. Keep each
  value to 12 characters and each basis cell to 24; longer cells stop the table being read as a KPI
  row, and `cover-figures` then finds no headline figures and falls back to the plain cover.
- **Tables with real depth:** five to eight rows, four to six columns when the source has that much,
  units in the headers, totals in bold. Three rows or fewer usually wants `kpi-row` or `comparison` instead.
- **Two or three takeaways under every table and chart.** The row that matters, the comparison, the
  decision it supports. The chart's caption says what is plotted and marks the data as example data
  when it is.
- **Exact chart tables.** On the compact step a chart's values (up to eight rows, four columns) are
  shown as a small table under its takeaways, so write them with real precision and units.
- **Labelled comparison points.** Same label on both sides ("비용: …", "일정: …"), three or four
  criteria, each a full clause, equal count per side; they draw as a criteria column with rows that
  reach the floor together.
- **Steps that say what happens.** A process or timeline row names the action, the owner and the
  measure, not only the step name. A timeline's takeaways stand under its axis, so give it two or three
  of them: a single line leaves the band under the axis empty, and OF-109 fails it.
- **Panels, not lone numbers.** A `big-number` holds two to four related figures with labels and a
  basis row, a caption with period and source, and two or three lines of evidence.
- **A closing that asks.** The title labels the request; the body tables what is to be approved (item,
  amount, date, owner) and names the next step with its owner and date.
- **References with dates,** one per row, eight to ten entries; with only a few sources, add the
  definitions the deck relies on.
- **The label is the title, the claim is the body.** "권역별 누수율 추이", not "누수율이 세 분기 연속
  줄었다"; the sentence becomes the first takeaway.
- **No inflated numbers.** Report figures at the precision the source supports, keep units, and do
  not promote a modest change into a headline with words like "폭증" or "game-changing". A figure
  that appears twice is identical both times.
- **Merge before padding.** If a slide still has little to say, merge it into its neighbour or pick a
  family built for short content. Filler bullets that restate the title are a defect.

## How the gate measures fill

`qa_deck.py` works on the compiled file. The empty band is the part of the body under its lowest
content block, as a share of the body height; the body runs from the title's lower edge (or from the
top margin when the title sits at the bottom) to y 486. Decoration, the footer and the example notice do not count as content. Covers, sections,
statements, quotes and statement closings are exempt.

| Check | Rule |
|---|---|
| OF-112 | per slide: an advisory with a fix hint when the band exceeds the density allowance; per deck: fail when the median band over measured slides is above 0.20 |
| OF-109 | fail when any single slide or card leaves more than 35 % of its area as one empty band |
| OF-115 | fail when a region stands empty, among them a text or picture column whose largest empty band beside a longer column passes 40 % of the body (a source strip at its foot included) |
| OF-111 | fail when one composition (title zone × body partition × dominant content) covers more than 40 % of content slides, or too few distinct compositions appear |

A slide that cannot be filled honestly (a five-line agenda, a two-source appendix) may stay over its
allowance; the deck median must still hold. Shrinking text, inflating cards or adding shapes to pass
the gate is itself a defect that the critique records. On a legacy template the median check only
advises, since the legacy renderer cannot apply fill policies.
