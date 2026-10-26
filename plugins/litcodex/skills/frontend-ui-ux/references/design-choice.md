# Choose the design first

For a new page or screen the user picks the look and has the right to choose. Before `design-lock.mjs` runs or any markup is written, ask up to three questions and pass the answers to `init` as `--style`, `--family` and `--density`:

1. `Style` ("Which house style?"): the style the brief's register points to as `<style> (Recommended)` (`field-notes` for a read-once page, `graphite` for a screen worked in), then up to three of `meadow` (warm, consumer), `computational-brutalism` (instrument, terminal), `neo-brutalism` (loud, outlined), `graphite` or `field-notes`, picked by their `use_when` lines in `references/house-styles.md`.
2. `Family` ("What is being built?"): `landing`, `workspace` or `settings`, the one the brief implies first with `(Recommended)`.
3. `Density` ("How full should it be?"): `Rich (Recommended)` (the lock default: section rhythm, texture, second accent, bands) or `Calm` (broad flat page, one accent).

## How to ask

Ask with `request_user_input` when this turn offers it (Plan mode): 2–4 options per question, the recommended one first and labelled `(Recommended)`, a one-line description each; the tool takes a free-text answer on its own, so no Other option is written.

When it is not offered (Default mode), put the same questions in the reply as a short numbered list with the recommended option first as `1. … (Recommended)`, and end the turn to wait for the pick; build nothing before it arrives.

In a non-interactive `codex exec` run nobody can answer: take the recommended option, say so in one line ("Non-interactive run: building with graphite, the recommended option") and continue.

## When to skip

Skip a question only when the prompt already names its answer (a style keyword, a family, an existing brand or token file, a brownfield or redesign lane that keeps the product's identity) or hands the choice over ("you choose", "just make it good", "알아서", "네가 골라"), or under a bare `lit`, which asks no questions; then apply the family defaults and say which style was used. A typed style id from `design-lock.mjs list` or brand tokens go to `--style` or `--from`. Review, plan and keyword-only requests stay read-only and ask nothing.
