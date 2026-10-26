/** True for the whole prompt being a go word; `go ahead and fix it` is an ordinary request. */
export declare function isGoPrompt(prompt: string): boolean;
export type GoDecision = {
    readonly kind: "run";
    readonly prompt: string;
    readonly note: string;
} | {
    readonly kind: "hint";
    readonly text: string;
};
/**
 * What a go-word prompt means in this session. Null when the session has no note (the prompt is then an
 * ordinary one); a hint when a note existed but cannot run; otherwise the prompt to route in its place.
 */
export declare function takeGo(cwd: string, sessionId: string, now: number): GoDecision | null;
/**
 * True for the whole prompt `lit approve`, `lit deny`, `lit 승인` or `lit 거절`. The start-work lifecycle hook
 * owns these words; this hook stays silent for them so a bare `lit` never starts a loop on top of an answer.
 */
export declare function isBoundaryAnswer(prompt: string): boolean;
