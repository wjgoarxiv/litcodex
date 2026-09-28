import { resolve } from "node:path";

import {
	validateDesignContract,
} from "./validate-design-contract.mjs";
import { evidenceByteHashes } from "./evidence-bytes.mjs";
import { isMain } from "./entrypoint.mjs";
import { decodePng } from "./png-decode.mjs";
import {
	canonicalJson,
	isRecord,
	readBoundedJsonFile,
	readRegularBytesWithin,
	readStdinJson,
	sha256,
} from "./strict-input.mjs";
import {
	DESIGN_SCHEMA,
	DESIGN_SCHEMA_BETA,
	DESIGN_SCHEMA_BETA2,
	EVIDENCE_SCHEMA,
	EVIDENCE_SCHEMA_BETA,
	TIERS,
} from "./types.mjs";
import { reviewEligibility, validateReviewReceipt } from "./validate-review-receipt.mjs";

const HASH = /^[0-9a-f]{64}$/;
const BLOCKER = /^BLOCKED_[A-Z0-9_]+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CAPTURE_PATH = /^(?!\/)(?!\\)(?![A-Za-z]:[\\/])(?!.*\.\.).{1,512}$/u;
const MANIFEST_KEYS = new Set([
	"schema_id", "created_at", "maximum_age_seconds", "design_contract_hash", "source_hash",
	"capture_hash", "environment", "capabilities", "inventory", "review_receipt_hashes", "cleanup", "blockers", "findings",
]);
const BETA_MANIFEST_KEYS = new Set([
	...MANIFEST_KEYS,
	"capture_path",
	"capture_byte_length",
	"capture_width",
	"capture_height",
]);
const CAPABILITY_KEYS = new Set(["capture", "auth", "independent_review"]);
const ENVIRONMENT_KEYS = new Set([
	"surface",
	"renderer_identity",
	"capture_tool",
	"locale",
	"color_scheme",
	"reduced_motion",
	"process_owned",
	"session_owned",
]);
const CLEANUP_KEYS = new Set(["status", "temporary_artifacts_removed", "session_terminated", "auth_state_removed"]);
const INVENTORY_KEYS = new Set(["id", "status", "evidence_hash", "captured_at"]);
const FINDING_KEYS = new Set(["severity", "message", "open"]);

function unknownKeys(value, allowed, label, issues) {
	for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`${label} contains unknown key ${key}`);
}

function timestampMs(value) {
	if (typeof value !== "string" || !TIMESTAMP.test(value)) return Number.NaN;
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return Number.NaN;
	const canonical = new Date(parsed).toISOString();
	return canonical === value || canonical.replace(".000Z", "Z") === value ? parsed : Number.NaN;
}

function argsOf(args) {
	if (![4, 6, 8].includes(args.length) || args.length % 2 !== 0 ||
		new Set(args.filter((item) => item.startsWith("--"))).size !== args.length / 2 ||
		!args.includes("--tier") || !args.includes("--now") ||
		args.some((item, index) => index % 2 === 0 && !["--input", "--tier", "--now", "--evidence-root"].includes(item))) {
		throw new Error("ARGUMENT_INVALID");
	}
	const get = (name) => {
		const index = args.indexOf(name);
		return index < 0 ? undefined : args[index + 1];
	};
	const tier = get("--tier");
	const now = get("--now");
	if (!TIERS.includes(tier)) throw new Error("TIER_INVALID");
	const nowMs = timestampMs(now);
	if (!Number.isFinite(nowMs)) throw new Error("NOW_INVALID");
	return { input: get("--input"), tier, now: new Date(nowMs), evidenceRoot: get("--evidence-root") };
}

function contractInventory(contract, tier) {
	const inventory = contract.inventory;
	const byWidth = [...inventory.viewports].sort((left, right) => left.width - right.width);
	const smoke = [
		...inventory.routes.filter((item) => item.primary).map((item) => item.id),
		...inventory.interactions.filter((item) => item.critical).map((item) => item.id),
		byWidth[0]?.id,
		byWidth.at(-1)?.id,
		...contract.evidence_policy.required_channels.map((channel) => `channel:${channel}`),
		...contract.omissions.map((item) => item.id),
		...contract.accepted_exceptions.map((item) => item.id),
	].filter(Boolean);
	const full = [
		...inventory.routes,
		...inventory.regions,
		...inventory.components,
		...inventory.interactions,
		...inventory.states,
		...inventory.viewports,
	]
		.map((item) => item.id)
		.concat(
			contract.evidence_policy.required_channels.map((channel) => `channel:${channel}`),
			contract.omissions.map((item) => item.id),
			contract.accepted_exceptions.map((item) => item.id),
		);
	const ids = [...new Set(tier === "smoke" ? smoke : tier === "full" ? full : full.concat(inventory.references.map((item) => item.id)))];
	const omissions = new Set(contract.omissions.map((item) => item.id));
	const exceptions = new Set(contract.accepted_exceptions.map((item) => item.id));
	return new Map(ids.map((id) => [id, omissions.has(id) ? "omitted" : exceptions.has(id) ? "accepted-exception" : "captured"]));
}

function validateManifest(manifest, contract, tier, now) {
	const issues = [];
	const blocked = [];
	if (!isRecord(manifest)) return { issues: ["manifest root must be an object"], blocked };
	const beta = manifest.schema_id === EVIDENCE_SCHEMA_BETA;
	const allowed = beta ? BETA_MANIFEST_KEYS : MANIFEST_KEYS;
	for (const key of Object.keys(manifest)) if (!allowed.has(key)) issues.push(`unknown manifest key ${key}`);
	if (![EVIDENCE_SCHEMA, EVIDENCE_SCHEMA_BETA].includes(manifest.schema_id)) {
		issues.push(`schema_id must be ${EVIDENCE_SCHEMA} or ${EVIDENCE_SCHEMA_BETA}`);
	}
	if (beta) {
		if (typeof manifest.capture_path !== "string" || !CAPTURE_PATH.test(manifest.capture_path)) {
			issues.push("capture_path must be a relative path of at most 512 characters");
		}
		if (!Number.isInteger(manifest.capture_byte_length) || manifest.capture_byte_length < 1 || manifest.capture_byte_length > 25 * 1024 * 1024) {
			issues.push("capture_byte_length is invalid");
		}
		for (const key of ["capture_width", "capture_height"]) {
			if (!Number.isInteger(manifest[key]) || manifest[key] < 1 || manifest[key] > 16384) issues.push(`${key} is invalid`);
		}
	}
	if (!Array.isArray(manifest.review_receipt_hashes)) {
		issues.push("review_receipt_hashes must be an array");
	} else {
		if ((beta && manifest.review_receipt_hashes.length > 2) || (!beta && manifest.review_receipt_hashes.length !== 2)) {
			issues.push(`review_receipt_hashes must contain ${beta ? "at most two" : "exactly two"} hashes`);
		}
		if (manifest.review_receipt_hashes.some((hash) => typeof hash !== "string" || !HASH.test(hash))) {
			issues.push("review_receipt_hashes contains an invalid hash");
		}
	}
	for (const key of ["design_contract_hash", "source_hash", "capture_hash"]) {
		if (typeof manifest[key] !== "string" || !HASH.test(manifest[key])) issues.push(`${key} is invalid`);
	}
	const created = timestampMs(manifest.created_at);
	const ageLimit = manifest.maximum_age_seconds;
	if (!Number.isFinite(created) || !Number.isInteger(ageLimit) || ageLimit < 1 || ageLimit > 86400) issues.push("freshness fields are invalid");
	else if (created > now.getTime()) blocked.push("BLOCKED_EVIDENCE_FUTURE");
	else if (now.getTime() - created > ageLimit * 1000) blocked.push("BLOCKED_EVIDENCE_STALE");
	if (!isRecord(manifest.environment)) {
		issues.push("environment must be an object");
	} else {
		unknownKeys(manifest.environment, ENVIRONMENT_KEYS, "environment", issues);
		if (!["web", "application", "tui"].includes(manifest.environment.surface)) {
			issues.push("environment.surface is invalid");
		}
		for (const key of ["renderer_identity", "capture_tool"]) {
			if (typeof manifest.environment[key] !== "string" || manifest.environment[key].trim().length === 0) {
				issues.push(`environment.${key} is required`);
			}
		}
		if (typeof manifest.environment.locale !== "string" || [...manifest.environment.locale].length < 2) {
			issues.push("environment.locale must contain at least two characters");
		}
		if (!["light", "dark", "system"].includes(manifest.environment.color_scheme)) {
			issues.push("environment.color_scheme is invalid");
		}
		for (const key of ["reduced_motion", "process_owned", "session_owned"]) {
			if (typeof manifest.environment[key] !== "boolean") issues.push(`environment.${key} must be boolean`);
		}
		if (manifest.environment.process_owned !== true || manifest.environment.session_owned !== true) {
			blocked.push("BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED");
		}
	}
	const capabilities = isRecord(manifest.capabilities) ? manifest.capabilities : {};
	if (!isRecord(manifest.capabilities)) issues.push("capabilities must be an object");
	else {
		unknownKeys(manifest.capabilities, CAPABILITY_KEYS, "capabilities", issues);
		for (const key of CAPABILITY_KEYS) {
			if (typeof manifest.capabilities[key] !== "boolean") issues.push(`capabilities.${key} must be boolean`);
		}
	}
	if (capabilities.capture !== true) blocked.push("BLOCKED_RENDERER_UNAVAILABLE");
	if (capabilities.independent_review !== true && !(beta && tier === "smoke")) {
		blocked.push("BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE");
	}
	const auth = contract.inventory.authenticated_surfaces;
	if (auth.length > 0 && capabilities.auth !== true) blocked.push("BLOCKED_AUTH_UNAVAILABLE");
	if (auth.some((item) => item.safe_test_account !== true)) blocked.push("BLOCKED_TEST_ACCOUNT_UNSAFE");
	if (!Array.isArray(manifest.blockers)) issues.push("blockers must be an array");
	else for (const code of manifest.blockers) {
		if (typeof code === "string" && BLOCKER.test(code)) blocked.push(code);
		else issues.push("blocker code is invalid");
	}
	if (!Array.isArray(manifest.findings)) issues.push("findings must be an array");
	else for (const finding of manifest.findings) {
		if (!isRecord(finding) || !["critical", "high", "major", "minor"].includes(finding.severity) ||
			typeof finding.message !== "string" || finding.message.trim().length === 0 ||
			typeof finding.open !== "boolean") issues.push("manifest finding is invalid");
		else {
			unknownKeys(finding, FINDING_KEYS, "finding", issues);
			if (finding.open && ["critical", "high", "major"].includes(finding.severity)) {
				issues.push("manifest contains an open blocking finding");
			}
		}
	}
	const cleanup = manifest.cleanup;
	if (!isRecord(cleanup) || cleanup.status !== "complete" || cleanup.temporary_artifacts_removed !== true ||
		cleanup.session_terminated !== true || cleanup.auth_state_removed !== true) issues.push("cleanup is incomplete");
	else unknownKeys(cleanup, CLEANUP_KEYS, "cleanup", issues);
	return { issues, blocked };
}

function materialCapture(manifest, evidenceRoot) {
	if (manifest.schema_id !== EVIDENCE_SCHEMA_BETA) return { bytes: undefined, issues: [] };
	if (typeof evidenceRoot !== "string" || evidenceRoot.length === 0) {
		return { bytes: undefined, issues: ["beta evidence requires a caller-authorized evidence root"] };
	}
	try {
		const bytes = readRegularBytesWithin(
			resolve(evidenceRoot, manifest.capture_path),
			evidenceRoot,
			25 * 1024 * 1024,
			"EVIDENCE_CAPTURE_INVALID",
		);
		if (bytes.length !== manifest.capture_byte_length || sha256(bytes) !== manifest.capture_hash) {
			return { bytes, issues: ["material capture bytes do not match the beta manifest"] };
		}
		const png = decodePng(bytes);
		if (png.width !== manifest.capture_width || png.height !== manifest.capture_height) {
			return { bytes, issues: ["material capture dimensions do not match the beta manifest"] };
		}
		return { bytes, issues: [] };
	} catch (error) {
		return { bytes: undefined, issues: [`material capture is unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`] };
	}
}

function reviewIssues(receipts, manifest, expectedInputs, now) {
	const issues = [];
	const blocked = [];
	if (!Array.isArray(receipts) || receipts.length !== 2) return { issues: ["exactly two review receipts are required"], blocked };
	const contexts = new Set();
	const hashes = [];
	for (const receipt of receipts) {
		const structural = validateReviewReceipt(receipt);
		const eligibility = reviewEligibility(receipt);
		if (!structural.valid) issues.push(...structural.issues.map((issue) => `review: ${issue}`));
		else issues.push(...eligibility.issues.map((issue) => `review: ${issue}`));
		blocked.push(...eligibility.blocked);
		if (isRecord(receipt)) {
			contexts.add(receipt.fresh_context_id);
			if (JSON.stringify(receipt.input_hashes) !== JSON.stringify(expectedInputs)) issues.push("review input hashes do not match immutable inputs");
			const started = timestampMs(receipt.started_at);
			const completed = timestampMs(receipt.completed_at);
			const captured = timestampMs(manifest.created_at);
			if (Number.isFinite(started) && Number.isFinite(captured) && started < captured) {
				issues.push("review started before evidence capture");
			}
			if ((Number.isFinite(started) && started > now.getTime()) ||
				(Number.isFinite(completed) && completed > now.getTime())) {
				issues.push("review timestamp is after validation clock");
			}
			hashes.push(sha256(canonicalJson(receipt)));
		}
	}
	if (contexts.size !== 2) issues.push("review contexts must be distinct");
	if (!Array.isArray(manifest.review_receipt_hashes) || JSON.stringify(manifest.review_receipt_hashes) !== JSON.stringify(hashes)) {
		issues.push("review receipt hashes do not match receipt bytes");
	}
	return { issues, blocked };
}

export function validateEvidence(input, tier, now, { evidenceRoot } = {}) {
	if (
		!isRecord(input) ||
		!isRecord(input.evidence_manifest) ||
		!Array.isArray(input.review_receipts) ||
		!isRecord(input.evidence_bytes)
	) {
		throw new Error("EVIDENCE_INPUT_INVALID");
	}
	const contractResult = validateDesignContract(input.design_contract);
	const issues = contractResult.valid ? [] : contractResult.issues.map((issue) => `design: ${issue}`);
	if (contractResult.schema === DESIGN_SCHEMA) {
		issues.push("design: v1alpha1 is migration-only and cannot produce evidence PASS");
	}
	const contract = input.design_contract;
	const beta = input.evidence_manifest.schema_id === EVIDENCE_SCHEMA_BETA;
	const expectedDesignSchemas = beta ? [DESIGN_SCHEMA_BETA, DESIGN_SCHEMA_BETA2] : [DESIGN_SCHEMA];
	if (!contractResult.valid || !isRecord(contract) || !expectedDesignSchemas.includes(contract.schema_id) || !isRecord(contract.inventory)
		|| (beta && contractResult.evidence_eligible !== true)
	) {
		return { verdict: "FAIL", tier, blocked_codes: [], missing_inventory: [], validation_errors: issues };
	}
	const manifest = input.evidence_manifest;
	const manifestResult = validateManifest(manifest, contract, tier, now);
	issues.push(...manifestResult.issues);
	const designHash = sha256(canonicalJson(contract));
	if (manifest.design_contract_hash !== designHash) issues.push("design_contract_hash does not match contract bytes");
	if (manifest.source_hash !== contract.source_hash) issues.push("source_hash does not match design contract");
	const submittedEvidenceBytes = evidenceByteHashes(input.evidence_bytes, manifest);
	issues.push(...submittedEvidenceBytes.issues);
	const material = materialCapture(manifest, evidenceRoot);
	issues.push(...material.issues);
	const evidenceBytesInput = beta && material.bytes !== undefined
		? { ...input.evidence_bytes, capture_base64: material.bytes.toString("base64") }
		: input.evidence_bytes;
	const evidenceBytes = evidenceByteHashes(evidenceBytesInput, manifest);
	if (evidenceBytesInput !== input.evidence_bytes) issues.push(...evidenceBytes.issues);
	const expectedInputs = evidenceBytes.hashes;
	let reviews;
	if (beta && tier === "smoke") {
		reviews = input.review_receipts.length === 0 && Array.isArray(manifest.review_receipt_hashes) && manifest.review_receipt_hashes.length === 0
			? { issues: [], blocked: [] }
			: { issues: ["beta smoke evidence must not carry self-attested review receipts"], blocked: [] };
	} else if (beta) {
		// Codex reviewer output is model-supplied JSON. No current host API provides an
		// origin attestation, so a higher-tier beta receipt remains honestly blocked.
		reviews = { issues: [], blocked: ["BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE"] };
	} else {
		reviews = reviewIssues(input.review_receipts, manifest, expectedInputs, now);
	}
	issues.push(...reviews.issues);
	const expected = contractInventory(contract, tier);
	const entries = Array.isArray(manifest.inventory) ? manifest.inventory : [];
	const blockedCodesForEntry = [];
	const manifestCreated = timestampMs(manifest.created_at);
	if (!Array.isArray(manifest.inventory)) issues.push("manifest inventory must be an array");
	const captured = new Set();
	for (const entry of entries) {
		if (!isRecord(entry) || typeof entry.id !== "string" || !["captured", "omitted", "accepted-exception"].includes(entry.status) ||
			typeof entry.evidence_hash !== "string" || !HASH.test(entry.evidence_hash) ||
			!Number.isFinite(timestampMs(entry.captured_at))) issues.push("manifest inventory entry is invalid");
		else {
			unknownKeys(entry, INVENTORY_KEYS, "inventory entry", issues);
			if (captured.has(entry.id)) issues.push(`duplicate inventory: ${entry.id}`);
			captured.add(entry.id);
			if (expected.get(entry.id) !== entry.status) issues.push(`inventory status mismatch for ${entry.id}`);
			const observed = timestampMs(entry.captured_at);
			if (Number.isFinite(manifestCreated) && observed > manifestCreated) {
				issues.push(`inventory ${entry.id} was captured after manifest creation`);
			}
			if (observed > now.getTime()) blockedCodesForEntry.push("BLOCKED_EVIDENCE_FUTURE");
			else if (Number.isInteger(manifest.maximum_age_seconds) &&
				now.getTime() - observed > manifest.maximum_age_seconds * 1000) {
				blockedCodesForEntry.push("BLOCKED_EVIDENCE_STALE");
			}
		}
	}
	const missing = [...expected.keys()].filter((id) => !captured.has(id));
	const unexpected = [...captured].filter((id) => !expected.has(id));
	if (unexpected.length > 0) issues.push(`unexpected inventory: ${unexpected.join(",")}`);
	const blockedCodes = [...new Set([...manifestResult.blocked, ...reviews.blocked, ...blockedCodesForEntry])].sort();
	const verdict = blockedCodes.length > 0 ? "BLOCKED" : issues.length > 0 || missing.length > 0 ? "FAIL" : "PASS";
	return {
		verdict,
		tier,
		blocked_codes: blockedCodes,
		missing_inventory: missing,
		validation_errors: issues,
		evidence_eligible: beta && verdict === "PASS",
	};
}

function main(args) {
	const options = argsOf(args);
	const input = options.input === undefined
		? readStdinJson(1024 * 1024, "EVIDENCE_INVALID")
		: readBoundedJsonFile(options.input, 1024 * 1024, "EVIDENCE_INVALID");
	process.stdout.write(`${JSON.stringify(validateEvidence(input, options.tier, options.now, {
		evidenceRoot: options.evidenceRoot,
	}))}\n`);
}

if (isMain(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`EVIDENCE_INVALID: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 2;
	}
}
