# Studio

Studio is a magazine spread. The 12-column grid shows through as one or two column hairlines,
titles carry a bar in the left margin or open the page at display size, splits are asymmetric, and real
numbers are set large on a tinted panel. A dark ochre accent marks the one thing to look at, and
the field is near-black. It suits work that has a point of view: a portfolio, a product with a
story, a public lecture.

## Reach for it

- Portfolios, case studies, design and architecture presentations, product stories, public
  lectures, pitches for physical or visual products.
- Outlines that mix pictures, a few strong figures and short editorial text.
- Second candidate for pitches and image-led decks; third for public lectures.

## Pass on it

- Dense data reviews: editorial white space starves tables, and Studio has no table family.
  Ledger or Night.
- Korean desk-read briefings: Gazette.
- Decks with no real figures or images: large numerals and splits need something true to show.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FFFFFF / #F2F2F0 |
| ink / ink-muted / line | #141414 / #525252 / #D2D2CE |
| accent / accent-deep / accent-tint | #8A5A00 / #4D3200 / #F5ECD9 |
| field / on-field | #141414 / #FFFFFF |
| positive / negative | #1E7A3F / #B3261E |
| series | #8A5A00, #141414, #525252, #3B5F7F |
| faces | Pretendard Bold (display, title, numerals), Pretendard Regular (body, labels); `faces: a2z` gives A2Z Black display and numerals, A2Z Medium titles |
| type voice | tracking −1 titles, −2 display |
| table | no header fill, one rule under the header, no banding, bold totals |
| chart | no gridlines, direct labels, accent on the highlighted bar |
| image | no frame |
| decoration | column hairlines, numeral, rail fill, colour field, caption band |
| radius / edge | 0 / fill |

## Dials and type

Density 10, variance 8 (four or five treatments, a family at most twice in a row). The fill order
starts with `change-family`: when a page is short, the fix is a different family, not larger type.

## Titles by role

| Role | Default |
|---|---|
| content, data-takeaway, sequence, reference, definition | `side-rail` |
| data | `top-plain-large` |
| image | `side-rail`, the picture's takeaways in the rail (`overlay` for `image-full`) |
| statement | `statement` (between two hairlines) |

`text-two-column` takes only `top-plain-large`; `photo-grid`, `timeline` and `asymmetric-feature`
take `top-plain-large` or `bottom-anchor`.

## Families and variants

- `image-full`, `image-split`, `photo-grid`, `asymmetric-feature`: the picture families.
- `big-number`, `kpi-row`: real figures with basis rows, never decorative numerals.
- `chart-insight`: one chart with its reading, no gridlines.
- `comparison`, `timeline`, `text-two-column`: the argument, the programme, the brief.
- `statement`: between two hairlines on the open page, for a pull quote or a display-led deck on request
  (a light rail beside it stood empty).
- Covers `cover-split-image` (the deck's first picture), `cover-rail`, `cover-numeral`; sections
  `section-numeral`, `section-rail`; closings `closing-contact-split`, `closing-summary-list`.

Display devices: statement `rules`, number panel `tint`, closing floor `band`. Studio names no cover
device, so a generic cover draws `cover-split-image` when the deck has a picture.

## Do

- Let one element dominate each page: a picture, a figure panel or the title.
- Give every large figure a label and a basis; a numeral with nothing behind it is a defect.
- Alternate rail and open pages so the grid reads as a rhythm, not a template.
- Prefer `closing-summary-list` with the ask and next step when the closing needs many words.

## Avoid

- Large numerals that are not real figures.
- Column hairlines running through text.
- Two side-rail slides with the same split in a row.
- Centred body text.

## Worked slide

The brief of a portfolio set as two columns of grouped facts under an open title.

```markdown
---
layout: text-two-column

## 의뢰 배경과 작업 범위

- **의뢰 배경**
  (1) 사과·참기름·잡곡을 파는 농가 세 곳, 연 매출 합계 14억 원
  (2) 온라인 판매가 늘었지만 상자와 병이 도매용 그대로라 선물로 고르기 어려웠다
- **작업 범위**
  (1) 브랜드 이름 글자와 색 체계, 상자·병·봉투 패키지 11종
  (2) 택배용 완충 구조 설계와 파손 시험
- **조건과 결과**
  (1) 기존 포장 단가보다 개당 10% 넘게 오르지 않을 것
  (2) 실제 단가는 평균 6% 올랐고, 반품률은 1.2%로 내려갔다
- 주: 농가별 판매 기록과 택배 반품 기록, 2025년 9월-2026년 8월 기준 (예시)
---
```

## Examples

`02-pitch-studio-en.md`, `11-portfolio-studio-ko.md`
