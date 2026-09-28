import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { managedMarketplaceRoot } from "./marketplace.js";

// Bridge from the `litcodex` binary to the installed lit-typographic-motion runtime script. The
// script owns the pinned cache, the five doctor probes and the pre-warm; this module only locates
// it in the managed marketplace, forwards flags and renders its report.

export const MOTION_RUNTIME_COMMAND = "litcodex motion-runtime install";

export interface MotionRuntimeReport {
	readonly ready: boolean;
	readonly chrome: string;
	readonly ffmpeg: string;
	readonly webgl2: string;
	readonly rendererWarning: string;
	readonly prewarm: string;
	readonly audio: string;
	readonly wordTiming: string;
	readonly missing: readonly string[];
}

export interface MotionInstallResult {
	readonly exitCode: number;
	readonly receipt: string;
	readonly output: string;
	readonly status: MotionRuntimeReport;
}

type Spawn = (
	command: string,
	args: readonly string[],
	options: { encoding: "utf8"; env: NodeJS.ProcessEnv; timeout?: number },
) => {
	status: number | null;
	stdout?: string | null;
	stderr?: string | null;
	error?: Error;
};

export function motionRuntimeScript(codexHome: string): string {
	return join(managedMarketplaceRoot(codexHome), "plugins/litcodex/skills/lit-typographic-motion/scripts/runtime.mjs");
}

function unavailable(reason: string): MotionRuntimeReport {
	return {
		ready: false,
		chrome: "not probed",
		ffmpeg: "not probed",
		webgl2: "not probed",
		rendererWarning: "not probed",
		prewarm: `missing: ${reason}; fix: ${MOTION_RUNTIME_COMMAND}`,
		audio: "not probed",
		wordTiming: "not probed",
		missing: [reason],
	};
}

/** The five MO-A-44 probes from the installed runtime script (plus audio and word-timing tiers). */
export function motionRuntimeStatus(
	codexHome: string,
	spawn: Spawn = spawnSync,
	env: NodeJS.ProcessEnv = process.env,
): MotionRuntimeReport {
	const script = motionRuntimeScript(codexHome);
	if (!existsSync(script))
		return unavailable("installed lit-typographic-motion skill is missing (run `litcodex install`)");
	const result = spawn(process.execPath, [script, "status", "--json"], { encoding: "utf8", env, timeout: 150000 });
	try {
		const body = JSON.parse(result.stdout ?? "") as Partial<MotionRuntimeReport>;
		return {
			ready: body.ready === true,
			chrome: body.chrome ?? "unknown",
			ffmpeg: body.ffmpeg ?? "unknown",
			webgl2: body.webgl2 ?? "unknown",
			rendererWarning: body.rendererWarning ?? "unknown",
			prewarm: body.prewarm ?? "unknown",
			audio: body.audio ?? "unknown",
			wordTiming: body.wordTiming ?? "unknown",
			missing: body.missing ?? [],
		};
	} catch {
		return unavailable(result.error?.message ?? (result.stderr?.trim() || "motion status probe failed"));
	}
}

/** Pre-warm through the installed script; never throws, always returns one receipt line. */
export function prepareMotionRuntime(
	codexHome: string,
	flags: readonly string[] = [],
	spawn: Spawn = spawnSync,
	env: NodeJS.ProcessEnv = process.env,
): MotionInstallResult {
	const script = motionRuntimeScript(codexHome);
	if (!existsSync(script)) {
		const status = unavailable("installed lit-typographic-motion skill is missing (run `litcodex install`)");
		return { exitCode: 3, receipt: motionRuntimeReceipt(false, status.missing[0] ?? ""), output: "", status };
	}
	const result = spawn(process.execPath, [script, "install", ...flags], { encoding: "utf8", env, timeout: 900000 });
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	const exitCode = result.status ?? 3;
	const receiptLine = output
		.split("\n")
		.filter((line) => line.startsWith("[litcodex] "))
		.pop();
	const reason = result.error?.message ?? receiptLine ?? "pre-warm failed";
	const status = motionRuntimeStatus(codexHome, spawn, env);
	return { exitCode, receipt: motionRuntimeReceipt(exitCode === 0, reason), output, status };
}

export function motionRuntimeReceipt(ready: boolean, reason = ""): string {
	return ready
		? "Motion runtime ready for film rendering."
		: `Motion runtime pre-warm unavailable${reason ? ` (${reason.replace(/^\[litcodex\]\s*/u, "")})` : ""}; run \`${MOTION_RUNTIME_COMMAND}\` outside the sandbox.`;
}

export function renderMotionRuntime(report: MotionRuntimeReport, indent = ""): string {
	return [
		`${indent}motion Chrome: ${report.chrome}`,
		`${indent}motion ffmpeg: ${report.ffmpeg}`,
		`${indent}motion WebGL2 renderer: ${report.webgl2}`,
		`${indent}motion renderer warning: ${report.rendererWarning}`,
		`${indent}motion pre-warm: ${report.prewarm}`,
		`${indent}motion audio tier: ${report.audio}`,
		`${indent}motion word timing: ${report.wordTiming}`,
	].join("\n");
}
