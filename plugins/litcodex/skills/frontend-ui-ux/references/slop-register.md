# Slop register

Read this with the craft floor in every frontend mode. The register identifies recurring generic or fabricated patterns after the page has been measured. A deterministic signal can start a finding; a JUDG row requires a person or reviewing agent to decide whether the pattern has a purpose. Report actual values and the rule id, then fix the specific component. Do not call an entire page generic as a substitute for checking individual rows. Authored-copy scans read the top-level document only; they never descend into an embed's `contentDocument`. Shared numeric settings live in `scripts/rule-data.mjs`. Only SLOP-057, SLOP-058 and SLOP-059 can produce a SLOP HIGH.

## Repeated layout and spacing

| Id | Signal, gate, and repair |
| --- | --- |
| SLOP-001 | Three consecutive sections repeat the same image/text side split. Change the composition where the content hierarchy differs. MEDIUM, DET. |
| SLOP-002 | A grid with ≥4 identical icon/image + heading + text tiles is a candidate; skip semantic `ul`, `ol`, and table grids. Use content-specific treatment. MEDIUM, DET. |
| SLOP-003 | Three nested card shells, or a bento cell count unrelated to content items, suggest decorative containment. Remove a shell or align cells to information. MEDIUM, DET. |
| SLOP-004 | A split header's second column holds fewer than 15 words and no distinct role. Read intent before collapsing it. MEDIUM, JUDG with a count. |
| SLOP-005 | One structural section signature recurs at least three times. Vary the section only where the information changes. MEDIUM, DET. |
| SLOP-006 | Across ≥5 regions and ≥10 gaps, one 4px-bucket holds >85% of spacing. Introduce a real grouping hierarchy. MEDIUM, DET. |
| SLOP-007 | A large empty gap may be useless; ask what it separates. Keep purposeful whitespace. LOW, JUDG. |

## Decoration, type, and color

| Id | Signal, gate, and repair |
| --- | --- |
| SLOP-008 | A heading or gradient stop in HSL 260°–310° with ≥50/255 RGB channel spread can be a reflex violet accent. Exempt a documented brand hue. MEDIUM, DET assist. |
| SLOP-009 | Gradient fill and text clipping on one headline make decorative gradient type. Use a solid accessible ink color. MEDIUM, DET. |
| SLOP-010 | A wide chromatic glow recurs on primary actions/headings outside focus. Remove the repeated halo. MEDIUM when recurring, DET. |
| SLOP-011 | An unanchored translucent radial blob has no information role. Check its purpose, then delete or integrate it. MEDIUM, JUDG. |
| SLOP-012 | A repeated dot/grid ground with no adjacent data and another slop cue is decoration by reflex. Remove it or make its data referent explicit. MEDIUM, DET assist. |
| SLOP-013 | Hide a noise texture in review; if hierarchy improves, remove the texture. LOW, JUDG. |
| SLOP-014 | Glass blur needs a surface reason and a transparency fallback. Use an opaque surface when neither exists. LOW, JUDG. |
| SLOP-015 | A single-side accent, inset strip, or geometric pseudo-element tab recurs on rounded cards. Delete decorative stripes; preserve alert/status and real nav tabs. MEDIUM, DET. |
| SLOP-016 | Match only the first loaded family against the fixed overused-font list. This is a candidate for a human type-rationale review, not a bare-font verdict. MEDIUM, DET assist + JUDG. |
| SLOP-017 | A shortlisted display serif without a stated content reason is a candidate for correction, not a universal ban. MEDIUM, JUDG. |
| SLOP-018 | A ≥3.5× headline/subhead size ratio with subhead <14px may bury meaning. Check content importance, then rebalance. MEDIUM, JUDG. |
| SLOP-019 | More than three prose/display families (icon faces excluded) fragments the page. Reduce unnecessary moods. MEDIUM, DET. |
| SLOP-020 | More than ~40 characters of uppercased leaf text damages reading; exempt CJK and intentional short labels. Rewrite casing. LOW, DET. |
| SLOP-021 | Mid-gray (40–70% lightness, <10% saturation) on a chromatic ground can wash out. Recheck CF-201 and set a deliberate ink color. MEDIUM, DET. |
| SLOP-022 | Multiple accent families on filled areas ≥24×24px compete. Exclude status badges, then resolve via CF-205. MEDIUM, DET assist. |
| SLOP-023 | Exact black/white as a primary base may flatten the theme; exempt an intentionally declared dark palette. LOW, DET assist. |

## Motion and surface behavior

| Id | Signal, gate, and repair |
| --- | --- |
| SLOP-024 | Routine feedback uses bounce/spring easing. Route to CF-505; reserve expressive motion for a reasoned celebration. MEDIUM, DET/JUDG. |
| SLOP-025 | A section or card enters at near-zero scale. Route to CF-503; start close to final size. MEDIUM, DET. |
| SLOP-026 | Continuous motion animates a layout property outside a disclosure exception. Route to CF-508; use transform/opacity. MEDIUM, DET. |
| SLOP-027 | A pulse or blink loops forever without a bound status. Remove it or tie it to a real state. LOW, DET. |
| SLOP-028 | High-frequency hover/focus motion exceeds ~150ms. Route to CF-506 and shorten it. LOW, DET. |

## Labels, copy, and invented detail

| Id | Signal, gate, and repair |
| --- | --- |
| SLOP-029 | A tracked eyebrow precedes more than one third of visible section headings. Keep only labels that distinguish content. MEDIUM, DET. |
| SLOP-030 | Multiple zero-padded section numbers with no real ordering are decorative. Review the sequence, then remove the numbering. MEDIUM, JUDG after regex. |
| SLOP-031 | A version/beta/build stamp without a release context looks fabricated. Check provenance, then remove or explain it. MEDIUM, JUDG. |
| SLOP-032 | A color dot beside a label with no bound state is ornamental. Bind it to status or remove it. LOW, DET. |
| SLOP-033 | Three or more middle dots on one line, or repeated locale/weather tokens, form a decorative strip. Shorten to real metadata. LOW, DET. |
| SLOP-034 | An all-caps token strip at the bottom of a hero, without navigation or status meaning, needs review. Remove it if it only fills space. MEDIUM, DET assist. |
| SLOP-035 | A scroll cue that merely announces ordinary page scrolling can be removed. LOW, DET. |
| SLOP-036 | Match one of the 29 specified stock phrase entries in authored copy. Replace it with specific product facts. MEDIUM, DET. |
| SLOP-037 | A known filler brand wordmark in authored copy needs authorized identity or generic labeling. MEDIUM, DET assist + JUDG. |
| SLOP-038 | A stock person name in attributed content is a candidate; use a real approved name or a clear example. MEDIUM, DET. |
| SLOP-039 | Three repeated negate-then-restate sentence pairs make an aphoristic tic. State the facts directly. LOW, DET. |
| SLOP-040 | Review an em dash U+2014 or spaced en dash U+2013 in authored body copy, excluding numeric/date ranges, code, titles, form values, and CJK punctuation. MEDIUM, DET assist. |
| SLOP-041 | A precise claim without source/mock labeling requires provenance review. Cite it or make its example status explicit. MEDIUM, JUDG with a numeric scan. |
| SLOP-042 | One CTA intent with different labels on the same page creates ambiguity. Choose one accurate verb phrase. LOW, DET assist. |

## Fake product and visual content

| Id | Signal, gate, and repair |
| --- | --- |
| SLOP-043 | Div-built dashboard/window chrome is only a structural candidate; a reviewer decides whether it masquerades as real product media. MEDIUM after confirmation, DET assist + JUDG. |
| SLOP-044 | A build or sync stamp inside a preview/footer without real docs is suspect. Remove invented provenance. MEDIUM, JUDG. |
| SLOP-045 | ≥4 same-shape KPI siblings, or ≥3 beside a marketing CTA, need review for truthfulness. MEDIUM after confirmation, DET assist + JUDG. |
| SLOP-046 | A gauge/ring/bar/sparkline with no visible value, axis/legend, or accessible name is a candidate for review. MEDIUM after confirmation, DET assist + JUDG. |
| SLOP-047 | At 1440px, an animated ticker of ≤6 logos with median mark height <20px is hard to read. Make a static, legible logo list. MEDIUM, DET. |
| SLOP-048 | Autoplay carousel dots without controls or keyboard binding are inert decoration. Add functional controls or remove them. LOW, DET. |
| SLOP-049 | A stock silhouette avatar used as a person placeholder needs a more honest state treatment. LOW, DET. |
| SLOP-050 | Repeated category captions under every trust logo can be removed when the marks identify themselves. LOW, DET. |
| SLOP-051 | An SVG of ≥200×200px, ≥8 simple primitives, ≥3 fills, ≤2 text nodes and no pattern needs visual review before simplification. MEDIUM, DET assist + JUDG. |
| SLOP-052 | A clip polygon with ≥10 vertices and at least half its coordinates off the 25% grid, or `path()` with ≥3 curves, needs review. LOW, DET assist + JUDG. |
| SLOP-053 | Emoji standing in for a coherent icon system is a candidate. Respect an explicit emoji policy. LOW, JUDG after detection. |
| SLOP-054 | An image node itself scales on hover. Move the effect to its frame if the interaction remains useful. LOW, DET. |
| SLOP-055 | Two or more different tells on one component merit a combined MEDIUM review; below that, a LOW note. Fix the actual contributing rows. JUDG. |
| SLOP-056 | After individual checks, ask whether the whole interface could be relabeled as any competitor. Name the contributing evidence; this alone is LOW. JUDG. |

## Functional extension

| Id | Signal, gate, and repair |
| --- | --- |
| SLOP-057 | Empty/hash/undefined image source or a complete image with failed decode is HIGH. An unfetched lazy image is `not_verified`; account for `srcset`. DET. |
| SLOP-058 | Hash-only or JavaScript-scheme link is HIGH in navigation/primary content, MEDIUM when decorative. Give it a real destination or a button. DET. |
| SLOP-059 | An implicit-submit button is HIGH only when its owner form (including `form="id"`) has ≥2 submit-capable buttons. State each button's intent. DET/JUDG. |
| SLOP-060 | Lorem or bracketed placeholder/TODO in visible copy is LOW. Replace with task-specific content. DET. |
| SLOP-061 | A marquee or unpausable text ticker is LOW. Prefer a static row or a real pause control. DET. |
| SLOP-062 | A routine-information modal that interrupts the task without need should become an inline panel or disclosure. LOW, JUDG. |
| SLOP-063 | Monospace used for ordinary prose merely to look technical should use normal body type. LOW, JUDG. |

Static slides, documents, and diagrams reuse only the applicable composition, text, color, and icon judgments. Browser interaction, hover, scroll, and autoplay findings do not transfer to a static page. Office-specific numeric checks live in their own QA tools and use OF ids.
