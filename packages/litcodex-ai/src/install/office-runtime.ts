import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { managedMarketplaceRoot } from "./marketplace.js";
import { childTail } from "./motion-runtime.js";

const RETRY = "npm exec --package @litfamily/litcodex -- litcodex office-runtime install";
type Spawn = (
	command: string,
	args: readonly string[],
	options: { encoding: "utf8"; env: NodeJS.ProcessEnv },
) => {
	status: number | null;
	stdout?: string | null;
	stderr?: string | null;
	error?: Error;
};

export interface OfficeRuntimeState {
	readonly ready: boolean;
	readonly pptx: boolean;
	readonly docx: boolean;
	readonly detail?: string;
}

export function officeRuntimeScript(codexHome: string): string {
	return join(managedMarketplaceRoot(codexHome), "plugins/litcodex/skills/lit-pptx/scripts/office-run.mjs");
}

function invoke(codexHome: string, command: "install" | "doctor", spawn: Spawn, env: NodeJS.ProcessEnv) {
	const path = officeRuntimeScript(codexHome);
	if (!existsSync(path)) return { status: null, stdout: "", error: new Error("Office skill payload is missing") };
	return spawn(process.execPath, [path, command], { encoding: "utf8", env });
}

export function officeRuntimeStatus(
	codexHome: string,
	spawn: Spawn = spawnSync,
	env: NodeJS.ProcessEnv = process.env,
): OfficeRuntimeState {
	const result = invoke(codexHome, "doctor", spawn, env);
	try {
		const status = JSON.parse(result.stdout ?? "") as { pptx?: { ready?: boolean }; docx?: { ready?: boolean } };
		return {
			ready: result.status === 0 && status.pptx?.ready === true && status.docx?.ready === true,
			pptx: status.pptx?.ready === true,
			docx: status.docx?.ready === true,
		};
	} catch {
		return { ready: false, pptx: false, docx: false };
	}
}

export function prepareOfficeRuntime(
	codexHome: string,
	spawn: Spawn = spawnSync,
	env: NodeJS.ProcessEnv = process.env,
): OfficeRuntimeState {
	const result = invoke(codexHome, "install", spawn, env);
	if (result.status === 0) return officeRuntimeStatus(codexHome, spawn, env);
	// Keep the child's own words: "sandbox" is only one of the reasons an install fails.
	const detail = result.error?.message ?? `exit ${result.status ?? "signal"}: ${childTail(result.stderr)}`;
	return { ready: false, pptx: false, docx: false, detail };
}

export function officeRuntimeNotice(ready: boolean, detail?: string): string {
	return ready
		? "Office runtime ready for presentations and documents."
		: `Office runtime unavailable${detail ? ` (${detail})` : ""}; run \`${RETRY}\` outside the sandbox when network is available.`;
}
