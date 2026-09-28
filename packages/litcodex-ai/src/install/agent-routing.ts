import { join } from "node:path";

import { FALLBACK_CATALOG, type ReasoningProfile } from "../config-migration/catalog.js";
import { chatgptDesiredRouteModel, isKnownGpt56Model, unsafeEffectiveRoute } from "../config-migration/gpt56-policy.js";
import type { AuthMode } from "./auth-mode.js";
import type { ReadonlyFsLike } from "./codex.js";
import type { AgentRoute, AgentRoutingReport } from "./types.js";

export const NATIVE_DEFAULT_AGENT_FILE = "litcodex-default.toml";

const AGENT_FILES = [
	NATIVE_DEFAULT_AGENT_FILE,
	"litcodex-explorer.toml",
	"litcodex-librarian.toml",
	"litcodex-plan.toml",
	"litcodex-metis.toml",
	"litcodex-momus.toml",
	"litcodex-litwork-reviewer.toml",
] as const;

/**
 * Resolve a bundled role's installed path without making the native generic role discoverable.
 * Codex scans `<CODEX_HOME>/agents/` for named roles; the managed `default` role is selected by
 * the explicit native `[agents.default].config_file` binding and therefore lives beside that dir.
 */
export function installedAgentPath(codexHome: string, file: string): string {
	return file === NATIVE_DEFAULT_AGENT_FILE ? join(codexHome, file) : join(codexHome, "agents", file);
}

export function parseAgentRoute(file: string, content: string): AgentRoute {
	const header = routeHeader(content);
	if (/^\s*(?:effort|reasoning_effort)\s*=/m.test(header)) {
		throw new Error("effort conflicts with model_reasoning_effort");
	}
	return {
		file,
		role: file.replace(/^litcodex-/, "").replace(/\.toml$/, ""),
		model: readRequiredTomlString(header, "model"),
		effort: readRequiredTomlString(header, "model_reasoning_effort"),
	};
}

export function rewriteAgentRouteModel(content: string, from: string, to: string): string {
	const header = routeHeader(content);
	const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const rewrittenHeader = header.replace(new RegExp(`^(model\\s*=\\s*")${escapedFrom}"`, "m"), `$1${to}"`);
	return `${rewrittenHeader}${content.slice(header.length)}`;
}

/** Replace only the native route header, leaving user instructions and all other fields untouched. */
export function rewriteAgentRouteHeader(content: string, route: Pick<AgentRoute, "model" | "effort">): string {
	const header = routeHeader(content);
	const modelHeader = replaceRouteHeaderValue(header, "model", route.model);
	const rewrittenHeader = replaceRouteHeaderValue(modelHeader, "model_reasoning_effort", route.effort);
	return `${rewrittenHeader}${content.slice(header.length)}`;
}

export function agentRouteIssue(route: Pick<AgentRoute, "file" | "model" | "effort">): string | null {
	if (!isKnownGpt56Model(route.model)) return `${route.file} has unknown model: ${route.model}`;
	const unsafe = unsafeEffectiveRoute({ model: route.model, model_reasoning_effort: route.effort });
	return unsafe === null ? null : `${route.file} has unsafe route: ${unsafe}`;
}

export function desiredAgentRoutes(authMode?: AuthMode): readonly AgentRoute[] {
	return AGENT_FILES.map((file) => {
		const role = file.replace(/^litcodex-/, "").replace(/\.toml$/, "");
		const desired = FALLBACK_CATALOG.roles[role] ?? {};
		const profile =
			authMode === "chatgpt" && desired.model !== undefined
				? { ...desired, model: chatgptDesiredRouteModel(desired.model) }
				: desired;
		return routeFromProfile(file, role, profile);
	});
}

export function inspectAgentRouting(fs: ReadonlyFsLike, codexHome: string, authMode?: AuthMode): AgentRoutingReport {
	const readFailures: string[] = [];
	const legacyDefaultPath = join(codexHome, "agents", NATIVE_DEFAULT_AGENT_FILE);
	if (fs.existsSync(legacyDefaultPath)) {
		readFailures.push(
			`${NATIVE_DEFAULT_AGENT_FILE} is also present in the autodiscovered agents directory; remove the duplicate before reinstalling`,
		);
	}
	const installedRoutes = AGENT_FILES.flatMap((file) => {
		const path = installedAgentPath(codexHome, file);
		if (!fs.existsSync(path)) return [];
		try {
			return [parseAgentRoute(file, fs.readFileSync(path, "utf8"))];
		} catch (error) {
			readFailures.push(
				error instanceof Error && /ambiguous|unparseable|conflicts/.test(error.message)
					? `${file} is ambiguous or unparseable`
					: `${file} is unreadable`,
			);
			return [];
		}
	});
	return routingReport(installedRoutes, readFailures, authMode);
}

export function routingReport(
	installedRoutes: readonly AgentRoute[],
	readFailures: readonly string[] = [],
	authMode?: AuthMode,
): AgentRoutingReport {
	const desiredRoutes = desiredAgentRoutes(authMode);
	const issues = [...readFailures];
	const preservedRoutes: AgentRoute[] = [];
	if (installedRoutes.length !== AGENT_FILES.length) {
		issues.push(`agent TOMLs incomplete (${installedRoutes.length}/${AGENT_FILES.length} readable)`);
	}
	const desiredByRole = new Map(desiredRoutes.map((route) => [route.role, route]));
	for (const route of installedRoutes) {
		const routeIssue = agentRouteIssue(route);
		const safeUserOwnedRoute =
			!isKnownGpt56Model(route.model) &&
			unsafeEffectiveRoute({ model: route.model, model_reasoning_effort: route.effort }) === null;
		if (routeIssue !== null && !safeUserOwnedRoute) issues.push(routeIssue);
		const desired = desiredByRole.get(route.role);
		if (desired !== undefined && (desired.model !== route.model || desired.effort !== route.effort)) {
			preservedRoutes.push(route);
		}
	}
	return {
		healthy: issues.length === 0,
		issues,
		desiredConfig: summarizeAgentRoutes(desiredRoutes),
		installedTomls:
			installedRoutes.length === AGENT_FILES.length
				? summarizeAgentRoutes(installedRoutes)
				: `incomplete (${installedRoutes.length}/${AGENT_FILES.length} readable)`,
		preservedRoutes: preservedRoutes.length === 0 ? "none" : summarizeAgentRoutes(preservedRoutes),
		spawnOverride: "not exposed by the verified host schema",
		effectiveChild: "unverified without a child JSONL receipt; fail-closed",
	};
}

export function summarizeAgentRoutes(routes: readonly AgentRoute[]): string {
	if (routes.length === 0) return "not reported";
	return routes.map((route) => `${route.role}=${route.model}/${route.effort}`).join(", ");
}

function routeFromProfile(file: string, role: string, profile: Partial<ReasoningProfile>): AgentRoute {
	return {
		file,
		role,
		model: profile.model ?? "unreported",
		effort: profile.model_reasoning_effort ?? "unreported",
	};
}

function readRequiredTomlString(content: string, key: string): string {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const matches = [...content.matchAll(new RegExp(`^${escapedKey}\\s*=\\s*"([^"\\r\\n]+)"\\s*$`, "gm"))];
	if (matches.length !== 1 || matches[0]?.[1] === undefined) {
		throw new Error(`${key} is ambiguous or unparseable`);
	}
	return matches[0][1];
}

function routeHeader(content: string): string {
	const boundaries = [content.search(/^\s*developer_instructions\s*=\s*"""/m), content.search(/^\s*\[/m)].filter(
		(index) => index >= 0,
	);
	const boundary = boundaries.length === 0 ? content.length : Math.min(...boundaries);
	return content.slice(0, boundary);
}

function replaceRouteHeaderValue(header: string, key: string, value: string): string {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return header.replace(new RegExp(`^(${escapedKey}\\s*=\\s*")[^"\\r\\n]+"`, "m"), `$1${value}"`);
}
