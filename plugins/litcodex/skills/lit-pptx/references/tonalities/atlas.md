# Atlas

Atlas is a field book: photographs carry the evidence and short captions say what, where, when and
how much. A photograph either runs off the page edge or fills most of the body, and its label
sits on a dark panel laid over it or underneath it. The palette stays out of the way, near-black ink and one muted navy, because
the photographs supply the colour. Every picture has a numbered caption and a source, which keeps
the deck honest about what the reader is looking at.

## Reach for it

- Field and site reports, construction or restoration progress, product reports, exhibitions,
  portfolios: any deck whose proof is something to see.
- Outlines where a third or more of the slides hold a photo, render or screenshot.
- Audiences who judge by looking: clients, review panels, residents at a briefing.
- First candidate for image-led decks; third for a pitch when the product is physical.

## Pass on it

- Sources with no real pictures. Atlas without images is a set of grey boxes; pick Ledger, Gazette
  or Signal.
- Table-heavy work: Atlas has no table family at all. Put the numbers in `kpi-row` or `timeline`,
  or choose another pack.
- Long argument in prose: the text families here are narrow by design.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FFFFFF / #F3F4F5 |
| ink / ink-muted / line | #1A1D21 / #555B63 / #D6D9DD |
| accent / accent-deep / accent-tint | #2B4C7E / #1B2F4E / #E6ECF4 |
| field / on-field | #1A1D21 / #FFFFFF |
| positive / negative | #1E7A3F / #B3261E |
| series | #2B4C7E, #555B63, #8A6A2E, #3E7A5A |
| faces | Pretendard Bold titles; Pretendard Regular body, labels, display and numerals (a lighter voice than the other packs); `faces: a2z` swaps display and numerals to A2Z Light |
| type voice | tracking 0 titles, −1 display |
| table | no header fill, bold ink header, hairline rows, no banding, numbers right-aligned |
| chart | hairline gridlines, direct labels, accent on the item that matters |
| image | no frame |
| decoration | caption band, hairline rule, colour field |
| radius / edge | 0 / fill |

## Dials and type

Density 10, variance 7 (four or five treatments, no family more than twice in a row). The fill order
starts with `anchor-visual`: a picture or chart takes the room before type or gaps change.

## Titles by role

| Role | Default |
|---|---|
| image | `overlay` (dark panel over a full-bleed photo) |
| data-takeaway | `bottom-anchor` |
| data, sequence | `top-plain-large` |
| content, reference, definition | `side-rail` |
| statement | `statement` on the whole-page field |

## Families and variants

- `image-full`: one photograph as the page, label and caption on the panel.
- `image-split`: a photograph beside four to six labelled facts (요약, 유속, 수심 …).
- `figure-pair`: before and after from the same viewpoint, one line of reading under them.
- `photo-grid`: two or three photos compared, one line of text; never more than three in a row.
- `asymmetric-feature`: one large picture with a narrow column of facts.
- `kpi-row`, `timeline`, `comparison`, `text-column`: the numbers, dates and words a picture deck
  still needs.
- `statement`: the one pull quote a picture deck may need, on the whole-page field.
- Covers `cover-full-image` (the deck's first picture), `cover-split-image`, `cover-typographic`;
  sections `section-image`, `section-field`; closings `closing-contact-split`, `closing-ask`.

Display devices: cover `plate` (a dark panel as tall as the title and its meta line, standing on the
page foot), statement `drench` (the whole page in the field colour), number panel `tint`, closing floor
`band`. The `section-image` panel stands on the foot too, as tall as the part number and title. The
cover and `section-image` crop pictures to their box with the picture's own proportions.

## Do

- Number captions and give each a source: `도 3. 공사 전 콘크리트 호안, 2025년 2월 | 출처: …`.
- Shoot or choose before/after pairs from the same position and focal length.
- Give every picture slide facts with units (m/s, ha, 마리) rather than adjectives.
- Keep text off photographs except on the overlay panel.

## Avoid

- Text set straight onto a photo.
- Pictures inside card frames, or more than three pictures in one row.
- Grey placeholder boxes in a delivered deck.
- Stretched pictures; supply images at the right proportion or let the box crop them.

## Worked slide

A picture with the facts a reviewer checks, source directly under the image line.

```markdown
---
layout: image-split

## 여울 조성 구간의 유속과 어류 출현

![도 2. 돌을 쌓아 만든 3번 여울, 갈수기 | 출처: 예시 이미지](assets/example-b.png)

출처: 하천관리과 어류·유속 조사, 2026년 9월 (예시)

- **요약** 여울 6곳 모두에서 물살이 빨라지고 여울성 어류가 돌아왔다
- **유속** 여울 위 평균 0.6m/s, 조성 전 평탄 구간 0.15m/s
- **수심** 여울 10-30cm, 여울 아래 소 80cm 안팎으로 깊이가 다양해졌다
- **어류** 피라미·돌고기·참갈겨니 3종이 여울에서만 잡혔다
---
```

## Examples

`08-field-report-atlas-ko.md`
