import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
test("DOCX office craft fixtures exercise OF-301 and OF-302", () => {
	const result = spawnSync("python3", ["scripts/test_docx_office_floor.py"], {
		cwd: root,
		encoding: "utf8",
		env: pythonEnv,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stderr, /Ran 2 tests/);
});
