const TESTED_CODEX_VERSIONS = ["0.144.0", "0.144.1"] as const;
const MINIMUM_SUPPORTED = { major: 0, minor: 144, patch: 0 } as const;
const VERSION_PATTERN = /^[ \t]*codex-cli[ \t]+(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?=\s|$)/u;

export type CodexVersionSupport =
	| { readonly kind: "tested"; readonly version: string }
	| { readonly kind: "newer-stable"; readonly version: string }
	| { readonly kind: "too-old"; readonly version: string }
	| { readonly kind: "prerelease"; readonly version: string }
	| { readonly kind: "unrecognized"; readonly version: null };

export function classifyCodexVersion(stdout: string | undefined, stderr?: string): CodexVersionSupport {
	const match = findVersion(stdout) ?? findVersion(stderr);
	const major = numberPart(match?.[1]);
	const minor = numberPart(match?.[2]);
	const patch = numberPart(match?.[3]);
	if (match === undefined || match === null || major === null || minor === null || patch === null) {
		return { kind: "unrecognized", version: null };
	}
	const version = `${major}.${minor}.${patch}${match[4] ?? ""}`;
	if (match[4] !== undefined) return { kind: "prerelease", version };
	if (TESTED_CODEX_VERSIONS.some((candidate) => candidate === version)) {
		return { kind: "tested", version };
	}
	return compareVersion({ major, minor, patch }, MINIMUM_SUPPORTED) < 0
		? { kind: "too-old", version }
		: { kind: "newer-stable", version };
}

function findVersion(output: string | undefined): RegExpMatchArray | null {
	return output?.match(VERSION_PATTERN) ?? null;
}

function numberPart(value: string | undefined): number | null {
	if (value === undefined) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function compareVersion(
	left: { readonly major: number; readonly minor: number; readonly patch: number },
	right: { readonly major: number; readonly minor: number; readonly patch: number },
): number {
	if (left.major !== right.major) return left.major - right.major;
	if (left.minor !== right.minor) return left.minor - right.minor;
	return left.patch - right.patch;
}
