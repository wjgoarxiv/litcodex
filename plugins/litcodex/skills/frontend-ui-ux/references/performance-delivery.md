# Performance and Delivery

Optimize responsiveness and stability without sacrificing useful content or access.

## Budget and diagnosis

Set product-specific budgets for largest-content render, layout shift, interaction latency, initial JS/CSS, media, fonts, and observable route latency. Treat them as decision limits, not guaranteed scores across devices.

Inspect navigation, network, server timing, main-thread work, rendering, layout shifts, and interaction traces. Locate the constraint before changing code. Common causes include blocking fonts/styles, oversized media, unnecessary hydration, duplicate dependencies, long tasks, broad rerenders, layout thrashing, missing dimensions, expensive effects, third-party scripts, and oversized lists.

## Delivery choices

Use responsive image sizes and suitable formats, set dimensions, lazy-load below the critical region, and reserve stable aspect ratios. Subset or preload fonts only when evidence supports it. Ship JavaScript only for real interactions; split by route when startup improves without request fragmentation. Defer optional widgets safely. Avoid large abstractions for small costs.

For React, inspect state ownership, unstable props, context width, derived-state effects, list identity, repeated calculations, static trees wrapped in client components, and sequential fetches before memoizing. Use profiler evidence; memoization adds work and complexity.

Paginate or virtualize only when collection size and interaction justify it. Preserve keyboard access, focus, counts, search, print/export, and stable row identity; avoid rendering hidden panels needlessly.

Communicate progress honestly. Skeletons should match stable structure. Optimistic updates need safe rollback. Keep useful stale content during refresh and identify its freshness.

## Audit

Use a production-like build and record environment, route, state, throttling, and source hash. Repeat runs and report the spread. Inspect traces, make one attributable correction, rerun the same scenario, and check accessibility and task completion. Keep laboratory measures distinct from user evidence. A synthetic score does not justify removing needed capability.
