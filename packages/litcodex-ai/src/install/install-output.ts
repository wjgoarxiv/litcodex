import type { CapabilityReport } from "./host-capabilities.js";
import type { InstallResult } from "./types.js";

export function renderCapability(report: CapabilityReport): string {
	return `${report.status}; reason=${report.reason}; source=${report.observedSource}`;
}

/** What only the person can do after a finished install. */
export const NEXT_STEPS = [
	"Restart Codex if it is open.",
	"Approve the LitCodex hooks when Codex asks to review them.",
] as const;

export function renderPlainInstallResult(result: InstallResult): string {
	const lines = result.steps.map((step) => `${step.status} ${step.kind}: ${step.detail}`);
	if (result.capabilities !== undefined) {
		lines.push(`capability concurrency: ${renderCapability(result.capabilities.concurrency)}`);
		lines.push(
			`probe-only explicit context/auto-compaction override: ${renderCapability(result.capabilities.autoCompaction)}`,
		);
	}
	if (result.ok) lines.push(...NEXT_STEPS.map((step) => `next: ${step}`));
	lines.push("litcodex install: complete");
	return `${lines.join("\n")}\n`;
}
