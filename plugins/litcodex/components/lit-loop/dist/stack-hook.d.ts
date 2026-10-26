import { type StackFrame } from "./workflow-stack.js";
/** The frame a `lit continue` returns to, read before the prompt is routed; null when nothing is paused. */
export declare function frameToResume(cwd: string, sessionId: string): StackFrame | null;
/** Apply one matched prompt to the stack: `lit continue` closes the side frames, any other route starts. */
export declare function applyPromptToStack(cwd: string, sessionId: string, prompt: string, route: {
    readonly continued: boolean;
    readonly mode: string | null;
}, now?: Date): void;
