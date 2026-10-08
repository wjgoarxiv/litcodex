# Ledger

Ledger treats a deck as an account book that has to survive questions. Pages are white and
tightly set on the compact grid; tables carry a deep green header band with white labels, a rule
under the header and another above the totals, and right-aligned tabular figures. One teal-green
accent marks the figure each slide is about. Sections open on a rule or a real part number, never
on a colour field, so the deck stays quiet enough for a reader to compare numbers across pages.

## Reach for it

- Business reviews, quarterly results, budget requests, status updates, data reviews that are read
  before or during the meeting and annotated afterwards.
- Outlines where 30 % or more of content slides carry a table or a chart, or bodies run long
  (150 Korean glyphs / 300 Latin characters per slide and up).
- Briefs that say the file is circulated, in a language other than Korean (Korean desk-read decks
  go to Gazette first).
- First candidate for business reviews and status updates; second for data-heavy reviews and
  Korean briefings.

## Pass on it

- A live pitch or a launch: its density buries a listener and its calm palette undersells the
  moment. Signal or Studio.
- An image-led deck: pictures are framed small with a hairline and bleed only at the sides.
- A deck built on single claims or quotations: Ledger has no `statement` treatment or family.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FFFFFF / #F2F4F6 |
| ink / ink-muted / line | #16212C / #4B5866 / #D0D6DC |
| accent / accent-deep / accent-tint | #0E6B5A / #0A4438 / #E2F0EC |
| field / on-field | #0A4438 / #FFFFFF |
| positive / negative | #1E7A3F / #B3261E |
| series | #0E6B5A, #4B5866, #9A6A12, #2F5F8A |
| faces | Pretendard Bold (display, title, numerals), Pretendard Regular (body, labels); `faces: a2z` swaps display and numerals to A2Z Bold |
| type voice | tracking −1 on titles and display, sentence case, tabular figures |
| table | `ledger`: header in the field colour with on-field text, rules under the header and above totals, no banding, bold totals |
| chart | hairline gridlines, direct labels, accent on the highlighted series over muted ones, annotation on |
| image | bleed at the sides only, no crop, hairline frame |
| decoration | accent rule, hairline rule, rail fill, numeral |
| radius / edge | 0 / fill |

## Dials and type

Density 10 (compact grid, 24 pt margins; body 13, labels and table cells 11, sources 9; rows from
18 pt; no step-up) and variance 5 (three or four treatments, a family at most three times in a
row). A deck projected in a large room may drop to density 8 (body 14, 36 pt margins); that is the
only routine move. Figures never exceed the title step (26 pt).

## Titles by role

| Role | Default | Also allowed in some families |
|---|---|---|
| content, data, reference | `top-rule` | `kicker-numeral` (agenda, ledger-table, text-two-column), `side-rail` |
| data-takeaway, definition, statement | `side-rail` | `top-rule`, `bottom-anchor` |
| sequence | `kicker-numeral` (shows the part number when the deck has sections) | `top-rule`, `bottom-anchor` for timeline |
| image | `bottom-anchor` | — |

Pin with `title:` after `layout:`. `kpi-over-chart` takes only `top-rule`; `full-chart` prefers
`bottom-anchor`.

## Families and variants

- **Numbers:** `kpi-row`, `kpi-over-chart`, `big-number`, `dashboard-grid` put results and their
  trend on one page; `kpi-over-chart` is the usual second slide of a review.
- **Tables:** `ledger-table` for the full table with takeaways under it; `table-insight` when the
  reading belongs beside it; `matrix-2x2` to place options by effect and effort.
- **Charts:** `chart-insight`, `full-chart`.
- **Words and order:** `comparison` (plan against actual, two options), `timeline` (dated steps
  with owners), `agenda`, `text-two-column`, `references-appendix`.
- **Covers:** `cover-figures` (lifts the first KPI row; values ≤ 12 characters, basis ≤ 24),
  `cover-typographic`, `cover-index` (needs an agenda or two sections).
- **Sections:** `section-rule`, `section-numeral`; with an agenda both draw an index page with the
  current part marked.
- **Closings:** `closing-decision-box`, `closing-ask`.

Display devices: cover `figures`, number panel `tint` (accent tint behind two to four figures),
closing floor `box` (the next step in a tinted box), section index on.

## Do

- Put units in headers; keep a figure that appears twice identical, ideally from one data file.
- Give every KPI its basis row (전년 대비, 계획 대비, 목표) and every table a caption with period and
  source.
- Give each table two or three takeaways; a ledger table without them stops mid-page.
- Close on a decision box listing each item with amount, owner and date.
- Fill matrix cells with full phrases (`item · detail · detail`); one-word quadrants leave holes.

## Avoid

- KPI rows of counts that are not results (meetings held, documents written).
- More than one accent colour on a chart.
- Tables stretched with empty rows or padded cells.
- Two data slides in a row under `side-rail`.
- Claims as titles: the label names subject, measure, period; the claim opens the body.

## Worked slide

The table names its own source on the line beneath it; the claim arrives as the first takeaway.

```markdown
---
layout: ledger-table

## 제품군별 3분기 매출·영업이익 실적

| 제품군 | 매출 계획 | 매출 실적 | 영업이익 | 이익률 | 전년 대비 |
|---|---|---|---|---|---|
| 흰우유 | 605 | 598 | 9 | 1.5% | ▼ −2.3% |
| 발효유 | 360 | 372 | 27 | 7.3% | ▲ +9.1% |
| 치즈 | 220 | 236 | 21 | 8.9% | ▲ +25.5% |
| 가공유 | 210 | 222 | 7 | 3.2% | ▲ +5.2% |
| 합계 | 1,395 | 1,428 | 64 | 4.5% | ▲ +5.6% |

출처: 경영기획실 분기 결산 자료, 2026년 9월 마감 (예시)

> 표 1. 제품군별 3분기 실적, 억 원 (예시 데이터)

- 흰우유를 뺀 세 제품군이 매출 계획을 넘었다
- 이익 64억 원 중 발효유와 치즈가 75%를 벌었다
- 주: 이익률은 제품군 영업이익을 제품군 매출로 나눈 값
---
```

## Examples

`03-business-review-ledger-ko.md`, `10-status-update-ledger-en.md`
