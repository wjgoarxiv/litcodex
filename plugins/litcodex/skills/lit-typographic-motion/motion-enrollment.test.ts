import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_SKILL_IDS, CANONICAL_SKILL_RESOURCE_PATHS } from "../../../../packages/litcodex-ai/src/install/skill-catalog.js";
import { MOTION_PAYLOAD_HASHES } from "../../../../packages/litcodex-ai/src/install/skill-resource-hashes.js";
import { renderMotionRuntime } from "../../../../packages/litcodex-ai/src/install/motion-runtime.js";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const ID = "lit-typographic-motion";

function runtimeFiles(): string[] {
	const out: string[] = [];
	const pending = [skillRoot];
	while (pending.length) {
		const dir = pending.pop() as string;
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			const rel = relative(skillRoot, path);
			if (statSync(path).isDirectory()) {
				if (!["fixtures", "__pycache__"].includes(name)) pending.push(path);
			} else if (!rel.endsWith(".test.ts")) out.push(rel);
		}
	}
	return out.sort();
}

describe("lit-typographic-motion enrollment", () => {
	it("is a canonical skill with every runtime file pinned and exposed as a resource", () => {
		expect(CANONICAL_SKILL_IDS).toContain(ID);
		expect(Object.keys(MOTION_PAYLOAD_HASHES).sort()).toEqual(runtimeFiles());
		for (const [path, digest] of Object.entries(MOTION_PAYLOAD_HASHES)) {
			expect(createHash("sha256").update(readFileSync(join(skillRoot, path))).digest("hex"), path).toBe(digest);
			if (path !== "SKILL.md") expect(CANONICAL_SKILL_RESOURCE_PATHS).toContain(`${ID}/${path}`);
		}
	});

	it("is listed in the pack manifest's exact file set and the substance-parity ledger", () => {
		const manifest = JSON.parse(readFileSync(join(repoRoot, "tools", "pack-payload-manifest.json"), "utf8"));
		const set = manifest.packages[0].exactFileSets.find((entry: { prefix: string }) => entry.prefix === `marketplace/plugins/litcodex/skills/${ID}/`);
		expect(set?.allowedPaths.slice().sort()).toEqual(runtimeFiles());
		for (const path of runtimeFiles()) expect(manifest.packages[0].requiredPaths).toContain(`marketplace/plugins/litcodex/skills/${ID}/${path}`);
		expect(readFileSync(join(repoRoot, "tools", "payload-substance-parity.json"), "utf8")).toContain(`"${ID}"`);
	});

	it("ships native discovery metadata and a runtime lockfile without dev dependencies", () => {
		const yaml = readFileSync(join(skillRoot, "agents", "openai.yaml"), "utf8");
		expect(yaml).toContain(`$litcodex:${ID}`);
		const lock = JSON.parse(readFileSync(join(skillRoot, "runtime", "package-lock.json"), "utf8"));
		expect(Object.keys(lock.packages).sort()).toEqual(["", "node_modules/opentype.js", "node_modules/playwright-core", "node_modules/ws"]);
		expect(JSON.stringify(lock)).not.toMatch(/remotion|three"/u);
	});

	it("prints the five motion probes on the doctor surface", () => {
		const text = renderMotionRuntime({ ready: false, chrome: "c", ffmpeg: "f", webgl2: "w", rendererWarning: "r", prewarm: "p", audio: "a", wordTiming: "t", missing: [] });
		for (const label of ["motion Chrome:", "motion ffmpeg:", "motion WebGL2 renderer:", "motion renderer warning:", "motion pre-warm:"]) expect(text).toContain(label);
		const cli = readFileSync(join(repoRoot, "packages/litcodex-ai/src/cli.ts"), "utf8");
		expect(cli).toContain("litcodex motion-runtime install|status");
		expect(readFileSync(join(repoRoot, "packages/litcodex-ai/src/install/index.ts"), "utf8")).toContain("renderMotionRuntime(motionRuntime");
	});
});

describe("lit-typographic-motion corpus and caps", () => {
	const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
	it("keeps SKILL.md within the 4,096-byte entrypoint cap and pointing at every reference", () => {
		expect(Buffer.byteLength(skill, "utf8")).toBeLessThanOrEqual(4096);
		for (const ref of ["treatment", "stage", "style-bibles", "type-and-timing", "quality-gate", "runtime"]) expect(skill).toContain(`references/${ref}.md`);
		for (const phrase of ["ask no questions", "--stills-only", "completion --out O", "Hand-encoded films are not the deliverable", "litcodex motion-runtime install", "at least 600 s", "invent a labelled example subject"]) expect(skill).toContain(phrase);
		for (const gone of ["kinetic-typography film", "not this deliverable", "sample copy", "3-6 short lines"]) expect(skill).not.toContain(gone);
	});
	it("keeps each reference dense and complete (word floor and required sections)", () => {
		const floors: Record<string, [number, string[]]> = {
			"style-bibles.md": [1100, ["## The brief file", "## Preset auto-pick", "## Style bible template", "## swiss-signal", "## terminalcore", "## tidal"]],
			"type-and-timing.md": [1000, ["## The one reading floor", "## Tier 2", "## Tier 3", "## Script runs", "## Korean type rules", "## Fonts"]],
			"scene-author.md": [1000, ["## How the engine renders a frame", "## The six starter scenes", "## GLSL passes", "## Outputs of a render"]],
			"quality-gate.md": [900, ["## One round", "## Exit codes", "## Promote or withhold", "## When the work counts as done", "## What the gate measures"]],
			"runtime.md": [900, ["## Commands", "## The five probes", "## Chrome launch ladder", "## Frame egress", "## Blocked states"]],
			"stage.md": [1500, ["## What you write", "## The contract", "## How a frame is made", "## The kit", "## Craft on the stage", "## Commands and outputs", "## Exit codes on this path"]],
			"treatment.md": [1300, ["## Path rule", "## Field reference", "## Placeholder example", "## Genre arcs", "## Craft rules"]],
		};
		for (const [name, [floor, sections]] of Object.entries(floors)) {
			const text = readFileSync(join(skillRoot, "references", name), "utf8");
			expect(text.split(/\s+/u).filter(Boolean).length, name).toBeGreaterThanOrEqual(floor);
			for (const section of sections) expect(text, `${name} ${section}`).toContain(section);
		}
	});
	it("keeps the bare-lit motion paragraph within its 2,000-byte activation budget", () => {
		const directive = readFileSync(join(repoRoot, "plugins/litcodex/components/lit-loop/directive.md"), "utf8");
		const start = directive.indexOf("When the request is a film request");
		const paragraph = directive.slice(start, directive.indexOf("\n\n", start));
		expect(start).toBeGreaterThan(-1);
		expect(Buffer.byteLength(paragraph, "utf8")).toBeLessThanOrEqual(2000);
	});
});
