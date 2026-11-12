import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
	announceExtensions,
	CLONE_PLACEHOLDER,
	extensionInstallLines,
	leftoverRuntimePaths,
	renderExtensionsNotice,
} from "./extensions-notice.js";

const INSTALL_LINES = ["git clone https://github.com/wjgoarxiv/wjgoarxiv-skills", ...extensionInstallLines("lit-docx")];
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("the LitFamily extensions notice", () => {
	const roots: string[] = [];
	afterEach(() => {
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});
	const scratch = (): string => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-extensions-notice-"));
		roots.push(root);
		return root;
	};

	it("says the core is complete, names the extension shelf and gives the Codex copy lines, in under ten lines", () => {
		const text = renderExtensionsNotice({ leftovers: [] });
		expect(text).toContain("LitFamily core, which is complete and works on its own");
		expect(text).toContain(
			"are now LitFamily extensions, kept in the extension shelf https://github.com/wjgoarxiv/wjgoarxiv-skills",
		);
		expect(text).toContain("full LitFamily experience");
		expect(text).toContain("  litcodex extensions list\n  litcodex extensions install lit-docx --yes\n");
		expect(text).toContain("`litcodex extensions update --yes`");
		expect(text).toContain("only shows its plan until you add --yes");
		expect(text).not.toMatch(/runtimes|delete/u);
		expect(text).not.toMatch(/cp -R wjgoarxiv-skills/u);
		expect(text).toContain("extension-backups/");
		expect(text).not.toMatch(/\u001b/u);
		expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(10);
	});

	it("adds the one check line for an existing user whose extension folders need a look", () => {
		const line =
			"2 things about your extension folders need a look: run `litcodex extensions check`. Nothing was changed.";
		const text = renderExtensionsNotice({
			previousVersion: "1.0.38",
			leftovers: ["/h/.cache/litcodex/office"],
			checkLine: line,
		});
		expect(text).toContain(`${line}\n`);
		expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(10);
		expect(renderExtensionsNotice({ leftovers: [] })).not.toContain("extensions check");
	});

	it("on an upgrade names the runtimes the old version left behind and says they can be deleted", () => {
		const cache = "/h/.cache";
		const leftovers = leftoverRuntimePaths({ XDG_CACHE_HOME: cache }, () => true);
		expect(leftovers).toEqual([`${cache}/litcodex/office`, `${cache}/litcodex/motion-runtime`]);
		const text = renderExtensionsNotice({ previousVersion: "1.0.38", leftovers });
		expect(text).toContain(
			"LitCodex 1.0.38 left its office and film runtimes in /h/.cache/litcodex/office and /h/.cache/litcodex/motion-runtime; you can delete them if you do not install those extensions.",
		);
		expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(10);
		expect(leftoverRuntimePaths({ HOME: "/h" }, (path) => path.endsWith("motion-runtime"))).toEqual([
			"/h/.cache/litcodex/motion-runtime",
		]);
	});

	it("prints on install or update and leaves the notice for the first Codex session", () => {
		const root = scratch();
		const out: string[] = [];
		announceExtensions({
			payload: { changed: true, version: "1.0.39", previousVersion: "1.0.38" },
			env: { LITCODEX_DATA_ROOT: join(root, "data"), XDG_CACHE_HOME: join(root, "cache") },
			json: false,
			write: (text) => out.push(text),
			exists: () => true,
		});
		expect(out.join("")).toContain("LitFamily extensions");
		expect(out.join("")).toContain(`${join(root, "cache")}/litcodex/motion-runtime`);
		const marker = JSON.parse(readFileSync(join(root, "data", "extensions-notice.json"), "utf8")) as {
			version: string;
			message: string;
		};
		expect(marker.version).toBe("1.0.39");
		expect(marker.message).toBe(out.join("").trim());
	});

	it("stays out of --json output but still leaves the session notice", () => {
		const root = scratch();
		const out: string[] = [];
		announceExtensions({
			payload: { changed: true, version: "1.0.39" },
			env: { LITCODEX_DATA_ROOT: join(root, "data") },
			json: true,
			write: (text) => out.push(text),
		});
		expect(out).toEqual([]);
		expect(existsSync(join(root, "data", "extensions-notice.json"))).toBe(true);
	});

	it("says nothing when the payload was already current", () => {
		const root = scratch();
		const out: string[] = [];
		announceExtensions({
			payload: { changed: false, version: "1.0.39" },
			env: { LITCODEX_DATA_ROOT: join(root, "data") },
			json: false,
			write: (text) => out.push(text),
		});
		expect(out).toEqual([]);
		expect(existsSync(join(root, "data", "extensions-notice.json"))).toBe(false);
	});
});

describe("the Codex extension install lines", () => {
	it("the four READMEs give the same lines for lit-docx and say where an old copy goes", () => {
		for (const file of [
			"README.md",
			"README-Ko-KR.md",
			"packages/litcodex-ai/README.md",
			"packages/litcodex-ai/README-Ko-KR.md",
		]) {
			const text = readFileSync(join(REPO_ROOT, file), "utf8");
			expect(text, file).toContain(`\`\`\`bash\n${INSTALL_LINES.join("\n")}\n\`\`\``);
			expect(text, file).not.toMatch(/cp -R wjgoarxiv-skills/u);
			expect(text, file).toContain("extension-backups/");
		}
	});

	it("each line stands alone, so a line pasted by itself never runs with an empty path", () => {
		const [check, moveAside, copy, receipt] = extensionInstallLines("lit-docx");
		for (const line of [check, moveAside, copy, receipt]) {
			expect(line).toMatch(/^cx="\$\{CODEX_HOME:-\$HOME\/\.codex\}"; /u);
			expect(line).not.toMatch(/rm -|\n/u);
		}
		expect(moveAside).toContain("extension-backups/$(date +%Y%m%d-%H%M%S)");
		expect(copy).toContain(`cp -R "${CLONE_PLACEHOLDER}/variants/litcodex/lit-docx" "$cx/skills/lit-docx"`);
		expect(receipt).toContain("/.litfamily-extension.json");
	});

	const shells = ["/bin/bash", "/bin/zsh"].filter((shell) => existsSync(shell));
	it.each(shells)("in %s: fresh install, install over a user folder, update, remove", (shell) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-extension-lines-"));
		try {
			const id = "lit-docx";
			const clone = join(root, "clone");
			const variant = join(clone, "variants", "litcodex", id);
			mkdirSync(join(variant, "references"), { recursive: true });
			writeFileSync(join(variant, "SKILL.md"), "---\nname: lit-docx\ndescription: v1\n---\n");
			writeFileSync(join(variant, "references", "a.md"), "a\n");
			const home = join(root, "home");
			const codexHome = join(home, ".codex");
			const project = join(root, "project");
			mkdirSync(project, { recursive: true });
			mkdirSync(join(home, ".agents", "skills", id), { recursive: true });
			const run = (lines: readonly string[]): string => {
				const result = spawnSync(shell, ["-c", lines.join("\n")], {
					cwd: project,
					encoding: "utf8",
					env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: home, CODEX_HOME: codexHome },
				});
				expect(result.status, result.stderr).toBe(0);
				return result.stdout;
			};
			const lines = extensionInstallLines(id, clone);
			const skill = join(codexHome, "skills", id);
			const backups = join(codexHome, "extension-backups");
			const receipt = (): Record<string, string> =>
				JSON.parse(readFileSync(join(skill, ".litfamily-extension.json"), "utf8")) as Record<string, string>;

			// 1. Fresh install: the check names only the other same-name folder Codex reads.
			const first = run(lines);
			expect(first).toContain(`found: ${join(home, ".agents", "skills", id)}`);
			expect(first).not.toContain(`found: ${skill}`);
			expect(readdirSync(skill).sort()).toEqual([".litfamily-extension.json", "SKILL.md", "references"]);
			expect(receipt()).toMatchObject({ id, source: variant, variant: "litcodex" });
			expect(existsSync(backups)).toBe(false);

			// 2. Over a user folder: it moves aside whole, outside the skills tree, and the copy does not nest.
			rmSync(skill, { recursive: true });
			mkdirSync(skill, { recursive: true });
			writeFileSync(join(skill, "my-notes.md"), "mine\n");
			expect(run(lines)).toContain(`found: ${skill}`);
			const [stamp] = readdirSync(backups);
			expect(readFileSync(join(backups, String(stamp), id, "my-notes.md"), "utf8")).toBe("mine\n");
			expect(readdirSync(skill).sort()).toEqual([".litfamily-extension.json", "SKILL.md", "references"]);
			expect(existsSync(join(skill, id))).toBe(false);

			// 3. Update: the same lines again replace the copy and rewrite the receipt.
			writeFileSync(join(variant, "SKILL.md"), "---\nname: lit-docx\ndescription: v2\n---\n");
			writeFileSync(join(skill, ".litfamily-extension.json"), "{}\n");
			spawnSync("sleep", ["1"]);
			run(lines);
			expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toContain("v2");
			expect(receipt()).toMatchObject({ id, source: variant });
			expect(readdirSync(backups)).toHaveLength(2);

			// The copy line refuses to land on an occupied folder.
			expect(run([lines[2] as string])).toContain(`stopped: ${skill} still exists`);
			expect(existsSync(join(skill, id))).toBe(false);

			// Remove: the move-aside line alone.
			spawnSync("sleep", ["1"]);
			run([lines[1] as string]);
			expect(existsSync(skill)).toBe(false);
			expect(readdirSync(backups)).toHaveLength(3);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
