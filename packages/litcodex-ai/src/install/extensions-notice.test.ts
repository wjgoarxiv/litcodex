import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { announceExtensions, leftoverRuntimePaths, renderExtensionsNotice } from "./extensions-notice.js";

const INSTALL_LINES = [
	"git clone https://github.com/wjgoarxiv/wjgoarxiv-skills",
	`mkdir -p "\${CODEX_HOME:-$HOME/.codex}/skills"`,
	`cp -R wjgoarxiv-skills/variants/litcodex/lit-docx "\${CODEX_HOME:-$HOME/.codex}/skills/lit-docx"`,
];

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
		for (const line of INSTALL_LINES) expect(text).toContain(`  ${line}\n`);
		expect(text).not.toMatch(/runtimes|delete/u);
		expect(text).not.toMatch(/\u001b/u);
		expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(10);
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
