# Anti-Slop Checklist for PPTX Outputs

Run after building any deck. Brand specifics (palette, fonts) come from the chosen enrolled template — this checklist is template-agnostic.

## Automated checks
- `node "$OFFICE" pptx qa output.pptx` — honest gate: overflow/overlap/off-slide + WCAG contrast + anti-slop terms + objective executive/research OOXML checks (exit non-zero = FAIL).
- `node "$OFFICE" pptx inventory output.pptx verification.json --issues-only` — geometry issues only.
- `node "$OFFICE" pptx qa output.pptx --sibling other.pptx` — when two tonalities of one source are offered, OF-116 fails the pair unless at least two content slides differ in title zone or partition (colour alone is not an alternative).
- On a tonality deck the gate also reads regions (OF-115): a bottom title on the floor, a side rail that carries its slide's criteria, takeaways or source, a text or picture column with no empty band over 40 % of the body beside a longer one (a chart's values table under its takeaways is part of their column, and the neighbour's length never exempts a column), a title panel as tall as its text, no plate under an empty page; OF-117 fails a mostly-white figure picture on a dark ground (give it a `.dark` variant or a `::: chart`); OF-118 a bold run-in label with no separator after it; OF-119 a numeral beside an agenda title.
- A clean gate means **no known defects, not that the deck looks good** — render and eyeball every slide (next section).

## Human-eye checks

### Slide-level
- Every slide has a real, specific title (not placeholder text).
- Accent colors are semantic, not decorative.
- No slide looks like a spreadsheet pasted without editing.

### Table-level
- Header row visually distinct; numeric columns right-aligned.
- Units in headers, not repeated per row; totals obvious but not over-decorated.

### KPI / metrics
- Primary metric is the largest element; delta color is consistent deck-wide; labels are secondary. ≤ 1 accent + optional delta color.

### Text hygiene
- No `TBD`/`TODO`/placeholder/AI-hype wording (gated by `FORBIDDEN_TERMS.json`).
- Source notes exist for external numbers/charts. Headers are specific (avoid bare "Value"/"Metric"/"Score").

### Executive/research copy: hard fail vs review-only

- **Hard fail:** authoring/process trace (`본 슬라이드는…`, `슬라이드 7은…`, `최종본에서 걸러냈다`) and unresolved placeholders (`[자사 확인 필요]`, `[출처 확인 필요]`, `[작성 중]`).
- **Review-only:** unsupported absolutes (`논문이 없다`, `없다는 것이 발견`), empty rhetoric (`판이 굳었다`, `전제로 깐다`), command-like planning (`닫아야 할 게이트`, `역전 금지`), unexplained RAM/FTO/CNKI/코퍼스/전이원, and arbitrary dates or day counts without an approved source.
- Review-only findings must be recorded and rewritten where warranted, but they do not become brittle automated failures. Prefer “검토한 데이터베이스 범위에서는 확인되지 않았다” and expand specialist terms on first use.

## Rendered-page review

Run this pass by eye on the rendered pages once the automated gate is green. It assumes a static
export: no motion, no gradients, no outline or shadow on type.

### Confirm none of these appear
- [ ] A coloured stripe down one side of a card (anything over 1 px). If a group needs a marker, use a 1 px hairline, a flat tint, a real numeral, or an icon placed on the wrapper.
- [ ] A box that is both outlined and shadowed, or an empty outlined box kept for decoration. One box gets either a 1 px border or a shadow of 8 px or less.
- [ ] Mixed corner radii. The deck follows one radius rule (sharp unless the pack says otherwise); pill shapes are for tags only.
- [ ] A grid of identical cards. Vary span or size, or set some groups without a card.
- [ ] Eyebrow words above titles, or `01·02·03` on slides that are not an ordered sequence.
- [ ] A large number used as ornament. A figure is large only when it is the slide's data.
- [ ] Cards around everything, or cards nested in cards. Group with space and hairlines.
- [ ] Gradients, blobs, mesh or noise textures, or hand-drawn SVG (html2pptx blocks these too). The ground is flat.

### Contrast and colour, inside the pack palette
- [ ] Running text reaches 4.5:1 against its ground; text at 18 pt and up (bold 14 pt and up) and structural lines reach 3:1. Measure the actual pair; `qa_deck.py` enforces it.
- [ ] Grey text never sits on a coloured fill; use a darker shade of that fill's own hue. Colour never carries meaning alone: deltas also carry ▲/▼ and a sign.
- [ ] The accent covers roughly a tenth of the slide at most, and each colour keeps one meaning across the deck. No one-off hex values outside the palette.

### Type
- [ ] One family, three or four weights, each weight with one job; body text never in a display cut. With fonts that ship one family per weight (에이투지체, Example Sans), choose the weight by family name, not with a bold flag.
- [ ] Three or four sizes per slide, all from one ramp, with no near-duplicates. On the boilerplate templates display stays around 40 pt or below.
- [ ] Uppercase labels get positive tracking. Headings set at 1.1-1.2 line height, body at 1.3-1.7 (Korean body at the looser end).
- [ ] No heading ends on a single orphaned word (break by hand; `text-wrap` is lost in export). Numeric columns align right.

### Hierarchy and layout
- [ ] Blurred, the slide still shows its one primary element and its groups.
- [ ] One primary element per slide, at least twice the weight of the next level; four items per group at most; similar density from slide to slide.
- [ ] Spacing comes from one 4 pt scale (4/8/12/16/24/32/48), varied for rhythm, with one alignment axis per region.
- [ ] Each rule, divider and box carries information; remove the ones that do not before export.

### Objective evidence checks

- [ ] No explicit run is below the absolute 6pt floor. Primary reading text remains ≥12pt; captions/sources may use 6–10.5pt.
- [ ] No colored vertical side-stripe is attached to a card. A full-width structural rule is not a side stripe.
- [ ] A picture or table is not materially covered by a later text/image/table object.
- [ ] A picture declared as `figure`, `evidence`, or `source capture` has a visible adjacent numbered caption and `Source:`/`출처:`.
- [ ] Every appendix DOI, canonical-link, or raw-URL field contains an actual external OOXML hyperlink relationship; detection does not depend on a special “link available” phrase.
- [ ] Thumbnail review still judges hierarchy, whitespace, chart intuitiveness, executive tone, and whether caption/source/interpretation read as one group.
