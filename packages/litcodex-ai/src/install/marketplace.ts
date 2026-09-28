// M12 / T17 — registration identity constants (S12 §marketplace.ts; A3 Part D).
//
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export const LITCODEX_MARKETPLACE = "litcodex" as const;
export const LITCODEX_PLUGIN = "litcodex" as const;

export function managedMarketplaceRoot(codexHome: string): string {
	return join(codexHome, "marketplaces", LITCODEX_MARKETPLACE);
}

/** Compare paths through host symlinks such as macOS `/tmp` -> `/private/tmp`. */
export function canonicalMarketplacePath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

/** The plugin reference Codex consumes: `<plugin>@<marketplace>`. */
export const LITCODEX_PLUGIN_REF = `${LITCODEX_PLUGIN}@${LITCODEX_MARKETPLACE}` as const;

interface MarketplacePathFs {
	lstatSync?(path: string): { isSymbolicLink(): boolean; isDirectory(): boolean; isFile?(): boolean };
	readFileSync?(path: string, encoding: "utf8"): string;
}

/** A native identity authorizes replacing the generated cache, never following a redirected path. */
export function isSafeManagedMarketplaceRoot(
	codexHome: string,
	fs: MarketplacePathFs = { lstatSync, readFileSync },
): boolean {
	const root = managedMarketplaceRoot(codexHome);
	const inspect = fs.lstatSync ?? lstatSync;
	const read = fs.readFileSync;
	const directory = (path: string): boolean | null => {
		try {
			const stat = inspect(path);
			return !stat.isSymbolicLink() && stat.isDirectory();
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : false;
		}
	};
	for (const path of [codexHome, join(codexHome, "marketplaces"), root]) {
		if (directory(path) === false) return false;
	}
	if (directory(root) === null) return true;
	if (read === undefined) return false;
	try {
		for (const relative of [
			".agents",
			".agents/plugins",
			"plugins",
			"plugins/litcodex",
			"plugins/litcodex/.codex-plugin",
		]) {
			if (directory(join(root, relative)) !== true) return false;
		}
		const readIdentity = (relative: string): Record<string, unknown> => {
			const path = join(root, relative);
			const stat = inspect(path);
			if (stat.isSymbolicLink() || stat.isFile?.() !== true) throw new Error("Unsafe identity file");
			return JSON.parse(read(path, "utf8")) as Record<string, unknown>;
		};
		const marketplace = readIdentity(".agents/plugins/marketplace.json");
		const plugin = readIdentity("plugins/litcodex/.codex-plugin/plugin.json");
		return (
			marketplace?.["name"] === LITCODEX_MARKETPLACE &&
			plugin?.["name"] === LITCODEX_PLUGIN &&
			Array.isArray(marketplace["plugins"]) &&
			marketplace["plugins"].some(
				(entry: unknown) =>
					typeof entry === "object" &&
					entry !== null &&
					(entry as Record<string, unknown>)["name"] === LITCODEX_PLUGIN &&
					(entry as Record<string, unknown>)["source"] === "./plugins/litcodex",
			)
		);
	} catch {
		return false;
	}
}
