export interface TranscriptSearchOptions {
    readonly latestCompactedReplacementOnly?: boolean;
}
export declare function readCurrentTurnHookContext(transcriptPath: string, turnId: string): string | null;
export declare function readTranscriptSearchText(transcriptPath: string, options?: TranscriptSearchOptions): string | null;
