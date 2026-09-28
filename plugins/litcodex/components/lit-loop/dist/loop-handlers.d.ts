import { type resolveLoopScope } from "./state-store.js";
export type LoopClock = () => string;
export type Ctx = {
    repoRoot: string;
    scope: ReturnType<typeof resolveLoopScope>;
    now: LoopClock;
};
export interface HandlerResult {
    readonly exitCode: number;
    readonly text: string;
    readonly json: Record<string, unknown>;
}
export declare function hasFlag(argv: readonly string[], flag: string): boolean;
export declare function handleCreate(argv: readonly string[], ctx: Ctx): Promise<HandlerResult>;
export declare function handleStatus(ctx: Ctx): Promise<HandlerResult>;
export declare function handleRun(argv: readonly string[], ctx: Ctx): Promise<HandlerResult>;
export declare function handleCheckpoint(argv: readonly string[], ctx: Ctx): Promise<HandlerResult>;
export declare function handleRecordEvidence(argv: readonly string[], ctx: Ctx): Promise<HandlerResult>;
