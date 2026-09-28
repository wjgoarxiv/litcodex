import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SKILL_RENAMES } from "../../../../plugins/litcodex/components/lit-loop/src/skill-renames.js";
import { materializeManagedMarketplace } from "./marketplace-payload.js";

describe("materializeManagedMarketplace", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function fixture(version: string): { sourceRoot: string; targetRoot: string } {
		const root = mkdtempSync(join(tmpdir(), "litcodex-marketplace-"));
		roots.push(root);
		const sourceRoot = join(root, "package", "marketplace");
		const targetRoot = join(root, "missing-codex-home", "marketplaces", "litcodex");
		mkdirSync(join(sourceRoot, ".agents", "plugins"), { recursive: true });
		mkdirSync(join(sourceRoot, "plugins", "litcodex", ".codex-plugin"), { recursive: true });
		writeFileSync(
			join(sourceRoot, ".agents", "plugins", "marketplace.json"),
			JSON.stringify({ name: "litcodex", plugins: [{ name: "litcodex", source: "./plugins/litcodex" }] }),
		);
		writeFileSync(
			join(sourceRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json"),
			JSON.stringify({ name: "litcodex", version }),
		);
		writeFileSync(join(sourceRoot, "plugins", "litcodex", "payload.txt"), "canonical");
		return { sourceRoot, targetRoot };
	}

	function writeLegacySkill(target: string, modified: boolean): void {
		const fixtureRoot = new URL("./test-fixtures/legacy-lit-korean/", import.meta.url);
		for (const path of [
			"SKILL.md",
			"references/prompt-injection-handling.md",
			"references/quick-rules.md",
			"references/safety-checklist.md",
		]) {
			const destination = join(target, path);
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, readFileSync(new URL(path, fixtureRoot)));
		}
		if (modified) {
			const entrypoint = join(target, "SKILL.md");
			writeFileSync(entrypoint, `${readFileSync(entrypoint, "utf8")}\nUser modification preserved.\n`);
		}
	}

	it.each(
		Object.entries(SKILL_RENAMES).filter(([oldId]) => oldId !== "lit-korean"),
	)("migrates installed %s to %s on same-version install/update", (oldId, newId) => {
		// Given: a previously managed marketplace plus unrelated user skills.
		const paths = fixture("0.4.8");
		const sourceSkill = join(paths.sourceRoot, "plugins", "litcodex", "skills", newId);
		const oldSkill = join(paths.targetRoot, "plugins", "litcodex", "skills", oldId);
		materializeManagedMarketplace(paths);
		mkdirSync(oldSkill, { recursive: true });
		writeFileSync(join(oldSkill, "SKILL.md"), `name: ${oldId}\n`);
		mkdirSync(sourceSkill, { recursive: true });
		const body = readFileSync(
			new URL(`../../../../plugins/litcodex/skills/${newId}/SKILL.md`, import.meta.url),
			"utf8",
		);
		writeFileSync(join(sourceSkill, "SKILL.md"), body);
		const userSkill = join(paths.targetRoot, "..", "user-owned-skill.md");
		writeFileSync(userSkill, "preserve user content");
		// When: the unchanged-version package is installed again.
		const result = materializeManagedMarketplace(paths);
		// Then: the manifest and hashed tree replace the entire managed copy.
		expect(result).toEqual({ changed: true, version: "0.4.8" });
		expect(existsSync(oldSkill)).toBe(false);
		expect(readFileSync(join(paths.targetRoot, "plugins", "litcodex", "skills", newId, "SKILL.md"), "utf8")).toBe(
			body,
		);
		expect(readFileSync(userSkill, "utf8")).toBe("preserve user content");
		expect(materializeManagedMarketplace(paths).changed).toBe(false);
	});

	it("removes an unchanged legacy skill while installing its replacement", () => {
		const paths = fixture("0.4.8");
		materializeManagedMarketplace(paths);
		const oldSkill = join(paths.targetRoot, "plugins", "litcodex", "skills", "lit-korean");
		const newSkill = join(paths.sourceRoot, "plugins", "litcodex", "skills", "lit-humanizer");
		writeLegacySkill(oldSkill, false);
		mkdirSync(newSkill, { recursive: true });
		writeFileSync(join(newSkill, "SKILL.md"), "name: lit-humanizer\n");

		const result = materializeManagedMarketplace(paths);

		expect(result).toEqual({ changed: true, version: "0.4.8" });
		expect(existsSync(oldSkill)).toBe(false);
		expect(
			readFileSync(join(paths.targetRoot, "plugins", "litcodex", "skills", "lit-humanizer", "SKILL.md"), "utf8"),
		).toBe("name: lit-humanizer\n");
	});

	it("keeps a modified legacy skill with one warning and completes the update", () => {
		const paths = fixture("0.4.8");
		materializeManagedMarketplace(paths);
		const oldSkill = join(paths.targetRoot, "plugins", "litcodex", "skills", "lit-korean");
		const newSkill = join(paths.sourceRoot, "plugins", "litcodex", "skills", "lit-humanizer");
		writeLegacySkill(oldSkill, true);
		mkdirSync(newSkill, { recursive: true });
		writeFileSync(join(newSkill, "SKILL.md"), "name: lit-humanizer\n");

		const result = materializeManagedMarketplace(paths);

		expect(result).toMatchObject({
			changed: true,
			warnings: [
				"LitCodex kept a modified lit-korean skill copy; review or remove it from the managed marketplace.",
			],
		});
		expect(readFileSync(join(oldSkill, "SKILL.md"), "utf8")).toContain("User modification preserved.");
		expect(existsSync(join(paths.targetRoot, "plugins", "litcodex", "skills", "lit-humanizer", "SKILL.md"))).toBe(
			true,
		);
		expect(materializeManagedMarketplace(paths)).toEqual({ changed: false, version: "0.4.8" });
	});

	it("creates a missing CODEX_HOME tree and copies a complete local marketplace", () => {
		const paths = fixture("0.3.44");
		const result = materializeManagedMarketplace(paths);
		expect(result.changed).toBe(true);
		expect(existsSync(join(paths.targetRoot, ".agents", "plugins", "marketplace.json"))).toBe(true);
		expect(existsSync(join(paths.targetRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json"))).toBe(true);
	});

	it("copies the plugin logo asset with the managed payload", () => {
		const paths = fixture("0.3.44");
		const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x4c, 0x49, 0x54]);
		mkdirSync(join(paths.sourceRoot, "plugins", "litcodex", "assets"), { recursive: true });
		writeFileSync(join(paths.sourceRoot, "plugins", "litcodex", "assets", "logo.png"), logo);

		materializeManagedMarketplace(paths);

		expect(readFileSync(join(paths.targetRoot, "plugins", "litcodex", "assets", "logo.png"))).toEqual(logo);
	});

	it("atomically replaces a stale managed payload", () => {
		const paths = fixture("0.3.44");
		materializeManagedMarketplace(paths);
		writeFileSync(
			join(paths.targetRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json"),
			JSON.stringify({ name: "litcodex", version: "0.3.28" }),
		);
		writeFileSync(join(paths.targetRoot, "stale.txt"), "old");

		materializeManagedMarketplace(paths);

		const manifest = JSON.parse(
			readFileSync(join(paths.targetRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json"), "utf8"),
		) as { version: string };
		expect(manifest.version).toBe("0.3.44");
		expect(existsSync(join(paths.targetRoot, "stale.txt"))).toBe(false);
	});

	it("keeps a byte-exact same-version managed payload as a no-op", () => {
		// Given
		const paths = fixture("0.3.44");
		materializeManagedMarketplace(paths);

		// When
		const result = materializeManagedMarketplace(paths);

		// Then
		expect(result).toEqual({ changed: false, version: "0.3.44" });
	});

	it.each([
		[
			"tampered file",
			(targetRoot: string, _outsideSentinel: string) =>
				writeFileSync(join(targetRoot, "plugins", "litcodex", "payload.txt"), "tampered"),
		],
		[
			"missing file",
			(targetRoot: string, _outsideSentinel: string) =>
				rmSync(join(targetRoot, "plugins", "litcodex", "payload.txt")),
		],
		[
			"orphan file",
			(targetRoot: string, _outsideSentinel: string) =>
				writeFileSync(join(targetRoot, "plugins", "litcodex", "orphan.txt"), "orphan"),
		],
		[
			"installed test file",
			(targetRoot: string, _outsideSentinel: string) => {
				const tests = join(targetRoot, "plugins", "litcodex", "skills", "probe", "tests");
				mkdirSync(tests, { recursive: true });
				writeFileSync(join(tests, "orphan.test.ts"), "orphan");
			},
		],
		[
			"symlink to an outside file",
			(targetRoot: string, outsideSentinel: string) =>
				symlinkSync(outsideSentinel, join(targetRoot, "plugins", "litcodex", "orphan-link")),
		],
		[
			"broken symlink",
			(targetRoot: string, _outsideSentinel: string) =>
				symlinkSync(join(targetRoot, "absent"), join(targetRoot, "plugins", "litcodex", "broken-link")),
		],
		[
			"empty directory",
			(targetRoot: string, _outsideSentinel: string) =>
				mkdirSync(join(targetRoot, "plugins", "litcodex", "empty-orphan")),
		],
	])("repairs a same-version managed payload with a %s without touching outside files", (_case, mutate) => {
		// Given
		const paths = fixture("0.3.44");
		materializeManagedMarketplace(paths);
		const outsideSentinel = join(paths.targetRoot, "..", "user-owned.txt");
		const outsideBytes = Buffer.from([0x00, 0xff, 0x4c, 0x49, 0x54]);
		writeFileSync(outsideSentinel, outsideBytes);
		mutate(paths.targetRoot, outsideSentinel);

		// When
		const result = materializeManagedMarketplace(paths);

		// Then
		expect(result).toEqual({ changed: true, version: "0.3.44" });
		expect(readFileSync(join(paths.targetRoot, "plugins", "litcodex", "payload.txt"), "utf8")).toBe("canonical");
		expect(readdirSync(join(paths.targetRoot, "plugins", "litcodex"))).not.toEqual(
			expect.arrayContaining(["orphan.txt", "orphan-link", "broken-link", "empty-orphan"]),
		);
		expect(existsSync(join(paths.targetRoot, "plugins", "litcodex", "skills", "probe", "tests"))).toBe(false);
		expect(readFileSync(outsideSentinel)).toEqual(outsideBytes);
	});

	it.each([
		"home-link",
		"parent-link",
		"root-link",
		"foreign-directory",
		"foreign-file",
	])("refuses %s before replacing a foreign marketplace path", (kind) => {
		const paths = fixture("0.3.44");
		const home = dirname(dirname(paths.targetRoot));
		const outside = join(dirname(home), "outside");
		mkdirSync(outside);
		let sentinel = join(outside, "keep.txt");
		if (kind === "home-link") {
			mkdirSync(join(outside, "marketplaces", "litcodex"), { recursive: true });
			sentinel = join(outside, "marketplaces", "litcodex", "keep.txt");
			symlinkSync(outside, home);
		} else if (kind === "parent-link") {
			mkdirSync(home);
			mkdirSync(join(outside, "litcodex"));
			sentinel = join(outside, "litcodex", "keep.txt");
			symlinkSync(outside, dirname(paths.targetRoot));
		} else {
			mkdirSync(dirname(paths.targetRoot), { recursive: true });
			if (kind === "root-link") symlinkSync(outside, paths.targetRoot);
			else if (kind === "foreign-file") {
				writeFileSync(paths.targetRoot, "user-owned");
				sentinel = paths.targetRoot;
			} else {
				mkdirSync(paths.targetRoot);
				sentinel = join(paths.targetRoot, "keep.txt");
			}
		}
		writeFileSync(sentinel, "user-owned");
		expect(() => materializeManagedMarketplace(paths)).toThrow(/unsafe|ownership/i);
		expect(readFileSync(sentinel, "utf8")).toBe("user-owned");
	});

	it("uses a Node 20-compatible explicit directory walk", () => {
		// Given
		const source = ["./file-walk.ts", "./marketplace-payload.ts", "./index.ts"]
			.map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
			.join("\n");

		// When
		const usesRecursiveDirents = /readdirSync\([^;]*recursive\s*:/s.test(source) || source.includes(".parentPath");

		// Then
		expect(usesRecursiveDirents).toBe(false);
	});
});
