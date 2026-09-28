// tools/release/version.ts — M17 single source of truth for the LitCodex release version.
//
// Every version string anywhere in the repo derives from, and is checked against, VERSION.
// The lockstep guard (check-version-lockstep.ts) reads VERSIONED_MANIFESTS and asserts each
// present manifest equals VERSION. Bumping the release is a human edit to this constant plus
// each manifest; the guard then proves they agree. This module never publishes and never reads
// a network or a token.
//
// A3 D3: The executable constant below is the sole release-version literal.

/** The single source of truth. Stable semver, no leading "v", no pre-release for a release cut. */
export const VERSION = "1.0.9";

/** One manifest location whose version MUST equal VERSION. */
export interface VersionedManifest {
	/** Repo-root-relative path. */
	readonly path: string;
	/**
	 * How the version is encoded in this file:
	 *  - "json-pointer": JSON file; `locator` is an RFC6901 pointer (e.g. "/version", "/packages//version").
	 *  - "regex": text file; `locator` is a JS regex source with exactly one capture group = the version.
	 */
	readonly kind: "json-pointer" | "regex";
	readonly locator: string;
	/** Human label used in mismatch reports. */
	readonly label: string;
	/** When true, the manifest may be absent (e.g. a workflow not yet created); absence is OK, presence must match. */
	readonly optional: boolean;
}

/**
 * Frozen registry: every place a version string lives.
 *
 * Order is stable and deterministic — the lockstep report walks this array in order.
 * The `.github/workflows/release.yml` entry is optional: the publish workflow is owned by
 * the CI module (plan T09) and may not exist yet; absence is reported under `skipped`, presence
 * is enforced. The frozen mirror lives in `tools/release/versioned-manifests.json`.
 */
export const VERSIONED_MANIFESTS: readonly VersionedManifest[] = Object.freeze([
	Object.freeze({
		path: "docs/spec/litcodex-contract.md",
		kind: "regex",
		locator: "^\\| Installer npm package \\| `[^`]+`, version `(\\d+\\.\\d+\\.\\d+)`",
		label: "canonical contract installer version",
		optional: false,
	}),
	Object.freeze({
		path: "docs/spec/litcodex-contract.md",
		kind: "regex",
		locator: "^\\| Version \\(all `package\\.json`\\) \\| `(\\d+\\.\\d+\\.\\d+)`",
		label: "canonical contract shared version",
		optional: false,
	}),
	Object.freeze({
		path: "package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "root manifest",
		optional: false,
	}),
	Object.freeze({
		path: "packages/litcodex-ai/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "installer package",
		optional: false,
	}),
	Object.freeze({
		path: "packages/litcodex-ai/package.json",
		kind: "json-pointer",
		locator: "/dependencies/@litcodex~1lit-loop",
		label: "installer workspace dependency",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "aggregate plugin package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/lit-loop/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "lit-loop component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/git-bash/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "git-bash component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/comment-checker/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "comment-checker component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/lsp/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "lsp component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/start-work-continuation/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "start-work-continuation component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/telemetry/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "telemetry component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/rules/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "rules component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/auto-update/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "auto-update component package",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/components/wikify-knowledge/package.json",
		kind: "json-pointer",
		locator: "/version",
		label: "wikify-knowledge component package",
		optional: false,
	}),
	Object.freeze({
		path: "package-lock.json",
		kind: "json-pointer",
		locator: "/version",
		label: "lockfile root",
		optional: false,
	}),
	Object.freeze({
		path: "package-lock.json",
		kind: "json-pointer",
		locator: "/packages//version",
		label: 'lockfile packages[""]',
		optional: false,
	}),
	Object.freeze({
		path: "package-lock.json",
		kind: "json-pointer",
		locator: "/packages/packages~1litcodex-ai/dependencies/@litcodex~1lit-loop",
		label: "lockfile installer workspace dependency",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/.codex-plugin/plugin.json",
		kind: "json-pointer",
		locator: "/version",
		label: "aggregate plugin manifest",
		optional: false,
	}),
	Object.freeze({
		path: "CHANGELOG.md",
		kind: "regex",
		locator: "^## \\[(\\d+\\.\\d+\\.\\d+)\\]",
		label: "changelog top release",
		optional: false,
	}),
	Object.freeze({
		path: "packages/litcodex-ai/src/cli.test.ts",
		kind: "regex",
		locator: 'it\\("--version is the pinned ([0-9]+\\.[0-9]+\\.[0-9]+)"',
		label: "CLI pinned-version fixture label",
		optional: false,
	}),
	Object.freeze({
		path: "packages/litcodex-ai/src/cli.test.ts",
		kind: "regex",
		locator: 'expect\\(manifest\\.version\\)\\.toBe\\("([0-9]+\\.[0-9]+\\.[0-9]+)"',
		label: "CLI manifest-version fixture",
		optional: false,
	}),
	Object.freeze({
		path: "packages/litcodex-ai/src/cli.test.ts",
		kind: "regex",
		locator: 'expect\\(dispatch\\(\\["--version"\\]\\)\\.stdout\\)\\.toBe\\("([0-9]+\\.[0-9]+\\.[0-9]+)',
		label: "CLI stdout-version fixture",
		optional: false,
	}),
	Object.freeze({
		path: "packages/litcodex-ai/src/install/install-doctor.test.ts",
		kind: "regex",
		locator: 'undefined,\\s*"([0-9]+\\.[0-9]+\\.[0-9]+)"',
		label: "install doctor plugin-version fixture",
		optional: false,
	}),
	Object.freeze({
		path: "packages/litcodex-ai/test/install-doctor-fixtures.ts",
		kind: "regex",
		locator: 'pluginVersion\\s*=\\s*"([0-9]+\\.[0-9]+\\.[0-9]+)"',
		label: "install doctor default plugin version",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/marketplace.test.ts",
		kind: "regex",
		locator: 'JSON\\.stringify\\(\\{ name: "@litcodex/plugin", version: "([0-9]+\\.[0-9]+\\.[0-9]+)", private: true',
		label: "marketplace staged package version",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/marketplace.test.ts",
		kind: "regex",
		locator: 'expect\\(md\\.pluginVersion\\)\\.toBe\\("([0-9]+\\.[0-9]+\\.[0-9]+)"',
		label: "marketplace plugin-version fixture",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/marketplace.test.ts",
		kind: "regex",
		locator: 'expect\\(agg\\.version\\)\\.toBe\\("([0-9]+\\.[0-9]+\\.[0-9]+)"',
		label: "marketplace aggregate-version fixture",
		optional: false,
	}),
	Object.freeze({
		path: "plugins/litcodex/marketplace.test.ts",
		kind: "regex",
		locator: 'expect\\(err\\.detail\\)\\.toContain\\("([0-9]+\\.[0-9]+\\.[0-9]+)"',
		label: "marketplace mismatch-version fixture",
		optional: false,
	}),
	Object.freeze({
		path: ".github/workflows/release.yml",
		kind: "regex",
		locator: 'default:\\s*"(\\d+\\.\\d+\\.\\d+)"',
		label: "publish workflow default",
		optional: true,
	}),
]);

/** Parsed semver components; null if not strictly "MAJOR.MINOR.PATCH[-pre][+build]". */
export function parseSemver(value: string): {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly prerelease: string | null;
	readonly build: string | null;
} | null {
	if (typeof value !== "string") return null;
	// No leading "v", no surrounding whitespace coercion — exact match only.
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
			value,
		);
	if (match === null) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ?? null,
		build: match[5] ?? null,
	};
}

/** True only for a clean MAJOR.MINOR.PATCH with no pre-release, no build, and no leading "v". */
export function isStableSemver(value: string): boolean {
	const parsed = parseSemver(value);
	return parsed !== null && parsed.prerelease === null && parsed.build === null;
}
