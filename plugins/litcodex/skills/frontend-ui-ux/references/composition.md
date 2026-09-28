# Composition and Page Families

Composition turns task priority into spatial relationships. Establish it before polishing components.

## Structure

Map landmarks, the primary task, supporting context, secondary actions, and persistent navigation. Keep DOM, keyboard, and screen-reader order meaningful. Set a content measure, responsive gutters, columns, alignment anchors, and deliberate full-bleed areas. Use grid for two-dimensional alignment, flex for one axis, and logical properties for direction. Keep ordinary content in flow.

Derive spacing from grouping and separation. A scale supports consistency; it does not decide hierarchy. Offer compact density only when needed, without shrinking type or targets.

## Page patterns

- **Marketing or narrative:** make a concrete promise, explain why it matters, address objections, and place actions where decisions happen. Avoid interchangeable hero, logo, card, and testimonial stacks.
- **Application shell:** protect task space; keep navigation, status, and frequent actions reachable. Decide which panels persist, collapse, or move on small screens.
- **Dashboard:** organize signals around decisions. Show freshness and comparison; prioritize actionable exceptions over decorative charts.
- **Form or workflow:** group by user intent, explain requirements before submission, preserve entries, and focus the error summary or first invalid field.
- **Dense table or inspector:** retain row identity and column meaning. Scroll deliberately or transform records into labeled groups; keep critical values comparable.
- **Documentation:** optimize measure, headings, anchors, code overflow, tables, and reading progress. Persistent navigation must leave room for content.

Documents usually scroll as a whole. Use nested scrolling only with a clear need, visible bounds, keyboard access, and touch testing. Whitespace should clarify hierarchy without pushing primary content out of reach.

## Review

At compact and wide contract sizes, check first attention, primary action, alignment, line length, orphaned headings, clipping, sticky regions, safe areas, zoom, and content order with styles disabled.
