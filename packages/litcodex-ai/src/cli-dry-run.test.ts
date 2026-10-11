import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// `--help` promises `litcodex --dry-run <command>` resolves a command without applying it. These tests
// run the published bin against a disposable home whose `codex` is a recorder, and require that a
// dry run of every state-changing route prints its plan, exits 0, runs no `codex` and changes no file.
// The home has no marketplace directory, which the real uninstall treats as safe, so without the dry-run
// guard it would call the recorder `codex` and remove the managed agent role.
const binPath = fileURLToPath(new URL("../bin/litcodex.js", import.meta.url));
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Sandbox {
	readonly root: string;
	readonly codexHome: string;
	readonly project: string;
	readonly codexLog: string;
	readonly env: NodeJS.ProcessEnv;
}

function sandbox(): Sandbox {
	const root = mkdtempSync(join(tmpdir(), "litcodex-dry-run-"));
	roots.push(root);
	const home = join(root, "home");
	const codexHome = join(home, ".codex");
	const project = join(root, "project");
	const fakeBin = join(root, "bin");
	const codexLog = join(root, "codex-calls.log");
	for (const dir of [join(codexHome, "agents"), project, fakeBin, join(home, ".cache")]) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(join(codexHome, "config.toml"), 'model = "gpt-6-astra"\n\n[agents]\nmax_threads = 20\n');
	writeFileSync(join(codexHome, "agents", "litcodex-explorer.toml"), 'model = "gpt-6-luna"\n');
	const fakeCodex = join(fakeBin, "codex");
	writeFileSync(fakeCodex, `#!/bin/sh\necho "$*" >> "${codexLog}"\nexit 0\n`);
	chmodSync(fakeCodex, 0o755);
	const env: NodeJS.ProcessEnv = {
		PATH: `${fakeBin}:/usr/bin:/bin`,
		HOME: home,
		CODEX_HOME: codexHome,
		CODEX_BIN: fakeCodex,
		XDG_CACHE_HOME: join(home, ".cache"),
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		XDG_STATE_HOME: join(home, ".local", "state"),
		npm_config_cache: join(home, ".npm"),
		CI: "1",
		LITCODEX_NO_UPDATE_CHECK: "1",
		LITCODEX_NO_AUTO_UPDATE: "1",
		NO_COLOR: "1",
	};
	return { root, codexHome, project, codexLog, env };
}

/** Every path under the sandbox with a content hash, so any write, delete or new file shows up. */
function snapshot(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			const stat = lstatSync(path);
			const key = relative(root, path);
			if (stat.isDirectory()) {
				out[key] = "dir";
				walk(path);
			} else {
				out[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
			}
		}
	};
	walk(root);
	return out;
}

function runBin(box: Sandbox, args: readonly string[], input = ""): { stdout: string; stderr: string; code: number } {
	const result = spawnSync(process.execPath, [binPath, ...args], {
		cwd: box.project,
		env: box.env,
		input,
		encoding: "utf8",
		timeout: 60_000,
	});
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1 };
}

function expectNothingApplied(box: Sandbox, args: readonly string[], input = ""): string {
	const before = snapshot(box.root);
	const r = runBin(box, args, input);
	expect(r.code, r.stdout + r.stderr).toBe(0);
	expect(existsSync(box.codexLog), `codex was invoked: ${args.join(" ")}`).toBe(false);
	expect(snapshot(box.root)).toEqual(before);
	expect(r.stdout).toMatch(/dry run/i);
	return r.stdout;
}

describe("--dry-run applies nothing on state-changing routes", () => {
	it("uninstall with a leading --dry-run prints the removal plan and touches nothing", () => {
		const box = sandbox();
		const stdout = expectNothingApplied(box, ["--dry-run", "uninstall"]);
		expect(stdout).toContain("codex plugin remove litcodex@litcodex");
		expect(stdout).toContain("codex plugin marketplace remove litcodex");
		expect(stdout).toContain(join(box.codexHome, "marketplaces", "litcodex"));
		expect(stdout).toContain(join(box.codexHome, "config.toml"));
		expect(stdout).toMatch(/only if the marketplace removal succeeds/);
		expect(stdout).toMatch(/refuses to change anything/);
	});

	it("uninstall with a trailing --dry-run behaves the same", () => {
		const box = sandbox();
		const trailing = expectNothingApplied(box, ["uninstall", "--dry-run"]);
		const leading = expectNothingApplied(box, ["--dry-run", "uninstall"]);
		expect(trailing).toBe(leading);
	});

	it.each([
		[["--dry-run", "office-runtime", "install"]],
		[["office-runtime", "install", "--dry-run"]],
		[["--dry-run", "motion-runtime", "install"]],
		[["motion-runtime", "install", "--audio", "--dry-run"]],
	])("%j prepares nothing", (args) => {
		expectNothingApplied(sandbox(), args);
	});

	it.each([
		[["--dry-run", "loop", "create", "--brief", "Fix login"]],
		[["loop", "run", "--dry-run"]],
		[["--dry-run", "loop", "checkpoint", "--goal-id", "G001", "--status", "complete", "--evidence", "ok"]],
		[
			[
				"--dry-run",
				"loop",
				"record-evidence",
				"--goal-id",
				"G001",
				"--criterion-id",
				"C001",
				"--status",
				"pass",
				"--evidence",
				"ok",
			],
		],
	])("%j writes no loop state", (args) => {
		const box = sandbox();
		expectNothingApplied(box, args);
		expect(existsSync(join(box.project, ".litcodex"))).toBe(false);
	});

	it.each([
		["user-prompt-submit"],
		["stop"],
		["session-start"],
		["post-compact"],
	])("hook %s under --dry-run runs no hook", (hook) => {
		expectNothingApplied(sandbox(), ["--dry-run", "hook", hook], '{"prompt":"lit add a test"}');
	});

	it("read-only routes still run under --dry-run", () => {
		const box = sandbox();
		const plain = runBin(box, ["loop", "status"]);
		const dry = runBin(box, ["--dry-run", "loop", "status"]);
		expect(dry.code).toBe(plain.code);
		expect(dry.stdout).toBe(plain.stdout);
		expect(runBin(box, ["--dry-run", "loop", "help"]).stdout).toContain("litcodex loop <subcommand>");
	});
});

describe("state-changing routes refuse options --help does not list", () => {
	function expectRefused(args: readonly string[], option: string): void {
		const box = sandbox();
		const before = snapshot(box.root);
		const r = runBin(box, args);
		expect(r.code, r.stdout + r.stderr).toBe(64);
		expect(r.stderr).toContain(option);
		expect(r.stderr).toMatch(/nothing was changed/i);
		expect(existsSync(box.codexLog), `codex was invoked: ${args.join(" ")}`).toBe(false);
		expect(snapshot(box.root)).toEqual(before);
	}

	it.each([
		[["uninstall", "-n"], "-n"],
		[["uninstall", "--bogus"], "--bogus"],
		[["office-runtime", "install", "-n"], "-n"],
		[["office-runtime", "install", "--force"], "--force"],
		[["motion-runtime", "install", "-n"], "-n"],
	])("%j is refused before anything runs", (args, option) => {
		expectRefused(args, option);
	});

	it.each([
		[["uninstall", "--dry-run=yes"]],
		[["office-runtime", "install", "--dry-run=1"]],
	])("%j: --dry-run only takes true or false", (args) => {
		expectRefused(args, "--dry-run=");
	});

	it.each([
		[
			["uninstall", "--dry-run=true"],
			["uninstall", "--dry-run"],
		],
		[
			["office-runtime", "install", "--dry-run=true"],
			["office-runtime", "install", "--dry-run"],
		],
		[
			["motion-runtime", "install", "--audio", "--dry-run=true"],
			["motion-runtime", "install", "--audio", "--dry-run"],
		],
	])("%j is the same dry run as %j", (withValue, plain) => {
		const box = sandbox();
		expect(expectNothingApplied(box, withValue)).toBe(expectNothingApplied(box, plain));
	});

	it("--dry-run=false is an ordinary run", () => {
		const box = sandbox();
		const r = runBin(box, ["uninstall", "--dry-run=false"]);
		expect(r.stdout).not.toMatch(/dry run/i);
		expect(readFileSync(box.codexLog, "utf8")).toContain("plugin remove litcodex@litcodex");
	});

	it("a dry run of an unknown loop subcommand fails like a real run", () => {
		const box = sandbox();
		const dry = runBin(box, ["--dry-run", "loop", "constructor"]);
		const plain = runBin(box, ["loop", "constructor"]);
		expect(dry.code).toBe(plain.code);
		expect(dry.code).not.toBe(0);
		expect(dry.stdout).not.toMatch(/dry run/i);
	});
});
