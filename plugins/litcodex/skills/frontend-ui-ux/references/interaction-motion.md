# Interaction and Motion

Specify what the interface communicates before, during, and after a user's action.

## States and feedback

For each critical interaction include available, hover where relevant, focus, pressed, pending, success, recoverable and terminal failure, disabled reason, denied permission, offline/stale, empty, and first-use states when reachable. Prevent duplicate submission while making its status clear.

Match feedback to consequence: inline validation near a field, persistent status for background work, a toast for noncritical confirmation, a dialog only when interruption is justified, and progress that is honest about unknown duration. Name the recovery action. Do not claim success before the result is durable.

Use native controls where possible. Specify labels, requirements, examples, autocomplete purpose, validation timing, and recovery. Preserve IME composition and cursor position. Composite widgets need their complete keyboard model; ARIA alone does not provide it.

## Focus and direct manipulation

Move focus into a newly opened overlay and return it to the invoker when possible. On route changes, announce context and place focus deliberately. Link validation to the error without losing input. Do not focus hidden/disabled controls or steal focus on insertion. Keep focus visible in every theme and forced colors.

For gestures specify target, threshold, cancellation, bounds, feedback, undo, and a non-gesture path. Provide a keyboard alternative to dragging. Match destructive-action protection to its harm.

## Motion

Animate to explain continuity, hierarchy, causality, state, or space. For each animation name what changes, why motion helps, and the reduced-motion behavior. Let one focal event lead; stagger only when order carries meaning. Avoid independent entrances for every element and never delay time-critical actions on exit.

Honor `prefers-reduced-motion` and platform equivalents. Remove parallax, autoplay, large travel, and flashing when appropriate while preserving concise state feedback. Prefer transform and opacity where suitable; test low frame rates and long content. See `motion-guide.md` for easing, triggers, and budgets.

## Interaction record

For each critical path record trigger, preconditions, state transition, visible feedback, focus and announcement, recovery, in-scope analytics, and its test scenario. Keep animations interruptible and ensure they settle into a valid state.
