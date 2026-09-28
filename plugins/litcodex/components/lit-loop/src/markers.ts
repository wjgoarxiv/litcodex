// Single source of the lit-family directive markers (A3 C1).
// Zero-dependency on purpose: guards.ts, directive.ts, and modes.ts import (and
// re-export) from here so the dedupe markers can never drift between them
// while preserving the no-cycle invariant (guards never imports directive).
export const LIT_LOOP_DIRECTIVE_MARKER = "<lit-loop-mode>" as const;
export const LIT_LOOP_DIRECTIVE_CLOSE = "</lit-loop-mode>" as const;

// lit-family modes (multi-mode hook router): each mode owns its open/close marker pair so the
// per-mode idempotency guard (RC1) scans the transcript for the MATCHED mode's marker only.
export const LITWORK_DIRECTIVE_MARKER = "<litwork-mode>" as const;
export const LITWORK_DIRECTIVE_CLOSE = "</litwork-mode>" as const;
export const LIT_PLAN_DIRECTIVE_MARKER = "<lit-plan-mode>" as const;
export const LIT_PLAN_DIRECTIVE_CLOSE = "</lit-plan-mode>" as const;
export const LITGOAL_DIRECTIVE_MARKER = "<litgoal-mode>" as const;
export const LITGOAL_DIRECTIVE_CLOSE = "</litgoal-mode>" as const;
export const REVIEW_WORK_DIRECTIVE_MARKER = "<review-work-mode>" as const;
export const REVIEW_WORK_DIRECTIVE_CLOSE = "</review-work-mode>" as const;
export const LITRESEARCH_DIRECTIVE_MARKER = "<litresearch-mode>" as const;
export const LITRESEARCH_DIRECTIVE_CLOSE = "</litresearch-mode>" as const;
export const START_WORK_DIRECTIVE_MARKER = "<start-work-mode>" as const;
export const START_WORK_DIRECTIVE_CLOSE = "</start-work-mode>" as const;
export const LIT_RECAP_DIRECTIVE_MARKER = "<lit-recap-mode>" as const;
export const LIT_RECAP_DIRECTIVE_CLOSE = "</lit-recap-mode>" as const;
export const LIT_CRUCIBLE_DIRECTIVE_MARKER = "<lit-crucible-mode>" as const;
export const LIT_CRUCIBLE_DIRECTIVE_CLOSE = "</lit-crucible-mode>" as const;
export const LIT_INIT_DIRECTIVE_MARKER = "<lit-init-mode>" as const;
export const LIT_INIT_DIRECTIVE_CLOSE = "</lit-init-mode>" as const;
export const DEEP_INTERVIEW_DIRECTIVE_MARKER = "<deep-interview-mode>" as const;
export const DEEP_INTERVIEW_DIRECTIVE_CLOSE = "</deep-interview-mode>" as const;
export const HANDOFF_DIRECTIVE_MARKER = "<lit-handoff-mode>" as const;
export const HANDOFF_DIRECTIVE_CLOSE = "</lit-handoff-mode>" as const;
export const SCIENTIFIC_VISUALIZATION_DIRECTIVE_MARKER = "<lit-scientific-visualization-mode>" as const;
export const SCIENTIFIC_VISUALIZATION_DIRECTIVE_CLOSE = "</lit-scientific-visualization-mode>" as const;
export const BROWSER_DRIVE_DIRECTIVE_MARKER = "<browser-drive-mode>" as const;
export const BROWSER_DRIVE_DIRECTIVE_CLOSE = "</browser-drive-mode>" as const;
export const LIT_COMPREHEND_DIRECTIVE_MARKER = "<lit-comprehend-mode>" as const;
export const LIT_COMPREHEND_DIRECTIVE_CLOSE = "</lit-comprehend-mode>" as const;

export type LitLoopDirectiveMarker = typeof LIT_LOOP_DIRECTIVE_MARKER;
