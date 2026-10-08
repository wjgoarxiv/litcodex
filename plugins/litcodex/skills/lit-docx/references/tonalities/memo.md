# Memo

Memo is for notices, internal memos, short requests and letters of one or two pages. It has
no cover and no components; the page carries a label, the subject and the addressing rows, then
plain paragraphs. Its restraint is what makes it read as written by a person.

## Choose it when

- A notice to staff or a team about a change and what they must do.
- A short request or letter under about 600 words.
- Anything with a sender and recipients and no evidence tables.

## Choose something else when

- A decision needing evidence: use Brief.
- Steps someone performs with the page open: use Manual.
- More than two pages: use Report or Brief.

## Structure it builds

- Page 1: a label (안내, Memo), the subject as title, To / From / Subject rows between two hairlines, written in the cover line.
- Unnumbered short sections: what changes, why, who does what, exceptions, contact.
- No components; a callout in the source is set as a bold lead line.
- Folio from page 2 only.

Components: none.

## Tokens (from `templates/tonalities/memo.yaml`)

| Token | Value |
| --- | --- |
| Dials | density 9, variance 2 |
| Body | Pretendard 10.5 pt (Korean), Pretendard 11 pt (Latin) |
| Heading ramp | h1 1.2 ×, h2 1.1 ×, title 1.8 × body |
| Numbering | none |
| Page 1 | memo |
| Summary form | prose |
| Running head | footer: folio, folio_align: right |
| Columns | 1 |
| Accent | none (ink only) |
| Allowed components | none |
| Spacing | tight: line pitch Hangul 165 %, Latin 120 % (the low ends); heading space 12/5 pt above/below h1, 10/4 h2; table cells 2 pt top and bottom |

A memo stays on one page when its content allows. The pack's `spacing: tight` sets the values above,
a run-in head (a callout title read as a bold lead line) keeps 12 pt above it, the paragraph after a
list keeps 6 pt, and the page check `memo.fit` (`docx qa --layout`) fails a memo that spills less than
a quarter of a page onto page 2. A memo that fills more of page 2 is a two-page memo, which the pack
allows.

Every tonality shares the restraint rules: ink headings, booktabs tables without fills, A4 with
25 mm sides, leading calibrated from Pretendard's 1.53 em single line, the notice printed once.

## Worked source

```markdown
::: cover variant=masthead kicker="안내"
수신: 본사 전 직원 · 발신: 경영지원팀 · 제목: 회의실 예약 방식 변경
:::

# 변경 내용

11월 3일(월)부터 회의실 예약 단위를 30분으로 줄인다.
```

## Do

- Put the date the change takes effect in the first paragraph.
- Address each affected group in its own short section.
- End with whom to ask and by when.

## Avoid

- Boxes, key figures or a cover page.
- Headings phrased as questions or sentences.
- Bullet lists for content that reads better as two sentences.
