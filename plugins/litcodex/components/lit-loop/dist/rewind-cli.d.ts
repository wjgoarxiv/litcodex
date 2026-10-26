export interface RewindIo {
    readonly stdout: NodeJS.WritableStream;
    readonly stderr: NodeJS.WritableStream;
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly now?: number;
}
export declare function rewindCommand(argv: readonly string[], io: RewindIo): number;
/** Record the stage and counts of the top frame: `stage --family loop --stage RED --n 2 --total 5`. */
export declare function stageCommand(argv: readonly string[], io: RewindIo): number;
