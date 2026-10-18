export { LIT_LOOP_DIRECTIVE_MARKER } from "./markers.js";
/** Machine-readable codes for the three load-failure classes (ordered: unreadable → empty → marker). */
export type LitLoopDirectiveErrorCode = "LIT_LOOP_DIRECTIVE_UNREADABLE" | "LIT_LOOP_DIRECTIVE_EMPTY" | "LIT_LOOP_DIRECTIVE_MARKER_MISSING";
/** Typed error carrying a machine-readable code and the absolute path the loader attempted. */
export declare class LitLoopDirectiveError extends Error {
    readonly code: LitLoopDirectiveErrorCode;
    readonly resolvedPath: string;
    constructor(code: LitLoopDirectiveErrorCode, message: string, resolvedPath: string);
}
/**
 * Generic (RC2): read + normalize + validate ANY mode's directive at an explicit path against an
 * explicit `openMarker`/`closeMarker` pair. The multi-mode router (codex-hook → modes) uses this to
 * load litwork / lit-plan / litgoal directives; `loadLitLoopDirectiveFrom` is the lit-loop wrapper.
 * Normalization: CRLF→LF, lone CR→LF, then trim(). Fail-loud with a typed error (codes are generic).
 */
export declare function loadDirectiveFrom(resolvedPath: string, openMarker: string, closeMarker: string): string;
/** Read and normalize a bundled text file, failing with a typed error when it is unreadable or empty. */
export declare function readNormalizedBody(resolvedPath: string, label: string): string;
/**
 * Read + normalize + validate the lit-loop directive at an explicit path. Test-only seam (S10
 * §Test plan) so corrupt / CRLF / missing-file cases can be exercised without swapping the bundled
 * file. Delegates to the generic `loadDirectiveFrom` with the lit-loop marker pair.
 */
export declare function loadLitLoopDirectiveFrom(resolvedPath: string): string;
/**
 * Load the bundled directive.md from its resolved dist path. Re-readable on demand (tests /
 * dev hot-reload); production consumers use the eagerly-computed `LIT_LOOP_DIRECTIVE` constant.
 *
 * @throws LitLoopDirectiveError code UNREADABLE / EMPTY / MARKER_MISSING.
 */
export declare function loadLitLoopDirective(): string;
/**
 * The normalized directive text, read once at module-load time. Guaranteed to start with
 * `<lit-loop-mode>`, end with `</lit-loop-mode>`, and contain no `\r`; non-empty; frozen for
 * the process lifetime.
 */
export declare const LIT_LOOP_DIRECTIVE: string;
