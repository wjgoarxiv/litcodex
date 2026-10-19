export declare const HUD_HELP_TEXT = "litcodex hud [--session <id>] [--once]\n\nWatch the LIT card of your newest Codex session from a second terminal window or tab.\nIt reads only LIT's own records, never writes a file and never touches Codex. Ctrl-C quits.\n\nOptions:\n  --session <id>   Follow this session (an exact id or a unique prefix) instead of the newest.\n  --once           Print one plain frame and exit.\n  --help           Show this help.\n";
export interface HudOutput {
    write(text: string): unknown;
    readonly isTTY?: boolean;
    readonly columns?: number | undefined;
    on?(event: "error", listener: (error: unknown) => void): unknown;
}
export interface HudLoopOptions {
    readonly env: NodeJS.ProcessEnv;
    readonly wanted: string | null;
    readonly out: HudOutput;
    readonly color: boolean;
    readonly now: () => number;
}
/**
 * A frame writer: each `tick` reads and renders once, and writes only when the frame text changed or the
 * terminal was resized. On a terminal the frame stays one column short of the edge, where a full line
 * followed by erase-to-end would lose its last glyph or wrap.
 */
export declare function createHudLoop(options: HudLoopOptions): {
    tick(): boolean;
};
/** The process events the command listens to; a test passes its own emitter. */
interface HudSignals {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    off(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface HudIo {
    readonly stdout: HudOutput;
    readonly stderr: {
        write(text: string): unknown;
    };
    readonly env: NodeJS.ProcessEnv;
    readonly signals?: HudSignals;
    readonly now?: () => number;
}
export declare function hudCommand(args: readonly string[], io: HudIo): Promise<number>;
export {};
