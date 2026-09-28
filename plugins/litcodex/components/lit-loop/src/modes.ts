// src/modes.ts — multi-mode hook router table (RC1/RC2).
//
// Maps each bounded trigger token (trigger.ts) to its mode spec: the open/close directive markers
// (for the per-mode idempotency guard, RC1) and the absolute directive path (for the generic loader,
// RC2). The lit-loop-family tokens (lit-loop / litcodex / lit) share the single lit-loop mode;
// sibling tokens and natural lit phrases route to their own mode directives.
//
// Layout decision (SDD RC4): lit-loop keeps the authored `directive.md` at the COMPONENT ROOT (zero
// churn to its lockstep points); sibling directives live under `directives/<mode>.md`. Paths
// resolve relative to THIS module so they land correctly from both layouts (src/modes.ts →
// <component>/… in dev/vitest; dist/modes.js → <pkg>/… in the published tarball, where files[] ships
// `directive.md` and the `directives/` dir beside dist/). Path resolution never reads the file; the
// loader reads lazily + fail-silent, so a not-yet-authored directive simply degrades to a noop.
//
// Imports markers + the trigger token type only (no cycle: hook → modes → {markers, trigger}).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	BROWSER_DRIVE_DIRECTIVE_CLOSE,
	BROWSER_DRIVE_DIRECTIVE_MARKER,
	DEEP_INTERVIEW_DIRECTIVE_CLOSE,
	DEEP_INTERVIEW_DIRECTIVE_MARKER,
	HANDOFF_DIRECTIVE_CLOSE,
	HANDOFF_DIRECTIVE_MARKER,
	LIT_COMPREHEND_DIRECTIVE_CLOSE,
	LIT_COMPREHEND_DIRECTIVE_MARKER,
	LIT_CRUCIBLE_DIRECTIVE_CLOSE,
	LIT_CRUCIBLE_DIRECTIVE_MARKER,
	LIT_INIT_DIRECTIVE_CLOSE,
	LIT_INIT_DIRECTIVE_MARKER,
	LIT_LOOP_DIRECTIVE_CLOSE,
	LIT_LOOP_DIRECTIVE_MARKER,
	LIT_PLAN_DIRECTIVE_CLOSE,
	LIT_PLAN_DIRECTIVE_MARKER,
	LIT_RECAP_DIRECTIVE_CLOSE,
	LIT_RECAP_DIRECTIVE_MARKER,
	LITGOAL_DIRECTIVE_CLOSE,
	LITGOAL_DIRECTIVE_MARKER,
	LITRESEARCH_DIRECTIVE_CLOSE,
	LITRESEARCH_DIRECTIVE_MARKER,
	LITWORK_DIRECTIVE_CLOSE,
	LITWORK_DIRECTIVE_MARKER,
	REVIEW_WORK_DIRECTIVE_CLOSE,
	REVIEW_WORK_DIRECTIVE_MARKER,
	SCIENTIFIC_VISUALIZATION_DIRECTIVE_CLOSE,
	SCIENTIFIC_VISUALIZATION_DIRECTIVE_MARKER,
	START_WORK_DIRECTIVE_CLOSE,
	START_WORK_DIRECTIVE_MARKER,
} from "./markers.js";
import type { RenamedSkillId } from "./skill-renames.js";
import type { LitTriggerToken } from "./trigger.js";

/** Lit-family modes. Multiple tokens may map to one mode (lit/litcodex/lit-loop → lit-loop). */
export type LitMode =
	| RenamedSkillId
	| "browser-drive"
	| "lit-handoff"
	| "lit-scientific-visualization"
	| "deep-interview"
	| "lit-crucible"
	| "lit-init"
	| "lit-loop"
	| "litwork"
	| "lit-plan"
	| "litgoal"
	| "review-work"
	| "litresearch"
	| "start-work"
	| "lit-recap"
	| "lit-comprehend";

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

/** Resolve a path relative to this module (percent-decoding, space/#/Hangul-safe). */
function resolveFromHere(rel: string): string {
	return fileURLToPath(new URL(rel, import.meta.url));
}

export function resolveSkillPath(name: string): string {
	const devTree = resolveFromHere(`../../../skills/${name}/SKILL.md`);
	if (existsSync(devTree)) return devTree;
	return resolveFromHere(`../skills/${name}/SKILL.md`);
}

function resolveAuthoredHandoffPath(): string {
	const relative = "vendor/handoff/SKILL.md";
	const devTree = resolveFromHere(`../../../${relative}`);
	return existsSync(devTree) ? devTree : resolveFromHere(`../${relative}`);
}

// lit-loop keeps the component-root directive.md (A3 G6); shared by lit / litcodex / lit-loop tokens.
const LIT_LOOP_SPEC: LitModeSpec = Object.freeze({
	mode: "lit-loop",
	openMarker: LIT_LOOP_DIRECTIVE_MARKER,
	closeMarker: LIT_LOOP_DIRECTIVE_CLOSE,
	directivePath: resolveFromHere("../directive.md"),
	skillName: "lit-loop",
	skillPath: resolveSkillPath("lit-loop"),
});

/** Exact bare `handoff` has a dedicated route outside the bounded lit-family token grammar. */
export const HANDOFF_MODE_SPEC: LitModeSpec = Object.freeze({
	mode: "lit-handoff",
	openMarker: HANDOFF_DIRECTIVE_MARKER,
	closeMarker: HANDOFF_DIRECTIVE_CLOSE,
	directivePath: resolveFromHere("../directives/lit-handoff.md"),
	skillName: "lit-handoff",
	skillPath: resolveAuthoredHandoffPath(),
});

/** Exact bare `lit-scientific-visualization` is a standalone route outside the token grammar. */
export const SCIENTIFIC_VISUALIZATION_MODE_SPEC: LitModeSpec = Object.freeze({
	mode: "lit-scientific-visualization",
	openMarker: SCIENTIFIC_VISUALIZATION_DIRECTIVE_MARKER,
	closeMarker: SCIENTIFIC_VISUALIZATION_DIRECTIVE_CLOSE,
	directivePath: resolveFromHere("../directives/lit-scientific-visualization.md"),
	skillName: "lit-scientific-visualization",
	skillPath: resolveSkillPath("lit-scientific-visualization"),
});

/** Exact browser-drive and `$litcodex:browser-drive` are standalone routes outside token matching. */
export const BROWSER_DRIVE_MODE_SPEC: LitModeSpec = Object.freeze({
	mode: "browser-drive",
	openMarker: BROWSER_DRIVE_DIRECTIVE_MARKER,
	closeMarker: BROWSER_DRIVE_DIRECTIVE_CLOSE,
	directivePath: resolveFromHere("../directives/browser-drive.md"),
	skillName: "browser-drive",
	skillPath: resolveSkillPath("browser-drive"),
});

/** Token → mode spec. Frozen; the single source the hook router branches on. */
export const MODE_BY_TOKEN: Readonly<Record<LitTriggerToken, LitModeSpec>> = Object.freeze({
	"lit-crucible": Object.freeze({
		mode: "lit-crucible",
		openMarker: LIT_CRUCIBLE_DIRECTIVE_MARKER,
		closeMarker: LIT_CRUCIBLE_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/lit-crucible.md"),
		skillName: "lit-crucible",
		skillPath: resolveSkillPath("lit-crucible"),
	}),
	"lit-init": Object.freeze({
		mode: "lit-init",
		openMarker: LIT_INIT_DIRECTIVE_MARKER,
		closeMarker: LIT_INIT_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/lit-init.md"),
		skillName: "lit-init",
		skillPath: resolveSkillPath("lit-init"),
	}),
	"deep-interview": Object.freeze({
		mode: "deep-interview",
		openMarker: DEEP_INTERVIEW_DIRECTIVE_MARKER,
		closeMarker: DEEP_INTERVIEW_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/deep-interview.md"),
		skillName: "deep-interview",
		skillPath: resolveSkillPath("deep-interview"),
	}),
	"lit-loop": LIT_LOOP_SPEC,
	litcodex: LIT_LOOP_SPEC,
	lit: LIT_LOOP_SPEC,
	litwork: Object.freeze({
		mode: "litwork",
		openMarker: LITWORK_DIRECTIVE_MARKER,
		closeMarker: LITWORK_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/litwork.md"),
		skillName: "litwork",
		skillPath: resolveSkillPath("litwork"),
	}),
	"lit-plan": Object.freeze({
		mode: "lit-plan",
		openMarker: LIT_PLAN_DIRECTIVE_MARKER,
		closeMarker: LIT_PLAN_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/lit-plan.md"),
		skillName: "lit-plan",
		skillPath: resolveSkillPath("lit-plan"),
	}),
	litgoal: Object.freeze({
		mode: "litgoal",
		openMarker: LITGOAL_DIRECTIVE_MARKER,
		closeMarker: LITGOAL_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/litgoal.md"),
		skillName: "litgoal",
		skillPath: resolveSkillPath("litgoal"),
	}),
	"review-work": Object.freeze({
		mode: "review-work",
		openMarker: REVIEW_WORK_DIRECTIVE_MARKER,
		closeMarker: REVIEW_WORK_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/review-work.md"),
		skillName: "review-work",
		skillPath: resolveSkillPath("review-work"),
	}),
	litresearch: Object.freeze({
		mode: "litresearch",
		openMarker: LITRESEARCH_DIRECTIVE_MARKER,
		closeMarker: LITRESEARCH_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/litresearch.md"),
		skillName: "litresearch",
		skillPath: resolveSkillPath("litresearch"),
	}),
	"start-work": Object.freeze({
		mode: "start-work",
		openMarker: START_WORK_DIRECTIVE_MARKER,
		closeMarker: START_WORK_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/start-work.md"),
		skillName: "start-work",
		skillPath: resolveSkillPath("start-work"),
	}),
	"lit-recap": Object.freeze({
		mode: "lit-recap",
		openMarker: LIT_RECAP_DIRECTIVE_MARKER,
		closeMarker: LIT_RECAP_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/lit-recap.md"),
		skillName: "lit-recap",
		skillPath: resolveSkillPath("lit-recap"),
	}),
	"lit-comprehend": Object.freeze({
		mode: "lit-comprehend",
		openMarker: LIT_COMPREHEND_DIRECTIVE_MARKER,
		closeMarker: LIT_COMPREHEND_DIRECTIVE_CLOSE,
		directivePath: resolveFromHere("../directives/lit-comprehend.md"),
		skillName: "lit-comprehend",
		skillPath: resolveSkillPath("lit-comprehend"),
	}),
});

/** The mode spec for a matched token. Total over the token union (every token has a spec). */
export function modeForToken(token: LitTriggerToken): LitModeSpec {
	return MODE_BY_TOKEN[token];
}
