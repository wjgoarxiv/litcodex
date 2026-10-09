# Gazette

Gazette is a Korean briefing paper laid out as slides. A slate band carries the title of each
content page, a boxed one-line conclusion sits at the top where it belongs, and 개조식 evidence
runs in two columns at the compact step down to the floor. A single red key line is the only
accent. Nobody presents a Gazette deck; it is opened at a desk, read in order, and annotated.

## Reach for it

- 보고서형 덱: policy reviews, internal proposals, investigation results, monthly reports that are
  sent ahead and read alone.
- Korean decks whose bodies run long (150 glyphs per content slide and more) or whose brief says
  "보고서", "배포", "사전 검토".
- First candidate for Korean text briefings; second for business reviews and status updates read in
  Korean.

## Pass on it

- Live talks: the density that serves a reader overwhelms a listener. Signal, Ledger or Night.
- Picture-led material: Gazette has no picture family.
- English-only decks read alone: Ledger serves them better; Gazette's rhythm assumes 개조식.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FFFFFF / #F1F4F8 |
| ink / ink-muted / line | #1A2230 / #4A5568 / #C8D0DA |
| accent / accent-deep / accent-tint | #A61B1B / #233A4F / #E8EEF4 |
| field / on-field | #233A4F / #FFFFFF |
| positive / negative | #1E7A3F / #1A2230 |
| series | #A61B1B, #233A4F, #4A5568, #7A6A2A |
| faces | Pretendard Bold (display, title, numerals), Pretendard Regular (body, labels); `faces: a2z` swaps display and numerals to A2Z Bold |
| type voice | tracking −1 |
| table | header in the slate field with white text, full grid rules, surface banding, bold totals |
| chart | hairline gridlines, direct labels, accent on the highlighted series |
| image | hairline frame |
| decoration | header band, box outline, hairline rule, numeral |
| radius / edge | 0 / fill and border |

## Dials and type

Density 10, variance 4 (three treatments, a family at most three times in a row). Variance is low on
purpose: a desk reader wants the same page head every time. Never more than three text families in
a row; break them with a table, a timeline or a comparison.

## Titles by role

| Role | Default |
|---|---|
| content, statement | `band` |
| data, reference | `top-rule` |
| sequence | `kicker-numeral` |
| data-takeaway, image, definition | `side-rail` |

`summary-box-list`, `text-two-column` and `ledger-table` may take `band`, `top-rule` or
`kicker-numeral`; `comparison`, `matrix-2x2` and `table-insight` may take `side-rail`.

## Families and variants

- `summary-box-list`: the 핵심 요약 page; `::: key-message` holds the one-line conclusion (three
  lines at most), groups of evidence under it.
- `text-two-column`, `text-column`: 개조식 groups, level 1 the claim, level 2 the evidence, five
  points per level at most, consistent endings.
- `ledger-table`, `table-insight`: the figures with their reading.
- `matrix-2x2`: options sorted by effect and difficulty.
- `comparison`: 안 1 and 안 2 on the same labelled criteria.
- `timeline`: 추진 일정 with owners and outputs.
- `agenda`, `references-appendix` (붙임: sources and definitions).
- Covers `cover-band`, `cover-typographic`, `cover-index`; sections `section-band`, `section-rule`;
  closings `closing-decision-box` (건의 사항), `closing-ask`.

Display devices: cover `band` (the deck's parts run across the page under the band), number panel
`outline`, closing floor `box`, section index on.

## Do

- Write every page as a reader will meet it alone: label, conclusion, evidence, source.
- Keep 개조식 endings consistent within a list (명사형 또는 -다, not both).
- Give the decision page each item, its amount, owner and deadline.
- Close with 붙임: dated sources and the definitions the deck relies on.

## Avoid

- English section kickers or labels above titles.
- Red for anything but the key line.
- A summary box longer than three lines.
- More than three text families in a row.

## Worked slide

The 핵심 요약 page: one boxed conclusion, three evidence groups, the basis in the note line.

```markdown
---
layout: summary-box-list

## 검토 결과 핵심 요약과 건의 방향

::: key-message
동 주민센터 12곳에 주 2회 금융 도움 창구를 열고, 교육은 창구 이용자에게 맞춤형으로 연결한다
:::

- **현황**
  (1) 70세 이상 모바일 뱅킹 이용률 31%, 60대 64%, 전체 평균 78%
  (2) 최근 3년 관내 은행 점포 21곳 → 13곳, 동 4곳은 점포가 없다
- **검토 결과**
  (1) 집합 교육은 수료 3개월 뒤 실제 이용으로 이어진 비율이 22%에 그쳤다
  (2) 도움 창구 시범 2곳은 방문자의 71%가 다음 달 혼자 이체를 마쳤다
- **건의 방향**
  (1) 교육 중심에서 생활 현장의 도움 창구 중심으로 바꾼다
- 주: 복지정책과 실태 조사(65세 이상 1,200명, 2026년 6월)와 도움 창구 시범 기록 기준 (예시)
---
```

## Examples

`09-briefing-gazette-ko.md`, `13-status-update-gazette-ko.md`
