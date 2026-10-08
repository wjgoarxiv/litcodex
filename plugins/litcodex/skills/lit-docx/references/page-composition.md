# Page composition

How a tonality page is measured, what the converter does without being asked, what the gate
measures on the rendered pages, and how to fix each finding from the source.

## The page

| Token | Value | Why |
| --- | --- | --- |
| Paper | A4 | institute and government reports print on A4 |
| Side margins | 25 mm | a text block of about 160 mm keeps Korean lines near 40 syllables at 10.5 pt |
| Bottom margin | never smaller than the top | the page stands on its foot |
| Body | Pretendard 10.5 pt (Memo and Proposal English 11 pt) | institute body size |
| Heading ramp | h1 1.3-1.4 × body, h2 1.15-1.2 ×, h3 = body bold | separation by weight and space, not size jumps |
| Space | above a heading about twice the space below it | the heading belongs to what follows |
| Colour | near-black ink; one accent on at most two element kinds | restraint |

The density dial (1-10, pack default 8 or 9) scales margins, leading and body size within these
bounds. The skill may move it by at most 2 without asking and says so in the card.

## Leading, calibrated by render

Pretendard's single line is tall: measured at about 1.55 em in Word and 1.51 em in LibreOffice,
mean 1.53 em. A Word "multiple" spacing is therefore a multiple of that, not of the font size.
The converter sets the multiple as the wanted pitch divided by 1.53:

| Text | Wanted pitch | Multiple written | Rendered pitch |
| --- | --- | --- | --- |
| Korean body | about 174 % of the size | about 1.14 | 172-177 % |
| Latin body | about 131-133 % | about 0.86 | 130-134 % |
| Table cells | tighter by one step | per pack | — |

Setting Hangul at 200 % or more (a common reflex) produces the loose, airy page that reads as
generated. Korean paragraphs are justified in Report, Brief, Proposal and Memo; Word gets
`w:wordWrap` on and the ko-KR language tag so it breaks Hangul between 어절. LibreOffice previews
may still break inside a word; Word does not.

## What the converter does on its own

- Keeps every heading with the next paragraph, and a closing paragraph of up to about four lines with
  the paragraph above, so the last page never holds one orphaned paragraph.
- Keeps a list of up to six items together (every item but the last keeps with the next), with a
  lead-in of a line or two right before it ("다음 단계는 아래와 같다."). In a two-column body a list of
  five or six items keeps its lead-in with its first two items and its last two items together, and may
  break once between them, so the block does not jump to the next column and empty a third of the one before.
- Keeps the last section of a single-column document whole when it has no table or picture and runs to
  about twelve lines or fewer, so its paragraph goes to the last page with its list.
- In a two-column body, spans a `자료:` or `Source:` line with its page-wide table, so the heading after it
  opens the column section with its text, and ends the columns with a continuous break so the last page
  balances them (the last paragraph may break across the two columns).
- Keeps a heading whose first paragraph opens a table with that table (caption and units line too), so
  the heading and its sentence never wait at a page foot.
- Sets a source of about one page (by its own estimate) with tight spacing in any tonality, as a memo
  is, so it does not spill a few lines onto a second page.
- Draws no second rule when a section that opens under a hairline follows a ruled box.
- Lets sections run on: no page break before an h1 unless the source asks for one.
- Sizes table columns to their longest word and content; never narrower than the longest word. A
  text column that wraps while the others hold their longest cell with room to spare takes that room
  when it is enough to set its longest cell on one line.
- Writes negative figures in tables with the minus sign (−), Korean tables too, and keeps 6 pt under a
  sentence right above a table that has no caption.
- Under a publisher profile, stands the paragraph after a table three quarters of a body line clear and
  a paragraph after a list 6 pt clear, and keeps a list of up to six items together.
- Keeps a table that fits on one page whole, with its caption and source lines; a long table (a
  header and six or more body rows) may break between rows with the header repeated, three body
  rows at least on each side.
- Converts ISO dates in Korean text to `2026. 10. 8.` form before typesetting.
- Prints the frontmatter `notice:` once (title block or cover line), never as a coloured chip in
  every header.
- Restarts numbered lists after a heading; spaces a bold-lead list item from its text.

## What the gate measures

`docx_craft.py` is the lit-docx gate. Run through the office runner:

```bash
node <lit-pptx>/scripts/office-run.mjs docx qa out.docx --source draft.md --layout
node <lit-pptx>/scripts/office-run.mjs docx qa out.docx --source draft.md --compare other-tonality.docx
```

Always (from the Word file):

| Check | Fails when |
| --- | --- |
| content | a source heading did not reach the document, a blank such as [금액] or TBD is left, or frontmatter is printed as text |
| `heading.declarative` | the title, subtitle or a heading is a sentence |
| `heading.order` | a level is skipped downward, or the first heading is below h2 |
| `date.iso` | an ISO date remains in Korean text (every path) |
| `notice.dash` | the frontmatter notice joins its label and line with a spaced dash instead of a colon (`예시 데이터: …`); FAIL on a tonality document, advice on the plain and publisher paths |
| OF-302 | a numeric table column is not right-aligned |

On a tonality document (restraint):

| Check | Fails when |
| --- | --- |
| `color.accent-kinds` | more than one non-ink hue, or the accent on more than two element kinds |
| `heading.ink` | a heading is set in a colour |
| `heading.ratio` | h1 is more than 1.5 × the body size |
| `table.fill` | a data cell is shaded, or a component tint is darker than L 95 % |
| `component.budget` | more than 3 kinds, more than 1 key-figure strip, any pull quote, or figures on the cover |
| `furniture.chip` | a coloured or shaded notice sits in a page header |

With `--layout` (rendered through soffice in a private profile):

| Check | Fails when |
| --- | --- |
| `fill.page` | a body page is filled under 35 % (cover and last page excepted) |
| `heading.stranded` | a page ends on a heading |
| `page.spill` | a two-page document fills its second page under 40 %, or a document ends on a page filled under an eighth (a paragraph or two) |
| `list.split` | a list of up to six items runs over two pages or columns (one break of a five- or six-item list in a column, two items or more each side, is allowed) |
| `heading.apart` | a heading and its lead sentence end a page while the table they open starts the next |
| `heading.column` | in a two-column body a heading ends a column while its first lines open the next |
| `columns.balance` | in a two-column body a column stops a quarter of the frame short (under 75 %) beside one that runs to the foot, or the last page sets one column under half the depth of the other |
| `heading.wrap`, `title.lines` | a heading breaks inside a word, or the title takes more than three lines |
| `table.split`, `figure.split` | a table that fits splits, a component box splits, or a picture leaves its caption |
| `component.variety` | a document of four or more pages uses fewer than two component kinds (Memo excepted) |
| `cover.block` | a filled shape covers more than a quarter of the cover |
| `sidebar.overlap`, `folio.total` | a sidebar runs into the next heading; a page / total folio miscounts |

With `--compare`: `tonality.structure` fails when two tonalities of one source differ in fewer
than three of title block, summary form, numbering, component set, running head and contents.

## Fixing findings from the source

| Finding | Fix |
| --- | --- |
| Short page before a large table | move a paragraph that discusses the table above it, or split a long table at a natural group |
| Stranded heading | give the section a lead paragraph; never insert empty lines |
| Near-empty last page (`page.spill`) | cut the lines that spill or give the last page a whole section; never shrink type |
| Dashed notice (`notice.dash`) | write it as a label and its line: `notice: "예시 데이터: 수치는 가정입니다"` |
| Table split | shorten the table (move detail rows to an appendix table) or let it qualify as a long table |
| Sentence heading | rewrite as a label; move the claim into the first sentence of the section |
| Too few component kinds | a key-figure strip under the summary or a decision callout, each with a purpose; or accept the advisory when the document is a plain procedure |
| Budget exceeded | drop the component with the weakest purpose line |

## Numbers on the page

Key figures are set at most at h2 size, each with its basis. Units go in captions or column heads
(`(단위: 천 권)`), not repeated in every cell. Negative changes are written with a minus sign; in
government 개조식 the triangle △ is the convention and may be used consistently. Percentages keep
one decimal only where the source does.
