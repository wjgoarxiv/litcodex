import type { CapabilityReport } from "./host-capabilities.js";
import type { InstallResult } from "./types.js";

export function renderCapability(report: CapabilityReport): string {
	return `${report.status}; reason=${report.reason}; source=${report.observedSource}`;
}

export function renderPlainInstallResult(result: InstallResult): string {
	const lines = result.steps.map((step) => `${step.status} ${step.kind}: ${step.detail}`);
	if (result.capabilities !== undefined) {
		lines.push(`capability concurrency: ${renderCapability(result.capabilities.concurrency)}`);
		lines.push(
			`probe-only explicit context/auto-compaction override: ${renderCapability(result.capabilities.autoCompaction)}`,
		);
	}
	lines.push("litcodex install: complete");
	return `${lines.join("\n")}\n`;
}
