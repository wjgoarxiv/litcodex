// Cache-only update notices for successful interactive management commands.
// The foreground reserves a throttled refresh before starting a detached helper; only that helper
// touches the network. Cache transitions are serialized and refresh completion is owner-fenced.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bold, orange } from "./ui.js";

export const CACHE_PATH = join(homedir(), ".litcodex", "update-check.json");
export const STALE_MS = 24 * 60 * 60 * 1000;
export const REGISTRY_DEADLINE_MS = 3000;
export const MAX_RESPONSE_BYTES = 64 * 1024;

const CACHE_SCHEMA_VERSION = 1 as const;
const REGISTRY_URL = "https://registry.npmjs.org/@litfamily%2Flitcodex/latest";
const PACKAGE_NAME = "@litfamily/litcodex";
const MUTEX_STALE_MS = 30_000;
const OWNER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MUTEX_OWNER_PATTERN = /^([1-9]\d*):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export interface UpdateResult {
	checkedAt: string;
	latest: string;
}

export interface RefreshOwner {
	owner: string;
	generation: number;
	startedAt: string;
}

export interface UpdateCache {
	schemaVersion: typeof CACHE_SCHEMA_VERSION;
	packageName: typeof PACKAGE_NAME;
	attemptedAt: string;
	generation: number;
	result: UpdateResult | null;
	refresh: RefreshOwner | null;
}

interface RegistryResponse {
	readonly statusCode: number | undefined;
	readonly headers: Record<string, string | readonly string[] | undefined>;
	on(event: "data", listener: (chunk: Buffer | string) => void): this;
	on(event: "end", listener: () => void): this;
	on(event: "error", listener: () => void): this;
}

interface RegistryRequest {
	on(event: "error", listener: () => void): this;
	destroy(): void;
}

export type RegistryGet = (
	url: string,
	options: { headers: { accept: string } },
	callback: (response: RegistryResponse) => void,
) => RegistryRequest;

interface DetachedChild {
	once(event: "error", listener: () => void): unknown;
	unref(): void;
}
type DetachedSpawn = (
	command: string,
	args: readonly string[],
	options: { detached: true; stdio: "ignore"; windowsHide: true; env: NodeJS.ProcessEnv },
) => DetachedChild;

export interface CheckGate {
	readonly command: string | undefined;
	readonly argv: readonly string[];
	readonly exitCode: number;
	readonly stdinTty: boolean;
	readonly stdoutTty: boolean;
	readonly stderrTty: boolean;
	readonly env: NodeJS.ProcessEnv;
}

export interface NotifyOptions extends CheckGate {
	readonly current: string;
	readonly stderr: NodeJS.WritableStream;
	readonly cachePath?: string;
	readonly now?: () => number;
	readonly owner?: () => string;
	readonly spawn?: DetachedSpawn;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseStableSemver(version: string): readonly [bigint, bigint, bigint] | null {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
	if (!match?.[1] || !match[2] || !match[3]) return null;
	try {
		return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
	} catch {
		return null;
	}
}

function isCanonicalTimestamp(value: unknown, now: number): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
	const milliseconds = Date.parse(value);
	return Number.isFinite(milliseconds) && milliseconds <= now && new Date(milliseconds).toISOString() === value;
}

function canonicalNow(now: number): string | null {
	if (!Number.isFinite(now)) return null;
	try {
		return new Date(now).toISOString();
	} catch {
		return null;
	}
}

function parseResult(value: unknown, now: number): UpdateResult | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !hasExactKeys(value, ["checkedAt", "latest"])) return undefined;
	if (!isCanonicalTimestamp(value["checkedAt"], now)) return undefined;
	if (typeof value["latest"] !== "string" || !parseStableSemver(value["latest"])) return undefined;
	return { checkedAt: value["checkedAt"], latest: value["latest"] };
}

function parseRefresh(value: unknown, now: number): RefreshOwner | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !hasExactKeys(value, ["owner", "generation", "startedAt"])) return undefined;
	if (typeof value["owner"] !== "string" || !OWNER_PATTERN.test(value["owner"])) return undefined;
	if (!Number.isSafeInteger(value["generation"]) || (value["generation"] as number) < 1) return undefined;
	if (!isCanonicalTimestamp(value["startedAt"], now)) return undefined;
	return {
		owner: value["owner"],
		generation: value["generation"] as number,
		startedAt: value["startedAt"],
	};
}

function parseCache(value: unknown, now: number): UpdateCache | null {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["schemaVersion", "packageName", "attemptedAt", "generation", "result", "refresh"])
	) {
		return null;
	}
	if (
		value["schemaVersion"] !== CACHE_SCHEMA_VERSION ||
		value["packageName"] !== PACKAGE_NAME ||
		!isCanonicalTimestamp(value["attemptedAt"], now)
	) {
		return null;
	}
	if (!Number.isSafeInteger(value["generation"]) || (value["generation"] as number) < 1) return null;
	const result = parseResult(value["result"], now);
	const refresh = parseRefresh(value["refresh"], now);
	if (result === undefined || refresh === undefined) return null;
	if (refresh !== null && refresh.generation !== value["generation"]) return null;
	return {
		schemaVersion: CACHE_SCHEMA_VERSION,
		packageName: PACKAGE_NAME,
		attemptedAt: value["attemptedAt"],
		generation: value["generation"] as number,
		result,
		refresh,
	};
}

/** Strict, non-throwing cache read. Unknown keys and noncanonical values invalidate the file. */
export function readUpdateCache(path = CACHE_PATH, now = Date.now()): UpdateCache | null {
	try {
		return parseCache(JSON.parse(readFileSync(path, "utf8")) as unknown, now);
	} catch {
		return null;
	}
}

/** Strict stable-semver comparison using BigInt components. */
export function isNewer(latest: string, current: string): boolean {
	const candidate = parseStableSemver(latest);
	const installed = parseStableSemver(current);
	if (!candidate || !installed) return false;
	for (let index = 0; index < candidate.length; index += 1) {
		const left = candidate[index];
		const right = installed[index];
		if (left === undefined || right === undefined) return false;
		if (left > right) return true;
		if (left < right) return false;
	}
	return false;
}

/** Automatic checks are limited to successful, fully interactive install/doctor commands. */
export function shouldCheck(opts: CheckGate): boolean {
	if (opts.command !== "install" && opts.command !== "doctor") return false;
	if (opts.exitCode !== 0) return false;
	if (!opts.stdinTty || !opts.stdoutTty || !opts.stderrTty) return false;
	if (Object.hasOwn(opts.env, "CI")) return false;
	if (Object.hasOwn(opts.env, "NO_UPDATE_NOTIFIER") || Object.hasOwn(opts.env, "LITCODEX_NO_UPDATE_CHECK"))
		return false;
	if (
		opts.argv.some((argument) => argument === "--dry-run" || argument === "--json" || argument.startsWith("--json="))
	) {
		return false;
	}
	if (
		opts.argv.some(
			(argument) => argument === "--help" || argument === "-h" || argument === "--version" || argument === "-v",
		)
	) {
		return false;
	}
	return true;
}

/** Render only immutable, validated package versions. */
export function renderUpdateNotice(current: string, latest: string, color: boolean): string {
	if (!parseStableSemver(current) || !parseStableSemver(latest)) return "";
	const latestStyled = color ? bold(orange(latest, true), true) : latest;
	return [
		"",
		`\u{1F525} Update available  ${current} → ${latestStyled}`,
		`   Run  npm i -g @litfamily/litcodex@${latest}   (or  npm exec --yes --package @litfamily/litcodex@${latest} -- litcodex …)`,
		"",
		"",
	].join("\n");
}

function elapsed(now: number, timestamp: string): number {
	return Math.max(0, now - Date.parse(timestamp));
}

function writeCache(path: string, cache: UpdateCache): void {
	const directory = dirname(path);
	mkdirSync(directory, { recursive: true });
	const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
	try {
		writeFileSync(temporary, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

interface MutexHandle {
	readonly path: string;
	readonly token: string;
}

function readMutexOwner(path: string): string | null {
	try {
		return readFileSync(join(path, "owner"), "utf8");
	} catch {
		return null;
	}
}

function ownsTransitionMutex(handle: MutexHandle): boolean {
	return readMutexOwner(handle.path) === handle.token;
}

type MutexOwnerPid =
	| { readonly kind: "pid"; readonly pid: number }
	| { readonly kind: "malformed" }
	| { readonly kind: "indeterminate" };

function parseMutexOwnerPid(owner: string | null): MutexOwnerPid {
	const match = MUTEX_OWNER_PATTERN.exec(owner ?? "");
	if (!match?.[1] || !match[2] || !OWNER_PATTERN.test(match[2])) return { kind: "malformed" };
	const pid = Number(match[1]);
	if (!Number.isSafeInteger(pid) || pid < 1) return { kind: "indeterminate" };
	return { kind: "pid", pid };
}

function canTakeOverStaleMutex(owner: string | null): boolean {
	const parsed = parseMutexOwnerPid(owner);
	if (parsed.kind === "malformed") return true;
	if (parsed.kind === "indeterminate") return false;
	try {
		process.kill(parsed.pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

function acquireTransitionMutex(cachePath: string, now: number): MutexHandle | null {
	const path = `${cachePath}.lock`;
	mkdirSync(dirname(cachePath), { recursive: true });
	const token = `${process.pid}:${randomUUID()}`;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			mkdirSync(path, { mode: 0o700 });
			writeFileSync(join(path, "owner"), token, { encoding: "utf8", mode: 0o600 });
			return { path, token };
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") return null;
			try {
				const stat = lstatSync(path);
				const age = now - stat.mtimeMs;
				if (age >= -5_000 && age < MUTEX_STALE_MS) return null;
				const observedOwner = readMutexOwner(path);
				// Malformed stale owners retain abandoned-lock recovery. A well-formed owner is replaced
				// only after ESRCH proves its PID absent; live, EPERM, and indeterminate probes fail closed.
				if (!canTakeOverStaleMutex(observedOwner) || readMutexOwner(path) !== observedOwner) return null;
				const tombstone = `${path}.stale.${process.pid}.${randomUUID()}`;
				renameSync(path, tombstone);
				rmSync(tombstone, { recursive: true, force: true });
			} catch {
				// Another process won the stale-lock takeover. Retry the atomic mkdir.
			}
		}
	}
	return null;
}

function releaseTransitionMutex(handle: MutexHandle): void {
	try {
		if (!existsSync(handle.path) || !ownsTransitionMutex(handle)) return;
		rmSync(handle.path, { recursive: true, force: true });
	} catch {
		// A newer mutex owner or external cleanup won the race; never remove it blindly.
	}
}

type OwnedMutation = (mutation: () => void) => boolean;

function withTransitionMutex<T>(cachePath: string, now: number, transition: (mutate: OwnedMutation) => T): T | null {
	let handle: MutexHandle | null = null;
	try {
		handle = acquireTransitionMutex(cachePath, now);
		if (!handle) return null;
		const mutate: OwnedMutation = (mutation) => {
			if (!handle || !ownsTransitionMutex(handle)) return false;
			mutation();
			return true;
		};
		return transition(mutate);
	} catch {
		return null;
	} finally {
		if (handle) releaseTransitionMutex(handle);
	}
}

/** Reserve one refresh generation and persist attemptedAt before any child can start. */
export function reserveRefresh(opts: {
	readonly cachePath?: string;
	readonly now: number;
	readonly owner: string;
}): { owner: string; generation: number } | null {
	const cachePath = opts.cachePath ?? CACHE_PATH;
	const timestamp = canonicalNow(opts.now);
	if (!timestamp || !OWNER_PATTERN.test(opts.owner)) return null;
	return withTransitionMutex(cachePath, opts.now, (mutate) => {
		const previous = readUpdateCache(cachePath, opts.now);
		if (previous && elapsed(opts.now, previous.attemptedAt) < STALE_MS) return null;
		const generation = previous ? previous.generation + 1 : 1;
		if (!Number.isSafeInteger(generation)) return null;
		const next: UpdateCache = {
			schemaVersion: CACHE_SCHEMA_VERSION,
			packageName: PACKAGE_NAME,
			attemptedAt: timestamp,
			generation,
			result: previous?.result ?? null,
			refresh: { owner: opts.owner, generation, startedAt: timestamp },
		};
		if (!mutate(() => writeCache(cachePath, next))) return null;
		return { owner: opts.owner, generation };
	});
}

/** Complete only the currently owned generation; stale workers cannot alter newer state. */
export function completeRefresh(opts: {
	readonly cachePath?: string;
	readonly now: number;
	readonly owner: string;
	readonly generation: number;
	readonly latest?: string;
}): void {
	const cachePath = opts.cachePath ?? CACHE_PATH;
	const timestamp = canonicalNow(opts.now);
	if (!timestamp) return;
	withTransitionMutex(cachePath, opts.now, (mutate) => {
		const cache = readUpdateCache(cachePath, opts.now);
		if (
			!cache?.refresh ||
			cache.refresh.owner !== opts.owner ||
			cache.refresh.generation !== opts.generation ||
			cache.generation !== opts.generation
		) {
			return;
		}
		const latest = opts.latest && parseStableSemver(opts.latest) ? opts.latest : undefined;
		const next: UpdateCache = {
			...cache,
			result: latest ? { checkedAt: timestamp, latest } : cache.result,
			refresh: null,
		};
		mutate(() => writeCache(cachePath, next));
	});
}

/** Pass only home and TLS trust paths; credentials and process-injection variables stay behind. */
export function filteredHelperEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const filtered: NodeJS.ProcessEnv = {};
	for (const key of [
		"HOME",
		"USERPROFILE",
		"HOMEDRIVE",
		"HOMEPATH",
		"SystemRoot",
		"SYSTEMROOT",
		"NODE_EXTRA_CA_CERTS",
		"SSL_CERT_FILE",
		"SSL_CERT_DIR",
	]) {
		const value = env[key];
		if (value !== undefined) filtered[key] = value;
	}
	return filtered;
}

const realSpawn: DetachedSpawn = (command, args, options) => spawn(command, [...args], options);

/** Read/notice the prior success and reserve/spawn a detached refresh without throwing. */
export function maybeNotifyAndRefresh(opts: NotifyOptions): void {
	try {
		if (!shouldCheck(opts)) return;
		const cachePath = opts.cachePath ?? CACHE_PATH;
		const now = opts.now?.() ?? Date.now();
		const cached = readUpdateCache(cachePath, now);
		const owner = opts.owner?.() ?? randomUUID();
		const reservation = reserveRefresh({ cachePath, now, owner });

		if (cached?.result && isNewer(cached.result.latest, opts.current)) {
			const notice = renderUpdateNotice(opts.current, cached.result.latest, !opts.env["NO_COLOR"]);
			if (notice) opts.stderr.write(notice);
		}

		if (!reservation) return;
		const scriptPath = fileURLToPath(new URL("./update-check.js", import.meta.url));
		try {
			const child = (opts.spawn ?? realSpawn)(
				process.execPath,
				[scriptPath, "--refresh", reservation.owner, String(reservation.generation)],
				{ detached: true, stdio: "ignore", windowsHide: true, env: filteredHelperEnv(opts.env) },
			);
			child.once("error", () => {
				// attemptedAt was already persisted; async spawn failure remains throttled.
			});
			child.unref();
		} catch {
			// attemptedAt was already persisted; synchronous spawn failure remains throttled.
		}
	} catch {
		// Update checks must never affect the management command's completed outcome.
	}
}

function contentTypeIsJson(value: string | readonly string[] | undefined): boolean {
	return typeof value === "string" && /^application\/json(?:\s*;\s*charset=[A-Za-z0-9._-]+)?$/i.test(value.trim());
}

const realRegistryGet: RegistryGet = (url, options, callback) =>
	httpsGet(url, options, callback as unknown as Parameters<typeof httpsGet>[2]);

/** Fetch one validated stable version from the single official npm latest endpoint. */
export function fetchLatestVersion(
	opts: { readonly get?: RegistryGet; readonly deadlineMs?: number } = {},
): Promise<string | null> {
	const get = opts.get ?? realRegistryGet;
	const deadlineMs = opts.deadlineMs ?? REGISTRY_DEADLINE_MS;
	return new Promise((resolvePromise) => {
		let settled = false;
		let request: RegistryRequest | undefined;
		const finish = (value: string | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolvePromise(value);
		};
		const timer = setTimeout(() => {
			try {
				request?.destroy();
			} catch {
				// Deadline still resolves null when destroy itself fails.
			}
			finish(null);
		}, deadlineMs);

		try {
			request = get(REGISTRY_URL, { headers: { accept: "application/json" } }, (response) => {
				if (response.statusCode !== 200 || !contentTypeIsJson(response.headers["content-type"])) {
					try {
						request?.destroy();
					} catch {
						// Invalid response already resolves null.
					}
					finish(null);
					return;
				}
				const contentLength = response.headers["content-length"];
				if (
					typeof contentLength === "string" &&
					(!/^(0|[1-9]\d*)$/.test(contentLength) || BigInt(contentLength) > BigInt(MAX_RESPONSE_BYTES))
				) {
					try {
						request?.destroy();
					} catch {
						// Invalid declared length already resolves null.
					}
					finish(null);
					return;
				}
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on("data", (chunk) => {
					if (settled) return;
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
					bytes += buffer.byteLength;
					if (bytes > MAX_RESPONSE_BYTES) {
						try {
							request?.destroy();
						} catch {
							// Oversized response already resolves null.
						}
						finish(null);
						return;
					}
					chunks.push(buffer);
				});
				response.on("error", () => finish(null));
				response.on("end", () => {
					if (settled) return;
					try {
						const parsed: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
						if (!isRecord(parsed) || parsed["name"] !== PACKAGE_NAME || typeof parsed["version"] !== "string") {
							finish(null);
							return;
						}
						finish(parseStableSemver(parsed["version"]) ? parsed["version"] : null);
					} catch {
						finish(null);
					}
				});
			});
			request.on("error", () => finish(null));
		} catch {
			finish(null);
		}
	});
}

async function runRefreshHelper(owner: string, generation: number): Promise<void> {
	const latest = await fetchLatestVersion();
	completeRefresh({
		now: Date.now(),
		owner,
		generation,
		...(latest === null ? {} : { latest }),
	});
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === resolve(fileURLToPath(import.meta.url)) && process.argv[2] === "--refresh") {
	const owner = process.argv[3] ?? "";
	const generationText = process.argv[4] ?? "";
	const generation = /^(?:[1-9]\d*)$/.test(generationText) ? Number(generationText) : Number.NaN;
	if (OWNER_PATTERN.test(owner) && Number.isSafeInteger(generation)) {
		await runRefreshHelper(owner, generation);
	}
}
