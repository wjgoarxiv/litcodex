# Design-System Foundations

Align tokens, primitives, themes, and governance before broad screen work.

## Audit first

Inventory styles, variables, theme providers, component packages, icons, fonts, spacing, focus, docs, and tests. Group by semantic role, not equal values. Classify items as reusable, undocumented, safe to consolidate, behavior-sensitive legacy, or missing. Do not replace a working system merely to introduce tooling.

## Tokens and components

Keep three layers:

1. **Foundation:** raw color, type, spacing, radius, shadow, duration, easing, and dimensions.
2. **Semantic roles:** canvas, surface, text, divider, action, focus, danger, caution, success, and information across themes.
3. **Component decisions:** stable local needs such as dialog width or row density.

Keep aliases acyclic, provide theme values, and pair deprecations with a replacement and removal condition. Component tokens should not become a second global palette.

For shared components specify purpose, semantics, slots, variants, size, states/transitions, keyboard/focus, responsive behavior, localization, token dependencies, performance, and test/render cases. Prefer composition to a boolean-prop maze.

Before broad screens, render type and long text; color roles in each theme; controls; panels, tables, lists, and overlays; and empty/loading/error/success/disabled/focus states. Include long CJK labels, expansion, zoom, and forced colors. Fix system problems instead of adding page patches.

## Theme and governance

Themes change semantic values, not document meaning. Check contrast, non-color focus, browser controls, charts, system color-scheme startup, and illustrations/logos on each surface. Name tokens by intent, assign system-decision ownership, and record exceptions.

Align by mapping values to roles, resolving collisions, adding aliases, migrating one component family at a time, comparing representative states, then removing dead values after search and runtime checks. Track rationale, adoption examples, access rules, version policy, and debt. Reject arbitrary values, copied APIs that do not fit, hidden styling escape hatches, feature-level theme literals, and docs disconnected from shipped primitives.
