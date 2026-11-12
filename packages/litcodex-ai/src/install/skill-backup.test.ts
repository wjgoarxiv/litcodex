import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { materializeManagedMarketplace } from "./marketplace-payload.js";
import { LEGACY_SHIPPED_SKILL_DIGESTS } from "./shipped-skill-digests.js";

const NOW = Date.parse("2026-11-12T09:00:00Z");
const FULL_BODY = "---\nname: lit-pptx\n---\nThe whole deck procedure.\n";
const REFERENCE = "# Layout families\n";
const STUB = "---\nname: lit-pptx\n---\nThis is a stub.\n";
const digest = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);
const SHIPPED = [digest(FULL_BODY), digest(REFERENCE)];

describe("an upgrade keeps what the user put in LitCodex skill folders", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	function write(path: string, text: string): void {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	}

	function marketplace(root: string, version: string, skills: Record<string, string>): void {
		write(
			join(root, ".agents", "plugins", "marketplace.json"),
			JSON.stringify({
				name: "litcodex",
				plugins: [{ name: "litcodex", source: { source: "local", path: "./plugins/litcodex" } }],
			}),
		);
		write(
			join(root, "plugins", "litcodex", ".codex-plugin", "plugin.json"),
			JSON.stringify({ name: "litcodex", version }),
		);
		for (const [path, text] of Object.entries(skills)) write(join(root, "plugins", "litcodex", "skills", path), text);
	}

	function home(): { codexHome: string; sourceRoot: string; targetRoot: string } {
		const root = mkdtempSync(join(tmpdir(), "litcodex-skill-backup-"));
		roots.push(root);
		const codexHome = join(root, "codex-home");
		return {
			codexHome,
			sourceRoot: join(root, "package", "marketplace"),
			targetRoot: join(codexHome, "marketplaces", "litcodex"),
		};
	}

	it("saves added and edited files from the marketplace and the plugin cache to a dated folder outside the plugin tree", () => {
		const paths = home();
		marketplace(paths.sourceRoot, "1.0.39", { "lit-pptx/SKILL.md": STUB });
		marketplace(paths.targetRoot, "1.0.38", {
			"lit-pptx/SKILL.md": `${FULL_BODY}<!-- my team uses the dark template -->\n`,
			"lit-pptx/references/layouts.md": REFERENCE,
			"lit-pptx/my-team-notes.md": "notes from the marketplace copy\n",
		});
		const cache = join(paths.codexHome, "plugins", "cache", "litcodex", "litcodex", "1.0.38", "skills");
		write(join(cache, "lit-pptx", "SKILL.md"), FULL_BODY);
		write(join(cache, "lit-pptx", "my-team-notes.md"), "notes from the cache copy\n");

		const result = materializeManagedMarketplace({ ...paths, now: () => NOW, legacySkillDigests: SHIPPED });

		const backup = join(paths.codexHome, "litcodex-backups", "2026-11-12");
		expect(result).toMatchObject({ changed: true, version: "1.0.39", previousVersion: "1.0.38" });
		expect(result.backup).toEqual({ dir: backup, files: 3 });
		expect(result.warnings).toEqual([
			`LitCodex saved 3 files you added or changed in its skill folders to ${backup} before replacing them.`,
		]);
		expect(readFileSync(join(backup, "marketplace", "lit-pptx", "SKILL.md"), "utf8")).toContain("dark template");
		expect(readFileSync(join(backup, "marketplace", "lit-pptx", "my-team-notes.md"), "utf8")).toBe(
			"notes from the marketplace copy\n",
		);
		expect(readFileSync(join(backup, "plugin-cache-1.0.38", "lit-pptx", "my-team-notes.md"), "utf8")).toBe(
			"notes from the cache copy\n",
		);
		expect(existsSync(join(backup, "marketplace", "lit-pptx", "references"))).toBe(false);
		expect(existsSync(join(backup, "plugin-cache-1.0.38", "lit-pptx", "SKILL.md"))).toBe(false);
		expect(
			readFileSync(join(paths.targetRoot, "plugins", "litcodex", "skills", "lit-pptx", "SKILL.md"), "utf8"),
		).toBe(STUB);
		expect(existsSync(join(paths.targetRoot, "plugins", "litcodex", "skills", "lit-pptx", "my-team-notes.md"))).toBe(
			false,
		);
		expect(readFileSync(join(cache, "lit-pptx", "my-team-notes.md"), "utf8")).toBe("notes from the cache copy\n");
	});

	it("leaves no backup folder when every old file is LitCodex's own", () => {
		const paths = home();
		marketplace(paths.sourceRoot, "1.0.39", { "lit-pptx/SKILL.md": STUB });
		marketplace(paths.targetRoot, "1.0.38", {
			"lit-pptx/SKILL.md": FULL_BODY,
			"lit-pptx/references/layouts.md": REFERENCE,
			"lit-pptx/.DS_Store": "finder",
		});

		const result = materializeManagedMarketplace({ ...paths, now: () => NOW, legacySkillDigests: SHIPPED });

		expect(result).toEqual({ changed: true, version: "1.0.39", previousVersion: "1.0.38" });
		expect(existsSync(join(paths.codexHome, "litcodex-backups"))).toBe(false);
	});

	it("records each install, so the next upgrade knows the files it shipped", () => {
		const paths = home();
		marketplace(paths.sourceRoot, "1.0.39", { "lit-pptx/SKILL.md": STUB, "lit-plan/SKILL.md": "plan v1\n" });
		materializeManagedMarketplace({ ...paths, now: () => NOW, legacySkillDigests: [] });
		const record = JSON.parse(
			readFileSync(join(paths.codexHome, "litcodex", "installed-skill-digests.json"), "utf8"),
		) as { version: string; digests: string[] };
		expect(record.version).toBe("1.0.39");
		expect(record.digests).toEqual([digest(STUB), digest("plan v1\n")].sort());

		rmSync(paths.sourceRoot, { recursive: true, force: true });
		marketplace(paths.sourceRoot, "1.0.40", { "lit-pptx/SKILL.md": `${STUB}v2\n`, "lit-plan/SKILL.md": "plan v2\n" });
		const result = materializeManagedMarketplace({ ...paths, now: () => NOW, legacySkillDigests: [] });

		expect(result).toEqual({ changed: true, version: "1.0.40", previousVersion: "1.0.39" });
		expect(existsSync(join(paths.codexHome, "litcodex-backups"))).toBe(false);
	});

	it("saves the plugin cache before --force rebuilds it, even when the payload is already current", () => {
		const paths = home();
		marketplace(paths.sourceRoot, "1.0.39", { "lit-pptx/SKILL.md": STUB });
		materializeManagedMarketplace({ ...paths, now: () => NOW, legacySkillDigests: [] });
		const cache = join(paths.codexHome, "plugins", "cache", "litcodex", "litcodex", "1.0.39", "skills");
		write(join(cache, "lit-pptx", "SKILL.md"), STUB);
		write(join(cache, "lit-loop", "my-notes.md"), "notes in the current cache\n");

		const plain = materializeManagedMarketplace({ ...paths, now: () => NOW, legacySkillDigests: [] });
		expect(plain).toEqual({ changed: false, version: "1.0.39" });
		expect(existsSync(join(paths.codexHome, "litcodex-backups"))).toBe(false);

		const forced = materializeManagedMarketplace({
			...paths,
			now: () => NOW,
			legacySkillDigests: [],
			pluginCacheRebuilt: true,
		});
		const backup = join(paths.codexHome, "litcodex-backups", "2026-11-12");
		expect(forced).toMatchObject({ changed: false, version: "1.0.39", backup: { dir: backup, files: 1 } });
		expect(forced.warnings).toEqual([
			`LitCodex saved 1 file you added or changed in its skill folders to ${backup} before replacing them.`,
		]);
		expect(readFileSync(join(backup, "plugin-cache-1.0.39", "lit-loop", "my-notes.md"), "utf8")).toBe(
			"notes in the current cache\n",
		);
		expect(existsSync(join(backup, "plugin-cache-1.0.39", "lit-pptx"))).toBe(false);
	});

	it("uses a new folder for a second upgrade on the same day", () => {
		const paths = home();
		mkdirSync(join(paths.codexHome, "litcodex-backups", "2026-11-12"), { recursive: true });
		marketplace(paths.sourceRoot, "1.0.39", { "lit-pptx/SKILL.md": STUB });
		marketplace(paths.targetRoot, "1.0.38", { "lit-pptx/mine.md": "mine\n" });

		const result = materializeManagedMarketplace({ ...paths, now: () => NOW, legacySkillDigests: SHIPPED });

		expect(result.backup?.dir).toBe(join(paths.codexHome, "litcodex-backups", "2026-11-12-2"));
		expect(readdirSync(join(paths.codexHome, "litcodex-backups", "2026-11-12"))).toEqual([]);
	});

	it("ships a frozen list of earlier skill files as 16-character digests", () => {
		expect(LEGACY_SHIPPED_SKILL_DIGESTS.length).toBeGreaterThan(1000);
		expect(LEGACY_SHIPPED_SKILL_DIGESTS.every((value) => /^[0-9a-f]{16}$/u.test(value))).toBe(true);
		expect(new Set(LEGACY_SHIPPED_SKILL_DIGESTS).size).toBe(LEGACY_SHIPPED_SKILL_DIGESTS.length);
	});
});
