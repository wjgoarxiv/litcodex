// scripts/path-robustness/install-plan.mjs — M20 self-contained install-plan expectation (T24).
//
// A3 D1: the install dry-run probe asserts the SELF-CONTAINED M12 plan, NOT an npx forwarder line.
// The expected header + ordered InstallStep titles are READ FROM the built M12 dist (renderInstallPlan
// / INSTALL_PLAN_HEADER / buildInstallPlan) so they can NEVER drift from the shim — never hardcoded.

import { managedMarketplaceRoot } from "../../packages/litcodex-ai/dist/install/marketplace.js";
import { buildInstallPlan } from "../../packages/litcodex-ai/dist/install/plan.js";
import { INSTALL_PLAN_HEADER } from "../../packages/litcodex-ai/dist/install/render-plan.js";

/**
 * The header + ordered step titles for `--dry-run install --no-tui`, derived from M12 (not hardcoded).
 * Matches the shim's own `renderInstallDryRun` option resolution (noTui true, repoUrl LITCODEX_REPO_URL).
 *
 * @param {string} repoRoot the harness repo root (process.cwd()); the M12 plan is repoRoot-independent.
 * @param {string} [codexHome] the isolated CODEX_HOME used by the hostile-path runner.
 */
export function expectedInstallPlan(repoRoot, codexHome = "/tmp/codex-home") {
	const steps = buildInstallPlan({
		dryRun: true,
		noTui: true,
		autonomous: false,
		force: false,
		json: false,
		profile: "astra",
		effort: "xhigh",
		reconfigure: false,
		codexHome,
		repoUrl: managedMarketplaceRoot(codexHome),
		repoRoot,
	});
	return { header: INSTALL_PLAN_HEADER, titles: steps.map((step) => step.title) };
}
