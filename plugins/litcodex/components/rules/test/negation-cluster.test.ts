import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { negationClusterFindings, runHumanizerPreToolUse } from "../src/deliverable-hedge-guard.js";

type NegationCase = { readonly id: string; readonly text: string; readonly expect?: "block" | "warn" };
const cases = JSON.parse(readFileSync(new URL("./fixtures/negation-cluster-cases.json", import.meta.url), "utf8")) as {
	readonly blockKo: number;
	readonly blockTotal: number;
	readonly warnTotal: number;
	readonly positive: readonly NegationCase[];
	readonly negative: readonly NegationCase[];
};
const ADVICE = "Say what the thing is first, then add the caveat once.";
const EXAMPLE = "18,420 visits in total, including repeat visits";
const RULES_CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const CLEAN_LEAD = "The library opens at nine on weekdays.";
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), "litcodex-negation-"));
	roots.push(root);
	return root;
}

function caseText(id: string): string {
	const found = [...cases.positive, ...cases.negative].find((item) => item.id === id);
	if (found === undefined) throw new Error(`negation fixture is missing ${id}`);
	return found.text;
}

function patchEvent(root: string, text: string): string {
	const added = `${CLEAN_LEAD}\n\n${text}`
		.split("\n")
		.map((line) => `+${line}`)
		.join("\n");
	return JSON.stringify({
		hook_event_name: "PreToolUse",
		cwd: root,
		tool_name: "apply_patch",
		tool_input: { command: `*** Begin Patch\n*** Add File: report.md\n${added}\n*** End Patch` },
	});
}

type HookFields = Record<string, string | undefined>;

function hookFields(stdout: string): HookFields {
	return (JSON.parse(stdout) as { hookSpecificOutput: HookFields }).hookSpecificOutput;
}

describe("negation-cluster block and warn tiers", () => {
	it("keeps the measured fixture set", () => {
		expect([cases.blockKo, cases.blockTotal, cases.warnTotal]).toEqual([2, 3, 2]);
		expect(cases.positive).toHaveLength(16);
		expect(cases.negative).toHaveLength(18);
		expect(cases.positive.filter((item) => item.expect === "warn").map((item) => item.id)).toEqual([
			"p09-en-rather",
			"p10-mixed",
		]);
	});

	it.each(
		cases.positive.map((item) => [item.id, item.expect, item.text]),
	)("gives positive %s the %s tier", (_id, tier, text) => {
		const hits = negationClusterFindings(text ?? "");
		expect(hits.length).toBeGreaterThan(0);
		for (const hit of hits) expect(hit.rule).toBe("negation-cluster");
		const top = hits.some((hit) => hit.severity === "block") ? "block" : "warn";
		expect(top).toBe(tier);
	});

	it.each(cases.negative.map((item) => [item.id, item.text]))("stays quiet on negative %s", (_id, text) => {
		expect(negationClusterFindings(text)).toEqual([]);
	});

	it("treats tilde fences and an unclosed fence as code, like the detector", () => {
		const negated = "It is not a cache, and it is not a queue either.";
		expect(negationClusterFindings(`${CLEAN_LEAD}\n\n~~~text\n${negated}\n~~~\n`)).toEqual([]);
		expect(negationClusterFindings(`${CLEAN_LEAD}\n\n\`\`\`text\n${negated}\n`)).toEqual([]);
		expect(negationClusterFindings(`\`\`\`\`md\n\`\`\`\n${negated}\n\`\`\`\n\`\`\`\`\n`)).toEqual([]);
		expect(negationClusterFindings(`~~~\ncode\n~~~\n\n${negated}`)).toEqual([
			expect.objectContaining({ line: 5, rule: "negation-cluster" }),
		]);
	});

	it("reports the first line of the flagged block", () => {
		const hits = negationClusterFindings(`${CLEAN_LEAD}\n\n${caseText("p01-visit-count")}`);
		expect(hits).toEqual([expect.objectContaining({ line: 3, rule: "negation-cluster", severity: "block" })]);
	});

	it("counts the reworded forms, so swapping the plain negation does not pass", () => {
		expect(negationClusterFindings("이용자 수로 읽을 수 없음. 고유 방문자 수도 아님.")).toEqual([
			expect.objectContaining({ severity: "block" }),
		]);
		expect(negationClusterFindings("최종 비용으로 보지 않으며 436명을 뜻하지 않습니다.")).toEqual([
			expect.objectContaining({ severity: "block" }),
		]);
		expect(negationClusterFindings("It should not be read as a forecast and does not mean a cost.")).toEqual([
			expect.objectContaining({ severity: "warn" }),
		]);
		expect(negationClusterFindings("18,420회는 방문 횟수 합계이며, 18,420명으로 읽을 수 없습니다.")).toEqual([]);
	});

	it("refuses a write that stacks Korean negations and gives the rewrite advice", () => {
		const root = workspace();
		const output = runHumanizerPreToolUse({
			hook_event_name: "PreToolUse",
			cwd: root,
			tool_name: "write",
			tool_input: { file_path: "report.md", content: `${CLEAN_LEAD}\n\n${caseText("p01-visit-count")}\n` },
		});
		const hook = hookFields(output);
		expect(hook["permissionDecision"]).toBe("deny");
		expect(hook["permissionDecisionReason"]).toContain("negation-cluster (line 3)");
		expect(hook["permissionDecisionReason"]).toContain(ADVICE);
		expect(hook["permissionDecisionReason"]).toContain(EXAMPLE);
		expect(hook["additionalContext"]).toContain("block negation-cluster line 3");
	});

	it("lets a two-negation English paragraph through with an advisory note", () => {
		const root = workspace();
		const output = runHumanizerPreToolUse({
			hook_event_name: "PreToolUse",
			cwd: root,
			tool_name: "write",
			tool_input: { file_path: "report.md", content: `${CLEAN_LEAD}\n\n${caseText("p09-en-rather")}\n` },
		});
		const hook = hookFields(output);
		expect(hook["permissionDecision"]).toBeUndefined();
		expect(hook["additionalContext"]).toContain("block=0");
		expect(hook["additionalContext"]).toContain("warn negation-cluster line 3");
		expect(hook["additionalContext"]).toContain(ADVICE);
	});

	it("skips internal records the guard already exempts", () => {
		const root = workspace();
		const output = runHumanizerPreToolUse({
			hook_event_name: "PreToolUse",
			cwd: root,
			tool_name: "write",
			tool_input: { file_path: "plans/notes.md", content: caseText("p01-visit-count") },
		});
		expect(output).toBe("");
	});

	it("refuses a reworded cluster through the built hook CLI and allows a limitation line", () => {
		const root = workspace();
		const run = (text: string) =>
			spawnSync(process.execPath, [RULES_CLI, "hook", "pre-tool-use-humanizer"], {
				input: patchEvent(root, text),
				encoding: "utf8",
			});
		const reworded = run(caseText("p11-reword-read-as"));
		expect(reworded.status).toBe(0);
		const hook = hookFields(reworded.stdout);
		expect(hook["hookEventName"]).toBe("PreToolUse");
		expect(hook["permissionDecision"]).toBe("deny");
		expect(hook["permissionDecisionReason"]).toContain("negation-cluster");
		expect(hook["permissionDecisionReason"]).toContain(ADVICE);
		expect(hook["permissionDecisionReason"]).toContain(EXAMPLE);

		const limitation = run(caseText("n11-limitation"));
		expect(limitation.status).toBe(0);
		expect(limitation.stdout).not.toContain("negation-cluster");
		expect(limitation.stdout).not.toContain('"deny"');
	});
});

describe("edits keep the fence, quote and paragraph context around the changed lines", () => {
	const FENCED_PATCH_BODY = "@@\n ```python\n+if x is not None and y is not None and z is not None:\n+    pass\n ```";
	const N03_OLD = "방문 횟수입니다.\n\n탑승 건수입니다.";
	const N03_NEW = "방문 횟수는 주민 수가 아닙니다.\n\n탑승 건수는 승객 수가 아닙니다.";

	function decision(root: string, toolName: string, toolInput: Record<string, unknown>): string | undefined {
		const output = runHumanizerPreToolUse({
			hook_event_name: "PreToolUse",
			cwd: root,
			tool_name: toolName,
			tool_input: toolInput,
		});
		return output === "" ? undefined : hookFields(output)["permissionDecision"];
	}

	function patch(root: string, body: string): string | undefined {
		return decision(root, "apply_patch", { command: `*** Begin Patch\n${body}\n*** End Patch` });
	}

	it("allows an apply_patch update inside a fence, with and without the file on disk", () => {
		const root = workspace();
		expect(patch(root, `*** Update File: README.md\n${FENCED_PATCH_BODY}`)).toBeUndefined();
		writeFileSync(join(root, "README.md"), "# Demo\n\n```python\n```\n", "utf8");
		expect(patch(root, `*** Update File: README.md\n${FENCED_PATCH_BODY}`)).toBeUndefined();
	});

	it("reads the fence that opens above the hunk context from the file on disk", () => {
		const root = workspace();
		writeFileSync(join(root, "README.md"), "# Demo\n\n```python\nx = 1\n```\n", "utf8");
		expect(patch(root, "*** Update File: README.md\n@@\n x = 1\n+y = 2  # 아님 아닙니다")).toBeUndefined();
		expect(
			decision(root, "edit", { file_path: "README.md", old_string: "x = 1", new_string: "x = 1  # 아님 아닙니다" }),
		).toBeUndefined();
	});

	it("allows an apply_patch new file whose negations sit in a fence or in separate paragraphs", () => {
		const root = workspace();
		const added = (text: string) =>
			text
				.split("\n")
				.map((line) => `+${line}`)
				.join("\n");
		expect(patch(root, `*** Add File: fenced.md\n${added(caseText("n04-fence"))}`)).toBeUndefined();
		expect(patch(root, `*** Add File: split.md\n${added(caseText("n03-split-paragraphs"))}`)).toBeUndefined();
	});

	it("keeps two patched paragraphs apart across a blank context line and across hunks (n03)", () => {
		const root = workspace();
		const blankContext =
			"*** Update File: stats.md\n@@\n+방문 횟수는 주민 수가 아닙니다.\n \n+탑승 건수는 승객 수가 아닙니다.";
		const twoHunks =
			"*** Update File: stats.md\n@@\n+방문 횟수는 주민 수가 아닙니다.\n@@\n+탑승 건수는 승객 수가 아닙니다.";
		expect(patch(root, blankContext)).toBeUndefined();
		expect(patch(root, twoHunks)).toBeUndefined();
		writeFileSync(join(root, "stats.md"), "# 통계\n\n끝.\n", "utf8");
		expect(patch(root, blankContext)).toBeUndefined();
		// Hunks with only added lines are appended at the end of the file, where they form one paragraph.
		expect(patch(root, twoHunks)).toBe("deny");
	});

	it("allows an Edit that keeps its fence lines unchanged, with and without the file on disk", () => {
		const root = workspace();
		const edit = { file_path: "README.md", old_string: "```\nold\n```", new_string: "```\n# 아님 아닙니다\n```" };
		expect(decision(root, "edit", edit)).toBeUndefined();
		writeFileSync(join(root, "README.md"), "# Demo\n\n```\nold\n```\n", "utf8");
		expect(decision(root, "edit", edit)).toBeUndefined();
	});

	it("allows an Edit of two separate paragraphs (n03), with and without the file on disk", () => {
		const root = workspace();
		const edit = { file_path: "stats.md", old_string: N03_OLD, new_string: N03_NEW };
		expect(decision(root, "edit", edit)).toBeUndefined();
		writeFileSync(join(root, "stats.md"), `# 통계\n\n${N03_OLD}\n`, "utf8");
		expect(decision(root, "edit", edit)).toBeUndefined();
	});

	it("still refuses an Edit or patch that turns a plain paragraph into p01", () => {
		const root = workspace();
		writeFileSync(join(root, "stats.md"), `# 통계\n\n방문 횟수입니다.\n\n끝.\n`, "utf8");
		const p01 = caseText("p01-visit-count");
		expect(decision(root, "edit", { file_path: "stats.md", old_string: "방문 횟수입니다.", new_string: p01 })).toBe(
			"deny",
		);
		expect(patch(root, `*** Update File: stats.md\n@@\n # 통계\n \n-방문 횟수입니다.\n+${p01}`)).toBe("deny");
	});

	it("refuses an edit to the second line of a paragraph whose negations start on the first", () => {
		const root = workspace();
		writeFileSync(join(root, "stats.md"), "# 통계\n\n방문 횟수입니다.\n주민 수가 아님.\n\n끝.\n", "utf8");
		const after = "주민 수가 아님. 전망치도 아님.";
		expect(decision(root, "edit", { file_path: "stats.md", old_string: "주민 수가 아님.", new_string: after })).toBe(
			"deny",
		);
		expect(patch(root, `*** Update File: stats.md\n@@\n 방문 횟수입니다.\n-주민 수가 아님.\n+${after}`)).toBe("deny");
	});

	it("allows an edit to another paragraph of a file that already holds a cluster", () => {
		const root = workspace();
		writeFileSync(
			join(root, "stats.md"),
			"# 통계\n\n방문 횟수입니다.\n주민 수가 아님. 전망치도 아님.\n\n끝.\n",
			"utf8",
		);
		expect(decision(root, "edit", { file_path: "stats.md", old_string: "끝.", new_string: "마침." })).toBeUndefined();
		expect(patch(root, "*** Update File: stats.md\n@@\n \n-끝.\n+마침.")).toBeUndefined();
	});
});

/** A temp project the way Codex sees one: a git work tree whose top is the session project. */
function gitProject(): string {
	const root = workspace();
	const init = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
	if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
	return root;
}

describe("round 3: changed-line filter, cumulative edits and the reported cwd", () => {
	function decision(cwd: string, toolName: string, toolInput: Record<string, unknown>): string | undefined {
		const output = runHumanizerPreToolUse({
			hook_event_name: "PreToolUse",
			cwd,
			tool_name: toolName,
			tool_input: toolInput,
		});
		return output === "" ? undefined : hookFields(output)["permissionDecision"];
	}

	function cliDecision(cwd: string, toolName: string, toolInput: Record<string, unknown>): string {
		const run = spawnSync(process.execPath, [RULES_CLI, "hook", "pre-tool-use-humanizer"], {
			input: JSON.stringify({ hook_event_name: "PreToolUse", cwd, tool_name: toolName, tool_input: toolInput }),
			encoding: "utf8",
		});
		expect(run.status).toBe(0);
		return run.stdout === "" ? "allow" : (hookFields(run.stdout)["permissionDecision"] ?? "allow");
	}

	it("refuses an edit that adds two pledges to a file holding one, and allows an edit between two old pledges", () => {
		const root = workspace();
		writeFileSync(join(root, "a.md"), "이 표는 일반화가 아닙니다.\n\n본문.\n", "utf8");
		const added = "결론이 아닙니다.\n\n순위가 아닙니다.";
		expect(cliDecision(root, "edit", { file_path: "a.md", old_string: "본문.", new_string: added })).toBe("deny");
		expect(
			cliDecision(root, "apply_patch", {
				command: `*** Begin Patch\n*** Update File: a.md\n@@\n \n-본문.\n+결론이 아닙니다.\n+\n+순위가 아닙니다.\n*** End Patch`,
			}),
		).toBe("deny");

		writeFileSync(join(root, "b.md"), "결론이 아닙니다.\n\n중간 문단입니다.\n\n순위가 아닙니다.\n", "utf8");
		const middle = { file_path: "b.md", old_string: "중간 문단입니다.", new_string: "중간 문단을 고쳤습니다." };
		expect(cliDecision(root, "edit", middle)).toBe("allow");
		expect(
			cliDecision(root, "apply_patch", {
				command:
					"*** Begin Patch\n*** Update File: b.md\n@@\n \n-중간 문단입니다.\n+중간 문단을 고쳤습니다.\n*** End Patch",
			}),
		).toBe("allow");
		expect(
			cliDecision(root, "write", {
				file_path: "b.md",
				content: "결론이 아닙니다.\n\n중간 문단을 고쳤습니다.\n\n순위가 아닙니다.\n",
			}),
		).toBe("allow");
	});

	it("applies the entries of an edits list to the file one after another", () => {
		const root = workspace();
		writeFileSync(join(root, "stats.md"), "방문 횟수입니다.\n탑승 건수입니다.\n", "utf8");
		const edits = [
			{ old_string: "방문 횟수입니다.", new_string: "방문 횟수는 주민 수가 아닙니다." },
			{ old_string: "탑승 건수입니다.", new_string: "탑승 건수는 승객 수가 아닙니다." },
		];
		expect(decision(root, "multi_edit", { file_path: "stats.md", edits })).toBe("deny");
		expect(decision(root, "multi_edit", { edits: edits.map((edit) => ({ file_path: "stats.md", ...edit })) })).toBe(
			"deny",
		);
		expect(decision(root, "multi_edit", { file_path: "stats.md", edits: edits.slice(0, 1) })).toBeUndefined();
	});

	it("appends a hunk with only added lines to the file on disk", () => {
		const root = workspace();
		writeFileSync(join(root, "stats.md"), "방문 횟수는 주민 수가 아닙니다.\n", "utf8");
		const body = "*** Begin Patch\n*** Update File: stats.md\n@@\n+탑승 건수는 승객 수가 아닙니다.\n*** End Patch";
		expect(cliDecision(root, "apply_patch", { command: body })).toBe("deny");
		writeFileSync(join(root, "stats.md"), "방문 횟수입니다.\n", "utf8");
		expect(cliDecision(root, "apply_patch", { command: body })).toBe("allow");
	});

	it("judges a deliverable above the reported cwd on its own path, and keeps internal records exempt", () => {
		const root = gitProject();
		const sub = join(root, "sources");
		mkdirSync(sub);
		const p01 = `${CLEAN_LEAD}\n\n${caseText("p01-visit-count")}\n`;
		expect(cliDecision(sub, "write", { file_path: join(root, "report.md"), content: p01 })).toBe("deny");
		expect(cliDecision(sub, "write", { file_path: "../report.md", content: p01 })).toBe("deny");
		const added = p01
			.split("\n")
			.map((line) => `+${line}`)
			.join("\n");
		expect(
			cliDecision(sub, "apply_patch", {
				command: `*** Begin Patch\n*** Add File: ../report.md\n${added}\n*** End Patch`,
			}),
		).toBe("deny");
		writeFileSync(join(root, "report.md"), `${CLEAN_LEAD}\n\n방문 횟수입니다.\n`, "utf8");
		expect(
			cliDecision(sub, "edit", {
				file_path: "../report.md",
				old_string: "방문 횟수입니다.",
				new_string: caseText("p01-visit-count"),
			}),
		).toBe("deny");
		mkdirSync(join(root, "plans"));
		expect(cliDecision(sub, "write", { file_path: join(root, "plans", "notes.md"), content: p01 })).toBe("allow");
		expect(cliDecision(sub, "write", { file_path: "../plans/notes.md", content: p01 })).toBe("allow");
	});
});

describe("round 4: only files inside the session project are judged", () => {
	function cliDecision(cwd: string, toolName: string, toolInput: Record<string, unknown>): string {
		const run = spawnSync(process.execPath, [RULES_CLI, "hook", "pre-tool-use-humanizer"], {
			input: JSON.stringify({ hook_event_name: "PreToolUse", cwd, tool_name: toolName, tool_input: toolInput }),
			encoding: "utf8",
		});
		expect(run.status).toBe(0);
		return run.stdout === "" ? "allow" : (hookFields(run.stdout)["permissionDecision"] ?? "allow");
	}

	const p01 = (): string => `${CLEAN_LEAD}\n\n${caseText("p01-visit-count")}\n`;
	const addFile = (path: string): string =>
		`*** Begin Patch\n*** Add File: ${path}\n${p01()
			.split("\n")
			.map((line) => `+${line}`)
			.join("\n")}\n*** End Patch`;

	it("allows p01 written to host config and temp notes outside the project", () => {
		const outside = workspace();
		const project = gitProject();
		const sub = join(project, "sources");
		mkdirSync(sub);
		// Stand-ins for ~/.codex/AGENTS.md and a /tmp scratch note; the real host config is never touched.
		const hostConfig = join(outside, "home", ".codex", "AGENTS.md");
		mkdirSync(join(outside, "home", ".codex"), { recursive: true });
		const tempNote = join(outside, "tmp", "review-notes.md");
		for (const cwd of [project, sub]) {
			for (const target of [hostConfig, tempNote]) {
				expect(cliDecision(cwd, "write", { file_path: target, content: p01() })).toBe("allow");
				expect(cliDecision(cwd, "apply_patch", { command: addFile(target) })).toBe("allow");
			}
		}
		writeFileSync(hostConfig, `${CLEAN_LEAD}\n\n방문 횟수입니다.\n`, "utf8");
		const edit = { file_path: hostConfig, old_string: "방문 횟수입니다.", new_string: caseText("p01-visit-count") };
		expect(cliDecision(project, "edit", edit)).toBe("allow");
	});

	it("still refuses p01 written from a subfolder cwd to the project top", () => {
		const project = gitProject();
		const sub = join(project, "sources");
		mkdirSync(sub);
		expect(cliDecision(sub, "write", { file_path: join(project, "report.md"), content: p01() })).toBe("deny");
		expect(cliDecision(sub, "write", { file_path: "../report.md", content: p01() })).toBe("deny");
		expect(cliDecision(sub, "apply_patch", { command: addFile("../report.md") })).toBe("deny");
		expect(cliDecision(project, "write", { file_path: "report.md", content: p01() })).toBe("deny");
	});

	it("falls back to the reported cwd when no git work tree sits above it", () => {
		const root = workspace();
		const sub = join(root, "sources");
		mkdirSync(sub);
		expect(cliDecision(sub, "write", { file_path: "../report.md", content: p01() })).toBe("allow");
		expect(cliDecision(sub, "write", { file_path: "deep/report.md", content: p01() })).toBe("deny");
	});
});
