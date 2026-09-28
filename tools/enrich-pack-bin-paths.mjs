import { resolve } from "node:path";

import { readWorkspaceBinDeclarations } from "../scripts/mark-cli-executable.mjs";

export class PackBinEnrichmentError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "PackBinEnrichmentError";
		this.code = code;
		this.details = details;
	}
}

function normalizePackPath(path) {
	let normalized = String(path).replaceAll("\\", "/");
	while (normalized.startsWith("./")) normalized = normalized.slice(2);
	return normalized.replaceAll("/./", "/");
}

export function loadPackBinContext(repoRoot) {
	const declarations = readWorkspaceBinDeclarations(repoRoot);
	const byName = new Map();
	const byWorkspaceRoot = new Map();
	for (const declaration of declarations) {
		if (byName.has(declaration.name)) {
			throw new PackBinEnrichmentError(
				"LITCODEX_PACK_WORKSPACE_NAME_DUPLICATE",
				`workspace package name is duplicated: ${declaration.name}`,
				{ name: declaration.name },
			);
		}
		byName.set(declaration.name, declaration);
		byWorkspaceRoot.set(declaration.workspaceRoot, declaration);
	}
	return { repoRoot: resolve(repoRoot), declarations, byName, byWorkspaceRoot };
}

export function enrichPackResultsWithWorkspaceBins(results, context) {
	return results.map((result) => {
		const owner = context.byName.get(result.name);
		if (!owner) return { ...result, binPaths: [] };

		const binPaths = new Set(owner.binPaths);
		const packedPaths = result.files.map((file) => normalizePackPath(file.path));
		for (const declaration of context.declarations) {
			const marketplacePrefix = `marketplace/${declaration.workspacePath}/`;
			if (!packedPaths.some((path) => path.startsWith(marketplacePrefix))) continue;
			for (const binPath of declaration.binPaths) binPaths.add(`${marketplacePrefix}${binPath}`);
		}
		for (const dependencyName of owner.bundledDependencies) {
			const dependency = context.byName.get(dependencyName);
			if (!dependency) continue;
			for (const binPath of dependency.binPaths) {
				binPaths.add(`node_modules/${dependency.name}/${binPath}`);
			}
		}
		return { ...result, binPaths: [...binPaths] };
	});
}

export function enrichPackResultsFromRepo(results, repoRoot) {
	return enrichPackResultsWithWorkspaceBins(results, loadPackBinContext(repoRoot));
}
