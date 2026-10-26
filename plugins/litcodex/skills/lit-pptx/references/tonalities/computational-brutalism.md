# Computational Brutalism

Computational Brutalism is the direction for a deck about a system, given to the people who build or
run it. It takes its look from terminals, plotter paper and engineering drawings: the twelve-column
grid is marked in the top margin with numbered ticks, each content slide carries its own index as
`[03/08]`, titles, labels and figures are set in a monospaced face, tables are ruled on every edge,
and a single electric-blue signal colour picks out the figure that matters. The structure is shown
on purpose. What keeps it readable is that body text stays in Pretendard and every mark sits on the
grid it displays.

## Reach for it

- An architecture review, an infrastructure or reliability report, a developer-tool or AI-system
  launch for engineers, a benchmark write-up, an incident retrospective, a hackathon demo.
- Content with units (p99 latency, throughput, error budget, GPU hours), version numbers and
  identifiers, command or code names in the text, before-and-after measurements, and a room that
  reads a table faster than a sentence.
- First candidate for an engineering review or a developer launch; second for a data review that an
  engineering team will read.

## Pass on it

- A board, an investor committee, finance or a public-sector report: there the grid marks read as
  unfinished work, not as a style.
- A long Korean reading deck. The mono face sets only Latin letters and figures, so a page of Hangul
  titles loses most of the look and keeps the width cost.
- Consumer marketing; grief, safety or HR topics; a deck under a corporate brand guide.
- For a quiet data review choose Ledger or Night; for an investor pitch, Signal or Neo-Brutalism.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #EEEDE7 / #E2E1D9 |
| ink / ink-muted / line | #111111 / #4D4C47 / #9A988F |
| accent / accent-deep / accent-tint | #1F43E0 / #14267A / #D9DEF2 |
| field / on-field | #111111 / #8CF5A6 (phosphor green, on the terminal field only) |
| positive / negative | #1C6B35 / #B3261E |
| series | #1F43E0, #111111, #7A786F |
| faces | JetBrains Mono Bold (display, title, numerals), JetBrains Mono Regular (labels), Pretendard Regular (body); Hangul inside a mono run falls to Pretendard through the East Asian slot; there is no A2Z map, so `faces: a2z` keeps these faces |
| ramp / hero | compact (body 13 pt, labels 11, sources 9) / the 60 pt hero step on a cover or statement title that fits, off with `hero: false`; a figure is never larger than a title |
| density / variance | 10 / 7 |
| radius / edge | 0 / border, 1 pt, in ink |
| decoration | hairline rules, column hairlines, outlined boxes, grid marks, kicker numerals |
| table | ruled grid on every cell edge, header in the label face, bold totals |
| chart | hairline gridlines, direct labels, the accent on the highlighted series over muted ones |

Density 10 puts the deck on the compact grid (24 pt side margins, body 13 pt, no step-up). An
engineering review is opened again after the meeting, so every slide keeps its basis and its
source. The mono face is wider than Pretendard; the engine measures a mono title at its own width
before choosing a treatment, and a long Latin title moves to a treatment with a wider frame instead
of shrinking.

The mono face ships with the skill (`fonts/jetbrains-mono/`): the official JetBrains Mono 2.304
Regular and Bold files, unmodified, under the SIL Open Font License 1.1 with no Reserved Font Name.
`pptx embed` writes them into the deck; the sha256 of each file is in `fonts/jetbrains-mono/SOURCE.md`.

## Titles by slide role

Content, data, sequence and reference slides take `top-rule`; data with a takeaway takes
`bottom-anchor`; image slides `bottom-anchor`; definitions `side-rail`; statements `statement`.
Every treatment draws in the one title zone of the slide grid, so the choice changes the surface of
the title and never its place. Force one with `title: <id>` on the line after `layout:`.

## Families and variants

- `dashboard-grid` and `kpi-row` carry measured results: value, unit, label and basis per cell.
- `chart-insight` and `full-chart` show a measured series with one highlighted line or bar.
- `table-insight` and `ledger-table` hold benchmark or capacity tables, ruled on every edge.
- `method` sets a pipeline or procedure as numbered stages with inputs and outputs.
- `step-diagram` is a rollout or migration in three to five steps; `matrix-2x2` places options on
  two measured axes; `comparison` reads before and after, or two designs, across shared rows.
- `text-two-column` and `references-appendix` carry specifications and links.
- `quote` and `statement` hold one line an engineer said, or one decision.
- Covers `cover-typographic`, `cover-index`, `cover-figures`; sections `section-numeral`,
  `section-rule`; closings `closing-decision-box`, `closing-ask`, `closing-summary-list`.

Display devices: the typographic cover is the terminal field edge to edge (black, topic in phosphor
green at display size, anchored low, the date line above it); a statement sets its sentence in
phosphor on the same field; a big number is an outlined panel on the ground; a closing's decision
sits in an outlined box (see `layout-families.md`, Display slides). Grid marks and the slide index
belong to content slides; a drenched statement goes without them.

## Do

- Give every figure its unit and basis: `p99 182 ms`, `2026년 9월 기준`.
- Write identifiers, versions and commands as they are; the mono face exists for them.
- Keep one blue figure per slide and everything else in ink.
- Rule a table on every edge and right-align its numbers.
- End on a decision box or an ask that names an owner and a date.

## Avoid

- Body paragraphs in the mono face (the compiler refuses a mono body face).
- Invented code, fake terminal prompts or decorative binary strings; real identifiers or nothing.
- Grid marks or the slide index in the accent colour.
- A second accent; the phosphor green belongs to the black field.
- This direction for a board pack, a finance report or a sensitive topic.

## Two worked slides

A latency review states the measured result with its basis, and the table carries the detail.

```markdown
---
layout: kpi-row

## API 게이트웨이 v3 전환 결과, 2026년 9월

| p99 지연 | 처리량 | 오류율 | 노드 수 |
|---|---|---|---|
| 182 ms | 41k rps | 0.07% | 24 |
| v2 410 ms | v2 18k rps | v2 0.31% | v2 40 |

> 운영 클러스터 4주 평균, 2026년 9월 (예시)

- 지연은 절반 아래로 줄었고, 노드는 40대에서 24대로 줄었다
- 오류율 0.07%는 SLO 0.1% 안쪽이다
- 출처: 예시 관측 대시보드, 2026년 9월 (예시)
---
```

A migration reads as a sequence, with the exit condition of each step.

```markdown
---
layout: step-diagram

## Cut-over plan for the v3 gateway

- **1. Shadow** mirror 5% of traffic to v3 and compare responses
  (1) Exit: 0 mismatches over 72 h
- **2. Canary** route 10% of live traffic to v3 in one region
  (1) Exit: p99 under 250 ms, error rate under 0.1%
- **3. Ramp** move to 50%, then 100%, one region a day
  (1) Exit: no rollback for 7 days
- **4. Retire** drain v2 and remove its 40 nodes
  (1) Owner: example platform team
- Source: example rollout runbook, October 2026 (example)
---
```

## Examples

`14-engineering-review-computational-brutalism-ko.md`
