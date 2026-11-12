// `litcodex extensions <verb>`: list, check, install, update, remove and prune the nine LitFamily extensions.
//
// This is the four manual stub lines (check, move aside, copy, receipt) done in code. It writes only to
// ${CODEX_HOME}/skills/<id>, ${CODEX_HOME}/extension-backups/ and its own source clone under
// ${XDG_CACHE_HOME:-~/.cache}/litcodex/extensions-src. The other folders Codex reads skills from (~/.agents/skills and
// the project's .agents/skills and .codex/skills) are only read: a same-name skill there stops an install. Every write
// verb is a dry run until --yes is given, and nothing is ever deleted except backups by `prune-backups --yes`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { resolveCodexHome } from "./codex.js";
import {
	CLONE_PLACEHOLDER,
	EXTENSIONS_REPO_URL,
	extensionsNoticePath,
	leftoverRuntimePaths,
} from "./extensions-notice.js";

export const EXTENSION_FAMILIES = {
	decks: ["lit-pptx"],
	documents: ["lit-docx"],
	figures: ["lit-diagram-drawer", "lit-schematic", "lit-scientific-visualization"],
	design: ["frontend-ui-ux", "visual-qa"],
	"video-covers": ["lit-typographic-motion", "readme-studio"],
} as const satisfies Record<string, readonly string[]>;

export type FamilyName = keyof typeof EXTENSION_FAMILIES;
export const EXTENSION_IDS: readonly string[] = Object.values(EXTENSION_FAMILIES).flat();
export const RECEIPT_NAME = ".litfamily-extension.json";
const VARIANT = "litcodex";
const USAGE_EXIT_CODE = 64;
const PACKAGE_VERSION = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;

const familyOf = (id: string): string =>
	Object.entries(EXTENSION_FAMILIES).find(([, ids]) => (ids as readonly string[]).includes(id))?.[0] ?? "";

export interface GitResult {
	readonly status: number | null;
	readonly stderr: string;
	readonly error?: Error;
}
export type GitRunner = (args: readonly string[]) => GitResult;

export interface ExtensionsDeps {
	readonly now?: () => Date;
	readonly git?: GitRunner;
	/** The shelf's clone URL; tests point it at a local repository. */
	readonly repoUrl?: string;
}

export interface ExtensionsContext {
	readonly env: NodeJS.ProcessEnv;
	readonly cwd: string;
}

export interface ExtensionsIo extends ExtensionsContext {
	readonly stdout: NodeJS.WritableStream;
	readonly stderr: NodeJS.WritableStream;
}

interface Paths {
	readonly codexHome: string;
	readonly skills: string;
	readonly backups: string;
	readonly cache: string;
	readonly home: string;
}

function pathsFor(env: NodeJS.ProcessEnv): Paths {
	const codexHome = resolveCodexHome(env);
	const home = env["HOME"]?.trim() || homedir();
	const cacheRoot = env["XDG_CACHE_HOME"]?.trim() || join(home, ".cache");
	return {
		codexHome,
		skills: join(codexHome, "skills"),
		backups: join(codexHome, "extension-backups"),
		cache: join(cacheRoot, "litcodex", "extensions-src"),
		home,
	};
}

interface Receipt {
	readonly id: string;
	readonly source: string;
	readonly variant: string;
	readonly installed_at: string;
	readonly sha256?: string;
}

type State = "not-installed" | "installed" | "user-managed" | "not-a-folder";

export interface ListEntry {
	readonly id: string;
	readonly family: string;
	readonly state: State;
	readonly path: string;
	readonly receipt?: Receipt;
	/** Same-name skills in the other folders Codex reads, which it would list as well. */
	readonly competing: readonly string[];
}

export interface Finding {
	readonly kind:
		| "competing"
		| "duplicate"
		| "nested"
		| "no-receipt"
		| "not-a-folder"
		| "source-missing"
		| "stale-notice"
		| "leftover-runtime";
	readonly id?: string;
	readonly path: string;
	readonly message: string;
	readonly fix: string;
}

export interface CheckReport {
	readonly entries: readonly ListEntry[];
	readonly findings: readonly Finding[];
	readonly backups: { readonly root: string; readonly count: number; readonly bytes: number };
}

function lstat(path: string): ReturnType<typeof lstatSync> | undefined {
	try {
		return lstatSync(path);
	} catch {
		return undefined;
	}
}

function readReceipt(dir: string, id: string): Receipt | undefined {
	try {
		const parsed = JSON.parse(readFileSync(join(dir, RECEIPT_NAME), "utf8")) as Partial<Receipt>;
		if (parsed.id !== id || parsed.variant !== VARIANT) return undefined;
		if (typeof parsed.source !== "string" || typeof parsed.installed_at !== "string") return undefined;
		return parsed as Receipt;
	} catch {
		return undefined;
	}
}

function skillName(skillMd: string): string | undefined {
	try {
		const text = readFileSync(skillMd, "utf8");
		return /^---\r?\n(?:[^\n]*\n)*?name:\s*["']?([^"'\r\n]+?)["']?\s*\r?\n/u.exec(text)?.[1];
	} catch {
		return undefined;
	}
}

/** The repo root Codex resolves project skills against: the nearest folder holding .git, or cwd. */
function projectFolders(cwd: string): string[] {
	const chain: string[] = [];
	let dir = resolve(cwd);
	for (;;) {
		chain.push(dir);
		if (existsSync(join(dir, ".git"))) return chain;
		const parent = dirname(dir);
		if (parent === dir) return [resolve(cwd)];
		dir = parent;
	}
}

/** Every other folder Codex 0.167 reads skills from, in the order it was probed. */
function otherRoots(ctx: ExtensionsContext, paths: Paths): string[] {
	const chain = projectFolders(ctx.cwd);
	const root = chain.at(-1) as string;
	return [
		...chain.map((dir) => join(dir, ".agents", "skills")),
		join(root, ".codex", "skills"),
		join(paths.home, ".agents", "skills"),
	].filter((dir, index, all) => all.indexOf(dir) === index && resolve(dir) !== resolve(paths.skills));
}

function entryFor(id: string, ctx: ExtensionsContext, paths: Paths): ListEntry {
	const path = join(paths.skills, id);
	const competing = otherRoots(ctx, paths)
		.map((dir) => join(dir, id))
		.filter((candidate) => lstat(candidate) !== undefined);
	const stat = lstat(path);
	const base = { id, family: familyOf(id), path, competing };
	if (stat === undefined) return { ...base, state: "not-installed" };
	if (stat.isSymbolicLink() || !stat.isDirectory()) return { ...base, state: "not-a-folder" };
	const receipt = readReceipt(path, id);
	return receipt === undefined ? { ...base, state: "user-managed" } : { ...base, state: "installed", receipt };
}

function dirBytes(dir: string): number {
	let total = 0;
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const stat = lstatSync(path);
		total += stat.isDirectory() ? dirBytes(path) : stat.size;
	}
	return total;
}

const STAMP_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/u;

interface BackupSet {
	readonly name: string;
	readonly path: string;
	readonly bytes: number;
	readonly takenAt: Date;
}

function listBackups(paths: Paths): BackupSet[] {
	const stat = lstat(paths.backups);
	if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) return [];
	return readdirSync(paths.backups)
		.sort()
		.flatMap((name) => {
			const match = STAMP_RE.exec(name);
			const path = join(paths.backups, name);
			const entry = lstat(path);
			if (match === null || entry === undefined || entry.isSymbolicLink() || !entry.isDirectory()) return [];
			const [y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0] = match.slice(1, 7).map(Number);
			return [{ name, path, bytes: dirBytes(path), takenAt: new Date(y, mo - 1, d, h, mi, s) }];
		});
}

export function checkExtensions(ctx: ExtensionsContext): CheckReport {
	const paths = pathsFor(ctx.env);
	const entries = EXTENSION_IDS.map((id) => entryFor(id, ctx, paths));
	const findings: Finding[] = [];
	for (const entry of entries) {
		for (const path of entry.competing) {
			findings.push({
				kind: "competing",
				id: entry.id,
				path,
				message: `${entry.id}: Codex also lists ${path}, a same-name skill LitCodex never touches`,
				fix: `move ${path} out of that folder yourself, or keep it on purpose and install with --allow-shadow`,
			});
		}
		if (entry.state === "not-a-folder") {
			findings.push({
				kind: "not-a-folder",
				id: entry.id,
				path: entry.path,
				message: `${entry.id}: ${entry.path} is a symbolic link or a file`,
				fix: `move ${entry.path} away yourself, then run \`litcodex extensions install ${entry.id} --yes\``,
			});
		}
		if (entry.state === "user-managed") {
			findings.push({
				kind: "no-receipt",
				id: entry.id,
				path: entry.path,
				message: `${entry.id}: ${entry.path} has no receipt, so it is yours and update leaves it alone`,
				fix: `litcodex extensions install ${entry.id} --yes   (moves your folder to extension-backups and installs a tracked copy)`,
			});
		}
		if (entry.state === "installed" || entry.state === "user-managed") {
			if (existsSync(join(entry.path, entry.id, "SKILL.md"))) {
				findings.push({
					kind: "nested",
					id: entry.id,
					path: join(entry.path, entry.id),
					message: `${entry.id}: a second copy sits inside the first at ${join(entry.path, entry.id)}`,
					fix: `litcodex extensions install ${entry.id} --yes   (moves the whole folder aside and copies once)`,
				});
			}
		}
		if (entry.receipt !== undefined && !existsSync(join(entry.receipt.source, "SKILL.md"))) {
			findings.push({
				kind: "source-missing",
				id: entry.id,
				path: entry.receipt.source,
				message: `${entry.id}: its receipt points at ${entry.receipt.source}, which no longer exists`,
				fix: `litcodex extensions update ${entry.id} --yes   (or add --from <path to your wjgoarxiv-skills clone>)`,
			});
		}
	}
	const skillsStat = lstat(paths.skills);
	if (skillsStat?.isDirectory() === true) {
		for (const name of readdirSync(paths.skills).sort()) {
			if (EXTENSION_IDS.includes(name)) continue;
			const named = skillName(join(paths.skills, name, "SKILL.md"));
			if (named === undefined || !EXTENSION_IDS.includes(named)) continue;
			const path = join(paths.skills, name);
			findings.push({
				kind: "duplicate",
				id: named,
				path,
				message: `${named}: ${path} is a second copy under another folder name, and Codex lists both`,
				fix: `mkdir -p "${join(paths.backups, "manual")}" && mv "${path}" "${join(paths.backups, "manual", name)}"`,
			});
		}
	}
	const notice = extensionsNoticePath(ctx.env);
	try {
		const parsed = JSON.parse(readFileSync(notice, "utf8")) as { version?: unknown };
		if (parsed.version !== PACKAGE_VERSION) {
			findings.push({
				kind: "stale-notice",
				path: notice,
				message: `an unshown extensions notice from LitCodex ${String(parsed.version)} is still waiting`,
				fix: `rm "${notice}"`,
			});
		}
	} catch {
		// No notice waiting, or one the session hook will drop as malformed.
	}
	for (const path of leftoverRuntimePaths(ctx.env)) {
		findings.push({
			kind: "leftover-runtime",
			path,
			message: `LitCodex 1.0.38 and earlier left a runtime in ${path}; nothing uses it now`,
			fix: `rm -r "${path}"`,
		});
	}
	const sets = listBackups(paths);
	return {
		entries,
		findings,
		backups: { root: paths.backups, count: sets.length, bytes: sets.reduce((sum, set) => sum + set.bytes, 0) },
	};
}

/** The one line `litcodex doctor` prints. */
export function extensionsDoctorLine(ctx: ExtensionsContext): string {
	let report: CheckReport;
	try {
		report = checkExtensions(ctx);
	} catch (error) {
		return `LitFamily extensions: could not be checked (${(error as Error).message}); run \`litcodex extensions check\``;
	}
	const installed = report.entries.filter((entry) => entry.state === "installed").length;
	if (report.findings.length > 0) {
		return `LitFamily extensions: ${installed} installed, ${report.findings.length} need action; run \`litcodex extensions check\` for the fix lines`;
	}
	if (installed === 0) {
		return "LitFamily extensions: none installed; `litcodex extensions list` shows the nine and `litcodex extensions install <id>` adds one";
	}
	return `LitFamily extensions: ${installed} installed, nothing to fix`;
}

/** One notice line for existing users, or undefined when check is clean. */
export function extensionsNoticeLine(ctx: ExtensionsContext): string | undefined {
	try {
		const count = checkExtensions(ctx).findings.length;
		return count === 0
			? undefined
			: `${count} thing${count === 1 ? "" : "s"} about your extension folders need a look: run \`litcodex extensions check\`. Nothing was changed.`;
	} catch {
		return undefined;
	}
}

// ---- source ---------------------------------------------------------------------------------------------------

interface Source {
	/** The clone root; `variants/litcodex/<id>` lives under it. Absent while a dry run has nothing cached yet. */
	readonly root?: string;
	readonly kind: "from" | "cache";
	/** What a --yes run does to the cache before copying, for the dry run text. */
	readonly pending?: "clone" | "fetch";
}

class StopError extends Error {}

const realGit: GitRunner = (args) => {
	const result = spawnSync("git", [...args], {
		encoding: "utf8",
		timeout: 180_000,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	return { status: result.status, stderr: result.stderr ?? "", ...(result.error ? { error: result.error } : {}) };
};

function gitOrStop(git: GitRunner, args: readonly string[], what: string): void {
	const result = git(args);
	if (result.error !== undefined) {
		throw new StopError(
			`git is not available (${result.error.message}), so the shelf cannot be ${what}. Nothing was installed. Clone ${EXTENSIONS_REPO_URL} yourself and pass --from ${CLONE_PLACEHOLDER}.`,
		);
	}
	if (result.status !== 0) {
		const reason = result.stderr.trim().split("\n").at(-1) ?? `exit ${String(result.status)}`;
		throw new StopError(
			`the shelf could not be ${what} (${reason}). Nothing was installed. If you are offline, clone ${EXTENSIONS_REPO_URL} when you can and pass --from ${CLONE_PLACEHOLDER}.`,
		);
	}
}

function variantRoot(root: string): string {
	return join(root, "variants", VARIANT);
}

function resolveSource(
	from: string | undefined,
	paths: Paths,
	opts: { apply: boolean; refresh: boolean },
	deps: ExtensionsDeps,
): Source {
	if (from !== undefined) {
		const root = resolve(from);
		if (lstat(variantRoot(root))?.isDirectory() !== true) {
			throw new StopError(`${root} is not a wjgoarxiv-skills clone: ${variantRoot(root)} is missing.`);
		}
		return { root, kind: "from" };
	}
	const cached = lstat(variantRoot(paths.cache))?.isDirectory() === true;
	if (!opts.apply) {
		if (!cached) return { kind: "cache", pending: "clone" };
		return { root: paths.cache, kind: "cache", ...(opts.refresh ? { pending: "fetch" as const } : {}) };
	}
	const git = deps.git ?? realGit;
	if (!cached) {
		if (lstat(paths.cache) !== undefined) {
			throw new StopError(
				`${paths.cache} exists but holds no variants/${VARIANT} folder. Move it away, or pass --from ${CLONE_PLACEHOLDER}.`,
			);
		}
		const staging = `${paths.cache}.incoming-${process.pid}`;
		mkdirSync(dirname(paths.cache), { recursive: true });
		try {
			gitOrStop(
				git,
				[
					"clone",
					"--quiet",
					"--depth",
					"1",
					"--filter=blob:none",
					"--sparse",
					deps.repoUrl ?? `${EXTENSIONS_REPO_URL}.git`,
					staging,
				],
				"cloned",
			);
			gitOrStop(git, ["-C", staging, "sparse-checkout", "set", `variants/${VARIANT}`], "checked out");
			if (lstat(variantRoot(staging))?.isDirectory() !== true) {
				throw new StopError(`the clone has no variants/${VARIANT} folder. Nothing was installed.`);
			}
			renameSync(staging, paths.cache);
		} finally {
			if (lstat(staging) !== undefined) rmSync(staging, { recursive: true, force: true });
		}
	} else if (opts.refresh) {
		gitOrStop(git, ["-C", paths.cache, "fetch", "--quiet", "--depth", "1", "origin", "HEAD"], "fetched");
		gitOrStop(git, ["-C", paths.cache, "checkout", "--quiet", "--force", "--detach", "FETCH_HEAD"], "checked out");
	}
	return { root: paths.cache, kind: "cache" };
}

// ---- folder helpers -------------------------------------------------------------------------------------------

function filesOf(dir: string, base: string = dir): string[] {
	return readdirSync(dir)
		.sort()
		.flatMap((name) => {
			const path = join(dir, name);
			const stat = lstatSync(path);
			if (stat.isSymbolicLink()) throw new StopError(`${path} is a symbolic link; the source must be plain files.`);
			if (stat.isDirectory()) return filesOf(path, base);
			return [relative(base, path)];
		});
}

/** sha256 over every file's relative path and bytes, leaving out the receipt. */
export function folderHash(dir: string): string {
	const hash = createHash("sha256");
	for (const rel of filesOf(dir)) {
		if (rel === RECEIPT_NAME) continue;
		hash.update(rel.split(sep).join("/"));
		hash.update("\0");
		hash.update(readFileSync(join(dir, rel)));
		hash.update("\0");
	}
	return hash.digest("hex");
}

/** Local time, like the manual lines' `date +%Y%m%d-%H%M%S`. */
function stampOf(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function backupTarget(paths: Paths, stamp: string, id: string): string {
	for (let n = 1; ; n += 1) {
		const target = join(paths.backups, n === 1 ? stamp : `${stamp}-${n}`, id);
		if (lstat(target) === undefined) return target;
	}
}

function assertRealDir(path: string): void {
	const stat = lstat(path);
	if (stat !== undefined && (stat.isSymbolicLink() || !stat.isDirectory())) {
		throw new StopError(`refused: ${path} is not a plain folder. LitCodex writes only into a real folder there.`);
	}
}

// ---- verbs ----------------------------------------------------------------------------------------------------

interface Parsed {
	readonly verb: string;
	readonly ids: string[];
	readonly families: string[];
	readonly all: boolean;
	readonly from?: string;
	readonly yes: boolean;
	readonly json: boolean;
	readonly allowShadow: boolean;
	readonly olderThan?: number;
	readonly help: boolean;
}

const VERB_OPTIONS: Readonly<Record<string, readonly string[]>> = {
	list: ["--json"],
	check: ["--json"],
	install: ["--family", "--all", "--from", "--yes", "--json", "--allow-shadow"],
	update: ["--all", "--from", "--yes", "--json", "--allow-shadow"],
	remove: ["--yes", "--json"],
	"prune-backups": ["--older-than", "--yes", "--json"],
};
const VALUE_OPTIONS = new Set(["--family", "--from", "--older-than"]);

export const EXTENSIONS_HELP_TEXT = [
	"litcodex extensions — manage the nine LitFamily extensions in Codex's own skills folder",
	"",
	"  litcodex extensions list [--json]                     What is installed, yours, or competing",
	"  litcodex extensions check [--json]                    Read-only; exit 1 with a fix line for each problem",
	"  litcodex extensions install <id...>|--family <name>|--all [--from <clone>] [--allow-shadow] [--yes]",
	"  litcodex extensions update [<id...>|--all] [--from <clone>] [--yes]   Reinstall what changed upstream",
	"  litcodex extensions remove <id...> [--yes]            Move an installed copy to extension-backups",
	"  litcodex extensions prune-backups [--older-than <days>] [--yes]",
	"",
	"Every write is a dry run until you add --yes. Old copies move to ~/.codex/extension-backups/ (or under CODEX_HOME),",
	"which Codex does not read; only prune-backups --yes deletes, and only there. Without --from, LitCodex keeps its own",
	`sparse clone of ${EXTENSIONS_REPO_URL} under ~/.cache/litcodex/extensions-src.`,
	`Families: ${Object.entries(EXTENSION_FAMILIES)
		.map(([name, ids]) => `${name} (${ids.join(", ")})`)
		.join("; ")}.`,
	"",
].join("\n");

function parse(args: readonly string[]): Parsed | string {
	const help = args.includes("--help") || args.includes("-h");
	const verb = args[0];
	if (help)
		return { verb: verb ?? "", ids: [], families: [], all: false, yes: false, json: false, allowShadow: false, help };
	if (verb === undefined || !Object.hasOwn(VERB_OPTIONS, verb)) return `unknown verb "${verb ?? ""}"`;
	const allowed = VERB_OPTIONS[verb] as readonly string[];
	const ids: string[] = [];
	const families: string[] = [];
	let from: string | undefined;
	let olderThan: number | undefined;
	const flags = new Set<string>();
	for (let i = 1; i < args.length; i += 1) {
		const token = args[i] as string;
		if (!token.startsWith("-")) {
			if (verb === "list" || verb === "check" || verb === "prune-backups") return `unexpected argument "${token}"`;
			if (!EXTENSION_IDS.includes(token))
				return `unknown extension "${token}"; the nine are ${EXTENSION_IDS.join(", ")}`;
			ids.push(token);
			continue;
		}
		if (!allowed.includes(token)) return `unknown option "${token}" for ${verb}; accepted: ${allowed.join(", ")}`;
		if (VALUE_OPTIONS.has(token)) {
			const value = args[i + 1];
			if (value === undefined || value.startsWith("-")) return `${token} needs a value`;
			i += 1;
			if (token === "--family") {
				if (!Object.hasOwn(EXTENSION_FAMILIES, value)) {
					return `unknown family "${value}"; the five are ${Object.keys(EXTENSION_FAMILIES).join(", ")}`;
				}
				families.push(value);
			} else if (token === "--from") from = value;
			else {
				if (!/^\d+$/u.test(value)) return "--older-than takes a whole number of days";
				olderThan = Number(value);
			}
			continue;
		}
		flags.add(token);
	}
	return {
		verb,
		ids,
		families,
		all: flags.has("--all"),
		...(from === undefined ? {} : { from }),
		yes: flags.has("--yes"),
		json: flags.has("--json"),
		allowShadow: flags.has("--allow-shadow"),
		...(olderThan === undefined ? {} : { olderThan }),
		help: false,
	};
}

function selected(parsed: Parsed): string[] {
	if (parsed.all) return [...EXTENSION_IDS];
	const picked = new Set<string>(parsed.ids);
	for (const family of parsed.families) for (const id of EXTENSION_FAMILIES[family as FamilyName]) picked.add(id);
	return EXTENSION_IDS.filter((id) => picked.has(id));
}

interface Out {
	readonly lines: string[];
	readonly warnings: string[];
	readonly errors: string[];
	readonly actions: { id: string; action: string; detail?: string }[];
}

function describeState(entry: ListEntry): string {
	if (entry.state === "installed" && entry.receipt !== undefined) {
		return `installed (${entry.receipt.variant}, ${entry.receipt.installed_at}, ${entry.receipt.source})`;
	}
	if (entry.state === "user-managed") return `user-managed (no receipt: ${entry.path})`;
	if (entry.state === "not-a-folder") return `not a folder (${entry.path})`;
	return "not installed";
}

function renderList(report: CheckReport): string {
	const width = Math.max(...EXTENSION_IDS.map((id) => id.length));
	const lines = [`LitFamily extensions in ${dirname(report.entries[0]?.path ?? "")}`];
	for (const entry of report.entries) {
		lines.push(`  ${entry.id.padEnd(width)}  ${describeState(entry)}`);
		for (const path of entry.competing) lines.push(`  ${"".padEnd(width)}  competing: ${path}`);
	}
	return `${lines.join("\n")}\n`;
}

function renderCheck(report: CheckReport): string {
	const lines: string[] = [];
	if (report.findings.length === 0) lines.push("LitFamily extensions: nothing needs action.");
	else lines.push(`LitFamily extensions: ${report.findings.length} need action.`);
	for (const finding of report.findings) {
		lines.push(`- ${finding.message}`);
		lines.push(`  fix: ${finding.fix}`);
	}
	if (report.backups.count > 0) {
		lines.push(
			`${report.backups.count} backup set${report.backups.count === 1 ? "" : "s"} in ${report.backups.root} use ${formatBytes(report.backups.bytes)}; \`litcodex extensions prune-backups\` lists them.`,
		);
	}
	return `${lines.join("\n")}\n`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface InstallPlanItem {
	readonly id: string;
	readonly source: string;
	readonly dest: string;
	readonly moveAside: boolean;
	readonly reason?: string;
}

function preflight(
	ids: readonly string[],
	ctx: ExtensionsContext,
	paths: Paths,
	source: Source,
	allowShadow: boolean,
	out: Out,
): InstallPlanItem[] {
	assertRealDir(paths.codexHome);
	assertRealDir(paths.skills);
	assertRealDir(paths.backups);
	const items: InstallPlanItem[] = [];
	const problems: string[] = [];
	for (const id of ids) {
		const entry = entryFor(id, ctx, paths);
		const src = join(source.root === undefined ? variantRoot(paths.cache) : variantRoot(source.root), id);
		if (entry.state === "not-a-folder") {
			problems.push(
				`refused: ${entry.path} is a symbolic link or a file. Move it away yourself; LitCodex does not follow it.`,
			);
			continue;
		}
		if (source.root !== undefined) {
			if (lstat(join(src, "SKILL.md"))?.isFile() !== true) {
				problems.push(`${id}: the source ${src} has no SKILL.md. Pull your clone, or check the --from path.`);
				continue;
			}
			try {
				filesOf(src);
			} catch (error) {
				problems.push(`${id}: ${(error as Error).message}`);
				continue;
			}
		}
		for (const path of entry.competing) {
			if (allowShadow)
				out.warnings.push(`warning: Codex will also list ${path}, a same-name skill LitCodex leaves alone.`);
			else {
				problems.push(
					`stopped: ${path} is a same-name ${id} that Codex would list beside the extension. Move it out of that folder yourself, or pass --allow-shadow to install anyway.`,
				);
			}
		}
		items.push({ id, source: src, dest: entry.path, moveAside: entry.state !== "not-installed" });
	}
	if (problems.length > 0) throw new StopError(`${problems.join("\n")}\nNothing was installed.`);
	return items;
}

function installOne(item: InstallPlanItem, paths: Paths, stamp: string, now: Date, out: Out): void {
	mkdirSync(paths.skills, { recursive: true });
	mkdirSync(paths.backups, { recursive: true });
	const staging = join(paths.backups, `.incoming-${process.pid}-${item.id}`);
	const staged = join(staging, item.id);
	if (lstat(staging) !== undefined) rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging);
	let movedTo: string | undefined;
	try {
		cpSync(item.source, staged, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
		const receipt: Receipt = {
			id: item.id,
			source: item.source,
			variant: VARIANT,
			installed_at: now.toISOString(),
			sha256: folderHash(staged),
		};
		writeFileSync(join(staged, RECEIPT_NAME), `${JSON.stringify(receipt)}\n`);
		if (item.moveAside && lstat(item.dest) !== undefined) {
			movedTo = backupTarget(paths, stamp, item.id);
			mkdirSync(dirname(movedTo), { recursive: true });
			renameSync(item.dest, movedTo);
			out.lines.push(`${item.id}: moved aside: ${movedTo}`);
		}
		renameSync(staged, item.dest);
		out.lines.push(`${item.id}: installed ${item.dest}`);
		out.actions.push({ id: item.id, action: "installed", ...(movedTo ? { detail: movedTo } : {}) });
	} catch (error) {
		if (movedTo !== undefined && lstat(item.dest) === undefined) renameSync(movedTo, item.dest);
		throw error;
	} finally {
		if (lstat(staging) !== undefined) rmSync(staging, { recursive: true, force: true });
	}
}

function describeSource(source: Source, paths: Paths): string {
	if (source.kind === "from") return `source: ${source.root as string} (--from)`;
	if (source.pending === "clone") {
		return `source: would clone ${EXTENSIONS_REPO_URL} (only variants/${VARIANT}) into ${paths.cache}`;
	}
	if (source.pending === "fetch") return `source: ${paths.cache}; would fetch the newest shelf first`;
	return `source: ${paths.cache}`;
}

function runInstall(parsed: Parsed, ctx: ExtensionsContext, deps: ExtensionsDeps, out: Out): number {
	const ids = selected(parsed);
	if (ids.length === 0) throw new UsageError("install needs <id...>, --family <name> or --all");
	const paths = pathsFor(ctx.env);
	const source = resolveSource(parsed.from, paths, { apply: parsed.yes, refresh: false }, deps);
	const items = preflight(ids, ctx, paths, source, parsed.allowShadow, out);
	return applyInstall(items, parsed, paths, source, deps, out);
}

function applyInstall(
	items: readonly InstallPlanItem[],
	parsed: Parsed,
	paths: Paths,
	source: Source,
	deps: ExtensionsDeps,
	out: Out,
): number {
	if (!parsed.yes) {
		out.lines.push(
			`litcodex extensions ${parsed.verb} (dry run: nothing was changed)`,
			describeSource(source, paths),
		);
		for (const item of items) {
			const steps = [
				...(item.moveAside ? [`move ${item.dest} to ${join(paths.backups, "<date-time>", item.id)}`] : []),
				`copy ${item.source} to ${item.dest}`,
				`write ${join(item.dest, RECEIPT_NAME)}`,
			];
			out.lines.push(`${item.id}: ${steps.join("; ")}`);
			out.actions.push({ id: item.id, action: "would-install" });
		}
		out.lines.push("Run it again with --yes to do this. Start a new Codex session afterwards.");
		return 0;
	}
	const now = (deps.now ?? (() => new Date()))();
	const stamp = stampOf(now);
	for (const item of items) installOne(item, paths, stamp, now, out);
	if (items.length > 0) out.lines.push("Start a new Codex session to see the change.");
	return 0;
}

function runUpdate(parsed: Parsed, ctx: ExtensionsContext, deps: ExtensionsDeps, out: Out): number {
	const paths = pathsFor(ctx.env);
	const requested = parsed.ids.length > 0 ? parsed.ids : [...EXTENSION_IDS];
	const entries = requested.map((id) => entryFor(id, ctx, paths));
	const installed = entries.filter((entry) => entry.state === "installed");
	for (const entry of entries) {
		if (entry.state === "user-managed")
			out.lines.push(`${entry.id}: yours (no receipt), left alone; install it to track it`);
		else if (entry.state !== "installed" && parsed.ids.length > 0) out.lines.push(`${entry.id}: not installed`);
	}
	if (installed.length === 0) {
		out.lines.push("No installed extension to update. `litcodex extensions install <id>` adds one.");
		return 0;
	}
	const source = resolveSource(parsed.from, paths, { apply: parsed.yes, refresh: true }, deps);
	const changed: string[] = [];
	for (const entry of installed) {
		if (source.root === undefined) {
			changed.push(entry.id);
			continue;
		}
		const src = join(variantRoot(source.root), entry.id);
		if (lstat(join(src, "SKILL.md")) === undefined) {
			out.warnings.push(`${entry.id}: the source ${src} is gone; kept the installed copy`);
			continue;
		}
		const was = entry.receipt?.sha256 ?? folderHash(entry.path);
		const sourceMoved = resolve(entry.receipt?.source ?? "") !== resolve(src);
		if (folderHash(src) === was && !sourceMoved) out.lines.push(`${entry.id}: current`);
		else {
			out.lines.push(`${entry.id}: source changed`);
			changed.push(entry.id);
		}
	}
	if (changed.length === 0) return 0;
	const items = preflight(changed, ctx, paths, source, parsed.allowShadow, out);
	return applyInstall(items, parsed, paths, source, deps, out);
}

function runRemove(parsed: Parsed, ctx: ExtensionsContext, deps: ExtensionsDeps, out: Out): number {
	if (parsed.ids.length === 0) throw new UsageError("remove needs <id...>");
	const paths = pathsFor(ctx.env);
	const entries = parsed.ids.map((id) => entryFor(id, ctx, paths));
	const refusals = entries.flatMap((entry) => {
		if (entry.state === "installed") return [];
		if (entry.state === "not-installed") return [`${entry.id}: not installed; nothing to remove`];
		return [`refused: ${entry.path} has no LitCodex receipt, so it is yours; LitCodex does not move it`];
	});
	if (refusals.some((line) => line.startsWith("refused:")))
		throw new StopError(`${refusals.join("\n")}\nNothing was moved.`);
	out.lines.push(...refusals);
	const targets = entries.filter((entry) => entry.state === "installed");
	if (!parsed.yes) {
		out.lines.push("litcodex extensions remove (dry run: nothing was changed)");
		for (const entry of targets) {
			out.lines.push(`${entry.id}: move ${entry.path} to ${join(paths.backups, "<date-time>", entry.id)}`);
		}
		out.lines.push("Run it again with --yes to do this. Nothing is deleted.");
		return 0;
	}
	assertRealDir(paths.backups);
	const stamp = stampOf((deps.now ?? (() => new Date()))());
	for (const entry of targets) {
		const target = backupTarget(paths, stamp, entry.id);
		mkdirSync(dirname(target), { recursive: true });
		renameSync(entry.path, target);
		out.lines.push(`${entry.id}: moved aside: ${target}`);
		out.actions.push({ id: entry.id, action: "removed", detail: target });
	}
	return 0;
}

function runPrune(parsed: Parsed, ctx: ExtensionsContext, deps: ExtensionsDeps, out: Out): number {
	const paths = pathsFor(ctx.env);
	assertRealDir(paths.backups);
	const now = (deps.now ?? (() => new Date()))().getTime();
	const sets = listBackups(paths);
	const picked = sets.filter(
		(set) => parsed.olderThan === undefined || now - set.takenAt.getTime() > parsed.olderThan * 86_400_000,
	);
	if (sets.length === 0) {
		out.lines.push(`No backups in ${paths.backups}.`);
		return 0;
	}
	out.lines.push(`Backups in ${paths.backups}:`);
	for (const set of sets) {
		const contents = readdirSync(set.path).sort().join(", ");
		out.lines.push(
			`  ${set.name}  ${formatBytes(set.bytes).padStart(9)}  ${contents}${picked.includes(set) ? "" : "  (kept)"}`,
		);
	}
	const total = picked.reduce((sum, set) => sum + set.bytes, 0);
	if (!parsed.yes) {
		out.lines.push(
			`Would delete ${picked.length} of ${sets.length} (${formatBytes(total)}). Run it again with --yes to delete them.`,
		);
		return 0;
	}
	const backupsReal = realpathSync(paths.backups);
	for (const set of picked) {
		const real = realpathSync(set.path);
		if (dirname(real) !== backupsReal || lstat(set.path)?.isSymbolicLink() !== false) {
			throw new StopError(`refused: ${set.path} is not a plain folder inside ${paths.backups}`);
		}
		rmSync(real, { recursive: true });
		out.actions.push({ id: set.name, action: "deleted" });
	}
	out.lines.push(`Deleted ${picked.length} backup set${picked.length === 1 ? "" : "s"} (${formatBytes(total)}).`);
	return 0;
}

class UsageError extends Error {}

/** `litcodex extensions <verb> ...`; returns the exit code and never throws. */
export function runExtensionsCli(args: readonly string[], io: ExtensionsIo, deps: ExtensionsDeps = {}): number {
	const parsed = parse(args);
	if (typeof parsed === "string") {
		io.stderr.write(`litcodex extensions: ${parsed}. Nothing was changed.\n\n${EXTENSIONS_HELP_TEXT}`);
		return USAGE_EXIT_CODE;
	}
	if (parsed.help) {
		io.stdout.write(EXTENSIONS_HELP_TEXT);
		return 0;
	}
	const ctx = { env: io.env, cwd: io.cwd };
	if (parsed.verb === "list" || parsed.verb === "check") {
		const report = checkExtensions(ctx);
		const code = parsed.verb === "check" && report.findings.length > 0 ? 1 : 0;
		if (parsed.json) {
			io.stdout.write(
				`${JSON.stringify(parsed.verb === "list" ? { extensions: report.entries } : { ok: code === 0, ...report })}\n`,
			);
		} else io.stdout.write(parsed.verb === "list" ? renderList(report) : renderCheck(report));
		return code;
	}
	const out: Out = { lines: [], warnings: [], errors: [], actions: [] };
	let code: number;
	try {
		const verbs: Record<string, typeof runInstall> = {
			install: runInstall,
			update: runUpdate,
			remove: runRemove,
			"prune-backups": runPrune,
		};
		code = (verbs[parsed.verb] as typeof runInstall)(parsed, ctx, deps, out);
	} catch (error) {
		if (error instanceof UsageError) {
			io.stderr.write(`litcodex extensions: ${error.message}. Nothing was changed.\n`);
			return USAGE_EXIT_CODE;
		}
		out.errors.push(error instanceof StopError ? error.message : `failed: ${(error as Error).message}`);
		code = 1;
	}
	if (parsed.json) {
		io.stdout.write(
			`${JSON.stringify({ ok: code === 0, dryRun: !parsed.yes, actions: out.actions, lines: out.lines, warnings: out.warnings, errors: out.errors })}\n`,
		);
		return code;
	}
	if (out.lines.length > 0) io.stdout.write(`${out.lines.join("\n")}\n`);
	for (const line of [...out.warnings, ...out.errors]) io.stderr.write(`${line}\n`);
	return code;
}
