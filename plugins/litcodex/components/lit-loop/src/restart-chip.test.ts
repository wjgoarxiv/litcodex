// The restart chip: the card and the HUD say `restart to <v>` only when the installed plugin is newer than the
// one this process loaded. The installed version is read from a scratch CODEX_HOME only.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CardStatus, cardStatusText, readCardStatus } from "./card-status.js";
import { displayWidth, type HudView, renderHud } from "./hud.js";
import { writeThreadPointer } from "./live-step.js";
import { installedPluginVersion, loadedPluginVersion, restartChip } from "./restart-chip.js";
import { recordWorkflowTurn } from "./workflow-map.js";

const T0 = 1_800_000_000_000;
const SID = "019a0000-cccc-7000-8000-000000000001";
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	roots.push(dir);
	return dir;
}

function installed(home: string, body: string): void {
	const dir = join(home, "marketplaces/litcodex/plugins/litcodex/.codex-plugin");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "plugin.json"), body);
}

describe("restartChip", () => {
	it("names the installed version when it is newer", () => {
		expect(restartChip("1.0.31", "1.0.32")).toBe("restart to 1.0.32");
		expect(restartChip("1.0.31", "1.1.0")).toBe("restart to 1.1.0");
		expect(restartChip("1.9.9", "1.10.0")).toBe("restart to 1.10.0");
	});

	it.each([
		["equal", "1.0.31", "1.0.31"],
		["older", "1.0.31", "1.0.30"],
		["unknown installed", "1.0.31", null],
		["unknown loaded", null, "1.0.32"],
		["malformed", "1.0.31", "1.0"],
		["prerelease", "1.0.31", "1.0.32-beta.1"],
		["prefixed", "1.0.31", "v1.0.32"],
		["leading zero", "1.0.31", "1.0.032"],
	])("shows nothing when %s", (_name, loaded, newer) => {
		expect(restartChip(loaded, newer)).toBeNull();
	});
});

describe("the versions it compares", () => {
	it("reads the loaded version from this plugin's own manifest", () => {
		const manifest = JSON.parse(
			readFileSync(new URL("../../../.codex-plugin/plugin.json", import.meta.url), "utf8"),
		) as { version: string };
		expect(loadedPluginVersion()).toBe(manifest.version);
	});

	it("reads the installed version from the managed marketplace payload, and nothing else", () => {
		const home = scratch("litcodex-chip-home-");
		expect(installedPluginVersion({ CODEX_HOME: home })).toBeNull();
		installed(home, JSON.stringify({ name: "litcodex", version: "1.0.40" }));
		expect(installedPluginVersion({ CODEX_HOME: home })).toBe("1.0.40");
		installed(home, JSON.stringify({ name: "other", version: "1.0.40" }));
		expect(installedPluginVersion({ CODEX_HOME: home })).toBeNull();
		installed(home, "{not json");
		expect(installedPluginVersion({ CODEX_HOME: home })).toBeNull();
	});
});

describe("on the card", () => {
	function status(version: string | null): CardStatus {
		const home = scratch("litcodex-chip-home-");
		const root = scratch("litcodex-chip-ws-");
		mkdirSync(join(root, ".litcodex"), { recursive: true });
		const env = { CODEX_HOME: home };
		recordWorkflowTurn(root, SID, "turn-1", "lit-loop", T0 - 60_000);
		writeThreadPointer(env, SID, root, T0 - 60_000);
		if (version !== null) installed(home, JSON.stringify({ name: "litcodex", version }));
		return readCardStatus(SID, env, T0, { rollout: false, loadedVersion: "1.0.31" });
	}
	const card = (version: string | null): string => cardStatusText(status(version)).split("\n")[0] ?? "";

	it("puts the chip on the title line only when a newer version is installed", () => {
		expect(card("1.0.32")).toContain("restart to 1.0.32");
		expect(card("1.0.31")).not.toContain("restart");
		expect(card(null)).not.toContain("restart");
	});

	it("keeps the HUD inside its width with the chip, colour on and off", () => {
		const view: HudView = {
			wanted: null,
			session: { id: SID, folder: "~/work/alpha", lastSeen: T0 },
			status: status("1.0.32"),
			unreadable: [],
		};
		for (const color of [false, true]) {
			for (const width of [40, 60, 110]) {
				const out = renderHud(view, { width, color, now: T0 });
				if (width === 110) expect(out).toContain("restart to 1.0.32");
				for (const line of out.split("\n"))
					expect(displayWidth(line.replace(/\u001b\[[0-9;]*m/gu, "")), line).toBeLessThanOrEqual(width);
			}
		}
	});
});
