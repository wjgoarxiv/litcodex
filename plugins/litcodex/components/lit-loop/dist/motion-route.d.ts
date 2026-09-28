export interface FilmRequest {
    readonly verb: string;
    readonly noun: string;
}
/** A creation verb plus a video noun or compound, with none of the five exclusions. */
export declare function classifyFilmRequest(prompt: string): FilmRequest | null;
/**
 * The optional router hint. A type compound, an explicit kinetic-type or lyric request, or a quoted
 * span of two or more words. A quote is only detected; its contents are never followed.
 */
export declare function typeLedCue(prompt: string): string | null;
export declare const FILM_SUBCOMMANDS: readonly string[];
/**
 * The neutral film context for a matched prompt: what the request is, the treatment-first step, the
 * path rule, and the installed renderer named once as an absolute path. Empty on no match or when
 * the sibling skill is not installed.
 */
export declare function motionRouteContext(litLoopSkillPath: string, prompt: string): string;
