# Paper

Paper is a journal page put on a screen. Ink on white, hairlines instead of fills, figures first
with numbered captions, booktabs tables, and one deep crimson that always means "the method this
talk proposes". The title page is set like an article's: a heavy rule, the title, a hairline, the
presenter, then place and date. Restraint is the point; colleagues should be able to judge the
evidence without the design arguing for it.

## Reach for it

- Research talks, thesis defences, technical reviews, written analyses that will be cited.
- Outlines with numbered references, DOIs, figures that need captions, or equations.
- First candidate for research talks; second for lectures; third for data reviews delivered as a
  written analysis.

## Pass on it

- Sales, launch or fundraising audiences: the restraint reads as cold. Signal or Studio.
- KPI-led management decks: Paper has no `kpi-row`; Ledger fits.
- Picture-led storytelling: figures here are evidence, framed by captions, never full-bleed.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FFFFFF / #F5F5F6 |
| ink / ink-muted / line | #111418 / #50565E / #C9CDD2 |
| accent / accent-deep / accent-tint | #8C1C2B / #5E121C / #F6E6E8 |
| field / on-field | #111418 / #FFFFFF |
| positive / negative | #1E6B3A / #50565E |
| series | #8C1C2B, #111418, #50565E, #2E5E8A |
| faces | Pretendard Bold (display, title), Pretendard Regular (body, labels, numerals); the A2Z option changes nothing here |
| type voice | tracking 0 titles, −1 display; tabular figures |
| table | `booktabs`: no header fill, three rules (top, under header, bottom), no banding, bold totals |
| chart | hairline gridlines, direct labels, series in palette order (the proposed method first), no annotation |
| image | no bleed, no crop, no frame |
| decoration | hairline rule, box outline |
| radius / edge | 0 / border |

## Dials and type

Density 10, variance 5. Fill order starts with `anchor-visual`, then `distribute`. References that do
not fit step down to label size and then run in two columns; give eight to ten entries.

## Titles by role

| Role | Default |
|---|---|
| content, data, sequence, reference | `top-rule` (on a hairline, never a short accent bar) |
| data-takeaway, image | `bottom-anchor` |
| definition | `side-rail` |
| statement | `statement` (between rules) |

A comparison is the one family with a title of its own (`structure`): it is drawn as a ruled table
under a `top-rule` title, kept even when the deck already leans on that title.

## Families and variants

- `figure-academic`: a numbered figure with observation, basis, limitation and implication lines.
- `figure-pair`: two conditions or before and after, one line of reading.
- `method`: the model with its symbols defined, figure or formula first.
- `chart-insight`, `full-chart`: results; the proposed method takes the crimson.
- `table-insight`: booktabs results tables with the reading beside them.
- `comparison`: contributions against limits, on the same criteria.
- `quote`, `statement`, `text-column`, `references-appendix`.
- Covers `cover-index` (needs an agenda or two sections), `cover-typographic`, `cover-split-image`;
  sections `section-rule`, `section-field`; closings `closing-summary-list`, `closing-ask`.

Display devices: cover `rules` (journal title page), statement `rules`, number panel `outline`,
closing floor `rules`, section index on.

## Do

- Number every figure and table, and give each a source line.
- Use crimson only for the proposed method or its result.
- Define every symbol on the method slide, with units.
- End with findings, the next study and the ask, then references with dates.

## Avoid

- The short accent bar under titles; Paper's rule is a hairline.
- Coloured card fills.
- Figures without numbered captions.
- References set below the source size or squeezed into one column at 8 pt.

## Worked slide

A numbered figure read the way a reviewer reads it.

```markdown
---
layout: figure-academic

## Raw and calibrated readings against the reference probe

![Figure 1. Low-cost probe against reference probe, 60 pits, 15-minute readings | Source: example image](assets/example-a.png)

- **Observation** Raw readings follow the reference but read 6-9 points high in wet soil
- **Observation** After a two-point calibration per soil batch, RMSE falls from 7.8 to 2.1 VWC points
- **Basis** 498,000 paired readings from 60 pits over 14 weeks (example data)
- **Limitation** One soil mix and one depth; clay-rich pits were not in the sample
- **Implication** A per-batch calibration is enough; per-probe calibration adds 0.3 points of accuracy
- Source: Example Urban Forestry Lab field data, June-September 2026 (example data)
---
```

## Examples

`04-research-talk-paper-en.md`
