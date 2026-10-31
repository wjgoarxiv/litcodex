// LitCodex LitFamily block in the global $CODEX_HOME/AGENTS.md: a marker-delimited
// section the installer adds, refreshes and removes, never touching user text.
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctorDeps } from "../../../test/install-doctor-fixtures.js";
import { dispatch } from "../../cli.js";
import { runDoctor } from "../doctor.js";
import { runUninstallCli } from "../index.js";
import { parseInstallOptions } from "../install-options.js";
import { baseOptions } from "../install-test-helpers.js";
import { applyInstructionFile, instructionFileState } from "./apply.js";
import { AGENT_FILE_ID, AGENT_FILE_MAX_BYTES, globalBody, projectBody } from "./bodies.js";
import { runAgentFileProjectCli } from "./cli.js";
import { inspectInstructionBlock, removeInstructionBlock, upsertInstructionBlock } from "./managed-block.js";
import { readAgentFileMode, writeAgentFileMode } from "./mode.js";

const START = (v: string) => `<!-- litfamily:litcodex:start v=${v} -->`;
const END = `<!-- litfamily:litcodex:end -->`;
const block = { id: "litcodex", version: "1.0.0", body: "## LitFamily\n\n- rule one\n" };

const withDir = (fn: (dir: string) => void) => {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-agent-file-"));
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

describe("instruction block on text", () => {
	it("adds the block to an empty file and to the end of user text, keeping user bytes", () => {
		const empty = upsertInstructionBlock("", block);
		expect(empty.changed).toBe(true);
		expect(empty.text).toBe(`${START("1.0.0")}\n## LitFamily\n\n- rule one\n${END}\n`);
		const mine = upsertInstructionBlock("# Mine\n\nmy rule\n", block);
		expect(mine.text.startsWith("# Mine\n\nmy rule\n\n<!-- litfamily:litcodex:start")).toBe(true);
		expect(inspectInstructionBlock(mine.text, "litcodex")).toEqual({
			state: "present",
			version: "1.0.0",
			created: false,
		});
	});

	it("is idempotent and replaces only the bytes between its markers", () => {
		const first = upsertInstructionBlock("mine\n", block).text;
		expect(upsertInstructionBlock(first, block)).toEqual({ text: first, changed: false });
		const withAfter = `${first}\nafter the block\n`;
		const next = upsertInstructionBlock(withAfter, {
			...block,
			version: "1.0.1",
			body: "## LitFamily\n\n- rule two\n",
		});
		expect(next.changed).toBe(true);
		expect(next.text.startsWith("mine\n\n")).toBe(true);
		expect(next.text.endsWith("\nafter the block\n")).toBe(true);
		expect(next.text).toMatch(/rule two/u);
		expect(next.text).not.toMatch(/rule one/u);
		expect(inspectInstructionBlock(next.text, "litcodex").version).toBe("1.0.1");
	});

	it("removes exactly what it added", () => {
		for (const original of ["mine\n", "# Title\n\nline\n\n", "", "no newline at the end", "mixed\r\nendings\n"]) {
			const added = upsertInstructionBlock(original, block).text;
			expect(removeInstructionBlock(added, "litcodex").text).toBe(original);
			const refreshed = upsertInstructionBlock(added, {
				...block,
				version: "2.0.0",
				body: "## LitFamily\n\n- newer\n",
			}).text;
			expect(removeInstructionBlock(refreshed, "litcodex").text).toBe(original);
		}
		const added = upsertInstructionBlock("mine\n", block).text;
		expect(removeInstructionBlock(`${added}tail\n`, "litcodex").text).toBe("mine\ntail\n");
		expect(removeInstructionBlock("no block here\n", "litcodex")).toEqual({
			text: "no block here\n",
			changed: false,
			created: false,
		});
	});

	it("keeps Windows line endings and leaves another product block alone", () => {
		const added = upsertInstructionBlock("mine\r\nsecond\r\n", block).text;
		expect(/[\r][\n]/u.test(added)).toBe(true);
		expect(/[^\r]\n/u.test(added)).toBe(false);
		expect(removeInstructionBlock(added, "litcodex").text).toBe("mine\r\nsecond\r\n");
		const other = upsertInstructionBlock("mine\n", { id: "other", version: "0.1.0", body: "other rules\n" }).text;
		const both = upsertInstructionBlock(other, block).text;
		expect(both).toMatch(/other rules/u);
		expect(removeInstructionBlock(both, "litcodex").text).toBe(other);
	});

	it("refuses a malformed marker pair instead of guessing", () => {
		const start = START("1.0.0");
		for (const text of [`${start}\nbody\n`, `${END}\n${start}\n`, `${start}\n${start}\n${END}\n`]) {
			expect(inspectInstructionBlock(text, "litcodex").state).toBe("malformed");
			expect(() => upsertInstructionBlock(text, block)).toThrow(/malformed/u);
			expect(() => removeInstructionBlock(text, "litcodex")).toThrow(/malformed/u);
		}
	});
});

describe("instruction file on disk", () => {
	it("creates a missing file, backs up an existing one once, and writes nothing on a repeat or dry run", () =>
		withDir((dir) => {
			const fresh = join(dir, "fresh", "AGENTS.md");
			expect(applyInstructionFile({ path: fresh, ...block, action: "install" }).status).toBe("created");
			expect(readdirSync(join(dir, "fresh")).length).toBe(1);

			const path = join(dir, "AGENTS.md");
			writeFileSync(path, "mine\n");
			const dry = applyInstructionFile({ path, ...block, action: "install", dryRun: true });
			expect(dry.status).toBe("dry-run");
			expect(dry.preview).toMatch(/litfamily:litcodex:start/u);
			expect(readFileSync(path, "utf8")).toBe("mine\n");

			const first = applyInstructionFile({
				path,
				...block,
				action: "install",
				now: new Date("2026-10-30T00:00:00Z"),
			});
			expect(first.status).toBe("updated");
			expect(readFileSync(first.backup ?? "", "utf8")).toBe("mine\n");
			expect(applyInstructionFile({ path, ...block, action: "install" }).status).toBe("unchanged");
			expect(readdirSync(dir).filter((name) => name.includes("litfamily-backup")).length).toBe(1);
		}));

	it("uninstall restores the user file byte for byte, and deletes a file it alone created", () =>
		withDir((dir) => {
			const path = join(dir, "AGENTS.md");
			writeFileSync(path, "# Mine\r\n\r\nkeep me\r\n");
			applyInstructionFile({ path, ...block, action: "install" });
			expect(applyInstructionFile({ path, ...block, action: "uninstall" }).status).toBe("removed");
			expect(readFileSync(path, "utf8")).toBe("# Mine\r\n\r\nkeep me\r\n");
			expect(applyInstructionFile({ path, ...block, action: "uninstall" }).status).toBe("absent");

			const own = join(dir, "own", "AGENTS.md");
			applyInstructionFile({ path: own, ...block, action: "install" });
			applyInstructionFile({ path: own, ...block, action: "uninstall" });
			expect(existsSync(own)).toBe(false);

			const empty = join(dir, "empty.md");
			writeFileSync(empty, "");
			applyInstructionFile({ path: empty, ...block, action: "install" });
			applyInstructionFile({ path: empty, ...block, action: "uninstall" });
			expect(readFileSync(empty, "utf8")).toBe("");
		}));

	it("keeps the file mode, leaves no staging file, and refuses text that is not UTF-8", () =>
		withDir((dir) => {
			const path = join(dir, "AGENTS.md");
			writeFileSync(path, "mine\n", { mode: 0o600 });
			chmodSync(path, 0o600);
			applyInstructionFile({ path, ...block, action: "install" });
			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(readdirSync(dir).filter((name) => name.endsWith(".tmp")).length).toBe(0);

			for (const [name, bytes] of [
				["latin1.md", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])],
				["utf16.md", Buffer.from([0xff, 0xfe, 0x61, 0x00, 0x0a, 0x00])],
			] as const) {
				const file = join(dir, name);
				writeFileSync(file, bytes);
				expect(applyInstructionFile({ path: file, ...block, action: "install" }).status).toBe("refused-not-utf8");
				expect(readFileSync(file)).toEqual(bytes);
			}
		}));

	it("refuses a symlinked file and a malformed block without writing", () =>
		withDir((dir) => {
			const target = join(dir, "real.md");
			writeFileSync(target, "real\n");
			const link = join(dir, "AGENTS.md");
			symlinkSync(target, link);
			expect(applyInstructionFile({ path: link, ...block, action: "install" }).status).toBe("refused-symlink");
			expect(readFileSync(target, "utf8")).toBe("real\n");

			const broken = join(dir, "broken.md");
			writeFileSync(broken, `${START("1.0.0")}\nhalf\n`);
			expect(applyInstructionFile({ path: broken, ...block, action: "install" }).status).toBe("refused-malformed");
			expect(readFileSync(broken, "utf8")).toBe(`${START("1.0.0")}\nhalf\n`);
		}));

	it("reports present, stale, absent and malformed", () =>
		withDir((dir) => {
			const path = join(dir, "AGENTS.md");
			expect(instructionFileState({ path, id: "litcodex", version: "1.0.0" })).toBe("absent");
			applyInstructionFile({ path, ...block, action: "install" });
			expect(instructionFileState({ path, id: "litcodex", version: "1.0.0" })).toBe("present v=1.0.0");
			expect(instructionFileState({ path, id: "litcodex", version: "2.0.0" })).toBe("stale v=1.0.0");
			writeFileSync(path, `${START("1.0.0")}\n`);
			expect(instructionFileState({ path, id: "litcodex", version: "1.0.0" })).toBe("malformed");
			const link = join(dir, "linked.md");
			symlinkSync(path, link);
			expect(instructionFileState({ path: link, id: "litcodex", version: "1.0.0" })).toBe("symlink");
		}));
});

describe("instruction file mode", () => {
	it("defaults to on, persists off, and honors the env override", () =>
		withDir((dir) => {
			expect(readAgentFileMode({ env: {}, codexHome: dir })).toBe("on");
			writeAgentFileMode(dir, "off");
			expect(readAgentFileMode({ env: {}, codexHome: dir })).toBe("off");
			expect(readAgentFileMode({ env: { LITCODEX_AGENT_FILE: "on" }, codexHome: dir })).toBe("on");
		}));

	it("never overwrites an unreadable mode file", () =>
		withDir((dir) => {
			mkdirSync(join(dir, "litcodex"), { recursive: true });
			writeFileSync(join(dir, "litcodex", "agent-file.json"), "{ not json");
			expect(readAgentFileMode({ env: {}, codexHome: dir })).toBe("on");
			expect(() => writeAgentFileMode(dir, "on")).toThrow(/agent-file\.json/u);
			expect(readFileSync(join(dir, "litcodex", "agent-file.json"), "utf8")).toBe("{ not json");
		}));
});

describe("shipped block bodies", () => {
	it("stay within the byte budget, name the off switch, and use the litcodex marker", () => {
		expect(AGENT_FILE_ID).toBe("litcodex");
		for (const body of [globalBody(), projectBody()]) {
			expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(AGENT_FILE_MAX_BYTES);
			expect(body).toMatch(/^## LitFamily/u);
		}
		expect(globalBody()).toMatch(/litcodex config agentFile off/u);
		const added = upsertInstructionBlock("", { id: AGENT_FILE_ID, version: "9.9.9", body: globalBody() });
		expect(added.text).toMatch(/litfamily:litcodex:start/u);
	});
});

describe("installer surface", () => {
	it("parses --no-agent-file as a per-run skip", () => {
		const opts = parseInstallOptions(["--no-agent-file"], { env: {}, repoRoot: "/neutral/cwd" });
		expect(opts.noAgentFile).toBe(true);
		expect(baseOptions().noAgentFile).toBe(false);
	});

	it("routes agent-file project", () => {
		const routed = dispatch(["agent-file", "project", "--help"]);
		expect(routed.exitCode).toBe(0);
		expect(routed.stdout).toMatch(/agent-file project/u);
	});

	it("routes config agentFile off as a known route", () => {
		const routed = dispatch(["config", "agentFile", "off"]);
		expect(routed.exitCode).toBe(0);
	});

	it("writes the project block into a repo AGENTS.md and never creates a missing dir", () =>
		withDir((dir) => {
			const repo = join(dir, "repo");
			mkdirSync(repo);
			writeFileSync(join(repo, "AGENTS.md"), "# Repo\n\nbuild with make\n");
			const lines: string[] = [];
			const code = runAgentFileProjectCli(["project", "--dir", repo], {
				cwd: dir,
				out: { write: (chunk: string) => lines.push(chunk) } as unknown as NodeJS.WritableStream,
				err: { write: () => true } as unknown as NodeJS.WritableStream,
				version: "1.0.33",
			});
			expect(code).toBe(0);
			expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toMatch(/litfamily:litcodex:start/u);
			expect(lines.join("")).toMatch(/AGENT_FILE: (created|updated)/u);

			const missing = runAgentFileProjectCli(["project", "--dir", join(dir, "no-such-repo")], {
				cwd: dir,
				out: { write: () => true } as unknown as NodeJS.WritableStream,
				err: { write: () => true } as unknown as NodeJS.WritableStream,
				version: "1.0.33",
			});
			expect(missing).toBe(64);
			expect(existsSync(join(dir, "no-such-repo"))).toBe(false);
		}));

	it("doctor reports the instruction file state without touching the real host file", () =>
		withDir((dir) => {
			const codexHome = join(dir, "codex-home");
			mkdirSync(codexHome, { recursive: true });
			const agents = join(codexHome, "AGENTS.md");
			writeFileSync(agents, "# Mine\n");
			applyInstructionFile({
				path: agents,
				id: AGENT_FILE_ID,
				version: "1.0.33",
				body: globalBody(),
				action: "install",
			});
			const lstat = lstatSync(agents);
			expect(lstat.isFile()).toBe(true);
			expect(instructionFileState({ path: agents, id: AGENT_FILE_ID, version: "1.0.33" })).toBe("present v=1.0.33");
		}));

	it("runDoctor carries an agentFile state for absent and off modes", () =>
		withDir((dir) => {
			const deps = doctorDeps(["/usr/local/bin/codex"]);
			const absent = runDoctor({ ...deps, env: { ...deps.env, CODEX_HOME: dir } });
			expect(absent.agentFile).toBe("absent");
			expect(absent.issues.some((issue) => issue.includes("AGENTS.md"))).toBe(false);
			writeAgentFileMode(dir, "off");
			const off = runDoctor({ ...deps, env: { ...deps.env, CODEX_HOME: dir } });
			expect(off.agentFile).toBe("off");
			writeAgentFileMode(dir, "on");
			writeFileSync(join(dir, "AGENTS.md"), `${START("1.0.0")}\nhalf\n`);
			const malformed = runDoctor({ ...deps, env: { ...deps.env, CODEX_HOME: dir } });
			expect(malformed.agentFile).toBe("malformed");
			expect(malformed.issues.some((issue) => issue.includes("AGENTS.md"))).toBe(true);
		}));

	it("uninstall removes the instruction block while keeping user text", () =>
		withDir((dir) => {
			const codexHome = join(dir, "codex-home");
			mkdirSync(codexHome, { recursive: true });
			const agents = join(codexHome, "AGENTS.md");
			writeFileSync(agents, "# Mine\n");
			applyInstructionFile({
				path: agents,
				id: AGENT_FILE_ID,
				version: "1.0.33",
				body: globalBody(),
				action: "install",
			});
			const out: string[] = [];
			const err: string[] = [];
			const code = runUninstallCli([], {
				stdout: {
					write: (chunk: string) => {
						out.push(chunk);
						return true;
					},
				} as unknown as NodeJS.WritableStream,
				stderr: {
					write: (chunk: string) => {
						err.push(chunk);
						return true;
					},
				} as unknown as NodeJS.WritableStream,
				env: { CODEX_HOME: codexHome, CODEX_BIN: "/usr/bin/true" },
				repoRoot: dir,
			});
			expect(code).toBe(0);
			expect(err.join("")).toBe("");
			expect(out.join("")).toMatch(/AGENT_FILE: removed/u);
			expect(readFileSync(agents, "utf8")).toBe("# Mine\n");
		}));
});
