import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { materializeManagedMarketplace } from "./marketplace-payload.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const VENDOR_ROOT = join(REPO_ROOT, "plugins/litcodex/vendor");
const BUNDLE_SCRIPT_URL = pathToFileURL(join(REPO_ROOT, "scripts/marketplace-payload-bundle.mjs")).href;
const VENDOR_PAIRS = [
	["022_handoff", "handoff"],
	["045_scientific-visualization", "scientific-visualization"],
] as const;

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("canonical vendor paths", () => {
	it("exposes unnumbered source roots and selects them for the runtime marketplace", async () => {
		for (const [, canonical] of VENDOR_PAIRS) {
			expect(existsSync(join(VENDOR_ROOT, canonical)), canonical).toBe(true);
		}
		for (const [numbered] of VENDOR_PAIRS) {
			expect(existsSync(join(VENDOR_ROOT, numbered)), numbered).toBe(false);
		}

		const module = await import(`${BUNDLE_SCRIPT_URL}?canonical-vendor-contract`);
		const selected = module.selectRuntimeFiles([
			"plugins/litcodex/vendor/handoff/SKILL.md",
			"plugins/litcodex/vendor/scientific-visualization/SKILL.md",
		]);
		expect(selected).toEqual(
			expect.arrayContaining([
				"plugins/litcodex/vendor/handoff/SKILL.md",
				"plugins/litcodex/vendor/scientific-visualization/SKILL.md",
			]),
		);
		const payloadManifest = readFileSync(join(REPO_ROOT, "tools/pack-payload-manifest.json"), "utf8");
		expect(payloadManifest).toContain("marketplace/plugins/litcodex/vendor/handoff/");
		expect(payloadManifest).toContain("marketplace/plugins/litcodex/vendor/scientific-visualization/");
		expect(payloadManifest).not.toMatch(/marketplace\/plugins\/litcodex\/vendor\/022_handoff\//u);
		expect(payloadManifest).not.toMatch(/marketplace\/plugins\/litcodex\/vendor\/045_scientific-visualization\//u);
	});

	it("migrates pristine manifest-owned numbered roots without loss or duplicates", () => {
		const paths = fixture();
		materializeManagedMarketplace(paths);
		for (const [, canonical] of VENDOR_PAIRS) {
			renameSync(
				join(paths.targetRoot, "plugins/litcodex/vendor", canonical),
				join(
					paths.targetRoot,
					"plugins/litcodex/vendor",
					VENDOR_PAIRS.find(([, name]) => name === canonical)?.[0] ?? canonical,
				),
			);
		}

		materializeManagedMarketplace(paths);

		for (const [, canonical] of VENDOR_PAIRS) {
			expect(existsSync(join(paths.targetRoot, "plugins/litcodex/vendor", canonical)), canonical).toBe(true);
		}
		for (const [numbered] of VENDOR_PAIRS) {
			expect(existsSync(join(paths.targetRoot, "plugins/litcodex/vendor", numbered)), numbered).toBe(false);
		}
		expect(readFileSync(join(paths.targetRoot, "plugins/litcodex/vendor/handoff/SKILL.md"), "utf8")).toBe(
			"handoff bytes\n",
		);
		expect(
			readFileSync(join(paths.targetRoot, "plugins/litcodex/vendor/scientific-visualization/SKILL.md"), "utf8"),
		).toBe("science bytes\n");
	});

	for (const [kind, mutate] of [
		["modified", (root: string) => writeFileSync(join(root, "SKILL.md"), "modified\n")],
		["foreign", (root: string) => writeFileSync(join(root, "foreign.txt"), "foreign\n")],
		[
			"fifo",
			(root: string) => {
				const legacy = `${root}.legacy`;
				renameSync(root, legacy);
				const result = spawnSync("mkfifo", [root], { stdio: "ignore" });
				if (result.status !== 0) throw new Error("mkfifo fixture creation failed");
			},
		],
		[
			"symlink",
			(root: string) => {
				const outside = mkdtempSync(join(tmpdir(), "litcodex-vendor-outside-"));
				roots.push(outside);
				const legacy = `${root}.legacy`;
				renameSync(root, legacy);
				symlinkSync(legacy, root, "dir");
			},
		],
		[
			"nonregular",
			(root: string) => {
				const legacy = `${root}.legacy`;
				renameSync(root, legacy);
				writeFileSync(root, "not a directory\n");
				rmSync(legacy, { recursive: true, force: true });
			},
		],
		[
			"unsupported",
			(root: string) => {
				const target = join(root, "unsupported-link");
				symlinkSync(join(root, "SKILL.md"), target, "file");
			},
		],
	] as const) {
		if (kind === "fifo" && process.platform === "win32") continue;
		for (const [numbered, canonical] of VENDOR_PAIRS) {
			it(`refuses ${kind} installed ${numbered} state before replacement`, () => {
				const paths = fixture();
				materializeManagedMarketplace(paths);
				const canonicalRoot = join(paths.targetRoot, "plugins/litcodex/vendor", canonical);
				const numberedRoot = join(paths.targetRoot, "plugins/litcodex/vendor", numbered);
				renameSync(canonicalRoot, numberedRoot);
				mutate(numberedRoot);

				expect(() => materializeManagedMarketplace(paths)).toThrow(/unsafe|legacy|vendor/i);
				expect(lstatSync(numberedRoot).isSymbolicLink() || existsSync(numberedRoot)).toBe(true);
				expect(existsSync(canonicalRoot)).toBe(false);
			});
		}
	}
});

function fixture(): { sourceRoot: string; targetRoot: string } {
	const root = mkdtempSync(join(tmpdir(), "litcodex-vendor-paths-"));
	roots.push(root);
	const sourceRoot = join(root, "package", "marketplace");
	const targetRoot = join(root, "home", "marketplaces", "litcodex");
	mkdirSync(join(sourceRoot, ".agents/plugins"), { recursive: true });
	mkdirSync(join(sourceRoot, "plugins/litcodex/.codex-plugin"), { recursive: true });
	writeFileSync(
		join(sourceRoot, ".agents/plugins/marketplace.json"),
		JSON.stringify({ name: "litcodex", plugins: [{ name: "litcodex", source: "./plugins/litcodex" }] }),
	);
	writeFileSync(
		join(sourceRoot, "plugins/litcodex/.codex-plugin/plugin.json"),
		JSON.stringify({ name: "litcodex", version: "1.0.0" }),
	);
	for (const [, canonical] of VENDOR_PAIRS) {
		const vendor = join(sourceRoot, "plugins/litcodex/vendor", canonical);
		mkdirSync(vendor, { recursive: true });
		writeFileSync(join(vendor, "SKILL.md"), canonical === "handoff" ? "handoff bytes\n" : "science bytes\n");
	}
	return { sourceRoot, targetRoot };
}
