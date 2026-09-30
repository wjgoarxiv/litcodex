import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dispatch, UNKNOWN_COMMAND_CODE } from "./cli.js";

// Resolve published surface paths relative to this test file (src/ sibling of bin/, dist/).
const binPath = fileURLToPath(new URL("../bin/litcodex.js", import.meta.url));
const distCliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
const node20Bin = [process.env["LIT_QA_NODE20_BIN"]?.trim(), process.execPath, "/usr/local/bin/node"].find(
	(candidate) =>
		candidate !== undefined &&
		candidate.length > 0 &&
		existsSync(candidate) &&
		/^v20\./.test(spawnSync(candidate, ["--version"], { encoding: "utf8" }).stdout),
);

// Assemble legacy/forwarder tokens from fragments so this test file does not itself
// trip the legacy-token scanner. These tokens MUST NOT appear in bin or dist output.
const NPX_TOKEN = ["n", "p", "x"].join("");
const FORWARD_TOKEN = ["o", "m", "o"].join("");
const HARNESS_FRAGMENT = ["oh", "my", "openagent"].join("-");

/** Run the published bin as a child process; capture stdout, stderr, exit code. */
function runBin(args: readonly string[]): { stdout: string; stderr: string; code: number } {
	try {
		const stdout = execFileSync(process.execPath, [binPath, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { stdout, stderr: "", code: 0 };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
	}
}

describe("dispatch (pure routing core)", () => {
	it("--help returns exit 0 and LitCodex usage on stdout", () => {
		const r = dispatch(["--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/^litcodex/);
		expect(r.stdout).toContain("litcodex install");
		expect(r.stdout).toContain("litcodex doctor");
		expect(r.stdout).toContain("litcodex loop");
		expect(r.stdout).not.toContain("litcodex observer");
		expect(r.stdout).not.toContain("litcodex skill-loop");
		expect(r.stdout).toContain("--dry-run");
		expect(r.stdout).toContain("--model <gpt-6-astra|astra|gpt-6-sol|gpt-6-luna");
		expect(r.stdout).toContain("--subagent-model <gpt-6-astra|astra|gpt-6-sol|gpt-6-luna");
		expect(r.stdout).toContain("--effort <low|medium|high|xhigh|max|ultra>");
		expect(r.stdout).toContain("--reconfigure");
		expect(r.stdout).toContain("--no-auto-update");
		expect(r.stderr).toBe("");
	});

	it("-h is identical to --help", () => {
		expect(dispatch(["-h"]).stdout).toBe(dispatch(["--help"]).stdout);
	});

	it("--version prints exactly the manifest version + newline, exit 0", () => {
		const r = dispatch(["--version"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe(`${manifest.version}\n`);
	});

	it("--version is the pinned 1.0.12", () => {
		expect(manifest.version).toBe("1.0.12");
		expect(dispatch(["--version"]).stdout).toBe("1.0.12\n");
	});

	it("-v is identical to --version", () => {
		expect(dispatch(["-v"]).stdout).toBe(dispatch(["--version"]).stdout);
	});

	it("routes a known subcommand (doctor) to a local handler, exit 0, no spawn token", () => {
		const r = dispatch(["doctor"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toContain(NPX_TOKEN);
		expect(r.stderr).not.toContain(NPX_TOKEN);
	});

	it("routes Office runtime installation and status explicitly", () => {
		expect(dispatch(["office-runtime", "install"]).exitCode).toBe(0);
		expect(dispatch(["office-runtime", "status"]).exitCode).toBe(0);
		expect(dispatch(["office-runtime", "unknown"]).exitCode).toBe(64);
	});

	it("--dry-run routing is position-independent and resolves install locally", () => {
		const lead = dispatch(["--dry-run", "install", "--no-tui"]);
		const trail = dispatch(["install", "--dry-run", "--no-tui"]);
		expect(lead.exitCode).toBe(0);
		expect(trail.exitCode).toBe(0);
		// Both resolve to the same install route; dry-run is a flag, not the subcommand.
		expect(lead.stdout).toContain("install");
		expect(trail.stdout).toContain("install");
		// Self-contained: never emits a forwarder/spawn token.
		expect(lead.stdout + lead.stderr).not.toContain(NPX_TOKEN);
	});

	it("--dry-run doctor routes to doctor and prints a LitCodex plan, exit 0", () => {
		const r = dispatch(["--dry-run", "doctor"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.toLowerCase()).toContain("litcodex");
		expect(r.stdout).not.toContain(NPX_TOKEN);
	});

	it("unknown subcommand exits 1 with the unknown-command code and plain-text usage", () => {
		const r = dispatch(["frobnicate"]);
		expect(r.exitCode).toBe(1);
		expect(UNKNOWN_COMMAND_CODE).toBe("LITCODEX_INSTALL_UNKNOWN_COMMAND");
		expect(r.stderr).toContain(UNKNOWN_COMMAND_CODE);
		// Plain-text, not JSON.
		expect(r.stderr.trim().startsWith("{")).toBe(false);
		// No legacy/forwarder token in the rejection.
		expect(r.stderr).not.toContain(NPX_TOKEN);
		expect(r.stderr).not.toContain(FORWARD_TOKEN);
	});

	it.each(["observer", "skill-loop"])("does not expose the removed %s route", (route) => {
		const result = dispatch([route]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain(UNKNOWN_COMMAND_CODE);
	});

	it("routes loop, hook, and config locally (no forwarding)", () => {
		for (const argv of [
			["loop", "status"],
			["hook", "user-prompt-submit"],
			["config", "migrate"],
		]) {
			const r = dispatch(argv);
			// Known routes never hit the unknown-command exit.
			expect(r.exitCode).not.toBe(1);
			expect(r.stdout + r.stderr).not.toContain(NPX_TOKEN);
		}
	});
});

describe("self-contained published bin (replaces SUPERSEDED forwarder tests #25-#28)", () => {
	it.skipIf(node20Bin === undefined)("starts the actual built CLI under an available Node 20 runtime", () => {
		if (node20Bin === undefined) throw new Error("Node 20 runtime unavailable");
		const r = spawnSync(node20Bin, [binPath, "--version"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		expect(r.status).toBe(0);
		expect(r.stdout).toBe(`${manifest.version}\n`);
		expect(r.stderr).not.toContain("SyntaxError");
	});

	it("the package ships a dist/ build that the bin imports (#25: dist allowed)", () => {
		const distSource = readFileSync(distCliPath, "utf8");
		expect(distSource.length).toBeGreaterThan(0);
		const binSource = readFileSync(binPath, "utf8");
		expect(binSource).toContain("../dist/cli.js");
	});

	it("the bin and dist contain NO forwarder/npx token (#26: drop spawns-only-npx)", () => {
		const binSource = readFileSync(binPath, "utf8");
		const distSource = readFileSync(distCliPath, "utf8");
		// npx + the harness fragment are matched as substrings (collision-free).
		for (const token of [NPX_TOKEN, HARNESS_FRAGMENT]) {
			expect(binSource).not.toContain(token);
			expect(distSource).not.toContain(token);
		}
		// FORWARD_TOKEN is a BOUNDED legacy token (A3 C10): its three letters also appear inside the
		// legitimate `--codex-autonomous` install flag, which must NOT trip the guard — only a
		// word-bounded occurrence is forbidden. Match with ASCII word boundaries, not substring.
		const bounded = new RegExp(`(^|[^a-z0-9])${FORWARD_TOKEN}([^a-z0-9]|$)`, "i");
		expect(bounded.test(binSource)).toBe(false);
		expect(bounded.test(distSource)).toBe(false);
	});

	it("the bin never spawns a child process / references a harness package (#26)", () => {
		const binSource = readFileSync(binPath, "utf8");
		const distSource = readFileSync(distCliPath, "utf8");
		for (const spawnApi of ["spawnSync", "spawn(", "execSync", "exec(", "execFileSync", "child_process"]) {
			expect(binSource).not.toContain(spawnApi);
			expect(distSource).not.toContain(spawnApi);
		}
	});

	it("dispatches loop/hook/config locally rather than forwarding (#27/#28)", () => {
		// config migrate is a LOCAL route per C4, not a forwarded token.
		const cfg = dispatch(["config", "migrate"]);
		expect(cfg.exitCode).not.toBe(1);
		expect(cfg.stdout + cfg.stderr).not.toContain(NPX_TOKEN);
		// loop and hook resolve locally too.
		expect(dispatch(["loop", "help"]).exitCode).not.toBe(1);
		expect(dispatch(["hook", "user-prompt-submit"]).exitCode).not.toBe(1);
	});

	it("the canonical bin path exists and the dist/bin/ form does not (#33)", () => {
		expect(() => readFileSync(binPath, "utf8")).not.toThrow();
		const distBin = fileURLToPath(new URL("../dist/bin/litcodex.js", import.meta.url));
		expect(() => readFileSync(distBin, "utf8")).toThrow();
	});
});

describe("published bin end-to-end (process exit owner)", () => {
	it("--help exits 0 with LitCodex usage and no spawn token", () => {
		const r = runBin(["--help"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/^litcodex/);
		expect(r.stdout).not.toContain(NPX_TOKEN);
	});

	it("--version exits 0 printing the manifest version", () => {
		const r = runBin(["--version"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toBe(`${manifest.version}\n`);
	});

	it("unknown subcommand exits non-zero with no legacy/forwarder token", () => {
		const r = runBin(["frobnicate"]);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain(UNKNOWN_COMMAND_CODE);
		expect(r.stdout + r.stderr).not.toContain(NPX_TOKEN);
		expect(r.stdout + r.stderr).not.toContain(FORWARD_TOKEN);
	});

	it("--dry-run install routing prints the LitCodex plan and exits 0 (T17 real route)", () => {
		const r = runBin(["--dry-run", "install", "--no-tui"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("litcodex install plan (Codex)");
		expect(r.stdout).not.toContain(NPX_TOKEN);
	});
});
