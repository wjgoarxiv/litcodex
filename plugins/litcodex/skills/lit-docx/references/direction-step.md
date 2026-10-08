# Choosing a document direction

Before converting anything, lit-docx decides what kind of document it is building and writes that
decision down. The decision is a **direction card**. It names one of the six tonalities, gives the
reason in terms of the reader and the source, and lists two alternatives that were considered. A
bare request ("make this into a report", "이 메모로 제안서 만들어줘") gets a card and a document,
not questions: the skill decides, says what it decided, and the user can redirect after seeing
pages.

The six tonalities are not colour themes. They differ in what stands on page 1, how the summary is
set, whether sections are numbered, which page components may appear and what the running head
carries. Every one of them sets ink headings, booktabs tables without fills, Pretendard, an A4 page
with 25 mm sides and at most one accent colour on at most two kinds of element. A reader who sees
the Memo and the Report built from the same notes should recognise two different documents, not
one document recoloured.

## 1. Settle the brief

Read the request and the source once and fix four facts before choosing:

| Fact | Where it comes from | What it changes |
| --- | --- | --- |
| Document type | the user's words (보고서, 제안서, 안내문, memo, white paper) or the source's shape | the candidate list (section 2) |
| Reader | named in the request, or implied (경영회의, all staff, a funder, a technician) | conclusion-first vs. evidence-first, length |
| Length | the source's volume; a stated page limit wins | Memo and Brief stay at 1-3 pages |
| Language | the source text | Korean conventions (section 5) or English ones |

When the user names a publisher profile (elsevier, acs, ieee, nature, korean-generic), there is no
tonality: the publisher path runs and this card is skipped. A tonality and `--publisher` together
are an error by design.

## 2. Candidates by document type

| Document type | First choice | Alternatives | Typical length |
| --- | --- | --- | --- |
| Periodic or project report, analysis (보고서, 결과 보고) | Report | Brief, Manual | 4-30 pages |
| Briefing for one decision (검토 보고, 브리핑) | Brief | Report, Memo | 1-3 pages |
| Procedure, guide, operating manual (절차서, 매뉴얼) | Manual | Report, Brief | 3-40 pages |
| Proposal, plan, funding request (제안서, 기획서, 계획서) | Proposal | Report, Brief | 3-15 pages |
| Notice, internal memo, short request, letter (안내문, 공지) | Memo | Brief, Report | 1-2 pages |
| Long-form reading: essay, white paper, research summary | Journal | Report, Proposal | 4-20 pages |

What each first choice builds, in short:

- **Report**: a typographic title block on page 1, a contents list from five pages, Korean
  sections numbered Ⅰ. / 1. / 가. (English 1 / 1.1), evidence in booktabs tables with captions,
  units and source lines, the short title and folio in the footer.
- **Brief**: the decision request directly under a compact title block, a summary of numbered
  points (① … ④, each a bold lead sentence and then plain text), unnumbered sections, one box at
  most, the folio alone at the foot.
- **Manual**: a document-control block (document, owner, organisation, issued), decimal sections,
  numbered steps, one warning style for every callout, an optional sidebar, the short title in the
  header.
- **Proposal**: a typographic cover page (title in the upper third, one short rule, byline and
  date at the foot), one key-figure strip in the overview, one decision box, a budget table,
  unnumbered sections.
- **Memo**: no cover; a label, the subject as title, To / From / Subject rows between hairlines,
  no components, unnumbered sections, the folio from page 2.
- **Journal**: two columns, a title block with authors, abstract and keywords, decimal sections for
  cross-references, Latin text in Times New Roman with Hangul and headings in Pretendard.

## 3. Let the source reorder the list

The type table gives the order; these signals in the source can move an alternative to the front.
State the signal in the card when it changes the choice.

| Signal in the source | Moves toward |
| --- | --- |
| A decision is asked of one reader or one meeting, and the source fits in three pages | Brief |
| Numbered actions, cautions, roles, contact points | Manual |
| A budget, an amount to approve, a schedule of work | Proposal |
| Five or more tables, or figures with captions and sources | Report |
| Continuous argument with an abstract and references, little tabular data | Journal |
| Under 600 words with a sender and recipients | Memo |

If two signals conflict (a budget inside a monthly report), keep the type's first choice and use a
component for the minority need (a decision callout in a Report). A tonality is never chosen for
its look.

## 4. Write the card

The card goes into the build log and its first lines into the reply. Fields:

```
Direction card
- Type and reader: <document type> for <reader>; <length>
- Tonality: <Name> (alternatives: <A>, <B>)
- Why: <one or two sentences tied to the reader and to source signals>
- Dials: density <n>, variance <n> (pack default unless moved by at most 2, with the reason)
- Page 1: <title block or cover variant>; headings <numbered / unnumbered>
- Components: <kind: what it serves>, … (budget ≤ 3 kinds; none for Memo)
- Wrong if: <the condition under which another tonality would serve better>
```

A filled example for a request "이 실적 메모로 분기 보고서 만들어줘" with a source of seven
tables and a short closing recommendation:

```
Direction card
- Type and reader: 분기 실적 보고서, 경영지원 본부장과 팀장들이 읽음; 4쪽 안팎
- Tonality: Report (alternatives: Brief, Proposal)
- Why: 표 일곱 개가 근거를 나르므로 번호 붙은 절과 캡션·자료 줄이 필요하다; 결정 요청은 한 가지뿐이라 callout 하나로 충분하다
- Dials: density 9, variance 5 (pack default)
- Page 1: masthead title block; headings Ⅰ. / 1. 번호
- Components: keyfigures (요약 아래, 실측 지표 세 개), callout key (4분기 조정 제안), columns (원인 두 갈래 비교)
- Wrong if: 독자가 한 사람이고 결정 하나만 필요하면 Brief가 맞다
```

Rules every card carries, whatever the tonality:

1. The title, subtitle and every heading are noun phrases. "처리량 추이", "Contact volume by
   channel"; never "처리량은 6% 늘었다" or "Volume rose in Q3". The claim opens the paragraph
   under the heading. The gate fails a sentence heading (`heading.declarative`).
2. Numbers are stated as measured, with their basis. No rounding up for effect, no "nearly
   double" for a 70 % rise, no key figure without its comparison line.
3. Pretendard is the face; Journal sets Latin body text in Times New Roman by design.
4. Pages are dense by default: body text runs on, sections do not start new pages, and a short
   page is fixed with content or composition, never with padding.

## 5. Korean and English conventions

| Item | Korean document | English document |
| --- | --- | --- |
| Dates | 2026. 10. 8. or 2026년 10월 8일 (ISO dates are converted; the gate fails one left in the text) | 8 October 2026 |
| Table caption | 표 1. 제목 (단위: …, 예시) above the table | Table 1. Title (units, sample) above |
| Source and note lines | 주: then 자료: under the table | Note: then Source: under the table |
| Numbering (Report) | Ⅰ. / 1. / 가. | 1 / 1.1 |
| Lists | 1. 가. 1) or plain hyphens; no ■ ▶ ✓ or emoji markers | numbered or hyphen bullets |
| Line breaking | Word breaks Hangul at 어절 (wordWrap on, ko-KR); LibreOffice previews may break by syllable | ordinary word wrap |

## 6. Say it and record it

The reply opens with the decision in one line ("Report로 만들었습니다 — 대안으로 Brief, Proposal을
검토했습니다") and the reason in one more. The full card stays in the build log next to the
output. When the user asks to compare, build the same source in the first choice and one
alternative, render the first two pages of each, and show them side by side; then the gate's
`--compare` check confirms the two differ in at least three structural features.

## 7. Failure patterns

| Pattern | What it looks like | Fix |
| --- | --- | --- |
| Silent default | a document with no card, built in whatever the converter defaults to | always write the card; the plain profile is not a direction |
| Recoloured twin | two tonalities that differ only in accent | pick by structure; check with `docx qa --compare` |
| Box in every section | a callout, a sidebar and key figures on each page | budget ≤ 3 kinds, each with a purpose line |
| Cover with tiles | key figures or a colour block on the cover | covers are typographic; key figures belong in the summary |
| Sentence headings | "매출이 늘었다" as a heading | noun-phrase label; the claim moves into the body |
| Forced page breaks | each H1 on a new page, half-empty pages before it | let sections run on; the converter keeps headings with their text |

## 8. Worked sources

`references/examples/` holds nine sources that convert and pass the gate with page checks:

| File | Tonality | Shape |
| --- | --- | --- |
| `01-report-ko.md` | Report | quarterly usage report, three tables, key figures, a two-column comparison, one decision callout |
| `02-brief-ko.md` | Brief | decision request first, four numbered points, one table |
| `03-manual-ko.md` | Manual | document control, numbered steps, a contacts sidebar, one warning |
| `04-proposal-ko.md` | Proposal | typographic cover, key figures, decision box, budget and schedule tables |
| `05-memo-en.md` | Memo | one-page notice with To / From / Subject |
| `06-journal-en.md` | Journal | two-column white paper with abstract and keywords |
| `07-report-en.md` | Report | quarterly review in English numbering |
| `08-proposal-en.md` | Proposal | English proposal with a decision box and budget |
| `09-memo-ko.md` | Memo | 한 쪽 안내문 |
