import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GOAL_STATUS, goalCommand } from "./goal-pipeline.js";
import { runUserPromptSubmitHookCli } from "./hook-cli.js";
import { ROUTE_HEADS } from "./route-heads.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-goalguide-")));
	roots.push(root);
	return root;
}

/** A plan whose `## Done when` check (`node fail.mjs`) really fails now, so `goal propose` asks with a goal. */
function planProject(check = "node fail.mjs"): string {
	const root = tempRoot();
	mkdirSync(join(root, ".litcodex", "plans"), { recursive: true });
	writeFileSync(join(root, "fail.mjs"), "process.exit(1);\n");
	writeFileSync(
		join(root, ".litcodex", "plans", "retry.md"),
		[
			"# Retry fix",
			"",
			"## Todos",
			"- [ ] 1. Add the failing test",
			"",
			"## Done when",
			`- check: \`${check}\``,
			"",
		].join("\n"),
	);
	return root;
}

function propose(cwd: string, argv: readonly string[]): string {
	let out = "";
	const sink = new PassThrough();
	sink.on("data", (chunk) => {
		out += chunk.toString();
	});
	expect(goalCommand(argv, { stdout: sink, stderr: sink, cwd })).toBe(0);
	return out;
}

describe("goal question answer guide", () => {
	it("Given a plan with a failing check, When `goal propose` runs, Then the unchanged question is followed by a three-row Markdown guide", () => {
		const out = propose(planProject(), ["propose", ".litcodex/plans/retry.md"]);
		const [question, blank, ...guide] = out.trimEnd().split("\n");
		expect(question).toMatch(
			/^Approve plan, start work and set goal: \/goal Every row in .+ \(yes \/ edit \/ no\)$/u,
		);
		expect(blank).toBe("");
		expect(guide).toEqual([
			"> **▶ Answer: approve plan · start work · set goal**",
			">",
			`> Goal: \`\` /goal ${question?.slice("Approve plan, start work and set goal: /goal ".length, -"? (yes / edit / no)".length)} \`\``,
			">",
			"> | Type | What happens |",
			"> |---|---|",
			"> | **`yes`** | Starts the work now and has Codex set this goal |",
			"> | **`edit`** | Change the goal's check first; nothing starts yet |",
			"> | **`no`** | Nothing starts |",
			">",
			"> Type the word alone.",
		]);
	});

	it("Given a plan with no usable goal, When `goal propose` runs, Then the start-only question gets a two-row guide and no Goal line", () => {
		const out = propose(planProject("it works"), ["propose", ".litcodex/plans/retry.md"]);
		const lines = out.trimEnd().split("\n");
		expect(lines[0]?.startsWith("No goal set: ")).toBe(true);
		expect(lines[1]).toBe(GOAL_STATUS.askStart);
		expect(lines.slice(2)).toEqual([
			"",
			"> **▶ Answer: approve plan · start work**",
			">",
			"> | Type | What happens |",
			"> |---|---|",
			"> | **`yes`** | Starts the work now, with no goal |",
			"> | **`no`** | Nothing starts |",
			">",
			"> Type the word alone.",
		]);
	});

	it("Given a refused plan path, When `goal propose` runs, Then only the reason prints and no guide follows", () => {
		expect(propose(planProject(), ["propose", "../elsewhere.md"])).toMatch(/^No goal set: [^\n]*\n$/u);
	});

	it("Given a failing loop check, When `goal propose --loop` runs, Then the loop question gets a two-row Markdown guide", () => {
		const cwd = tempRoot();
		writeFileSync(join(cwd, "fail.mjs"), "process.exit(1);\n");
		const out = propose(cwd, ["propose", "--loop", "--check", "node fail.mjs", "fix", "the", "retry", "bug"]);
		const lines = out.trimEnd().split("\n");
		expect(lines[0]).toMatch(/^Set goal for this lit-loop: \/goal `node fail\.mjs` exits 0 .+\? \(yes \/ no\)$/u);
		expect(lines).toContain("> **▶ Answer: set goal for this lit-loop**");
		expect(lines).toContain("> | **`yes`** | Has Codex set this goal now; the loop keeps going |");
		expect(lines).toContain("> | **`no`** | Keep working without a goal |");
		expect(lines.at(-1)).toBe("> Type the word alone.");
	});

	it("Given a lit-loop prompt in a project with tests, When the prompt hook fires, Then its systemMessage shows the plain guide under the question", async () => {
		const cwd = tempRoot();
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
		const home = join(cwd, ".home");
		mkdirSync(home, { recursive: true });
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		let out = "";
		stdout.on("data", (chunk) => {
			out += chunk.toString();
		});
		stdin.end(
			JSON.stringify({
				hook_event_name: "UserPromptSubmit",
				session_id: "guide-s1",
				turn_id: "t1",
				cwd,
				prompt: "lit-loop fix the retry bug",
			}),
		);
		await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), cwd, { env: { CODEX_HOME: home } });
		const message = (JSON.parse(out) as { systemMessage: string }).systemMessage;
		const lines = message.split("\n");
		const at = lines.findIndex((line) => line.startsWith("Set goal for this lit-loop: /goal "));
		expect(at).toBeGreaterThan(-1);
		const guide = lines.findIndex((line) => line.startsWith("  yes "));
		// The question is broken between words for a narrow pane; the guide stands right under its end.
		expect(lines.slice(at, guide).join(" ")).toMatch(/^Set goal for this lit-loop: .+\? \(yes \/ no\)$/u);
		expect(lines.slice(guide, guide + 4)).toEqual([
			"  yes  → set this goal now; the loop keeps",
			"         going",
			"  no   → keep working without a goal",
			"  Type the word alone.",
		]);
		expect(message).not.toContain("**");
		expect(message).not.toContain("|---|");
	});

	it("Given the lit-plan route and skills, When the model reads them, Then they tell it to keep the guide under the question and translate only the explanation", () => {
		const skill = (id: string): string =>
			readFileSync(fileURLToPath(new URL(`../../../skills/${id}/SKILL.md`, import.meta.url)), "utf8").replace(
				/\s+/gu,
				" ",
			);
		const head = ROUTE_HEADS["lit-plan"].replace(/\s+/gu, " ");
		for (const text of [head, skill("lit-plan"), skill("lit-loop")]) {
			expect(text).toContain("answer guide");
			expect(text).toContain("user's language");
			expect(text).toMatch(/answer words? (?:stay|exactly)/u);
		}
	});
});
