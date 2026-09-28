import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { hasAnsi, stripAnsi } from "./scripts/ansi.mjs";
import { stringWidth } from "./scripts/east-asian-width.mjs";
import { decodePng } from "./scripts/png-decode.mjs";
import { encodeRgbaPng, solidRgba } from "./test/png-synth.mjs";
import { checkTui } from "./scripts/tui-grid.mjs";
import {
	designContract,
	evidenceManifest,
	expectSkillPattern,
	expectSkillText,
	INVENTORY_IDS,
	invokeEvidenceValidator,
	parseValidatorResult,
	pngWithDeclaredDimensions,
	REQUIRED_CHANNEL_IDS,
	requireAsset,
	reviewer,
	skill,
} from "./test/visual-qa-fixtures.js";
import "./test/browser-contract.js";

describe("visual-qa failing-first evidence contract", () => {
	it("keeps the model-facing entrypoint bounded and routes dense detail lazily", () => {
		expect(Buffer.byteLength(skill, "utf8")).toBeLessThanOrEqual(4096);
		expect(skill).toContain("references/complete-contract.md");
		const detail = requireAsset("references/complete-contract.md");
		expect(detail).not.toBeNull();
		if (detail !== null) expect(Buffer.byteLength(readFileSync(detail, "utf8"), "utf8")).toBeGreaterThanOrEqual(15_000);
	});

	it("documents the installed evidence validator's public flag interface", () => {
		expect(skill).toContain('validate-review-receipt.mjs" < receipt.json');
		expect(skill).toContain('validate-design-contract.mjs" --input design-contract.json');
		expect(skill).toContain("--input evidence-bundle.json");
		expect(skill).toContain("--tier smoke");
		expect(skill).toContain("--now 2026-07-25T06:00:00.000Z");
		expect(skill).toContain("--evidence-root evidence-root");
		expect(skill).toContain('cli.mjs" image-diff reference.png actual.png');
		expect(skill).not.toContain('validate-review-receipt.mjs" receipt.json');
		expect(skill).not.toContain('validate-evidence.mjs" smoke contract.json evidence.json');
		expect(skill).not.toContain('cli.mjs" --help');
	});

	it("visualqa.evidence-v1alpha1 defines evidence and review receipt schemas", () => {
		const evidenceSchemaPath = requireAsset("schemas/evidence-manifest.v1alpha1.json");
		const reviewSchemaPath = requireAsset("schemas/review-receipt.v1alpha1.json");
		const validatorPath = requireAsset("scripts/validate-evidence.mjs");
		if (evidenceSchemaPath === null || reviewSchemaPath === null || validatorPath === null) return;

		const evidenceSchema = readFileSync(evidenceSchemaPath, "utf8");
		const reviewSchema = readFileSync(reviewSchemaPath, "utf8");
		expect(evidenceSchema).toContain("litfamily.evidence-manifest/v1alpha1");
		expect(reviewSchema).toContain("litfamily.review-receipt/v1alpha1");
		for (const concept of [
			"design_contract_hash",
			"source_hash",
			"capture_hash",
			"inventory",
			"review_receipt_hashes",
			"cleanup",
			"blockers",
			"findings",
		]) {
			expect(evidenceSchema, `evidence schema must define ${concept}`).toContain(concept);
		}
		for (const concept of [
			"fresh_context_id",
			"input_hashes",
			"independence_assertion",
			"timeout",
			"verdict",
		]) {
			expect(reviewSchema, `review schema must define ${concept}`).toContain(concept);
		}
		expect(skill).toContain("schemas/evidence-manifest.v1alpha1.json");
		expect(skill).toContain("litfamily.review-receipt/v1alpha1");

		const smokeIds = [
			INVENTORY_IDS.primaryRoute,
			INVENTORY_IDS.criticalInteraction,
			INVENTORY_IDS.smallViewport,
			INVENTORY_IDS.largeViewport,
			...REQUIRED_CHANNEL_IDS,
		];
		const fresh = parseValidatorResult(
			invokeEvidenceValidator(validatorPath, "smoke", designContract(), evidenceManifest(smokeIds)),
		);
		expect(fresh).toMatchObject({
			verdict: "FAIL",
			evidence_eligible: false,
			validation_errors: expect.arrayContaining([expect.stringMatching(/v1alpha1.*migration-only/i)]),
		});

		const stale = parseValidatorResult(
			invokeEvidenceValidator(
				validatorPath,
				"smoke",
				designContract(),
				evidenceManifest(smokeIds, {
					created_at: "2026-07-24T05:00:00.000Z",
					maximum_age_seconds: 60,
				}),
			),
		);
		expect(stale).toMatchObject({
			verdict: "BLOCKED",
			blocked_codes: expect.arrayContaining(["BLOCKED_EVIDENCE_STALE"]),
		});
	});

	it("documents beta material captures, package-local validation, and the host-proven reviewer blocker", () => {
		expectSkillText("schemas/design-contract.v1beta1.json");
		expectSkillText("schemas/design-contract.v1beta2.json");
		expectSkillText("schemas/evidence-manifest.v1beta1.json");
		expectSkillPattern(/regular non-symlink PNG/i, "material PNG boundary");
		expectSkillPattern(/package-local/i, "package-local validator boundary");
		expectSkillPattern(/host-proven/i, "host reviewer provenance boundary");
		expectSkillText("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
	});

	it("keeps v1beta2 canonical in detailed guidance with explicit v1beta1 compatibility", () => {
		const detailPath = requireAsset("references/complete-contract.md");
		if (detailPath === null) return;
		const detail = readFileSync(detailPath, "utf8");

		expect(detail).toContain("canonical litfamily.design-contract/v1beta2");
		expect(detail).toContain("v1beta1 remains explicitly compatible");
		expect(detail).toContain("schemas/design-contract.v1beta1.json");
		expect(detail).toContain("schemas/evidence-manifest.v1beta1.json");
		expect(detail).not.toContain("canonical litfamily.design-contract/v1beta1");
	});

	it("visualqa.blocked-capabilities names stable blockers and forbids fabricated PASS", () => {
		const validatorPath = requireAsset("scripts/validate-evidence.mjs");
		if (validatorPath === null) return;

		const smokeIds = [
			INVENTORY_IDS.primaryRoute,
			INVENTORY_IDS.criticalInteraction,
			INVENTORY_IDS.smallViewport,
			INVENTORY_IDS.largeViewport,
			...REQUIRED_CHANNEL_IDS,
		];
		const fullIds = [
			...smokeIds,
			INVENTORY_IDS.secondaryRoute,
			INVENTORY_IDS.primaryRegion,
			INVENTORY_IDS.primaryComponent,
			INVENTORY_IDS.errorState,
		];

		const unavailable = parseValidatorResult(
			invokeEvidenceValidator(
				validatorPath,
				"smoke",
				designContract(true),
				evidenceManifest(smokeIds, {
					capabilities: {
						capture: false,
						auth: false,
						independent_review: false,
					},
				}),
			),
		);
		expect(unavailable).toMatchObject({
			verdict: "BLOCKED",
			blocked_codes: expect.arrayContaining([
				"BLOCKED_RENDERER_UNAVAILABLE",
				"BLOCKED_AUTH_UNAVAILABLE",
				"BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
			]),
		});
		expect(unavailable.verdict).not.toBe("PASS");

		const smokeComplete = parseValidatorResult(
			invokeEvidenceValidator(validatorPath, "smoke", designContract(), evidenceManifest(smokeIds)),
		);
		expect(smokeComplete).toMatchObject({ verdict: "FAIL", tier: "smoke", evidence_eligible: false });

		const smokeMissingLargest = parseValidatorResult(
			invokeEvidenceValidator(
				validatorPath,
				"smoke",
				designContract(),
				evidenceManifest(smokeIds.filter((id) => id !== INVENTORY_IDS.largeViewport)),
			),
		);
		expect(smokeMissingLargest).toMatchObject({
			verdict: "FAIL",
			tier: "smoke",
			missing_inventory: expect.arrayContaining([INVENTORY_IDS.largeViewport]),
		});

		const fullIncomplete = parseValidatorResult(
			invokeEvidenceValidator(validatorPath, "full", designContract(), evidenceManifest(smokeIds)),
		);
		expect(fullIncomplete).toMatchObject({
			verdict: "FAIL",
			tier: "full",
			missing_inventory: expect.arrayContaining([
				INVENTORY_IDS.secondaryRoute,
				INVENTORY_IDS.errorState,
			]),
		});
		expect(
			parseValidatorResult(
				invokeEvidenceValidator(validatorPath, "full", designContract(), evidenceManifest(fullIds)),
			),
		).toMatchObject({ verdict: "FAIL", tier: "full", evidence_eligible: false });

		const fidelityIncomplete = parseValidatorResult(
			invokeEvidenceValidator(
				validatorPath,
				"reference-fidelity",
				designContract(),
				evidenceManifest(fullIds),
			),
		);
		expect(fidelityIncomplete).toMatchObject({
			verdict: "FAIL",
			tier: "reference-fidelity",
			missing_inventory: expect.arrayContaining([INVENTORY_IDS.referenceHero]),
		});
		expect(
			parseValidatorResult(
				invokeEvidenceValidator(
					validatorPath,
					"reference-fidelity",
					designContract(),
					evidenceManifest([...fullIds, INVENTORY_IDS.referenceHero]),
				),
			),
		).toMatchObject({ verdict: "FAIL", tier: "reference-fidelity", evidence_eligible: false });

		for (const blockedCode of [
			"BLOCKED_RENDERER_UNAVAILABLE",
			"BLOCKED_AUTH_UNAVAILABLE",
			"BLOCKED_TEST_ACCOUNT_UNSAFE",
			"BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE",
			"BLOCKED_REVIEW_TIMEOUT",
			"BLOCKED_EVIDENCE_STALE",
		]) {
			expectSkillText(blockedCode);
		}
		expectSkillText("Cannot be converted to PASS by prose");
		expectSkillPattern(
			/Missing safe\s+authentication cannot be worked around with a personal account/i,
			"missing safe authentication cannot use a personal account",
		);
		expectSkillText("smoke");
		expectSkillText("full");
		expectSkillText("reference-fidelity");
	});

	it("visualqa.png-resource-bounds rejects oversized headers before decode and validates CRC", () => {
		const valid = encodeRgbaPng(1, 1, solidRgba(1, 1, [20, 30, 40, 255]));
		const truncated = valid.subarray(0, valid.length - 6);
		expect(() => decodePng(truncated)).toThrow(/PNG_TRUNCATED/);

		expect(() => decodePng(pngWithDeclaredDimensions(16_385, 1))).toThrow(
			/resource limit|resource bound|dimension|16,?384/i,
		);

		const corrupted = Buffer.from(encodeRgbaPng(1, 1, solidRgba(1, 1, [20, 30, 40, 255])));
		corrupted[29] = (corrupted[29] ?? 0) ^ 0xff;
		expect(() => decodePng(corrupted)).toThrow(/CRC/i);
	});

	it("visualqa.tui-unicode-osc treats OSC as inert and measures grapheme clusters", () => {
		const linked = "\u001B]8;;https://example.invalid\u0007한👩‍💻\u001B]8;;\u0007";
		expect(hasAnsi(linked)).toBe(true);
		expect(stripAnsi(linked)).toBe("한👩‍💻");
		expect(stringWidth("e\u0301")).toBe(1);
		expect(stringWidth("👩‍💻")).toBe(2);

		const report = checkTui(`┌────┐\n│${linked}│\n└────┘`, 6);
		expect(report.lineWidths).toEqual([6, 6, 6]);
		expect(report.borderMisaligned).toBe(false);
		expect(report.hasAnsi).toBe(true);
	});

	it("visualqa.review-independence aligns the skill and existing reviewer charter", () => {
		expectSkillText("litfamily.review-receipt/v1alpha1");
		expectSkillPattern(/separate fresh contexts/i, "separate fresh contexts");
		expectSkillPattern(/same canonical pre-receipt manifest/i, "same immutable inputs");
		expectSkillPattern(
			/(?:do not receive|do not\s+give either reviewer) (?:each other's|the other's) (?:draft|verdict)/i,
			"reviewers cannot see each other's result",
		);
		expectSkillPattern(/at most two fresh-review rounds/i, "two-round review bound");
		expectSkillText("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");

		expect(/visual-review charter/i.test(reviewer), "reviewer must expose a visual-review charter").toBe(true);
		expect(reviewer.includes("PASS"), "reviewer must support PASS").toBe(true);
		expect(reviewer.includes("REVISE"), "reviewer must support REVISE").toBe(true);
		expect(reviewer.includes("FAIL"), "reviewer must support FAIL").toBe(true);
		expect(/separate fresh context/i.test(reviewer), "reviewer must require a separate fresh context").toBe(true);
	});
});
