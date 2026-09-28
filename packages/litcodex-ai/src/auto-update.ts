import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type CheckGate, shouldCheck } from "./update-check.js";

export const FOREGROUND_AUTO_UPDATE_TIMEOUT_MS = 55_000;

export interface ForegroundAutoUpdateOptions extends CheckGate {
	readonly current: string;
	readonly stderr: NodeJS.WritableStream;
	readonly cwd?: string;
	readonly helperPath?: string;
}

export interface ForegroundAutoUpdateReceipt {
	readonly status: "updated" | "up-to-date" | "skipped" | "failed" | "unknown-state" | "locked" | "throttled";
	readonly reason?: string;
	readonly latestVersion?: string;
	readonly verificationStatus?: "verified" | "mismatch" | "unavailable" | "not-run";
	readonly verifiedVersion?: string;
	readonly verificationDetail?: string;
	readonly doctorStatus?: "passed" | "failed" | "unavailable" | "not-run";
	readonly doctorDetail?: string;
	readonly receiptPath?: string;
}

/**
 * Run the installed component's updater synchronously after a successful eligible command.
 *
 * The detached cache-only notifier remains a separate route. This helper intentionally waits for
 * the foreground process and carries only typed command metadata into the updater child.
 */
export function runForegroundAutoUpdate(options: ForegroundAutoUpdateOptions): ForegroundAutoUpdateReceipt | null {
	if (!shouldCheck(options)) return null;
	const helper = options.helperPath ?? resolveAutoUpdateHelper();
	if (!helper || !existsSync(helper)) return null;
	const helperEnv: NodeJS.ProcessEnv = {
		...options.env,
		["LITCODEX_CURRENT_VERSION"]: options.current,
	};
	const result = spawnSync(
		process.execPath,
		[helper, "run-management", `--current-version=${options.current}`, `--argv-json=${JSON.stringify(options.argv)}`],
		{
			cwd: options.cwd ?? process.cwd(),
			env: helperEnv,
			stdio: ["ignore", "pipe", "pipe"],
			encoding: "utf8",
			timeout: FOREGROUND_AUTO_UPDATE_TIMEOUT_MS,
			killSignal: "SIGTERM",
		},
	);
	const receipt = typeof result.stdout === "string" ? parseReceipt(result.stdout) : null;
	if (receipt === null) {
		if (result.status === 0 && result.error === undefined && result.signal === null) return null;
		const detail =
			result.error?.message ??
			(result.signal ? `helper terminated:${result.signal}` : `helper exit:${String(result.status)}`);
		const blocked: ForegroundAutoUpdateReceipt = { status: "unknown-state", reason: detail };
		options.stderr.write(
			`\n⚠️ Foreground update barrier could not produce a receipt: ${detail}. Run litcodex doctor.\n`,
		);
		return blocked;
	}
	if (receipt.status === "updated") {
		options.stderr.write(
			`\n🔥 Foreground update barrier applied ${options.current} → ${receipt.latestVersion ?? "latest stable"} (version + doctor verified ${receipt.verifiedVersion ?? receipt.latestVersion ?? "stable target"}).\n`,
		);
	} else if (receipt.status === "failed") {
		options.stderr.write(`\n⚠️ Foreground update barrier failed: ${receipt.reason ?? "unknown error"}.\n`);
	} else if (receipt.status === "unknown-state") {
		options.stderr.write(
			`\n⚠️ Foreground update barrier left installation state unknown: ${receipt.reason ?? "rollback failed"}. Run litcodex doctor.\n`,
		);
	}
	return receipt;
}

export function resolveAutoUpdateHelper(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(here, "../../plugins/litcodex/components/auto-update/dist/cli.js"),
		join(here, "../marketplace/plugins/litcodex/components/auto-update/dist/cli.js"),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function parseReceipt(raw: string): ForegroundAutoUpdateReceipt | null {
	const line = raw.trim().split("\n").at(-1);
	if (line === undefined) return null;
	try {
		const parsed: unknown = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
		const value = parsed as Record<string, unknown>;
		const status = value["status"];
		if (
			status !== "updated" &&
			status !== "up-to-date" &&
			status !== "skipped" &&
			status !== "failed" &&
			status !== "unknown-state" &&
			status !== "locked" &&
			status !== "throttled"
		) {
			return null;
		}
		return {
			status,
			...(typeof value["reason"] === "string" ? { reason: value["reason"] } : {}),
			...(typeof value["latestVersion"] === "string" ? { latestVersion: value["latestVersion"] } : {}),
			...(value["verificationStatus"] === "verified" ||
			value["verificationStatus"] === "mismatch" ||
			value["verificationStatus"] === "unavailable" ||
			value["verificationStatus"] === "not-run"
				? { verificationStatus: value["verificationStatus"] }
				: {}),
			...(typeof value["verifiedVersion"] === "string" ? { verifiedVersion: value["verifiedVersion"] } : {}),
			...(typeof value["verificationDetail"] === "string"
				? { verificationDetail: value["verificationDetail"] }
				: {}),
			...(value["doctorStatus"] === "passed" ||
			value["doctorStatus"] === "failed" ||
			value["doctorStatus"] === "unavailable" ||
			value["doctorStatus"] === "not-run"
				? { doctorStatus: value["doctorStatus"] }
				: {}),
			...(typeof value["doctorDetail"] === "string" ? { doctorDetail: value["doctorDetail"] } : {}),
			...(typeof value["receiptPath"] === "string" ? { receiptPath: value["receiptPath"] } : {}),
		};
	} catch {
		return null;
	}
}
