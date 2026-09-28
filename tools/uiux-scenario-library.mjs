import { createHash } from "node:crypto";
import { uiuxDesignContract } from "./uiux-design-contract.mjs";
import { FINDING_SEVERITY, SCENARIOS } from "./uiux-scenario-input.mjs";

const SOURCE_HASH = "a".repeat(64);
const INDEPENDENCE =
	"I reviewed the immutable evidence bytes in a separate fresh context and did not receive another reviewer's draft or verdict.";
const PROBES = {
	"public-service-form-ko": {
		focusOrder: ["submit", "resident-id"],
		expectedFirst: "resident-id",
		contrast: { criterion: "WCAG 1.4.3", ratio: 3.1, minimum: 4.5 },
	},
	"fintech-dashboard": { colorOnly: true, nonvisualFallback: false },
	"healthcare-mobile": { destructiveConfirmation: false, targetSize: 32, minimumTarget: 44, mutationCount: 0 },
	"saas-landing-responsive": {
		clientWidth: 360,
		scrollWidth: 390,
		reducedMotionSupported: false,
	},
	"brownfield-design-system": {
		inlineTokenBypass: true,
		primitiveOccurrences: 2,
		sourcePointer: "tokens/button.css:12",
	},
	"reference-fidelity": {
		referenceSize: "1440x900",
		actualSize: "1280x720",
		actualKind: "screenshot-substitute",
		similarity: 0.99,
		similarityOverride: false,
	},
	"cjk-terminal-dashboard": {
		declaredZwjWidth: 1,
		tui: "\u001b]0;inert-title\u0007┏━━┓\n┃👩‍💻┃\n┗━╋┛",
		expectedColumns: 4,
	},
};
function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalize(value[key])]),
	);
}
const canonicalJson = (value) => `${JSON.stringify(canonicalize(value))}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function contract(name) {
	const auth = name === "healthcare-mobile" || name === "missing-capture-auth-review";
	const brownfield = name === "brownfield-design-system";
	return uiuxDesignContract({ id: name, authenticated: auth, brownfield });
}

function inventory(name) {
	const channels = [
		"channel:browser",
		"channel:keyboard",
		"channel:accessibility-tree",
		"channel:performance",
		"channel:localization",
	];
	const smoke = ["route:primary", "interaction:critical", "viewport:small", "viewport:large", ...channels];
	const full = [
		"route:primary",
		"route:secondary",
		"region:primary",
		"component:primary-action",
		"interaction:critical",
		"state:error",
		"viewport:small",
		"viewport:large",
		...channels,
	];
	const ids =
		name === "reference-fidelity"
			? [...full, "reference:hero"]
			: ["public-service-form-ko", "saas-landing-responsive", "missing-capture-auth-review"].includes(name)
				? smoke
				: full;
	if (name === "brownfield-design-system") ids.push("omission:legacy-shell", "exception:legacy-token");
	return ids;
}

function scenarioPlan(name) {
	const plan = SCENARIOS.find((candidate) => candidate.name === name);
	if (plan === undefined) throw new Error(`SCENARIO_UNKNOWN: ${name}`);
	return plan;
}

export function buildScenario(name) {
	const design = contract(name);
	const missing = name === "missing-capture-auth-review";
	const plan = scenarioPlan(name);
	const entries = inventory(name).map((id) => {
		const status = id.startsWith("omission:")
			? "omitted"
			: id.startsWith("exception:")
				? "accepted-exception"
				: "captured";
		const bytes = Buffer.from(`scenario-item:${name}:${id}`, "utf8");
		return {
			id,
			status,
			evidence_hash: status === "captured" ? sha256(bytes) : sha256(`declared:${id}`),
			captured_at: "2026-07-25T05:59:20.000Z",
		};
	});
	const items = Object.fromEntries(
		entries
			.filter(({ status }) => status === "captured")
			.map(({ id }) => [id, Buffer.from(`scenario-item:${name}:${id}`, "utf8").toString("base64")]),
	);
	const capture = Buffer.from(`scenario-capture:${name}`, "utf8");
	const manifest = {
		schema_id: "litfamily.evidence-manifest/v1alpha1",
		created_at: "2026-07-25T05:59:30.000Z",
		maximum_age_seconds: 60,
		design_contract_hash: sha256(canonicalJson(design)),
		source_hash: SOURCE_HASH,
		capture_hash: sha256(capture),
		environment: {
			surface: name === "cjk-terminal-dashboard" ? "tui" : "web",
			renderer_identity: `scenario-renderer:${name}`,
			capture_tool: "deterministic visual QA scenario driver",
			locale: name === "public-service-form-ko" || name === "cjk-terminal-dashboard" ? "ko-KR" : "en",
			color_scheme: "light",
			reduced_motion: true,
			process_owned: true,
			session_owned: true,
		},
		capabilities: { capture: !missing, auth: !missing, independent_review: !missing },
		inventory: entries,
		review_receipt_hashes: [],
		cleanup: {
			status: "complete",
			temporary_artifacts_removed: true,
			session_terminated: true,
			auth_state_removed: true,
		},
		blockers: [],
		findings: plan.finding_codes.map((code) => ({
			severity: FINDING_SEVERITY[code],
			message: code,
			open: true,
		})),
	};
	const evidence = {
		manifest: canonicalJson(manifest),
		inventory: canonicalJson(entries),
		inventory_items: items,
		capture_base64: capture.toString("base64"),
	};
	const hashes = [
		sha256(evidence.manifest),
		sha256(canonicalJson({ inventory: evidence.inventory, inventory_items: items })),
		sha256(capture),
	];
	const receipts = ["product", "evidence"].map((lane) => ({
		schema_id: "litfamily.review-receipt/v1alpha1",
		review_id: `review:${lane}`,
		fresh_context_id: `fresh-${lane}`,
		input_hashes: hashes,
		independence_assertion: INDEPENDENCE,
		started_at: "2026-07-25T05:59:40.000Z",
		completed_at: "2026-07-25T05:59:50.000Z",
		timeout: false,
		canceled: false,
		verdict: "PASS",
		findings: [],
	}));
	manifest.review_receipt_hashes = receipts.map((receipt) => sha256(canonicalJson(receipt)));
	return { design_contract: design, evidence_manifest: manifest, evidence_bytes: evidence, review_receipts: receipts };
}

const EXPECTED_FACTS = {
	"healthcare-mobile": { mutation_count: 0 },
	"brownfield-design-system": { source_pointer: "tokens/button.css:12" },
	"reference-fidelity": { similarity_override: false },
	"cjk-terminal-dashboard": { osc_inert: true },
};

export function detectScenario(name, checkTui) {
	const probe = PROBES[name];
	const codes = [];
	let facts = {};
	if (name === "public-service-form-ko") {
		if (probe.focusOrder[0] !== probe.expectedFirst) codes.push("FINDING_FOCUS_ORDER_BROKEN");
		if (probe.contrast.criterion === "WCAG 1.4.3" && probe.contrast.ratio < probe.contrast.minimum) {
			codes.push("FINDING_WCAG_1_4_3_CONTRAST");
		}
	} else if (name === "fintech-dashboard") {
		if (probe.colorOnly) codes.push("FINDING_COLOR_ONLY_STATE");
		if (!probe.nonvisualFallback) codes.push("FINDING_NONVISUAL_FALLBACK_MISSING");
	} else if (name === "healthcare-mobile") {
		if (!probe.destructiveConfirmation) codes.push("FINDING_DESTRUCTIVE_ACTION_UNGUARDED");
		if (probe.targetSize < probe.minimumTarget) codes.push("FINDING_TOUCH_TARGET_UNDERSIZED");
		facts = { mutation_count: probe.mutationCount };
	} else if (name === "saas-landing-responsive") {
		if (probe.scrollWidth > probe.clientWidth) codes.push("FINDING_MOBILE_OVERFLOW");
		if (!probe.reducedMotionSupported) codes.push("FINDING_REDUCED_MOTION_UNSUPPORTED");
	} else if (name === "brownfield-design-system") {
		if (probe.inlineTokenBypass) codes.push("FINDING_TOKEN_BYPASS");
		if (probe.primitiveOccurrences > 1) codes.push("FINDING_DUPLICATED_PRIMITIVE");
		facts = { source_pointer: probe.sourcePointer };
	} else if (name === "reference-fidelity") {
		if (probe.referenceSize !== probe.actualSize) codes.push("FINDING_REFERENCE_DIMENSION_MISMATCH");
		if (probe.actualKind === "screenshot-substitute") codes.push("FINDING_SCREENSHOT_SUBSTITUTION");
		facts = { similarity_override: probe.similarityOverride && probe.similarity >= 0.99 };
	} else if (name === "cjk-terminal-dashboard") {
		const tui = checkTui(probe.tui, probe.expectedColumns);
		const measuredZwjWidth = tui.lineWidths[1] - 2;
		if (measuredZwjWidth !== probe.declaredZwjWidth) codes.push("FINDING_ZWJ_WIDTH_DRIFT");
		if (tui.topologyErrors.length > 0) codes.push("FINDING_BORDER_TOPOLOGY");
		facts = { osc_inert: tui.hasAnsi && tui.controlSequencesValid && measuredZwjWidth === 2 };
	} else if (name !== "missing-capture-auth-review") throw new Error(`SCENARIO_UNKNOWN: ${name}`);
	return {
		findings: codes.map((code) => ({ code, severity: FINDING_SEVERITY[code] })),
		facts,
	};
}

export function scenarioAssertions(fixture, detection, evaluation) {
	const findingCodes = detection.findings.map(({ code }) => code);
	const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
	const assertions = [
		["verdict", fixture.expected, evaluation.verdict],
		["finding-codes", fixture.finding_codes, findingCodes],
		["blocked-codes", fixture.blocked_codes, evaluation.blocked_codes],
		["review-round-bound", true, fixture.review_rounds >= 1 && fixture.review_rounds <= 2],
		["zero-false-pass", true, fixture.expected === "PASS" || evaluation.verdict !== "PASS"],
	];
	for (const [key, expected] of Object.entries(EXPECTED_FACTS[fixture.name] ?? {})) {
		assertions.push([key, expected, detection.facts[key]]);
	}
	return assertions.map(([assertion, expected, actual]) => ({
		assertion,
		expected,
		actual,
		pass: Array.isArray(expected) ? same(expected, actual) : expected === actual,
	}));
}
