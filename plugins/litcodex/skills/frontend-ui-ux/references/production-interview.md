# Bounded Interview, Contract, and Build

This guide adds no approval stage or fixed question count. Resolve only ambiguity that materially changes the work.

## Before asking

Read the task and minimum product files. Note the outcome, target surface, behavior, constraints, and repository state. Ask only when plausible answers change scope, architecture, permissions/data, accessibility, or visual direction. Do not ask about details already set, safely inferable, or easy to refine. Ask one concise question at a time; when the brief is clear, state an assumption and continue. Do not repeat an unanswered question or ask for routine implementation approval. Keyword, bare-target, review-only, and plan-only requests do not authorize writes.

## Direction and inventory

Keep the direction to hierarchy, visual language, key interaction, and why it fits. Inventory only acceptance surfaces: routes, regions, actions, states, responsive transforms, input, and exclusions. Include empty, validation, failure, and success states. Show alternatives only when the choice is material.

When visual direction is absent, apply the authored default profile in `references/default-editorial-pixel.json`. Its original crisp pixel illustration is the primary visual anchor: draw aligned square cells (or use true pixel art), render cells at least 6 CSS pixels, preserve crisp edges, and do not substitute smooth vector curves as the only featured artwork or a pixel icon/background grid alone. Echo one art color in a nearby interface detail without reducing contrast. Recompose at 320px, 390px, and 1440px; the full subject stays visible and recognizable without horizontal overflow. An explicit user direction can replace this profile.

## Contract with implementation

Settle direction and finite inventory, then create or evolve `design-contract.json` with `schema_id: "litfamily.design-contract/v1beta2"` alongside authorized implementation. Validate it before acceptance, not as a gate that stalls a sufficiently specified build. Use actual repository identifiers and evidence, not schema examples. Include source state, scope, inventory, tokens, responsive and keyboard behavior, reduced motion, access/performance budgets, acceptance checks, omissions, and accepted exceptions. Keep earlier contracts intact. Validate with `scripts/validate-design-contract.mjs --input design-contract.json`.

If new information changes a decision, update affected contract fields and preserve the prior rationale in the task receipt. Fix validation errors without lowering the schema or deleting requirements.

## Build and inspect

Implement declared routes and states. Render the app at compact, mobile, and desktop widths; test focus, errors, empty states, and relevant reduced-motion behavior. Record renderer, viewport, capture time, and artifact path. Source code, schema success, and generated mockups do not prove a rendered result. If safe rendering or capture is unavailable, keep the work and name the blocked review boundary.
