// The attribution switch: `keep` (default) leaves everything as it is; `off` adds one request line to
// the LitFamily block in the global AGENTS.md. It never writes config.toml: Codex's own co-author
// trailer is an account setting, so the line asks the model and guarantees nothing.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctorDeps } from "../../../test/install-doctor-fixtures.js";
import { dispatch } from "../../cli.js";
import { runDoctor } from "../doctor.js";
import { renderDoctorText } from "../doctor-render.js";
import { runUninstallCli } from "../index.js";
import { ATTRIBUTION_LINE, readAttributionMode, storedAttributionMode, writeAttributionMode } from "./attribution.js";
import { AGENT_FILE_ID, AGENT_FILE_MAX_BYTES, globalBody } from "./bodies.js";
import { runConfigAttributionCli, runInstallAgentFile, writeGlobalAgentFile } from "./cli.js";

const withDir = async (fn: (dir: string) => void | Promise<void>) => {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-attribution-"));
	try {
		await fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

const sink = () => {
	const chunks: string[] = [];
	return { chunks, stream: { write: (chunk: string) => chunks.push(chunk) } as unknown as NodeJS.WritableStream };
};

const config = (codexHome: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
	const out = sink();
	const err = sink();
	const code = runConfigAttributionCli(args, {
		env,
		out: out.stream,
		err: err.stream,
		codexHome,
		version: "1.0.33",
	});
	return { code, out: out.chunks.join(""), err: err.chunks.join("") };
};

describe("attribution mode", () => {
	it("is keep by default, stores off, honours the env override and rejects unknown words", () =>
		withDir((dir) => {
			expect(readAttributionMode({ env: {}, codexHome: dir })).toBe("keep");
			expect(storedAttributionMode(dir)).toBeUndefined();
			writeAttributionMode(dir, "off");
			expect(readAttributionMode({ env: {}, codexHome: dir })).toBe("off");
			expect(storedAttributionMode(dir)).toBe("off");
			expect(readAttributionMode({ env: { LITCODEX_ATTRIBUTION: "keep" }, codexHome: dir })).toBe("keep");
			expect(() => writeAttributionMode(dir, "maybe" as never)).toThrow(/attribution takes one of/u);
		}));

	it("never overwrites an unreadable state file", () =>
		withDir((dir) => {
			mkdirSync(join(dir, "litcodex"), { recursive: true });
			writeFileSync(join(dir, "litcodex", "attribution.json"), "{ not json");
			expect(readAttributionMode({ env: {}, codexHome: dir })).toBe("keep");
			expect(() => writeAttributionMode(dir, "off")).toThrow(/attribution\.json/u);
			expect(readFileSync(join(dir, "litcodex", "attribution.json"), "utf8")).toBe("{ not json");
		}));
});

describe("block text", () => {
	it("adds exactly the request line, before the turn-off line, only when off, within the byte budget", () => {
		expect(ATTRIBUTION_LINE).toBe(
			"- Do not add `Co-Authored-By` lines or other AI attribution to commits or pull requests.",
		);
		expect(globalBody()).not.toContain("Co-Authored-By");
		expect(globalBody({ attribution: "keep" })).toBe(globalBody());
		const off = globalBody({ attribution: "off" });
		expect(off).toContain(`${ATTRIBUTION_LINE}\n- Turn this block off`);
		expect(off.split("\n").filter((line) => line.includes("Co-Authored-By"))).toHaveLength(1);
		expect(Buffer.byteLength(off, "utf8")).toBeLessThanOrEqual(AGENT_FILE_MAX_BYTES);
	});
});

describe("litcodex config attribution", () => {
	it("off adds the line, keep puts the file back byte for byte, and config.toml is never written", () =>
		withDir((dir) => {
			const agents = join(dir, "AGENTS.md");
			writeFileSync(agents, "# Mine\n\nmy rule\n");
			writeGlobalAgentFile(dir, "1.0.33", "keep");
			const before = readFileSync(agents, "utf8");
			expect(before).not.toContain("Co-Authored-By");

			const off = config(dir, ["off"]);
			expect(off.code).toBe(0);
			const after = readFileSync(agents, "utf8");
			expect(after).toContain(ATTRIBUTION_LINE);
			expect(after.startsWith("# Mine\n\nmy rule\n")).toBe(true);
			expect(off.out).toMatch(/attribution\s+off/u);
			expect(off.out).toMatch(/account setting/u);
			expect(off.out).toMatch(/ChatGPT/u);
			expect(off.out).toMatch(/not a guarantee|no guarantee|does not guarantee/u);
			expect(readAttributionMode({ env: {}, codexHome: dir })).toBe("off");

			expect(config(dir, ["off"]).code).toBe(0);
			expect(readFileSync(agents, "utf8")).toBe(after);

			const keep = config(dir, ["keep"]);
			expect(keep.code).toBe(0);
			expect(readFileSync(agents, "utf8")).toBe(before);
			expect(readAttributionMode({ env: {}, codexHome: dir })).toBe("keep");

			expect(existsSync(join(dir, "config.toml"))).toBe(false);
		}));

	it("stores the choice without writing the global file when the block is absent or turned off", () =>
		withDir((dir) => {
			const result = config(dir, ["off"]);
			expect(result.code).toBe(0);
			expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
			expect(result.out).toMatch(/next time the LitFamily block is written/u);
			expect(readAttributionMode({ env: {}, codexHome: dir })).toBe("off");
			writeGlobalAgentFile(dir, "1.0.33", "off");
			expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain(ATTRIBUTION_LINE);
		}));

	it("rejects an unknown word with exit 64 and changes nothing", () =>
		withDir((dir) => {
			const result = config(dir, ["sometimes"]);
			expect(result.code).toBe(64);
			expect(result.err).toMatch(/Usage: litcodex config attribution <keep\|off>/u);
			expect(readdirSync(dir)).toEqual([]);
		}));

	it("is a known route", () => {
		expect(dispatch(["config", "attribution", "off"]).exitCode).toBe(0);
		expect(dispatch(["config", "attribution", "x"]).exitCode).not.toBe(0);
	});
});

describe("install flow", () => {
	const base = (dir: string, over: Partial<Parameters<typeof runInstallAgentFile>[0]> = {}) => ({
		env: {},
		stdout: sink().stream,
		codexHome: dir,
		version: "1.0.33",
		yes: false,
		noAgentFile: false,
		dryRun: false,
		...over,
	});

	it("--yes changes nothing about attribution", () =>
		withDir(async (dir) => {
			await runInstallAgentFile(base(dir, { yes: true }));
			expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).not.toContain("Co-Authored-By");
			expect(storedAttributionMode(dir)).toBeUndefined();
		}));

	it("an interactive install asks once, default keep, and a yes stores off and writes the line", () =>
		withDir(async (dir) => {
			let asked = 0;
			const attributionPrompt = async () => {
				asked += 1;
				return true;
			};
			await runInstallAgentFile(base(dir, { prompt: async () => true, attributionPrompt }));
			expect(asked).toBe(1);
			expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain(ATTRIBUTION_LINE);
			expect(storedAttributionMode(dir)).toBe("off");
			await runInstallAgentFile(base(dir, { prompt: async () => true, attributionPrompt }));
			expect(asked).toBe(1);
		}));

	it("a no stores keep and is not asked again; a declined block is not asked about attribution", () =>
		withDir(async (dir) => {
			let asked = 0;
			const attributionPrompt = async () => {
				asked += 1;
				return false;
			};
			await runInstallAgentFile(base(dir, { prompt: async () => true, attributionPrompt }));
			expect(asked).toBe(1);
			expect(storedAttributionMode(dir)).toBe("keep");
			expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).not.toContain("Co-Authored-By");
			await runInstallAgentFile(base(dir, { prompt: async () => true, attributionPrompt }));
			expect(asked).toBe(1);
		}));

	it("does not ask when the block is declined", () =>
		withDir(async (dir) => {
			let asked = 0;
			await runInstallAgentFile(
				base(dir, {
					prompt: async () => false,
					attributionPrompt: async () => {
						asked += 1;
						return true;
					},
				}),
			);
			expect(asked).toBe(0);
			expect(storedAttributionMode(dir)).toBeUndefined();
		}));

	it("a refresh install keeps the line while attribution is off", () =>
		withDir(async (dir) => {
			writeAttributionMode(dir, "off");
			await runInstallAgentFile(base(dir, { yes: true }));
			expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain(ATTRIBUTION_LINE);
		}));
});

describe("doctor and uninstall", () => {
	it("doctor reports attribution: keep|off", () =>
		withDir((dir) => {
			const deps = doctorDeps(["/usr/local/bin/codex"]);
			const keep = runDoctor({ ...deps, env: { ...deps.env, CODEX_HOME: dir } });
			expect(keep.attribution).toBe("keep");
			expect(renderDoctorText(keep)).toMatch(/attribution:\s+keep/u);
			writeAttributionMode(dir, "off");
			const off = runDoctor({ ...deps, env: { ...deps.env, CODEX_HOME: dir } });
			expect(off.attribution).toBe("off");
			expect(renderDoctorText(off)).toMatch(/attribution:\s+off/u);
		}));

	it("uninstall removes the block and returns attribution to keep", () =>
		withDir((dir) => {
			const codexHome = join(dir, "codex-home");
			mkdirSync(codexHome, { recursive: true });
			const agents = join(codexHome, "AGENTS.md");
			writeFileSync(agents, "# Mine\n");
			writeAttributionMode(codexHome, "off");
			writeGlobalAgentFile(codexHome, "1.0.33", "off");
			expect(readFileSync(agents, "utf8")).toContain(AGENT_FILE_ID);
			const out = sink();
			const err = sink();
			const code = runUninstallCli([], {
				stdout: out.stream,
				stderr: err.stream,
				env: { CODEX_HOME: codexHome, CODEX_BIN: "/usr/bin/true" },
				repoRoot: dir,
			});
			expect(code).toBe(0);
			expect(readFileSync(agents, "utf8")).toBe("# Mine\n");
			expect(readAttributionMode({ env: {}, codexHome })).toBe("keep");
			expect(storedAttributionMode(codexHome)).toBeUndefined();
		}));
});
