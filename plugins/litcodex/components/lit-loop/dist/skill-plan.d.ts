export declare const PLAN_CAP = 3;
/** The skills that moved to wjgoarxiv-skills; the folders here are same-name stubs. */
export declare const EXTENSION_SKILLS: ReadonlySet<string>;
/** `lit +<alias>` names: short words a user can type without looking anything up. */
export declare const PLAN_ALIASES: Readonly<Record<string, string>>;
/** The skills the catalog may offer, with what each is for; the block names the ids only, extensions only when installed. */
export declare const PLAN_CATALOG: Readonly<Record<string, string>>;
/** Routes that only read. A plan led by one of these keeps only companions from this set. */
export declare const READ_ONLY_SKILLS: ReadonlySet<string>;
/**
 * Every deliverable a bare-`lit` prompt asks for, in the fixed priority order (film, schematic, deck,
 * document, research, interface, data figure, diagram, structural search), deduplicated.
 */
export declare function naturalCompanions(prompt: string): string[];
export interface PlanHatch {
    readonly skills: readonly string[];
    readonly extra: readonly string[];
    readonly unknown: readonly string[];
}
/** `lit +viz +ui <task>`: the named skills in the user's order (at most three) and any unknown names. */
export declare function parsePlanHatch(prompt: string): PlanHatch | null;
/** A large or risky design: a redesign, architecture or migration word, or three or more deliverables. */
export declare function wantsCrucible(text: string, ids: readonly string[]): boolean;
export interface PlanEntry {
    readonly id: string;
    readonly extension: boolean;
    readonly installed: boolean;
}
export interface SkillPlan {
    readonly entries: readonly PlanEntry[];
    readonly dropped: readonly {
        readonly id: string;
        readonly why: string;
    }[];
    readonly forced: boolean;
    readonly unknown: readonly string[];
    readonly readOnly: boolean;
}
/**
 * The ordered plan, or null when it would be the primary alone (an ordinary prompt's context stays as it
 * was). `forced` from parsePlanHatch replaces the detected companions.
 */
export declare function buildSkillPlan(args: {
    readonly primary: string;
    readonly companions: readonly string[];
    readonly text: string;
    readonly forced?: PlanHatch | null;
    readonly installed?: ReadonlySet<string>;
}): SkillPlan | null;
/** Extensions whose SKILL.md sits in `$CODEX_HOME/skills/<id>` or `~/.agents/skills/<id>`. Never throws. */
export declare function installedExtensions(env?: NodeJS.ProcessEnv): Set<string>;
/** `Skill plan: 1 lit-loop (primary) → 2 frontend-ui-ux → 3 …`, naming each missing extension's install line once. */
export declare function skillPlanLine(plan: SkillPlan): string;
/** The model-facing block: fixed text around the plan. */
export declare function skillPlanContext(plan: SkillPlan, installed?: ReadonlySet<string>): string;
/**
 * The plan block for a prompt the hook routed to `primary`, or "" when there is none. Advisory: any
 * failure leaves the single route alone.
 */
export declare function skillPlanFor(prompt: string, primary: string, env?: NodeJS.ProcessEnv): string;
