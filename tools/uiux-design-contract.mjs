const SOURCE_HASH = "a".repeat(64);

export function uiuxDesignContract({ id, authenticated = false, brownfield = false } = {}) {
	if (typeof id !== "string" || id.length === 0) throw new Error("design contract id is required");
	return {
		schema_id: "litfamily.design-contract/v1alpha1",
		contract_id: `contract:${id}`,
		source_hash: SOURCE_HASH,
		intent: {
			audiences: ["verified product user"],
			tasks: ["complete the primary workflow"],
			qualities: ["clear", "accessible", "responsive"],
			constraints: ["preserve source behavior"],
			non_goals: ["unrelated navigation changes"],
		},
		direction: {
			name: "evidence-led product clarity",
			principles: ["task hierarchy first", "state is explicit", "evidence binds every claim"],
			token_strategy: "reuse",
			voice: "direct and calm",
		},
		inventory: {
			routes: [
				{ id: "route:primary", path: "/", primary: true, auth_required: authenticated },
				{ id: "route:secondary", path: "/secondary", primary: false, auth_required: false },
			],
			regions: [{ id: "region:primary", route_id: "route:primary" }],
			components: [{ id: "component:primary-action", region_id: "region:primary" }],
			interactions: [
				{
					id: "interaction:critical",
					route_id: "route:primary",
					critical: true,
					input_modes: ["keyboard", "pointer", "touch"],
				},
			],
			states: [{ id: "state:error", route_id: "route:primary", kind: "error" }],
			viewports: [
				{ id: "viewport:small", width: 320, height: 640, category: "compact" },
				{ id: "viewport:large", width: 1440, height: 900, category: "expanded" },
			],
			references: [{ id: "reference:hero", sha256: "c".repeat(64), kind: "measured", label: "primary surface" }],
			authenticated_surfaces: authenticated
				? [{ route_id: "route:primary", owner: "qa", safe_test_account: true }]
				: [],
		},
		accessibility: {
			target: "WCAG 2.2 AA",
			keyboard: true,
			screen_reader: true,
			reduced_motion: true,
			forced_colors: true,
			zoom_percent: 200,
		},
		localization: {
			locales: ["ko-KR", "en"],
			text_expansion_percent: 30,
			cjk_line_break_review: true,
			font_fallback_review: true,
			ime_review: true,
			rtl_review: true,
		},
		performance: {
			lcp_ms: 2500,
			cls: 0.1,
			inp_ms: 200,
			initial_js_kb: 250,
			initial_css_kb: 80,
		},
		evidence_policy: {
			independent_review_required: true,
			required_channels: ["browser", "keyboard", "accessibility-tree", "performance", "localization"],
			cleanup_required: true,
		},
		omissions: brownfield ? [{ id: "omission:legacy-shell", reason: "out of scope", owner: "product" }] : [],
		accepted_exceptions: brownfield ? [{ id: "exception:legacy-token", reason: "approved", owner: "design" }] : [],
	};
}
