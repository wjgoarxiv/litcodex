export declare const SCREEN_STATUS_ENV = "LITCODEX_SCREEN_STATUS";
/** The window the colours are for; nothing here is a dark one that draws 24-bit colour. */
export interface ScreenLook {
    readonly light?: boolean;
    readonly depth?: 256;
}
export interface ScreenStatusState extends ScreenLook {
    /** The hook card is coloured (NO_COLOR is applied by `screenColor`). */
    readonly enabled: boolean;
    readonly source: "default" | "command" | "environment";
    readonly warnings: readonly string[];
}
export declare const SCREEN_STATUS_HELP_TEXT = "litcodex screen-status on|off|status\nlitcodex screen-status light|dark|truecolor|256\n\nColour the LIT card the hooks print inside Codex. Off by default.\nOnly the terminal `codex` draws the colour:\nthe Codex desktop app and IDE extensions show the colour codes as raw text,\nso turn it on only if you use the terminal `codex`. Without colour the card has the same rows.\nA hook cannot see the window, so a white one is a choice: `light` keeps every word in the window's own ink, and\n`dark` (the default) goes back. `256` is for a terminal without 24-bit colour, and `truecolor` goes back.\nThe setting is stored in $CODEX_HOME/litcodex/screen-status.json; LITCODEX_SCREEN_STATUS=1 or 0 overrides on and off.\nNO_COLOR keeps the card plain.\n";
/** The stored choice and the environment override; a missing, corrupt or linked file reads as off. */
export declare function readScreenStatus(env: NodeJS.ProcessEnv): ScreenStatusState;
/** True when the hooks may colour the card: the switch is on and NO_COLOR is unset or empty. */
export declare function screenColor(env: NodeJS.ProcessEnv): boolean;
/** How the hooks draw the card: whether in colour, for which window, and with which pill ends. */
export declare function screenLook(env: NodeJS.ProcessEnv): ScreenLook & {
    readonly color: boolean;
    readonly caps?: boolean;
};
export interface ScreenStatusIo {
    readonly env: NodeJS.ProcessEnv;
    readonly stdout: {
        write(text: string): unknown;
    };
    readonly stderr: {
        write(text: string): unknown;
    };
}
/** `litcodex screen-status <verb>`; resolves an exit code and never throws. */
export declare function screenStatusCommand(args: readonly string[], io: ScreenStatusIo): number;
