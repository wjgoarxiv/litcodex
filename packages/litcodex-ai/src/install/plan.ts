// M12 / T17 — pure install plan builder (S12 §plan.ts; addendum A5.3 pinned argv).
//
// `buildInstallPlan` is pure + deterministic: identical flags → identical ordered steps → a
// byte-stable dry-run rendering free of legacy tokens. The argv every step carries is the literal
// `codex …` vector that WOULD be spawned (never an exec-wrapper). No environment-dependent reordering.

import { LITCODEX_PLUGIN_REF } from "./marketplace.js";
import type { InstallOptions, InstallStep } from "./types.js";

/** Build the ordered plan. The fixed order is marketplace → plugin → hooks → config → verify. */
export function buildInstallPlan(opts: InstallOptions): readonly InstallStep[] {
	// `codex plugin add` is non-interactive and (codex-cli 0.139.x) REJECTS `--no-tui` as an unknown
	// option — the correct argv is just `codex plugin add <plugin>@<marketplace>`. The accepted
	// `--no-tui` CLI flag is now a no-op kept for habit/compat (VERIFY-LIVE finding vs codex 0.139.0).
	const pluginAddArgs = ["codex", "plugin", "add", LITCODEX_PLUGIN_REF];

	const profileLabel = opts.profile.toUpperCase();
	const consentLabel = opts.reconfigure ? ", explicit managed reconfigure" : "";
	const configTitle = `Update Codex config.toml (${profileLabel} / ${opts.effort}${consentLabel}, hard concurrency 20, context and auto-compaction unset for host defaults, non-destructive)`;

	return [
		{
			kind: "marketplace-add",
			title: `Add LitCodex marketplace: codex plugin marketplace add ${opts.repoUrl}`,
			command: ["codex", "plugin", "marketplace", "add", opts.repoUrl],
			skippable: true,
		},
		{
			kind: "plugin-add",
			title: `Install plugin: ${pluginAddArgs.join(" ")}`,
			command: pluginAddArgs,
			skippable: true,
		},
		{
			kind: "hooks-register",
			title: "Register lit-loop UserPromptSubmit hook (bundled hooks.json)",
			command: null,
			skippable: true,
		},
		{
			kind: "agents-install",
			title: "Install litwork subagent roles and native default route (backup-safe)",
			command: null,
			skippable: true,
		},
		{
			kind: "config-update",
			title: configTitle,
			command: null,
			skippable: false,
		},
		{
			kind: "verify",
			title: "Verify: litcodex doctor",
			command: null,
			skippable: false,
		},
	];
}
