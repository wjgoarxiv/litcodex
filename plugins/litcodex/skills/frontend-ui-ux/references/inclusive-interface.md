# Inclusive Interface and Localization

Accessibility belongs in structure, content, behavior, and verification; an overlay cannot supply it later.

## Structure and interaction

Use native elements with matching behavior; add ARIA only where native semantics are insufficient, then inspect the accessibility tree. Make every operation possible without precise pointer control. Preserve logical order, visible focus, bypass paths for repeated content, and freedom from keyboard traps.

Check contrast in actual states, support zoom and text resizing, and never use color, position, motion, sound, or an icon alone to convey status. Explain consequences before irreversible actions, chunk long tasks, show progress, preserve entries, and provide recovery in concrete language.

Use headings that summarize their section, links that make sense out of context, and instructions independent of visual position. Give images contextual alternative text; keep decoration silent. Captions and transcripts must match media. Errors explain both what happened and how to recover; placeholders are not labels.

## Localization and CJK input

Externalize interface text. Handle expansion, plural rules, date/number/currency formats, varied names and addresses, right-to-left direction, locale sorting, and mirrored directional icons. Do not concatenate grammatical fragments.

Test CJK font coverage and fallbacks, punctuation and mixed-script line breaks, identifier wrapping, vertical clipping, full-width characters, long unspaced text, and ruby where used. Defer validation and search until IME composition ends; compare normalized input where appropriate. Do not assume a Latin-first stack has suitable CJK rhythm.

Respect reduced motion, color scheme, contrast, forced colors, system text size, and input method. If preferences are stored, provide a reset and never use them to hide critical content.

## Verification

Combine semantic automation with keyboard task completion, accessibility-tree inspection, critical screen-reader flows, 200% zoom/reflow, forced colors, reduced motion, localized content, IME, and error recovery. Record browser, assistive technology, platform, route, state, and source hash. Severity follows task impact, even when a barrier affects a smaller group.
