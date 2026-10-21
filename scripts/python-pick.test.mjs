import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { pickTestPython, pythonCandidates, userSiteEnv } from "./python-pick.mjs";

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "run-python-tests.mjs");

const host = {
	"python3.14": { ok: true, version: "3.14.7" },
	"python3.13": { ok: true, version: "3.13.12" },
	python3: { ok: false, version: "3.15.0", detail: "3.15.0 is outside 3.10 to 3.14" },
};
const probe = (command) => ({ command, ...(host[command] ?? { ok: false, detail: "not found" }) });
const reports = {
	"python3.14": { status: 3, report: { status: "degraded" } },
	"python3.13": { status: 0, report: { status: "ready" } },
};

test("walks python3.14 down to python3.10 before python3 and python", () => {
	assert.deepEqual(pythonCandidates(), [
		"python3.14",
		"python3.13",
		"python3.12",
		"python3.11",
		"python3.10",
		"python3",
		"python",
	]);
});

test("a python3 that is 3.15 is refused and the first ready supported interpreter wins", () => {
	const seen = [];
	const picked = pickTestPython((command) => {
		seen.push(command);
		return reports[command];
	}, probe);
	assert.equal(picked.command, "python3.13");
	assert.equal(picked.report.status, "ready");
	assert.deepEqual(seen, ["python3.14", "python3.13"]);
});

test("with no ready interpreter the first report comes back with every refusal named", () => {
	const picked = pickTestPython(() => ({ status: 3, report: { status: "degraded" } }), probe);
	assert.equal(picked.command, "python3.14");
	assert.equal(picked.report.status, "degraded");
	assert.ok(picked.tried.includes("python3: 3.15.0 is outside 3.10 to 3.14"));
});

test("with no supported interpreter at all there is no command", () => {
	const picked = pickTestPython(
		() => assert.fail("no preflight without an interpreter"),
		(command) => ({
			command,
			ok: false,
			detail: "not found",
		}),
	);
	assert.equal(picked.command, null);
});

test("the Python test lane spawns the picked interpreter, never a bare python3", () => {
	const source = readFileSync(RUNNER, "utf8");
	assert.match(source, /pickTestPython/u);
	assert.doesNotMatch(source, /spawnSync\(\s*["']python3["']/u);
});

test("under the isolated test HOME the picked Python keeps the real user's site-packages, read-only", () => {
	const calls = [];
	const run = (command, _args, options) => {
		calls.push({ command, home: options.env.HOME });
		return { status: 0, stdout: `${options.env.HOME}/.local\n` };
	};
	assert.deepEqual(
		userSiteEnv("python3.13", { LITCODEX_TEST_PROTECTED_HOME: "/Users/real", HOME: "/tmp/sandbox/home" }, run),
		{
			PYTHONUSERBASE: "/Users/real/.local",
		},
	);
	assert.deepEqual(calls, [{ command: "python3.13", home: "/Users/real" }]);
	assert.deepEqual(userSiteEnv("python3.13", { HOME: "/Users/real" }, run), {});
	assert.deepEqual(
		userSiteEnv("python3.13", { LITCODEX_TEST_PROTECTED_HOME: "/Users/real", PYTHONUSERBASE: "/opt/u" }, run),
		{},
	);
	assert.deepEqual(
		userSiteEnv("python3.13", { LITCODEX_TEST_PROTECTED_HOME: "/Users/real" }, () => ({ status: 1, stdout: "" })),
		{},
	);
});
