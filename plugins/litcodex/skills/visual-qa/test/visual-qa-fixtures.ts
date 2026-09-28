import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { uiuxDesignContract } from "../../../../../tools/uiux-design-contract.mjs";
import { crc32 } from "../scripts/png-crc.mjs";
import { encodeRgbaPng, solidRgba } from "./png-synth.mjs";
import { canonicalJson, sha256 } from "../scripts/strict-input.mjs";
import { INDEPENDENCE_ASSERTION } from "../scripts/validate-review-receipt.mjs";

export const SKILL_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const skill = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
export const skillCorpus = [
	skill,
	readFileSync(new URL("../references/complete-contract.md", import.meta.url), "utf8"),
].join("\n");
export const reviewer = readFileSync(
	new URL("../../../components/lit-loop/agents/litcodex-litwork-reviewer.toml", import.meta.url),
	"utf8",
);
const FIXED_NOW = "2026-07-24T06:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

export const INVENTORY_IDS = {
	primaryRoute: "route:primary",
	secondaryRoute: "route:secondary",
	primaryRegion: "region:primary",
	primaryComponent: "component:primary-action",
	criticalInteraction: "interaction:critical",
	errorState: "state:error",
	smallViewport: "viewport:small",
	largeViewport: "viewport:large",
	referenceHero: "reference:hero",
	browserChannel: "channel:browser",
	keyboardChannel: "channel:keyboard",
	accessibilityTreeChannel: "channel:accessibility-tree",
	performanceChannel: "channel:performance",
	localizationChannel: "channel:localization",
} as const;

export const REQUIRED_CHANNEL_IDS = [
	INVENTORY_IDS.browserChannel,
	INVENTORY_IDS.keyboardChannel,
	INVENTORY_IDS.accessibilityTreeChannel,
	INVENTORY_IDS.performanceChannel,
	INVENTORY_IDS.localizationChannel,
] as const;

export function requireAsset(relativePath: string): string | null {
	const path = join(SKILL_ROOT, relativePath);
	const present = existsSync(path);
	expect(present, `missing visual-qa runtime asset: ${relativePath}`).toBe(true);
	return present ? path : null;
}

export function expectSkillText(expected: string): void {
	expect(skillCorpus.includes(expected), `visual-qa lazy skill corpus must document: ${expected}`).toBe(true);
}

export function expectSkillPattern(expected: RegExp, label: string): void {
	expect(expected.test(skillCorpus), `visual-qa lazy skill corpus must document: ${label}`).toBe(true);
}

export function pngWithDeclaredDimensions(width: number, height: number): Buffer {
	const png = Buffer.from(encodeRgbaPng(1, 1, solidRgba(1, 1, [0, 0, 0, 255])));
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
	return png;
}

export function designContract(requiresAuth = false): Record<string, unknown> {
	return uiuxDesignContract({ id: "uiux-red-fixture", authenticated: requiresAuth });
}

function reviewReceipts(
	inputHashes: readonly string[],
): readonly Record<string, unknown>[] {
	return ["product", "evidence"].map((lane) => ({
		schema_id: "litfamily.review-receipt/v1alpha1",
		review_id: `review:${lane}`,
		fresh_context_id: `fresh-context-${lane}`,
		input_hashes: inputHashes,
		independence_assertion: INDEPENDENCE_ASSERTION,
		started_at: "2026-07-24T05:59:40.000Z",
		completed_at: "2026-07-24T05:59:50.000Z",
		timeout: false,
		canceled: false,
		verdict: "PASS",
		findings: [],
	}));
}

export function evidenceManifest(
	inventoryIds: readonly string[],
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		schema_id: "litfamily.evidence-manifest/v1alpha1",
		design_contract_hash: HASH_A,
		source_hash: HASH_A,
		capture_hash: HASH_C,
		created_at: "2026-07-24T05:59:30.000Z",
		maximum_age_seconds: 60,
		environment: {
			surface: "web",
			renderer_identity: "fixture-renderer",
			capture_tool: "fixture-capture",
			locale: "ko-KR",
			color_scheme: "light",
			reduced_motion: false,
			process_owned: true,
			session_owned: true,
		},
		capabilities: { capture: true, auth: true, independent_review: true },
		inventory: inventoryIds.map((id) => ({
			id,
			status: "captured",
			evidence_hash: HASH_C,
			captured_at: "2026-07-24T05:59:20.000Z",
		})),
		review_receipt_hashes: [],
		cleanup: {
			status: "complete",
			temporary_artifacts_removed: true,
			session_terminated: true,
			auth_state_removed: true,
		},
		blockers: [],
		findings: [],
		...overrides,
	};
}

export function invokeEvidenceValidator(
	entrypoint: string,
	tier: "smoke" | "full" | "reference-fidelity",
	contract: Record<string, unknown>,
	manifest: Record<string, unknown>,
) {
	const bundle = evidenceBundle(contract, manifest);
	return spawnSync(process.execPath, [entrypoint, "--tier", tier, "--now", FIXED_NOW], {
		encoding: "utf8",
		input: JSON.stringify(bundle),
	});
}

export function evidenceBundle(
	contract: Record<string, unknown>,
	manifest: Record<string, unknown>,
): Record<string, unknown> {
	const designHash = sha256(canonicalJson(contract));
	const captureBytes = Buffer.from("visual-qa-capture-evidence-v1", "utf8");
	const boundManifest = {
		...manifest,
		design_contract_hash: designHash,
		source_hash: contract.source_hash,
		capture_hash: sha256(captureBytes),
		inventory: (manifest.inventory as Record<string, unknown>[]).map((entry) => {
			if (entry.status !== "captured") return entry;
			const bytes = Buffer.from(`visual-qa-inventory-evidence-v1:${entry.id}`, "utf8");
			return { ...entry, evidence_hash: sha256(bytes) };
		}),
	};
	const inventoryItems = Object.fromEntries(
		(boundManifest.inventory as Record<string, unknown>[])
			.filter((entry) => entry.status === "captured")
			.map((entry) => [
				entry.id,
				Buffer.from(`visual-qa-inventory-evidence-v1:${entry.id}`, "utf8").toString("base64"),
			]),
	);
	const evidenceBytes = {
		manifest: canonicalJson({ ...boundManifest, review_receipt_hashes: [] }),
		inventory: canonicalJson(boundManifest.inventory),
		inventory_items: inventoryItems,
		capture_base64: captureBytes.toString("base64"),
	};
	const receipts = reviewReceipts([
		sha256(evidenceBytes.manifest),
		sha256(canonicalJson({
			inventory: evidenceBytes.inventory,
			inventory_items: evidenceBytes.inventory_items,
		})),
		sha256(captureBytes),
	]);
	const completeManifest = {
		...boundManifest,
		review_receipt_hashes: receipts.map((receipt) => sha256(canonicalJson(receipt))),
	};
	return {
		design_contract: contract,
		evidence_manifest: completeManifest,
		evidence_bytes: evidenceBytes,
		review_receipts: receipts,
	};
}

export function parseValidatorResult(
	result: ReturnType<typeof invokeEvidenceValidator>,
): Record<string, unknown> {
	expect(result.status, result.stderr).toBe(0);
	return JSON.parse(result.stdout) as Record<string, unknown>;
}
