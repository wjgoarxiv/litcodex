export declare const NORMAL_QUERY_BUDGET_BYTES = 2048;
export declare const HARD_QUERY_BUDGET_BYTES = 4096;
export declare const AUTO_CAPTURE_EVIDENCE_REF = "lit-loop/create_goal";
declare const KINDS: readonly ["fact", "decision", "failure", "risk", "rule", "checkpoint"];
declare const STATES: readonly ["review-needed", "accepted", "rejected", "stale"];
declare const SOURCES: readonly ["wikify", "lit-loop", "start-work", "review-work"];
type KnowledgeKind = (typeof KINDS)[number];
type KnowledgeState = (typeof STATES)[number];
type KnowledgeSource = (typeof SOURCES)[number];
export interface KnowledgeRecord {
    schemaVersion: 1;
    id: string;
    kind: KnowledgeKind;
    state: KnowledgeState;
    text: string;
    timestamp: string;
    provenance: {
        product: "litcodex";
        source: KnowledgeSource;
    };
    evidenceRef: string;
}
interface KnowledgeOptions {
    root: string;
    now?: () => string;
    env?: Record<string, string | undefined>;
}
export type CaptureResult = {
    outcome: "captured";
    id: string;
    state: "review-needed";
} | {
    outcome: "duplicate";
    id: string;
    state: KnowledgeState;
} | {
    outcome: "disabled";
} | {
    outcome: "rejected";
    reason: string;
};
export type ReviewResult = {
    outcome: "updated";
    id: string;
    state: Exclude<KnowledgeState, "review-needed">;
} | {
    outcome: "unchanged";
    id: string;
    state: Exclude<KnowledgeState, "review-needed">;
} | {
    outcome: "not-found";
    id: string;
};
export interface QueryResult {
    context: string;
    records: KnowledgeRecord[];
}
export declare function captureKnowledgeEvent(input: unknown, options: KnowledgeOptions): CaptureResult;
export declare function reviewKnowledgeRecord(id: string, state: Exclude<KnowledgeState, "review-needed">, options: KnowledgeOptions): ReviewResult;
export declare function queryKnowledge(prompt: string, options: {
    root: string;
    budgetBytes?: number;
}): QueryResult;
export declare function runUserPromptSubmitHook(input: unknown, options?: {
    root?: string;
    budgetBytes?: number;
}): string;
export declare function runPostToolUseHook(input: unknown, options?: {
    root?: string;
    env?: Record<string, string | undefined>;
}): string;
export {};
