import { isMain } from "./entrypoint.mjs";
import { InputError, isRecord, readBoundedJsonFile, readStdinJson } from "./strict-input.mjs";
import { DESIGN_SCHEMA, DESIGN_SCHEMA_BETA, DESIGN_SCHEMA_BETA2 } from "./types.mjs";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._/-]*$/;
const STATE_KINDS = new Set(["loading", "empty", "error", "success", "disabled", "permission", "offline", "ready"]);
const INPUT_MODES = new Set(["keyboard", "pointer", "touch", "voice", "switch"]);
const VIEWPORT_CATEGORIES = new Set(["compact", "medium", "expanded"]);
const REFERENCE_KINDS = new Set(["user-provided", "repo-local", "generated", "measured"]);
const TOKEN_STRATEGIES = new Set(["reuse", "extend", "create"]);
const EVIDENCE_CHANNELS = new Set([
	"tests",
	"browser",
	"keyboard",
	"accessibility-tree",
	"screen-reader",
	"performance",
	"localization",
]);
const LANES = new Set(["new-build", "brownfield", "redesign", "reference-fidelity", "design-system"]);
const TOKEN_CATEGORIES = new Set(["color", "typography", "spacing", "radius", "shadow", "motion", "other"]);
const MOTION_POLICIES = new Set(["none", "functional", "expressive"]);
const VERIFICATION_METHODS = new Set([...EVIDENCE_CHANNELS, "manual"]);
const TASTE_KEYS = new Set(["variance", "motion", "density"]);
const ROOT_KEYS = new Set([
	"schema_id",
	"contract_id",
	"source_hash",
	"intent",
	"direction",
	"inventory",
	"accessibility",
	"localization",
	"performance",
	"evidence_policy",
	"omissions",
	"accepted_exceptions",
]);
const BETA_ROOT_KEYS = new Set([
	...ROOT_KEYS,
	"lane",
	"tokens",
	"component_behaviors",
	"responsive_transformations",
	"motion",
	"acceptance_criteria",
]);
const BETA2_ROOT_KEYS = new Set([...BETA_ROOT_KEYS, "taste"]);
const INVENTORY_KEYS = new Set([
	"routes",
	"regions",
	"components",
	"interactions",
	"states",
	"viewports",
	"references",
	"authenticated_surfaces",
]);

function unknownKeys(value, allowed, label, issues) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) issues.push(`${label} contains unknown key ${key}`);
	}
}

function nonEmpty(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function boundedText(value, label, issues) {
	if (!nonEmpty(value)) issues.push(`${label} is required`);
	else if ([...value].length > 512) issues.push(`${label} must be at most 512 characters`);
}

function validId(value) {
	return typeof value === "string" && ID.test(value);
}

function typedId(value, prefix) {
	return validId(value) && value.startsWith(`${prefix}:`);
}

function array(value, label, issues) {
	if (!Array.isArray(value)) {
		issues.push(`${label} must be an array`);
		return [];
	}
	return value;
}

function records(value, label, issues) {
	return array(value, label, issues).filter((item, index) => {
		if (isRecord(item)) return true;
		issues.push(`${label}[${index}] must be an object`);
		return false;
	});
}

function stringList(value, label, issues, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
	const items = array(value, label, issues);
	if (items.length < minimum || items.length > maximum) {
		issues.push(`${label} must contain ${minimum} through ${Number.isFinite(maximum) ? maximum : "any"} items`);
	}
	if (items.some((item) => !nonEmpty(item))) issues.push(`${label} entries must be non-empty strings`);
	if (new Set(items).size !== items.length) issues.push(`${label} entries must be unique`);
	return items;
}

function enumList(value, label, choices, issues) {
	const items = array(value, label, issues);
	if (items.length === 0) issues.push(`${label} must not be empty`);
	if (items.some((item) => !choices.has(item))) issues.push(`${label} contains an unsupported value`);
	if (new Set(items).size !== items.length) issues.push(`${label} entries must be unique`);
	return items;
}

function addTypedId(item, prefix, label, ids, issues) {
	if (!typedId(item.id, prefix)) issues.push(`${label} id must use the ${prefix}: prefix`);
	ids.push(item.id);
}

function validateIntent(value, issues) {
	if (!isRecord(value)) {
		issues.push("intent must be an object");
		return;
	}
	unknownKeys(value, new Set(["audiences", "tasks", "qualities", "constraints", "non_goals"]), "intent", issues);
	stringList(value.audiences, "intent.audiences", issues, 1);
	stringList(value.tasks, "intent.tasks", issues, 1);
	stringList(value.qualities, "intent.qualities", issues, 1);
	stringList(value.constraints, "intent.constraints", issues);
	stringList(value.non_goals, "intent.non_goals", issues);
}

function validateDirection(value, issues) {
	if (!isRecord(value)) {
		issues.push("direction must be an object");
		return;
	}
	unknownKeys(value, new Set(["name", "principles", "token_strategy", "voice"]), "direction", issues);
	if (!nonEmpty(value.name)) issues.push("direction.name is required");
	stringList(value.principles, "direction.principles", issues, 3, 7);
	if (!TOKEN_STRATEGIES.has(value.token_strategy)) issues.push("direction.token_strategy is invalid");
	if (!nonEmpty(value.voice)) issues.push("direction.voice is required");
}

function validateInventory(value, issues) {
	if (!isRecord(value)) {
		issues.push("inventory must be an object");
		return [];
	}
	unknownKeys(value, INVENTORY_KEYS, "inventory", issues);
	const routes = records(value.routes, "inventory.routes", issues);
	const regions = records(value.regions, "inventory.regions", issues);
	const components = records(value.components, "inventory.components", issues);
	const interactions = records(value.interactions, "inventory.interactions", issues);
	const states = records(value.states, "inventory.states", issues);
	const viewports = records(value.viewports, "inventory.viewports", issues);
	const references = records(value.references, "inventory.references", issues);
	const authenticated = records(value.authenticated_surfaces, "inventory.authenticated_surfaces", issues);
	const ids = [];

	if (routes.length === 0) issues.push("inventory requires at least one route");
	if (!routes.some((item) => item.primary === true)) issues.push("inventory requires a primary route");
	if (regions.length === 0) issues.push("inventory requires at least one region");
	if (components.length === 0) issues.push("inventory requires at least one component");
	if (interactions.length === 0) issues.push("inventory requires at least one interaction");
	if (!interactions.some((item) => item.critical === true)) issues.push("inventory requires a critical interaction");
	if (states.length === 0) issues.push("inventory requires at least one state");
	if (viewports.length < 2) issues.push("inventory requires at least two viewports");

	for (const item of routes) {
		unknownKeys(item, new Set(["id", "path", "primary", "auth_required"]), "route", issues);
		addTypedId(item, "route", "route", ids, issues);
		if (!nonEmpty(item.path)) issues.push("route path is required");
		if (typeof item.primary !== "boolean" || typeof item.auth_required !== "boolean") {
			issues.push("route flags must be boolean");
		}
	}
	for (const item of regions) {
		unknownKeys(item, new Set(["id", "route_id"]), "region", issues);
		addTypedId(item, "region", "region", ids, issues);
		if (!typedId(item.route_id, "route")) issues.push("region route_id is invalid");
	}
	for (const item of components) {
		unknownKeys(item, new Set(["id", "region_id"]), "component", issues);
		addTypedId(item, "component", "component", ids, issues);
		if (!typedId(item.region_id, "region")) issues.push("component region_id is invalid");
	}
	for (const item of interactions) {
		unknownKeys(item, new Set(["id", "route_id", "critical", "input_modes"]), "interaction", issues);
		addTypedId(item, "interaction", "interaction", ids, issues);
		if (!typedId(item.route_id, "route")) issues.push("interaction route_id is invalid");
		if (typeof item.critical !== "boolean") issues.push("interaction critical must be boolean");
		enumList(item.input_modes, `interaction ${item.id} input_modes`, INPUT_MODES, issues);
	}
	for (const item of states) {
		unknownKeys(item, new Set(["id", "route_id", "kind"]), "state", issues);
		addTypedId(item, "state", "state", ids, issues);
		if (!typedId(item.route_id, "route")) issues.push("state route_id is invalid");
		if (!STATE_KINDS.has(item.kind)) issues.push("state kind is invalid");
	}
	for (const item of viewports) {
		unknownKeys(item, new Set(["id", "width", "height", "category"]), "viewport", issues);
		addTypedId(item, "viewport", "viewport", ids, issues);
		if (
			!Number.isInteger(item.width) ||
			!Number.isInteger(item.height) ||
			item.width < 240 ||
			item.height < 240 ||
			item.width > 16384 ||
			item.height > 16384
		) {
			issues.push("viewport dimensions are invalid");
		}
		if (!VIEWPORT_CATEGORIES.has(item.category)) issues.push("viewport category is invalid");
	}
	for (const item of references) {
		unknownKeys(item, new Set(["id", "sha256", "kind", "label"]), "reference", issues);
		addTypedId(item, "reference", "reference", ids, issues);
		if (typeof item.sha256 !== "string" || !HASH.test(item.sha256)) issues.push("reference sha256 is invalid");
		if (!REFERENCE_KINDS.has(item.kind)) issues.push("reference kind is invalid");
		if (!nonEmpty(item.label)) issues.push("reference label is required");
	}
	for (const item of authenticated) {
		unknownKeys(item, new Set(["route_id", "owner", "safe_test_account"]), "authenticated surface", issues);
		if (!typedId(item.route_id, "route")) issues.push("authenticated surface route_id is invalid");
		if (!nonEmpty(item.owner)) issues.push("authenticated surface owner is required");
		if (typeof item.safe_test_account !== "boolean") issues.push("safe_test_account must be boolean");
	}

	if (ids.some((id) => !validId(id))) issues.push("every inventory item requires a stable id");
	if (new Set(ids).size !== ids.length) issues.push("inventory ids must be globally unique");
	const routeIds = new Set(routes.map((item) => item.id));
	const regionIds = new Set(regions.map((item) => item.id));
	for (const item of regions) {
		if (!routeIds.has(item.route_id)) issues.push(`region ${item.id} links to an unknown route`);
	}
	for (const item of components) {
		if (!regionIds.has(item.region_id)) issues.push(`component ${item.id} links to an unknown region`);
	}
	for (const item of [...interactions, ...states]) {
		if (!routeIds.has(item.route_id)) issues.push(`${item.id} links to an unknown route`);
	}
	const authByRoute = new Map();
	for (const surface of authenticated) {
		if (!routeIds.has(surface.route_id)) issues.push(`authenticated surface ${surface.route_id} links to an unknown route`);
		if (authByRoute.has(surface.route_id)) issues.push(`authenticated surface ${surface.route_id} is duplicated`);
		authByRoute.set(surface.route_id, surface);
	}
	for (const route of routes) {
		const surface = authByRoute.get(route.id);
		if (route.auth_required === true && surface === undefined) {
			issues.push(`authenticated route ${route.id} lacks an authenticated surface`);
		}
		if (route.auth_required === false && surface !== undefined) {
			issues.push(`public route ${route.id} must not declare an authenticated surface`);
		}
		if (surface !== undefined && surface.safe_test_account !== true) {
			issues.push(`authenticated route ${route.id} lacks a safe test account`);
		}
	}
	return ids;
}

function validateAccessibility(value, issues) {
	if (!isRecord(value)) {
		issues.push("accessibility must be an object");
		return;
	}
	unknownKeys(
		value,
		new Set(["target", "keyboard", "screen_reader", "reduced_motion", "forced_colors", "zoom_percent"]),
		"accessibility",
		issues,
	);
	if (value.target !== "WCAG 2.2 AA") issues.push("accessibility target must be WCAG 2.2 AA");
	for (const key of ["keyboard", "screen_reader", "reduced_motion", "forced_colors"]) {
		if (typeof value[key] !== "boolean") issues.push(`accessibility.${key} must be boolean`);
	}
	if (!Number.isInteger(value.zoom_percent) || value.zoom_percent < 200 || value.zoom_percent > 400) {
		issues.push("accessibility.zoom_percent must be from 200 through 400");
	}
}

function validateLocalization(value, issues) {
	if (!isRecord(value)) {
		issues.push("localization must be an object");
		return;
	}
	unknownKeys(
		value,
		new Set([
			"locales",
			"text_expansion_percent",
			"cjk_line_break_review",
			"font_fallback_review",
			"ime_review",
			"rtl_review",
		]),
		"localization",
		issues,
	);
	stringList(value.locales, "localization.locales", issues, 1);
	if (
		!Number.isInteger(value.text_expansion_percent) ||
		value.text_expansion_percent < 0 ||
		value.text_expansion_percent > 300
	) {
		issues.push("localization.text_expansion_percent must be from 0 through 300");
	}
	for (const key of ["cjk_line_break_review", "font_fallback_review", "ime_review", "rtl_review"]) {
		if (typeof value[key] !== "boolean") issues.push(`localization.${key} must be boolean`);
	}
}

function boundedNumber(value, label, minimum, maximum, issues, integer = false) {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < minimum ||
		value > maximum ||
		(integer && !Number.isInteger(value))
	) {
		issues.push(`${label} must be ${integer ? "an integer" : "a number"} from ${minimum} through ${maximum}`);
	}
}

function validatePerformance(value, issues) {
	if (!isRecord(value)) {
		issues.push("performance must be an object");
		return;
	}
	unknownKeys(value, new Set(["lcp_ms", "cls", "inp_ms", "initial_js_kb", "initial_css_kb"]), "performance", issues);
	boundedNumber(value.lcp_ms, "performance.lcp_ms", 1, 60000, issues, true);
	boundedNumber(value.cls, "performance.cls", 0, 1, issues);
	boundedNumber(value.inp_ms, "performance.inp_ms", 1, 60000, issues, true);
	boundedNumber(value.initial_js_kb, "performance.initial_js_kb", 0, 1048576, issues, true);
	boundedNumber(value.initial_css_kb, "performance.initial_css_kb", 0, 1048576, issues, true);
}

function validateEvidencePolicy(value, issues) {
	if (!isRecord(value)) {
		issues.push("evidence_policy must be an object");
		return;
	}
	unknownKeys(
		value,
		new Set(["independent_review_required", "required_channels", "cleanup_required"]),
		"evidence_policy",
		issues,
	);
	if (typeof value.independent_review_required !== "boolean") {
		issues.push("evidence_policy.independent_review_required must be boolean");
	}
	if (typeof value.cleanup_required !== "boolean") issues.push("evidence_policy.cleanup_required must be boolean");
	enumList(value.required_channels, "evidence_policy.required_channels", EVIDENCE_CHANNELS, issues);
}

function validateTaste(value, issues) {
	if (value === undefined) return;
	if (!isRecord(value)) {
		issues.push("taste must be an object");
		return;
	}
	unknownKeys(value, TASTE_KEYS, "taste", issues);
	for (const key of TASTE_KEYS) boundedNumber(value[key], `taste.${key}`, 1, 10, issues, true);
}

function canonicalTimestamp(value) {
	if (typeof value !== "string") return false;
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) return false;
	const normalized = new Date(parsed).toISOString();
	return normalized === value || normalized.replace(".000Z", "Z") === value;
}

function validateDeviations(value, label, issues) {
	const ids = [];
	for (const item of records(value, label, issues)) {
		unknownKeys(item, new Set(["id", "reason", "owner", "expires_at"]), label, issues);
		if (!validId(item.id)) issues.push(`${label} id is invalid`);
		if (!nonEmpty(item.reason)) issues.push(`${label} reason is required`);
		if (!nonEmpty(item.owner)) issues.push(`${label} owner is required`);
		if (item.expires_at !== undefined && !canonicalTimestamp(item.expires_at)) {
			issues.push(`${label} expires_at is invalid`);
		}
		ids.push(item.id);
	}
	return ids;
}

function declaredInventoryIds(value, category) {
	if (!isRecord(value) || !Array.isArray(value[category])) return new Set();
	return new Set(value[category].filter(isRecord).map((item) => item.id).filter((id) => typeof id === "string"));
}

function validateReferences(value, label, prefix, declared, issues) {
	const ids = stringList(value, label, issues, 1, 64);
	for (const id of ids) {
		if (!typedId(id, prefix)) issues.push(`${label} must use ${prefix}: identifiers`);
		else if (!declared.has(id)) issues.push(`${id} is not a declared ${prefix}`);
	}
}

function validateBetaExtension(value, issues) {
	const ids = [];
	if (!LANES.has(value.lane)) issues.push("lane is invalid");
	const routes = declaredInventoryIds(value.inventory, "routes");
	const components = declaredInventoryIds(value.inventory, "components");
	const interactions = declaredInventoryIds(value.inventory, "interactions");
	const states = declaredInventoryIds(value.inventory, "states");
	const viewports = declaredInventoryIds(value.inventory, "viewports");
	const inventoryIds = new Set([...routes, ...components, ...interactions, ...states, ...viewports]);

	const tokens = records(value.tokens, "tokens", issues);
	if (tokens.length === 0) issues.push("tokens must not be empty");
	for (const item of tokens) {
		unknownKeys(item, new Set(["id", "category", "value", "usage"]), "token", issues);
		if (!typedId(item.id, "token")) issues.push("token id must use the token: prefix");
		else ids.push(item.id);
		if (!TOKEN_CATEGORIES.has(item.category)) issues.push(`token ${String(item.id)} category is invalid`);
		boundedText(item.value, `token ${String(item.id)} value`, issues);
		boundedText(item.usage, `token ${String(item.id)} usage`, issues);
	}

	const behaviors = records(value.component_behaviors, "component_behaviors", issues);
	if (behaviors.length === 0) issues.push("component_behaviors must not be empty");
	for (const item of behaviors) {
		unknownKeys(item, new Set(["component_id", "state_ids", "interaction_ids", "keyboard_behavior"]), "component behavior", issues);
		if (!typedId(item.component_id, "component")) issues.push("component_behavior component_id is invalid");
		else if (!components.has(item.component_id)) issues.push(`${item.component_id} is not a declared component`);
		validateReferences(item.state_ids, `component ${String(item.component_id)} state_ids`, "state", states, issues);
		validateReferences(item.interaction_ids, `component ${String(item.component_id)} interaction_ids`, "interaction", interactions, issues);
		boundedText(item.keyboard_behavior, `component ${String(item.component_id)} keyboard_behavior`, issues);
	}

	const transformations = records(value.responsive_transformations, "responsive_transformations", issues);
	if (transformations.length === 0) issues.push("responsive_transformations must not be empty");
	for (const item of transformations) {
		unknownKeys(item, new Set(["route_id", "viewport_id", "behavior"]), "responsive transformation", issues);
		if (!typedId(item.route_id, "route") || !routes.has(item.route_id)) issues.push(`${String(item.route_id)} is not a declared route`);
		if (!typedId(item.viewport_id, "viewport") || !viewports.has(item.viewport_id)) issues.push(`${String(item.viewport_id)} is not a declared viewport`);
		boundedText(item.behavior, "responsive transformation behavior", issues);
	}

	if (!isRecord(value.motion)) issues.push("motion must be an object");
	else {
		unknownKeys(value.motion, new Set(["policy", "reduced_motion_behavior", "transitions"]), "motion", issues);
		if (!MOTION_POLICIES.has(value.motion.policy)) issues.push("motion.policy is invalid");
		boundedText(value.motion.reduced_motion_behavior, "motion.reduced_motion_behavior", issues);
		const transitions = records(value.motion.transitions, "motion.transitions", issues);
		if (value.motion.policy !== "none" && transitions.length === 0) issues.push("motion.transitions must not be empty for an active policy");
		if (value.motion.policy === "none" && transitions.length > 0) issues.push("motion.transitions must be empty when policy is none");
		for (const item of transitions) {
			unknownKeys(item, new Set(["id", "interaction_id", "duration_ms", "easing"]), "transition", issues);
			if (!typedId(item.id, "transition")) issues.push("transition id must use the transition: prefix");
			else ids.push(item.id);
			if (!typedId(item.interaction_id, "interaction") || !interactions.has(item.interaction_id)) {
				issues.push(`${String(item.interaction_id)} is not a declared interaction`);
			}
			boundedNumber(item.duration_ms, "transition.duration_ms", 0, 10000, issues, true);
			boundedText(item.easing, `transition ${String(item.id)} easing`, issues);
		}
	}

	const criteria = records(value.acceptance_criteria, "acceptance_criteria", issues);
	if (criteria.length === 0) issues.push("acceptance_criteria must not be empty");
	for (const item of criteria) {
		unknownKeys(item, new Set(["id", "observable", "verification", "required", "inventory_ids"]), "acceptance criterion", issues);
		if (!typedId(item.id, "criterion")) issues.push("criterion id must use the criterion: prefix");
		else ids.push(item.id);
		boundedText(item.observable, `criterion ${String(item.id)} observable`, issues);
		if (!VERIFICATION_METHODS.has(item.verification)) issues.push(`criterion ${String(item.id)} verification is invalid`);
		if (item.required !== true) issues.push(`criterion ${String(item.id)} required must be true`);
		const covered = stringList(item.inventory_ids, `criterion ${String(item.id)} inventory_ids`, issues, 1, 64);
		for (const id of covered) if (!inventoryIds.has(id)) issues.push(`${id} is not declared in contract inventory`);
	}
	return ids;
}

export function validateDesignContract(value) {
	const issues = [];
	if (!isRecord(value)) {
		return {
			valid: false,
			schema: DESIGN_SCHEMA,
			issues: ["contract root must be an object"],
			diagnostics: [],
			evidence_eligible: false,
		};
	}
	const beta2 = value.schema_id === DESIGN_SCHEMA_BETA2;
	const beta = value.schema_id === DESIGN_SCHEMA_BETA || beta2;
	const alpha = value.schema_id === DESIGN_SCHEMA;
	const schema = beta2 ? DESIGN_SCHEMA_BETA2 : beta ? DESIGN_SCHEMA_BETA : DESIGN_SCHEMA;
	unknownKeys(value, beta2 ? BETA2_ROOT_KEYS : beta ? BETA_ROOT_KEYS : ROOT_KEYS, "contract", issues);
	if (!alpha && !beta) issues.push(`schema_id must be ${DESIGN_SCHEMA}, ${DESIGN_SCHEMA_BETA}, or ${DESIGN_SCHEMA_BETA2}`);
	if (!typedId(value.contract_id, "contract")) issues.push("contract_id must use the contract: prefix");
	if (typeof value.source_hash !== "string" || !HASH.test(value.source_hash)) issues.push("source_hash is invalid");
	validateIntent(value.intent, issues);
	validateDirection(value.direction, issues);
	const inventoryIds = validateInventory(value.inventory, issues);
	validateAccessibility(value.accessibility, issues);
	validateLocalization(value.localization, issues);
	validatePerformance(value.performance, issues);
	validateEvidencePolicy(value.evidence_policy, issues);
	const deviationIds = [
		...validateDeviations(value.omissions, "omissions", issues),
		...validateDeviations(value.accepted_exceptions, "accepted_exceptions", issues),
	];
	const betaIds = beta ? validateBetaExtension(value, issues) : [];
	if (beta2) validateTaste(value.taste, issues);
	const allIds = [value.contract_id, ...inventoryIds, ...deviationIds, ...betaIds];
	if (new Set(allIds).size !== allIds.length) issues.push("contract ids must be globally unique");
	const valid = issues.length === 0;
	return {
		valid,
		schema,
		issues,
		diagnostics: alpha ? ["LEGACY_SCHEMA_V1ALPHA1"] : [],
		evidence_eligible: beta && valid,
	};
}

function main(args) {
	if (!(args.length === 0 || (args.length === 2 && args[0] === "--input"))) {
		throw new InputError("ARGUMENT_INVALID", "expected either stdin or --input <path>");
	}
	const value =
		args.length === 0
			? readStdinJson(256 * 1024, "DESIGN_CONTRACT_INVALID")
			: readBoundedJsonFile(args[1], 256 * 1024, "DESIGN_CONTRACT_INVALID");
	const result = validateDesignContract(value);
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (!result.valid) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 2;
	}
}
