import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(REPO_ROOT, "check-payload-substance.mjs");

function cleanEnvironment(overrides = {}) {
	const environment = { ...process.env };
	delete environment.LITCODEX_FAMILY_ROOT;
	delete environment.LITCODEX_FAMILY_LAYOUT;
	return { ...environment, ...overrides };
}

function runChecker(args = [], env = cleanEnvironment()) {
	return spawnSync(process.execPath, [CHECKER, ...args], { cwd: REPO_ROOT, encoding: "utf8", env });
}

test("payload substance gate accepts the current packed skill tree", () => {
	const result = runChecker();
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /PAYLOAD_SUBSTANCE_PASS/);
});

test("packed SKILL.md references resolve against the npm payload", () => {
	const result = runChecker();
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /PAYLOAD_REFERENCES_PASS: claims=\d+ exemptions=\d+/);
});

test("cross-product payload parity always checks the committed family manifest", () => {
	const result = runChecker();
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /PAYLOAD_PARITY_PASS: source=manifest fraction=0\.5/);
	assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=autoresearch median=30 closures=.*p31:30/);
	assert.match(result.stdout, /PAYLOAD_PARITY_ROW skill=lit-plan median=2 closures=.*p31:5/);
});

test("family freshness probe reports not configured by default", () => {
	const result = runChecker();
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /PAYLOAD_FAMILY_LAYOUT_NOT_CONFIGURED: freshness skipped/);
	assert.doesNotMatch(result.stdout, /PAYLOAD_PARITY_FRESHNESS_PASS/);
});

test("malformed family layout is rejected clearly", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-family-layout-invalid-"));
	try {
		const result = runChecker([], cleanEnvironment({ LITCODEX_FAMILY_ROOT: root, LITCODEX_FAMILY_LAYOUT: "{" }));
		assert.equal(result.status, 2);
		assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_FAMILY_LAYOUT_INVALID/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("payload substance gate names an unallowlisted hollow skill", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-substance-hollow-"));
	try {
		const skills = join(root, "skills");
		mkdirSync(join(skills, "solid"), { recursive: true });
		mkdirSync(join(skills, "hollow"), { recursive: true });
		writeFileSync(join(skills, "solid", "SKILL.md"), "solid\n");
		writeFileSync(join(skills, "hollow", "SKILL.md"), "hollow\n");
		const allowlist = join(root, "allowlist.json");
		writeFileSync(
			allowlist,
			JSON.stringify({
				schema: "litfamily.payload-substance/v1",
				skills: { solid: "This bounded instruction is complete for its procedural review." },
			}),
		);
		const pack = join(root, "pack.json");
		writeFileSync(
			pack,
			JSON.stringify([
				{
					files: [
						{ path: "plugins/litcodex/skills/solid/SKILL.md" },
						{ path: "plugins/litcodex/skills/hollow/SKILL.md" },
					],
				},
			]),
		);
		const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
		assert.notEqual(result.status, 0);
		assert.match(`${result.stdout}\n${result.stderr}`, /PAYLOAD_SUBSTANCE_FAIL/);
		assert.match(`${result.stdout}\n${result.stderr}`, /hollow/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("payload reference gate names the missing token", () => {
	const root = mkdtempSync(join(tmpdir(), "litcodex-reference-missing-"));
	try {
		const skills = join(root, "skills");
		mkdirSync(join(skills, "hollow"), { recursive: true });
		writeFileSync(join(skills, "hollow", "SKILL.md"), "This skill claims `references/not-packed.md`.\n");
		const allowlist = join(root, "allowlist.json");
		writeFileSync(
			allowlist,
			JSON.stringify({
				schema: "litfamily.payload-substance/v1",
				skills: {
					hollow: "This bounded fixture contains the complete instruction body for its procedural review.",
				},
			}),
		);
		const pack = join(root, "pack.json");
		writeFileSync(pack, JSON.stringify([{ files: [{ path: "plugins/litcodex/skills/hollow/SKILL.md" }] }]));
		const result = runChecker(["--skill-root", skills, "--allowlist-file", allowlist, "--pack-json", pack]);
		assert.notEqual(result.status, 0);
		assert.match(
			`${result.stdout}\n${result.stderr}`,
			/PAYLOAD_REFERENCE_FAIL skill=hollow token=references\/not-packed\.md/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
