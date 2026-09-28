import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { managedMarketplaceRoot } from "./marketplace.js";

const RETRY = "npm exec --package @litfamily/litcodex -- litcodex office-runtime install";
type Spawn = (
	command: string,
	args: readonly string[],
	options: { encoding: "utf8"; env: NodeJS.ProcessEnv },
) => {
	status: number | null;
	stdout?: string | null;
	error?: Error;
};

function runner(codexHome: string): string {
	return join(managedMarketplaceRoot(codexHome), "plugins/litcodex/skills/lit-pptx/scripts/office-run.mjs");
}

function invoke(codexHome: string, command: "install" | "doctor", spawn: Spawn, env: NodeJS.ProcessEnv) {
	const path = runner(codexHome);
	if (!existsSync(path)) return { status: null, stdout: "", error: new Error("Office skill payload is missing") };
	return spawn(process.execPath, [path, command], { encoding: "utf8", env });
}

export function officeRuntimeStatus(codexHome: string, spawn: Spawn = spawnSync, env: NodeJS.ProcessEnv = process.env) {
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
) {
	const result = invoke(codexHome, "install", spawn, env);
	return result.status === 0 ? officeRuntimeStatus(codexHome, spawn, env) : { ready: false, pptx: false, docx: false };
}

export function officeRuntimeNotice(ready: boolean): string {
	return ready
		? "Office runtime ready for presentations and documents."
		: `Office runtime unavailable; run \`${RETRY}\` outside the sandbox when network is available.`;
}
