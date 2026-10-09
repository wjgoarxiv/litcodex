# Signal

Signal is built for a speaker standing in front of people who must decide something. The ground is
white, the type near-black, and a single hot red-orange is kept for the protagonist: the number,
the word or the bar the slide exists for. There are no cards and almost no rules; space, weight and
that one colour do the grouping. On the compact step each slide still carries its basis and source,
so the file holds up when it is forwarded after the meeting.

## Reach for it

- Investment pitches, proposals, launches, any ten-to-fifteen-minute talk that ends in an ask.
- Short bodies (about 40 Korean glyphs or 80 Latin characters per content slide or fewer), a few
  real headline numbers, a story from problem to ask.
- First candidate for pitches; third for an image-led launch with few pictures.

## Pass on it

- Decks that will mostly be read alone: open pages hold less than a solitary reader needs.
  Ledger or Gazette.
- Outlines where a third or more of the slides are tables: Signal has no `ledger-table` or
  `dashboard-grid`, and its open table style is meant for one table, not ten.
- Rooms that want a quiet document: the red field cover and band are loud by design.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FFFFFF / #F4F4F5 |
| ink / ink-muted / line | #15131A / #55525C / #D4D4D8 |
| accent / accent-deep / accent-tint | #C8361A / #6E1A0C / #FBE7E2 |
| field / on-field | #C8361A / #FFFFFF |
| positive / negative | #1E7A3F / #15131A (losses in ink with ▼, because red means "look here") |
| series | #C8361A, #15131A, #6B6870, #2F6F8F |
| faces | Pretendard Bold (display, title, numerals), Pretendard Regular (body, labels); `faces: a2z` gives A2Z Black display and numerals, A2Z Bold titles |
| type voice | tracking −1 titles, −2 display |
| table | no header fill, rules at top and bottom, protagonist row in accent tint, bold totals |
| chart | no gridlines, direct labels, accent on the highlighted bar over muted ones |
| image | no frame |
| decoration | colour field, hairline rule, numeral |
| radius / edge | 0 / fill |

## Dials and type

Density 10 and variance 6 (three or four treatments). Drop to density 8 only when the deck is shown
from a stage and never sent. Figures stop at the title step; a panel of three related figures
reads stronger than one giant number.

## Titles by role

| Role | Default |
|---|---|
| content, data-takeaway | `top-plain-large` |
| data, sequence, reference, definition | `top-rule` |
| image | `bottom-anchor` |
| statement | `statement` |

`big-number`, `kpi-row`, `chart-insight` and `comparison` may also take `bottom-anchor` when the
visual should own the top of the page.

## Families and variants

- `big-number`: a red panel of two to four related figures, each with label and basis, evidence
  beside it.
- `image-split` and `asymmetric-feature`: a product picture with three to five labelled points;
  the asymmetric version gives the picture the narrow side.
- `process`: three to five steps; on the compact step each row reads numeral, step, what happens.
- `kpi-row`, `chart-insight`, `full-chart`: traction and growth with one highlighted series.
- `comparison`: before and after, or the incumbent against the new way, on shared criteria.
- `table-insight`: the one table a pitch needs, usually unit economics.
- `quote`: a customer's sentence set as the statement; `statement` only for a pull quote or a
  display-led deck the user asked for.
- Covers `cover-numeral`, `cover-typographic`, `cover-split-field`; sections `section-field`,
  `section-numeral`; closings `closing-statement`, `closing-ask`.

Display devices: cover `drench` (the field edge to edge, title anchored low), statement `open`,
number panel `field` (white figures on red), closing floor `band` (the next step in a red band
above the footer).

## Do

- Label every title (subject, measure, period); the claim is the first body line.
- Give each figure a basis or comparison and a caption with period and source.
- Keep bullet lists to four or five points, each carrying a number or a name.
- End on `closing-ask`: the amount in the title, its uses as a table of item, amount, date and
  owner, and the next meeting with a name on it.

## Avoid

- Red for losses or warnings.
- Display text running past two lines; a single huge figure alone on a page.
- Cards and boxed groups.
- A table slide with no line telling the room what to take from it.

## Worked slide

A problem slide as a data panel: four related figures, their basis under each, the reading beside.

```markdown
---
layout: big-number

## 동네 약국 유효기간 경과 의약품 폐기 규모

| 연간 폐기액 (약국당) | 폐기 품목 중 전문약 | 반품 불가 비중 | 약국 수 (수도권) |
|---|---|---|---|
| 310만 원 | 72% | 41% | 1만 1천 곳 |
| 2025년 표본 평균 | 금액 기준 | 낱알·개봉 포장 | 2025년 말 기준 |

출처: 예시 약사회 재고 실태 조사, 수도권 약국 220곳, 2025년 11월 (예시)

> 수도권 약국 재고 조사, 2025년 (예시)

- 약국 한 곳이 해마다 약 310만 원어치 약을 기한이 지나 버린다
- 폐기액의 72%는 처방이 드문 전문약이고, 그중 41%는 도매상 반품이 안 된다
- 주: 폐기액은 약가 기준, 마약류와 냉장 보관 품목은 제외
---
```

## Examples

`01-pitch-signal-ko.md`
