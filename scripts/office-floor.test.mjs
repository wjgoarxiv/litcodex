import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const protectedHome = process.env.LITCODEX_TEST_PROTECTED_HOME;
const userSite = protectedHome
	? spawnSync("python3", ["-c", "import site; print(site.getusersitepackages())"], {
			encoding: "utf8",
			env: { ...process.env, HOME: protectedHome },
		}).stdout.trim()
	: "";
const pythonEnv = {
	...process.env,
	PYTHONDONTWRITEBYTECODE: "1",
	...(userSite ? { PYTHONPATH: [userSite, process.env.PYTHONPATH].filter(Boolean).join(":") } : {}),
};

test("PPTX office craft fixtures exercise all nine OF-1xx rules", (context) => {
	const ready = spawnSync("python3", ["-c", "import pptx"], { encoding: "utf8", env: pythonEnv });
	if (ready.status !== 0 && ready.stderr.includes("No module named 'pptx'")) {
		context.skip("python-pptx unavailable in the test runtime");
		return;
	}
	assert.equal(ready.status, 0, ready.stderr);
	const result = spawnSync("python3", ["scripts/test_office_floor.py"], {
		cwd: root,
		encoding: "utf8",
		env: pythonEnv,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stderr, /Ran 9 tests/);
});
test("Tonality deck gate fixtures exercise OF-110 to OF-114 and the pack-aware checks", (context) => {
	const ready = spawnSync("python3", ["-c", "import pptx"], { encoding: "utf8", env: pythonEnv });
	if (ready.status !== 0 && ready.stderr.includes("No module named 'pptx'")) {
		context.skip("python-pptx unavailable in the test runtime");
		return;
	}
	const result = spawnSync("python3", ["scripts/test_office_pack_gate.py"], {
		cwd: root,
		encoding: "utf8",
		env: pythonEnv,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stderr, /Ran 20 tests/);
});
// validate_pptx.py reads the word list beside SKILL.md and finds nothing when the file is absent, so the
// deck gate's forbidden-term check passes every deck unless the list ships with the skill.
test("the lit-pptx skill ships the forbidden-term list the deck gate reads", () => {
	const skill = join(root, "plugins/litcodex/skills/lit-pptx");
	assert.match(
		readFileSync(join(skill, "scripts/validate_pptx.py"), "utf8"),
		/^FORBIDDEN_PATH = SKILL_DIR \/ "FORBIDDEN_TERMS\.json"$/mu,
	);
	const list = join(skill, "FORBIDDEN_TERMS.json");
	assert.ok(existsSync(list), "plugins/litcodex/skills/lit-pptx/FORBIDDEN_TERMS.json is missing");
	const data = JSON.parse(readFileSync(list, "utf8"));
	assert.ok(Array.isArray(data.terms) && data.terms.length > 0, "the list has no terms");
	assert.ok(Array.isArray(data.soft_terms) && data.soft_terms.length > 0, "the list has no soft terms");
	for (const term of ["lorem ipsum", "click to add title", "[작성 중]"]) assert.ok(data.terms.includes(term), term);
});
test("DOCX office craft fixtures exercise OF-301 and OF-302", () => {
	const result = spawnSync("python3", ["scripts/test_docx_office_floor.py"], {
		cwd: root,
		encoding: "utf8",
		env: pythonEnv,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stderr, /Ran 2 tests/);
});
