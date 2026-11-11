import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const probeUrl = new URL("../../../../scripts/run-uiux-installed-probe.mjs", import.meta.url);
const probePath = fileURLToPath(probeUrl);
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const evidencePath = join(repoRoot, ".litcodex/evidence/task-uiux-installed-receipt.json");
const probe = readFileSync(probeUrl, "utf8");
const helpersUrl = new URL("../../../../scripts/uiux-installed-probe-helpers.mjs", import.meta.url);
const helpers = readFileSync(helpersUrl, "utf8");

describe("UIUX installed probe documented command fidelity", () => {
	it("runs no design or visual-qa command now that those skills are stubs", () => {
		for (const gone of [
			"documentedBlock",
			"assertBetaDesignContract",
			"installed-beta-evidence",
			"runScenarioTable",
		]) {
			expect(probe, gone).not.toContain(gone);
			expect(helpers, gone).not.toContain(gone);
		}
		expect(probe).toContain("const base = { cwd: project, env: setupEnv, signal };");
	});

	it("keeps ambient API auth out of the shared setup environment", () => {
		expect(probe).not.toContain("credentialSafeSandboxEnv");
		expect(probe).toContain("const setupEnv = credentialFreeSetupEnv(home, codexHome, prefix, codexBin);");
		expect(probe).toContain("const hostEnv = minimalHostExecEnv(setupEnv);");
		expect(probe).toContain(
			"const codexIdentity = captureRepositoryCodexIdentity({ repoRoot, codexBin: requestedCodexBin });",
		);
		expect(probe.indexOf("const codexIdentity = captureRepositoryCodexIdentity")).toBeLessThan(
			probe.indexOf("root = mkdtempSync"),
		);
		const hostRunner = probe.indexOf("const hostRunCommand");
		expect(probe.indexOf("assertCodexIdentity(codexIdentity)", hostRunner)).toBeLessThan(
			probe.indexOf("env.OPENAI_API_KEY = normalizedApiKey", hostRunner),
		);
	});

	it("production entrypoint never persists a secret-shaped missing CODEX_BIN path", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-probe-entrypoint-secret-test-"));
		const canary = `npm_${"C".repeat(36)}`;
		const codexBin = join(root, canary, "missing-codex");
		const previousEvidence = existsSync(evidencePath) ? readFileSync(evidencePath) : null;
		try {
			const result = spawnSync(process.execPath, [probePath, "--scope", "doctor"], {
				cwd: repoRoot,
				encoding: "utf8",
				env: {
					...process.env,
					CODEX_BIN: codexBin,
					CODEX_HOME: join(root, "codex-home"),
				},
			});
			expect(result.status).toBe(1);
			const persistedText = readFileSync(evidencePath, "utf8");
			const persisted = JSON.parse(persistedText);
			expect(persistedText).not.toContain(canary);
			expect(persistedText).not.toContain(codexBin);
			expect(persisted.status).toBe("BLOCKED_HOST_UNAVAILABLE");
			expect(persisted.failure).toMatchObject({
				phase: "codex-provenance",
				message: "CODEX_BIN does not match the repository Codex public path",
			});
			expect(persisted.failure).not.toHaveProperty("codexBin");
			expect(persisted.cleanup).toMatchObject({ removed: true });
			expect(persisted.cleanup).not.toHaveProperty("sandboxRoot");
		} finally {
			if (previousEvidence === null) rmSync(evidencePath, { force: true });
			else {
				mkdirSync(dirname(evidencePath), { recursive: true });
				writeFileSync(evidencePath, previousEvidence);
			}
			rmSync(root, { recursive: true, force: true });
		}
	});
});
