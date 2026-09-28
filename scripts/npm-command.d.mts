export function resolveNpmCommand(platform?: NodeJS.Platform): "npm" | "npm.cmd";

export function resolveNpmInvocation(
	args: readonly string[],
	options?: {
		readonly platform?: NodeJS.Platform;
		readonly npmExecPath?: string | undefined;
		readonly nodePath?: string;
	},
): { readonly command: string; readonly args: readonly string[] };
