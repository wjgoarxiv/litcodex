import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const GUARD = join(skillRoot, "fixtures", "forbidden-guard.txt");

function guard() {
	const rows = readFileSync(GUARD, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
	const pick = (kind: string) => rows.filter((r) => r.startsWith(`${kind} `)).map((r) => r.slice(kind.length + 1).trim());
	return {
		forbidden: pick("forbidden").map((r) => r.split(/\s+/u)[0]),
		methodOnly: pick("method-only").map((r) => r.split(/\s+/u)[0]),
		hershey: pick("hershey").map((r) => r.split(/\s+/u)[0]),
		sceneIds: pick("scene-id"),
	};
}

/** sha256 of every regular file under root; statSync follows symlinks so a linked blob is hashed too. */
export function hashTree(root: string): Map<string, string> {
	const out = new Map<string, string>();
	const pending = [root];
	while (pending.length) {
		const dir = pending.pop() as string;
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			let stat;
			try {
				stat = statSync(path);
			} catch {
				continue;
			}
			if (stat.isDirectory()) pending.push(path);
			else if (stat.isFile()) out.set(path, createHash("sha256").update(readFileSync(path)).digest("hex"));
		}
	}
	return out;
}

describe("MO-A-49 / MO-FT-08 forbidden-content guard", () => {
	const data = guard();
	const banned = new Set([...data.forbidden, ...data.methodOnly, ...data.hershey]);

	it("carries the spec's 61-row table, the two method-only files and the three Hershey faces", () => {
		expect(data.forbidden).toHaveLength(61);
		expect(new Set(data.forbidden).size).toBe(61);
		expect(data.methodOnly).toEqual(["70da9c14dedbc4bba92906967f0b4e3cab024855ac740d2e89eb3a90ba983acc", "ac2f817836a14789b2f17e8e834714600621b316862bc855defd9f24785c5e8a"]);
		expect(data.hershey).toHaveLength(3);
		for (const hash of banned) expect(hash).toMatch(/^[0-9a-f]{64}$/u);
	});

	it("finds no banned blob among the repository's tracked files", () => {
		const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
		const hits: string[] = [];
		for (const file of tracked) {
			const path = join(repoRoot, file);
			if (!existsSync(path) || !statSync(path).isFile()) continue;
			if (banned.has(createHash("sha256").update(readFileSync(path)).digest("hex"))) hits.push(file);
		}
		expect(hits).toEqual([]);
	});

	it("finds no banned blob in the skill payload, following symlinks", () => {
		const hits = [...hashTree(skillRoot)].filter(([, hash]) => banned.has(hash)).map(([path]) => relative(skillRoot, path));
		expect(hits).toEqual([]);
	});

	it("keeps the method-only scene-id keys out of every shipped file", () => {
		const hits: string[] = [];
		for (const [path] of hashTree(skillRoot)) {
			const rel = relative(skillRoot, path);
			if (rel.startsWith("fixtures/") || rel.endsWith(".test.ts") || !/\.(mjs|js|md|json|yaml|txt|py)$|NOTICE/u.test(rel)) continue;
			const text = readFileSync(path, "utf8").toLowerCase();
			for (const key of data.sceneIds) if (text.includes(key)) hits.push(`${rel}: ${key}`);
		}
		expect(hits).toEqual([]);
	});

	it("finds no banned blob in a pre-warmed motion cache when one is provided", (context) => {
		const xdg = process.env.LITCODEX_MOTION_TEST_XDG;
		if (!xdg) {
			context.skip("LITCODEX_MOTION_TEST_XDG not set: no pre-warmed cache to scan");
			return;
		}
		const root = join(xdg, "litcodex", "motion-runtime");
		const hits = [...hashTree(root)].filter(([, hash]) => banned.has(hash)).map(([path]) => path);
		expect(hits).toEqual([]);
	});
});
