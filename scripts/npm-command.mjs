// Resolve npm's platform shim without relying on a POSIX-only executable name.
// When npm exposes its own entry point, invoke that exact script through Node so a Windows
// npm.cmd shim (or a PATH mismatch) cannot change which npm runs the child process.

export function resolveNpmCommand(platform = process.platform) {
	return platform === "win32" ? "npm.cmd" : "npm";
}

export function resolveNpmInvocation(args, options = {}) {
	const platform = options.platform ?? process.platform;
	const npmExecPath = Object.hasOwn(options, "npmExecPath") ? options.npmExecPath : process.env.npm_execpath;
	const nodePath = options.nodePath ?? process.execPath;
	const exactNpm = typeof npmExecPath === "string" ? npmExecPath.trim() : "";
	if (exactNpm !== "") return { command: nodePath, args: [exactNpm, ...args] };
	return { command: resolveNpmCommand(platform), args: [...args] };
}
