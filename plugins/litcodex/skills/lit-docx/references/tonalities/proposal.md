# Proposal

Proposal is for a plan that asks for approval and money: a project proposal, a funding
request, an investment plan. It opens with a quiet typographic cover, states the case and the
ask early, and gives the budget and schedule as tables a committee can check line by line.

## Choose it when

- An amount to approve, a schedule and named owners.
- A case that rests on a few measured figures (expected savings, payback).
- A document a committee reads before a meeting.

## Choose something else when

- A results report with a recommendation at the end: use Report.
- A decision with no budget, in under three pages: use Brief.
- An essay arguing a position: use Journal.

## Structure it builds

- A typographic cover page: kicker, title in the upper third, one short rule, subtitle, a two-sentence purpose, byline and date at the foot.
- Overview: the case in prose, one key-figure strip, then the decision box.
- Unnumbered sections: current situation, the proposal, budget, schedule and owners, risks.
- Budget and schedule as booktabs tables; totals in the last row.
- Footer: folio centred.

Components: keyfigures (once, in the overview), callout `key` (the decision box, once), columns (parallel options or methods).

## Tokens (from `templates/tonalities/proposal.yaml`)

| Token | Value |
| --- | --- |
| Dials | density 8, variance 6 |
| Body | Pretendard 10.5 pt (Korean), Pretendard 11 pt (Latin) |
| Heading ramp | h1 1.4 ×, h2 1.2 ×, title 2.7 × body |
| Numbering | none |
| Page 1 | cover |
| Summary form | prose |
| Running head | footer: folio, folio_align: center |
| Columns | 1 |
| Accent | 6E2639 on title_rule, callout_rule |
| Allowed components | keyfigures, callout, columns |

Every tonality shares the restraint rules: ink headings, booktabs tables without fills, A4 with
25 mm sides, leading calibrated from Pretendard's 1.53 em single line, the notice printed once.

## Worked source

```markdown
::: cover variant=typographic kicker="사업 제안서"
본사 사무동 옥상에 100kW 태양광 설비를 설치하는 사업을 제안한다.
:::

# 제안 개요

::: callout kind=key title="결정 요청"
사업비 1억 5,600만 원(예시)과 2027년 2월 착공을 승인해 주기를 요청한다.
:::
```

## Do

- Give every key figure its basis line: price assumption, period, method.
- Put the ask in one box with amount and date.
- Name an owner for every row of the schedule.

## Avoid

- Figures, tiles or a colour block on the cover.
- Payback or savings rounded in the reader's favour.
- A second decision box later in the document.
