import { isMain } from "./entrypoint.mjs";
import { isRecord, readStdinJson } from "./strict-input.mjs";
import { REVIEW_SCHEMA } from "./types.mjs";

export const INDEPENDENCE_ASSERTION =
	"I reviewed the immutable evidence bytes in a separate fresh context and did not receive another reviewer's draft or verdict.";
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/-]*$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const KEYS = new Set([
	"schema_id", "review_id", "fresh_context_id", "input_hashes", "independence_assertion",
	"started_at", "completed_at", "timeout", "canceled", "verdict", "findings",
]);
const FINDING_KEYS = new Set(["severity", "message", "open"]);

function timestamp(value) {
	if (typeof value !== "string" || !TIMESTAMP.test(value)) return false;
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return false;
	const canonical = new Date(parsed).toISOString();
	return canonical === value || canonical.replace(".000Z", "Z") === value;
}

export function validateReviewReceipt(value) {
	const issues = [];
	if (!isRecord(value)) return { valid: false, issues: ["receipt root must be an object"] };
	for (const key of Object.keys(value)) if (!KEYS.has(key)) issues.push(`unknown receipt key ${key}`);
	if (value.schema_id !== REVIEW_SCHEMA) issues.push(`schema_id must be ${REVIEW_SCHEMA}`);
	if (typeof value.review_id !== "string" || !ID.test(value.review_id)) issues.push("review_id is invalid");
	if (typeof value.fresh_context_id !== "string" || value.fresh_context_id.length === 0) issues.push("fresh_context_id is required");
	if (!Array.isArray(value.input_hashes) || value.input_hashes.length !== 3 ||
		value.input_hashes.some((hash) => typeof hash !== "string" || !HASH.test(hash))) {
		issues.push("input_hashes must contain exactly three SHA-256 values");
	}
	if (value.independence_assertion !== INDEPENDENCE_ASSERTION) issues.push("independence_assertion is not exact");
	if (!timestamp(value.started_at) || !timestamp(value.completed_at) ||
		Date.parse(value.completed_at) < Date.parse(value.started_at)) issues.push("review timestamps are invalid");
	if (typeof value.timeout !== "boolean") issues.push("timeout must be boolean");
	if (typeof value.canceled !== "boolean") issues.push("canceled must be boolean");
	if (!["PASS", "REVISE", "FAIL"].includes(value.verdict)) issues.push("review verdict is invalid");
	if (!Array.isArray(value.findings)) issues.push("findings must be an array");
	else for (const finding of value.findings) {
		if (!isRecord(finding) || !["critical", "high", "major", "minor"].includes(finding.severity) ||
			typeof finding.message !== "string" || finding.message.trim().length === 0 ||
			typeof finding.open !== "boolean") issues.push("finding is invalid");
		else for (const key of Object.keys(finding)) if (!FINDING_KEYS.has(key)) issues.push(`finding contains unknown key ${key}`);
	}
	return { valid: issues.length === 0, schema: REVIEW_SCHEMA, issues };
}

export function reviewEligibility(value) {
	const structural = validateReviewReceipt(value);
	const issues = [...structural.issues];
	const blocked = [];
	if (!structural.valid || !isRecord(value)) return { eligible: false, issues, blocked };
	if (value.timeout === true || value.canceled === true) blocked.push("BLOCKED_REVIEW_TIMEOUT");
	if (value.verdict !== "PASS") issues.push("review verdict must be PASS");
	for (const finding of value.findings) {
		if (finding.open === true && ["critical", "high", "major"].includes(finding.severity)) {
			issues.push("receipt contains an open blocking finding");
		}
	}
	return { eligible: issues.length === 0 && blocked.length === 0, issues, blocked };
}

function main() {
	const result = validateReviewReceipt(readStdinJson(128 * 1024, "REVIEW_RECEIPT_INVALID"));
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (!result.valid) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`REVIEW_RECEIPT_INVALID: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 2;
	}
}
