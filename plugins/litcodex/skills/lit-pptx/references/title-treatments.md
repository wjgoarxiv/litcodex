# Title treatments

A treatment answers four questions about a slide title at once: where the frame sits, at which
type step, in which colour, and what is drawn with it (a rule, a band, a rail, a numeral, a dark
panel). The compiler knows eight. Each has one fixed frame, so every slide drawn under the same
treatment puts its title in the same spot to the point. Variety comes from mixing three to five
treatments across slide jobs, not from nudging titles around: readers learn a few fixed positions
quickly as long as each position always signals the same kind of page.

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

Positions are given in grid columns (1-12) and points on the 960 × 540 page. The default compact
grid (density 10) has 24 pt side margins and a 78 pt column pitch; other grids keep the same column
spans and y values. Budgets are Korean glyphs at the title step (26 pt on the reading and compact
ramps); Latin text takes roughly twice as many characters.

| Treatment | Frame | Drawn with it | Body zone | Budget | Typical job |
|---|---|---|---|---|---|
| `top-rule` | columns 1-12, y 36, title step | a one-column accent rule or a full-width hairline about 6 pt below | from about y 92 on the compact step (y 120 elsewhere) to 486 | one line, about 27 | read-closely content and data pages |
| `top-plain-large` | columns 1-10, y 36, display step | nothing | starts 18-24 pt below the title | two lines of about 16 | a comparison, a picture split, a page opening on one subject |
| `side-rail` | columns 1-4, y 36, title step, top-aligned with the body | optional rail fill (surface or field) or a hairline at column 4; under the title the rail holds the slide's criteria labels, takeaways and source | columns 5-12, y 36-486 | four lines of about 8 | a chart or table with its reading, a method, definitions |
| `band` | inside a full-width band 108 pt tall | the band in the field colour, title in on-field | y 120 (compact) or 132 to 486 | one line, about 25 | Korean briefing pages; data pages on a dark deck |
| `statement` | columns 1-10, centred between y 120 and 486, display step | an optional support line under it | none; the words are the content | three lines of about 16 | a pull quote, or a display-led deck the user asked for |
| `overlay` | dark panel at the lower left over a full-bleed picture | panel at 88 % opacity, caption on it | none; the picture is the content | two lines of about 15 | full-picture slides |
| `kicker-numeral` | numeral in columns 1-2, title in columns 3-12 | numeral in the accent colour (a part number, never an agenda's row count), never above title size | y 120-486 | one line, about 23 | real steps, numbered recommendations |
| `bottom-anchor` | columns 1-9, the title frame's bottom edge on the body floor (y 486), leaving no band under it | optional hairline 12 pt above the title | y 36 to 24 pt above the title, for the visual | two lines of about 20 | chart-, figure- and picture-led slides |

A title over budget makes the compiler move the slide to another allowed treatment and write a
`note:`. A pinned `title:` that cannot hold its title stops the compile instead, because the author
asked for something impossible; shorten the label or pin a different treatment.

## Which pack carries which

Read across a row to see what a pack can do; the bold entry is its default for that role.

| Pack | Treatments | content | data | data-takeaway | sequence | image | definition |
|---|---|---|---|---|---|---|---|
| Atlas | overlay, bottom-anchor, side-rail, top-plain-large, statement | **side-rail** | **top-plain-large** | **bottom-anchor** | **top-plain-large** | **overlay** | **side-rail** |
| Chalk | kicker-numeral, top-rule, side-rail, statement | **top-rule** | **top-rule** | **side-rail** | **kicker-numeral** | **side-rail** | **side-rail** |
| Gazette | band, top-rule, kicker-numeral, side-rail | **band** | **top-rule** | **side-rail** | **kicker-numeral** | **side-rail** | **side-rail** |
| Ledger | top-rule, side-rail, kicker-numeral, bottom-anchor | **top-rule** | **top-rule** | **side-rail** | **kicker-numeral** | **bottom-anchor** | **side-rail** |
| Night | top-plain-large, statement, side-rail, kicker-numeral, band | **top-plain-large** | **band** | **side-rail** | **kicker-numeral** | **top-plain-large** | **side-rail** |
| Paper | top-rule, bottom-anchor, side-rail, statement | **top-rule** | **top-rule** | **bottom-anchor** | **top-rule** | **bottom-anchor** | **side-rail** |
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

Never move a title by hand with a free text box. The frame is the treatment; a nudged title becomes
a ninth position the reader has to learn and the gate cannot classify.

## How the gate reads titles

`qa_deck.py` classifies each title from the compiled file by geometry and companions, testing in
this order: overlay, band, statement, bottom-anchor, side-rail, kicker-numeral, top-plain-large,
top-rule. The compiler also writes the intended treatment into the title shape's name
(`title@side-rail`), and the gate compares the two; the name alone is never accepted as evidence.

| Check | Fails when |
|---|---|
| OF-110 | a deck of eight or more slides uses fewer than three treatments (cover and section titles not counted) or more than variance allows; or, at any length, a title fits none of the eight or is drawn as a different treatment than its name says |
| OF-113 | two slides under the same treatment place their title frames more than 1 pt apart (statements compare only x and width, since their height follows the line count; bottom titles compare x, width and the bottom edge, since they stand on the floor) |
| OF-114 | a title or cover subtitle is declarative (rule 1 above) |
| OF-115 | a bottom title ends more than 12 pt above the body floor, or more than 40 % of a side rail under its title stands empty |

What stands in the rail under a side title is the rail's own: it neither changes the side-rail reading
nor counts as a body column. A slide whose rail would stay empty takes another title unless the
source pins `title: side-rail`, and then OF-115 reports the empty rail.

Under a legacy template OF-110 and OF-113 report as advisories and OF-114 as MEDIUM, because the
user asked for that template's single title position.
