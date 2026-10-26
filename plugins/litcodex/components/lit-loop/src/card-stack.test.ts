// The card status reads the thread's own workflow stack: paused work shows under the running side discipline,
// one line of work shows nothing, and the plain-text card carries the same row.

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cardStatusText, readCardStatus } from "./card-status.js";
import { writeThreadPointer } from "./live-step.js";
import { recordWorkflowTurn } from "./workflow-map.js";
import { recordStackEvent } from "./workflow-stack.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function thread(): { root: string; env: NodeJS.ProcessEnv } {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-cardstack-home-")));
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-cardstack-ws-")));
	roots.push(home, root);
	mkdirSync(join(root, ".litcodex"), { recursive: true });
	const env = { CODEX_HOME: home };
	recordWorkflowTurn(root, "t1", "turn-1", "lit-brainstorm", 100_000);
	writeThreadPointer(env, "t1", root, 100_000);
	return { root, env };
}

describe("card status stack", () => {
	it("names the paused frame, its stage and gauge, and the running side discipline", () => {
		const { root, env } = thread();
		recordStackEvent(root, "t1", { type: "start", skill: "lit-loop" }, new Date(90_000));
		recordStackEvent(
			root,
			"t1",
			{ type: "record", family: "loop", stage: "GREEN", n: 2, total: 5 },
			new Date(91_000),
		);
		recordStackEvent(root, "t1", { type: "start", skill: "lit-brainstorm" }, new Date(92_000));
		const status = readCardStatus("t1", env, 120_000);
		expect(status.stack).toMatchObject({
			breadcrumb: "lit-loop ‖ > lit-brainstorm",
			paused: [{ name: "lit-loop", stage: "GREEN", gauge: "[▉▉░░░] 2/5" }],
			running: { name: "lit-brainstorm" },
		});
		expect(cardStatusText(status)).toContain(
			"⏸ lit-loop GREEN [▉▉░░░] 2/5 ‖ ▶ lit-brainstorm interview · back: lit continue",
		);
	});

	it("is null while the thread has one frame, none, or after lit continue", () => {
		const { root, env } = thread();
		expect(readCardStatus("t1", env, 120_000).stack).toBeNull();
		recordStackEvent(root, "t1", { type: "start", skill: "lit-loop" }, new Date(90_000));
		expect(readCardStatus("t1", env, 120_000).stack).toBeNull();
		recordStackEvent(root, "t1", { type: "start", skill: "lit-brainstorm" }, new Date(91_000));
		expect(readCardStatus("t1", env, 120_000).stack).not.toBeNull();
		recordStackEvent(root, "t1", { type: "continue" }, new Date(92_000));
		expect(readCardStatus("t1", env, 120_000).stack).toBeNull();
	});
});
