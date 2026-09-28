import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const repoRoot = new URL("../", import.meta.url);

describe("lock-owned Codex host contract", () => {
	it("pins the officially tested host as an exact root devDependency and lock entry", () => {
		const manifest = JSON.parse(readFileSync(new URL("package.json", repoRoot), "utf8"));
		const lock = JSON.parse(readFileSync(new URL("package-lock.json", repoRoot), "utf8"));
		assert.equal(manifest.devDependencies["@openai/codex"], "0.144.0");
		assert.equal(lock.packages[""].devDependencies["@openai/codex"], "0.144.0");
		assert.equal(lock.packages["node_modules/@openai/codex"].version, "0.144.0");
		assert.equal(lock.packages["node_modules/@openai/codex"].bin.codex, "bin/codex.js");
	});
});
