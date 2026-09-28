// tools/release/check-version-lockstep.test.ts — M17 version + lockstep guard suite (Vitest).
//
// RED -> GREEN gate for the lockstep contract (plan T22). Proves the guard accepts the aligned
// repo, catches every manifest drift, rejects unstable VERSION strings, skips absent optional
// manifests, fails closed on a missing required manifest, and errors (exit 2) on an unreadable one.
// Evidence under .litcodex/evidence/.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { checkVersionLockstep, ReleaseMetadataError } from "./check-version-lockstep.ts";
import { isStableSemver, parseSemver, VERSION, VERSIONED_MANIFESTS } from "./version.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../");
const EVIDENCE_DIR = join(REPO_ROOT, ".litcodex", "evidence");
const CLI = join(REPO_ROOT, ".litcodex", "runtime", "release-tools", "check-version-lockstep.js");

function escapedVersion(): string {
	return VERSION.replace(/\./g, "\\.");
}

function writeEvidence(name: string, body: string): void {
	mkdirSync(EVIDENCE_DIR, { recursive: true });
	writeFileSync(join(EVIDENCE_DIR, name), body.endsWith("\n") ? body : `${body}\n`);
}

const tmpRoots: string[] = [];

/** Build a minimal sandbox repo whose required manifests all carry VERSION (no node_modules). */
function makeAlignedRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "lc-lockstep-"));
	tmpRoots.push(root);
	const writeJson = (rel: string, obj: unknown): void => {
		const abs = join(root, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, `${JSON.stringify(obj, null, "\t")}\n`);
	};
	const writeText = (rel: string, text: string): void => {
		const abs = join(root, rel);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, text);
	};
	writeJson("package.json", { name: "litcodex", version: VERSION, private: true });
	writeJson("packages/litcodex-ai/package.json", {
		name: "@litfamily/litcodex",
		version: VERSION,
		dependencies: { "@litcodex/lit-loop": VERSION },
	});
	writeJson("plugins/litcodex/package.json", { name: "@litcodex/plugin", version: VERSION });
	writeJson("plugins/litcodex/components/lit-loop/package.json", { name: "@litcodex/lit-loop", version: VERSION });
	for (const dir of [
		"git-bash",
		"comment-checker",
		"lsp",
		"start-work-continuation",
		"telemetry",
		"rules",
		"auto-update",
		"wikify-knowledge",
	]) {
		writeJson(`plugins/litcodex/components/${dir}/package.json`, { name: `@litcodex/${dir}`, version: VERSION });
	}
	writeJson("package-lock.json", {
		name: "litcodex",
		version: VERSION,
		lockfileVersion: 3,
		packages: {
			"": { name: "litcodex", version: VERSION },
			"packages/litcodex-ai": { dependencies: { "@litcodex/lit-loop": VERSION } },
		},
	});
	writeJson("plugins/litcodex/.codex-plugin/plugin.json", { name: "litcodex", version: VERSION });
	writeText(
		"docs/spec/litcodex-contract.md",
		`| Installer npm package | \`@litfamily/litcodex\`, version \`${VERSION}\`, \`type: module\` |\n| Version (all \`package.json\`) | \`${VERSION}\` |\n`,
	);
	writeText(
		"packages/litcodex-ai/src/cli.test.ts",
		[
			`it("--version is the pinned ${VERSION}", () => {`,
			`expect(manifest.version).toBe("${VERSION}");`,
			`expect(dispatch(["--version"]).stdout).toBe("${VERSION}\\n");`,
		].join("\n"),
	);
	writeText(
		"packages/litcodex-ai/src/install/install-doctor.test.ts",
		`doctorDeps(\n\tundefined,\n\t\t\t\t"${VERSION}"\n);\n`,
	);
	writeText(
		"packages/litcodex-ai/test/install-doctor-fixtures.ts",
		`export function doctorDeps(pluginVersion = "${VERSION}") {}\n`,
	);
	writeText(
		"plugins/litcodex/marketplace.test.ts",
		[
			`JSON.stringify({ name: "@litcodex/plugin", version: "${VERSION}", private: true });`,
			`expect(md.pluginVersion).toBe("${VERSION}");`,
			`expect(agg.version).toBe("${VERSION}");`,
			`expect(err.detail).toContain("${VERSION}");`,
		].join("\n"),
	);
	mkdirSync(join(root, ".litcodex", "evidence"), { recursive: true });
	writeFileSync(
		join(root, "CHANGELOG.md"),
		`# Changelog\n\n## [Unreleased]\n\n## [${VERSION}] - 2026-06-13\n\n### Added\n- init\n`,
	);
	return root;
}

function patchJson(root: string, rel: string, mutate: (o: Record<string, unknown>) => void): void {
	const abs = join(root, rel);
	const obj = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
	mutate(obj);
	writeFileSync(abs, `${JSON.stringify(obj, null, "\t")}\n`);
}

function patchText(root: string, rel: string, before: string, after: string): void {
	const abs = join(root, rel);
	const text = readFileSync(abs, "utf8");
	if (!text.includes(before)) throw new Error(`text anchor missing in ${rel}: ${before}`);
	writeFileSync(abs, text.replace(before, after));
}

function runCli(root: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync("node", [CLI, ...args], { cwd: root, encoding: "utf8" });
		return { status: 0, stdout, stderr: "" };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
	}
}

afterAll(() => {
	for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("#given a version string #when validated #then only clean MAJOR.MINOR.PATCH passes", () => {
	it("isStableSemver rejects v-prefix/prerelease/empty/whitespace", () => {
		const rows = {
			"0.1.0": true,
			"v0.1.0": false,
			"0.1.0-rc.1": false,
			"": false,
			"0.1.0 ": false,
			"01.2.3": false,
		};
		for (const [value, want] of Object.entries(rows)) expect(isStableSemver(value)).toBe(want);
		expect(isStableSemver(VERSION)).toBe(true);
		writeEvidence("task-22-semver.txt", `isStableSemver rows: ${JSON.stringify(rows)} VERSION=${VERSION}\n`);
	});

	it("parseSemver returns components or null", () => {
		expect(parseSemver("1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: null, build: null });
		expect(parseSemver("x")).toBeNull();
		expect(parseSemver("0.1.0-rc.1")?.prerelease).toBe("rc.1");
	});
});

describe("#given the real repo #when the lockstep guard runs #then every manifest equals VERSION", () => {
	it("lockstep accepts aligned repo", () => {
		const report = checkVersionLockstep(REPO_ROOT);
		expect(report.ok).toBe(true);
		expect(report.version).toBe(VERSION);
		expect(report.mismatches).toEqual([]);
		expect(report.checked).toBeGreaterThanOrEqual(4);
		writeEvidence("task-22-version-lockstep.json", `${JSON.stringify(report)}\n`);
	});

	it("CLI exits 0 with the OK line on the aligned repo", () => {
		const r = runCli(REPO_ROOT);
		expect(r.status).toBe(0);
		expect(r.stdout).toMatch(new RegExp(`version-lockstep: OK \\(\\d+ manifests aligned at ${escapedVersion()}\\)`));
	});

	it("the frozen fixture mirrors VERSIONED_MANIFESTS byte-for-byte", () => {
		const fixture = JSON.parse(readFileSync(join(HERE, "versioned-manifests.json"), "utf8")) as unknown[];
		const registry = VERSIONED_MANIFESTS.map((m) => ({
			path: m.path,
			kind: m.kind,
			locator: m.locator,
			label: m.label,
			optional: m.optional,
		}));
		expect(fixture).toEqual(registry);
	});
});

describe("#given a drifted manifest #when the guard runs #then it reports VERSION_MISMATCH", () => {
	it.each([
		"canonical contract installer version",
		"canonical contract shared version",
	])("lockstep catches stale %s", (label) => {
		const root = makeAlignedRepo();
		const path = join(root, "docs/spec/litcodex-contract.md");
		const row = label.includes("installer") ? "| Installer npm package |" : "| Version (all";
		const text = readFileSync(path, "utf8")
			.split("\n")
			.map((line) => (line.startsWith(row) ? line.replace(VERSION, "0.1.0") : line))
			.join("\n");
		writeFileSync(path, text);
		const report = checkVersionLockstep(root);
		expect(report.mismatches.some((m) => m.label === label && m.code === "VERSION_MISMATCH")).toBe(true);
	});

	it("lockstep catches installer drift", () => {
		const root = makeAlignedRepo();
		patchJson(root, "packages/litcodex-ai/package.json", (o) => {
			o["version"] = "0.0.9";
		});
		const report = checkVersionLockstep(root);
		expect(report.ok).toBe(false);
		const m = report.mismatches.find((x) => x.label === "installer package");
		expect(m?.code).toBe("VERSION_MISMATCH");
		expect(m?.found).toBe("0.0.9");
	});

	it("lockstep catches root manifest drift", () => {
		const root = makeAlignedRepo();
		patchJson(root, "package.json", (o) => {
			o["version"] = "0.0.9";
		});
		const report = checkVersionLockstep(root);
		expect(report.mismatches.some((x) => x.label === "root manifest" && x.code === "VERSION_MISMATCH")).toBe(true);
	});

	it("lockstep catches lockfile root and packages[''] drift", () => {
		const root = makeAlignedRepo();
		patchJson(root, "package-lock.json", (o) => {
			o["version"] = "0.0.9";
			const packages = o["packages"] as Record<string, Record<string, unknown>>;
			packages[""] = { ...packages[""], version: "9.9.9" };
		});
		const report = checkVersionLockstep(root);
		expect(report.mismatches.some((x) => x.label === "lockfile root")).toBe(true);
		expect(report.mismatches.some((x) => x.label === 'lockfile packages[""]')).toBe(true);
	});

	it("lockstep catches changelog drift", () => {
		const root = makeAlignedRepo();
		writeFileSync(join(root, "CHANGELOG.md"), `# Changelog\n\n## [Unreleased]\n\n## [0.0.1] - 2026-06-13\n`);
		const report = checkVersionLockstep(root);
		const m = report.mismatches.find((x) => x.label === "changelog top release");
		expect(m?.code).toBe("VERSION_MISMATCH");
		expect(m?.found).toBe("0.0.1");
		const cli = runCli(root, ["--json"]);
		writeEvidence(
			"task-22-lockstep-drift.txt",
			`installer/root/lockfile/changelog drift detected\nchangelog cli exit=${cli.status}\n`,
		);
	});

	it("CLI exits 1 and prints MISMATCH lines on drift", () => {
		const root = makeAlignedRepo();
		patchJson(root, "package.json", (o) => {
			o["version"] = "0.0.9";
		});
		const r = runCli(root);
		expect(r.status).toBe(1);
		expect(r.stdout).toMatch(
			new RegExp(`MISMATCH package\\.json \\(root manifest\\): expected ${escapedVersion()}, found 0\\.0\\.9`),
		);
	});
});

describe("#given a workspace pin or version fixture #when drifted #then the guard names the exact site", () => {
	const driftCases = [
		{
			name: "installer workspace dependency",
			path: "packages/litcodex-ai/package.json",
			mutate: (root: string) =>
				patchJson(root, "packages/litcodex-ai/package.json", (o) => {
					(o["dependencies"] as Record<string, unknown>)["@litcodex/lit-loop"] = "9.9.9";
				}),
		},
		{
			name: "lockfile installer workspace dependency",
			path: "package-lock.json",
			mutate: (root: string) =>
				patchJson(root, "package-lock.json", (o) => {
					(
						(o["packages"] as Record<string, Record<string, unknown>>)["packages/litcodex-ai"][
							"dependencies"
						] as Record<string, unknown>
					)["@litcodex/lit-loop"] = "9.9.9";
				}),
		},
		{
			name: "CLI pinned-version fixture label",
			path: "packages/litcodex-ai/src/cli.test.ts",
			mutate: (root: string) =>
				patchText(root, "packages/litcodex-ai/src/cli.test.ts", `the pinned ${VERSION}`, "the pinned 9.9.9"),
		},
		{
			name: "CLI manifest-version fixture",
			path: "packages/litcodex-ai/src/cli.test.ts",
			mutate: (root: string) =>
				patchText(
					root,
					"packages/litcodex-ai/src/cli.test.ts",
					`manifest.version).toBe("${VERSION}")`,
					'manifest.version).toBe("9.9.9")',
				),
		},
		{
			name: "CLI stdout-version fixture",
			path: "packages/litcodex-ai/src/cli.test.ts",
			mutate: (root: string) =>
				patchText(
					root,
					"packages/litcodex-ai/src/cli.test.ts",
					`dispatch(["--version"]).stdout).toBe("${VERSION}\\n`,
					'dispatch(["--version"]).stdout).toBe("9.9.9\\n',
				),
		},
		{
			name: "install doctor plugin-version fixture",
			path: "packages/litcodex-ai/src/install/install-doctor.test.ts",
			mutate: (root: string) =>
				patchText(root, "packages/litcodex-ai/src/install/install-doctor.test.ts", `"${VERSION}"`, '"9.9.9"'),
		},
		{
			name: "install doctor default plugin version",
			path: "packages/litcodex-ai/test/install-doctor-fixtures.ts",
			mutate: (root: string) =>
				patchText(
					root,
					"packages/litcodex-ai/test/install-doctor-fixtures.ts",
					`pluginVersion = "${VERSION}"`,
					'pluginVersion = "9.9.9"',
				),
		},
		{
			name: "marketplace staged package version",
			path: "plugins/litcodex/marketplace.test.ts",
			mutate: (root: string) =>
				patchText(root, "plugins/litcodex/marketplace.test.ts", `version: "${VERSION}"`, 'version: "9.9.9"'),
		},
		{
			name: "marketplace plugin-version fixture",
			path: "plugins/litcodex/marketplace.test.ts",
			mutate: (root: string) =>
				patchText(
					root,
					"plugins/litcodex/marketplace.test.ts",
					`md.pluginVersion).toBe("${VERSION}")`,
					'md.pluginVersion).toBe("9.9.9")',
				),
		},
		{
			name: "marketplace aggregate-version fixture",
			path: "plugins/litcodex/marketplace.test.ts",
			mutate: (root: string) =>
				patchText(
					root,
					"plugins/litcodex/marketplace.test.ts",
					`agg.version).toBe("${VERSION}")`,
					'agg.version).toBe("9.9.9")',
				),
		},
		{
			name: "marketplace mismatch-version fixture",
			path: "plugins/litcodex/marketplace.test.ts",
			mutate: (root: string) =>
				patchText(
					root,
					"plugins/litcodex/marketplace.test.ts",
					`err.detail).toContain("${VERSION}")`,
					'err.detail).toContain("9.9.9")',
				),
		},
	] as const;

	it.each(driftCases)("catches $name", ({ path, name, mutate }) => {
		const root = makeAlignedRepo();
		mutate(root);
		const report = checkVersionLockstep(root);
		expect(report.ok).toBe(false);
		expect(report.mismatches).toContainEqual(
			expect.objectContaining({ code: "VERSION_MISMATCH", path, label: name, found: "9.9.9" }),
		);
	});
});

describe("#given an optional manifest #when absent or present #then absence is skipped, presence is checked", () => {
	it("lockstep skips absent optional workflow manifest", () => {
		const root = makeAlignedRepo();
		const report = checkVersionLockstep(root);
		expect(report.ok).toBe(true);
		expect(report.skipped).toContain(".github/workflows/release.yml");
		writeEvidence("task-22-lockstep-optional.txt", `skipped: ${JSON.stringify(report.skipped)}\n`);
	});

	it("lockstep checks present optional manifest and catches its drift", () => {
		const root = makeAlignedRepo();
		const wf = join(root, ".github", "workflows", "release.yml");
		mkdirSync(dirname(wf), { recursive: true });
		writeFileSync(
			wf,
			`on: workflow_dispatch\njobs:\n  release:\n    inputs:\n      version:\n        default: "0.0.1"\n`,
		);
		const report = checkVersionLockstep(root);
		expect(report.ok).toBe(false);
		expect(
			report.mismatches.some((x) => x.label === "publish workflow default" && x.code === "VERSION_MISMATCH"),
		).toBe(true);
	});
});

describe("#given a missing or unreadable required manifest #when the guard runs #then it fails closed honestly", () => {
	it("lockstep fails closed on a missing required manifest (exit 1, never vacuously 0)", () => {
		const root = makeAlignedRepo();
		rmSync(join(root, "CHANGELOG.md"));
		const report = checkVersionLockstep(root);
		expect(report.ok).toBe(false);
		expect(report.mismatches.some((x) => x.label === "changelog top release" && x.code === "VERSION_MISSING")).toBe(
			true,
		);
	});

	it("lockstep hints on a missing lockfile pointer", () => {
		const root = makeAlignedRepo();
		patchJson(root, "package-lock.json", (o) => {
			delete (o["packages"] as Record<string, unknown>)[""];
		});
		const report = checkVersionLockstep(root);
		const m = report.mismatches.find((x) => x.label === 'lockfile packages[""]');
		expect(m?.code).toBe("VERSION_MISSING");
		expect(m?.hint && m.hint.length > 0).toBe(true);
		writeEvidence("task-22-lockstep-lockfile.txt", `hint: ${m?.hint ?? ""}\n`);
	});

	it("lockstep errors (exit 2) on an unreadable required manifest", () => {
		const root = makeAlignedRepo();
		writeFileSync(join(root, "packages/litcodex-ai/package.json"), "{broken");
		expect(() => checkVersionLockstep(root)).toThrow(ReleaseMetadataError);
		try {
			checkVersionLockstep(root);
		} catch (err) {
			expect((err as ReleaseMetadataError).code).toBe("RELEASE_MANIFEST_UNREADABLE");
		}
		const r = runCli(root);
		expect(r.status).toBe(2);
		expect(r.stderr).toMatch(/\[release\] RELEASE_MANIFEST_UNREADABLE/);
		writeEvidence("task-22-lockstep-unreadable.txt", `exit=${r.status} stderr=${r.stderr.trim()}\n`);
	});
});

describe("#given concurrent guard runs #when both execute #then they are pure and identical", () => {
	it("lockstep is pure and concurrency-safe", () => {
		const a = checkVersionLockstep(REPO_ROOT);
		const b = checkVersionLockstep(REPO_ROOT);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		writeEvidence(
			"task-22-lockstep-concurrent.txt",
			`two runs byte-identical: ${JSON.stringify(a) === JSON.stringify(b)}\n`,
		);
	});
});

describe("#given a fresh npm install #when the lockfile materializes #then both pointers carry VERSION", () => {
	it("lockstep accepts the freshly installed real lockfile pointers", () => {
		const lf = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8")) as {
			version?: string;
			packages?: Record<string, { version?: string }>;
		};
		expect(lf.version).toBe(VERSION);
		expect(lf.packages?.[""]?.version).toBe(VERSION);
		writeEvidence(
			"task-22-lockstep-fresh-install.txt",
			`lockfile /version=${lf.version} /packages[""]/version=${lf.packages?.[""]?.version}\n`,
		);
	});
});
