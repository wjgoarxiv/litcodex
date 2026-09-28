// plugins/litcodex/orchestration-contract.test.ts — subagent routing/doc contract.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const PLUGIN_DIR = fileURLToPath(new URL("./", import.meta.url));
const AGENTS_DIR = join(PLUGIN_DIR, "components", "lit-loop", "agents");
const ORDINARY_MODE_DIRECTIVES = [
	join(PLUGIN_DIR, "components", "lit-loop", "directive.md"),
	...[
		"lit-comprehend.md",
		"lit-crucible.md",
		"lit-init.md",
		"lit-plan.md",
		"lit-recap.md",
		"litgoal.md",
		"litresearch.md",
		"litwork.md",
		"review-work.md",
		"start-work.md",
	].map((name) => join(PLUGIN_DIR, "components", "lit-loop", "directives", name)),
];

const DOC_ROOTS = [
	join(PLUGIN_DIR, "skills"),
	join(PLUGIN_DIR, "components", "lit-loop", "directives"),
	join(PLUGIN_DIR, "components", "rules", "bundled-rules"),
	join(PLUGIN_DIR, "components", "start-work-continuation"),
];

function walkMarkdown(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return walkMarkdown(path);
		return path.endsWith(".md") ? [path] : [];
	});
	return entries.sort();
}

function agentNames(): string[] {
	return readdirSync(AGENTS_DIR)
		.filter((name) => name.endsWith(".toml"))
		.map((name) => {
			const text = readFileSync(join(AGENTS_DIR, name), "utf8");
			return text.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "";
		})
		.filter(Boolean)
		.sort();
}

const docs = DOC_ROOTS.flatMap(walkMarkdown);

describe("LitCodex orchestration contract", () => {
	it("keeps documented agent_type values in lockstep with installed TOML names", () => {
		const allowed = new Set(agentNames());
		const violations: string[] = [];
		for (const path of docs) {
			const text = readFileSync(path, "utf8");
			for (const match of text.matchAll(/["']agent_type["']\s*:\s*["']([^"']+)["']/g)) {
				const value = match[1] as string;
				if (!allowed.has(value)) violations.push(`${path}: ${value}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it("uses current multi_agent_v1 API names in orchestration docs", () => {
		const stale: string[] = [];
		for (const path of docs) {
			const text = readFileSync(path, "utf8");
			for (const token of ["multi_agent_v1.start", "multi_agent_v1.wait`", "multi_agent_v1.close`"] as const) {
				if (text.includes(token)) stale.push(`${path}: ${token}`);
			}
		}
		expect(stale).toEqual([]);
	});

	it("does not point continuation docs at stale source paths", () => {
		const stale: string[] = [];
		for (const path of docs) {
			const text = readFileSync(path, "utf8");
			if (text.includes("packages/litcodex-codex/plugin")) stale.push(path);
			if (text.includes("plugins/litcodex/components/lit-loop/skills")) stale.push(path);
		}
		expect(stale).toEqual([]);
	});

	it("keeps start-work executable when multi_agent_v1 is not exposed", () => {
		const text = readFileSync(join(PLUGIN_DIR, "skills", "start-work", "SKILL.md"), "utf8");
		expect(text).toContain("do not emit `BLOCKED` for that reason alone");
		expect(text).toContain("subagent_unavailable_direct_execution");
		expect(text).toContain("missing subagent tools alone is never a `BLOCKED` condition");
		expect(text).not.toContain("NO EXCEPTIONS");
	});

	it("keeps ordinary mode directives on UserPromptSubmit additionalContext only", () => {
		const violations: string[] = [];
		const falseContinuationClaims = [
			"routing and continuation state",
			"| Stop hook state |",
			"For lit-loop or start-work continuation",
			"For lit-loop or approved-work continuation",
			"continuation-step",
			"Active/blocked/review/continuation state",
			"Hidden continuation",
			"For continuation changes",
			"Stop hook instructions",
			"mark continuation work complete from a worker DoneClaim",
		];
		const routeContractPhrases = [
			'"handling": "trusted only for route selection"',
			'"mode_verdict": "active | blocked | review-pass | review-fail | route-step"',
			"Active/blocked/review/route state",
			"Hidden route switch",
			"For route or checkpoint claims",
			"mark delegated work complete from a worker DoneClaim",
		];
		for (const path of ORDINARY_MODE_DIRECTIVES) {
			const text = readFileSync(path, "utf8");
			if (!text.includes('injection_surface: "UserPromptSubmit additionalContext"')) {
				violations.push(`${path}: injection_surface`);
			}
			if (!text.includes('"type": "UserPromptSubmit"')) {
				violations.push(`${path}: hook_event`);
			}
			if (text.includes("| Continuation route |")) violations.push(`${path}: continuation route`);
			for (const phrase of falseContinuationClaims) {
				if (text.includes(phrase)) violations.push(`${path}: ${phrase}`);
			}
			for (const phrase of routeContractPhrases) {
				if (!text.includes(phrase)) violations.push(`${path}: missing ${phrase}`);
			}
			const routeStatePhrase =
				path === ORDINARY_MODE_DIRECTIVES[0]
					? "bounded tasks do not inspect or initialize `.litcodex/lit-loop` state"
					: "For the selected route, read relevant `.litcodex` state";
			if (!text.includes(routeStatePhrase)) violations.push(`${path}: missing ${routeStatePhrase}`);
		}

		expect(violations).toEqual([]);
	});

	it("reserves root Stop continuation for the dedicated component and makes no SubagentStop claims", () => {
		const documentedPaths = [
			join(PLUGIN_DIR, "skills", "start-work", "SKILL.md"),
			join(PLUGIN_DIR, "components", "start-work-continuation", "directive.md"),
			join(PLUGIN_DIR, "components", "lit-loop", "directive.md"),
			...walkMarkdown(join(PLUGIN_DIR, "components", "lit-loop", "directives")),
		];
		const continuation = readFileSync(
			join(PLUGIN_DIR, "components", "start-work-continuation", "directive.md"),
			"utf8",
		);
		const skill = readFileSync(join(PLUGIN_DIR, "skills", "start-work", "SKILL.md"), "utf8");
		const stale = documentedPaths.filter((path) => readFileSync(path, "utf8").includes("SubagentStop"));

		expect(stale).toEqual([]);
		expect(continuation).toContain('injection_surface: "Codex root Stop hook additionalContext"');
		expect(continuation).toContain("| Continuation | Stop hook sees active `codex:` work |");
		expect(skill).toContain("Codex root `Stop` continuation hook");
	});

	it("keeps start-work lifecycle mutations code-owned and canonical", () => {
		const continuation = readFileSync(
			join(PLUGIN_DIR, "components", "start-work-continuation", "directive.md"),
			"utf8",
		);
		const skill = readFileSync(join(PLUGIN_DIR, "skills", "start-work", "SKILL.md"), "utf8");
		for (const kind of ["start_work_paused", "start_work_resumed", "start_work_cancelled", "start_work_completed"]) {
			expect(`${continuation}\n${skill}`).toContain(kind);
		}
		expect(`${continuation}\n${skill}`).toContain("transition pause");
		expect(skill).toContain("transition pause|cancel|complete");
		expect(skill).toContain("Generic CLI `transition resume` is deliberately rejected");
		expect(skill).toContain("internal resume API");
		expect(`${continuation}\n${skill}`).not.toMatch(/event:\s*"work-(?:paused|resumed|cancelled|completed)"/);
	});

	it("every relative references/*.md resource mentioned by a skill exists", () => {
		const missing: string[] = [];
		for (const path of walkMarkdown(join(PLUGIN_DIR, "skills"))) {
			if (!path.endsWith("SKILL.md")) continue;
			const text = readFileSync(path, "utf8");
			for (const match of text.matchAll(/`(references\/[^`]+)`/g)) {
				const rel = match[1] as string;
				if (rel.includes("<") || rel.includes("*")) continue;
				const abs = join(dirname(path), rel);
				if (!existsSync(abs)) missing.push(`${path}: ${rel}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("includes untracked compiled .js dependency closure and pins continuation payload files", () => {
		const repoRoot = dirname(dirname(PLUGIN_DIR));
		const bundleScript = join(repoRoot, "scripts", "marketplace-payload-bundle.mjs");
		const expression = [
			`import { selectRuntimeFiles } from ${JSON.stringify(pathToFileURL(bundleScript).href)};`,
			`const selected = selectRuntimeFiles(["plugins/litcodex/components/start-work-continuation/dist/cli.js"]);`,
			`process.stdout.write(JSON.stringify(selected));`,
		].join("\n");
		const selected = JSON.parse(
			execFileSync(execPath, ["--input-type=module", "--eval", expression], {
				cwd: repoRoot,
				encoding: "utf8",
			}),
		) as string[];
		expect(selected).toContain("plugins/litcodex/components/start-work-continuation/dist/lifecycle-store.js");

		const manifest = JSON.parse(readFileSync(join(repoRoot, "tools", "pack-payload-manifest.json"), "utf8")) as {
			packages: Array<{ name: string; requiredFuture?: string[] }>;
		};
		const required = manifest.packages.find((pkg) => pkg.name === "@litfamily/litcodex")?.requiredFuture ?? [];
		for (const path of [
			"marketplace/plugins/litcodex/components/start-work-continuation/dist/cli.js",
			"marketplace/plugins/litcodex/components/start-work-continuation/dist/lifecycle-store.js",
			"marketplace/plugins/litcodex/components/start-work-continuation/directive.md",
			"marketplace/plugins/litcodex/hooks/hooks.json",
		]) {
			expect(required).toContain(path);
		}
	});
});
