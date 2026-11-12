import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatch } from "../cli.js";
import {
	type CheckReport,
	checkExtensions,
	EXTENSION_FAMILIES,
	EXTENSION_IDS,
	type ExtensionsDeps,
	extensionsDoctorLine,
	extensionsNoticeLine,
	RECEIPT_NAME,
	runExtensionsCli,
} from "./extensions.js";
import { runDoctorCli } from "./index.js";

interface World {
	readonly root: string;
	readonly home: string;
	readonly codexHome: string;
	readonly project: string;
	readonly clone: string;
	readonly env: NodeJS.ProcessEnv;
}

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function world(): World {
	const root = mkdtempSync(join(tmpdir(), "litcodex-extensions-"));
	roots.push(root);
	const home = join(root, "home");
	const codexHome = join(home, ".codex");
	const project = join(root, "project");
	const clone = join(root, "clone");
	mkdirSync(join(project, ".git"), { recursive: true });
	for (const id of EXTENSION_IDS) writeSkill(join(clone, "variants", "litcodex", id), id, "v1");
	return {
		root,
		home,
		codexHome,
		project,
		clone,
		env: { HOME: home, CODEX_HOME: codexHome, XDG_CACHE_HOME: join(home, ".cache"), PATH: process.env["PATH"] ?? "" },
	};
}

function writeSkill(dir: string, id: string, body: string): void {
	mkdirSync(join(dir, "references"), { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: test edition of ${id}\n---\n\n${body}\n`);
	writeFileSync(join(dir, "references", "guide.md"), `guide for ${id}\n`);
}

function run(w: World, args: readonly string[], deps: ExtensionsDeps = {}): { code: number; out: string; err: string } {
	let out = "";
	let err = "";
	const code = runExtensionsCli(
		args,
		{
			stdout: {
				write: (chunk: string) => {
					out += chunk;
					return true;
				},
			} as unknown as NodeJS.WritableStream,
			stderr: {
				write: (chunk: string) => {
					err += chunk;
					return true;
				},
			} as unknown as NodeJS.WritableStream,
			env: w.env,
			cwd: w.project,
		},
		{ now: () => new Date(2026, 10, 12, 10, 0, 0), ...deps },
	);
	return { code, out, err };
}

const live = (w: World, id: string): string => join(w.codexHome, "skills", id);
const backups = (w: World): string => join(w.codexHome, "extension-backups");
const receipt = (w: World, id: string): Record<string, unknown> =>
	JSON.parse(readFileSync(join(live(w, id), RECEIPT_NAME), "utf8")) as Record<string, unknown>;
const backupCopies = (w: World, id: string): string[] =>
	existsSync(backups(w))
		? readdirSync(backups(w))
				.filter((stamp) => existsSync(join(backups(w), stamp, id)))
				.map((stamp) => join(backups(w), stamp, id))
		: [];
const check = (w: World): CheckReport => checkExtensions({ env: w.env, cwd: w.project });

describe("litcodex extensions", () => {
	it("knows the nine extensions in their five families", () => {
		expect(EXTENSION_IDS).toHaveLength(9);
		expect(Object.keys(EXTENSION_FAMILIES)).toEqual(["decks", "documents", "figures", "design", "video-covers"]);
		expect(EXTENSION_FAMILIES.figures).toEqual([
			"lit-diagram-drawer",
			"lit-schematic",
			"lit-scientific-visualization",
		]);
	});

	it("list shows every extension as not installed in a fresh home, as text and as JSON", () => {
		const w = world();
		const text = run(w, ["list"]);
		expect(text.code).toBe(0);
		for (const id of EXTENSION_IDS) expect(text.out).toMatch(new RegExp(`${id}\\s+not installed`, "u"));
		const json = JSON.parse(run(w, ["list", "--json"]).out) as { extensions: { id: string; state: string }[] };
		expect(json.extensions.map((entry) => entry.state)).toEqual(EXTENSION_IDS.map(() => "not-installed"));
		expect(existsSync(w.codexHome)).toBe(false);
	});

	it("install is a dry run without --yes and writes nothing", () => {
		const w = world();
		const result = run(w, ["install", "lit-docx", "--from", w.clone]);
		expect(result.code).toBe(0);
		expect(result.out).toContain("dry run");
		expect(result.out).toContain(`copy ${join(w.clone, "variants", "litcodex", "lit-docx")}`);
		expect(result.out).toContain("--yes");
		expect(existsSync(w.codexHome)).toBe(false);
	});

	it("a fresh install copies one clean folder and leaves a receipt that list reads back", () => {
		const w = world();
		const result = run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]);
		expect(result.code, result.err).toBe(0);
		expect(readFileSync(join(live(w, "lit-docx"), "SKILL.md"), "utf8")).toContain("v1");
		const r = receipt(w, "lit-docx");
		expect(r).toMatchObject({
			id: "lit-docx",
			variant: "litcodex",
			source: join(w.clone, "variants", "litcodex", "lit-docx"),
			installed_at: new Date(2026, 10, 12, 10, 0, 0).toISOString(),
		});
		expect(r["sha256"]).toMatch(/^[0-9a-f]{64}$/u);
		expect(readdirSync(join(w.codexHome, "skills"))).toEqual(["lit-docx"]);
		expect(run(w, ["list"]).out).toContain(
			`installed (litcodex, ${new Date(2026, 10, 12, 10, 0, 0).toISOString()}, `,
		);
		expect(check(w).findings).toEqual([]);
		expect(run(w, ["check"]).code).toBe(0);
	});

	it("installs over a user folder by moving it whole into extension-backups, so one live copy remains", () => {
		const w = world();
		mkdirSync(live(w, "lit-docx"), { recursive: true });
		writeFileSync(join(live(w, "lit-docx"), "my-notes.md"), "mine\n");
		writeFileSync(join(live(w, "lit-docx"), "SKILL.md"), "---\nname: lit-docx\n---\nold\n");
		expect(run(w, ["list"]).out).toMatch(/lit-docx\s+user-managed/u);
		const result = run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]);
		expect(result.code, result.err).toBe(0);
		const [saved] = backupCopies(w, "lit-docx");
		expect(saved).toBe(join(backups(w), "20261112-100000", "lit-docx"));
		expect(readFileSync(join(saved as string, "my-notes.md"), "utf8")).toBe("mine\n");
		expect(existsSync(join(live(w, "lit-docx"), "my-notes.md"))).toBe(false);
		expect(existsSync(join(live(w, "lit-docx"), "lit-docx"))).toBe(false);
		expect(result.out).toContain(`moved aside: ${saved}`);
		expect(readdirSync(join(w.codexHome, "skills"))).toEqual(["lit-docx"]);
	});

	it("stops and names a same-name personal skill Codex would also list, and installs only with --allow-shadow", () => {
		const w = world();
		const personal = join(w.home, ".agents", "skills", "lit-docx");
		writeSkill(personal, "lit-docx", "personal");
		const stopped = run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]);
		expect(stopped.code).toBe(1);
		expect(stopped.err).toContain(personal);
		expect(stopped.err).toContain("--allow-shadow");
		expect(existsSync(join(w.codexHome, "skills"))).toBe(false);
		const project = join(w.project, ".agents", "skills", "lit-pptx");
		writeSkill(project, "lit-pptx", "project");
		const report = check(w);
		expect(report.findings.map((f) => [f.kind, f.path])).toEqual([
			["competing", project],
			["competing", personal],
		]);
		const allowed = run(w, ["install", "lit-docx", "--from", w.clone, "--yes", "--allow-shadow"]);
		expect(allowed.code, allowed.err).toBe(0);
		expect(allowed.err).toContain(`warning: Codex will also list ${personal}`);
		expect(readFileSync(join(personal, "SKILL.md"), "utf8")).toContain("personal");
		expect(run(w, ["check"]).code).toBe(1);
	});

	it("update reinstalls only an extension whose source changed and reports the rest as current", () => {
		const w = world();
		expect(run(w, ["install", "lit-docx", "lit-pptx", "--from", w.clone, "--yes"]).code).toBe(0);
		writeSkill(join(w.clone, "variants", "litcodex", "lit-docx"), "lit-docx", "v2");
		const dry = run(w, ["update", "--from", w.clone]);
		expect(dry.out).toMatch(/lit-docx: source changed/u);
		expect(readFileSync(join(live(w, "lit-docx"), "SKILL.md"), "utf8")).toContain("v1");
		const result = run(w, ["update", "--from", w.clone, "--yes"], { now: () => new Date(2026, 10, 13, 10, 0, 0) });
		expect(result.code, result.err).toBe(0);
		expect(result.out).toMatch(/lit-pptx: current/u);
		expect(readFileSync(join(live(w, "lit-docx"), "SKILL.md"), "utf8")).toContain("v2");
		expect(receipt(w, "lit-docx")["installed_at"]).toBe(new Date(2026, 10, 13, 10, 0, 0).toISOString());
		expect(backupCopies(w, "lit-docx")).toEqual([join(backups(w), "20261113-100000", "lit-docx")]);
		expect(backupCopies(w, "lit-pptx")).toEqual([]);
		expect(run(w, ["update", "--from", w.clone, "--yes"]).out).toMatch(/lit-docx: current/u);
	});

	it("remove refuses a user folder and moves an installed one aside without deleting it", () => {
		const w = world();
		writeSkill(live(w, "lit-pptx"), "lit-pptx", "hand copy");
		const refused = run(w, ["remove", "lit-pptx", "--yes"]);
		expect(refused.code).toBe(1);
		expect(refused.err).toContain(`refused: ${live(w, "lit-pptx")} has no LitCodex receipt`);
		expect(existsSync(join(live(w, "lit-pptx"), "SKILL.md"))).toBe(true);
		expect(run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]).code).toBe(0);
		expect(run(w, ["remove", "lit-docx"]).out).toContain("dry run");
		expect(existsSync(live(w, "lit-docx"))).toBe(true);
		const removed = run(w, ["remove", "lit-docx", "--yes"]);
		expect(removed.code, removed.err).toBe(0);
		expect(existsSync(live(w, "lit-docx"))).toBe(false);
		expect(backupCopies(w, "lit-docx")).toHaveLength(1);
	});

	it("prune-backups lists sizes on a dry run and deletes only inside extension-backups with --yes", () => {
		const w = world();
		writeSkill(join(backups(w), "20260101-000000", "lit-docx"), "lit-docx", "old");
		writeSkill(join(backups(w), "20261111-000000", "lit-pptx"), "lit-pptx", "newer");
		const outside = join(w.codexHome, "skills", "keep-me");
		writeSkill(outside, "keep-me", "user");
		const dry = run(w, ["prune-backups"]);
		expect(dry.code).toBe(0);
		expect(dry.out).toContain("20260101-000000");
		expect(dry.out).toMatch(/\d+ B|\d+(\.\d)? KB/u);
		expect(readdirSync(backups(w))).toHaveLength(2);
		const older = run(w, ["prune-backups", "--older-than", "30", "--yes"]);
		expect(older.code, older.err).toBe(0);
		expect(readdirSync(backups(w))).toEqual(["20261111-000000"]);
		expect(run(w, ["prune-backups", "--yes"]).code).toBe(0);
		expect(readdirSync(backups(w))).toEqual([]);
		expect(existsSync(join(outside, "SKILL.md"))).toBe(true);
	});

	it("stops with the --from hint and installs nothing when the source cannot be fetched", () => {
		const w = world();
		const offline = run(w, ["install", "lit-docx", "--yes"], {
			git: () => ({ status: 128, stderr: "fatal: unable to access: Could not resolve host" }),
		});
		expect(offline.code).toBe(1);
		expect(offline.err).toContain("--from <path to your wjgoarxiv-skills clone>");
		expect(existsSync(join(w.codexHome, "skills"))).toBe(false);
		expect(existsSync(join(w.home, ".cache", "litcodex", "extensions-src"))).toBe(false);
		const missing = run(w, ["install", "lit-docx", "--yes"], {
			git: () => ({ status: null, stderr: "", error: new Error("spawnSync git ENOENT") }),
		});
		expect(missing.code).toBe(1);
		expect(missing.err).toMatch(/git is not available/u);
		const badFrom = run(w, ["install", "lit-docx", "--from", join(w.root, "nowhere"), "--yes"]);
		expect(badFrom.code).toBe(1);
		expect(badFrom.err).toContain("variants/litcodex");
		expect(existsSync(join(w.codexHome, "skills"))).toBe(false);
	});

	it("keeps its own sparse clone in the cache, fetched with git, and update pulls it", () => {
		const w = world();
		const origin = join(w.root, "origin");
		mkdirSync(origin);
		for (const id of ["lit-docx"]) writeSkill(join(origin, "variants", "litcodex", id), id, "remote v1");
		writeSkill(join(origin, "plugins", "documents", "skills", "lit-docx"), "lit-docx", "claude edition");
		const git = (...args: string[]) => {
			const r = spawnSync("git", ["-C", origin, ...args], { encoding: "utf8" });
			expect(r.status, r.stderr).toBe(0);
		};
		git("init", "-q", "-b", "main");
		git("add", "-A");
		git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "one");
		const deps = { repoUrl: `file://${origin}` };
		expect(run(w, ["install", "lit-docx"], deps).out).toContain("would clone");
		expect(existsSync(join(w.home, ".cache", "litcodex", "extensions-src"))).toBe(false);
		const first = run(w, ["install", "lit-docx", "--yes"], deps);
		expect(first.code, first.err).toBe(0);
		const cache = join(w.home, ".cache", "litcodex", "extensions-src");
		expect(existsSync(join(cache, "variants", "litcodex", "lit-docx", "SKILL.md"))).toBe(true);
		expect(existsSync(join(cache, "plugins"))).toBe(false);
		expect(readFileSync(join(live(w, "lit-docx"), "SKILL.md"), "utf8")).toContain("remote v1");
		writeSkill(join(origin, "variants", "litcodex", "lit-docx"), "lit-docx", "remote v2");
		git("add", "-A");
		git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "two");
		const updated = run(w, ["update", "--yes"], deps);
		expect(updated.code, updated.err).toBe(0);
		expect(readFileSync(join(live(w, "lit-docx"), "SKILL.md"), "utf8")).toContain("remote v2");
	});

	it("fails closed on a symlinked destination and validates every id before writing anything", () => {
		const w = world();
		mkdirSync(join(w.codexHome, "skills"), { recursive: true });
		const elsewhere = join(w.root, "elsewhere");
		writeSkill(elsewhere, "lit-pptx", "linked");
		symlinkSync(elsewhere, live(w, "lit-pptx"));
		const result = run(w, ["install", "lit-docx", "lit-pptx", "--from", w.clone, "--yes"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain(`refused: ${live(w, "lit-pptx")} is a symbolic link`);
		expect(existsSync(live(w, "lit-docx"))).toBe(false);
		expect(readFileSync(join(elsewhere, "SKILL.md"), "utf8")).toContain("linked");
		expect(run(w, ["install", "nope", "--from", w.clone]).code).toBe(64);
	});

	it("--family and --all pick the right ids", () => {
		const w = world();
		const family = run(w, ["install", "--family", "figures", "--from", w.clone]);
		for (const id of EXTENSION_FAMILIES.figures) expect(family.out).toContain(`${id}:`);
		expect(family.out).not.toContain("lit-docx:");
		expect(run(w, ["install", "--all", "--from", w.clone, "--yes"]).code).toBe(0);
		expect(readdirSync(join(w.codexHome, "skills")).sort()).toEqual([...EXTENSION_IDS].sort());
	});

	it("check finds duplicates, nested copies, missing sources and leftovers, each with a fix line", () => {
		const w = world();
		expect(run(w, ["install", "lit-docx", "lit-pptx", "--from", w.clone, "--yes"]).code).toBe(0);
		writeSkill(join(w.codexHome, "skills", "lit-docx-old"), "lit-docx", "renamed copy");
		writeSkill(join(live(w, "lit-pptx"), "lit-pptx"), "lit-pptx", "nested");
		writeSkill(live(w, "visual-qa"), "visual-qa", "hand copy");
		rmSync(join(w.clone, "variants", "litcodex", "lit-docx"), { recursive: true });
		mkdirSync(join(w.home, ".cache", "litcodex", "office"), { recursive: true });
		writeSkill(join(backups(w), "20260101-000000", "lit-docx"), "lit-docx", "old");
		const report = check(w);
		const kinds = report.findings.map((f) => `${f.kind}:${f.id ?? ""}`);
		expect(kinds).toEqual(
			expect.arrayContaining([
				"duplicate:lit-docx",
				"nested:lit-pptx",
				"no-receipt:visual-qa",
				"source-missing:lit-docx",
				"leftover-runtime:",
			]),
		);
		for (const finding of report.findings) expect(finding.fix.length).toBeGreaterThan(0);
		expect(report.backups.count).toBe(1);
		const printed = run(w, ["check"]);
		expect(printed.code).toBe(1);
		expect(printed.out).toContain("fix: ");
		expect(printed.out).toContain("litcodex extensions prune-backups");
		expect(extensionsDoctorLine({ env: w.env, cwd: w.project })).toMatch(
			/^LitFamily extensions: 2 installed, \d+ need action; run `litcodex extensions check`/u,
		);
	});

	it("doctor's line is quiet and positive in a clean home", () => {
		const w = world();
		expect(extensionsDoctorLine({ env: w.env, cwd: w.project })).toBe(
			"LitFamily extensions: none installed; `litcodex extensions list` shows the nine and `litcodex extensions install <id>` adds one",
		);
	});

	it("refuses unknown verbs and options with a usage exit", () => {
		const w = world();
		expect(run(w, ["frobnicate"]).code).toBe(64);
		expect(run(w, ["install", "lit-docx", "-n"]).code).toBe(64);
		expect(run(w, ["prune-backups", "--older-than", "soon"]).code).toBe(64);
		const help = run(w, ["--help"]);
		expect(help.code).toBe(0);
		for (const verb of ["list", "check", "install", "update", "remove", "prune-backups"]) {
			expect(help.out).toContain(`litcodex extensions ${verb}`);
		}
	});

	it("reads an install made by the manual lines as installed", () => {
		const w = world();
		const source = join(w.clone, "variants", "litcodex", "lit-docx");
		writeSkill(live(w, "lit-docx"), "lit-docx", "v1");
		writeFileSync(
			join(live(w, "lit-docx"), RECEIPT_NAME),
			`${JSON.stringify({ id: "lit-docx", source, variant: "litcodex", installed_at: "2026-11-12T00:00:00Z" })}\n`,
		);
		expect(run(w, ["list"]).out).toMatch(/lit-docx\s+installed/u);
		expect(run(w, ["update", "--from", w.clone]).out).toMatch(/lit-docx: current/u);
	});

	it("the top-level help and doctor name the verbs", () => {
		expect(dispatch(["--help"]).stdout).toContain(
			"litcodex extensions list|check|install|update|remove|prune-backups",
		);
		expect(dispatch(["extensions"]).exitCode).toBe(0);
		const w = world();
		let out = "";
		runDoctorCli(["--no-auto-update"], {
			stdout: {
				write: (chunk: string) => {
					out += chunk;
					return true;
				},
			} as unknown as NodeJS.WritableStream,
			stderr: { write: () => true } as unknown as NodeJS.WritableStream,
			env: { ...w.env, PATH: "" },
			repoRoot: w.project,
		});
		expect(out).toContain("LitFamily extensions: none installed; `litcodex extensions list` shows the nine");
	});
	it("refuses a source id folder that is a symbolic link and writes nothing through it", () => {
		const w = world();
		const src = join(w.clone, "variants", "litcodex", "lit-docx");
		const elsewhere = join(w.root, "realdocx");
		writeSkill(elsewhere, "lit-docx", "linked source");
		rmSync(src, { recursive: true });
		symlinkSync(elsewhere, src);
		const result = run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain(`${src} is a symbolic link`);
		expect(existsSync(live(w, "lit-docx"))).toBe(false);
		expect(existsSync(join(elsewhere, RECEIPT_NAME))).toBe(false);
	});

	it("update's dry run fetches nothing and says it compared with the cached copy", () => {
		const w = world();
		const cache = join(w.home, ".cache", "litcodex", "extensions-src");
		cpSync(join(w.clone, "variants"), join(cache, "variants"), { recursive: true });
		expect(run(w, ["install", "lit-docx", "--yes"]).code).toBe(0);
		const calls: string[][] = [];
		const git = (args: readonly string[]) => {
			calls.push([...args]);
			return { status: 0, stderr: "" };
		};
		const dry = run(w, ["update"], { git });
		expect(dry.code, dry.err).toBe(0);
		expect(calls).toEqual([]);
		expect(dry.out).toContain("cached copy");
		expect(dry.out).toContain("--yes fetches first");
		expect(dry.out).toMatch(/lit-docx: current/u);
	});

	it("update's dry run with no cache yet says the comparison waits for the fetch", () => {
		const w = world();
		expect(run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]).code).toBe(0);
		const dry = run(w, ["update"], { git: () => ({ status: 0, stderr: "" }) });
		expect(dry.code, dry.err).toBe(0);
		expect(dry.out).toContain("after the fetch");
		expect(dry.out).not.toMatch(/lit-docx: (copy|source changed)/u);
		expect(existsSync(join(w.home, ".cache", "litcodex"))).toBe(false);
	});

	it("install stops on a same-name skill in Codex's own skills folder under another folder name", () => {
		const w = world();
		const renamed = join(w.codexHome, "skills", "old-docx");
		writeSkill(renamed, "lit-docx", "renamed copy");
		const stopped = run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]);
		expect(stopped.code).toBe(1);
		expect(stopped.err).toContain(renamed);
		expect(existsSync(live(w, "lit-docx"))).toBe(false);
		const allowed = run(w, ["install", "lit-docx", "--from", w.clone, "--yes", "--allow-shadow"]);
		expect(allowed.code, allowed.err).toBe(0);
		expect(allowed.err).toContain(renamed);
		expect(readFileSync(join(renamed, "SKILL.md"), "utf8")).toContain("renamed copy");
	});

	it("a personal skill with the extension's name under another folder name counts as competing", () => {
		const w = world();
		const personal = join(w.home, ".agents", "skills", "my-pptx");
		writeSkill(personal, "lit-pptx", "personal");
		expect(run(w, ["list"]).out).toContain(`competing: ${personal}`);
		expect(check(w).findings.map((f) => [f.kind, f.path])).toEqual([["competing", personal]]);
		const stopped = run(w, ["install", "lit-pptx", "--from", w.clone, "--yes"]);
		expect(stopped.code).toBe(1);
		expect(stopped.err).toContain(personal);
	});

	it("the duplicate fix line moves the copy into a dated backup set that prune-backups lists", () => {
		const w = world();
		writeSkill(join(w.codexHome, "skills", "old-docx"), "lit-docx", "renamed copy");
		const [finding] = check(w).findings;
		expect(finding?.kind).toBe("duplicate");
		expect(finding?.fix).not.toContain("manual");
		const ran = spawnSync("/bin/bash", ["-c", finding?.fix ?? "false"], { encoding: "utf8" });
		expect(ran.status, ran.stderr).toBe(0);
		expect(check(w).findings).toEqual([]);
		const listed = run(w, ["prune-backups"]);
		expect(listed.out).toMatch(/\d{8}-\d{6}\s.*old-docx/u);
		expect(check(w).backups.count).toBe(1);
	});

	it("the notice's check line leaves out the stale notice that the same install replaces", () => {
		const w = world();
		const notice = join(w.home, ".litcodex", "extensions-notice.json");
		mkdirSync(dirname(notice), { recursive: true });
		writeFileSync(notice, `${JSON.stringify({ schemaVersion: 1, version: "0.0.1", message: "old" })}\n`);
		expect(check(w).findings.map((f) => f.kind)).toEqual(["stale-notice"]);
		expect(extensionsNoticeLine({ env: w.env, cwd: w.project })).toBeUndefined();
	});

	it("a source that only moved reports current and rewrites just the receipt's source", () => {
		const w = world();
		expect(run(w, ["install", "lit-docx", "--from", w.clone, "--yes"]).code).toBe(0);
		const before = receipt(w, "lit-docx");
		const moved = join(w.root, "clone-2");
		cpSync(w.clone, moved, { recursive: true });
		const dry = run(w, ["update", "--from", moved]);
		expect(dry.out).toMatch(/lit-docx: current/u);
		expect(receipt(w, "lit-docx")).toEqual(before);
		const result = run(w, ["update", "--from", moved, "--yes"], { now: () => new Date(2026, 10, 13, 10, 0, 0) });
		expect(result.code, result.err).toBe(0);
		expect(result.out).toMatch(/lit-docx: current/u);
		expect(receipt(w, "lit-docx")).toEqual({ ...before, source: join(moved, "variants", "litcodex", "lit-docx") });
		expect(backupCopies(w, "lit-docx")).toEqual([]);
		expect(readdirSync(live(w, "lit-docx")).filter((name) => name.includes(".tmp"))).toEqual([]);
	});
});
