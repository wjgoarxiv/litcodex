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
	it("does not pre-seed skill-root variables that the documented blocks must resolve", () => {
		expect(probe).not.toMatch(/LITCODEX_FRONTEND_UIUX_ROOT:\s*join\(/);
		expect(probe).not.toMatch(/LITCODEX_VISUAL_QA_ROOT:\s*join\(/);
		expect(probe).not.toContain("commandEnv");
		expect(probe).toContain("function documentedBlock");
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

	it("exercises installed beta material evidence and every false-PASS boundary", () => {
		expect(probe).toContain("assertBetaDesignContract(contract);");
		expect(helpers).toContain('schema_id: "litfamily.design-contract/v1beta1"');
		expect(helpers).toContain("^litfamily\\.design-contract\\/v1beta[1-9]");
		expect(probe).toContain("litfamily.evidence-manifest/v1beta1");
		expect(probe).toContain("--input");
		expect(probe).toContain("--tier");
		expect(probe).toContain("--now");
		expect(probe).toContain("--evidence-root");
		for (const commandName of [
			"installed-beta-evidence-pass",
			"installed-beta-evidence-missing",
			"installed-beta-evidence-non-image",
			"installed-beta-evidence-stale",
			"installed-beta-evidence-root-escape",
			"installed-beta-evidence-symlink",
			"installed-beta-evidence-reviewer-block",
		]) {
			expect(probe).toContain(commandName);
		}
		expect(probe).not.toContain("installed-probe-capture-v1");
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
