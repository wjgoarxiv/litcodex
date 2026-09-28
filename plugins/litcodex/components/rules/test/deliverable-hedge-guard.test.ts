import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
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
	hookSpecificOutput: { hookEventName: string; additionalContext: string; permissionDecision?: string };
} {
	return JSON.parse(text) as {
		hookSpecificOutput: { hookEventName: string; additionalContext: string; permissionDecision?: string };
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
