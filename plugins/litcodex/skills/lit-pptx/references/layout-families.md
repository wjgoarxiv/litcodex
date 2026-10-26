# Layout families

Each family turns one job a slide can do into a fixed arrangement of the 12 columns. You pick it
with `layout:`; the tonality decides how it is drawn (allowed title treatments, table and chart style,
rules, fields, panels). There are 28 content families plus cover, section and closing variants.
No pack implements all of them: each carries the ones that suit its character, and the compiler
either stops or writes a `note:` when a source asks a pack for something it lacks.

Choose the family from what the slide must do for the reader. "Last slide was a chart, so this one
should be a table" produces a deck of shapes without jobs. A deck reads as varied when different
jobs get different shapes, and the gate measures exactly that from the compiled file (OF-111).

```bash
node "$OFFICE" pptx compile --list-tonalities
node "$OFFICE" pptx compile --list-layouts gazette   # families, allowed treatments, variants
```

## Families by job

Columns: what the family does, the source shape it reads, and the packs that carry it.

### Words

| Family | Job | Source shape | Packs |
|---|---|---|---|
| `text-column` | running text or a list that keeps a readable measure | bullets or 개조식 groups (`- **head**` then `(1)` sub-points); an image turns it into a picture-and-text split | atlas, chalk, gazette, paper |
| `text-two-column` | a long list with two parallel halves | groups split near the middle, or an explicit `:::: columns` block | bauhaus, computational-brutalism, gazette, ledger, newsroom, riso, studio |
| `summary-box-list` | a boxed conclusion over two columns of evidence | `::: key-message` for the box (else the first line), groups under it | gazette, neo-brutalism, riso |
| `sidebar-note` | a main point fenced off from its definition or common mistake; a note too short for its column runs across the top at lead size with the main points in two columns under it, and under a side title it stands in the rail | groups, then `::: main-box` (or a last list) that becomes the note | chalk, newsroom, riso |
| `agenda` | the parts of the deck, numbered | `- **Part** what it covers` lines | bauhaus, chalk, gazette, ledger, neo-brutalism, riso |
| `statement` | a pull quote, or a display-led deck on request | the `##` text is set large; one body line becomes the support line | atlas, bauhaus, chalk, computational-brutalism, neo-brutalism, newsroom, night, paper, riso, signal, studio |
| `quote` | a quoted sentence with its speaker | the quote as a line, the source as a line starting with `—` | bauhaus, chalk, computational-brutalism, neo-brutalism, newsroom, paper, riso, signal |

### Numbers

| Family | Job | Source shape | Packs |
|---|---|---|---|
| `kpi-row` | two to six headline figures | a table: head row of labels, first body row of values, second body row of each figure's basis; then evidence bullets | atlas, bauhaus, computational-brutalism, ledger, neo-brutalism, newsroom, night, riso, signal, studio |
| `kpi-over-chart` | headline figures over the trend behind them | a KPI table, then a `::: chart` block, then bullets | ledger, newsroom, night |
| `big-number` | two to four related figures as a data panel | a KPI table (labels, values, basis row), a `>` caption, two or three evidence lines | bauhaus, ledger, neo-brutalism, newsroom, night, riso, signal, studio |
| `dashboard-grid` | two to four small charts read together | two or more `::: chart` blocks, then a line or two of takeaway | computational-brutalism, ledger, night |

### Tables and charts

| Family | Job | Source shape | Packs |
|---|---|---|---|
| `table-insight` | a table with its reading beside it | a pipe table, a `>` caption, then bullets | bauhaus, chalk, computational-brutalism, gazette, ledger, neo-brutalism, newsroom, paper, riso, signal |
| `ledger-table` | a full-width table that is the evidence | a wider table (five to eight rows, four to six columns), caption, bullets under it | computational-brutalism, gazette, ledger |
| `matrix-2x2` | options placed on two axes | a 3 × 3 table: corner cell `효과 \ 난이도`, two column heads, two row heads, cells written `item · detail · detail`; caption and takeaways after | computational-brutalism, gazette, ledger |
| `comparison` | two sides read across, criterion by criterion | `:::: columns` with a `**head**` and `(1)` `(2)` points per side; identical `기준: …` labels on both sides become a criteria column, in the rail under a side title; a label longer than three words does not count as one, so the points stay whole and stay out of the rail | all thirteen |
| `chart-insight` | one chart with two or three takeaways | a `::: chart` block, then bullets | bauhaus, computational-brutalism, ledger, neo-brutalism, newsroom, night, paper, riso, signal, studio |
| `full-chart` | one chart that needs the width | a `::: chart` block, an optional note | computational-brutalism, ledger, newsroom, night, paper, signal |

### Sequences and methods

| Family | Job | Source shape | Packs |
|---|---|---|---|
| `process` | three to five ordered steps | `- **1. 단계** what happens` lines, optional `(1)` sub-points | bauhaus, chalk, neo-brutalism, riso, signal |
| `step-diagram` | steps taught one at a time | as `process` | bauhaus, chalk, computational-brutalism, neo-brutalism, riso |
| `timeline` | dated events on one axis | a table `시점 \| 할 일 \| 담당` (or `- **date** event` lines), then takeaways | atlas, bauhaus, gazette, ledger, newsroom, night, riso, studio |
| `method` | a formula or figure with its terms | a text line or an image, then `- **term** meaning` bullets | chalk, computational-brutalism, night, paper |
| `references-appendix` | sources and definitions, one per row | `- [1] …` lines; links as real Markdown links | computational-brutalism, gazette, ledger, newsroom, paper |

### Pictures

| Family | Job | Source shape | Packs |
|---|---|---|---|
| `image-full` | one picture as the page, title on a panel | an image with a caption `도 1. … \| 출처: …` | atlas, studio |
| `image-split` | a picture beside its explanation | an image, then bullets | atlas, bauhaus, chalk, neo-brutalism, newsroom, riso, signal, studio |
| `photo-grid` | two or three pictures compared | two or three image lines, then one line of text | atlas, riso, studio |
| `figure-pair` | before and after, or two conditions | two images, then one line of text | atlas, newsroom, paper |
| `figure-academic` | a numbered figure and how to read it | an image with numbered caption and source; observation, basis, sample, implication bullets | paper |
| `asymmetric-feature` | one large element and a narrow text column | an image or a one-cell figure, then bullets | atlas, bauhaus, signal, studio |

Older layout names still resolve under a tonality: `content` and `main` become `text-column`,
`summary` becomes `comparison`, `closing` becomes `closing-statement`, and bare `cover` or `section`
take the pack's first variant (the compile log says which).

## Covers, sections, closings

These are variants. Name one (`layout: cover-index`); the compiler draws it if the pack lists it and
the deck holds what it needs, else it takes the pack's first drawable variant and writes why.

| Pack | Covers (first is the default) | Sections | Closings |
|---|---|---|---|
| Atlas | cover-full-image, cover-split-image, cover-typographic | section-image, section-field | closing-contact-split, closing-ask |
| Bauhaus | cover-typographic, cover-split-field, cover-numeral | section-field, section-numeral | closing-ask, closing-summary-list, closing-statement |
| Chalk | cover-rail, cover-typographic, cover-numeral | section-numeral, section-rail | closing-summary-list, closing-ask |
| Computational Brutalism | cover-typographic, cover-index, cover-figures | section-numeral, section-rule | closing-decision-box, closing-ask, closing-summary-list |
| Gazette | cover-band, cover-typographic, cover-index | section-band, section-rule | closing-decision-box, closing-ask |
| Ledger | cover-figures, cover-typographic, cover-index | section-rule, section-numeral | closing-decision-box, closing-ask |
| Neo-Brutalism | cover-typographic, cover-split-field, cover-numeral | section-field, section-numeral | closing-ask, closing-decision-box, closing-statement |
| Newsroom | cover-typographic, cover-figures, cover-index | section-rule, section-numeral | closing-summary-list, closing-statement, closing-ask |
| Night | cover-numeral, cover-typographic, cover-figures | section-numeral, section-field | closing-statement, closing-decision-box |
| Paper | cover-index, cover-typographic, cover-split-image | section-rule, section-field | closing-summary-list, closing-ask |
| Riso | cover-typographic, cover-numeral, cover-split-field | section-field, section-numeral | closing-ask, closing-summary-list, closing-statement |
| Signal | cover-numeral, cover-typographic, cover-split-field | section-field, section-numeral | closing-statement, closing-ask |
| Studio | cover-split-image, cover-rail, cover-numeral | section-numeral, section-rail | closing-contact-split, closing-summary-list |

What each variant needs from the deck:

| Variant | Draws | Needs |
|---|---|---|
| `cover-figures` | the title over the deck's headline figures | a KPI row somewhere in the deck |
| `cover-index` | the title beside the list of parts | an agenda, or two or more sections |
| `cover-numeral` | a real year or figure, at title size at most, over the title | a year in the title or the date |
| `cover-split-image`, `cover-full-image` | the title beside, or on a panel over, the deck's first picture | an image in the deck |
| `cover-band`, `cover-rail`, `cover-split-field`, `cover-typographic` | the pack's band, rail, half field or cover device | nothing |
| `section-numeral`, `section-rule` | the part number and title; with an agenda, an index page with this part marked | nothing; a lone section with no agenda draws no numeral |
| `section-band` | the part index inside the band, the part title under it with the titles of the slides it opens | nothing |
| `section-field`, `section-rail`, `section-image` | the part title on a field, in the rail, or on the section's picture | `section-image` needs an image on that slide |
| `closing-ask` | the ask as title, its table as action rows keyed by amount or date, the next step on the floor | a table or bullets |
| `closing-decision-box` | the decision boxed, the items to approve as action rows under it | a line or bullets, optional table |
| `closing-summary-list` | the takeaways numbered down the page | bullets |
| `closing-contact-split` | action rows beside a field holding each row's amount or date; the next step as a band meeting the field | a table or bullets, plus a short text |
| `closing-statement` | one closing sentence | no table, no image |

A closing is a content slide whose title labels the ask ("유지보수 예산 1억 2천만 원 집행 요청"). A
slide that only says "감사합니다" or "Questions?" is not a closing.

## Display devices

Covers, statements, big numbers and closings hold little text, so each pack names the device that
lets them hold the page (`display:` in the pack). A device frames what the deck already contains; it
never adds words or numbers.

| Pack | cover | statement | number panel | closing floor | section index |
|---|---|---|---|---|---|
| Atlas | plate (field plate under half the page) | drench (whole slide in the field) | tint | band | — |
| Bauhaus | geometry (title left, elementary composition right) | geometry (sentence left, narrower composition from column 10) | field | rules | — |
| Chalk | rail | drench (whole slide in the field) | tint | box | — |
| Computational Brutalism | drench (the black terminal field, topic in phosphor) | drench | outline | box | — |
| Gazette | band | — | outline | box | yes |
| Ledger | figures | — | tint | box | yes |
| Neo-Brutalism | plate (blue plate across the lower half, bordered) | drench (blue) | field | box (bordered, with its shadow) | — |
| Newsroom | band (the black masthead band) | rules | tint | rules | yes |
| Night | numeral | open | tint | band | — |
| Paper | rules (journal title page) | rules | outline | rules | yes |
| Riso | drench (teal) | drench (teal) | field | band | — |
| Signal | drench (field edge to edge, title low) | open | field | band | — |
| Studio | first cover variant | rules (a hairline over the sentence and one under its support line; the offset rail stood empty beside it) | tint | band | — |

`geometry` is the one device that draws shapes of its own: a square in the accent tint, a circle in
the accent, a bar in ink and a triangle in the field, each placed in its own grid cell and never used
as a bullet, icon or frame on a content slide. A drenched statement, a cover and a section opener go
without the grid marks and the slide index that Computational Brutalism draws on content slides.

## What the compiler does on its own

These behaviours are engine-side; authors should know them so they stop fighting them.

- **Line breaking.** Wrapped titles are split into lines of near-equal width with at least two words
  on the last line where possible. Body text and table cells are broken at spaces by the compiler,
  so a number keeps its unit ("51점", "4 분기", "(10월 14일)") instead of being split by the renderer, and a
  short parenthetical such as "(▲ +3.9%)" (up to 16 characters) stays whole on its line.
- **Figures stay at title size.** KPI values, panel figures, action keys, cover figures and section
  numerals never exceed the title step. A big number is two to four figures, one row each (value,
  label, basis), on a panel seven of twelve columns wide, its evidence beside it.
- **Sections count themselves** from the agenda when the title matches an entry ("02 / 05"); with no
  agenda and several sections they count sections; a single section gets no numeral.
- **Closing tables become action rows.** The key column is the one with amounts in one unit (each
  row then draws its share bar), else the one headed as a date or deadline, else the last column.
  Totals rows (`합계`, `Total`) are never action rows; cells holding only "—" are dropped.
- **Source strips.** A line starting `출처:`, `자료:`, `주:`, `Source:` or `Note:` on a content slide is
  becomes a strip along the bottom of the body, set at source size. On a closing it joins the
  next-step line instead.
- **Short content spreads.** Up to four process steps run as rows; bold-headed points become rows with
  the head beside the point; groups of sub-points run in two columns; table takeaways stand in the
  room under the table. The compact step never enlarges type to fill; instead a short KPI row turns
  into figure rows next to its takeaways, a chart lists its values in a compact table below them,
  and a method runs its formula across the top with the terms in two columns.
- **Dark pieces stay under half.** Any plate, rail or panel short of a full-page field takes less than
  half the page, so the ground colour still reads as the page.

## Same family, different treatment

Much of a deck's variety comes from one family drawn under different titles:

- `side-rail`: KPI rows run as value rows down the body; processes read top to bottom; a chart takes
  columns 5-12 at full height. The rail under the title carries the slide's supporting content: a
  comparison's criteria labels level with their rows, the takeaways of a chart, picture, figure row
  or number panel (a chart's values as a small table under them when they fit), and the source line
  at its foot. A table gives its takeaways to the rail only when the table, its rows opened, still
  fills the body.
- `bottom-anchor`: the title zone stays where every treatment keeps it, closed by a heavy rule over a
  visual that takes the body's full height; a big number stands on its panel there. A table takes a bottom title only
  when no other title fits it.
- `band`: the body starts under the band and runs to the floor at reading size.
- `statement` with `quote`: the quotation becomes the slide's sentence and the speaker the support
  line; the `##` label of that slide is not shown.

Beside a chart, figure or picture under a top title, the source and note lines close the takeaway
column instead of running across the foot, so the column reaches the floor with the visual; takeaways
that still leave more than 40 % of that column empty are set one step up when they fit. Process rows
under a top title do the same when the reading measure would leave a quarter of the body empty. The
gate's OF-115 reports a column, rail, title panel or bottom-title floor left empty.

## Charts and figures under a tonality

A `::: chart` takes the pack's chart style. With several series, the accent goes to one: the latest
period when every series names one ("2026" over "2025", "Q3" over "Q2"), else the measured series
beside a plan, target, budget or prior period ("실적" over "계획"), else the last column, so put the
proposed or current series last when the names say neither. Data labels keep the decimals the table
writes: beside a table that says 46.0, the label says 46.0.

A plot or diagram exported as a picture on white stands as a white card on a dark tonality. Put a dark
variant beside it, named like the file with `.dark` before the extension (`assets/flow.png`,
`assets/flow.dark.png`): a dark tonality draws the variant, a light one the original. A `::: chart`
block is better still, since every tonality draws it in its own colours. OF-117 fails a picture that
is mostly near-white on a dark ground.

Korean text runs and charts with Korean labels are written as ko-KR (Latin-only runs stay en-US), so a
renderer applies Korean spacing rules to them.

## Variety pass and notes

After choosing titles by fill, the compiler checks the deck the way OF-111 reads it (title zone ×
column partition over content slides, closings excluded). If too few distinct layouts appear, it
moves a data slide that shares a layout to a title that adds a new one, provided the slide neither
overflows nor exceeds its density band, and logs `variety: slide N drawn under <title> …`.

Read every `note:` line after a compile. Each one says the source asked for something this
direction does not do: a missing family, an undrawable variant, a title moved for fill or budget.
The fix is a different family for that slide, a shorter label, or a different tonality chosen
through `direction-step.md`. Notes are never silenced.
