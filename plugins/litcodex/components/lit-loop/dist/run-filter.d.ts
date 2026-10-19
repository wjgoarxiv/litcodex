export interface ScreenFilter {
    /** The bytes to write now, scroll regions rewritten; an unfinished tail stays held. */
    push(chunk: Uint8Array): Buffer;
    /** Releases the held bytes as they are, for when the caller's deadline passed. */
    flush(): Buffer;
    /** True while bytes are held. */
    readonly holding: boolean;
    /** True when the output so far ends between whole sequences, so the panel may be drawn. */
    readonly atBoundary: boolean;
    /** Whether the child last asked for a visible cursor (`ESC[?25h` / `ESC[?25l`). */
    readonly cursorVisible: boolean;
    /** True after a forced flush or a terminal reset, until `regionAsserted` is called. */
    readonly regionLost: boolean;
    /** The caller has set the scroll region again. */
    regionAsserted(): void;
    /** True while the child has saved the cursor (`ESC7`, `ESC[s`) and not restored it yet. */
    readonly cursorSaved: boolean;
    /** The child's row count, after a resize. */
    setRows(rows: number): void;
}
/** Where the unfinished tail of `data` starts; `data.length` when everything is whole. */
export declare function unfinishedFrom(data: Buffer): number;
export declare function createScreenFilter(initialRows: number): ScreenFilter;
