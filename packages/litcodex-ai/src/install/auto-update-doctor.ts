// Read-only explanations for the foreground updater's receipt, plus the Codex hook approval it depends on.
// Every line names one cause and one thing the user can do; nothing here touches npm, the lock or the journal.

import { join } from "node:path";
import type { ReadonlyFsLike } from "./codex.js";
import { LITCODEX_PLUGIN_REF } from "./marketplace.js";
import type { AutoUpdateHookReview } from "./types.js";

const BY_HAND = "update by hand: npm install -g @litfamily/litcodex@latest, then litcodex install";

export interface AutoUpdateExplanation {
	readonly detail: string;
	readonly remedy?: string;
}

/** Turn one receipt into a cause and a remedy. Unknown shapes keep the plain "receipt present" detail. */
export function explainAutoUpdateReceipt(fields: Record<string, unknown>): AutoUpdateExplanation {
	const status = fields["status"];
	const reason = typeof fields["reason"] === "string" ? fields["reason"] : "";
	const from = typeof fields["currentVersion"] === "string" ? fields["currentVersion"] : "the earlier version";
	const to = typeof fields["latestVersion"] === "string" ? fields["latestVersion"] : "latest";
	const at = typeof fields["finishedAt"] === "string" ? fields["finishedAt"] : "an unknown time";
	const byHandTo = `update by hand: npm install -g @litfamily/litcodex@${to}, then litcodex install`;
	switch (status) {
		case "updated":
			return {
				detail: `${from} → ${to} at ${at}; it takes effect in the next Codex session, and sessions opened before then keep ${from}`,
				remedy: `Start a new Codex session to use ${to}. Doctor cannot see which version an open Codex session runs.`,
			};
		case "up-to-date":
			return { detail: "the installed version was the latest release at the last check" };
		case "throttled":
			return reason === "retry-throttled"
				? {
						detail: "the last attempt failed, so the next try waits 30 minutes",
						remedy: `Start a Codex session after that, or ${BY_HAND}.`,
					}
				: { detail: "checked within the last 24 hours; a session start after that checks again" };
		case "locked":
			return {
				detail: "another session was updating at the same time",
				remedy: "Wait for it to finish, then run litcodex doctor again.",
			};
		case "failed":
			if (/ETIMEDOUT|terminated:SIGTERM/u.test(reason)) {
				return {
					detail: "an install step ran past its 60-second limit",
					remedy: `On a slow network, ${byHandTo}. Sessions retry after 30 minutes.`,
				};
			}
			if (reason.startsWith("post-install-verification:")) {
				return {
					detail: `${to} installed but failed its own checks, so ${from} was put back`,
					remedy: `Sessions retry after 30 minutes. To see the error, ${byHandTo}.`,
				};
			}
			return {
				detail: `npm could not install ${to} (${reason || "no reason recorded"}); a global npm folder you cannot write to is the usual cause`,
				remedy: `Run npm install -g @litfamily/litcodex@${to} to see npm's own message.`,
			};
		case "skipped":
			return explainSkip(reason);
		default:
			return { detail: "receipt present" };
	}
}

function explainSkip(reason: string): AutoUpdateExplanation {
	switch (reason) {
		case "existing-opt-out":
			return {
				detail: "turned off by NO_UPDATE_NOTIFIER or LITCODEX_NO_UPDATE_CHECK where Codex runs",
				remedy: `Remove it to get updates, or ${BY_HAND}.`,
			};
		case "disabled":
			return {
				detail: "turned off by LITCODEX_NO_AUTO_UPDATE or --no-auto-update",
				remedy: `Remove it to get updates, or ${BY_HAND}.`,
			};
		case "ci":
			return { detail: "skipped because CI is set", remedy: `Unset CI outside automation, or ${BY_HAND}.` };
		case "marketplace-flow":
			return {
				detail: "installed through the Codex marketplace, which this updater leaves alone",
				remedy: "Update it through the Codex marketplace you installed it from.",
			};
		case "unknown-latest":
			return {
				detail: "could not read the latest version from registry.npmjs.org (offline, a proxy, or a registry error)",
				remedy: "Check the network; the next Codex session start tries again.",
			};
		case "unknown-current":
			return { detail: "could not read the installed version", remedy: "Run litcodex install again." };
		default:
			return { detail: `skipped (${reason || "no reason recorded"})` };
	}
}

/**
 * Codex runs a plugin hook only after the user approves it; the approval sits in config.toml under
 * `[hooks.state."<plugin>:hooks/hooks.json:session_start:<group>:<hook>"]`. Doctor can see whether an approval
 * is recorded, not whether its hash still matches, so a recorded approval is reported as nothing.
 */
export function inspectAutoUpdateHookReview(
	fs: ReadonlyFsLike,
	codexHome: string,
	managedRoot: string,
): AutoUpdateHookReview | undefined {
	const key = autoUpdateHookKey(fs, join(managedRoot, "plugins", "litcodex", "hooks", "hooks.json"));
	if (key === null) return undefined;
	const configPath = join(codexHome, "config.toml");
	let config = "";
	try {
		config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
	} catch {
		return undefined;
	}
	const lines = config.split(/\r?\n/u);
	const header = `[hooks.state."${key}"]`;
	const start = lines.findIndex((line) => line.trim() === header);
	if (start < 0) return "not-approved";
	let approved = false;
	for (const line of lines.slice(start + 1)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("[")) break;
		if (/^enabled\s*=\s*false\b/u.test(trimmed)) return "turned-off";
		if (/^trusted_hash\s*=/u.test(trimmed)) approved = true;
	}
	return approved ? "approved" : "not-approved";
}

function autoUpdateHookKey(fs: ReadonlyFsLike, hooksPath: string): string | null {
	try {
		if (!fs.existsSync(hooksPath)) return null;
		const parsed = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
			hooks?: { SessionStart?: Array<{ hooks?: Array<{ command?: unknown }> }> };
		};
		const groups = parsed.hooks?.SessionStart ?? [];
		for (const [group, entry] of groups.entries()) {
			const hook = (entry.hooks ?? []).findIndex((item) =>
				String(item.command).includes("components/auto-update/dist/cli.js"),
			);
			if (hook >= 0) return `${LITCODEX_PLUGIN_REF}:hooks/hooks.json:session_start:${group}:${hook}`;
		}
	} catch {
		// An unreadable hooks file is already reported by the payload check.
	}
	return null;
}

export function hookReviewLine(review: AutoUpdateHookReview): string | null {
	if (review === "not-approved") {
		return "auto-update hook: not approved in Codex. Codex skips hooks you have not approved and codex exec never asks, so no session updates LitCodex. Start codex and approve the LitCodex hooks when it asks.";
	}
	if (review === "turned-off") {
		return "auto-update hook: turned off in Codex, so no session updates LitCodex. Turn it back on in Codex's hook settings, or update by hand.";
	}
	return null;
}
