# Night

Night is a stage screen in a dark room. The ground is a deep blue-black (never pure black), type is
off-white, an amber accent marks the series or figure that matters, and a soft blue carries the
comparison series. Charts are large and labelled directly; data pages sit under a slate band. It is
the look for a technical keynote or a data review on a projector, where white pages would glare and
thin pale type would vanish.

## Reach for it

- Data-heavy reviews, technical keynotes, research talks in a hall, operations reviews shown on a
  projector or a large screen.
- Outlines where charts are 30 % or more of the content slides.
- Briefs that mention a stage, a keynote, a demo day or a darkened room.
- First candidate for data-heavy reviews; second for a research talk in a keynote hall; third for
  business reviews and status updates shown on a stage.

## Pass on it

- Decks that will be printed or photocopied: dark grounds waste toner and lose contrast on paper.
  Ledger or Paper.
- Mixed decks: Night never shares a file with light slides.
- Text-led briefings: Night has no text column or table family beyond the comparison and timeline.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #0F1419 / #1A222B |
| ink / ink-muted / line | #E8EDF2 / #A3AEBA / #5A6672 |
| accent / accent-deep / accent-tint | #E3A857 / #F2C98A / #2A2418 |
| field / on-field | #1E2A36 / #F5F7FA |
| positive / negative | #6CC08B / #F08A7E |
| series | #E3A857, #7FB8E0, #A3AEBA, #C58FD0 |
| faces | Pretendard Bold (display, title), Pretendard Regular (body, labels, numerals); `faces: a2z` swaps numerals to A2Z Light |
| type voice | tracking −1 titles, −2 display |
| table | surface header with ink text, row rules, protagonist row in accent tint, bold totals |
| chart | hairline gridlines, direct labels, accent on the highlighted series |
| image | no frame |
| decoration | header band, hairline rule, numeral, rail fill |
| radius / edge | 6 / fill |

## Dials and type

Density 10, variance 6. Fill order starts with `anchor-visual`, so charts take the room first.
Nothing pale below 18 pt carries meaning on its own: labels at 11 pt use ink-muted only for
secondary text, never for a figure.

## Titles by role

| Role | Default |
|---|---|
| content, image | `top-plain-large` |
| data, reference | `band` |
| data-takeaway, definition | `side-rail` |
| sequence | `kicker-numeral` |
| statement | `statement` |

`full-chart` takes only `top-plain-large`; `kpi-over-chart` takes `band` or `top-plain-large`;
`big-number` takes `side-rail` or `top-plain-large`.

## Families and variants

- `full-chart`, `chart-insight`, `dashboard-grid`: the core of a Night deck; up to four series, the
  amber one first.
- `kpi-row`, `kpi-over-chart`, `big-number`: headline figures with their basis rows.
- `method`: the model or formula with its terms, for technical talks.
- `comparison`, `timeline`: options and dated plans.
- `statement`: a pull quote or a display-led deck on request.
- Covers `cover-numeral` (a real year from the date), `cover-typographic`, `cover-figures`; sections
  `section-numeral`, `section-field`; closings `closing-statement`, `closing-decision-box`.

Display devices: cover `numeral`, statement `open`, number panel `tint` (dark amber tint), closing
floor `band`.

## Do

- Use amber for the series under discussion and blue for its comparison; grey for context.
- Give every chart a caption naming what is plotted and marking example data.
- Keep a dashboard to two to four small charts with one shared reading.
- Close on a decision box with costs, owners and dates.

## Avoid

- Neon colours, glows or saturated gradients.
- A pure black ground or white slides mixed in.
- Thin light type below 18 pt for anything that matters.
- A cover year typed into the title as well; `cover-numeral` already shows it from the date.

## Worked slide

Two small charts read together, with one shared reading and a note on the definition.

```markdown
---
layout: dashboard-grid

## Night flow and pressure in managed zones, Jul-Sep 2026

::: chart type=line unit="L/s"
| Week | Minimum night flow (L/s) |
|---|---|
| W27 | 412 |
| W33 | 371 |
| W39 | 344 |
> Minimum night flow, 22 managed zones (example data)
:::

::: chart type=line unit="m"
| Week | Average night pressure (m) |
|---|---|
| W27 | 52 |
| W33 | 46 |
| W39 | 45 |
> Average night pressure head, 22 managed zones (example data)
:::

- Lower night pressure cut minimum night flow by 16% across the managed zones
- Source: Example district meter and pressure logger data, July-September 2026
- Note: minimum night flow is the lowest 1-hour mean between 02:00 and 04:00
---
```

## Examples

`05-research-keynote-night-ko.md`, `07-data-review-night-en.md`
