import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';

export function supportsAgentBrowserVersion(output) {
	const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?(?:\s|$)/u.exec(output.trim());
	if (!match || match[4] !== undefined) return false;
	const actual = match.slice(1, 4).map(Number);
	const minimum = [0, 38, 1];
	for (let index = 0; index < minimum.length; index += 1) {
		const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return true;
}

/**
 * How to spawn a user-installed CLI without a shell. On Windows npm installs agent-browser as a
 * .cmd shim, which Node refuses to spawn without a shell (CVE-2024-27980), so the shim is unwrapped
 * to the script or binary it launches; no argument ever passes through cmd.exe.
 */
export function shellFreeCommand(name, args, { env = process.env, platform = process.platform, exists = existsSync, read = (file) => readFileSync(file, 'utf8') } = {}) {
	if (platform !== 'win32') return { command: name, args };
	const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
	const found = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean).flatMap((dir) => extensions.map((ext) => win32.join(dir, name + ext))).find((file) => exists(file));
	if (!found) return { command: name, args };
	if (!/\.(?:cmd|bat)$/iu.test(found)) return { command: found, args };
	const target = [...read(found).matchAll(/"%~?dp0%?\\([^"\r\n]+)"\s+%\*/gu)].at(-1)?.[1];
	if (!target) throw new Error(`${found} is not an npm shim; it cannot be run without a shell`);
	const resolved = win32.join(win32.dirname(found), target);
	return /\.[cm]?js$/iu.test(resolved) ? { command: process.execPath, args: [resolved, ...args] } : { command: resolved, args };
}

/** The shell-free command that runs agent-browser with these arguments. */
export function agentBrowser(args) {
	return shellFreeCommand('agent-browser', args);
}
