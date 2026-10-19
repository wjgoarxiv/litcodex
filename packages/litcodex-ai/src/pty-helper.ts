// node-pty 1.1.0 ships its macOS `spawn-helper` prebuild without the execute bit, so every pseudo-terminal
// then fails with `posix_spawnp failed`. `litcodex run` needs it, so the postinstall step (for the copy
// under this package's own node_modules) and the command itself (for the copy it loads, again only under this
// package's own node_modules) set it.
// A helper built from source, another platform, or a missing package is left alone.

import { accessSync, chmodSync, constants, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Makes `<root>/prebuilds/<platform>-<arch>/spawn-helper` executable when it is not. With `within`, only a
 * `root` under `<within>/node_modules/` is touched; a node-pty found anywhere else belongs to someone else.
 * Returns null when the helper is fine, absent, not needed or not ours, else the path of a helper that
 * stays not executable.
 */
export function ensurePtyHelperExecutable(
	root: string,
	platform: NodeJS.Platform = process.platform,
	within?: string,
): string | null {
	if (platform !== "darwin") return null;
	if (within !== undefined && !resolve(root).startsWith(`${join(resolve(within), "node_modules")}${sep}`)) return null;
	const helper = join(root, "prebuilds", `${platform}-${process.arch}`, "spawn-helper");
	let mode: number;
	try {
		const stat = statSync(helper);
		if (!stat.isFile()) return null;
		mode = stat.mode;
	} catch {
		return null;
	}
	try {
		accessSync(helper, constants.X_OK);
		return null;
	} catch {
		// Not executable yet.
	}
	try {
		chmodSync(helper, mode | 0o755);
		accessSync(helper, constants.X_OK);
		return null;
	} catch {
		return helper;
	}
}
