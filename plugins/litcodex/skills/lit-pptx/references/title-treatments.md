# Title treatments

A treatment decides how a slide title looks: its type step, its colour and what is drawn with it (a
rule, a band, a rail, a numeral, a dark panel). The compiler knows eight, and none of them moves the
title. Every content title stands in the slide grid's one title zone (`scripts/lib/slide-grid.js`:
columns 1-10, y 36, 72 pt tall) and the body starts at y 120, whichever treatment and whichever
tonality draws it; a statement stands in the display title zone and a cover in the cover zone. A deck
gets its variety from mixing three to five treatments across slide jobs, and a reader never has to
look for the title. The same grid is why two tonalities of one source differ in colour, type and
decoration but not in where anything sits.

## Two rules for every title

1. **A title is a label.** It names the subject, the measure and, where it matters, the period or
   place: "권역별 누수 탐지 건수, 2026년 1-9월", "Pump efficiency by duty point". The claim
   ("탐지 건수가 두 배로 늘었다") goes into the body as its first line or takeaway. Cover subtitles
   follow the same rule. The gate's OF-114 fails a declarative title: a Korean title whose last
   word ends in -다, -니다, -요 forms or a nominalised claim (-음, -함, -됨 outside 포함, 있음/없음); an
   English title with a final period or a finite verb (is, has, will, grew, fell, leads …). A
   trailing parenthesis is read without its contents. A question is allowed but rarely the best
   label.
2. **Nothing sits above the title.** No eyebrow, no kicker word, no category tag. A numeral beside
   a title is a real step, part or figure, never decoration, and never larger than the title step.

## How a slide gets its treatment

Each family belongs to a role, and each pack maps roles to a default treatment (`role-defaults`):

| Role | Families |
|---|---|
| content | text-column, text-two-column, summary-box-list, sidebar-note, agenda; closings other than closing-statement |
| data | kpi-row, kpi-over-chart, dashboard-grid, table-insight, ledger-table, matrix-2x2, comparison |
| data-takeaway | chart-insight, full-chart, big-number |
| sequence | process, step-diagram, timeline |
| image | image-full, image-split, photo-grid, figure-pair, figure-academic, asymmetric-feature |
| statement | statement, quote |
| definition | method |
| reference | references-appendix |

The compiler then lays the slide out under every treatment that both the family and the pack
allow. It keeps the role default when the body fills to the density band; otherwise it takes the
treatment with the smallest empty band, charging a cost for repeating the previous slide's
treatment and capping any fill-chosen treatment at about a third of the deck. Variance caps how
many distinct treatments the deck mixes. The `Treatments:` line of the compile output lists the
result per slide, and a `note:` names each slide that moved off its role default.

A pack may also give one family a title of its own under `structure`: Paper draws a comparison under
`top-rule` as a ruled table, Chalk draws it on its board rail under `side-rail`. That title comes
before the role default and stays even when the deck already leans on it, so two tonalities of one
source differ in structure and not only in colour. When the role default is a bottom title the slide
may not take (a table), the pack's next treatment in order stands in for it.

To pin one slide, add `title:` on the line after `layout:`. The compile stops with the allowed list
if the pack or the family does not allow that treatment, or if the title cannot fit its budget:

```markdown
---
layout: chart-insight
title: side-rail

## 권역별 누수 탐지 건수, 2026년 1-9월
…
---
```

Covers, sections and closings use their own variant's title and reject a `title:` key.

## The eight treatments

Positions are given in grid columns (1-12) and points on the 960 × 540 page: 24 pt side margins and
a 78 pt column pitch; the 4:3 canvas keeps the same y values. The density dial changes type and
spacing inside a zone and never the zone. Budgets are Korean glyphs at the title step; Latin text
takes roughly twice as many characters.

| Treatment | Title | Drawn with it | Body zone | Budget | Typical job |
|---|---|---|---|---|---|
| `top-rule` | the title zone, title step | a short accent rule or a full-width hairline just under the title | y 120-486 | two lines of about 23 | read-closely content and data pages |
| `top-plain-large` | the title zone, display step | nothing | y 120-486 | one line of about 17 (two of 21) | a comparison, a picture split, a page opening on one subject |
| `side-rail` | the title zone, title step | a bar in the left margin: the page's full height in the rail colour when the pack fills its rail, otherwise as tall as the title zone in the accent | y 120-486 | as `top-rule` | a chart or table with its reading, a method, definitions |
| `band` | the title zone, title step, in the on-field colour | the field colour from the page's top edge down to the foot of the title zone (y 108) | y 120-486 | as `top-rule` | Korean briefing pages; data pages on a dark deck; a newspaper masthead |
| `statement` | the display zone (columns 1-9, y 132-348), display or hero step, centred | an optional support line at y 372 | none; the words are the content | three lines of about 15 | a pull quote, or a display-led deck the user asked for |
| `overlay` | a dark panel at the lower left over a full-bleed picture | the panel at 88 % opacity, the caption on it | none; the picture is the content | two lines of about 15 | full-picture slides |
| `kicker-numeral` | the title zone, title step | the numeral at cover size in the aside zone right of the title (columns 11-12), in the accent colour; a part number, never an agenda's row count | y 120-486 | as `top-rule` | real steps, numbered recommendations |
| `bottom-anchor` | the title zone, title step | a heavy 3 pt rule across the columns at the foot of the zone (y 110) | y 120-486 | as `top-rule` | chart-, figure- and picture-led slides |

A title over budget makes the compiler move the slide to another allowed treatment and write a
`note:`. A pinned `title:` that cannot hold its title stops the compile instead, because the author
asked for something impossible; shorten the label or pin a different treatment.

## Which pack carries which

Read across a row to see what a pack can do; the bold entry is its default for that role.

| Pack | Treatments | content | data | data-takeaway | sequence | image | definition |
|---|---|---|---|---|---|---|---|
| Atlas | overlay, bottom-anchor, side-rail, top-plain-large, statement | **side-rail** | **top-plain-large** | **bottom-anchor** | **top-plain-large** | **overlay** | **side-rail** |
| Bauhaus | top-rule, side-rail, kicker-numeral, statement, bottom-anchor | **top-rule** | **top-rule** | **side-rail** | **kicker-numeral** | **bottom-anchor** | **side-rail** |
| Chalk | kicker-numeral, top-rule, side-rail, statement | **top-rule** | **top-rule** | **side-rail** | **kicker-numeral** | **side-rail** | **side-rail** |
| Computational Brutalism | top-rule, top-plain-large, side-rail, bottom-anchor, statement | **top-rule** | **top-rule** | **bottom-anchor** | **top-rule** | **bottom-anchor** | **side-rail** |
| Gazette | band, top-rule, kicker-numeral, side-rail | **band** | **top-rule** | **side-rail** | **kicker-numeral** | **side-rail** | **side-rail** |
| Ledger | top-rule, side-rail, kicker-numeral, bottom-anchor | **top-rule** | **top-rule** | **side-rail** | **kicker-numeral** | **bottom-anchor** | **side-rail** |
| Neo-Brutalism | top-plain-large, band, kicker-numeral, statement, bottom-anchor | **top-plain-large** | **band** | **top-plain-large** | **band** | **bottom-anchor** | **band** |
| Newsroom | band, bottom-anchor, top-rule, kicker-numeral, statement | **top-rule** | **band** | **bottom-anchor** | **kicker-numeral** | **bottom-anchor** | **top-rule** |
| Night | top-plain-large, statement, side-rail, kicker-numeral, band | **top-plain-large** | **band** | **side-rail** | **kicker-numeral** | **top-plain-large** | **side-rail** |
| Paper | top-rule, bottom-anchor, side-rail, statement | **top-rule** | **top-rule** | **bottom-anchor** | **top-rule** | **bottom-anchor** | **side-rail** |
| Riso | top-plain-large, band, kicker-numeral, statement, side-rail | **top-plain-large** | **band** | **top-plain-large** | **kicker-numeral** | **top-plain-large** | **side-rail** |
| Signal | statement, top-plain-large, bottom-anchor, top-rule | **top-plain-large** | **top-rule** | **top-plain-large** | **top-rule** | **bottom-anchor** | **top-rule** |
| Studio | side-rail, statement, top-plain-large, bottom-anchor, overlay | **side-rail** | **top-plain-large** | **side-rail** | **side-rail** | **bottom-anchor** | **side-rail** |

Statements default to `statement` where the pack has it; Ledger maps them to `side-rail` and
Gazette to `band`, which is why a claim in those packs becomes a labelled page with its evidence.
Families narrow the choice further: under Ledger `kpi-over-chart` allows only `top-rule`, under
Night `full-chart` only `top-plain-large`. `--list-layouts <pack>` prints the allowed treatments per
family.

## Picking with intent

- **A chart or table that needs a reading** goes under `side-rail` or `bottom-anchor`. The label sits
  beside or below the visual, and the visual gets the full height of the body.
- **A claim** never becomes a title. Put it in a `summary-box-list` box over its reasons, in the
  first line beside a table, or as the first takeaway under a chart. Reserve `statement` for a
  quoted sentence or a deck the user wants display-led; a lone sentence on a page under-fills it.
- **Numbered work** takes `kicker-numeral` only when the number exists in the content: the third
  step of a procedure, recommendation 2 of 4, part 03 of the agenda. A numeral on an unordered list
  is a defect the critique counts.
- **Korean desk-read pages** take `band`; the strong repeated head tells the reader where each page
  begins, and the body below can run at the compact step to the floor.
- **Pictures** take `overlay` only when the picture fills the page, and `bottom-anchor` when a large
  picture sits above its label.

Never move a title by hand with a free text box. The zone belongs to the slide grid; a nudged title
becomes a position the reader has to learn and breaks the one place every tonality keeps.

## How the gate reads titles

`qa_deck.py` classifies each title from the compiled file by geometry and companions, testing in
this order: overlay, band, statement, bottom-anchor, side-rail, kicker-numeral, top-plain-large,
top-rule. The compiler also writes the intended treatment into the title shape's name
(`title@side-rail`), and the gate compares the two; the name alone is never accepted as evidence.

| Check | Fails when |
|---|---|
| OF-110 | a deck of eight or more slides uses fewer than three treatments (cover and section titles not counted) or more than variance allows; or, at any length, a title fits none of the eight or is drawn as a different treatment than its name says |
| OF-113 | a title frame stands more than 1 pt off the deck's shared frame, whatever its treatment: every content title is measured against one frame and every statement against the display frame; a title over a full-bleed picture keeps its own panel |
| OF-116 | run with `--sibling other.pptx` on the same source compiled under another tonality: any slide whose title frame or body corner stands in a different place (1 pt tolerance) fails; a tonality changes the look and never the place |
| OF-114 | a title or cover subtitle is declarative (rule 1 above) |
| OF-115 | a column stops short beside a longer one, a title panel stands taller than its text, or a plate sits under an empty page |

Under a legacy template OF-110 and OF-113 report as advisories and OF-114 as MEDIUM, because the
user asked for that template's single title position.
