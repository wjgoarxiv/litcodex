# Riso

Riso is the direction for a community, culture or education programme: a workshop, a festival, a
library or museum season, a student club, a nonprofit's year in review. It prints in two spot inks on
warm paper, the look of a risograph poster. Teal fills the cover, the section openers and the
statements edge to edge and runs as a band behind the title of a data page; pink marks the one word
or figure that matters on a content page. Everything else is dark-blue type with grey cards and grey
rules, so the two inks are the only colours on the paper.

## Reach for it

- A public or community audience rather than a board: a workshop or class opener, a festival or
  exhibition programme, a library, museum or youth-centre season, a volunteer briefing, a club's
  recruiting talk, a nonprofit's annual gathering.
- A programme with dates and places, a few counts (participants, sessions, volunteers), steps for
  taking part, and words such as 워크숍, 프로그램, 축제, 동아리, 도서관, 주민, 참여, 자원봉사,
  community, programme, zine.
- First candidate for a community, culture or education programme, ahead of Studio and Bauhaus.

## Pass on it

- A board, finance or public-sector report: two bright inks look unserious there.
- A dense data review (Ledger) or a public data story that lives on its charts (Newsroom).
- Grief, safety or financial-loss topics.
- A design-history lecture (Bauhaus) or a pitch (Signal or Neo-Brutalism).

## Tokens

| Token | Value |
|---|---|
| ground / surface | #F5F0E6 / #E4E2DE |
| ink / ink-muted / line | #1C2433 / #4E5361 / #C4C1BB |
| accent / accent-deep / accent-tint | #D1206B / #8A1043 / #F8D5E3 |
| field / on-field | #00727A / #FFFFFF |
| positive / negative | #1D6B45 / #1C2433 |
| series | #D1206B, #00727A, #1C2433, #8A6A00 |
| faces | Pretendard Bold (display, title, labels, numerals), Pretendard Regular (body); `faces: a2z` swaps in A2Z Bold for display, titles and numerals |
| ramp / hero | compact (body 13 pt, labels 11, sources 9) / the 60 pt hero step on a cover or statement title that fits, off with `hero: false`; figures at most title size |
| density / variance | 10 / 7 |
| radius / edge | 6 / fill |
| decoration | a pink underline under top titles, teal colour fields, kicker numerals |
| table | pink-tint header, a rule under it, grey banding, bold totals |
| chart | no gridlines, direct labels, the accent on the highlighted series over muted ones |

The pink is the fluorescent ink darkened until it holds 4.5:1 on the paper, so it can set a word;
the teal holds white type at 5.6:1. A loss uses ink with a ▼ sign because pink is the accent. The
fourth series colour is an ochre that holds 3:1 on the paper.

## QA allowances

Teal and pink share a content slide inside the default OF-101 limit: a teal title band over a pink
figure is the two-ink print this pack imitates, so the pack declares no `qa:` allowance. Surfaces and
rules are grey on purpose; a warm beige card would read as a third hue family and fail.

## Titles by slide role

Content, image and data-with-takeaway slides take `top-plain-large` (a large title over a pink
underline); data and reference slides take `band` (white title on a teal band across the top);
sequences `kicker-numeral`; definitions `side-rail`; statements `statement`. All of them sit in the
slide grid's one title zone, so a band and a plain title stand at the same place and differ only in
surface. Force one with `title: <id>` on the line after `layout:`.

## Families and variants

- `agenda` opens a programme with its sessions; `timeline` sets the season by date.
- `process` and `step-diagram` show how to take part in three to five steps.
- `kpi-row` and `big-number` carry the few counts such a deck has (people, sessions, books).
- `summary-box-list`, `sidebar-note` and `text-two-column` explain what each session gives.
- `comparison` reads two tracks or two age groups side by side.
- `image-split` and `photo-grid` show last year's sessions; `chart-insight` and `table-insight`
  hold a small result.
- `quote` sets a participant's sentence; `statement` holds the programme's one idea.
- Covers `cover-typographic`, `cover-numeral`, `cover-split-field`; sections `section-field`,
  `section-numeral`; closings `closing-ask`, `closing-summary-list`, `closing-statement`.

Display devices: the typographic cover drenches the page in teal with a white title in the cover's
title zone, the meta line above it and the parts across the strip; a statement and a section opener
take the same teal drench; a big number sits on a teal panel; a closing's next step stands on a teal
band across the body floor.

## Do

- Keep the full teal fields for display slides; on a content page teal is the title band only.
- Let pink mark one word or one figure on a content slide.
- Give every session a date, a place and who it is for.
- Write the way the organisers talk to participants: short, plain, inviting.

## Avoid

- A third ink beside pink and teal (black is the type, not an ink).
- The fluorescent pink as text; the darkened accent is the type colour.
- Gradients, grain or halftone painted to fake the print.
- This direction for a board, finance, public-sector or sensitive topic.

## Two worked slides

A process slide shows how to take part, one step per row.

```markdown
---
layout: process

## 참여는 이렇게: 신청부터 첫 모임까지

- **1. 신청** 10월 31일까지 도서관 누리집에서 한 사람씩 신청한다
- **2. 안내 문자** 모임 사흘 전 장소와 준비물을 문자로 받는다
- **3. 첫 모임** 11월 7일 저녁 7시, 3층 다목적실에서 만난다
- **4. 소모임 배정** 첫 모임에서 관심사별로 다섯 명씩 나눈다
- 출처: 예시 도서관 운영 계획, 2026년 (예시)
---
```

A KPI row carries last season's counts with what each means.

```markdown
---
layout: kpi-row

## 지난 시즌, 숫자로 본 우리 모임

| 참가자 | 모임 | 만든 책자 |
|---|---|---|
| 148명 | 24회 | 6권 |
| 2025년 가을·겨울 | 주 1회, 12주씩 두 번 | 소모임별 1권 |

- 참가자의 절반이 처음 온 주민이었다
- 출처: 예시 도서관 운영 보고, 2026년 (예시)
---
```

## Examples

`17-community-programme-riso-ko.md`
