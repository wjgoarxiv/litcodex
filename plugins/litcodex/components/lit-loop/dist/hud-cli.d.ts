export declare const HUD_HELP_TEXT = "litcodex hud [--session <id>] [--once]\n\nWatch the LIT card of your newest Codex session from a second terminal window or tab.\nIt reads LIT's own records and, for the context and limit figures, the end of that session's Codex log.\nIt never writes a file and never touches Codex. Ctrl-C quits.\n\nOptions:\n  --session <id>   Follow this session (an exact id or a unique prefix) instead of the newest.\n  --once           Print one plain frame and exit.\n  --help           Show this help.\n\nLITCODEX_HUD_GLYPHS=auto|nerd|basic sets round ends on pills and gauges (auto looks for an icon font).\n";
export interface HudOutput {
    write(text: string): unknown;
    readonly isTTY?: boolean;
    readonly columns?: number | undefined;
    readonly rows?: number | undefined;
    on?(event: "error", listener: (error: unknown) => void): unknown;
}
export interface HudLoopOptions {
    readonly env: NodeJS.ProcessEnv;
    readonly wanted: string | null;
    readonly out: HudOutput;
    readonly color: boolean;
    readonly truecolor?: boolean;
    /** Draw the sunset: a dark truecolor terminal. */
    readonly scene?: boolean;
    readonly now: () => number;
}
export interface HudLoop {
    /** Reads the records and draws; true when something was written. */
    tick(): boolean;
    /** Redraws the composed frame a moment later, reading nothing; true when something was written. */
    frame(): boolean;
    /** Whether the next `frame` would draw anything new. */
    moving(): boolean;
}
/**
 * A frame writer: each `tick` reads and renders once, and writes only when the frame text changed or the
 * terminal was resized. On a terminal the frame stays one column short of the edge, where a full line
 * followed by erase-to-end would lose its last glyph or wrap.
 */
export declare function createHudLoop(options: HudLoopOptions): HudLoop;
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
