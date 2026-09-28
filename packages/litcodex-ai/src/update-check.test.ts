import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isNewer, maybeNotifyAndRefresh, readUpdateCache, renderUpdateNotice, shouldCheck } from "./update-check.js";

const NOW = Date.parse("2026-07-23T12:00:00.000Z");
const NOW_ISO = "2026-07-23T12:00:00.000Z";
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

function validCache(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schemaVersion: 1,
		packageName: "@litfamily/litcodex",
		attemptedAt: NOW_ISO,
		generation: 1,
		result: { checkedAt: NOW_ISO, latest: "1.2.3" },
		refresh: null,
		...overrides,
	};
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, JSON.stringify(value), "utf8");
}

function collectStderr(): { chunks: string[]; stream: NodeJS.WritableStream } {
	const chunks: string[] = [];
	const stream = {
		isTTY: true,
		write(data: unknown): boolean {
			chunks.push(String(data));
			return true;
		},
	} as unknown as NodeJS.WritableStream;
	return { chunks, stream };
}

describe("strict stable semver", () => {
	it("compares arbitrarily large numeric components without Number precision loss", () => {
		expect(isNewer("9007199254740993.0.0", "9007199254740992.999999999999999999.999999999999999999")).toBe(true);
	});

	it.each([
		"1.2.3-beta.1",
		"1.2.3+build",
		"1.2.3x",
		"01.2.3",
		"1.02.3",
		"v1.2.3",
		"1.2",
		"",
	])("rejects non-stable or non-canonical version %j", (version) => {
		expect(isNewer(version, "1.0.0")).toBe(false);
		expect(isNewer("2.0.0", version)).toBe(false);
	});
});

describe("management-command gating", () => {
	const base = {
		command: "doctor",
		argv: ["doctor"] as readonly string[],
		exitCode: 0,
		stdinTty: true,
		stdoutTty: true,
		stderrTty: true,
		env: {} as NodeJS.ProcessEnv,
	};

	it("allows only a successful interactive install or doctor", () => {
		expect(shouldCheck(base)).toBe(true);
		expect(shouldCheck({ ...base, command: "install", argv: ["install"] })).toBe(true);
	});

	it.each([
		["failed", { exitCode: 4 }],
		["stdin pipe", { stdinTty: false }],
		["stdout pipe", { stdoutTty: false }],
		["stderr pipe", { stderrTty: false }],
		["CI", { env: { CI: "true" } }],
		["JSON", { argv: ["doctor", "--json"] }],
		["dry-run", { command: "install", argv: ["install", "--dry-run"] }],
		["help", { command: "doctor", argv: ["doctor", "--help"] }],
		["version", { command: undefined, argv: ["--version"] }],
		["uninstall", { command: "uninstall", argv: ["uninstall"] }],
		["config", { command: "config", argv: ["config", "migrate"] }],
		["hook", { command: "hook", argv: ["hook", "user-prompt-submit"] }],
		["loop", { command: "loop", argv: ["loop", "status"] }],
		["NO_UPDATE_NOTIFIER", { env: { NO_UPDATE_NOTIFIER: "1" } }],
		["LITCODEX_NO_UPDATE_CHECK", { env: { LITCODEX_NO_UPDATE_CHECK: "1" } }],
		["empty CI marker", { env: { CI: "" } }],
		["empty opt-out marker", { env: { NO_UPDATE_NOTIFIER: "" } }],
	] as const)("rejects %s surfaces", (_label, override) => {
		expect(shouldCheck({ ...base, ...override })).toBe(false);
	});
});

describe("strict cache schema", () => {
	const root = join(tmpdir(), `litcodex-update-schema-${process.pid}`);

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("accepts only the exact schema with canonical timestamps and stable semver", () => {
		const path = join(root, "valid.json");
		writeJson(path, validCache());
		expect(readUpdateCache(path, NOW)).toEqual(validCache());
	});

	it.each([
		["extra root key", { ...validCache(), extra: true }],
		["wrong package", { ...validCache(), packageName: "lookalike" }],
		["unpublished short package", { ...validCache(), packageName: "@litfamily/codex" }],
		["published legacy package", { ...validCache(), packageName: "litcodex-ai" }],
		["numeric timestamp", { ...validCache(), attemptedAt: NOW }],
		["noncanonical timestamp", { ...validCache(), attemptedAt: "2026-07-23T12:00:00Z" }],
		["impossible timestamp", { ...validCache(), attemptedAt: "2026-02-30T00:00:00.000Z" }],
		["fractional generation", { ...validCache(), generation: 1.5 }],
		["prerelease latest", { ...validCache(), result: { checkedAt: NOW_ISO, latest: "2.0.0-rc.1" } }],
		["extra result key", { ...validCache(), result: { checkedAt: NOW_ISO, latest: "2.0.0", extra: true } }],
		[
			"invalid refresh owner",
			{ ...validCache(), refresh: { owner: "predictable", generation: 1, startedAt: NOW_ISO } },
		],
	] as const)("rejects %s", (_label, value) => {
		const path = join(root, `${String(_label).replaceAll(" ", "-")}.json`);
		writeJson(path, value);
		expect(readUpdateCache(path, NOW)).toBeNull();
	});

	it("rejects canonical future timestamps relative to the current check", () => {
		const path = join(root, "future.json");
		writeJson(path, { ...validCache(), attemptedAt: "2026-07-23T12:00:00.001Z" });
		expect(readUpdateCache(path, NOW)).toBeNull();
	});
});

describe("immutable notice", () => {
	it("pins both install forms to the validated version and never advertises latest", () => {
		const notice = renderUpdateNotice("0.3.44", "1.2.3", false);
		expect(notice).toContain("npm i -g @litfamily/litcodex@1.2.3");
		expect(notice).toContain("npm exec --yes --package @litfamily/litcodex@1.2.3 -- litcodex …");
		expect(notice).not.toContain("@latest");
	});

	it("refuses to render an unvalidated version", () => {
		expect(renderUpdateNotice("0.3.44", "1.2.3; touch /tmp/x", false)).toBe("");
	});
});

describe("cached notice and refresh reservation", () => {
	const root = join(tmpdir(), `litcodex-update-orchestrator-${process.pid}`);

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("prints a prior stale success while reserving exactly one detached refresh", () => {
		const cachePath = join(root, "update-check.json");
		writeJson(
			cachePath,
			validCache({
				attemptedAt: "2026-07-21T12:00:00.000Z",
				result: { checkedAt: "2026-07-21T12:00:00.000Z", latest: "9.9.9" },
			}),
		);
		const { chunks, stream } = collectStderr();
		const spawns: Array<{ args: readonly string[]; options: Record<string, unknown> }> = [];
		const child = new EventEmitter() as EventEmitter & { unref: () => void };
		child.unref = vi.fn();

		const options = {
			current: "0.3.44",
			command: "doctor",
			argv: ["doctor"] as readonly string[],
			exitCode: 0,
			stdinTty: true,
			stdoutTty: true,
			stderrTty: true,
			env: { PATH: "/bin", NPM_TOKEN: "secret", SAFE_VALUE: "kept" },
			stderr: stream,
			cachePath,
			now: () => NOW,
			owner: () => OWNER_A,
			spawn: (_command: string, args: readonly string[], spawnOptions: Record<string, unknown>) => {
				spawns.push({ args, options: spawnOptions });
				return child;
			},
		};
		maybeNotifyAndRefresh(options);
		maybeNotifyAndRefresh({ ...options, owner: () => OWNER_B });

		expect(chunks.join("")).toContain("@litfamily/litcodex@9.9.9");
		expect(spawns).toHaveLength(1);
		expect(spawns[0]?.options).toMatchObject({ detached: true, stdio: "ignore" });
		expect((spawns[0]?.options["env"] as NodeJS.ProcessEnv)["NPM_TOKEN"]).toBeUndefined();
		expect((spawns[0]?.options["env"] as NodeJS.ProcessEnv)["SAFE_VALUE"]).toBeUndefined();
		expect(child.unref).toHaveBeenCalledOnce();
		expect(() => child.emit("error", new Error("late spawn error"))).not.toThrow();
		const cache = readUpdateCache(cachePath, NOW);
		expect(cache?.attemptedAt).toBe(NOW_ISO);
		expect(cache?.result).toEqual({ checkedAt: "2026-07-21T12:00:00.000Z", latest: "9.9.9" });
		expect(cache?.refresh).toEqual({ owner: OWNER_A, generation: 2, startedAt: NOW_ISO });
	});

	it("records an attemptedAt throttle and retains success when spawn throws synchronously", () => {
		const cachePath = join(root, "spawn-error.json");
		writeJson(cachePath, validCache({ attemptedAt: "2026-07-21T12:00:00.000Z" }));
		const { stream } = collectStderr();
		expect(() =>
			maybeNotifyAndRefresh({
				current: "0.3.44",
				command: "install",
				argv: ["install"],
				exitCode: 0,
				stdinTty: true,
				stdoutTty: true,
				stderrTty: true,
				env: {},
				stderr: stream,
				cachePath,
				now: () => NOW,
				owner: () => OWNER_A,
				spawn: () => {
					throw new Error("spawn denied");
				},
			}),
		).not.toThrow();
		const cache = readUpdateCache(cachePath, NOW);
		expect(cache?.attemptedAt).toBe(NOW_ISO);
		expect(cache?.result).toEqual({ checkedAt: NOW_ISO, latest: "1.2.3" });
	});
});

describe("serialized fenced transitions", () => {
	const root = join(tmpdir(), `litcodex-update-fence-${process.pid}`);

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("lets a stale owner be replaced but prevents its late completion from erasing the new owner", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		const completeRefresh = module["completeRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string; generation: number; latest?: string }) => void)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		expect(typeof completeRefresh).toBe("function");
		if (!reserveRefresh || !completeRefresh) return;

		const cachePath = join(root, "update-check.json");
		const first = reserveRefresh({ cachePath, now: NOW, owner: OWNER_A });
		expect(first).toEqual({ owner: OWNER_A, generation: 1 });
		const second = reserveRefresh({ cachePath, now: NOW + 24 * 60 * 60 * 1000 + 1, owner: OWNER_B });
		expect(second).toEqual({ owner: OWNER_B, generation: 2 });

		completeRefresh({
			cachePath,
			now: NOW + 24 * 60 * 60 * 1000 + 2,
			owner: OWNER_A,
			generation: 1,
			latest: "8.8.8",
		});
		expect(readUpdateCache(cachePath, NOW + 24 * 60 * 60 * 1000 + 2)?.refresh).toEqual({
			owner: OWNER_B,
			generation: 2,
			startedAt: "2026-07-24T12:00:00.001Z",
		});
		expect(readUpdateCache(cachePath, NOW + 24 * 60 * 60 * 1000 + 2)?.result).toBeNull();

		completeRefresh({
			cachePath,
			now: NOW + 24 * 60 * 60 * 1000 + 3,
			owner: OWNER_B,
			generation: 2,
			latest: "9.9.9",
		});
		expect(readUpdateCache(cachePath, NOW + 24 * 60 * 60 * 1000 + 3)?.refresh).toBeNull();
		expect(readUpdateCache(cachePath, NOW + 24 * 60 * 60 * 1000 + 3)?.result).toEqual({
			checkedAt: "2026-07-24T12:00:00.003Z",
			latest: "9.9.9",
		});
		completeRefresh({
			cachePath,
			now: NOW + 24 * 60 * 60 * 1000 + 4,
			owner: OWNER_A,
			generation: 1,
			latest: "7.7.7",
		});
		expect(readUpdateCache(cachePath, NOW + 24 * 60 * 60 * 1000 + 4)?.result).toEqual({
			checkedAt: "2026-07-24T12:00:00.003Z",
			latest: "9.9.9",
		});
	});

	it("retains the last valid success when the owned refresh fails", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		const completeRefresh = module["completeRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string; generation: number; latest?: string }) => void)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		expect(typeof completeRefresh).toBe("function");
		if (!reserveRefresh || !completeRefresh) return;

		const cachePath = join(root, "failed-completion.json");
		writeJson(cachePath, validCache({ attemptedAt: "2026-07-21T12:00:00.000Z" }));
		expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_A })).toEqual({ owner: OWNER_A, generation: 2 });
		completeRefresh({ cachePath, now: NOW + 1, owner: OWNER_A, generation: 2 });
		expect(readUpdateCache(cachePath, NOW + 1)).toMatchObject({
			attemptedAt: NOW_ISO,
			result: { checkedAt: NOW_ISO, latest: "1.2.3" },
			refresh: null,
		});
	});

	it("fences a reservation mutation after another owner age-takes and commits", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		if (!reserveRefresh) return;

		const cachePath = join(root, "reservation-mutation-race.json");
		writeJson(
			cachePath,
			validCache({
				attemptedAt: "2026-07-21T12:00:00.000Z",
				result: null,
			}),
		);
		let ownerReads = 0;
		let replacement: { owner: string; generation: number } | null = null;
		const staleOwner = {
			cachePath,
			now: NOW,
			get owner(): string {
				ownerReads += 1;
				if (ownerReads === 2) {
					const lockPath = `${cachePath}.lock`;
					writeFileSync(join(lockPath, "owner"), "abandoned", "utf8");
					const abandoned = new Date(NOW - 31_000);
					utimesSync(lockPath, abandoned, abandoned);
					replacement = reserveRefresh({ cachePath, now: NOW, owner: OWNER_B });
				}
				return OWNER_A;
			},
		};

		expect(reserveRefresh(staleOwner)).toBeNull();
		expect(replacement).toEqual({ owner: OWNER_B, generation: 2 });
		expect(readUpdateCache(cachePath, NOW)).toMatchObject({
			generation: 2,
			refresh: { owner: OWNER_B, generation: 2 },
		});
	});

	it("fences a completion mutation after another owner age-takes and commits", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		const completeRefresh = module["completeRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string; generation: number; latest?: string }) => void)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		expect(typeof completeRefresh).toBe("function");
		if (!reserveRefresh || !completeRefresh) return;

		const cachePath = join(root, "completion-mutation-race.json");
		writeJson(
			cachePath,
			validCache({
				attemptedAt: "2026-07-21T12:00:00.000Z",
				result: null,
				refresh: { owner: OWNER_A, generation: 1, startedAt: "2026-07-21T12:00:00.000Z" },
			}),
		);
		let replacement: { owner: string; generation: number } | null = null;
		const staleOwner = {
			cachePath,
			now: NOW,
			generation: 1,
			latest: "8.8.8",
			get owner(): string {
				const lockPath = `${cachePath}.lock`;
				writeFileSync(join(lockPath, "owner"), "abandoned", "utf8");
				const abandoned = new Date(NOW - 31_000);
				utimesSync(lockPath, abandoned, abandoned);
				replacement = reserveRefresh({ cachePath, now: NOW, owner: OWNER_B });
				completeRefresh({ cachePath, now: NOW + 1, owner: OWNER_B, generation: 2, latest: "9.9.9" });
				return OWNER_A;
			},
		};

		completeRefresh(staleOwner);
		expect(replacement).toEqual({ owner: OWNER_B, generation: 2 });
		expect(readUpdateCache(cachePath, NOW + 1)).toMatchObject({
			generation: 2,
			result: { checkedAt: "2026-07-23T12:00:00.001Z", latest: "9.9.9" },
			refresh: null,
		});
	});

	it("takes over a stale malformed abandoned mutex without accepting a future attemptedAt as stale", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		if (!reserveRefresh) return;

		const cachePath = join(root, "stale-mutex.json");
		const lockPath = `${cachePath}.lock`;
		mkdirSync(lockPath, { recursive: true });
		writeFileSync(join(lockPath, "owner"), "abandoned", "utf8");
		const abandoned = new Date(NOW - 31_000);
		utimesSync(lockPath, abandoned, abandoned);
		expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_A })).toEqual({ owner: OWNER_A, generation: 1 });

		writeJson(
			cachePath,
			validCache({
				attemptedAt: "2026-07-24T12:00:00.000Z",
				result: null,
				refresh: null,
			}),
		);
		expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_B })).toEqual({
			owner: OWNER_B,
			generation: 1,
		});

		const futureLockCachePath = join(root, "future-mutex.json");
		const futureLockPath = `${futureLockCachePath}.lock`;
		mkdirSync(futureLockPath, { recursive: true });
		writeFileSync(join(futureLockPath, "owner"), "future", "utf8");
		const future = new Date(NOW + 31_000);
		utimesSync(futureLockPath, future, future);
		expect(reserveRefresh({ cachePath: futureLockCachePath, now: NOW, owner: OWNER_A })).toEqual({
			owner: OWNER_A,
			generation: 1,
		});
	});

	it("does not age-take a live paused well-formed transition owner", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		if (!reserveRefresh) return;

		const cachePath = join(root, "paused-mutex-owner.json");
		const lockPath = `${cachePath}.lock`;
		mkdirSync(lockPath, { recursive: true });
		const transitionOwner = `${process.pid}:${OWNER_A}`;
		writeFileSync(join(lockPath, "owner"), transitionOwner, "utf8");
		const staleByAgeOnly = new Date(NOW - 31_000);
		utimesSync(lockPath, staleByAgeOnly, staleByAgeOnly);

		expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_B })).toBeNull();
		expect(readFileSync(join(lockPath, "owner"), "utf8")).toBe(transitionOwner);
		expect(readUpdateCache(cachePath, NOW)).toBeNull();
	});

	it("age-takes a stale well-formed owner only after an ESRCH process probe", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		if (!reserveRefresh) return;

		const deadPid = 424_242;
		const cachePath = join(root, "exited-owner.json");
		const lockPath = `${cachePath}.lock`;
		mkdirSync(lockPath, { recursive: true });
		writeFileSync(join(lockPath, "owner"), `${deadPid}:${OWNER_A}`, "utf8");
		const staleAfterExit = new Date(NOW - 31_000);
		utimesSync(lockPath, staleAfterExit, staleAfterExit);
		const kill = vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("process not found"), { code: "ESRCH" });
		});

		try {
			expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_B })).toEqual({
				owner: OWNER_B,
				generation: 1,
			});
			expect(kill).toHaveBeenCalledWith(deadPid, 0);
			expect(readUpdateCache(cachePath, NOW)).toMatchObject({
				generation: 1,
				refresh: { owner: OWNER_B, generation: 1 },
			});
		} finally {
			kill.mockRestore();
		}
	});

	it("fails closed when a stale owner PID probe returns EPERM", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		if (!reserveRefresh) return;

		const cachePath = join(root, "permission-denied-owner.json");
		const lockPath = `${cachePath}.lock`;
		mkdirSync(lockPath, { recursive: true });
		const transitionOwner = `${process.pid}:${OWNER_A}`;
		writeFileSync(join(lockPath, "owner"), transitionOwner, "utf8");
		const staleByAgeOnly = new Date(NOW - 31_000);
		utimesSync(lockPath, staleByAgeOnly, staleByAgeOnly);
		const kill = vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("permission denied"), { code: "EPERM" });
		});

		try {
			expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_B })).toBeNull();
			expect(kill).toHaveBeenCalledWith(process.pid, 0);
			expect(readFileSync(join(lockPath, "owner"), "utf8")).toBe(transitionOwner);
		} finally {
			kill.mockRestore();
		}
	});

	it("fails closed without probing an indeterminate stale owner PID", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		if (!reserveRefresh) return;

		const cachePath = join(root, "indeterminate-owner.json");
		const lockPath = `${cachePath}.lock`;
		mkdirSync(lockPath, { recursive: true });
		const transitionOwner = `9007199254740992:${OWNER_A}`;
		writeFileSync(join(lockPath, "owner"), transitionOwner, "utf8");
		const staleByAgeOnly = new Date(NOW - 31_000);
		utimesSync(lockPath, staleByAgeOnly, staleByAgeOnly);
		const kill = vi.spyOn(process, "kill");

		try {
			expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_B })).toBeNull();
			expect(kill).not.toHaveBeenCalled();
			expect(readFileSync(join(lockPath, "owner"), "utf8")).toBe(transitionOwner);
		} finally {
			kill.mockRestore();
		}
	});

	it("permits a new reservation at the exact 24-hour boundary", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const reserveRefresh = module["reserveRefresh"] as
			| ((opts: { cachePath: string; now: number; owner: string }) => { owner: string; generation: number } | null)
			| undefined;
		expect(typeof reserveRefresh).toBe("function");
		if (!reserveRefresh) return;
		const cachePath = join(root, "ttl-boundary.json");
		expect(reserveRefresh({ cachePath, now: NOW, owner: OWNER_A })).toEqual({ owner: OWNER_A, generation: 1 });
		expect(reserveRefresh({ cachePath, now: NOW + 24 * 60 * 60 * 1000, owner: OWNER_B })).toEqual({
			owner: OWNER_B,
			generation: 2,
		});
		expect(reserveRefresh({ cachePath: join(root, "bad-owner.json"), now: NOW, owner: "predictable" })).toBeNull();
	});
});

describe("official registry response contract", () => {
	function registryGet(response: {
		status?: number;
		contentType?: string;
		contentLength?: string;
		body?: string | Buffer;
		delay?: boolean;
	}): (
		url: string,
		options: unknown,
		callback: (res: PassThrough & { statusCode?: number; headers: Record<string, string> }) => void,
	) => EventEmitter & { destroy: () => void } {
		return (url, options, callback) => {
			expect(url).toBe("https://registry.npmjs.org/@litfamily%2Flitcodex/latest");
			expect(options).toMatchObject({ headers: { accept: "application/json" } });
			const request = new EventEmitter() as EventEmitter & { destroy: () => void };
			request.destroy = vi.fn(() => request.emit("error", new Error("destroyed")));
			if (!response.delay) {
				queueMicrotask(() => {
					const stream = new PassThrough() as PassThrough & {
						statusCode?: number;
						headers: Record<string, string>;
					};
					stream.statusCode = response.status ?? 200;
					stream.headers = {
						"content-type": response.contentType ?? "application/json; charset=utf-8",
						...(response.contentLength === undefined ? {} : { "content-length": response.contentLength }),
					};
					callback(stream);
					stream.end(response.body ?? JSON.stringify({ name: "@litfamily/litcodex", version: "1.2.3" }));
				});
			}
			return request;
		};
	}

	it("accepts only exact package identity, status, content type, bounded JSON, and stable semver", async () => {
		const module = (await import("./update-check.js")) as Record<string, unknown>;
		const fetchLatestVersion = module["fetchLatestVersion"] as
			| ((opts: { get: ReturnType<typeof registryGet>; deadlineMs?: number }) => Promise<string | null>)
			| undefined;
		expect(typeof fetchLatestVersion).toBe("function");
		if (!fetchLatestVersion) return;

		expect(await fetchLatestVersion({ get: registryGet({}) })).toBe("1.2.3");
		expect(
			await fetchLatestVersion({
				get: registryGet({ body: JSON.stringify({ name: "lookalike", version: "9.9.9" }) }),
			}),
		).toBeNull();
		for (const name of [
			"@litfamily/codex",
			"litcodex-ai",
			"@litfamily/litcodex-evil",
			"@litfamily/litcodex/extra",
			"https://registry.npmjs.org/@litfamily/litcodex",
			"../codex",
			" @litfamily/litcodex",
		]) {
			expect(
				await fetchLatestVersion({ get: registryGet({ body: JSON.stringify({ name, version: "9.9.9" }) }) }),
			).toBeNull();
		}
		expect(await fetchLatestVersion({ get: registryGet({ status: 201 }) })).toBeNull();
		expect(await fetchLatestVersion({ get: registryGet({ contentType: "text/json" }) })).toBeNull();
		expect(await fetchLatestVersion({ get: registryGet({ contentLength: "65537" }) })).toBeNull();
		expect(
			await fetchLatestVersion({
				get: registryGet({ body: JSON.stringify({ name: "@litfamily/litcodex", version: "2.0.0-beta.1" }) }),
			}),
		).toBeNull();
		expect(
			await fetchLatestVersion({
				get: registryGet({ body: Buffer.alloc(64 * 1024 + 1, 0x20) }),
			}),
		).toBeNull();
	});

	it("enforces a total deadline rather than a socket-idle timeout", async () => {
		vi.useFakeTimers();
		try {
			const module = (await import("./update-check.js")) as Record<string, unknown>;
			const fetchLatestVersion = module["fetchLatestVersion"] as
				| ((opts: { get: ReturnType<typeof registryGet>; deadlineMs?: number }) => Promise<string | null>)
				| undefined;
			expect(typeof fetchLatestVersion).toBe("function");
			if (!fetchLatestVersion) return;
			const pending = fetchLatestVersion({ get: registryGet({ delay: true }), deadlineMs: 3000 });
			await vi.advanceTimersByTimeAsync(3000);
			expect(await pending).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
