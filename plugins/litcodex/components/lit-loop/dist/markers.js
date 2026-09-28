// Single source of the lit-family directive markers (A3 C1).
// Zero-dependency on purpose: guards.ts, directive.ts, and modes.ts import (and
// re-export) from here so the dedupe markers can never drift between them
// while preserving the no-cycle invariant (guards never imports directive).
export const LIT_LOOP_DIRECTIVE_MARKER = "<lit-loop-mode>";
export const LIT_LOOP_DIRECTIVE_CLOSE = "</lit-loop-mode>";
// lit-family modes (multi-mode hook router): each mode owns its open/close marker pair so the
// per-mode idempotency guard (RC1) scans the transcript for the MATCHED mode's marker only.
export const LITWORK_DIRECTIVE_MARKER = "<litwork-mode>";
export const LITWORK_DIRECTIVE_CLOSE = "</litwork-mode>";
export const LIT_PLAN_DIRECTIVE_MARKER = "<lit-plan-mode>";
export const LIT_PLAN_DIRECTIVE_CLOSE = "</lit-plan-mode>";
export const LITGOAL_DIRECTIVE_MARKER = "<litgoal-mode>";
export const LITGOAL_DIRECTIVE_CLOSE = "</litgoal-mode>";
export const REVIEW_WORK_DIRECTIVE_MARKER = "<review-work-mode>";
export const REVIEW_WORK_DIRECTIVE_CLOSE = "</review-work-mode>";
export const LITRESEARCH_DIRECTIVE_MARKER = "<litresearch-mode>";
export const LITRESEARCH_DIRECTIVE_CLOSE = "</litresearch-mode>";
export const START_WORK_DIRECTIVE_MARKER = "<start-work-mode>";
export const START_WORK_DIRECTIVE_CLOSE = "</start-work-mode>";
export const LIT_RECAP_DIRECTIVE_MARKER = "<lit-recap-mode>";
export const LIT_RECAP_DIRECTIVE_CLOSE = "</lit-recap-mode>";
export const LIT_CRUCIBLE_DIRECTIVE_MARKER = "<lit-crucible-mode>";
export const LIT_CRUCIBLE_DIRECTIVE_CLOSE = "</lit-crucible-mode>";
export const LIT_INIT_DIRECTIVE_MARKER = "<lit-init-mode>";
export const LIT_INIT_DIRECTIVE_CLOSE = "</lit-init-mode>";
export const DEEP_INTERVIEW_DIRECTIVE_MARKER = "<deep-interview-mode>";
export const DEEP_INTERVIEW_DIRECTIVE_CLOSE = "</deep-interview-mode>";
export const HANDOFF_DIRECTIVE_MARKER = "<lit-handoff-mode>";
export const HANDOFF_DIRECTIVE_CLOSE = "</lit-handoff-mode>";
export const SCIENTIFIC_VISUALIZATION_DIRECTIVE_MARKER = "<lit-scientific-visualization-mode>";
export const SCIENTIFIC_VISUALIZATION_DIRECTIVE_CLOSE = "</lit-scientific-visualization-mode>";
export const BROWSER_DRIVE_DIRECTIVE_MARKER = "<browser-drive-mode>";
export const BROWSER_DRIVE_DIRECTIVE_CLOSE = "</browser-drive-mode>";
export const LIT_COMPREHEND_DIRECTIVE_MARKER = "<lit-comprehend-mode>";
export const LIT_COMPREHEND_DIRECTIVE_CLOSE = "</lit-comprehend-mode>";
