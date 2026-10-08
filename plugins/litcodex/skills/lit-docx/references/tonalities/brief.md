# Brief

Brief is the briefing for one decision. The reader may read only the first page, so the
request comes first and the evidence follows in as few pages as the decision allows. It is short
on purpose and plain on purpose.

## Choose it when

- A decision for one meeting or one person, with supporting facts that fit in one to three pages.
- A 검토 보고 that must say yes or no to one option.
- An update whose reader needs the conclusion before the background.

## Choose something else when

- Several decisions or a long evidence base: use Report.
- A notice with no decision: use Memo.
- A plan with a budget table at its centre: use Proposal.

## Structure it builds

- Page 1: compact masthead, then the decision request as a `key` callout directly under it.
- Summary as numbered points: each a bold lead sentence, then one or two plain sentences.
- Unnumbered sections, each opening under a full-width hairline.
- One table at most per section; one box in the whole document.
- Footer: folio only.

Components: callout `key` (the decision request, once), columns for two options side by side.

## Tokens (from `templates/tonalities/brief.yaml`)

| Token | Value |
| --- | --- |
| Dials | density 9, variance 3 |
| Body | Pretendard 10.5 pt (Korean), Pretendard 10.5 pt (Latin) |
| Heading ramp | h1 1.3 ×, h2 1.15 ×, title 2.5 × body |
| Numbering | none |
| Page 1 | masthead |
| Summary form | points |
| Running head | footer: folio, folio_align: right |
| Columns | 1 |
| Accent | 2D5A47 on title_rule, callout_rule |
| Allowed components | callout, columns |

Every tonality shares the restraint rules: ink headings, booktabs tables without fills, A4 with
25 mm sides, leading calibrated from Pretendard's 1.53 em single line, the notice printed once.

## Worked source

```markdown
::: callout kind=key title="결정 요청"
11월 경영회의에서 동부 2개 노선 통합을 승인해 주기를 요청한다.
:::

# 핵심 요약

1. **동부 2개 노선은 합쳐도 좌석이 남는다.** 출근 평균 탑승은 합계 61명이다.
2. **통합으로 연간 약 5,800만 원을 아낀다.** 위탁 운행 단가 기준이다.
```

## Do

- Write the request so it can be approved as written: what, how much, by when.
- Make each lead sentence a finding a reader can repeat.
- Cut background the decision does not need.

## Avoid

- A cover page or a contents list.
- More than four summary points.
- Boxes beyond the one decision callout.
