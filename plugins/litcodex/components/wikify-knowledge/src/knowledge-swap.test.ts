import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const openHook = vi.hoisted(() => ({
	path: undefined as string | undefined,
	swap: undefined as (() => void) | undefined,
}));

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		openSync(path: string | Buffer | URL, flags: string | number, mode?: number): number {
			if (openHook.path !== undefined && String(path) === openHook.path) {
				const swap = openHook.swap;
				openHook.path = undefined;
				openHook.swap = undefined;
				swap?.();
			}
			return mode === undefined ? actual.openSync(path, flags) : actual.openSync(path, flags, mode);
		},
	};
});

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { captureKnowledgeEvent } = await import("./knowledge.js");

const NOW = "2026-08-09T12:00:00.000Z";

describe("Wikify knowledge authority races", () => {
	it("fails closed when the knowledge parent swaps during the authority open", () => {
		const projectRoot = fs.mkdtempSync(join(tmpdir(), "litcodex-knowledge-swap-project-"));
		const outsideRoot = fs.mkdtempSync(join(tmpdir(), "litcodex-knowledge-swap-outside-"));
		const knowledgeParent = join(projectRoot, ".litcodex", "knowledge");
		const displacedParent = join(projectRoot, ".litcodex", "knowledge-original");
		const projectClaims = join(knowledgeParent, "claims.jsonl");
		const outsideClaims = join(outsideRoot, "claims.jsonl");
		fs.mkdirSync(knowledgeParent, { recursive: true });
		captureKnowledgeEvent(
			{
				kind: "fact",
				text: "Keep the original knowledge authority inside the project.",
				source: "wikify",
				evidenceRef: "tests/knowledge-parent-seed",
			},
			{ root: projectRoot, now: () => NOW },
		);
		fs.copyFileSync(projectClaims, outsideClaims);
		const outsideBefore = fs.readFileSync(outsideClaims, "utf8");

		let swapped = false;
		openHook.path = join(knowledgeParent, "claims.jsonl");
		openHook.swap = () => {
			swapped = true;
			fs.renameSync(knowledgeParent, displacedParent);
			fs.symlinkSync(outsideRoot, knowledgeParent, "dir");
		};

		try {
			let outcome: string | undefined;
			let errorMessage: string | undefined;
			try {
				outcome = captureKnowledgeEvent(
					{
						kind: "decision",
						text: "Reject a knowledge parent swap before persistence.",
						source: "wikify",
						evidenceRef: "tests/knowledge-parent-swap",
					},
					{ root: projectRoot, now: () => NOW },
				).outcome;
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : String(error);
			}

			expect({
				outcome,
				errorMessage,
				outsideWrite: fs.readFileSync(outsideClaims, "utf8") !== outsideBefore,
				swapped,
			}).toEqual({
				outcome: undefined,
				errorMessage: "Knowledge authority parent changed before read.",
				outsideWrite: false,
				swapped: true,
			});
		} finally {
			openHook.path = undefined;
			openHook.swap = undefined;
			fs.rmSync(projectRoot, { recursive: true, force: true });
			fs.rmSync(outsideRoot, { recursive: true, force: true });
		}
	});
});
