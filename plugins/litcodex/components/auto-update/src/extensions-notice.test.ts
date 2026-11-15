import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extensionsNoticePath, takeExtensionsNotice } from "./extensions-notice.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function dataRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "litcodex-extensions-notice-"));
	roots.push(root);
	return root;
}

/** What `litcodex install` leaves for the next session when it lands a payload. */
function announce(root: string, message: string): NodeJS.ProcessEnv {
	const env = { LITCODEX_DATA_ROOT: root };
	writeFileSync(extensionsNoticePath(env), `${JSON.stringify({ schemaVersion: 1, version: "1.0.1", message })}\n`);
	return env;
}

const NOTICE = "LitFamily extensions\nLitCodex carries the LitFamily core.\n  litcodex extensions list";
const ledger = (root: string): string => join(root, "shown-notices.jsonl");

describe("the extensions notice is shown once per text", () => {
	it("shows a text once, however many upgrades announce it again", () => {
		const root = dataRoot();
		const env = announce(root, NOTICE);
		expect(takeExtensionsNotice(env)).toBe(NOTICE);
		announce(root, NOTICE);
		expect(takeExtensionsNotice(env)).toBeUndefined();
		announce(root, NOTICE);
		expect(takeExtensionsNotice(env)).toBeUndefined();
	});

	it("still claims the notice file when the text was shown before, so it cannot pile up", () => {
		const root = dataRoot();
		const env = announce(root, NOTICE);
		takeExtensionsNotice(env);
		announce(root, NOTICE);
		takeExtensionsNotice(env);
		expect(existsSync(extensionsNoticePath(env))).toBe(false);
	});

	it("shows a different text, and treats a change in spacing as the same text", () => {
		const root = dataRoot();
		const env = announce(root, NOTICE);
		expect(takeExtensionsNotice(env)).toBe(NOTICE);
		announce(root, `${NOTICE}\nLitCodex 1.0.40 left its runtimes in two folders.`);
		expect(takeExtensionsNotice(env)).toContain("left its runtimes");
		announce(root, NOTICE.replaceAll("\n", "\n\n"));
		expect(takeExtensionsNotice(env)).toBeUndefined();
	});

	it("keeps one hash and one time per shown text, and none of the text", () => {
		const root = dataRoot();
		const env = announce(root, NOTICE);
		takeExtensionsNotice(env);
		const lines = readFileSync(ledger(root), "utf8").trim().split("\n");
		expect(lines).toHaveLength(1);
		const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
		expect(Object.keys(entry).sort()).toEqual(["at", "hash"]);
		expect(readFileSync(ledger(root), "utf8")).not.toContain("LitFamily");
	});

	it("falls back to showing the notice when the record is corrupt, missing or unusable", () => {
		const corrupt = dataRoot();
		writeFileSync(ledger(corrupt), "\u0000not json {{\n[1,2]\n");
		expect(takeExtensionsNotice(announce(corrupt, NOTICE))).toBe(NOTICE);

		const missing = dataRoot();
		expect(takeExtensionsNotice(announce(missing, NOTICE))).toBe(NOTICE);
		expect(existsSync(ledger(missing))).toBe(true);

		const unusable = dataRoot();
		mkdirSync(ledger(unusable));
		const env = announce(unusable, NOTICE);
		expect(takeExtensionsNotice(env)).toBe(NOTICE);
		announce(unusable, NOTICE);
		expect(takeExtensionsNotice(env)).toBe(NOTICE);

		const oversized = dataRoot();
		writeFileSync(ledger(oversized), `${'{"hash":"0","at":1}\n'.repeat(5000)}`);
		expect(takeExtensionsNotice(announce(oversized, NOTICE))).toBe(NOTICE);
	});
});
