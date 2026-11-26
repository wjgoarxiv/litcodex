// `install --round`: the symbols-only Nerd Font (Symbols Nerd Font Mono, MIT), so a terminal can draw the round ends
// of LIT's pills (U+E0B6, U+E0B4) while the person keeps their own font.
//
// Nothing is bundled. One pinned official archive is downloaded (or read from LITCODEX_ICON_FONT_SOURCE), refused
// unless its SHA-256 matches, and two pinned files are taken out of it, each checked again. They go into the per-user
// font folder only when no icon font is here, never over a file and never through a link. The record in
// `$CODEX_HOME/litcodex/icon-font.json` lets uninstall remove exactly those files. Every failure is one line: the
// install around it goes on.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	closeSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, parse, relative, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { writeSmallFile } from "@litcodex/lit-loop/dist/auto-handoff-settings.js";
import { stateFileProblem } from "@litcodex/lit-loop/dist/glyph-choice.js";
import { hasIconFont, xdgDataHome } from "@litcodex/lit-loop/dist/hud-glyphs.js";
import { readSmallJson } from "@litcodex/lit-loop/dist/live-step.js";

export interface IconFontPins {
	readonly family: string;
	readonly release: string;
	readonly url: string;
	readonly archiveSha256: string;
	readonly archiveMaxBytes: number;
	readonly files: readonly {
		readonly entry: string;
		readonly name: string;
		readonly sha256: string;
		readonly font: boolean;
	}[];
}

export const ICON_FONT: IconFontPins = {
	family: "Symbols Nerd Font Mono",
	release: "v3.5.1",
	url: "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.zip",
	archiveSha256: "fdca3682534f6f65e1ccb2345b0362ccf67d9b8eca7c8025330946e93e2473bc",
	archiveMaxBytes: 8 * 1024 * 1024,
	files: [
		{
			entry: "SymbolsNerdFontMono-Regular.ttf",
			name: "SymbolsNerdFontMono-Regular.ttf",
			sha256: "fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749",
			font: true,
		},
		{
			entry: "LICENSE",
			name: "SymbolsNerdFontMono-LICENSE.txt",
			sha256: "84a7a98c82140fb12c37fe42b93805baa16024cb3e5acc599b7ffe612c55d847",
			font: false,
		},
	],
};
export const ICON_FONT_FILE = "SymbolsNerdFontMono-Regular.ttf";
export const ICON_FONT_SOURCE_ENV = "LITCODEX_ICON_FONT_SOURCE";

const LIMIT_MS = 60_000;
const MAX_UNPACKED = 32 * 1024 * 1024;
const MAX_RECORD = 65_536;

export interface IconFontDeps {
	readonly env: NodeJS.ProcessEnv;
	readonly codexHome: string;
	readonly platform?: NodeJS.Platform;
	readonly pins?: IconFontPins;
	readonly fetchImpl?: typeof fetch;
	readonly limitMs?: number;
	readonly spawn?: (command: string, args: readonly string[]) => unknown;
	/** The product's own rule, asked for the font folder. */
	readonly hasIconFont?: (dir: string) => boolean;
}

export interface IconFontResult {
	readonly status: "added" | "present" | "unsupported" | "failed";
	readonly line: string;
	/** Why nothing was added, for the ROUND_ENDS line. */
	readonly why?: string;
}

class IconFontError extends Error {}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function homeOf(env: NodeJS.ProcessEnv): string {
	const home = env["HOME"] ?? "";
	return isAbsolute(home) ? home : homedir();
}

const platformOf = (deps: IconFontDeps): NodeJS.Platform => deps.platform ?? process.platform;

/** The per-user font folder; null on Windows, where LitCodex adds no font. */
export function iconFontDir(deps: Pick<IconFontDeps, "env" | "platform">): string | null {
	const platform = deps.platform ?? process.platform;
	if (platform === "win32") return null;
	if (platform === "darwin") return join(homeOf(deps.env), "Library", "Fonts");
	return join(xdgDataHome(deps.env) ?? join(homeOf(deps.env), ".local", "share"), "fonts");
}

function fontHere(deps: IconFontDeps, dir: string): boolean {
	if (deps.hasIconFont !== undefined) return deps.hasIconFont(dir);
	return hasIconFont({ ...deps.env, HOME: homeOf(deps.env) }, platformOf(deps));
}

const recordPath = (codexHome: string): string => join(codexHome, "litcodex", "icon-font.json");

/**
 * Why the font folder is not to be trusted: it, or a folder above it, is a link or no folder. Looked at from the home
 * folder down; a folder elsewhere (XDG_DATA_HOME) from the top, where only the system itself puts links (`/tmp`, `/var`
 * on a Mac, `/home` on some systems) and those are its own.
 */
function folderProblem(dir: string, env: NodeJS.ProcessEnv): string | null {
	const home = homeOf(env);
	const inside = relative(home, dir);
	const below = inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
	const top = below ? home : parse(dir).root;
	const chain = relative(top, dir)
		.split(sep)
		.map((_, at, parts) => join(top, ...parts.slice(0, at + 1)));
	for (const folder of below ? chain : chain.slice(1)) {
		const stat = lstatSync(folder, { throwIfNoEntry: false });
		if (stat === undefined) return null;
		if (stat.isSymbolicLink()) return `${folder} is a link`;
		if (!stat.isDirectory()) return `${folder} is not a folder`;
	}
	return null;
}

/** The named entries of a zip held in memory (stored or deflated), by its central directory. */
function unzip(archive: Buffer, names: readonly string[]): Map<string, Buffer> {
	const found = new Map<string, Buffer>();
	let end = -1;
	for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 65_535); at--) {
		if (archive.readUInt32LE(at) === 0x06054b50) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new IconFontError("the archive is not a zip file");
	const count = archive.readUInt16LE(end + 10);
	let at = archive.readUInt32LE(end + 16);
	for (let index = 0; index < count; index++) {
		if (archive.readUInt32LE(at) !== 0x02014b50) throw new IconFontError("the archive is damaged");
		const method = archive.readUInt16LE(at + 10);
		const size = archive.readUInt32LE(at + 20);
		const nameSize = archive.readUInt16LE(at + 28);
		const local = archive.readUInt32LE(at + 42);
		const name = archive.toString("utf8", at + 46, at + 46 + nameSize);
		at += 46 + nameSize + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
		if (!names.includes(name)) continue;
		if (archive.readUInt32LE(local) !== 0x04034b50) throw new IconFontError("the archive is damaged");
		const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
		const data = archive.subarray(start, start + size);
		if (method === 0) found.set(name, Buffer.from(data));
		else if (method === 8) found.set(name, inflateRawSync(data, { maxOutputLength: MAX_UNPACKED }));
		else throw new IconFontError(`${name} in the archive is packed in an unknown way`);
	}
	return found;
}

async function download(deps: IconFontDeps, pins: IconFontPins): Promise<Buffer> {
	const tooLarge = new IconFontError(`the download is larger than ${pins.archiveMaxBytes / (1024 * 1024)} MiB`);
	const response = await (deps.fetchImpl ?? fetch)(pins.url, {
		redirect: "follow",
		signal: AbortSignal.timeout(deps.limitMs ?? LIMIT_MS),
	});
	if (!response.ok) throw new IconFontError(`the download answered HTTP ${response.status}`);
	if (Number(response.headers.get("content-length") ?? 0) > pins.archiveMaxBytes) throw tooLarge;
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
		size += chunk.length;
		if (size > pins.archiveMaxBytes) throw tooLarge;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

function localArchive(path: string, pins: IconFontPins): Buffer {
	const stat = lstatSync(path);
	if (!stat.isFile()) throw new IconFontError(`${path} is not a regular file`);
	if (stat.size > pins.archiveMaxBytes) throw new IconFontError(`${path} is larger than the pinned archive`);
	return readFileSync(path);
}

/** The pinned files out of the archive, every one of them checked. */
async function pinnedFiles(deps: IconFontDeps, pins: IconFontPins): Promise<Map<string, Buffer>> {
	const source = deps.env[ICON_FONT_SOURCE_ENV]?.trim() ?? "";
	const archive = source === "" ? await download(deps, pins) : localArchive(source, pins);
	if (sha256(archive) !== pins.archiveSha256) throw new IconFontError("the archive does not match its pinned SHA-256");
	const files = unzip(
		archive,
		pins.files.map(({ entry }) => entry),
	);
	for (const { entry, sha256: pinned } of pins.files) {
		const bytes = files.get(entry);
		if (bytes === undefined) throw new IconFontError(`the archive has no ${entry}`);
		if (sha256(bytes) !== pinned) throw new IconFontError(`${entry} does not match its pinned SHA-256`);
	}
	return files;
}

function explain(error: unknown): string {
	const one = (text: string): string => text.replace(/[\u0000-\u001f\u007f]+/gu, " ").slice(0, 200);
	if (error instanceof IconFontError) return one(error.message);
	const { name, message, cause, code } = error as Error & { cause?: { code?: unknown }; code?: unknown };
	if (name === "TimeoutError" || name === "AbortError") return "the download took longer than 60 seconds";
	if (error instanceof TypeError && message === "fetch failed")
		return one(`the download failed (${message}${typeof cause?.code === "string" ? `, ${cause.code}` : ""})`);
	if (error instanceof RangeError) return "the archive is damaged";
	return one(typeof code === "string" ? message : `it could not be added: ${message}`);
}

interface OwnedFile {
	readonly path: string;
	readonly sha256: string;
}

/** The files the record names, dropping whatever LitCodex never writes: another name, folder or form of path. */
function ownedFiles(deps: IconFontDeps): readonly OwnedFile[] {
	const path = recordPath(deps.codexHome);
	if (stateFileProblem(path) !== null) return [];
	const record = readSmallJson(path, MAX_RECORD) as { files?: unknown } | null;
	const names = ICON_FONT.files.map(({ name }) => name);
	const mac = platformOf(deps) === "darwin" ? join(homeOf(deps.env), "Library", "Fonts") : null;
	return (Array.isArray(record?.files) ? record.files : []).filter((file): file is OwnedFile => {
		const { path: at, sha256: hash } = (file ?? {}) as Partial<OwnedFile>;
		if (typeof at !== "string" || typeof hash !== "string" || !/^[0-9a-f]{64}$/u.test(hash)) return false;
		if (!isAbsolute(at) || normalize(at) !== at || !names.includes(basename(at))) return false;
		return mac === null ? basename(dirname(at)) === "fonts" : dirname(at) === mac;
	});
}

function saveOwned(deps: IconFontDeps, files: readonly OwnedFile[]): boolean {
	const { family, release } = deps.pins ?? ICON_FONT;
	const text = `${JSON.stringify({ version: 1, family, release, files }, null, 2)}\n`;
	return writeSmallFile(recordPath(deps.codexHome), text, deps.codexHome);
}

/** Puts the bytes at `path` only when nothing is there: a hard link claims the name in one step. */
function claim(path: string, bytes: Buffer): void {
	const staging = `${path}.litcodex-${randomBytes(6).toString("hex")}.tmp`;
	const fd = openSync(staging, "wx", 0o644);
	try {
		try {
			writeFileSync(fd, bytes);
		} finally {
			closeSync(fd);
		}
		linkSync(staging, path);
	} finally {
		rmSync(staging, { force: true });
	}
}

function refreshFontCache(deps: IconFontDeps, dir: string): void {
	if (platformOf(deps) === "darwin" || platformOf(deps) === "win32") return;
	try {
		const run =
			deps.spawn ??
			((command: string, args: readonly string[]) =>
				spawnSync(command, [...args], { stdio: "ignore", timeout: LIMIT_MS }));
		run("fc-cache", ["-f", dir]);
	} catch {
		// The desktop refreshes its own cache sooner or later.
	}
}

function writeFonts(deps: IconFontDeps, pins: IconFontPins, dir: string, files: ReadonlyMap<string, Buffer>): void {
	const trusted = (): void => {
		const problem = folderProblem(dir, deps.env);
		if (problem !== null) throw new IconFontError(problem);
	};
	trusted();
	mkdirSync(dir, { recursive: true });
	trusted();
	const written: OwnedFile[] = [];
	try {
		for (const { entry, name, sha256: hash, font } of pins.files) {
			const path = join(dir, name);
			try {
				claim(path, files.get(entry) ?? Buffer.alloc(0));
				written.push({ path, sha256: hash });
			} catch (error) {
				// The licence beside the font is a courtesy; someone else's copy of it stays.
				if (!font) continue;
				if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new IconFontError(`${path} is already there`);
				throw error;
			}
		}
		const paths = written.map(({ path }) => path);
		const earlier = ownedFiles(deps).filter(({ path }) => !paths.includes(path));
		if (!saveOwned(deps, [...earlier, ...written]))
			throw new IconFontError(`${recordPath(deps.codexHome)} could not be written`);
	} catch (error) {
		for (const { path } of written) rmSync(path, { force: true });
		throw error;
	}
}

const WINDOWS = "Windows: LitCodex adds no font there; Windows Terminal and VS Code draw round ends themselves";

/** Adds the icon font unless one is here. Never throws: a failure is the line it returns. */
export async function addIconFont(deps: IconFontDeps): Promise<IconFontResult> {
	const pins = deps.pins ?? ICON_FONT;
	const failed = (why: string): IconFontResult => ({ status: "failed", line: `ICON_FONT: not added (${why})`, why });
	try {
		const dir = iconFontDir(deps);
		if (dir === null) return { status: "unsupported", line: `ICON_FONT: not added (${WINDOWS})` };
		if (fontHere(deps, dir)) return { status: "present", line: "ICON_FONT: already here; nothing added" };
		const problem = folderProblem(dir, deps.env) ?? stateFileProblem(recordPath(deps.codexHome));
		if (problem !== null) return failed(problem);
		const taken = lstatSync(join(dir, ICON_FONT_FILE), { throwIfNoEntry: false });
		if (taken !== undefined) return failed(`${join(dir, ICON_FONT_FILE)} is already there`);
		writeFonts(deps, pins, dir, await pinnedFiles(deps, pins));
		refreshFontCache(deps, dir);
		return { status: "added", line: `ICON_FONT: added ${ICON_FONT_FILE} to ${dir}` };
	} catch (error) {
		return failed(explain(error));
	}
}

/** What `--round` would do, for a dry run: reads the font folder, downloads and writes nothing. */
export function iconFontPlanLine(deps: IconFontDeps): string {
	const dir = iconFontDir(deps);
	if (dir === null) return `Would add no icon font (${WINDOWS})`;
	if (fontHere(deps, dir)) return "Would add no icon font: one is already here";
	const source = deps.env[ICON_FONT_SOURCE_ENV]?.trim() ?? "";
	const from = source === "" ? `downloaded from ${(deps.pins ?? ICON_FONT).url}` : `taken from ${source}`;
	return `Would add the icon font ${ICON_FONT_FILE} to ${dir} (${from})`;
}

/** Removes the recorded files that still hold the recorded bytes; the line to show, null when there was none. */
export function removeIconFont(deps: IconFontDeps): string | null {
	try {
		const owned = ownedFiles(deps);
		const removed: string[] = [];
		const stuck: OwnedFile[] = [];
		for (const file of owned) {
			try {
				const stat = lstatSync(file.path, { throwIfNoEntry: false });
				if (stat === undefined || !stat.isFile() || folderProblem(dirname(file.path), deps.env) !== null) continue;
				if (sha256(readFileSync(file.path)) !== file.sha256) continue;
				unlinkSync(file.path);
				removed.push(file.path);
			} catch {
				stuck.push(file);
			}
		}
		const path = recordPath(deps.codexHome);
		if (stuck.length > 0) saveOwned(deps, stuck);
		else if (stateFileProblem(path) === null) rmSync(path, { force: true });
		for (const dir of new Set(removed.map((file) => dirname(file)))) refreshFontCache(deps, dir);
		const left = stuck.length === 0 ? "" : `; could not remove ${stuck.map((file) => file.path).join(", ")}`;
		if (removed.length > 0)
			return `ICON_FONT: removed ${removed.join(", ")}; other products on this machine may then draw square ends${left}`;
		return left === "" ? null : `ICON_FONT: kept${left}`;
	} catch {
		return null;
	}
}
