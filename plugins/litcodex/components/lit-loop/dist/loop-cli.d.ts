export { exitCodeForLoop, LitLoopError, type LoopErrorCode } from "./loop-errors.js";
export type { LoopClock } from "./loop-handlers.js";
export { LOOP_CREATE_STDOUT } from "./loop-stdout.js";
/** The 7 MVP subcommands, help-order, including `help` (A3 D2). M09 is the single source. */
export declare const LOOP_SUBCOMMANDS: readonly ["help", "create", "status", "run", "checkpoint", "record-evidence", "doctor"];
export type LoopSubcommand = (typeof LOOP_SUBCOMMANDS)[number];
export declare function isLoopSubcommand(value: string): value is LoopSubcommand;
export interface LoopIo {
    readonly stdout: NodeJS.WritableStream;
    readonly stderr: NodeJS.WritableStream;
    readonly stdin: NodeJS.ReadableStream;
    /** Test seam: override the repo root (default process.cwd()) without process.chdir. */
    readonly cwd: string;
}
/**
 * Entry point. `argv` is already sliced past `loop`. NEVER throws and NEVER calls process.exit —
 * resolves exactly one exit code. The M03 router owns process.exit.
 */
export declare function loopCommand(argv: readonly string[], io?: Partial<LoopIo>, clock?: () => string): Promise<number>;
