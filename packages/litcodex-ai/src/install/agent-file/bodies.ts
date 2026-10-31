// Shipped LitFamily section texts for the Codex global file and for project repos.
// The global text is read on every session start, so it stays short and points at the
// project's own docs for everything else. Both name only LitCodex and its host.

import { ATTRIBUTION_LINE, type AttributionMode } from "./attribution.js";

/** Marker id for the LitCodex section. */
export const AGENT_FILE_ID = "litcodex" as const;

/** Install modes for the section. */
export const AGENT_FILE_MODES = Object.freeze(["on", "off"]) as readonly ["on", "off"];

export type AgentFileMode = (typeof AGENT_FILE_MODES)[number];

/** The global section stays small enough to be read on every turn of every session. */
export const AGENT_FILE_MAX_BYTES = 1200 as const;

/** The section for the global `$CODEX_HOME/AGENTS.md`. */
export const globalBody = (options: { attribution?: AttributionMode } = {}): string =>
	[
		"## LitFamily · LitCodex",
		"",
		"LitCodex brings the lit workflows to Codex CLI (lit-loop, start-work, lit-plan, review-work, lit-adhd,",
		"litresearch). Codex reads this file at the start of every session, so this block only sets the ground rules.",
		"",
		"- `lit` at the start of a prompt is LitCodex's activation word, not the Lit web library.",
		"- Plans live in `plans/`, the session handoff in `HANDOFF.md`, run state in `.litcodex/`. Read them",
		"  before resuming work in a repo.",
		"- Never push, publish, tag or bump a version without the user's explicit yes for that action.",
		"- Call work done only after its tests pass and the changed surface was checked for real.",
		"- In a new repo, `lit-init` writes a short project `AGENTS.md` with these conventions.",
		...(options.attribution === "off" ? [ATTRIBUTION_LINE] : []),
		"- Turn this block off with `litcodex config agentFile off`.",
		"",
	].join("\n");

/** The section for a repo's `AGENTS.md`, written by `litcodex agent-file project`. */
export const projectBody = (): string =>
	[
		"## LitFamily · project conventions",
		"",
		"This repo is worked with LitCodex's lit workflows (lit-loop, start-work, lit-plan, review-work).",
		"",
		"- Plans live in `plans/`, the session handoff in `HANDOFF.md`, run state in `.litcodex/` (keep it out",
		"  of commits). Read the handoff and the active plan before resuming.",
		"- Never push, publish, tag or bump a version without the user's explicit yes for that action.",
		"- Pair every behaviour change with a test that failed first, and check the changed surface for real",
		"  before calling it done.",
		"",
	].join("\n");
