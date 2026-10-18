import { type LitModeSpec } from "./modes.js";
/**
 * Explicit invocation of a skill that has no route directive: the skill's own banner and description,
 * then its installed file for the model to read.
 */
export declare function loadSkillInvocationContext(skillName: string, skillPath: string): string;
/** A directive-backed route: its head, then its directive and installed skill named as files. */
export declare function loadRouteContext(spec: LitModeSpec): string;
