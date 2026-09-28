import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { uiuxDesignContract } from "../../../../tools/uiux-design-contract.mjs";
import { validateDesignContract } from "./scripts/validate-design-contract.mjs";
import { validateDesignContract as validateVisualDesignContract } from "../visual-qa/scripts/validate-design-contract.mjs";

const frontendSchema = new URL("./schemas/design-contract.v1alpha1.json", import.meta.url);
const visualQaSchema = new URL("../visual-qa/schemas/design-contract.v1alpha1.json", import.meta.url);
const frontendBetaSchema = new URL("./schemas/design-contract.v1beta1.json", import.meta.url);
const visualQaBetaSchema = new URL("../visual-qa/schemas/design-contract.v1beta1.json", import.meta.url);
const frontendBeta2Schema = new URL("./schemas/design-contract.v1beta2.json", import.meta.url);
const visualQaBeta2Schema = new URL("../visual-qa/schemas/design-contract.v1beta2.json", import.meta.url);
const validator = new URL("./scripts/validate-design-contract.mjs", import.meta.url);
const visualValidator = new URL("../visual-qa/scripts/validate-design-contract.mjs", import.meta.url);

function betaDesignContract() {
	return {
		...uiuxDesignContract({ id: "frontend-beta" }),
		schema_id: "litfamily.design-contract/v1beta1",
		lane: "brownfield",
		tokens: [{ id: "token:action", category: "color", value: "accent-600", usage: "primary action" }],
		component_behaviors: [{
			component_id: "component:primary-action",
			state_ids: ["state:error"],
			interaction_ids: ["interaction:critical"],
			keyboard_behavior: "Enter invokes the primary action",
		}],
		responsive_transformations: [{
			route_id: "route:primary",
			viewport_id: "viewport:small",
			behavior: "Primary action spans the compact content width",
		}],
		motion: {
			policy: "functional",
			reduced_motion_behavior: "State changes without translation",
			transitions: [{ id: "transition:primary", interaction_id: "interaction:critical", duration_ms: 160, easing: "ease-out" }],
		},
		acceptance_criteria: [{
			id: "criterion:primary",
			observable: "Keyboard activation reaches the error state",
			verification: "browser",
			required: true,
			inventory_ids: ["component:primary-action", "interaction:critical", "state:error"],
		}],
	};
}

function beta2DesignContract() {
	return {
		...betaDesignContract(),
		schema_id: "litfamily.design-contract/v1beta2" as const,
		taste: { variance: 5, motion: 4, density: 7 },
	};
}

describe("frontend-ui-ux design contract validator", () => {
	it("validates the current clean-room contract through the production API", () => {
		const contract = uiuxDesignContract({ id: "frontend-validator" });
		expect(validateDesignContract(contract)).toEqual({
			valid: true,
			schema: "litfamily.design-contract/v1alpha1",
			issues: [],
			diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
			evidence_eligible: false,
		});
	});

	it("validates beta behavior fields and rejects dangling references", () => {
		const contract = betaDesignContract();
		expect(validateDesignContract(contract)).toEqual({
			valid: true,
			schema: "litfamily.design-contract/v1beta1",
			issues: [],
			diagnostics: [],
			evidence_eligible: true,
		});
		contract.component_behaviors[0].component_id = "component:missing";
		expect(validateDesignContract(contract).issues.join("\n")).toMatch(/component:missing.*declared component/i);
	});

	it("accepts a v1beta2 contract without the optional taste object", () => {
		const { taste: _taste, ...contract } = beta2DesignContract();
		for (const validate of [validateDesignContract, validateVisualDesignContract]) {
			expect(validate(contract)).toEqual({
				valid: true,
				schema: "litfamily.design-contract/v1beta2",
				issues: [],
				diagnostics: [],
				evidence_eligible: true,
			});
		}
	});

	it("accepts the bounded v1beta2 taste object", () => {
		expect(validateDesignContract(beta2DesignContract())).toMatchObject({
			valid: true,
			schema: "litfamily.design-contract/v1beta2",
			issues: [],
			evidence_eligible: true,
		});
	});

	it("accepts valid beta2 taste and rejects invalid taste through both validators", () => {
		const valid = beta2DesignContract();
		const invalid = structuredClone(valid);
		(invalid.taste as Record<string, unknown>).variance = 0;

		for (const validate of [validateDesignContract, validateVisualDesignContract]) {
			expect(validate(valid)).toMatchObject({
				valid: true,
				schema: "litfamily.design-contract/v1beta2",
				evidence_eligible: true,
			});
			expect(validate(invalid)).toMatchObject({
				valid: false,
				issues: expect.arrayContaining([expect.stringMatching(/taste\.variance.*integer.*1.*10/i)]),
			});
		}
	});

	it.each([
		["variance", 0],
		["motion", 11],
		["density", 1.5],
	] as const)("rejects an invalid v1beta2 taste value for %s", (dial, value) => {
		const contract = beta2DesignContract();
		const taste = contract.taste as Record<string, unknown>;
		taste[dial] = value;
		expect(validateDesignContract(contract)).toMatchObject({ valid: false });
		expect(validateDesignContract(contract).issues.join("\n")).toMatch(new RegExp(`taste\\.${dial}.*integer.*1.*10`, "i"));
	});

	it("rejects unknown taste keys", () => {
		const contract = beta2DesignContract();
		(contract.taste as Record<string, unknown>).unexpected = true;
		const result = validateDesignContract(contract);
		expect(result.valid).toBe(false);
		expect(result.issues).toContain("taste contains unknown key unexpected");
	});

	it("preserves the alpha and beta1 contracts while adding beta2", () => {
		expect(validateDesignContract(uiuxDesignContract({ id: "older-alpha" }))).toMatchObject({
			valid: true,
			schema: "litfamily.design-contract/v1alpha1",
			diagnostics: ["LEGACY_SCHEMA_V1ALPHA1"],
			evidence_eligible: false,
		});
		expect(validateDesignContract(betaDesignContract())).toMatchObject({
			valid: true,
			schema: "litfamily.design-contract/v1beta1",
			diagnostics: [],
			evidence_eligible: true,
		});

		const beta1WithTaste = betaDesignContract() as Record<string, unknown>;
		beta1WithTaste.taste = { variance: 5, motion: 4, density: 7 };
		expect(validateDesignContract(beta1WithTaste).issues).toContain("contract contains unknown key taste");
	});

	it.each([
		["token value", (contract: ReturnType<typeof betaDesignContract>, text: string) => { contract.tokens[0].value = text; }],
		["token usage", (contract: ReturnType<typeof betaDesignContract>, text: string) => { contract.tokens[0].usage = text; }],
		["keyboard behavior", (contract: ReturnType<typeof betaDesignContract>, text: string) => { contract.component_behaviors[0].keyboard_behavior = text; }],
		["responsive behavior", (contract: ReturnType<typeof betaDesignContract>, text: string) => { contract.responsive_transformations[0].behavior = text; }],
		["reduced-motion behavior", (contract: ReturnType<typeof betaDesignContract>, text: string) => { contract.motion.reduced_motion_behavior = text; }],
		["transition easing", (contract: ReturnType<typeof betaDesignContract>, text: string) => { contract.motion.transitions[0].easing = text; }],
		["criterion observable", (contract: ReturnType<typeof betaDesignContract>, text: string) => { contract.acceptance_criteria[0].observable = text; }],
	] as const)("enforces the schema's 512-character bound for %s", (_label, mutate) => {
		const boundary = betaDesignContract();
		mutate(boundary, "😀".repeat(512));
		expect(validateDesignContract(boundary).valid).toBe(true);
		expect(validateVisualDesignContract(boundary).valid).toBe(true);

		const oversized = betaDesignContract();
		mutate(oversized, "😀".repeat(513));
		expect(validateDesignContract(oversized).valid).toBe(false);
		expect(validateVisualDesignContract(oversized).valid).toBe(false);
	});

	it("rejects an unknown root key through the installed CLI-shaped runtime", () => {
		const contract = { ...uiuxDesignContract({ id: "unknown-key" }), unexpected: true };
		const result = spawnSync(process.execPath, [validator.pathname], {
			encoding: "utf8",
			input: JSON.stringify(contract),
		});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			valid: false,
			issues: expect.arrayContaining(["contract contains unknown key unexpected"]),
		});
	});

	it("probes both local validator CLIs with valid and invalid beta2 JSON", () => {
		const invalid = structuredClone(beta2DesignContract());
		(invalid.taste as Record<string, unknown>).density = 11;

		for (const [name, entrypoint] of [["frontend-ui-ux", validator], ["visual-qa", visualValidator]] as const) {
			const validRun = spawnSync(process.execPath, [entrypoint.pathname], {
				encoding: "utf8",
				input: JSON.stringify(beta2DesignContract()),
			});
			expect(validRun.status, `${name} valid CLI status`).toBe(0);
			expect(validRun.stderr, `${name} valid CLI stderr`).toBe("");
			expect(JSON.parse(validRun.stdout), `${name} valid CLI output`).toMatchObject({
				valid: true,
				schema: "litfamily.design-contract/v1beta2",
			});

			const invalidRun = spawnSync(process.execPath, [entrypoint.pathname], {
				encoding: "utf8",
				input: JSON.stringify(invalid),
			});
			expect(invalidRun.status, `${name} invalid CLI status`).not.toBe(0);
			expect(invalidRun.stderr, `${name} invalid CLI stderr`).toBe("");
			expect(JSON.parse(invalidRun.stdout), `${name} invalid CLI output`).toMatchObject({
				valid: false,
				issues: expect.arrayContaining([expect.stringMatching(/taste\.density.*integer.*1.*10/i)]),
			});
		}
	});

	it("keeps frontend and visual-QA schema bytes identical", () => {
		expect(readFileSync(frontendSchema)).toEqual(readFileSync(visualQaSchema));
		expect(readFileSync(frontendBetaSchema)).toEqual(readFileSync(visualQaBetaSchema));
		expect(readFileSync(frontendBeta2Schema)).toEqual(readFileSync(visualQaBeta2Schema));
	});

	it("keeps the package-local visual validator behaviorally aligned for alpha, beta, and invalid beta", () => {
		const alpha = uiuxDesignContract({ id: "aligned-alpha" });
		const beta = betaDesignContract();
		const invalidBeta = structuredClone(beta);
		invalidBeta.acceptance_criteria[0].inventory_ids = ["component:missing"];

		for (const contract of [alpha, beta, invalidBeta]) {
			expect(validateVisualDesignContract(contract)).toEqual(validateDesignContract(contract));
		}

		const visualSource = readFileSync(
			new URL("../visual-qa/scripts/validate-design-contract.mjs", import.meta.url),
			"utf8",
		);
		expect(visualSource).not.toContain("frontend-ui-ux");
	});

	it("aligns shared invalid-input diagnostics without a cross-skill runtime dependency", () => {
		const candidates: unknown[] = [null, { ...uiuxDesignContract({ id: "unknown-root" }), unknown: true }];
		for (const mutate of [
			(contract: ReturnType<typeof betaDesignContract>) => {
				contract.intent.audiences = [];
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				contract.performance.lcp_ms = 0;
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				contract.motion.transitions[0].duration_ms = 10_001;
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				contract.evidence_policy.required_channels = [];
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				(contract.intent as unknown as Record<string, unknown>).audiences = "users";
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				(contract.evidence_policy as unknown as Record<string, unknown>).required_channels = [42];
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				(contract.acceptance_criteria[0] as unknown as Record<string, unknown>).inventory_ids = "component:primary-action";
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				(contract.component_behaviors[0] as unknown as Record<string, unknown>).state_ids = "state:error";
			},
			(contract: ReturnType<typeof betaDesignContract>) => {
				(contract.inventory.interactions[0] as unknown as Record<string, unknown>).input_modes = [42];
			},
		]) {
			const contract = betaDesignContract();
			mutate(contract);
			candidates.push(contract);
		}

		for (const contract of candidates) {
			expect(validateVisualDesignContract(contract)).toEqual(validateDesignContract(contract));
		}
	});
});
