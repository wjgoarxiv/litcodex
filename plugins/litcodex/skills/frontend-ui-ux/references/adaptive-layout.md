# Adaptive Layout

Responsive design keeps the task usable as space, input, content, and preferences change. It is not a row of smaller desktop screenshots.

## Inputs and breakpoints

Check viewport and container size, orientation, safe areas, pointer precision, zoom, text size, language expansion, writing direction, virtual keyboards, IME, connectivity, and reduced motion. Do not infer touch from width.

Start with intrinsic layout. Resize until navigation collides, text becomes hard to read, controls wrap ambiguously, or data loses comparison; place a breakpoint there. Use container queries for reusable components and media queries for global conditions.

## Choose each region's transformation

Record whether it reflows, wraps, stacks, resizes, crops around a protected focal point, scrolls, collapses, changes control, moves secondary detail behind drill-down, or preserves position. Keep primary actions visible or predictably reachable. Do not hide validation, status, or recovery to simplify a narrow view.

Use fluid type and spacing only within tested limits. Keep body text readable as headings compress. Preserve visible keyboard focus; hover cannot be the only route to content. Give drag actions a keyboard or direct alternative, and avoid gestures that conflict with browser navigation.

For native and hybrid surfaces, follow safe-area, system text, back, focus, input-method, and platform control conventions. Shared tokens do not require identical interaction.

## Verify

Cover the smallest and largest supported views, each meaningful breakpoint boundary, supported orientations, 200% zoom or large system text, keyboard, coarse pointer, long localized and CJK content, virtual-keyboard overlap, reduced motion, and supported themes. Use real content and complete the primary task at each critical size.

Reject fixed heights around variable text, mobile viewport-height traps, clipped overflow, tiny icon-only controls, destructive truncation, unlabeled table-to-card conversions, and breakpoint patches for an unstable foundation.
