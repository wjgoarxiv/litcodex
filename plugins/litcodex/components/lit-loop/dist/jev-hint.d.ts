export declare const JEV_FLAG_ENV = "LITCODEX_JEV";
export declare const JEV_KEY_ENV = "TYPESAFE_API_KEY";
export declare const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export declare const JEV_DEFAULT_MODEL = "jev-1.13.0";
export declare const JEV_DEFAULT_TIMEOUT_MS = 1500;
export declare const JEV_MAX_TIMEOUT_MS = 3000;
export declare const JEV_DEFAULT_MAX_CALLS = 200;
export declare const JEV_DEFAULT_MIN_CONFIDENCE = 0.35;
export declare const JEV_MAX_PROMPT_CHARS = 2000;
export declare const JEV_REDACTION_WINDOW_CHARS = 8000;
export declare const JEV_MAX_DESCRIPTION_CHARS = 300;
export declare const JEV_MAX_BODY_BYTES: number;
export declare const JEV_STATE_DIR = ".litcodex/jev";
export type JevSwitchState = "off" | "on" | "flag on but TYPESAFE_API_KEY missing";
/** The doctor/status state. Never reveals the key or its length. */
export declare function jevSwitchState(env: NodeJS.ProcessEnv): JevSwitchState;
/**
 * Redact an 8,000-character window (home paths, e-mail addresses, the literal key and token-shaped
 * strings, in that order), then cut to 2,000 characters. A run of 8 or more token characters left at
 * the cut is part of something the cut split, so it becomes `[secret]` too.
 */
export declare function redactJevPrompt(prompt: string, key?: string): string;
export interface JevCatalogEntry {
    readonly id: string;
    readonly description: string;
}
/** The installed plugin's `skills/` directory, resolved the same way the mode router finds bodies. */
export declare function defaultJevSkillsRoot(): string;
/**
 * This plugin's own skills that the host may load on the model's initiative: every `skills/<id>/SKILL.md`
 * whose frontmatter `name` equals its directory, minus skills whose `agents/openai.yaml` sets
 * `allow_implicit_invocation: false` (those run only on an explicit user invocation).
 */
export declare function loadJevCatalog(skillsRoot?: string): JevCatalogEntry[];
export type JevSkipReason = "slash-command" | "skill-mention" | "routed" | "too-short";
/** Why this turn gets no Jev request, or null when it is eligible. Pure. */
export declare function jevSkipReason(prompt: string, catalogIds?: ReadonlySet<string>): JevSkipReason | null;
export interface JevRequestBody {
    readonly model: string;
    readonly state: string;
    readonly questions: {
        readonly which: {
            readonly type: "choice";
            readonly instructions: string;
            readonly criteria: Readonly<Record<string, string>>;
        };
    };
}
export declare function buildJevRequestBody(model: string, state: string, catalog: readonly JevCatalogEntry[]): JevRequestBody;
export type JevVerdict = {
    readonly kind: "hint";
    readonly skillId: string;
    readonly confidence: number;
} | {
    readonly kind: "none";
    readonly confidence: number;
} | {
    readonly kind: "low-confidence";
    readonly choice: string;
    readonly confidence: number;
} | {
    readonly kind: "rejected";
};
/** Validate an already-parsed response against the ids that were sent. Nothing else is trusted. */
export declare function judgeJevResponse(parsed: unknown, catalogIds: ReadonlySet<string>, minConfidence: number): JevVerdict;
export declare function jevHintLine(skillId: string): string;
/** The opt-in (`LITCODEX_JEV_SHOW=1`) visible line for a hinted turn: skill id and latency only. */
export declare function jevShowLine(skillId: string, latencyMs: number): string;
/** Once-per-session awareness banner. Plain text: Codex renders hook systemMessage control characters literally. */
export declare const JEV_ON_BANNER = "\u2726 Jev skill hint ON";
export declare function jevFallbackNote(reason: string): string;
export interface JevHttpRequest {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
}
export interface JevHttpResponse {
    readonly status: number;
    text(): Promise<string>;
}
/** Injected in tests; the default uses the runtime's built-in `fetch`. */
export type JevHttpClient = (url: string, request: JevHttpRequest) => Promise<JevHttpResponse>;
export declare const fetchJevHttpClient: JevHttpClient;
export interface JevSessionState {
    readonly version: 1;
    readonly calls: number;
    readonly noted: boolean;
    readonly announced: boolean;
}
/**
 * The session record: fresh when missing or malformed, null when `.litcodex`, `.litcodex/jev` or the
 * record itself is a symlink or the wrong kind of entry, so a checked-in link is never read through.
 */
export declare function readJevSessionState(path: string): JevSessionState | null;
export interface JevHintInput {
    readonly prompt: string;
    readonly sessionId: string | null;
    readonly repoRoot: string;
    readonly env: NodeJS.ProcessEnv;
    readonly http?: JevHttpClient;
    readonly skillsRoot?: string;
    readonly now?: () => number;
}
/** A hint sets `additionalContext`, plus `systemMessage` only with `LITCODEX_JEV_SHOW=1`; a note sets `systemMessage`. */
export interface JevHintResult {
    readonly additionalContext?: string;
    readonly systemMessage?: string;
}
/**
 * Decide the optional hint for one UserPromptSubmit turn. Never throws; every failure resolves to at
 * most one visible fallback note per session and otherwise to nothing.
 */
export declare function runJevSkillHint(input: JevHintInput): Promise<JevHintResult>;
/**
 * The once-per-session banner, or null. Only when the hint is fully on (flag and key); it is claimed in
 * the session state before it is shown, so a state write failure shows nothing rather than repeating.
 */
export declare function claimJevOnBanner(repoRoot: string, sessionId: string | null, env: NodeJS.ProcessEnv): string | null;
/** Put the banner (when claimed) on its own line ahead of any other visible Jev line. */
export declare function withJevBanner(result: JevHintResult, banner: string | null): JevHintResult;
/** Codex UserPromptSubmit output for a hint and/or visible line; "" when there is nothing to say. */
export declare function formatJevHookOutput(result: JevHintResult): string;
