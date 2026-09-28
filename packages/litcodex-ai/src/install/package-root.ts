import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { materializeDevelopmentMarketplace } from "./development-marketplace.js";

export interface MarketplaceSource {
	readonly root: string;
	readonly disposable: boolean;
	readonly cleanup: () => void;
}

export interface MarketplaceSourceOptions {
	readonly packageRoot?: string;
	readonly tempParent?: string;
}

/** Package root in source and compiled installs; deliberately independent of process.cwd(). */
export function resolvePackageRoot(): string {
	return fileURLToPath(new URL("../../", import.meta.url));
}

export function resolveBundledMarketplaceRoot(): string {
	return fileURLToPath(new URL("../../marketplace/", import.meta.url));
}

export function resolveBundledMarketplaceSource(opts: MarketplaceSourceOptions = {}): MarketplaceSource {
	const packageRoot = opts.packageRoot ?? resolvePackageRoot();
	const bundledRoot = join(packageRoot, "marketplace");
	if (existsSync(join(bundledRoot, "plugins/litcodex/.codex-plugin/plugin.json"))) {
		return { root: bundledRoot, disposable: false, cleanup: keepMarketplace };
	}
	const developmentSource = materializeDevelopmentMarketplace(packageRoot, opts.tempParent);
	if (developmentSource !== null) return { ...developmentSource, disposable: true };
	return { root: bundledRoot, disposable: false, cleanup: keepMarketplace };
}

function keepMarketplace(): void {
	// Package-bundled payloads live for the process lifetime and require no cleanup.
}
