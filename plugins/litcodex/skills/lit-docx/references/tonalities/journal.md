# Journal

Journal is for long-form reading set in two columns: essays, newsletters, white papers and
research summaries that are not bound for a named journal (those use a publisher profile). Its
pages look like a printed paper: a title block with authors, abstract and keywords, then
continuous text.

## Choose it when

- A continuous argument with an abstract, sections and references.
- A research summary or white paper for a general professional reader.
- Text that will be cross-referenced by section number.

## Choose something else when

- A submission to Elsevier, ACS, IEEE or Nature: use `--publisher`.
- Tables carrying most of the content: use Report.
- A plan asking for approval: use Proposal.

## Structure it builds

- Page 1: masthead title block with authors, abstract and keywords from the frontmatter.
- Two columns, ragged right; Latin text in Times New Roman, Hangul and headings in Pretendard.
- Decimal section numbers for cross-references.
- Tables span the column; captions above (Table n.), sources below.
- Header: short title and folio.

Components: callout `note` at most, used rarely; no key figures, no sidebar.

## Tokens (from `templates/tonalities/journal.yaml`)

| Token | Value |
| --- | --- |
| Dials | density 9, variance 6 |
| Body | Pretendard 10.5 pt (Korean), Times New Roman 10.5 pt (Latin) |
| Heading ramp | h1 1.3 ×, h2 1.15 ×, title 2.5 × body |
| Numbering | decimal |
| Page 1 | masthead |
| Summary form | prose |
| Running head | header: title+folio |
| Columns | 2 |
| Accent | none (ink only) |
| Allowed components | callout |

Every tonality shares the restraint rules: ink headings, booktabs tables without fills, A4 with
25 mm sides, leading calibrated from Pretendard's 1.53 em single line, the notice printed once.

## Worked source

```markdown
---
title: Rainwater reuse in mid-size office buildings
tonality: Journal
abstract: Eight office buildings were metered for three years …
keywords: rainwater harvesting, office buildings
---

# Introduction

Office buildings use most of their water for toilets, cooling and irrigation.
```

## Do

- Write the abstract as four or five sentences: question, method, main result, implication.
- Define measured quantities once, where first used.
- Keep paragraphs of similar length within a section only when the content does.

## Avoid

- Boxes for emphasis; the argument carries emphasis.
- Pull quotes repeating the text.
- Section titles that state conclusions.
