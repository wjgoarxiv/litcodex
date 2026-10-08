# Chalk

Chalk is a teacher's board after a careful clean-up. Steps are numbered because they happen in
order, one concept per slide is the thing being taught, and a fenced note holds the definition or
the mistake students make. Surfaces have a small 6 pt radius, the ground is a very pale grey, the
rail and statement field are a deep green, and a warm rust accent marks the concept. It reads well
in the room and still works when students reopen the file a week later.

## Reach for it

- Lectures, training sessions, onboarding, technical tutorials, worked examples.
- Outlines with definitions, a formula, or a how-it-works sequence of three steps or more.
- First candidate for lectures; third for a tutorial-style research talk.

## Pass on it

- Decision decks: the step rhythm reads as padding to an executive. Ledger or Signal.
- Chart-led material: Chalk has no chart family; data appears as `table-insight` or inside a
  worked example.
- Image-led decks: pictures sit beside text, never full-bleed.

## Tokens

| Token | Value |
|---|---|
| ground / surface | #FAFBFC / #EEF2F5 |
| ink / ink-muted / line | #1F2933 / #4E5A66 / #CBD3DA |
| accent / accent-deep / accent-tint | #9A3412 / #6B2409 / #FCEBE0 |
| field / on-field | #1F3B33 / #FFFFFF |
| positive / negative | #1E7A3F / #B3261E |
| series | #9A3412, #1F3B33, #4E5A66, #2E6A8E |
| faces | Pretendard Bold (display, title, numerals), Pretendard Regular (body, labels); `faces: a2z` gives A2Z Bold display and titles, A2Z Black numerals |
| type voice | tracking −1; proportional figures |
| table | `header-fill`: accent-tint header with accent-deep text, row rules, bold totals |
| chart | hairline gridlines, direct labels, accent on the highlighted series, annotation on |
| image | bleed at the sides only, no crop, no frame |
| decoration | accent rule, mark underline (listed, not drawn yet), rail fill in the field colour, numeral |
| radius / edge | 6 / fill |

## Dials and type

Density 10, variance 6. Fill order starts with `distribute`, so short teaching pages open their
gaps before anything else; on the compact step nothing is enlarged.

## Titles by role

| Role | Default |
|---|---|
| content, data, reference | `top-rule` |
| sequence | `kicker-numeral` |
| data-takeaway, image, definition | `side-rail` |
| statement | `statement` (drench) |

`step-diagram` takes only `top-rule`; `sidebar-note` may take `kicker-numeral`, an agenda never (its rows
carry the numbers). Since the agenda carries no numeral (OF-119), a chalk deck that relied on it for its
only kicker needs a step or sidebar slide under `kicker-numeral` to keep three title treatments (OF-110),
and a sidebar note set across the top is one more top-title slide in a grid, which can carry the top/grid
share past 40 % of the content slides (OF-111). A comparison sets its criteria on the board rail under a `side-rail` title (the pack's
`structure`).

## Families and variants

- `step-diagram` and `process`: steps taught in order, each with an example and a check.
- `method`: a formula across the top, its terms in two columns under it.
- `sidebar-note`: groups of the main point plus a `::: main-box` note for the definition or the
  common mistake.
- `table-insight`: a worked table with the reading beside it.
- `image-split`: a worked example beside its figure.
- `comparison`: two concepts students confuse, on the same criteria.
- `agenda`, `text-column`, `quote`, `statement`.
- Covers `cover-rail`, `cover-typographic`, `cover-numeral`; sections `section-numeral`,
  `section-rail`; closings `closing-summary-list`, `closing-ask`.

Display devices: cover `rail`, statement `drench` (the whole slide in the field), number panel
`tint`, closing floor `box`.

## Do

- Number only what is ordered: steps, parts, the exercise sequence.
- Give each step an example with numbers and a check the student can run.
- Put the definition or the common mistake in the sidebar, not in the bullets.
- End on the summary with the exercise, its deadline, its format and the next session.

## Avoid

- More than one marked concept per slide.
- Numerals on points that have no order.
- Definitions buried in a bullet list.
- A section numeral with no agenda behind it ("1" on a page encodes nothing).

## Worked slide

A method slide: the formula reads across the top, the terms fill two columns beneath it.

```markdown
---
layout: method

## Duty point and system curve

H_sys = H_static + k · Q²

- **H_sys** head the system needs at flow Q, in metres of liquid
- **H_static** height difference between suction and delivery levels, 12 m in the example
- **k** friction coefficient of the pipework, from pipe length, diameter and fittings
- **Q** flow rate in m³/h; friction head grows with its square
- **Duty point** where the pump curve crosses the system curve
- **BEP** best efficiency point, the flow at which the pump wastes least energy
- Source: Example Plant Engineering Academy course notes, module 2, 2026
---
```

## Examples

`06-lecture-chalk-ko.md`, `12-tutorial-chalk-en.md`
