// The opt-in skill hint that sent prompts to the TypeSafe API was removed. These checks keep it out:
// the built UserPromptSubmit entry that hooks.json runs must stay silent and offline for a prompt the
// router leaves alone, even with the old switch and key exported in its process environment, and no
// shipped runtime file may name the switch, the key, the API or the hint module again.

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const COMPONENT_CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const REMOVED = /\bjev\b|jev-hint|LITCODEX_JEV|typesafe/i;
// Preloaded into the hook process: every fetch is logged to a file and refused, so a request is
// observable and nothing leaves the machine.
const FETCH_RECORDER = `import { appendFileSync } from "node:fs";
const log = process.env.LITCODEX_TEST_FETCH_LOG;
globalThis.fetch = async (input) => {
	appendFileSync(log, String(typeof input === "string" ? input : (input?.url ?? input)) + "\\n");
	throw new Error("no network in this test");
};
`;
const temps: string[] = [];

afterEach(() => {
	for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function shippedFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...shippedFiles(path));
		else if (!/\.test\.[cm]?[jt]s$/.test(name)) out.push(path);
	}
	return out;
}

describe("removed skill hint", () => {
	it("the real prompt hook, run with the old switch and key in its environment, adds nothing and calls nothing", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-hint-gone-"));
		temps.push(root);
		const cwd = join(root, "repo");
		const home = join(root, "home");
		const codexHome = join(root, "codex-home");
		for (const dir of [cwd, home, codexHome]) mkdirSync(dir, { recursive: true });
		const recorder = join(root, "fetch-recorder.mjs");
		const fetchLog = join(root, "fetch.log");
		writeFileSync(recorder, FETCH_RECORDER);

		const result = spawnSync(
			process.execPath,
			["--import", pathToFileURL(recorder).href, COMPONENT_CLI, "hook", "user-prompt-submit"],
			{
				cwd,
				env: {
					...process.env,
					HOME: home,
					CODEX_HOME: codexHome,
					LITCODEX_JEV: "1",
					LITCODEX_JEV_SHOW: "1",
					TYPESAFE_API_KEY: "test-key-not-real",
					LITCODEX_TEST_FETCH_LOG: fetchLog,
				},
				input: JSON.stringify({
					hook_event_name: "UserPromptSubmit",
					session_id: "hint-gone",
					turn_id: "t1",
					cwd,
					permission_mode: "default",
					prompt: "please tidy the wording of this Korean paragraph",
				}),
				encoding: "utf8",
			},
		);

		// One comparison, so a regression shows every symptom at once: exit code, added hint, request, record.
		expect({
			status: result.status,
			stdout: result.stdout,
			requests: existsSync(fetchLog) ? readFileSync(fetchLog, "utf8") : "",
			record: existsSync(join(cwd, ".litcodex", "jev")),
		}).toEqual({ status: 0, stdout: "", requests: "", record: false });
	});

	it("no shipped runtime file names the hint, its switch, its key or its API", () => {
		const roots = [
			"plugins/litcodex/components/lit-loop/src",
			"plugins/litcodex/components/lit-loop/dist",
			"plugins/litcodex/hooks",
			"packages/litcodex-ai/src",
		];
		const offenders = roots
			.flatMap((root) => shippedFiles(join(REPO_ROOT, root)))
			.filter((path) => REMOVED.test(readFileSync(path, "utf8")))
			.map((path) => relative(REPO_ROOT, path));
		expect(offenders).toEqual([]);
	});
});
