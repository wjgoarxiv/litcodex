export interface FilmRequest {
    readonly verb: string;
    readonly noun: string;
}
/** A creation verb plus a video noun or compound, with none of the five exclusions. */
export declare function classifyFilmRequest(prompt: string): FilmRequest | null;
/**
 * The film note for a matched prompt. lit-typographic-motion moved to wjgoarxiv-skills and its folder here
 * is a same-name stub, so the note names that stub once by absolute path and says how it hands over. Empty
 * on no match or when the stub is not installed.
 */
export declare function motionRouteContext(litLoopSkillPath: string, prompt: string): string;
