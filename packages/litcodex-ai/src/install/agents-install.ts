import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { EXPLICIT_GPT56_SOL_MODEL, GPT56_MODELS, unsafeEffectiveRoute } from "../config-migration/gpt56-policy.js";
import {
	agentRouteIssue,
	installedAgentPath,
	NATIVE_DEFAULT_AGENT_FILE,
	parseAgentRoute,
	rewriteAgentRouteHeader,
	rewriteAgentRouteModel,
} from "./agent-routing.js";
import type { AuthMode } from "./auth-mode.js";
import { InstallError } from "./errors.js";
import type { AgentRoute, InstallStep, InstallStepResult } from "./types.js";

export interface WritableFsLike {
	existsSync(p: string): boolean;
	/** Optional identity probe; injected memory filesystems may omit it. */
	lstatSync?(p: string): { isSymbolicLink(): boolean; isDirectory(): boolean };
	mkdirSync(p: string, o: { recursive: true }): void;
	readdirSync(p: string): string[];
	readFileSync(p: string, e: "utf8"): string;
	writeFileSync(p: string, d: string): void;
}

export interface AgentInstallDeps {
	readonly now: () => number;
	readonly repoRoot: string;
	readonly codexHome?: string;
	readonly writeFs?: WritableFsLike;
	readonly agentsSourceDir?: string;
	readonly authMode?: AuthMode;
	/** Selected helper route; applied to the native generic default role on fresh/reconfigure. */
	readonly subagentModel?: string;
	readonly subagentEffort?: string;
	readonly preparedAgentSources?: PreparedAgentSources;
	/** Explicit `--reconfigure` is the only permission to update an existing role header. */
	readonly reconfigure?: boolean;
}

export interface AgentSource {
	readonly file: string;
	readonly content: string;
}

export interface PreparedAgentSources {
	readonly sources: readonly AgentSource[];
	readonly agentRoutes: readonly AgentRoute[];
}

const NODE_FS: WritableFsLike = {
	existsSync,
	lstatSync,
	mkdirSync: (path, options) => mkdirSync(path, options),
	readdirSync: (path) => readdirSync(path),
	readFileSync: (path, encoding) => readFileSync(path, encoding),
	writeFileSync: (path, data) => writeFileSync(path, data),
};

export function runAgentsInstall(step: InstallStep, deps: AgentInstallDeps): InstallStepResult {
	const wfs = deps.writeFs ?? NODE_FS;
	const prepared = deps.preparedAgentSources ?? prepareAgentSources(deps);
	const codexHome = deps.codexHome ?? "";
	if (!isAbsolute(codexHome)) {
		throw missingAgents({ codexHome });
	}
	assertSafeAgentPath(wfs, codexHome, true);
	const targetDir = join(codexHome, "agents");
	assertSafeAgentPath(wfs, targetDir, true);
	const installsNativeDefault = prepared.sources.some((source) => source.file === NATIVE_DEFAULT_AGENT_FILE);
	const legacyDefaultPath = join(targetDir, NATIVE_DEFAULT_AGENT_FILE);
	if (installsNativeDefault) {
		assertSafeAgentPath(wfs, legacyDefaultPath, false);
		if (wfs.existsSync(legacyDefaultPath)) {
			throw missingAgents({
				path: legacyDefaultPath,
				reason:
					"managed generic default role is still inside the autodiscovered agents directory; refusing to create a duplicate outside it",
			});
		}
	}
	const timestamp = new Date(deps.now())
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
	const actions: AgentInstallAction[] = [];
	for (const source of prepared.sources) {
		const sourceRoute = prepared.agentRoutes.find((route) => route.file === source.file);
		if (sourceRoute === undefined) throw missingAgents({ file: source.file, reason: "prepared route missing" });
		const targetPath = installedAgentPath(codexHome, source.file);
		assertSafeAgentPath(wfs, targetPath, false);
		if (!wfs.existsSync(targetPath)) {
			actions.push({ source, targetPath, route: sourceRoute, kind: "install", output: source.content });
			continue;
		}
		const existing = wfs.readFileSync(targetPath, "utf8");
		if (existing === source.content) {
			const route = parseExistingRoute(source.file, existing);
			actions.push({ source, targetPath, route, kind: "unchanged", output: existing });
			continue;
		}
		const existingRoute = parseExistingRoute(source.file, existing);
		if (deps.reconfigure !== true) {
			actions.push({ source, targetPath, route: existingRoute, kind: "preserve", output: existing });
			continue;
		}
		actions.push({
			source,
			targetPath,
			route: sourceRoute,
			kind: "rewrite",
			output: rewriteAgentRouteHeader(existing, sourceRoute),
			existing,
		});
	}
	wfs.mkdirSync(targetDir, { recursive: true });
	let installed = 0;
	let unchanged = 0;
	let preserved = 0;
	const installedRoutes: AgentRoute[] = [];
	for (const action of actions) {
		if (action.kind === "preserve") {
			preserved += 1;
			installedRoutes.push(action.route);
			continue;
		}
		if (action.kind === "unchanged") {
			unchanged += 1;
			installedRoutes.push(action.route);
			continue;
		}
		if (action.existing !== undefined) {
			const file = action.source.file;
			wfs.writeFileSync(
				join(dirname(action.targetPath), `${file}.litcodex-bak.${timestamp}.${process.pid}`),
				action.existing,
			);
		}
		wfs.writeFileSync(action.targetPath, action.output);
		installed += 1;
		installedRoutes.push(parseAgentRoute(action.source.file, action.output));
	}
	return {
		kind: step.kind,
		status: "ok",
		detail: `${installed} agent role(s) installed, ${unchanged} unchanged, ${preserved} preserved`,
		agentRoutes: installedRoutes,
	};
}

function assertSafeAgentPath(wfs: WritableFsLike, path: string, directory: boolean): void {
	if (wfs.lstatSync === undefined) return;
	let stat: ReturnType<NonNullable<WritableFsLike["lstatSync"]>>;
	try {
		stat = wfs.lstatSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT") return;
		throw missingAgents({
			path,
			reason: "could not inspect target identity",
			cause: error instanceof Error ? error.message : String(error),
		});
	}
	if (stat.isSymbolicLink()) {
		throw missingAgents({ path, reason: "refusing to follow a symlink during agent installation" });
	}
	if (directory && !stat.isDirectory()) {
		throw missingAgents({ path, reason: "agent target is not a directory" });
	}
	if (!directory && stat.isDirectory()) {
		throw missingAgents({ path, reason: "agent target is a directory" });
	}
}

interface AgentInstallAction {
	readonly source: AgentSource;
	readonly targetPath: string;
	readonly route: AgentRoute;
	readonly kind: "install" | "unchanged" | "preserve" | "rewrite";
	readonly output: string;
	readonly existing?: string;
}

function parseExistingRoute(file: string, content: string): AgentRoute {
	try {
		const route = parseAgentRoute(file, content);
		const unsafe = unsafeEffectiveRoute({ model: route.model, model_reasoning_effort: route.effort });
		if (unsafe !== null) {
			throw new InstallError("LITCODEX_INSTALL_UNSAFE_MODEL_ROUTE", `Existing agent role is invalid: ${unsafe}.`, {
				file,
				model: route.model,
				effort: route.effort,
			});
		}
		return route;
	} catch (error) {
		if (error instanceof InstallError) throw error;
		throw new InstallError(
			"LITCODEX_INSTALL_AGENTS_MISSING",
			`Existing agent role ${file} is malformed; refusing to overwrite it.`,
			{
				file,
				cause: error instanceof Error ? error.message : String(error),
			},
		);
	}
}

export function prepareAgentSources(deps: AgentInstallDeps): PreparedAgentSources {
	const wfs = deps.writeFs ?? NODE_FS;
	const sourceDir = deps.agentsSourceDir ?? join(resolveLitLoopDir(deps.repoRoot), "agents");
	if (!wfs.existsSync(sourceDir)) {
		throw missingAgents({ sourceDir });
	}
	const tomlFiles = wfs
		.readdirSync(sourceDir)
		.filter((file) => file.endsWith(".toml"))
		.sort();
	if (tomlFiles.length === 0) {
		throw missingAgents({ sourceDir });
	}
	const rewriteAlias = deps.authMode === "chatgpt";
	const sources = tomlFiles.map((file) => {
		let content = wfs.readFileSync(join(sourceDir, file), "utf8");
		if (rewriteAlias) {
			content = rewriteAgentRouteModel(content, GPT56_MODELS.sol, EXPLICIT_GPT56_SOL_MODEL);
		}
		if (file === "litcodex-default.toml" && deps.subagentModel !== undefined) {
			const effort = deps.subagentEffort ?? "max";
			const unsafe = unsafeEffectiveRoute({ model: deps.subagentModel, model_reasoning_effort: effort });
			if (unsafe !== null) {
				throw new InstallError(
					"LITCODEX_INSTALL_UNSAFE_MODEL_ROUTE",
					`Selected helper route is invalid: ${unsafe}.`,
					{
						model: deps.subagentModel,
						effort,
					},
				);
			}
			content = rewriteAgentRouteHeader(content, { model: deps.subagentModel, effort });
		}
		return { file, content };
	});
	const agentRoutes = sources.map((source) => parseAgentRoute(source.file, source.content));
	for (const route of agentRoutes) {
		const issue = agentRouteIssue(route);
		if (issue !== null) {
			throw new InstallError("LITCODEX_INSTALL_UNSAFE_MODEL_ROUTE", `Bundled agent route is invalid: ${issue}.`, {
				file: route.file,
				model: route.model,
				effort: route.effort,
			});
		}
	}
	return { sources, agentRoutes };
}

function resolveLitLoopDir(repoRoot: string): string {
	for (const anchor of [import.meta.url, `${repoRoot}/package.json`]) {
		try {
			return dirname(createRequire(anchor).resolve("@litcodex/lit-loop/package.json"));
		} catch (error) {
			if (!(error instanceof Error)) {
				throw error;
			}
			// Try the next package anchor.
		}
	}
	throw missingAgents({ repoRoot });
}

function missingAgents(details: Readonly<Record<string, unknown>>): InstallError {
	return new InstallError("LITCODEX_INSTALL_AGENTS_MISSING", "Bundled litwork agent roles are missing.", details);
}
