import type { LitMode } from "./modes.js";
export type DirectiveMode = Exclude<LitMode, "lit-commit" | "lit-team" | "lit-burnoff" | "lit-burnoff-file" | "lit-humanizer" | "lit-fetch" | "lit-code">;
/** Head text per directive-backed route, in the order the model should read it. */
export declare const ROUTE_HEADS: Readonly<Record<DirectiveMode, string>>;
/** Opening lines for an explicit skill invocation that has no route directive of its own. */
export declare function skillInvocationHead(skillName: string, probeLine: string | null, description: string): string;
