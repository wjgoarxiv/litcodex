import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalJson, isRecord, sha256 } from "./scripts/strict-input.mjs";
import { validateEvidence } from "./scripts/validate-evidence.mjs";
import { reviewEligibility, validateReviewReceipt } from "./scripts/validate-review-receipt.mjs";
import { validateDesignContract } from "../frontend-ui-ux/scripts/validate-design-contract.mjs";
import {
	designContract,
	evidenceBundle,
	evidenceManifest,
	INVENTORY_IDS,
	REQUIRED_CHANNEL_IDS,
} from "./test/visual-qa-fixtures.js";
import { encodeRgbaPng, solidRgba } from "./test/png-synth.mjs";

const NOW = new Date("2026-07-24T06:00:00.000Z");
const HASH = "d".repeat(64);
const SMOKE_IDS = [
	INVENTORY_IDS.primaryRoute,
	INVENTORY_IDS.criticalInteraction,
	INVENTORY_IDS.smallViewport,
	INVENTORY_IDS.largeViewport,
	...REQUIRED_CHANNEL_IDS,
];

function bundle() {
	return evidenceBundle(designContract(), evidenceManifest(SMOKE_IDS));
}

function manifestOf(value: Record<string, unknown>): Record<string, unknown> {
	const manifest = value["evidence_manifest"];
	if (!isRecord(manifest)) throw new Error("test manifest missing");
	return manifest;
}

function receiptsOf(value: Record<string, unknown>): Record<string, unknown>[] {
	const receipts = value["review_receipts"];
	if (!Array.isArray(receipts) || receipts.some((receipt) => !isRecord(receipt))) {
		throw new Error("test receipts missing");
	}
	return receipts;
}

function result(value: Record<string, unknown>) {
	return validateEvidence(value, "smoke", NOW);
}

function betaContract(): Record<string, unknown> {
	return {
		...designContract(),
		schema_id: "litfamily.design-contract/v1beta1",
		lane: "brownfield",
		tokens: [{ id: "token:action", category: "color", value: "accent-600", usage: "primary action" }],
		component_behaviors: [{
			component_id: INVENTORY_IDS.primaryComponent,
			state_ids: [INVENTORY_IDS.errorState],
			interaction_ids: [INVENTORY_IDS.criticalInteraction],
			keyboard_behavior: "Enter activates the primary action",
		}],
		responsive_transformations: [{
			route_id: INVENTORY_IDS.primaryRoute,
			viewport_id: INVENTORY_IDS.smallViewport,
			behavior: "The primary region stacks at compact width",
		}],
		motion: {
			policy: "functional",
			reduced_motion_behavior: "State changes without translation",
			transitions: [{
				id: "transition:primary",
				interaction_id: INVENTORY_IDS.criticalInteraction,
				duration_ms: 120,
				easing: "ease-out",
			}],
		},
		acceptance_criteria: [{
			id: "criterion:primary",
			observable: "Keyboard activation reaches the error state",
			verification: "browser",
			required: true,
			inventory_ids: [INVENTORY_IDS.primaryComponent, INVENTORY_IDS.criticalInteraction, INVENTORY_IDS.errorState],
		}],
	};
}

function beta2Contract(): Record<string, unknown> {
	return {
		...betaContract(),
		schema_id: "litfamily.design-contract/v1beta2",
		taste: { variance: 5, motion: 4, density: 7 },
	};
}

describe("visual-qa adversarial false-PASS matrix", () => {
	it("binds v1beta1 evidence to a real PNG under the caller-authorized root", () => {
		const schema = new URL("./schemas/evidence-manifest.v1beta1.json", import.meta.url);
		expect(JSON.parse(readFileSync(schema, "utf8")).$id).toBe("litfamily.evidence-manifest/v1beta1");

		const sandbox = mkdtempSync(join(tmpdir(), "litcodex-beta-evidence-"));
		const root = join(sandbox, "evidence-root");
		try {
			mkdirSync(root);
			mkdirSync(join(root, "captures"));
			const capturePath = join(root, "captures", "primary.png");
			const captureBytes = encodeRgbaPng(1, 1, solidRgba(1, 1, [10, 20, 30, 255]));
			writeFileSync(capturePath, captureBytes);
			writeFileSync(join(sandbox, "outside.png"), captureBytes);
			symlinkSync(join(sandbox, "outside.png"), join(root, "captures", "linked.png"));
			const contract = betaContract();
			const manifest = evidenceManifest(SMOKE_IDS, {
				schema_id: "litfamily.evidence-manifest/v1beta1",
				capture_path: "captures/primary.png",
				capture_byte_length: captureBytes.length,
				capture_width: 1,
				capture_height: 1,
				review_receipt_hashes: [],
			});
			const value = evidenceBundle(contract, manifest);
			const evidence = manifestOf(value);
			evidence["schema_id"] = "litfamily.evidence-manifest/v1beta1";
			evidence["capture_path"] = "captures/primary.png";
			evidence["capture_byte_length"] = captureBytes.length;
			evidence["capture_width"] = 1;
			evidence["capture_height"] = 1;
			evidence["capture_hash"] = sha256(captureBytes);
			evidence["review_receipt_hashes"] = [];
			(evidence["capabilities"] as Record<string, unknown>)["independent_review"] = false;
			value["review_receipts"] = [];
			const bytes = value["evidence_bytes"] as Record<string, unknown>;
			bytes["capture_base64"] = captureBytes.toString("base64");
			bytes["manifest"] = canonicalJson({ ...evidence, review_receipt_hashes: [] });

			const accepted = validateEvidence(value, "smoke", NOW, { evidenceRoot: root });
			expect(accepted).toMatchObject({ verdict: "PASS", evidence_eligible: true });

			const shortLocale = structuredClone(value);
			const shortLocaleManifest = manifestOf(shortLocale);
			(shortLocaleManifest["environment"] as Record<string, unknown>)["locale"] = "a";
			(shortLocale["evidence_bytes"] as Record<string, unknown>)["manifest"] = canonicalJson({
				...shortLocaleManifest,
				review_receipt_hashes: [],
			});
			expect(validateEvidence(shortLocale, "smoke", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "FAIL",
				validation_errors: expect.arrayContaining(["environment.locale must contain at least two characters"]),
			});

			const malformedReceiptHashes = structuredClone(value);
			manifestOf(malformedReceiptHashes)["review_receipt_hashes"] = "";
			expect(validateEvidence(malformedReceiptHashes, "smoke", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "FAIL",
				validation_errors: expect.arrayContaining(["review_receipt_hashes must be an array"]),
			});

			const emptySubmittedCapture = structuredClone(value);
			(emptySubmittedCapture["evidence_bytes"] as Record<string, unknown>)["capture_base64"] = "";
			expect(validateEvidence(emptySubmittedCapture, "smoke", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "FAIL",
				validation_errors: expect.arrayContaining(["capture evidence must contain nonempty evidence bytes"]),
			});

			const absoluteCapture = structuredClone(value);
			const absoluteManifest = manifestOf(absoluteCapture);
			absoluteManifest["capture_path"] = capturePath;
			(absoluteCapture["evidence_bytes"] as Record<string, unknown>)["manifest"] = canonicalJson({
				...absoluteManifest,
				review_receipt_hashes: [],
			});
			expect(validateEvidence(absoluteCapture, "smoke", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "FAIL",
				validation_errors: expect.arrayContaining(["capture_path must be a relative path of at most 512 characters"]),
			});

			const oversizedCapturePath = structuredClone(value);
			manifestOf(oversizedCapturePath)["capture_path"] = `captures/${"a".repeat(504)}`;
			expect(validateEvidence(oversizedCapturePath, "smoke", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "FAIL",
				validation_errors: expect.arrayContaining(["capture_path must be a relative path of at most 512 characters"]),
			});

			const evidenceSchema = JSON.parse(readFileSync(schema, "utf8"));
			expect(evidenceSchema.properties.capture_path).toMatchObject({ maxLength: 512 });

			const malformedReviewCapability = structuredClone(value);
			(manifestOf(malformedReviewCapability)["capabilities"] as Record<string, unknown>)["independent_review"] = "no";
			expect(validateEvidence(malformedReviewCapability, "smoke", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "FAIL",
				validation_errors: expect.arrayContaining(["capabilities.independent_review must be boolean"]),
			});

			for (const path of ["captures/missing.png", "../outside.png", "captures/linked.png"]) {
				const changed = structuredClone(value);
				manifestOf(changed)["capture_path"] = path;
				expect(validateEvidence(changed, "smoke", NOW, { evidenceRoot: root }).verdict).not.toBe("PASS");
			}

			const stale = structuredClone(value);
			const staleManifest = manifestOf(stale);
			staleManifest["created_at"] = "2026-07-24T05:00:00.000Z";
			for (const entry of staleManifest["inventory"] as Record<string, unknown>[]) {
				entry["captured_at"] = "2026-07-24T04:59:20.000Z";
			}
			const staleBytes = stale["evidence_bytes"] as Record<string, unknown>;
			staleBytes["manifest"] = canonicalJson({ ...staleManifest, review_receipt_hashes: [] });
			staleBytes["inventory"] = canonicalJson(staleManifest["inventory"]);
			expect(validateEvidence(stale, "smoke", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "BLOCKED",
				blocked_codes: expect.arrayContaining(["BLOCKED_EVIDENCE_STALE"]),
				validation_errors: [],
			});

			const nonImage = structuredClone(value);
			writeFileSync(capturePath, "not a png");
			const nonImageBytes = Buffer.from("not a png");
			manifestOf(nonImage)["capture_hash"] = sha256(nonImageBytes);
			manifestOf(nonImage)["capture_byte_length"] = nonImageBytes.length;
			(nonImage["evidence_bytes"] as Record<string, unknown>)["capture_base64"] = nonImageBytes.toString("base64");
			expect(validateEvidence(nonImage, "smoke", NOW, { evidenceRoot: root }).verdict).not.toBe("PASS");

			writeFileSync(capturePath, captureBytes);
			const unavailable = structuredClone(value);
			(manifestOf(unavailable)["capabilities"] as Record<string, unknown>)["capture"] = false;
			expect(validateEvidence(unavailable, "smoke", NOW, { evidenceRoot: root }).blocked_codes)
				.toContain("BLOCKED_RENDERER_UNAVAILABLE");

			const selfAttested = structuredClone(value);
			expect(validateEvidence(selfAttested, "full", NOW, { evidenceRoot: root })).toMatchObject({
				verdict: "BLOCKED",
				blocked_codes: expect.arrayContaining(["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"]),
			});
		} finally {
			rmSync(sandbox, { recursive: true, force: true });
		}
	});

	it("keeps the v1beta1 evidence manifest compatible with a beta2 taste contract", () => {
		const value = evidenceBundle(
			beta2Contract(),
			evidenceManifest(SMOKE_IDS, { schema_id: "litfamily.evidence-manifest/v1beta1" }),
		);
		const evaluated = validateEvidence(value, "smoke", NOW);
		expect(evaluated.verdict).toBe("FAIL");
		expect(evaluated.validation_errors).toContain("beta evidence requires a caller-authorized evidence root");
	});

	it.each(["smoke", "full", "reference-fidelity"] as const)(
		"never returns PASS for a diagnostically valid alpha contract at %s tier",
		(tier) => {
			const value = bundle();
			const evaluated = validateEvidence(value, tier, NOW);
			expect(evaluated.verdict).toBe("FAIL");
			expect(evaluated.evidence_eligible).toBe(false);
			expect(evaluated.validation_errors).toEqual(
				expect.arrayContaining([expect.stringMatching(/v1alpha1.*migration-only/i)]),
			);
		},
	);
	it.each([
		["empty states", (contract: Record<string, unknown>) => {
			(contract["inventory"] as Record<string, unknown>)["states"] = [];
		}],
		["missing auth surface", (contract: Record<string, unknown>) => {
			const inventory = contract["inventory"] as Record<string, unknown>;
			(inventory["routes"] as Record<string, unknown>[])[0]["auth_required"] = true;
		}],
		["orphan auth surface", (contract: Record<string, unknown>) => {
			(contract["inventory"] as Record<string, unknown>)["authenticated_surfaces"] = [
				{ id: "route:not-present", owner: "test", safe_test_account: true },
			];
		}],
		["non-canonical expiry timestamp", (contract: Record<string, unknown>) => {
			contract["omissions"] = [{
				id: "omission:temporary",
				reason: "temporary",
				owner: "product",
				expires_at: "2026-07-24 06:00:00",
			}];
		}],
	])("design contract rejects %s", (_name, mutate) => {
		const contract = designContract();
		mutate(contract);
		expect(validateDesignContract(contract).valid).toBe(false);
	});

	it("keeps receipt structure separate from final PASS eligibility", () => {
		const value = bundle();
		const receipt = receiptsOf(value)[0];
		for (const verdict of ["REVISE", "FAIL"]) {
			const candidate = { ...receipt, verdict };
			expect(validateReviewReceipt(candidate).valid).toBe(true);
			expect(reviewEligibility(candidate).eligible).toBe(false);
		}
		const timeout = { ...receipt, timeout: true };
		expect(validateReviewReceipt(timeout).valid).toBe(true);
		expect(reviewEligibility(timeout)).toMatchObject({
			eligible: false,
			blocked: ["BLOCKED_REVIEW_TIMEOUT"],
		});
	});

	it("rejects empty finding messages from receipts and manifests", () => {
		const value = bundle();
		receiptsOf(value)[0]["findings"] = [{ severity: "minor", message: " ", open: false }];
		expect(result(value).verdict).not.toBe("PASS");
		const other = bundle();
		manifestOf(other)["findings"] = [{ severity: "minor", message: "", open: false }];
		expect(result(other).verdict).not.toBe("PASS");
	});

	it("binds receipts to exact manifest, inventory, and capture evidence bytes", () => {
		for (const mutate of [
			(value: Record<string, unknown>) => {
				(value["evidence_bytes"] as Record<string, unknown>)["manifest"] += " ";
			},
			(value: Record<string, unknown>) => {
				(value["evidence_bytes"] as Record<string, unknown>)["inventory"] = "[]\n";
			},
			(value: Record<string, unknown>) => {
				(value["evidence_bytes"] as Record<string, unknown>)["capture_base64"] =
					Buffer.from("different capture", "utf8").toString("base64");
			},
		]) {
			const value = bundle();
			mutate(value);
			expect(result(value).verdict).not.toBe("PASS");
		}
	});

	it.each([
		["missing auth capability", (value: Record<string, unknown>) => {
			delete (manifestOf(value)["capabilities"] as Record<string, unknown>)["auth"];
		}],
		["non-boolean auth capability", (value: Record<string, unknown>) => {
			(manifestOf(value)["capabilities"] as Record<string, unknown>)["auth"] = "yes";
		}],
	])("rejects %s even when authenticated inventory is empty", (_name, mutate) => {
		const value = bundle();
		mutate(value);
		expect(result(value).verdict).toBe("FAIL");
	});

	it("rejects empty capture bytes and arbitrary per-item evidence hashes", () => {
		const emptyCapture = bundle();
		(emptyCapture["evidence_bytes"] as Record<string, unknown>)["capture_base64"] = "";
		expect(result(emptyCapture).verdict).toBe("FAIL");

		const arbitraryItem = bundle();
		const items = (arbitraryItem["evidence_bytes"] as Record<string, unknown>)["inventory_items"] as Record<string, unknown>;
		items[SMOKE_IDS[0]] = Buffer.from("unbound bytes", "utf8").toString("base64");
		expect(result(arbitraryItem).verdict).toBe("FAIL");
	});

	it.each([
		["before capture", "2026-07-24T05:59:20.000Z"],
		["after validation clock", "2026-07-24T06:00:01.000Z"],
	])("rejects reviewer timestamps %s", (_name, timestamp) => {
		const value = bundle();
		receiptsOf(value)[0]["started_at"] = timestamp;
		receiptsOf(value)[0]["completed_at"] = timestamp;
		expect(result(value).verdict).toBe("FAIL");
	});

	it("keeps a complete alpha compatibility bundle ineligible at every tier", () => {
		const contract = designContract();
		contract["omissions"] = [{ id: "omission:legacy-banner", reason: "out of scope", owner: "product" }];
		contract["accepted_exceptions"] = [{ id: "exception:contrast-token", reason: "approved", owner: "design" }];
		const smoke = [...SMOKE_IDS, "omission:legacy-banner", "exception:contrast-token"];
		const full = [
			...smoke,
			INVENTORY_IDS.secondaryRoute,
			INVENTORY_IDS.primaryRegion,
			INVENTORY_IDS.primaryComponent,
			INVENTORY_IDS.errorState,
		];
		for (const [tier, ids] of [
			["smoke", smoke],
			["full", full],
			["reference-fidelity", [...full, INVENTORY_IDS.referenceHero]],
		] as const) {
			const manifest = evidenceManifest(ids);
			manifest["inventory"] = ids.map((id) => ({
				id,
				status: id.startsWith("omission:") ? "omitted" : id.startsWith("exception:") ? "accepted-exception" : "captured",
				evidence_hash: HASH,
				captured_at: "2026-07-24T05:59:20.000Z",
			}));
			expect(validateEvidence(evidenceBundle(contract, manifest), tier, NOW)).toMatchObject({
				verdict: "FAIL",
				missing_inventory: [],
				evidence_eligible: false,
				validation_errors: expect.arrayContaining([expect.stringMatching(/v1alpha1.*migration-only/i)]),
			});
		}
	});

	it.each([
		["future timestamp", (value: Record<string, unknown>) => { manifestOf(value)["created_at"] = "2026-07-24T06:00:01.000Z"; }, "BLOCKED"],
		["incomplete cleanup", (value: Record<string, unknown>) => { manifestOf(value)["cleanup"] = { status: "complete" }; }, "FAIL"],
		["open high finding", (value: Record<string, unknown>) => { manifestOf(value)["findings"] = [{ severity: "high", message: "open", open: true }]; }, "FAIL"],
		["declared blocker", (value: Record<string, unknown>) => { manifestOf(value)["blockers"] = ["BLOCKED_RENDERER_UNAVAILABLE"]; }, "BLOCKED"],
		["one receipt", (value: Record<string, unknown>) => { value["review_receipts"] = receiptsOf(value).slice(0, 1); }, "FAIL"],
		["same context", (value: Record<string, unknown>) => { receiptsOf(value)[1]["fresh_context_id"] = receiptsOf(value)[0]["fresh_context_id"]; }, "FAIL"],
		["input hash drift", (value: Record<string, unknown>) => { receiptsOf(value)[0]["input_hashes"] = [HASH, HASH, HASH]; }, "FAIL"],
		["receipt hash drift", (value: Record<string, unknown>) => { manifestOf(value)["review_receipt_hashes"] = [HASH, HASH]; }, "FAIL"],
		["timeout", (value: Record<string, unknown>) => { receiptsOf(value)[0]["timeout"] = true; }, "BLOCKED"],
		["canceled", (value: Record<string, unknown>) => { receiptsOf(value)[0]["canceled"] = true; }, "BLOCKED"],
		["false reviewer verdict", (value: Record<string, unknown>) => { receiptsOf(value)[0]["verdict"] = "REVISE"; }, "FAIL"],
		["independence drift", (value: Record<string, unknown>) => { receiptsOf(value)[0]["independence_assertion"] = true; }, "FAIL"],
	])("%s cannot produce PASS", (_name, mutate, verdict) => {
		const value = bundle();
		mutate(value);
		const evaluated = result(value);
		expect(evaluated.verdict).toBe(verdict);
		expect(evaluated.verdict).not.toBe("PASS");
	});

	it("rejects duplicate JSON keys at the CLI boundary", () => {
		const entrypoint = new URL("./scripts/validate-evidence.mjs", import.meta.url);
		const duplicate = '{"design_contract":{},"design_contract":{},"evidence_manifest":{},"review_receipts":[]}';
		const run = spawnSync(process.execPath, [entrypoint.pathname, "--tier", "smoke", "--now", NOW.toISOString()], {
			encoding: "utf8",
			input: duplicate,
		});
		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain("duplicate JSON key");
	});

	it.each([
		["invalid UTF-8", Buffer.from([0xc3, 0x28]), "valid UTF-8"],
		["oversized JSON", Buffer.alloc(1024 * 1024 + 1, 0x20), "input exceeds"],
	])("rejects %s before JSON evaluation", (_name, input, expected) => {
		const entrypoint = new URL("./scripts/validate-evidence.mjs", import.meta.url);
		const run = spawnSync(process.execPath, [entrypoint.pathname, "--tier", "smoke", "--now", NOW.toISOString()], {
			encoding: "utf8",
			input,
		});
		expect(run.status).not.toBe(0);
		expect(run.stderr).toContain(expected);
	});

	it("binds receipt hashes to full canonical receipt bytes", () => {
		const value = bundle();
		const receipts = receiptsOf(value);
		const hashes = receipts.map((receipt) => sha256(canonicalJson(receipt)));
		expect(manifestOf(value)["review_receipt_hashes"]).toEqual(hashes);
		receipts[0]["findings"] = [{ severity: "minor", message: "byte drift", open: false }];
		expect(result(value).verdict).toBe("FAIL");
	});
});
