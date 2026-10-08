# Manual

Manual is for procedures and guides that someone follows with the document open: operating
steps, safety procedures, onboarding guides. Its pages are built for finding a step again, so
sections are numbered decimally and every caution looks the same.

## Choose it when

- Numbered steps performed in order, by a named role.
- Hazards and prohibitions that must stand out the same way every time.
- Reference matter (contacts, tool lists) looked up beside the steps.

## Choose something else when

- Results or analysis: use Report.
- A one-page instruction to all staff: use Memo.
- A request to approve a change: use Brief or Proposal.

## Structure it builds

- Page 1: the title over a document-control block (document, owner, organisation, issued); a typographic cover when the procedure is long.
- A short contents list.
- Decimal sections 1 / 1.1; steps as a numbered list, one action per step.
- One callout style (`warning`) for every caution; a sidebar beside the text for contacts or definitions.
- Header: short title; footer: folio at the right.

Components: callout `warning` (cautions only), sidebar (reference matter), columns (steps beside checks).

## Tokens (from `templates/tonalities/manual.yaml`)

| Token | Value |
| --- | --- |
| Dials | density 9, variance 6 |
| Body | Pretendard 10.5 pt (Korean), Pretendard 10.5 pt (Latin) |
| Heading ramp | h1 1.35 ×, h2 1.15 ×, title 2.5 × body |
| Numbering | decimal |
| Page 1 | manual; contents list |
| Summary form | prose |
| Running head | header: title, footer: folio, folio_align: right |
| Columns | 1 |
| Accent | 2E4A66 on callout_rule, sidebar_rule |
| Allowed components | callout, sidebar, columns |

Every tonality shares the restraint rules: ink headings, booktabs tables without fills, A4 with
25 mm sides, leading calibrated from Pretendard's 1.53 em single line, the notice printed once.

## Worked source

```markdown
## 입고 순서

1. 납품서의 품목과 수량을 주문 내역과 맞춰 본다.
2. 시약 관리 시스템에 등록하고 바코드 라벨을 붙인다.

::: callout kind=warning title="혼합 금지"
서로 다른 등급의 폐액을 한 통에 붓지 않는다.
:::
```

## Do

- Start every step with the action (확인한다, 적는다, Press, Record).
- State who does each part of the procedure.
- Keep the warning text short enough to read while working.

## Avoid

- Narrative paragraphs where steps belong.
- Mixing note, key and warning boxes in one manual.
- A sidebar that holds steps; steps stay in the main text.
