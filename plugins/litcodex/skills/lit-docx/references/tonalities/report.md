# Report

Report is for documents that carry evidence: quarterly results, project reports, analyses
and reviews read by managers who will look for the number behind each claim. In Korean it follows
the manner of an institute issue note: running prose under numbered sections, tables with full
caption sets, nothing on the page that does not carry information.

## Choose it when

- Periodic or project results with several tables or figures (four pages or more).
- An analysis whose reader checks sources: each table has units, notes and a source line.
- A document that will be cited by section number in a meeting (Ⅱ.2, 3.1).

## Choose something else when

- One decision for one reader in under three pages: use Brief.
- Steps someone performs in order: use Manual.
- An amount to approve and a schedule of work are the point: use Proposal.

## Structure it builds

- Page 1: masthead title block (title, subtitle, author, organisation, date) with the notice line once under it; the text starts on the same page.
- A contents list from five pages.
- Summary as prose (요약 / Summary), optionally followed by one key-figure strip of measured indicators.
- Sections numbered Ⅰ. / 1. / 가. in Korean, 1 / 1.1 in English.
- Evidence in booktabs tables with `표 n.` captions, `(단위: …)`, `주:` and `자료:` lines.
- Footer: short title and folio; no header.

Components: keyfigures (once, under the summary), callout `key` for a proposal or decision, columns for two parallel short blocks.

## Tokens (from `templates/tonalities/report.yaml`)

| Token | Value |
| --- | --- |
| Dials | density 9, variance 5 |
| Body | Pretendard 10.5 pt (Korean), Pretendard 10.5 pt (Latin) |
| Heading ramp | h1 1.4 ×, h2 1.2 ×, title 2.5 × body |
| Numbering | ko: roman-ko, en: decimal |
| Page 1 | masthead; contents list |
| Summary form | prose |
| Running head | footer: title+folio |
| Columns | 1 |
| Accent | 1F3A5F on title_rule, callout_rule |
| Allowed components | keyfigures, callout, columns |

Every tonality shares the restraint rules: ink headings, booktabs tables without fills, A4 with
25 mm sides, leading calibrated from Pretendard's 1.53 em single line, the notice printed once.

## Worked source

```markdown
# 요약

3분기 출고는 41.2만 건으로 2분기보다 4.1% 많았다. 늘어난 물량의 대부분은 서부 센터에서 나왔다.

::: keyfigures
- **41.2만 건** 3분기 출고 (예시)
  - 2분기 39.6만 건 대비 4.1% 증가
:::

# 센터별 처리량

표 1. 센터별 분기 출고 (단위: 천 건, 예시)

| 센터 | 2분기 | 3분기 |
| --- | ---: | ---: |
| 서부 | 158 | 172 |
| 동부 | 238 | 240 |

자료: 출고 관리 시스템(2026년 4-9월)
```

## Do

- Open each section with the finding in one sentence, then the table that shows it.
- Keep table captions, units and sources complete on every table.
- Use the decision callout once, near the end, for what the reader is asked to do.

## Avoid

- Headings such as 개요 / 주요 내용 / 시사점 with nothing specific in them; name the subject.
- A key-figure strip in every section; one strip, under the summary.
- Starting each Ⅰ. section on a new page.
