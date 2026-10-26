# Bauhaus

Bauhaus is the direction for a talk about making things: design, architecture, craft, art history,
culture. Its display slides carry an elementary composition (a yellow square, a red circle, a black
bar, a blue triangle) set on the grid beside a heavy title on an off-white ground. Content slides are
quiet by design: black type, a short red rule under each title, open tables and one red accent. The
geometry is the voice, so it speaks where the deck speaks (the cover and the statements) and stays
out of the pages the audience reads.

## Reach for it

- A design or architecture lecture, a museum or exhibition opener, a brand or product design
  workshop, a culture programme, a portfolio review for a design school, a talk on the history of a
  style.
- Images and few numbers, a sequence of ideas or periods, quotations from makers, and words such as
  디자인, 건축, 전시, 워크숍, 바우하우스, Bauhaus, modernism, "primary colours".
- First candidate for a design or culture lecture, ahead of Studio; second for a creative workshop.

## Pass on it

- A data-heavy business review, finance, a public-sector report, or any deck where tables make up a
  third of the slides: the display geometry has nothing to say about a ledger.
- Grief, safety or financial-loss topics, where primary colours look careless.
- A deck that is mostly pictures (Atlas or Studio frame them better) or a pitch (Signal or
  Neo-Brutalism).

## Tokens

| Token | Value |
|---|---|
| ground / surface | #F4F1EA / #E8E3D6 |
| ink / ink-muted / line | #141414 / #4A4740 / #141414 |
| accent / accent-deep / accent-tint | #C8261C / #7A140E / #F2C230 (the geometry's yellow) |
| field / on-field | #1F3C99 / #FFFFFF |
| positive / negative | #1E6B3A / #141414 |
| series | #C8261C, #1F3C99, #141414, #9E7700 |
| faces | Pretendard Bold (display, title, labels, numerals), Pretendard Regular (body); `faces: a2z` swaps in A2Z Black for display, titles and numerals |
| ramp / hero | compact (body 13 pt, labels 11, sources 9) / the 60 pt hero step on a cover or statement title that fits, off with `hero: false`; figures at most title size |
| density / variance | 10 / 7 |
| radius / edge | 0 / fill |
| decoration | a short accent rule under top titles, kicker numerals, colour fields |
| table | open, no header fill, a rule under the header, bold totals |
| chart | no gridlines, direct labels, the accent on the highlighted series over muted ones |

Density 10 holds the lecture on the compact grid (24 pt side margins, body 13 pt, no step-up). The
fourth series colour is the geometry's yellow darkened to an ochre so a bar keeps 3:1 on the ground;
the bright yellow is kept for fills (the square, the notice tag, a highlighted table row) and never
sets text. A loss uses ink with a ▼ sign.

## QA allowances

Red, blue and yellow side by side on a cover, a statement or a content slide stay inside the default
OF-101 limit (four hue families; a fifth fails), so this pack declares no `qa:` allowance.

## Titles by slide role

Content, data and reference slides take `top-rule` (the title above a short red rule); data with a
takeaway and definitions take `side-rail`; sequences `kicker-numeral`; image slides `bottom-anchor`;
statements `statement`. All of them draw in the shared title zone. Force one with `title: <id>` on
the line after `layout:`.

## Families and variants

- `asymmetric-feature` and `image-split` pair a work or a building with what to see in it.
- `timeline` places periods, schools or projects in order.
- `process` and `step-diagram` set a making process in three to five steps.
- `comparison` and `text-two-column` read two works, periods or methods side by side.
- `big-number`, `kpi-row`, `chart-insight`, `table-insight` carry the few figures such a talk has.
- `quote` sets a maker's sentence; `statement` holds one idea at display size; `agenda` opens a
  workshop with its sessions.
- Covers `cover-typographic`, `cover-split-field`, `cover-numeral`; sections `section-field`,
  `section-numeral`; closings `closing-ask`, `closing-summary-list`, `closing-statement`.

Display devices: the typographic cover sets the topic at display size on the left half and the
composition on the right, the yellow square and red circle above, the black bar and blue triangle
below, each in its own grid cell; a statement keeps its sentence left and a narrower composition
from column 10 to the edge; a big number is a blue field panel; a closing's next step stands between
two rules, and a closing statement takes the statement's composition. The compiler draws the
composition with the display device `geometry` (see `layout-families.md`).

## Do

- Keep the geometry on the cover and the statements; content slides carry type, images and data.
- Use at most one statement per section, so the composition stays an event.
- Caption every work with maker, year and source.
- Let red mark one word or one figure on a content slide.

## Avoid

- Circles, squares or triangles as bullets, icons or frames on content slides.
- Yellow text on the off-white ground.
- A fifth hue family beside the three primaries and the ink.
- This direction for a ledger, a finance review or a sensitive topic.

## Two worked slides

A lecture slide pairs a building with what to see in it; the caption carries the source.

```markdown
---
layout: image-split

## 데사우 교사(校舍)의 세 가지 설계 원칙

![도 1. 데사우 교사 전경 | 출처: 예시 이미지](assets/example-a.png)

- **기능별 동** 공방, 교실, 기숙사를 각각의 동으로 나눠 다리로 잇는다
- **유리 커튼월** 공방 동의 외벽 전체가 유리라 작업이 밖에서 보인다
- **비대칭 배치** 정면이 없어, 걸으며 돌아봐야 전체가 읽힌다
- 출처: 예시 건축사 강의 자료, 2026년 (예시)
---
```

A timeline puts the school's three sites in order, with what changed at each.

```markdown
---
layout: timeline

## 학교의 세 시기, 1919-1933년

| 시점 | 장소 | 무엇이 바뀌었나 |
|---|---|---|
| 1919년 | 바이마르 | 공방 중심 교육, 표현주의의 영향이 강하다 |
| 1925년 | 데사우 | 산업 생산과의 협업, 표준화된 제품 디자인 |
| 1932년 | 베를린 | 사립 학교로 축소, 이듬해 문을 닫는다 |

> 표 1. 바우하우스의 세 시기 (예시 자료)

- 출처: 예시 디자인사 강의 노트, 2026년 (예시)
---
```

## Examples

`16-design-lecture-bauhaus-ko.md`
