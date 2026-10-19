import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
	HUMANIZER_PROSE_EXTENSIONS,
	type HumanizerFinding,
	type HumanizerHookInput,
	humanizerFailOpenOutput,
	inspectHumanizerText,
	runHumanizerPostToolUse,
	runHumanizerPreToolUse,
} from "../src/deliverable-hedge-guard.js";

const ruleCases = JSON.parse(
	readFileSync(new URL("../../../skills/lit-humanizer/fixtures/rule-cases.json", import.meta.url), "utf8"),
) as {
	positive: Record<string, string>;
	negative: Record<string, string>;
	contextCases: { plainSourceAttached: { text: string; clean: boolean }[] };
};
const BLOCK_TEXT = requiredCase(ruleCases.positive, "en-bold-deliverable-label");
const DETACHED_SOURCE = requiredCase(ruleCases.positive, "en-plain-meta-label");
const PDF_BLOCK_TEXT = requiredCase(ruleCases.positive, "en-ai-self-disclaimer");
const CLEAN_TEXT = requiredCase(ruleCases.negative, "en-bold-deliverable-label");
const tmpRoots: string[] = [];

afterEach(() => {
	for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(): string {
	const path = mkdtempSync(join(tmpdir(), "litcodex-humanizer-hook-"));
	tmpRoots.push(path);
	return path;
}

function requiredCase(cases: Record<string, string>, id: string): string {
	const value = cases[id];
	if (value === undefined) throw new Error(`canonical fixture is missing ${id}`);
	return value;
}

function input(root: string, overrides: Partial<HumanizerHookInput> = {}): HumanizerHookInput {
	return {
		hook_event_name: "PreToolUse",
		cwd: root,
		tool_name: "apply_patch",
		tool_input: { command: `*** Begin Patch\n*** Add File: output.md\n+${CLEAN_TEXT}\n*** End Patch` },
		...overrides,
	};
}

function hookOutput(text: string): {
	hookSpecificOutput: {
		hookEventName: string;
		additionalContext: string;
		permissionDecision?: string;
		permissionDecisionReason?: string;
	};
} {
	return JSON.parse(text) as {
		hookSpecificOutput: {
			hookEventName: string;
			additionalContext: string;
			permissionDecision?: string;
			permissionDecisionReason?: string;
		};
	};
}

const finding = (severity: "block" | "warn"): HumanizerFinding => ({
	line: 1,
	severity,
	rule: severity === "block" ? "en-bold-deliverable-label" : "en-em-dash-cluster",
	excerpt: "example",
});

describe("Lit Humanizer detector parity", () => {
	it("accepts the detector's block exit status and returns the matching rule", () => {
		const findings = inspectHumanizerText(BLOCK_TEXT);
		expect(findings.some((item) => item.rule === "en-bold-deliverable-label" && item.severity === "block")).toBe(
			true,
		);
	});

	it("passes clean prose and the canonical caption attribution exemption", () => {
		expect(inspectHumanizerText(CLEAN_TEXT)).toEqual([]);
		for (const item of ruleCases.contextCases.plainSourceAttached.filter((entry) => entry.clean)) {
			expect(inspectHumanizerText(item.text), item.text).toEqual([]);
		}
	});

	it("still blocks a source label that is detached from a figure or table", () => {
		expect(inspectHumanizerText(DETACHED_SOURCE).some((item) => item.rule === "en-plain-meta-label")).toBe(true);
	});
});

describe("PreToolUse text guard", () => {
	it("denies a block-tier write before the editor runs", () => {
		const root = workspace();
		const pending = input(root, {
			tool_input: { command: `*** Begin Patch\n*** Add File: output.md\n+${BLOCK_TEXT}\n*** End Patch` },
		});
		const output = hookOutput(runHumanizerPreToolUse(pending));
		expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(output.hookSpecificOutput.additionalContext).toContain("en-bold-deliverable-label");
	});

	it("allows clean reader-facing prose", () => {
		const output = runHumanizerPreToolUse(input(workspace()));
		expect(output).toBe("");
	});

	it("keeps warn-tier findings advisory", () => {
		const root = workspace();
		const pending = input(root);
		const output = hookOutput(runHumanizerPreToolUse(pending, { scan: () => [finding("warn")] }));
		expect(output.hookSpecificOutput.additionalContext).toContain("warn en-em-dash-cluster");
		expect(output.hookSpecificOutput.permissionDecision).toBeUndefined();
	});

	it("scans only added lines in an existing target", () => {
		const root = workspace();
		writeFileSync(join(root, "output.md"), "Existing clean paragraph.\n", "utf8");
		const output = hookOutput(
			runHumanizerPreToolUse(
				input(root, {
					tool_name: "write",
					tool_input: { file_path: "output.md", content: `Existing clean paragraph.\n${BLOCK_TEXT}\n` },
				}),
			),
		);
		expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
	});

	it("does not rescan unchanged old text", () => {
		const root = workspace();
		writeFileSync(join(root, "output.md"), `${BLOCK_TEXT}\n`, "utf8");
		expect(
			runHumanizerPreToolUse(
				input(root, { tool_name: "write", tool_input: { file_path: "output.md", content: `${BLOCK_TEXT}\n` } }),
			),
		).toBe("");
	});

	it("scans an edit's replacement text and only added apply_patch lines", () => {
		const root = workspace();
		const edit = input(root, {
			tool_name: "edit",
			tool_input: { path: "output.md", old_string: "old", new_string: BLOCK_TEXT },
		});
		expect(hookOutput(runHumanizerPreToolUse(edit)).hookSpecificOutput.permissionDecision).toBe("deny");
		const patch = input(root, {
			tool_input: {
				command: `*** Begin Patch\n*** Update File: output.md\n@@\n context line\n-${CLEAN_TEXT}\n+${BLOCK_TEXT}\n*** End Patch`,
			},
		});
		expect(hookOutput(runHumanizerPreToolUse(patch)).hookSpecificOutput.permissionDecision).toBe("deny");
	});

	it("denies a readable Bash heredoc before the command writes it", () => {
		const command = `cat > report.md <<'EOF'\n${BLOCK_TEXT}\nEOF`;
		const pending = input(workspace(), { tool_name: "Bash", tool_input: { command } });
		expect(hookOutput(runHumanizerPreToolUse(pending)).hookSpecificOutput.permissionDecision).toBe("deny");
	});

	it("shows the fail-open note when a script write cannot be inspected before execution", () => {
		const pending = input(workspace(), {
			tool_name: "Bash",
			tool_input: { command: "python3 make_report.py --output report.md" },
		});
		expect(hookOutput(runHumanizerPreToolUse(pending)).hookSpecificOutput.additionalContext).toContain(
			"the write was allowed",
		);
	});

	it("ignores user quotations, blockquotes, inline code, and fenced code", () => {
		const quoted = [
			`User excerpt: "${BLOCK_TEXT}"`,
			`> ${BLOCK_TEXT}`,
			`Inline example: \`${BLOCK_TEXT}\``,
			"```text",
			BLOCK_TEXT,
			"```",
		].join("\n");
		expect(
			runHumanizerPreToolUse(
				input(workspace(), { tool_name: "write", tool_input: { file_path: "output.md", content: quoted } }),
			),
		).toBe("");
	});

	it("skips internal work paths", () => {
		let scans = 0;
		const pending = input(workspace(), {
			tool_name: "write",
			tool_input: { file_path: "plans/research.md", content: BLOCK_TEXT },
		});
		expect(
			runHumanizerPreToolUse(pending, {
				scan: () => {
					scans += 1;
					return [finding("block")];
				},
			}),
		).toBe("");
		expect(scans).toBe(0);
	});

	it("fails open with one visible note on detector errors", () => {
		const pending = input(workspace());
		const output = hookOutput(
			runHumanizerPreToolUse(pending, {
				scan: () => {
					throw new Error("offline");
				},
			}),
		);
		expect(output.hookSpecificOutput.permissionDecision).toBeUndefined();
		expect(output.hookSpecificOutput.additionalContext).toBe(
			hookOutput(humanizerFailOpenOutput("PreToolUse")).hookSpecificOutput.additionalContext,
		);
	});
});

describe("prose-only pre-write scope", () => {
	const write = (root: string, path: string, content: string): HumanizerHookInput =>
		input(root, { tool_name: "write", tool_input: { file_path: path, content } });

	it("pins the prose formats that block-tier rules apply to", () => {
		expect([...HUMANIZER_PROSE_EXTENSIONS].sort()).toEqual([
			".adoc",
			".html",
			".markdown",
			".md",
			".mdx",
			".rst",
			".tex",
			".txt",
		]);
	});

	it("denies a block hit in every prose format", () => {
		for (const extension of HUMANIZER_PROSE_EXTENSIONS) {
			const output = runHumanizerPreToolUse(write(workspace(), `report${extension}`, BLOCK_TEXT), {
				scan: () => [finding("block")],
			});
			expect(hookOutput(output).hookSpecificOutput.permissionDecision, extension).toBe("deny");
		}
	});

	it("keeps code and data files out of the prose rules", () => {
		for (const extension of [
			".c",
			".css",
			".csv",
			".go",
			".java",
			".js",
			".json",
			".jsonc",
			".mjs",
			".py",
			".rb",
			".rs",
			".sh",
			".sql",
			".svg",
			".toml",
			".ts",
			".tsx",
			".xml",
			".yaml",
			".yml",
		]) {
			const output = runHumanizerPreToolUse(write(workspace(), `data${extension}`, BLOCK_TEXT), {
				scan: () => [finding("block")],
			});
			expect(output, extension).toBe("");
		}
	});

	it("lets a YAML `source:` key and a docstring `Source:` line through with the real detector", () => {
		const root = workspace();
		const yaml = "spec:\n  source:\n    repoURL: https://example.invalid/app.git\nprovenance: true\nevidence: logs\n";
		expect(runHumanizerPreToolUse(write(root, "app.yaml", yaml))).toBe("");
		const python =
			'def load():\n    """Load the rows.\n\n    Source: annual report, table 4.\n    Limitations: none.\n    """\n';
		expect(runHumanizerPreToolUse(write(root, "load.py", python))).toBe("");
		expect(
			hookOutput(runHumanizerPreToolUse(write(root, "notes.md", DETACHED_SOURCE))).hookSpecificOutput
				.permissionDecision,
		).toBe("deny");
	});
});

describe("PostToolUse document guard", () => {
	it("checks generated Bash text after creation when its output path is explicit", () => {
		const root = workspace();
		writeFileSync(join(root, "report.md"), BLOCK_TEXT, "utf8");
		const post: HumanizerHookInput = {
			hook_event_name: "PostToolUse",
			cwd: root,
			tool_name: "Bash",
			tool_input: { command: "python3 make_report.py --output report.md" },
		};
		const output = hookOutput(runHumanizerPostToolUse(post));
		expect(output.hookSpecificOutput.additionalContext).toContain(
			"Fix the changed passages and rebuild the artifact.",
		);
	});

	it("extracts both Office formats, then asks for a rebuild on a block hit", () => {
		const root = workspace();
		const office = join(root, "office");
		mkdirSync(office);
		const docx = join(office, "sample.docx");
		const pptx = join(office, "sample.pptx");
		copyFileSync(new URL("../../../skills/lit-humanizer/fixtures/office/minimal.docx", import.meta.url), docx);
		copyFileSync(new URL("../../../skills/lit-humanizer/fixtures/office/minimal.pptx", import.meta.url), pptx);
		let inspected = 0;
		const post: HumanizerHookInput = {
			hook_event_name: "PostToolUse",
			cwd: root,
			tool_name: "write",
			tool_input: { files: [{ path: "office/sample.docx" }, { path: "office/sample.pptx" }] },
		};
		const output = hookOutput(
			runHumanizerPostToolUse(post, {
				scan: (text) => {
					expect(text.length).toBeGreaterThan(0);
					inspected += 1;
					return [finding("block")];
				},
			}),
		);
		expect(inspected).toBe(1);
		expect(output.hookSpecificOutput.additionalContext).toContain(
			"Fix the changed passages and rebuild the artifact.",
		);
	});

	it.runIf(spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).error === undefined)(
		"extracts PDF text when the host provides pdftotext",
		() => {
			const root = workspace();
			const pdf = join(root, "sample.pdf");
			writeFileSync(pdf, minimalPdf(PDF_BLOCK_TEXT), "binary");
			const post: HumanizerHookInput = {
				hook_event_name: "PostToolUse",
				cwd: root,
				tool_name: "write",
				tool_input: { file_path: "sample.pdf" },
			};
			const output = hookOutput(runHumanizerPostToolUse(post));
			expect(output.hookSpecificOutput.additionalContext).toContain(
				"Fix the changed passages and rebuild the artifact.",
			);
		},
	);

	it("fails open visibly when document extraction fails", () => {
		const root = workspace();
		const docx = join(root, "broken.docx");
		writeFileSync(docx, "not a document", "utf8");
		const post: HumanizerHookInput = {
			hook_event_name: "PostToolUse",
			cwd: root,
			tool_name: "write",
			tool_input: { file_path: docx },
		};
		expect(hookOutput(runHumanizerPostToolUse(post)).hookSpecificOutput.additionalContext).toContain(
			"the text check could not complete",
		);
	});
});

type PledgeCases = {
	new_rule_ids: string[];
	pledges: { n: number; text: string; rule: string; severity: "block" | "warn" | "none" }[];
	pledges_observed: { source: string; text: string; rule: string; severity: "block" | "warn" | "none" }[];
	near_misses: { source: string; text: string }[];
	near_misses_review: { source: string; text: string }[];
	document_cases: { text: string; rule: string; expect: "block" | "clean" }[];
};
const pledgeCases = JSON.parse(
	readFileSync(new URL("../../../skills/lit-humanizer/fixtures/pledge-cases.json", import.meta.url), "utf8"),
) as PledgeCases;
const PLEDGE_RULE_IDS = new Set(pledgeCases.new_rule_ids);
const SEVERITY_RANK = { none: 0, warn: 1, block: 2 } as const;
const USER_PLEDGE = "동일 조건의 독립 성능 비교로 쓰지 않음.";
const CALLOUT_PLEDGE = "> **주의:** 이 표는 순위가 아닙니다.";
const PLAIN_QUOTE_PLEDGE = "> 이 표는 순위가 아닙니다.";
const OPERATING_RULES = "이 장비는 방폭 구역에서 사용하지 않습니다. 냉각수로 쓰지 않음. 한 번에 0.1 이상 바꾸지 않음.";

function pledgeRuleHits(text: string): HumanizerFinding[] {
	return inspectHumanizerText(text).filter((item) => PLEDGE_RULE_IDS.has(item.rule));
}

function writeEvent(root: string, path: string, content: string): HumanizerHookInput {
	return input(root, { tool_name: "write", tool_input: { file_path: path, content } });
}

describe("negative pledge sentences", () => {
	it("keeps the fixture set the size the rules were measured against", () => {
		expect(pledgeCases.new_rule_ids).toEqual([
			"ko-negative-pledge",
			"ko-negative-pledge-repeat",
			"en-negative-pledge",
		]);
		expect(pledgeCases.pledges).toHaveLength(15);
		expect(pledgeCases.pledges_observed).toHaveLength(26);
		expect(pledgeCases.near_misses.length).toBeGreaterThanOrEqual(27);
		expect(pledgeCases.near_misses_review.length).toBeGreaterThanOrEqual(215);
		expect(pledgeCases.document_cases).toHaveLength(13);
		expect(pledgeCases.pledges[0]?.text).toBe(USER_PLEDGE);
	});

	it("refuses the user's example sentence at the write guard and names the rule", () => {
		const root = workspace();
		const refused = hookOutput(runHumanizerPreToolUse(writeEvent(root, "report.md", USER_PLEDGE)));
		expect(refused.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(refused.hookSpecificOutput.additionalContext).toContain("block ko-negative-pledge");
		const patched = hookOutput(
			runHumanizerPreToolUse(
				input(root, {
					tool_input: { command: `*** Begin Patch\n*** Add File: deck.md\n+${USER_PLEDGE}\n*** End Patch` },
				}),
			),
		);
		expect(patched.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(patched.hookSpecificOutput.additionalContext).toContain("block ko-negative-pledge");
	});

	it("names the rule ids and line numbers in the refusal reason, not only a count", () => {
		const root = workspace();
		const reason = (text: string): string =>
			hookOutput(runHumanizerPreToolUse(writeEvent(root, "report.md", text))).hookSpecificOutput
				.permissionDecisionReason ?? "";
		const single = reason(`# 보고서\n${USER_PLEDGE}`);
		expect(single).toContain("ko-negative-pledge");
		expect(single).toMatch(/line 2\b/u);
		const flood = reason(Array.from({ length: 40 }, () => USER_PLEDGE).join("\n"));
		expect(flood).toContain("ko-negative-pledge");
		expect(flood.length).toBeLessThan(400);
		expect(flood.match(/ko-negative-pledge\b/gu)).toHaveLength(1);
	});

	it("lets an operating-rules document through, as sentences and as a bullet list", () => {
		const root = workspace();
		const bullets = OPERATING_RULES.split(/(?<=[.])\s+/u)
			.map((line) => `- ${line}`)
			.join("\n");
		for (const text of [OPERATING_RULES, bullets]) {
			const output = runHumanizerPreToolUse(writeEvent(root, "manual.md", text));
			const decision = output === "" ? undefined : hookOutput(output).hookSpecificOutput.permissionDecision;
			expect(decision, text).toBeUndefined();
			expect(output, text).not.toContain("negative-pledge");
		}
	});

	it("refuses an edit that adds a pledge and judges only the changed text on a file that already has one", () => {
		const root = workspace();
		const edit = input(root, {
			tool_name: "edit",
			tool_input: { path: "report.md", old_string: "처리량은 두 배가 되었다.", new_string: USER_PLEDGE },
		});
		expect(hookOutput(runHumanizerPreToolUse(edit)).hookSpecificOutput.permissionDecision).toBe("deny");
		writeFileSync(join(root, "kept.md"), `${USER_PLEDGE}\n`, "utf8");
		expect(runHumanizerPreToolUse(writeEvent(root, "kept.md", `${USER_PLEDGE}\n처리량은 두 배가 되었다.\n`))).toBe(
			"",
		);
		const second = writeEvent(root, "kept.md", `${USER_PLEDGE}\n이 수치는 투자 권유로 해석하지 말 것.\n`);
		const refused = hookOutput(runHumanizerPreToolUse(second));
		expect(refused.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(refused.hookSpecificOutput.additionalContext).toContain("block ko-negative-pledge");
	});

	it("still refuses the pledge when the same write also holds a long run of padding after an emphasis-prone word", () => {
		const root = workspace();
		const padded = [`${USER_PLEDGE}\n검증된${" ".repeat(4096)}x`, `${USER_PLEDGE}\n해석하지${" ".repeat(65536)}x`];
		for (const content of padded) {
			const started = Date.now();
			const output = runHumanizerPreToolUse(writeEvent(root, "padded.md", content));
			const elapsed = Date.now() - started;
			const refused = hookOutput(output);
			expect(refused.hookSpecificOutput.permissionDecision, `padding ${content.length}`).toBe("deny");
			expect(refused.hookSpecificOutput.additionalContext).toContain("block ko-negative-pledge");
			expect(elapsed, `padding ${content.length} took ${elapsed} ms`).toBeLessThan(1000);
		}
	});

	it("refuses a widened pledge at the write guard, in Korean and in English", () => {
		const root = workspace();
		for (const [text, rule] of [
			["이 문서는 제품을 비교하려는 것이 아닙니다.", "ko-negative-pledge"],
			["This table is not a ranking.", "en-negative-pledge"],
		] as const) {
			const refused = hookOutput(runHumanizerPreToolUse(writeEvent(root, "report.md", text)));
			expect(refused.hookSpecificOutput.permissionDecision, text).toBe("deny");
			expect(refused.hookSpecificOutput.permissionDecisionReason, text).toContain(rule);
		}
	});

	it("reads a bold-label callout at the write guard and still ignores a plain quote", () => {
		const root = workspace();
		const callout = hookOutput(
			runHumanizerPreToolUse(writeEvent(root, "report.md", `# 보고서\n\n${CALLOUT_PLEDGE}\n`)),
		);
		expect(callout.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(callout.hookSpecificOutput.permissionDecisionReason).toContain("ko-negative-pledge (line 3)");
		const patched = hookOutput(
			runHumanizerPreToolUse(
				input(root, {
					tool_input: { command: `*** Begin Patch\n*** Add File: deck.md\n+${CALLOUT_PLEDGE}\n*** End Patch` },
				}),
			),
		);
		expect(patched.hookSpecificOutput.permissionDecision).toBe("deny");
		const plain = runHumanizerPreToolUse(writeEvent(root, "report.md", `${PLAIN_QUOTE_PLEDGE}\n`));
		expect(plain === "" ? undefined : hookOutput(plain).hookSpecificOutput.permissionDecision).toBeUndefined();
		expect(plain).not.toContain("negative-pledge");
	});

	it("lets reviewed false positives through the write guard", () => {
		const root = workspace();
		for (const text of [
			"숫자와 문자열은 서로 비교할 수 없습니다.",
			"Do not compare these values directly; convert to SI first.",
		]) {
			const output = runHumanizerPreToolUse(writeEvent(root, "manual.md", text));
			expect(
				output === "" ? undefined : hookOutput(output).hookSpecificOutput.permissionDecision,
				text,
			).toBeUndefined();
			expect(output, text).not.toContain("negative-pledge");
		}
	});

	it("gives every pledge, and every pledge seen in model output, its expected rule at its expected severity", () => {
		const judged = [
			...pledgeCases.pledges.map((pledge) => ({ label: `pledge ${pledge.n}`, ...pledge })),
			...pledgeCases.pledges_observed.map((pledge) => ({ label: `observed ${pledge.source}`, ...pledge })),
		];
		for (const pledge of judged) {
			const findings = inspectHumanizerText(pledge.text);
			const top = findings.reduce((best, item) => Math.max(best, SEVERITY_RANK[item.severity]), 0);
			if (pledge.severity === "none") {
				expect(findings, pledge.label).toEqual([]);
				continue;
			}
			expect(top, `${pledge.label} top severity`).toBe(SEVERITY_RANK[pledge.severity]);
			expect(
				findings.some((item) => item.rule === pledge.rule && item.severity === pledge.severity),
				`${pledge.label} ${pledge.rule}`,
			).toBe(true);
		}
	});

	it("leaves every near-miss clear of the three pledge rules, each scanned as its own document", () => {
		for (const nearMiss of [...pledgeCases.near_misses, ...pledgeCases.near_misses_review]) {
			expect(pledgeRuleHits(nearMiss.text), `${nearMiss.source}: ${nearMiss.text}`).toEqual([]);
		}
	}, 120_000);

	it("judges whole-document cases for the repeat rule and the block rules", () => {
		for (const item of pledgeCases.document_cases) {
			const blocked = inspectHumanizerText(item.text).some(
				(finding) => finding.rule === item.rule && finding.severity === "block",
			);
			expect(blocked, `${item.rule}: ${JSON.stringify(item.text)}`).toBe(item.expect === "block");
		}
	});
});

/** The block tier as reviewed; a rule leaves it only through an edit to this list, never silently. */
const BLOCK_TIER = [
	"ko-bold-deliverable-label",
	"en-bold-deliverable-label",
	"ko-plain-meta-label",
	"en-plain-meta-label",
	"ko-stacked-limitation-chain",
	"en-stacked-limitation-chain",
	"en-knowledge-cutoff",
	"en-ai-self-disclaimer",
	"en-hope-helps",
	"ko-chatbot-signoff",
	"workflow-jargon",
	"ko-workflow-jargon",
	"code-ai-attribution",
	"en-lets-dive",
	"en-demo-self-disclaimer",
	"ko-bracket-status-tag",
	"en-bracket-status-tag",
	"ko-standalone-scope-disclaimer",
	"en-standalone-scope-disclaimer",
	"ko-chatbot-opener",
	"en-chatbot-opener",
	"en-testament",
	"en-left-in-narration",
	"en-chatbot-closer",
	"ko-negative-pledge",
	"ko-negative-pledge-repeat",
	"en-negative-pledge",
];
const RULES_CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

describe("block tier at the write guard", () => {
	it("keeps every reviewed block rule at block severity in the bundled rules", () => {
		const bundled = JSON.parse(
			readFileSync(new URL("../../../skills/lit-humanizer/rules.json", import.meta.url), "utf8"),
		) as { rules?: { id: string; severity: string }[] } | { id: string; severity: string }[];
		const rules = Array.isArray(bundled) ? bundled : (bundled.rules ?? []);
		expect(rules.filter((rule) => rule.severity === "block").map((rule) => rule.id)).toEqual(BLOCK_TIER);
	});

	it("refuses each block rule's own positive fixture and names that rule", () => {
		const root = workspace();
		for (const id of BLOCK_TIER) {
			const output = runHumanizerPreToolUse(
				input(root, {
					tool_name: "write",
					tool_input: { file_path: "report.md", content: requiredCase(ruleCases.positive, id) },
				}),
			);
			const refused = hookOutput(output).hookSpecificOutput;
			expect(refused.permissionDecision, id).toBe("deny");
			expect(refused.permissionDecisionReason, id).toContain(`${id} (line`);
		}
	});

	it("reads each entry of a multi_edit edits list", () => {
		const root = workspace();
		const output = runHumanizerPreToolUse(
			input(root, {
				tool_name: "multi_edit",
				tool_input: {
					file_path: "report.md",
					edits: [
						{ old_string: "a", new_string: "처리량은 두 배가 되었다." },
						{ old_string: "b", new_string: USER_PLEDGE },
					],
				},
			}),
		);
		expect(hookOutput(output).hookSpecificOutput.permissionDecision).toBe("deny");
		expect(hookOutput(output).hookSpecificOutput.permissionDecisionReason).toContain("ko-negative-pledge");
	});

	it("skips a target outside the session project, which is the reported cwd when no git work tree is above it", () => {
		const root = workspace();
		const output = runHumanizerPreToolUse(
			input(root, { tool_name: "write", tool_input: { file_path: "../outside-report.md", content: USER_PLEDGE } }),
		);
		expect(output).toBe("");
	});

	it("answers an oversized hook payload with the visible fail-open note, not silence", () => {
		const root = workspace();
		const event = JSON.stringify(writeEvent(root, "report.md", `${USER_PLEDGE}\n${"x".repeat(6 * 1024 * 1024)}`));
		const run = spawnSync(process.execPath, [RULES_CLI, "hook", "pre-tool-use-humanizer"], {
			input: event,
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
		});
		expect(run.status).toBe(0);
		expect(run.stdout).toBe(humanizerFailOpenOutput("PreToolUse"));
	});
});

function minimalPdf(text: string): string {
	const stream = `BT /F1 12 Tf 20 80 Td (${text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, body] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf, "binary"));
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	}
	const xref = Buffer.byteLength(pdf, "binary");
	pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
		.join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return pdf;
}
