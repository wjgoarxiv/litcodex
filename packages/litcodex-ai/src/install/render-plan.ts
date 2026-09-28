// M12 / T17 — dry-run plan renderer (S12 §render-plan.ts).
//
// `renderInstallPlan` is the exact stdout text for `install --dry-run`: a fixed LitCodex header,
// numbered step titles in execution order, and the planned agent routes. No exec-wrapper line,
// no legacy token, no trailing blank line (the caller appends the final "\n").

import { desiredAgentRoutes } from "./agent-routing.js";
import type { InstallStep } from "./types.js";

export const INSTALL_PLAN_HEADER = "litcodex install plan (Codex)" as const;

export function renderInstallPlan(steps: readonly InstallStep[]): string {
	const lines = [
		INSTALL_PLAN_HEADER,
		...steps.map((step, i) => `${i + 1}. ${step.title}`),
		"Agent routes (model/effort):",
		...desiredAgentRoutes().map((route) => `  - ${route.role}=${route.model}/${route.effort}`),
	];
	return lines.join("\n");
}
