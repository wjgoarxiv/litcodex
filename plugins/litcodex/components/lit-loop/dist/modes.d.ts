import type { RenamedSkillId } from "./skill-renames.js";
import type { LitTriggerToken } from "./trigger.js";
/** Lit-family modes. Multiple tokens may map to one mode (lit/litcodex/lit-loop → lit-loop). */
export type LitMode = RenamedSkillId | "browser-drive" | "lit-handoff" | "lit-scientific-visualization" | "deep-interview" | "lit-crucible" | "lit-init" | "lit-loop" | "litwork" | "lit-plan" | "litgoal" | "review-work" | "litresearch" | "start-work" | "lit-recap" | "lit-comprehend";
/** Per-mode routing spec: its marker pair (guard) + resolved directive path (loader). */
export interface LitModeSpec {
    readonly mode: LitMode;
    readonly openMarker: string;
    readonly closeMarker: string;
    /** Absolute path to the mode's directive.md, resolved from this module. */
    readonly directivePath: string;
    /** The bundled skill whose full SKILL.md body must be injected for this mode. */
    readonly skillName: string;
    /** Absolute path to the bundled skill body. */
    readonly skillPath: string;
}
export declare function resolveSkillPath(name: string): string;
/** Exact bare `handoff` has a dedicated route outside the bounded lit-family token grammar. */
export declare const HANDOFF_MODE_SPEC: LitModeSpec;
/** Exact bare `lit-scientific-visualization` is a standalone route outside the token grammar. */
export declare const SCIENTIFIC_VISUALIZATION_MODE_SPEC: LitModeSpec;
/** Exact browser-drive and `$litcodex:browser-drive` are standalone routes outside token matching. */
export declare const BROWSER_DRIVE_MODE_SPEC: LitModeSpec;
/** Token → mode spec. Frozen; the single source the hook router branches on. */
export declare const MODE_BY_TOKEN: Readonly<Record<LitTriggerToken, LitModeSpec>>;
/** The mode spec for a matched token. Total over the token union (every token has a spec). */
export declare function modeForToken(token: LitTriggerToken): LitModeSpec;
