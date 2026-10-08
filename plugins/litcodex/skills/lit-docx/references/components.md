# Page components

A component is a block the converter draws differently from running text: a cover, a callout, a
sidebar, a key-figure strip, a column section. Components are fenced in the Markdown source and
split out before Markdown sees the text, so a fence never reaches the page. They are used
sparingly. A document that boxes something in every section reads as machine-made, and the gate
counts kinds to stop it.

## The budget

| Rule | Limit | Checked by |
| --- | --- | --- |
| Kinds per document | at most 3 besides headings, paragraphs, lists and tables | `component.budget` |
| Key-figure strips | at most 1, in the summary or overview, never on the cover | `component.budget` |
| Pull quotes | none in a tonality document (a quote that repeats the body is dropped by the converter) | `component.budget` |
| Sidebars | Manual only | the pack's `components.allowed` |
| Callouts | one style per document, about one per four pages, only for content outside the reading sequence (a decision request, a warning) | review |
| Memo | no components; a callout reads as a bold lead line | the pack |

Before adding a component, write in the direction card what it serves in one line ("keyfigures:
three measured indicators under the summary"). If that line cannot be written, the content stays
as prose or a table. A directive the tonality does not allow, or one past the budget, keeps its
content as ordinary text and the converter prints a note.

## Grammar

```
::: <kind> [key=value …]
content in ordinary Markdown
:::
```

Values with spaces are quoted (`title="결정 요청"`). Fences do not nest. Inside `::: columns`, a
line `<!-- column-break -->` starts the next column.

| Tonality | Allowed kinds |
| --- | --- |
| Report | keyfigures, callout, columns |
| Brief | callout, columns |
| Manual | callout, sidebar, columns |
| Proposal | keyfigures, callout, columns |
| Memo | none |
| Journal | callout |

## `::: cover variant=<typographic|band|split|masthead> [kicker="…"]`

The cover opens the document. Its body is one or two plain sentences that say what the document is
for; for a memo it holds the To / From / Subject line.

- **typographic** (Proposal, Manual): a page of its own; the title left-aligned in the upper third,
  one short rule, the subtitle, and the byline and date at the foot. No picture, no colour block,
  no figures.
- **masthead** (Report, Brief, Journal, Memo): a title block at the top of page 1, with the text
  starting under it on the same page.
- **band** and **split** exist for user-named requests; under the restraint rules the band stays
  under a quarter of the page (`cover.block` fails a filled shape over 25 % of the cover).

The kicker is the document type in two to four words ("사업 제안서", "Memo"), not a slogan.

## `::: callout kind=<note|key|warning> [title="…"]`

A ruled box: a 0.75 pt rule above and 0.5 pt below, no side stripe, no fill. `key` carries a
decision request or a set of proposed actions; `warning` carries a hazard or a prohibition in a
Manual; `note` carries an aside the reader can skip. The title is a noun phrase ("결정 요청",
"Proposed changes for Q4"). One callout kind per document.

## `::: sidebar [title="…"] [width=third|half] [float=right|left|none]`

Manual only. A narrow box beside the text for reference matter the reader looks up rather than
reads: contacts, tool lists, definitions. It floats right at a third of the text width by default
and must end before the next heading starts beside it (`sidebar.overlap`).

## `::: keyfigures [cols=2|3|4]`

One strip of measured figures. Each item is a list entry with the figure in bold, a short label,
and a nested basis line:

```
::: keyfigures
- **41.2만 권** 3분기 대출 (예시)
  - 2분기 39.6만 권 대비 4.1% 증가
:::
```

Figures are set no larger than the h2 size. Every figure needs its basis line (period, comparison
or method); a count of places or a target restated as a figure is not a key figure. Three items is
the common case; four fit on A4.

## `::: columns <2|3> [gap=<mm>] [rule=true]`

Two or three columns for short parallel blocks of similar length (within about a fifth of each
other): two causes, two options, a list of steps beside a list of checks. Each column usually
opens with an h3. Long uneven blocks stay in one column; LibreOffice does not balance a column
section reliably, so the converter draws a column break as a side-by-side row that keeps together.

## Tables, captions, source lines

Every table is booktabs: a 1 pt rule above and below, 0.5 pt under the header, no vertical rules,
no fills, numeric columns right-aligned, columns sized to their content. A caption line directly
above the table (`표 1. 제목 (단위: …, 예시)` or `Table 1. Title (sample data)`) is set as the
caption; `주:` / `Note:` and `자료:` / `Source:` lines directly under it are set as the source
block and kept with the table. A `{style=…}` attribute on a caption is accepted and drawn as
booktabs in every tonality.

## Misuse the gate or the converter catches

| Misuse | Result |
| --- | --- |
| A pull quote repeating a body sentence | dropped, with a note |
| A second key-figure strip | kept as a list; `component.budget` fails |
| A coloured or shaded table cell | `table.fill` fails on a tonality document |
| A component kind the pack does not allow | content kept as plain text, with a note |
| Key figures inside the cover | `component.budget` fails |
