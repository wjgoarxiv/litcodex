// plugins/litcodex/moved-skill-stubs.test.ts — the content-production skills that moved out of LitCodex.
//
// Five families left the plugin for the separate wjgoarxiv-skills collection. Each moved skill keeps its
// directory, its id and every Codex route that reached it, but the directory now holds a short stub that
// says three things: the skill moved, where it lives in wjgoarxiv-skills, and the one Codex install line
// for that skill. The line copies the skill's Codex edition, variants/litcodex/<id>: one self-contained folder
// written for Codex, into ${CODEX_HOME}/skills/<id>, a directory the LitCodex installer never writes. These checks fail while a body, a runtime or a body-only hook context is still shipped.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extensionInstallLines } from "../../packages/litcodex-ai/src/install/extensions-notice.js";
import { CANONICAL_SKILL_IDS } from "../../packages/litcodex-ai/src/install/skill-catalog.js";
import { type HookDecision, runUserPromptSubmitHook } from "./components/lit-loop/src/codex-hook.js";

const PLUGIN_DIR = fileURLToPath(new URL("./", import.meta.url));
const REPO_ROOT = join(PLUGIN_DIR, "..", "..");
const SKILLS_DIR = join(PLUGIN_DIR, "skills");

const MOVED = [
	{ id: "lit-pptx", family: "decks" },
	{ id: "lit-docx", family: "documents" },
	{ id: "lit-diagram-drawer", family: "figures" },
	{ id: "lit-schematic", family: "figures" },
	{ id: "lit-scientific-visualization", family: "figures" },
	{ id: "frontend-ui-ux", family: "design" },
	{ id: "visual-qa", family: "design" },
	{ id: "lit-typographic-motion", family: "video-covers" },
	{ id: "readme-studio", family: "video-covers" },
] as const;

const PLACEHOLDER = "<path to your wjgoarxiv-skills clone>";
const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
const stub = (id: string): string => readFileSync(join(SKILLS_DIR, id, "SKILL.md"), "utf8");
const ups = (prompt: string): unknown => ({ hook_event_name: "UserPromptSubmit", prompt });
const context = (decision: HookDecision): string => {
	expect(decision.kind).toBe("inject");
	if (decision.kind !== "inject") return "";
	const parsed = JSON.parse(decision.stdout) as { hookSpecificOutput: { additionalContext: string } };
	return parsed.hookSpecificOutput.additionalContext;
};

describe("moved skills are same-name stubs that point at wjgoarxiv-skills", () => {
	it.each(MOVED)("$id says it moved, where it lives and how to install it in Codex", ({ id, family }) => {
		const text = stub(id);
		expect(text).toMatch(new RegExp(`^---\\nname: ${id}\\n`, "u"));
		expect(text).toContain(`🔥 **LIT IGNITED · ${id}** 🔥`);
		expect(text).toContain("wjgoarxiv-skills");
		expect(text).toContain(`stub_for: wjgoarxiv-skills variants/litcodex/${id}/`);
		expect(text).toContain(`\`${family}\` family`);
		expect(text).not.toContain(`plugins/${family}/`);
		expect(text).toContain(PLACEHOLDER);
		expect(text, "check, move aside, copy and receipt, one line each").toContain(
			`\`\`\`bash\n${extensionInstallLines(id).join("\n")}\n\`\`\``,
		);
		expect(text.match(/cp -R /gu)?.length, "one skill, one folder").toBe(1);
		expect(text).not.toMatch(/^mkdir -p|delete it and copy again/mu);
		expect(text).toContain(`\${CODEX_HOME:-$HOME/.codex}/extension-backups/<date-time>/${id}`);
		expect(text).toMatch(/run the four lines again/u);
		expect(text).toMatch(/run only the move-aside line/u);
		expect(text, "the CLI route beside the manual lines").toContain(
			`\`litcodex extensions install ${id}\` shows the plan, \`--yes\` runs it, and \`litcodex extensions check\``,
		);
		expect(text).toMatch(/upgrades never write/u);
		expect(text).not.toMatch(/not published yet/iu);
		expect(text).toContain("Public repo: clone https://github.com/wjgoarxiv/wjgoarxiv-skills, then run these lines");
		expect(text).toMatch(/new Codex session/iu);
		expect(text).not.toMatch(/\/Users\/[a-z]|~\/Desktop|27_LITFAMILY|\.worktrees\//u);
		expect(Buffer.byteLength(text)).toBeLessThan(9000);
	});

	it("the scientific-visualization stub needs no second copy: its Codex edition carries the authored source", () => {
		const text = stub("lit-scientific-visualization");
		expect(text).not.toMatch(/vendor_source|plugins\/figures\/vendor|\/vendor\/scientific-visualization"/u);
		expect(text).toContain("`vendor/scientific-visualization`");
		expect(existsSync(join(PLUGIN_DIR, "vendor", "scientific-visualization"))).toBe(false);
		expect(existsSync(join(PLUGIN_DIR, "vendor", "licenses", "045_scientific-visualization-MIT.txt"))).toBe(false);
		expect(existsSync(join(PLUGIN_DIR, "vendor", "provenance", "045_scientific-visualization.md"))).toBe(false);
	});

	it.each(MOVED)("$id ships only the stub and its Codex picker metadata", ({ id }) => {
		const files = walk(join(SKILLS_DIR, id))
			.map((path) => relative(join(SKILLS_DIR, id), path))
			.sort();
		const allowed = existsSync(join(SKILLS_DIR, id, "agents", "openai.yaml"))
			? ["SKILL.md", "agents/openai.yaml"]
			: ["SKILL.md"];
		expect(files).toEqual(allowed);
	});

	it("every moved id stays in the installed skill catalog, so doctor and the picker still find it", () => {
		for (const { id } of MOVED) expect(CANONICAL_SKILL_IDS).toContain(id);
	});

	it("the office and film runtimes left with their skills", () => {
		for (const gone of [
			"packages/litcodex-ai/src/install/office-runtime.ts",
			"packages/litcodex-ai/src/install/motion-runtime.ts",
			"plugins/litcodex/components/lit-loop/src/motion-gate.ts",
		]) {
			expect(existsSync(join(REPO_ROOT, gone)), gone).toBe(false);
		}
		const cli = readFileSync(join(REPO_ROOT, "packages/litcodex-ai/src/cli.ts"), "utf8");
		expect(cli).not.toMatch(/office-runtime|motion-runtime/u);
		const postinstall = readFileSync(join(REPO_ROOT, "packages/litcodex-ai/src/postinstall.ts"), "utf8");
		expect(postinstall).not.toMatch(/lit-typographic-motion|motion/iu);
	});
});

describe("hook routes still reach the stubs and carry no body procedure", () => {
	it("the schematic route injects the stub contract with the install line", () => {
		for (const prompt of ["lit schematic of the reactor loop", "lit 고압 반응기 루프 P&ID 그려줘"]) {
			const decision = runUserPromptSubmitHook(ups(prompt));
			expect(decision.kind === "inject" && decision.mode).toBe("lit-schematic");
			const ctx = context(decision);
			expect(ctx).toContain("🔥 **LIT IGNITED · lit-schematic** 🔥");
			expect(ctx).toContain("variants/litcodex/lit-schematic/");
			expect(ctx).not.toContain("plugins/figures/");
			expect(ctx).toContain(PLACEHOLDER);
			expect(ctx).toContain("extension-backups/");
			expect(ctx).not.toMatch(/`cp -R [^`]*`/u);
			for (const leftover of ["scripts/qa.mjs", "scaffold.mjs", "QA PASS", "forty real parts"]) {
				expect(ctx, `${prompt}: ${leftover}`).not.toContain(leftover);
			}
		}
	});

	it.each(["lit-schematic", "lit-scientific-visualization"])(
		"the %s directive names the public repo and clones it first",
		(id) => {
			const text = readFileSync(join(PLUGIN_DIR, "components", "lit-loop", "directives", `${id}.md`), "utf8");
			expect(text).not.toMatch(/not published yet/iu);
			expect(text).toContain("wjgoarxiv-skills is public at https://github.com/wjgoarxiv/wjgoarxiv-skills");
			expect(text).toContain(
				`git clone https://github.com/wjgoarxiv/wjgoarxiv-skills\n${extensionInstallLines(id).join("\n")}\n`,
			);
			expect(text.match(/cp -R /gu)?.length).toBe(1);
			expect(text).toContain(`\`litcodex extensions install ${id}\` does the same steps`);
		},
	);

	it("the exact bare scientific-visualization route injects the stub contract", () => {
		const ctx = context(runUserPromptSubmitHook(ups("lit-scientific-visualization")));
		expect(ctx).toContain("🔥 **LIT IGNITED · lit-scientific-visualization** 🔥");
		expect(ctx).toContain("variants/litcodex/lit-scientific-visualization/");
		expect(ctx).not.toContain("plugins/figures/");
		expect(ctx).toContain(PLACEHOLDER);
		for (const leftover of ["16-file", "dependency-preflight", "rcparams"]) expect(ctx).not.toContain(leftover);
	});

	it("a bare lit film request names the stub and arms no completion gate", () => {
		const decision = runUserPromptSubmitHook(ups("lit make a 10 second kinetic typography video for Ember"));
		const ctx = context(decision);
		expect(ctx).toContain("lit-typographic-motion");
		expect(ctx).toContain("wjgoarxiv-skills");
		expect(ctx).not.toContain("render.mjs");
		expect(ctx).not.toMatch(/Stop check holds the turn/u);
		expect(decision.kind === "inject" && "film" in decision).toBe(false);
	});

	it("the bare lit route table still names each moved skill it routes to, but no moved script", () => {
		const ctx = context(runUserPromptSubmitHook(ups("lit build a pricing page with three plans")));
		for (const id of ["lit-typographic-motion", "frontend-ui-ux", "lit-diagram-drawer", "lit-docx", "lit-pptx"]) {
			expect(ctx).toContain(`| ${id} |`);
		}
		expect(ctx).toContain("wjgoarxiv-skills");
		for (const leftover of ["design-lock.mjs", "probe.mjs"]) expect(ctx).not.toContain(leftover);
	});
});
