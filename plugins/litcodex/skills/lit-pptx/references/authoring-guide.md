# Authoring Guide (Markdown → PPTX)

How to author a deck in the constrained Markdown dialect that `scripts/compile-deck.js` compiles. Template-agnostic — the enrolled template owns fonts, palette, dimensions, and decorations. The full contract is `specs/markdown-slide-spec-v1.md`; this guide is the working reference.

## 1. Pick a template (and font)
```bash
node "$OFFICE" pptx compile --list-templates
node "$OFFICE" pptx compile --list-layouts <TEMPLATE>   # blocks + regions per layout
```
Bundled templates:
| Template | Canvas | Font | Use |
|----------|--------|------|-----|
| `BOILERPLATE-PRETENDARD` | 4:3 (10×7.5in) | Pretendard | General professional/technical decks |
| `BOILERPLATE-A2Z` | 4:3 (10×7.5in) | 에이투지체 (A2Z) | Same layout, A2Z typography |
| `AZURE-PRO` (bare `lit` default) | 16:9 (13.333×7.5in) | Pretendard | General report and results decks |
| `AZURE-A2Z` | 16:9 (13.333×7.5in) | 에이투지체 | Same layout with A2Z typography |
| *(learned)* | from source | from source | `node "$OFFICE" pptx learn <your.pptx> --name <NAME>` to enroll your own brand |

Font note: **Pretendard** is one weighted family (bold via weight). **에이투지체** ships one family *per weight* (`에이투지체 7 Bold`) — weight is chosen by family name, never a bold flag. The template encodes this; you just write content.

## 2. Deck skeleton
```markdown
---
template: BOILERPLATE-PRETENDARD
title: Deck Title
date: 2026-06-29
---

---
layout: cover

# Deck Title
---

---
layout: content

## Section title

- **Bold section header**
  (1) sub-item with a concrete detail
  (2) another sub-item
- **Second header**
---

---
layout: closing

# 감사합니다
---
```
**Separator rule (critical):** a `---` line, then a blank line, then `---` + the next `layout:`. This is how slides are split — see the spec.

## 3. Layouts (the 5 approved)
- `cover` — title + metadata + date
- `content` — title + body (bullets/numbered/sections), optional table + image + captions
- `main` — content + an optional bordered `main-box` callout
- `summary` — two grouped blocks (top/bottom) + optional image/table
- `closing` — single centered title

Each layout supports a fixed set of blocks per template — check `--list-layouts`. Tables use standard Markdown pipes; images use `![alt](path)`; captions follow the spec.

### Executive/research compositions

These are semantic compositions of existing v1 blocks, so they remain renderer compatible:

1. **figure plus interpretation**

   ```markdown
   ![Figure 1. Pressure trend | Source: test report, p. 12](assets/pressure.png)

   - **Observation** Pressure remained inside the validated band.
     (1) Limitation: one operating condition was not sampled.
     (2) Implication: repeat the test before scale-up.
   ```

2. **table plus decision takeaway** — keep units in headers, quantitative cells compact, ≤6 columns, and add a blockquote caption/source immediately after the table.
3. **source capture** — use a legible screenshot with locator/date in the alt text and state its limitation and relevance in the body.
4. **two-record appendix evidence** — show at most two records per slide; include a one-line summary, source locator, and clickable DOI/canonical link when available. In a table cell, write `[원문](https://example.org/record)`; the PPTX renderer emits an external OOXML hyperlink relationship.

Do not write authoring trace or unresolved placeholders. Treat overclaim, jargon, imperative tone, unsupported schedules, hierarchy, and visual density as review-only items to resolve during thumbnail review.

## 4. Compile
```bash
node "$OFFICE" pptx compile deck.md --template <TEMPLATE> --html out.html      # preview
node "$OFFICE" pptx compile deck.md --template <TEMPLATE> --pptx out.pptx --embed-fonts
```
`--embed-fonts` makes the deck self-contained (renders on machines without the font). `--ast out.json` dumps the intermediate AST.

## 5. Verify (always)
```bash
node "$OFFICE" pptx qa out.pptx        # overflow/overlap + WCAG contrast + anti-slop; non-zero = FAIL
soffice -env:UserInstallation=file:///tmp/lit-pptx-preview --headless --convert-to pdf --outdir previews out.pptx
pdftoppm -png -r 120 previews/out.pdf previews/slide   # inspect each image
```
A clean gate is defect-absence, not quality — read the thumbnails. See `references/anti-slop-checklist.md`.

## 6. Anti-patterns (fix before shipping)
- Generic titles ("개요"/"Overview") → make them specific.
- Padding bullets that restate the heading → cut or add real information.
- Manually adding logos/lines/colors/fonts → the template applies decorations; don't.
- Overloaded slides (> ~8 bullets, > ~8 table rows, > 4 items per summary group) → split.
- Placeholder/AI-slop wording → gated by `FORBIDDEN_TERMS.json`.
- Evidence image with only a filename-like alt → write a numbered caption plus `Source:`/`출처:` so the visible caption stays bound to the figure.
- Appendix DOI/canonical/raw URL field without a hyperlink → add an actual PowerPoint hyperlink. QA detects the field directly and verifies its external OOXML relationship; no special “link available” phrase is required.

## 7. Bring your own brand
```bash
node "$OFFICE" pptx learn corporate.pptx --name MY-BRAND   # extracts fonts/palette/geometry, closed-set verified
node "$OFFICE" pptx compile deck.md --template MY-BRAND --pptx out.pptx --embed-fonts
```
The learned template only references fonts/colors/assets present in your source (off-brand-by-construction).

## Placement (spec v2)

Reach for the least freedom that says the thing. Each tier gives up a guardrail, and
the one below it is harder to get right.

| Want | Write | Gives up |
|---|---|---|
| the template's geometry, a different slot | `::: region name=<region>` | nothing |
| two things beside each other | `:::: columns 2fr 1fr gap=0.3` with `::: col` inside | portability stays; you choose the split |
| something the template never anticipated | `::: box x= y= w= h=` and `::: shape <kind> …` | every guardrail — nothing reflows around it |
| a slide with no template furniture at all | `layout: free` | the template's whole contribution |
| a different look, same layout | `variant: split-navy` | nothing |

Containers nest by fence length: the outer fence is longer (`::::` holds `:::`).
`::: shape` is one line with no closing fence. Shapes sit behind content, boxes on top.

Full contract: `specs/markdown-slide-spec-v2.md`.

**A slide built with a box, a shape or `layout: free` has to be looked at** — render it,
gate it, then read the thumbnail. The gate reports defects; it does not report that a
slide reads badly.

## Charts

Never drawn here. Call `/scientific-visualization`, hand it the deck's visual system
with `compile-deck.js --template <T> --export-viz-context ctx.json`, and place the
result as a captioned figure. Register the font *file* from `ctx.json` rather than the
family name — a Korean family resolved by name alone renders as boxes.
