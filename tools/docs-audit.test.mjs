// tools/docs-audit.test.mjs — T27 docs & workflow completeness audit suite (node --test).
//
// RED -> GREEN gate for plan todo T27. T21 shipped tools/readme-audit.mjs auditing README.md only.
// T27 BROADENS the `docs:audit` gate to EVERY user-facing doc (README, SKILL.md +
// references/full-workflow.md, docs/spec/litcodex-contract.md, docs/reference-analysis.md, the
// release docs, the lit-loop directive) so no doc drifts from the REAL command surface: every
// documented `litcodex …` command must map to a real route (install/doctor/uninstall/config
// migrate/hook user-prompt-submit + the M09 LOOP_SUBCOMMANDS) OR be an explicitly-marked
// negative/example, and NO doc may use the wrong loop verb `litcodex lit-loop`.
//
// The M04 bounded matcher is reused (via tools/readme-audit.mjs findBoundedToken) so "docs clean ⇔
// scanner clean". Legacy tokens used as injection inputs are assembled from fragments so this file
// carries no standalone literal — the M04 scanner stays exit 0 with no allowlist entry needed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { isExactBareHandoffPrompt } from "@litcodex/lit-loop/dist/handoff-route.js";
import { LOOP_SUBCOMMANDS } from "@litcodex/lit-loop/dist/loop-cli.js";
import { modeForToken } from "@litcodex/lit-loop/dist/modes.js";
import { isExactBareScientificVisualizationPrompt } from "@litcodex/lit-loop/dist/scientific-visualization-route.js";
import { LIT_TRIGGER_TOKENS, matchLitTrigger } from "@litcodex/lit-loop/dist/trigger.js";
import { auditCommandSurface, auditDoc, loadRepoFacts, USER_FACING_DOCS } from "./docs-audit.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..");
const AUDIT = join(HERE, "docs-audit.mjs");

const EVIDENCE_DIR = mkdtempSync(join(tmpdir(), "litcodex-docs-audit-evidence-"));
mkdirSync(EVIDENCE_DIR, { recursive: true });
after(() => rmSync(EVIDENCE_DIR, { recursive: true, force: true }));
function evidence(name, body) {
	writeFileSync(join(EVIDENCE_DIR, name), `${body}\n`);
}

// Wrong loop verb assembled from fragments so this file carries no standalone command literal.
const WRONG_VERB = ["litcodex", "lit-loop"].join(" ");

function runAuditCli(args = [], opts = {}) {
	try {
		const stdout = execFileSync("node", [AUDIT, ...args], { cwd: REPO_ROOT, encoding: "utf8", ...opts });
		return { code: 0, stdout, stderr: "" };
	} catch (err) {
		return {
			code: typeof err.status === "number" ? err.status : 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

function documentedModeForms(text, mode) {
	const row = text.split(/\r?\n/).find((line) => line.includes(`| **${mode}** |`));
	assert.ok(row, `README route table must contain the ${mode} mode`);
	const inputCell = row.split("|")[1] ?? "";
	return [...inputCell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function hookRouteForms(mode) {
	assert.ok(LIT_TRIGGER_TOKENS.includes(mode), `${mode} must be a canonical hook token`);
	const litPrefix = LIT_TRIGGER_TOKENS.at(-1);
	assert.equal(litPrefix, "lit", "shortest canonical hook token remains the natural-route prefix");
	const candidates = [mode, `/${mode}`, `${litPrefix} ${mode.slice(litPrefix.length)}`];
	return candidates.filter((form) => matchLitTrigger(`${form} route-fact-probe`)?.token === mode);
}

function documentedRouteRows(text) {
	return text
		.split(/\r?\n/)
		.map((line) => {
			const cells = line.split("|");
			const mode = /^\s*\*\*([^*]+)\*\*\s*$/.exec(cells[2] ?? "")?.[1];
			if (mode === undefined) return null;
			const forms = [...(cells[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
			return { mode: mode.toLowerCase().replaceAll(" ", "-"), forms };
		})
		.filter((row) => row !== null);
}

function hookModeForForm(form) {
	if (isExactBareHandoffPrompt(form)) return "lit-handoff";
	if (isExactBareScientificVisualizationPrompt(form)) return "lit-scientific-visualization";
	const match = matchLitTrigger(form);
	return match === null ? null : modeForToken(match.token).mode;
}

describe("docs-audit command surface (pure)", () => {
	test("real routes pass", () => {
		const text = [
			"```sh",
			"litcodex install",
			"litcodex doctor",
			"litcodex uninstall",
			"litcodex config migrate",
			"litcodex hook user-prompt-submit",
			"litcodex motion-runtime install",
			"litcodex motion-runtime install --word-timing",
			"litcodex motion-runtime status",
			"litcodex loop create",
			"litcodex loop run",
			"litcodex loop status --json",
			"litcodex loop checkpoint",
			"litcodex loop record-evidence",
			"litcodex loop doctor",
			"litcodex loop help",
			"```",
		].join("\n");
		const report = auditCommandSurface(text);
		assert.deepEqual(report.offenders, []);
		evidence("task-27-surface-real.txt", "all real routes accepted\nSTATUS: PASS");
	});

	test("fake top-level command fails", () => {
		const report = auditCommandSurface("Run `litcodex foo-bar` to start.");
		const hit = report.offenders.find((o) => o.kind === "unknown-command" && o.value.includes("foo-bar"));
		assert.ok(hit, "fake litcodex foo-bar flagged");
		assert.ok(typeof hit.line === "number" && hit.line > 0);
		evidence("task-27-surface-fake-top.txt", `flagged ${hit.value}\nSTATUS: PASS`);
	});

	test("fake motion-runtime subcommand fails", () => {
		const report = auditCommandSurface("```\nlitcodex motion-runtime warm\n```");
		assert.ok(
			report.offenders.some((o) => o.kind === "unknown-command" && o.value === "litcodex motion-runtime warm"),
		);
	});

	test("fake loop subcommand fails", () => {
		const report = auditCommandSurface("```\nlitcodex loop steer\n```");
		assert.ok(report.offenders.some((o) => o.kind === "unknown-command" && o.value.includes("steer")));
		// Cross-check the flagged sub is genuinely not in the canonical surface.
		assert.ok(!LOOP_SUBCOMMANDS.includes("steer"));
		evidence("task-27-surface-fake-loop.txt", "litcodex loop steer flagged\nSTATUS: PASS");
	});

	test("removed top-level routes are rejected", () => {
		for (const command of ["litcodex skill-loop review", "litcodex observer"]) {
			const report = auditCommandSurface(`\`\`\`\n${command}\n\`\`\``);
			assert.ok(
				report.offenders.some((o) => o.kind === "unknown-command" && o.value.includes(command.split(" ")[1])),
				`${command} must be rejected`,
			);
		}
		evidence("task-26-removed-routes.txt", "removed top-level routes rejected\nSTATUS: PASS");
	});

	test("wrong loop verb (litcodex lit-loop <sub>) fails", () => {
		const report = auditCommandSurface(`\`\`\`\n${WRONG_VERB} status\n\`\`\``);
		assert.ok(report.offenders.some((o) => o.kind === "wrong-verb-command"));
		evidence("task-27-surface-wrong-verb.txt", "wrong loop verb flagged\nSTATUS: PASS");
	});

	test("negated / example reference is NOT flagged", () => {
		// A doc that explains the WRONG form as a never-do reference must not fail the audit.
		const report = auditCommandSurface(`Type \`litcodex loop <sub>\`, never \`${WRONG_VERB}\`.`);
		assert.deepEqual(report.offenders, []);
		evidence("task-27-surface-negated.txt", "negated reference exempt\nSTATUS: PASS");
	});

	test("prose mentioning litcodex is not a command", () => {
		// "No lit-loop-capable litcodex executable found" — litcodex is a NOUN here, not a command.
		const report = auditCommandSurface("No lit-loop-capable litcodex executable found on PATH.");
		assert.deepEqual(
			report.offenders.filter((o) => o.value.includes("executable")),
			[],
		);
		evidence("task-27-surface-prose.txt", "prose noun not flagged\nSTATUS: PASS");
	});

	test("position-independent flags are not subcommands", () => {
		const report = auditCommandSurface("```\nlitcodex --dry-run install\nlitcodex loop status --json\n```");
		assert.deepEqual(report.offenders, []);
		evidence("task-27-surface-flags.txt", "flags not mistaken for subcommands\nSTATUS: PASS");
	});
});

describe("docs-audit repo-derived facts", () => {
	test("English and Korean READMEs match every public route against native hook facts", () => {
		const mode = LIT_TRIGGER_TOKENS.find((token) => token.endsWith("research"));
		assert.ok(mode, "hook exposes a research mode token");
		const expectedForms = hookRouteForms(mode);
		assert.equal(expectedForms.length, 3, "hook exposes bare, exact slash, and natural research forms");

		const english = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
		const korean = readFileSync(join(REPO_ROOT, "README-Ko-KR.md"), "utf8");
		const englishRoutes = documentedRouteRows(english);
		const koreanRoutes = documentedRouteRows(korean);
		assert.equal(englishRoutes.length, 12, "English README declares the complete public hook route table");
		assert.deepEqual(koreanRoutes, englishRoutes, "Korean route table must have exact English route parity");
		for (const { mode: documentedMode, forms } of englishRoutes) {
			for (const form of forms) {
				assert.equal(hookModeForForm(form), documentedMode, `${form} must route to ${documentedMode}`);
			}
		}
		assert.deepEqual(documentedModeForms(english, mode), expectedForms);
		assert.deepEqual(documentedModeForms(korean, mode), expectedForms);
		assert.match(
			english,
			/slash-command-style mentions are ignored except the explicit\s+`\/litresearch` research route/,
		);
		assert.match(
			korean,
			/슬래시로 시작하는 일반적인 명령 형태도 무시하지만, 정확한 `\/litresearch`만 예외로 연구 모드로 라우팅합니다\./,
		);
		assert.match(korean, /정확히 단독으로 입력한 `handoff`/);
		assert.match(korean, /정확히 단독으로 입력한 `lit-scientific-visualization`/);
	});

	test("README fails when release history is not delegated to the changelog", () => {
		const report = auditDoc("# LitCodex\n\nMutable release prose.\n", "README.md", undefined, {
			npmPackageVersion: "9.9.9",
			litLoopHookStatusMessage: "🔥 LIT IGNITED · lit-loop 🔥",
		});
		assert.ok(
			report.offenders.some((o) => o.kind === "history-link-missing"),
			JSON.stringify(report.offenders),
		);
	});

	test("Korean README links release history without pinning mutable chronology", () => {
		const facts = {
			npmPackageVersion: "0.3.48",
			litLoopHookStatusMessage: "🔥 LIT IGNITED · lit-loop 🔥",
		};
		const current = auditDoc(
			"# LitCodex\n\n릴리스 이력은 [CHANGELOG.md](./CHANGELOG.md)에서 관리합니다.\n",
			"README-Ko-KR.md",
			undefined,
			facts,
		);
		assert.ok(!current.offenders.some((o) => o.kind === "history-link-missing"), JSON.stringify(current.offenders));
		const missing = auditDoc(
			"# LitCodex\n\n릴리스 이력은 별도 문서를 확인하세요.\n",
			"README-Ko-KR.md",
			undefined,
			facts,
		);
		assert.ok(
			missing.offenders.some((o) => o.kind === "history-link-missing"),
			JSON.stringify(missing.offenders),
		);
	});

	test("an explicitly forbidden token is rejected in both English and Korean docs", () => {
		const contract = {
			requiredSections: [],
			requiredPhrases: [],
			requiredCommands: [],
			requiredSkillIds: [],
			forbiddenTokens: ["lit-init"],
			forbiddenPhrases: [],
		};
		const english = auditDoc("lit-init", "README.md", contract);
		assert.ok(english.offenders.some((o) => o.kind === "forbidden-token" && o.value === "lit-init"));
		const korean = auditDoc("lit-init", "README-Ko-KR.md", contract);
		assert.ok(korean.offenders.some((o) => o.kind === "forbidden-token" && o.value === "lit-init"));
	});

	test("fake Korean hook commands and ambiguous exact-route claims fail", () => {
		const facts = {
			npmPackageVersion: "0.3.48",
			litLoopHookStatusMessage: "🔥 LIT IGNITED · lit-loop 🔥",
		};
		const fake = auditDoc(
			"# LitCodex\n\n[CHANGELOG.md](./CHANGELOG.md)\n\n| `lit-fake` | **lit-loop** | 가짜 라우트 |\n",
			"README-Ko-KR.md",
			undefined,
			facts,
		);
		assert.ok(
			fake.offenders.some((o) => o.kind === "unknown-hook-route"),
			JSON.stringify(fake.offenders),
		);
		const ambiguous = auditDoc(
			"# LitCodex\n\n[CHANGELOG.md](./CHANGELOG.md)\n\n| `handoff` | **lit-handoff** | 일반 언급 |\n",
			"README-Ko-KR.md",
			undefined,
			facts,
		);
		assert.ok(
			ambiguous.offenders.some((o) => o.kind === "exact-route-ambiguity"),
			JSON.stringify(ambiguous.offenders),
		);
	});

	test("contract docs fail when the hook statusMessage drifts from hooks.json", () => {
		const report = auditDoc(
			"| Hook statusMessage | **`🔥 LitCodex: Checking Lit Trigger`** |\n",
			"docs/spec/litcodex-contract.md",
			undefined,
			{ npmPackageVersion: "9.9.9", litLoopHookStatusMessage: "🔥 LIT IGNITED · lit-loop 🔥" },
		);
		assert.ok(
			report.offenders.some((o) => o.kind === "hook-status-drift"),
			JSON.stringify(report.offenders),
		);
	});
});

describe("canonical packaging contract", () => {
	const rel = "docs/spec/litcodex-contract.md";
	const facts = loadRepoFacts();
	const installerRow = `| Installer npm package | \`${facts.npmPackageName}\`, version \`${facts.npmPackageVersion}\`, \`type: module\` |`;
	const versionRow = `| Version (all \`package.json\`) | \`${facts.npmPackageVersion}\` |`;
	const current = `${facts.litLoopHookStatusMessage}\nInitial version: \`0.1.0\` (historical).\n\nPackaging constants:\n\n| Constant | Canonical value |\n| --- | --- |\n${installerRow}\n${versionRow}\n\n---\n`;

	test("accepts current canonical rows while retaining historical versions elsewhere", () => {
		assert.equal(auditDoc(current, rel, undefined, facts).ok, true);
	});
	test("accepts current canonical rows with CRLF line endings", () => {
		assert.equal(auditDoc(current.replaceAll("\n", "\r\n"), rel, undefined, facts).ok, true);
	});

	const duplicates = [
		["stale installer name", installerRow, installerRow.replace(facts.npmPackageName, "litcodex-ai")],
		["stale installer version", installerRow, installerRow.replace(facts.npmPackageVersion, "0.1.0")],
		["stale shared version", versionRow, versionRow.replace(facts.npmPackageVersion, "0.1.0")],
		[
			"stale installer name and version",
			installerRow,
			installerRow.replace(facts.npmPackageName, "litcodex-ai").replace(facts.npmPackageVersion, "0.1.0"),
		],
		["current installer", installerRow, installerRow],
		["current shared version", versionRow, versionRow],
	];
	const optionalPipes = [
		["without opening pipe", (row) => row.replace(/^\|/u, "")],
		["without closing pipe", (row) => row.replace(/\|$/u, "")],
		["without outer pipes", (row) => row.replace(/^\||\|$/gu, "")],
	];
	for (const [syntax, formatRow] of optionalPipes) {
		for (const newline of ["\n", "\r\n"]) {
			const ending = newline === "\n" ? "LF" : "CRLF";
			test(`accepts unique current rows ${syntax} with ${ending}`, () => {
				const text = current
					.replace(installerRow, formatRow(installerRow))
					.replace(versionRow, formatRow(versionRow));
				assert.equal(auditDoc(text.replaceAll("\n", newline), rel, undefined, facts).ok, true);
			});
			for (const [label, unique, duplicate] of duplicates) {
				for (const position of ["before", "after"]) {
					test(`rejects duplicate ${label} ${syntax} ${position} current row with ${ending}`, () => {
						const formatted = formatRow(duplicate);
						const rows = position === "before" ? `${formatted}\n${unique}` : `${unique}\n${formatted}`;
						const report = auditDoc(
							current.replace(unique, rows).replaceAll("\n", newline),
							rel,
							undefined,
							facts,
						);
						assert.ok(
							report.offenders.some((o) => o.kind === "packaging-contract-drift"),
							JSON.stringify(report),
						);
					});
				}
			}
		}
	}

	for (const newline of ["\n", "\r\n"]) {
		const ending = newline === "\n" ? "LF" : "CRLF";
		for (const [label, unique, duplicate] of duplicates) {
			for (const position of ["before", "after"]) {
				test(`rejects duplicate ${label} ${position} the canonical row with ${ending}`, () => {
					const rows = position === "before" ? `${duplicate}\n${unique}` : `${unique}\n${duplicate}`;
					const text = current.replace(unique, rows).replaceAll("\n", newline);
					const report = auditDoc(text, rel, undefined, facts);
					assert.ok(
						report.offenders.some((o) => o.kind === "packaging-contract-drift"),
						JSON.stringify(report),
					);
				});
			}
		}
		test(`preserves historical rows outside the canonical section with ${ending}`, () => {
			const history = duplicates.map(([, , row]) => row).join("\n");
			const text = `Historical packaging:\n${history}\n\n${current}\nHistorical packaging:\n${history}\n`;
			assert.equal(auditDoc(text.replaceAll("\n", newline), rel, undefined, facts).ok, true);
		});
	}

	for (const [label, before, after] of [
		["installer name", installerRow, installerRow.replace(facts.npmPackageName, "litcodex-ai")],
		["installer version", installerRow, installerRow.replace(facts.npmPackageVersion, "0.1.0")],
		["shared version", versionRow, versionRow.replace(facts.npmPackageVersion, "0.1.0")],
	]) {
		test(`rejects stale ${label} in canonical rows even with correct values elsewhere`, () => {
			const text = `${current.replace(before, after)}\nHistorical copy:\n${before}\n`;
			const report = auditDoc(text, rel, undefined, facts);
			assert.ok(
				report.offenders.some((o) => o.kind === "packaging-contract-drift"),
				JSON.stringify(report),
			);
		});
	}
});

describe("docs-audit doc set", () => {
	test("every user-facing doc that exists is clean", () => {
		const facts = loadRepoFacts();
		assert.ok(USER_FACING_DOCS.length >= 8, `audits at least 8 docs (got ${USER_FACING_DOCS.length})`);
		const dirty = [];
		for (const rel of USER_FACING_DOCS) {
			let text;
			try {
				text = readFileSync(join(REPO_ROOT, rel), "utf8");
			} catch {
				continue; // optional docs may be absent in this build
			}
			const report = auditDoc(text, rel, undefined, facts);
			if (!report.ok) dirty.push({ rel, offenders: report.offenders });
		}
		assert.deepEqual(dirty, [], JSON.stringify(dirty, null, 2));
		evidence("task-27-doc-set-clean.txt", `docs audited=${USER_FACING_DOCS.length}\nSTATUS: PASS`);
	});

	test("doc set names the contract + skill + release docs", () => {
		for (const rel of [
			"README.md",
			"README-Ko-KR.md",
			"packages/litcodex-ai/README.md",
			"packages/litcodex-ai/README-Ko-KR.md",
			"docs/usage.md",
			"docs/usage-Ko-KR.md",
			"docs/spec/litcodex-contract.md",
			"docs/reference-analysis.md",
			"plugins/litcodex/components/lit-loop/README.md",
			"plugins/litcodex/components/lit-loop/skills/lit-loop/SKILL.md",
			"plugins/litcodex/components/lit-loop/skills/lit-loop/references/full-workflow.md",
			"CHANGELOG.md",
		]) {
			assert.ok(USER_FACING_DOCS.includes(rel), `doc set includes ${rel}`);
		}
		evidence("task-27-doc-set-membership.txt", USER_FACING_DOCS.join("\n"));
	});

	test("public docs distinguish tracked coverage from shipped runtime payload", () => {
		const changelogContract =
			"Tests, fixtures, test helpers, and Vitest configuration remain tracked repository coverage and are excluded from npm and installed marketplace payloads.";
		const flat = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8").replace(/\s+/g, " ");
		assert.ok(
			readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8").includes(changelogContract),
			"CHANGELOG.md keeps the tracked-versus-shipped entry",
		);
		for (const rel of ["README.md", "packages/litcodex-ai/README.md"]) {
			assert.ok(
				flat(rel).includes(
					"Tests, fixtures, test helpers and the Vitest configuration live only in the repository. Neither the npm package nor the installed marketplace plugin includes them.",
				) ||
					flat(rel).includes(
						"Tests, fixtures, test helpers and the Vitest configuration live only in this repository. Neither the npm package nor the installed marketplace plugin includes them.",
					),
				`${rel} must state the tracked-versus-shipped coverage contract`,
			);
		}
		for (const rel of ["README-Ko-KR.md", "packages/litcodex-ai/README-Ko-KR.md"]) {
			assert.match(
				flat(rel),
				/테스트, 픽스처, 테스트 헬퍼, Vitest 설정은 (?:이 )?저장소에만 있습니다\. npm 패키지와 설치된 마켓플레이스 플러그인에는 들어가지 않습니다\./,
				`${rel} must state the tracked-versus-shipped coverage contract`,
			);
		}
	});
});

describe("docs-audit cli", () => {
	test("audit passes on the real repo docs", () => {
		const r = runAuditCli();
		assert.equal(r.code, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /ok: 22 doc\(s\) consistent/);
		assert.match(r.stdout, /docs-audit: PASS/);
		evidence("task-27-cli-pass.txt", r.stdout.trim());
	});

	test("a fake command in a temp doc makes the cli FAIL", () => {
		// Point the CLI at an EXTRA doc (via env) that documents a non-existent command. The scratch
		// doc lives in the OS tmpdir and is removed in a finally so it never pollutes the repo.
		const scratch = join(tmpdir(), `litcodex-docs-negative-${process.pid}-${Date.now()}.md`);
		writeFileSync(scratch, "# Fake doc\n\nRun `litcodex foo-bar` to win.\n");
		try {
			const r = runAuditCli([], { env: { ...process.env, LITCODEX_DOCS_EXTRA: scratch } });
			assert.equal(r.code, 1, r.stdout + r.stderr);
			assert.match(r.stdout, /foo-bar/);
			assert.match(r.stdout, /docs-audit: FAIL/);
			evidence("task-27-cli-negative.txt", r.stdout.trim());
		} finally {
			rmSync(scratch, { force: true });
		}
	});

	test("json report shape", () => {
		const r = runAuditCli(["--json"]);
		assert.equal(r.code, 0);
		const report = JSON.parse(r.stdout.trim());
		assert.equal(report.ok, true);
		assert.ok(Array.isArray(report.docs));
		for (const d of report.docs) {
			assert.equal(typeof d.path, "string");
			assert.ok(Array.isArray(d.offenders));
		}
	});
});
