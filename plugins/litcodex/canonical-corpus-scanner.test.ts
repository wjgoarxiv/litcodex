import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { LEGACY_TOKENS, listTrackedFiles, runExternalTermScan, runScan } from "../../tools/scan-legacy-tokens.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const relativeCorpusRoot = "plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus";
const sourceCorpusRoot = join(repoRoot, relativeCorpusRoot);
const sandboxes: string[] = [];

async function scannerModule() {
	const module = await import("../../tools/scan-legacy-tokens.mjs");
	expect(typeof module.loadCanonicalCorpusProtection).toBe("function");
	return module;
}

function scannerRepo() {
	const root = mkdtempSync(join(tmpdir(), "litcodex-scanner-corpus-"));
	sandboxes.push(root);
	mkdirSync(join(root, relativeCorpusRoot, ".."), { recursive: true });
	cpSync(sourceCorpusRoot, join(root, relativeCorpusRoot), { recursive: true, preserveTimestamps: true });
	mkdirSync(join(root, "tools"), { recursive: true });
	const allowlistPath = join(root, "tools/legacy-token-allowlist.json");
	writeFileSync(allowlistPath, '{"version":1,"entries":[]}\n');
	execFileSync("git", ["init", "--quiet"], { cwd: root });
	return { root, allowlistPath };
}

afterEach(() => {
	for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

describe("canonical corpus scanner boundary", () => {
	it("protects only exact manifest-listed content and legal paths after full validation", async () => {
		const module = await scannerModule();
		const protectedPaths = module.loadCanonicalCorpusProtection(repoRoot);
		expect(protectedPaths.size).toBe(171);
		expect(protectedPaths.has(`${relativeCorpusRoot}/design/apple.md`)).toBe(true);
		expect(protectedPaths.has(`${relativeCorpusRoot}/ATTRIBUTION.md`)).toBe(true);
		expect(protectedPaths.has(`${relativeCorpusRoot}/MANIFEST.json`)).toBe(true);
		expect(protectedPaths.has(`${relativeCorpusRoot}/PROVENANCE.md`)).toBe(false);
	});

	it("keeps the exact corpus clean while catching a copied token-bearing file outside its path", async () => {
		await scannerModule();
		const { root, allowlistPath } = scannerRepo();
		expect(runScan({ repoRoot: root, allowlistPath }).ok).toBe(true);
		cpSync(
			join(root, relativeCorpusRoot, `design/${["open", "code.ai.md"].join("")}`),
			join(root, "outside-copy.md"),
		);
		const report = runScan({ repoRoot: root, allowlistPath });
		expect(report.ok).toBe(false);
		expect(report.offenders.some((entry: { path: string }) => entry.path === "outside-copy.md")).toBe(true);
	});

	it("scans an exact protected corpus witness for external terms and reports every tracked text file", {
		timeout: 15_000,
	}, () => {
		const { root } = scannerRepo();
		execFileSync("git", ["add", "-A"], { cwd: root });
		const termsRoot = mkdtempSync(join(tmpdir(), "litcodex-scanner-terms-"));
		sandboxes.push(termsRoot);
		const termsPath = join(termsRoot, "terms.json");
		writeFileSync(
			termsPath,
			JSON.stringify({
				version: 1,
				terms: [{ id: "corpus-witness", value: "Frontend Design References — Index", matchMode: "substring" }],
			}),
		);

		const tracked = listTrackedFiles(root);
		const report = runExternalTermScan({ repoRoot: root, termsPath });

		expect(report.scannedFiles).toBe(tracked.length);
		expect(report.offenders).toContainEqual(
			expect.objectContaining({
				path: `${relativeCorpusRoot}/design/_INDEX.md`,
				termId: "corpus-witness",
			}),
		);
	});

	it("documents that only the built-in legacy scan receives exact-hash corpus protection", () => {
		const guide = readFileSync(
			join(repoRoot, "plugins/litcodex/skills/frontend-ui-ux/references/canonical-library.md"),
			"utf8",
		);
		expect(guide).toContain("built-in legacy-token scan");
		expect(guide).toContain("External-term scans inspect every tracked file, including this exact corpus");
	});

	it("fails before protection for modified content and manifest carrier fields", async () => {
		await scannerModule();
		for (const mutate of [
			(root: string) => writeFileSync(join(root, relativeCorpusRoot, "design/apple.md"), LEGACY_TOKENS[6]),
			(root: string) => {
				const path = join(root, relativeCorpusRoot, "MANIFEST.json");
				const manifest = JSON.parse(readFileSync(path, "utf8"));
				manifest.carrier = LEGACY_TOKENS[6];
				writeFileSync(path, `${JSON.stringify(manifest)}\n`);
			},
		]) {
			const { root, allowlistPath } = scannerRepo();
			mutate(root);
			const report = runScan({ repoRoot: root, allowlistPath });
			expect(report.ok).toBe(false);
			expect(
				report.errors.some((entry: { code: string }) => entry.code.startsWith("LITCODEX_CANONICAL_CORPUS_")),
			).toBe(true);
		}
	});

	it("fails closed when an enrolled frontend skill loses its protected corpus root", async () => {
		await scannerModule();
		const root = mkdtempSync(join(tmpdir(), "litcodex-scanner-missing-corpus-"));
		sandboxes.push(root);
		mkdirSync(join(root, "plugins/litcodex/skills/frontend-ui-ux"), { recursive: true });
		writeFileSync(join(root, "plugins/litcodex/skills/frontend-ui-ux/SKILL.md"), "# Frontend\n");
		mkdirSync(join(root, "tools"), { recursive: true });
		const allowlistPath = join(root, "tools/legacy-token-allowlist.json");
		writeFileSync(allowlistPath, '{"version":1,"entries":[]}\n');
		execFileSync("git", ["init", "--quiet"], { cwd: root });

		const report = runScan({ repoRoot: root, allowlistPath });
		expect(report.ok).toBe(false);
		expect(report.errors.some((entry: { code: string }) => entry.code === "LITCODEX_CANONICAL_CORPUS_MISSING")).toBe(
			true,
		);
	});

	it("returns a typed no-throw report when canonical verifier filesystem resolution races", () => {
		const { root, allowlistPath } = scannerRepo();
		const corpusRoot = join(root, relativeCorpusRoot);
		const report = runScan({
			repoRoot: root,
			allowlistPath,
			canonicalFs: {
				...nodeFs,
				realpathSync: (path: nodeFs.PathLike) => {
					if (path === corpusRoot) throw Object.assign(new Error("root disappeared"), { code: "ENOENT" });
					return nodeFs.realpathSync(path);
				},
			},
		});
		expect(report.ok).toBe(false);
		expect(report.errors).toContainEqual(expect.objectContaining({ code: "LITCODEX_CANONICAL_CORPUS_UNREADABLE" }));
	});

	it.each([
		[
			"final file",
			(root: string) => {
				const target = join(root, relativeCorpusRoot, "design/apple.md");
				renameSync(target, `${target}.original`);
				writeFileSync(target, LEGACY_TOKENS[6]);
			},
		],
		[
			"ancestor directory",
			(root: string) => {
				const ancestor = join(root, relativeCorpusRoot, "design");
				const displaced = join(root, relativeCorpusRoot, "design-original");
				renameSync(ancestor, displaced);
				cpSync(displaced, ancestor, { recursive: true, preserveTimestamps: true });
			},
		],
	] as const)("fails closed for %s substitution between canonical capture and scan", (_label, substitute) => {
		const { root, allowlistPath } = scannerRepo();
		let captures = 0;
		const report = runScan({
			repoRoot: root,
			allowlistPath,
			afterCanonicalCapture() {
				captures += 1;
				substitute(root);
			},
		});

		expect(captures).toBe(1);
		expect(report.ok).toBe(false);
		expect(report.errors).toContainEqual(expect.objectContaining({ code: "LITCODEX_CANONICAL_CORPUS_UNSTABLE" }));
	});
});
