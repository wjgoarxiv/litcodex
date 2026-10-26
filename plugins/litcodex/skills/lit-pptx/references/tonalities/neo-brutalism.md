# Neo-Brutalism

Neo-Brutalism is the loud direction, and it means to be. Each card is a flat yellow block with a
thick black border and a hard black shadow thrown down and to the right with no blur at all. Titles
are heavy and tight, the topic band is saturated blue, one pink-red accent marks the figure a slide
exists for, and the ground is warm cream. Nothing is soft: no gradients, no rounded corners, no
glow. It reads like a poster or a product sticker, which suits a room that should feel energy, and
it stays legible because every colour pair still clears the contrast floor.

## Reach for it

- A startup pitch at a demo day, a consumer product launch, a campaign kick-off, a creator or
  community event, a hackathon final, an education deck for a young audience.
- A short body (one claim and two or three facts per slide), three or four headline numbers, a
  launch or sign-up ask, words such as 런칭, 출시, 데모데이, 캠페인, 크리에이터, or a request for
  something bold, punchy or "brutalist".
- Second candidate for the pitch deck type after Signal; first when the user asks for a bold or
  playful look.

## Pass on it

- A formal report, an academic talk, a board or finance review, or any deck read alone later: the
  blocks take the space a reader needs for detail, and long paragraphs between thick borders are
  noise.
- Grief, safety, HR or financial-loss topics; a deck under a corporate brand guide.
- A brief that says "clean" or "minimal" (Signal or Studio) or "report" (Ledger or Gazette).

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FFF5E1 / #FFD43B (the yellow card) |
| ink / ink-muted / line | #111111 / #3A3A3A / #111111 |
| accent / accent-deep / accent-tint | #D81B5C / #6B0F2E / #FFC9DA |
| field / on-field | #2F4BFF / #FFFFFF |
| positive / negative | #137A43 / #111111 |
| series | #D81B5C, #2F4BFF, #111111, #137A43 |
| faces | Pretendard Bold (display, title, labels, numerals), Pretendard Regular (body); `faces: a2z` swaps in A2Z Black for display, titles and numerals |
| register / ramp / hero | bold / presented (body 18 pt, labels 14, sources 12, titles 32, display 44) / allowed: a statement or a big figure may take the 72 pt hero step |
| type voice | titles tracked −2, display −3 |
| density / variance | 10 / 7 |
| radius / edge | 0 / fill plus a 2.5 pt border in ink |
| shadow | 6 pt offset at 45°, ink, fully opaque, blur 0 |
| table | yellow header, ruled grid, protagonist row in pink tint, bold totals |
| chart | no gridlines, direct labels, series in order (pink, blue, black) |

This is the bold register (`register: bold`): the only way to the presented type ramp and the 72 pt
hero step, so titles, figures and statements run large. They still fill the same slide-grid zones
as every other pack. A title sits in the one title zone and the body starts at y 120 as always; the
register changes the size inside a zone, not the zone. The compiler refuses presented type in a
pack that does not declare `register: bold`, so a report pack cannot drift into this size by
accident. A KPI row keeps its bordered cards because the card is this direction's figure. The pink
was darkened until a pink figure on a yellow card still holds 3:1 at title size; a loss uses ink
with a ▼ sign because pink already means "look here".

The shadow is written as a real outer shadow with blur zero, so PowerPoint, Keynote and LibreOffice
draw the same hard edge. Every block of the blue field (band, section page, cover plate) carries the
black border too.

## QA allowances

The pack's `qa:` block says `offset-shadow: true`, which lets OF-120 pass this hard shadow. A shadow
with any blur still fails, and the same shadow in a pack without the allowance fails. The yellow
card, blue band and pink accent share a content slide inside the default OF-101 limit (four hue
families; a fifth fails). Contrast floors are unchanged.

## Titles by slide role

Content slides and data with a takeaway take `top-plain-large`; data, sequence, reference and
definition slides take `band` (white title on the blue band); image slides `bottom-anchor`;
statements `statement`; `kicker-numeral` is the third option for a sequence. Force one with
`title: <id>` on the line after `layout:`.

## Families and variants

- `kpi-row` sets two to four results as yellow cards: value, label, basis.
- `big-number` is a blue panel of related figures beside the facts that explain them.
- `comparison` reads before and after across shared rows.
- `process` and `step-diagram` show three to five steps with an accent numeral.
- `chart-insight` carries one growth chart with its takeaway; `table-insight` holds the one table a
  pitch needs, usually unit economics; `image-split` pairs a product shot with three short points.
- `summary-box-list` sets two to four bordered boxes of one claim each.
- `agenda`, `quote` and `statement` keep the type loud and the page open.
- Covers `cover-typographic`, `cover-split-field`, `cover-numeral`; sections `section-field`,
  `section-numeral`; closings `closing-ask`, `closing-decision-box`, `closing-statement`.

Display devices: the typographic cover sets the topic in white on a blue plate across the lower half,
bordered in black; a statement drenches the page in blue with a white sentence; a big number is a blue
field panel; a closing's next step sits in a bordered box with its shadow.

## Do

- Keep one claim per slide and open the body with it, in plain words.
- Give every figure its label and basis inside the card.
- Let the yellow cards hold figures and short labels, never paragraphs.
- End on `closing-ask` with the amount, its uses and the next meeting.

## Avoid

- Blurred or soft shadows, rounded corners, gradients.
- Hairlines beside the 2.5 pt borders.
- More than three fill colours on one slide.
- Grey muted text on the yellow surface.
- This direction for formal reports or sensitive topics.

## Two worked slides

A launch deck opens its traction slide with four results as cards and two facts beneath.

```markdown
---
layout: kpi-row

## 베타 8주 성과, 2026년 10월

| 가입자 | 주간 재방문 | 추천 가입 | 유료 전환 |
|---|---|---|---|
| 1만 2천 명 | 46% | 38% | 7.4% |
| 목표 1만 명 | 업계 평균 25% | 광고비 0원 | 목표 5% |

> 베타 운영 기록, 2026년 8-10월 (예시)

- 광고 없이 가입자 목표를 넘겼다: 셋 중 하나 이상이 친구 추천으로 왔다
- 유료 전환 7.4%는 목표 5%를 넘었고, 연 결제가 그중 60%다
- 출처: 예시 서비스 운영 대시보드, 2026년 10월 (예시)
---
```

The closing states the ask, shows where the money goes and names the next step.

```markdown
---
layout: closing-ask

## 시드 15억 원 사용 계획

| 쓰임 | 금액 | 시점 |
|---|---|---|
| 앱 개발 인력 4명 | 7억 원 | 2027년 상반기 |
| 크리에이터 제휴 200곳 | 4억 원 | 2027년 1분기 |
| 마케팅 실험 | 3억 원 | 상시 |
| 운영 예비비 | 1억 원 | 필요 시 |
| 합계 | 15억 원 | 12개월 |

> 투자금 쓰임 (예시 데이터)

- 요청: 시드 15억 원 투자 승인
- 기대 성과: 12개월 뒤 가입자 10만 명, 월 매출 2억 원
- 다음 단계: 11월 첫째 주 후속 미팅, 담당 예시 대표
---
```

## Examples

`15-launch-pitch-neo-brutalism-ko.md`
