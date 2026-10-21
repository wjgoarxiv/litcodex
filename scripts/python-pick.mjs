// Pick the interpreter the Python test lane runs under. A bare `python3` can be a Python newer than
// the pinned wheels and helpers support (3.15 on some macOS hosts), so the lane walks python3.14 down
// to python3.10, then python3 and python, and keeps only interpreters inside that range.

import { spawnSync } from "node:child_process";

export const MIN_PYTHON = [3, 10];
export const MAX_PYTHON = [3, 14];

export function pythonCandidates() {
	const names = [];
	for (let minor = MAX_PYTHON[1]; minor >= MIN_PYTHON[1]; minor -= 1) names.push(`python3.${minor}`);
	return [...names, "python3", "python"];
}

/** The interpreter's version when it runs and sits inside MIN_PYTHON..MAX_PYTHON, else a reason. */
export function probePython(command) {
	const probe = spawnSync(command, ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], {
		encoding: "utf8",
	});
	if (probe.error || probe.status !== 0) return { ok: false, command, detail: "not found" };
	const version = probe.stdout.trim();
	const [major, minor] = version.split(".").map(Number);
	const below = major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1]);
	const above = major > MAX_PYTHON[0] || (major === MAX_PYTHON[0] && minor > MAX_PYTHON[1]);
	if (below || above)
		return {
			ok: false,
			command,
			version,
			detail: `${version} is outside ${MIN_PYTHON.join(".")} to ${MAX_PYTHON.join(".")}`,
		};
	return { ok: true, command, version, detail: version };
}

/**
 * Run `preflight(command)` on each supported candidate and return the first whose dependency report
 * is ready. When none is ready, return the first report so the caller can decide between a safe skip
 * and a failure; `tried` lists every candidate that ran or was refused for its version.
 */
export function pickTestPython(preflight, probe = probePython) {
	const tried = [];
	let first = null;
	for (const command of pythonCandidates()) {
		const found = probe(command);
		if (!found.ok) {
			if (found.detail !== "not found") tried.push(`${command}: ${found.detail}`);
			continue;
		}
		const result = { command, version: found.version, ...preflight(command) };
		tried.push(`${command}: ${found.version} ${result.report?.status ?? "no report"}`);
		if (result.status === 0 && result.report?.status === "ready") return { ...result, tried };
		first ??= result;
	}
	return first ? { ...first, tried } : { command: null, tried };
}

/**
 * The isolated test lane points HOME at a sandbox, which also hides the user's own site-packages
 * (where numpy and friends often live). Point PYTHONUSERBASE back at the base that interpreter uses
 * under the real HOME; the sandbox still denies every write there.
 */
export function userSiteEnv(command, env = process.env, run = spawnSync) {
	const realHome = env.LITCODEX_TEST_PROTECTED_HOME;
	if (!realHome || env.PYTHONUSERBASE) return {};
	const base = run(command, ["-c", "import site; print(site.getuserbase())"], {
		encoding: "utf8",
		env: { ...env, HOME: realHome },
	});
	const path = base.status === 0 ? base.stdout.trim() : "";
	return path ? { PYTHONUSERBASE: path } : {};
}
