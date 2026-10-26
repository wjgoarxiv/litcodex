// Codex keeps only the first and last 4,916 bytes of a hook's additionalContext once it grows past
// about 9,832 bytes, and drops the middle. Every route's context therefore has to arrive whole, with
// the banner, the LIT card request and the route's gates near the top, and the long text named as
// files the model reads when it needs them. These tests drive the real hook entry with a full event.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runUserPromptSubmitHookCli } from "./hook-cli.js";

/** Codex shows a hook context whole only below this size; above it the middle is cut out. */
const HOST_CEILING_BYTES = 9_832;
const TARGET_BYTES = 6_000;
const LIT_PLAN_TARGET_BYTES = 5_000;

const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Measure with a typical installed plugin root so the budget does not depend on this checkout's path. */
const INSTALLED_ROOT = "/Users/someone/.codex/plugins/cache/litcodex/litcodex/1.0.25/";
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const temps: string[] = [];
const temp = (prefix: string): string => {
	const path = mkdtempSync(join(tmpdir(), prefix));
	temps.push(path);
	return path;
};
afterAll(() => {
	for (const path of temps) rmSync(path, { recursive: true, force: true });
});

/** [route label, prompt, banner route name] for every prompt shape that injects route context. */
const ROUTES = [
	["lit", "lit fix the typo in README.md", "lit-loop"],
	["lit (Korean)", "lit README.md 오타를 고쳐줘", "lit-loop"],
	["lit-loop", "lit-loop fix the typo in README.md", "lit-loop"],
	["lit film", "lit make a short video that explains how composting works", "lit-loop"],
	["litwork", "litwork fix the typo in README.md", "litwork"],
	["lit-plan", "lit-plan fix the typo in README.md", "lit-plan"],
	["litgoal", "litgoal show", "litgoal"],
	["lit-recap", "lit recap", "lit-recap"],
	["deep-interview", "deep-interview a mobile app idea", "deep-interview"],
	["lit-comprehend", "comprehend this repo", "lit-comprehend"],
	["lit-brainstorm", "lit brainstorm a name for my app", "lit-brainstorm"],
	["lit-schematic", "lit schematic of the reactor loop", "lit-schematic"],
	["lit-hijack", "lit hijack https://example.com/post into my skill", "lit-hijack"],
	["lit-hijack (Korean)", "lit 하이재킹 이 글의 기법을 내 스킬에", "lit-hijack"],
	["lit-adhd", "lit adhd", "lit-adhd"],
	["lit-adhd (alias)", "lit rewind", "lit-adhd"],
	["litresearch", "litresearch heat pumps", "litresearch"],
	["review-work", "review-work this diff", "review-work"],
	["start-work", "start-work approved-plan", "start-work"],
	["lit-crucible", "lit-crucible this release", "lit-crucible"],
	["lit-init", "lit-init --max-depth=2", "lit-init"],
	["handoff", "handoff", "lit-handoff"],
	["lit-scientific-visualization", "lit-scientific-visualization", "lit-scientific-visualization"],
	["browser-drive", "browser-drive", "browser-drive"],
	["hyperplan (renamed)", "hyperplan this release", "lit-crucible"],
	["lit-commit", "lit-commit", "lit-commit"],
	["lit-team", "lit-team", "lit-team"],
	["lit-burnoff", "lit-burnoff", "lit-burnoff"],
	["lit-burnoff-file", "lit-burnoff-file", "lit-burnoff-file"],
	["lit-humanizer", "lit-humanizer 이 글을 다듬어줘", "lit-humanizer"],
	["lit-fetch", "lit-fetch https://example.com", "lit-fetch"],
	["lit-code", "lit-code fix the parser", "lit-code"],
	["programming (renamed)", "programming fix the parser", "lit-code"],
] as const;

async function routeContext(prompt: string): Promise<string> {
	const cwd = temp("litcodex-route-ws-");
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	let out = "";
	stdout.on("data", (chunk) => {
		out += chunk.toString();
	});
	stdin.end(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: "route-budget",
			turn_id: "t1",
			cwd,
			permission_mode: "default",
			prompt,
		}),
	);
	await runUserPromptSubmitHookCli(stdin, stdout, new PassThrough(), cwd, {
		env: { CODEX_HOME: temp("litcodex-route-home-") },
	});
	expect(out, `no hook output for ${prompt}`).not.toBe("");
	return (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
		.additionalContext;
}

const byteOffset = (text: string, needle: string): number => {
	const index = text.indexOf(needle);
	return index < 0 ? Number.POSITIVE_INFINITY : Buffer.byteLength(text.slice(0, index));
};

/** Absolute files the context names for on-demand reading, one `<kind> <name>: <path>` line each. */
const namedFiles = (context: string): string[] =>
	[...context.matchAll(/^(?:skill|directive) [a-z-]+: (\/\S+|[A-Za-z]:\\\S+)$/gmu)].map((match) => match[1] ?? "");

const contexts = new Map<string, string>();
const contextFor = async (prompt: string): Promise<string> => {
	const cached = contexts.get(prompt);
	if (cached !== undefined) return cached;
	const context = await routeContext(prompt);
	contexts.set(prompt, context);
	return context;
};

describe("route context arrives whole inside the Codex hook window", () => {
	it.each(ROUTES)("%s stays under its byte target", async (_label, prompt, route) => {
		const context = await contextFor(prompt);
		const bytes = Buffer.byteLength(context.replaceAll(PLUGIN_ROOT, INSTALLED_ROOT));
		expect(bytes).toBeLessThanOrEqual(route === "lit-plan" ? LIT_PLAN_TARGET_BYTES : TARGET_BYTES);
		expect(bytes).toBeLessThan(HOST_CEILING_BYTES);
	});

	it.each(ROUTES)("%s puts the banner and the LIT card request at the top", async (_label, prompt, route) => {
		const context = await contextFor(prompt);
		expect(byteOffset(context, `🔥 **LIT IGNITED · ${route}** 🔥`)).toBeLessThan(1_000);
		expect(byteOffset(context, "call the `lit_card` tool once now")).toBeLessThan(1_500);
	});

	it.each(ROUTES)("%s names its installed skill as a readable file instead of pasting it", async (_label, prompt) => {
		const context = await contextFor(prompt);
		expect(context).not.toContain("<litcodex-skill-body");
		expect(context.match(/## #contract\.activation/gu) ?? []).toHaveLength(0);
		expect(context.match(/### Bounded task/gu)?.length ?? 0).toBeLessThanOrEqual(1);
		const files = namedFiles(context);
		expect(files.some((path) => path.endsWith("SKILL.md"))).toBe(true);
		for (const path of files) expect(existsSync(path), path).toBe(true);
	});
});

describe("route gates that used to sit in the cut-out middle", () => {
	it("keeps the lit-plan planning-only gate and the literal plan grammar", async () => {
		const context = await contextFor("lit-plan fix the typo in README.md");
		expect(context).toContain("Wait for the user's explicit okay before generating the plan");
		expect(context).toContain("Never edit source");
		expect(context).toContain("publish-plan");
		expect(context).toContain("## Todos\n- [ ] N. <title>");
		expect(context).toContain("## Final verification wave\n- [ ] F1. <verification title>");
	});

	it("names every bounded deliverable hand-off once, under one installed skills folder", async () => {
		const context = await contextFor("lit fix the typo in README.md");
		const folder = /Each skill above is a folder under `([^`]+)`/u.exec(context)?.[1];
		expect(folder).toBeDefined();
		for (const skill of [
			"lit-code",
			"lit-docx",
			"lit-pptx",
			"frontend-ui-ux",
			"lit-diagram-drawer",
			"lit-typographic-motion",
		]) {
			expect(context, skill).toContain(`| ${skill} |`);
			expect(existsSync(join(folder ?? "", skill, "SKILL.md")), skill).toBe(true);
			expect(context, skill).not.toContain(`/skills/${skill}/SKILL.md`);
		}
		expect(context).toContain("### Bounded task");
		expect(context).toContain("### Durable task");
	});
});

describe("files named by route context ship in both package channels", () => {
	it("every named file is in the marketplace payload and pinned by the pack manifest", async () => {
		// Pointer lines must ship in both channels; hand-off paths inside a head only in the plugin payload,
		// because the component package names those skills by catalog name instead.
		const pointers = new Set<string>();
		const named = new Set<string>();
		for (const [, prompt] of ROUTES) {
			const context = await contextFor(prompt);
			for (const path of namedFiles(context)) pointers.add(path);
			for (const match of context.matchAll(/(?<=[\s`])(\/[^\s`|]+\.md)(?=[\s`]|$)/gu)) named.add(match[1] ?? "");
		}
		for (const path of pointers) named.add(path);
		expect(pointers.size).toBeGreaterThan(20);
		const toPluginRelative = (path: string): string => relative(PLUGIN_ROOT, path).split("\\").join("/");
		const pluginRelative = [...named].map(toPluginRelative);
		const pointerRelative = new Set([...pointers].map(toPluginRelative));
		for (const rel of pluginRelative) expect(rel.startsWith(".."), rel).toBe(false);

		const tracked = execFileSync(
			"git",
			["ls-files", "-z", "--cached", "--others", "--exclude-standard", "plugins/litcodex"],
			{ cwd: REPO_ROOT, encoding: "utf8" },
		)
			.split("\0")
			.filter(Boolean);
		const bundle = pathToFileURL(join(REPO_ROOT, "scripts", "marketplace-payload-bundle.mjs")).href;
		const { selectRuntimeFiles } = (await import(bundle)) as { selectRuntimeFiles: (paths: string[]) => string[] };
		const marketplace = new Set(selectRuntimeFiles(tracked.filter((path) => existsSync(join(REPO_ROOT, path)))));

		const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "tools", "pack-payload-manifest.json"), "utf8")) as {
			packages: Array<{ name: string; requiredPaths: string[]; requiredFuture?: string[] }>;
		};
		const pinned = (name: string): Set<string> => {
			const rule = manifest.packages.find((pkg) => pkg.name === name);
			return new Set([...(rule?.requiredPaths ?? []), ...(rule?.requiredFuture ?? [])]);
		};
		const installer = pinned("@litfamily/litcodex");
		const component = pinned("@litcodex/lit-loop");

		for (const rel of pluginRelative) {
			expect(marketplace.has(`plugins/litcodex/${rel}`), `marketplace payload lacks ${rel}`).toBe(true);
			expect(installer.has(`marketplace/plugins/litcodex/${rel}`), `installer manifest lacks ${rel}`).toBe(true);
			if (!pointerRelative.has(rel)) continue;
			const componentRel = rel.startsWith("components/lit-loop/") ? rel.slice("components/lit-loop/".length) : rel;
			expect(component.has(componentRel), `component manifest lacks ${componentRel}`).toBe(true);
		}
	});
});
