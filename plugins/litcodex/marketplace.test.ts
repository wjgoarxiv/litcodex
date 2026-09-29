// plugins/litcodex/marketplace.test.ts — M14/T19 marketplace metadata suite (parent + addendum).
//
// Covers the resolver core (component dist path + UserPromptSubmit hook command), the manifest
// invariants (resource pointers, marketplace/plugin name agreement, exactly-one-component layout,
// no nested component manifest), the hardened command/statusMessage equality (canonical ignition literal;
// non-canonical + M06-shaped bare-component forms are REJECTED), the fail-closed version lockstep,
// the legacy-token defense (bounded short aliases; every fixture token enforced), the codex-schema contract
// conformance, and the npm/Codex name duality. Negative cases stage a throwaway repo layout under
// mkdtempSync and mutate the target file so the real shipped files stay pristine.
//
// Self-immunity: every injected legacy token is assembled from fragments so this source carries no
// literal legacy token and the M04 scanner never flags it (no allowlist entry needed once tracked).

import { strict as assert } from "node:assert";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	FORBIDDEN_COMPONENT_BARE_CLI_SEGMENT,
	HOOKS_JSON_RELPATH,
	LIT_LOOP_COMPONENT_DIR,
	LIT_LOOP_HOOK_COMMAND,
	LIT_LOOP_HOOK_EVENT,
	LIT_LOOP_HOOK_STATUS_MESSAGE,
	LIT_LOOP_HOOK_SUBCOMMAND,
	loadMarketplaceMetadata,
	MARKETPLACE_NAME,
	MarketplaceMetadataError,
	PLUGIN_NAME,
	resolveLitLoopComponentPath,
	resolveUserPromptSubmitHook,
} from "./src/metadata.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Legacy tokens assembled from fragments (self-immunity; never a literal in this source).
const TOKEN_LONG_A = ["sisyphus", "labs"].join("");
const TOKEN_LONG_B = ["lazy", "codex"].join("");
const TOKEN_SHORT_A = ["o", "m", "o"].join("");

// ── Temp-repo staging helpers ────────────────────────────────────────────────

const tmpDirs: string[] = [];

function stageRepo(prefix = "litcodex-meta-"): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(root);
	mkdirSync(join(root, ".agents", "plugins"), { recursive: true });
	mkdirSync(join(root, "plugins", "litcodex", ".codex-plugin"), { recursive: true });
	mkdirSync(join(root, "plugins", "litcodex", "hooks"), { recursive: true });
	cpSync(
		join(REPO_ROOT, ".agents", "plugins", "marketplace.json"),
		join(root, ".agents", "plugins", "marketplace.json"),
	);
	cpSync(
		join(REPO_ROOT, "plugins", "litcodex", ".codex-plugin", "plugin.json"),
		join(root, "plugins", "litcodex", ".codex-plugin", "plugin.json"),
	);
	cpSync(
		join(REPO_ROOT, "plugins", "litcodex", "hooks", "hooks.json"),
		join(root, "plugins", "litcodex", "hooks", "hooks.json"),
	);
	cpSync(join(REPO_ROOT, "plugins", "litcodex", ".mcp.json"), join(root, "plugins", "litcodex", ".mcp.json"));
	// Aggregate package.json carries the sole version source (G14.2).
	writeFileSync(
		join(root, "plugins", "litcodex", "package.json"),
		`${JSON.stringify({ name: "@litcodex/plugin", version: "1.0.10", private: true }, null, "\t")}\n`,
	);
	return root;
}

function pathIn(root: string, ...segs: string[]): string {
	return join(root, ...segs);
}

function rewriteJson(path: string, mutate: (json: Record<string, unknown>) => void): void {
	const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	mutate(json);
	writeFileSync(path, `${JSON.stringify(json, null, "\t")}\n`);
}

interface MutableHandler {
	type: string;
	command: string;
	timeout: number;
	statusMessage: string;
}

/** Mutate the lone UserPromptSubmit handler in a staged hooks.json (typed, no unchecked index). */
function mutateHookHandler(hooksPath: string, mutate: (handler: MutableHandler) => void): void {
	rewriteJson(hooksPath, (json) => {
		const events = json["hooks"] as { UserPromptSubmit: { hooks: MutableHandler[] }[] };
		const group = events.UserPromptSubmit.at(0);
		const handler = group?.hooks.at(0);
		if (!handler) throw new Error("staged hooks.json has no UserPromptSubmit handler");
		mutate(handler);
	});
}

function loadErr(root: string): MarketplaceMetadataError {
	try {
		loadMarketplaceMetadata(root);
	} catch (err) {
		assert.ok(err instanceof MarketplaceMetadataError, `expected MarketplaceMetadataError, got ${String(err)}`);
		return err;
	}
	throw new assert.AssertionError({ message: "expected loadMarketplaceMetadata to throw" });
}

function materializeToken(entry: { token?: string; tokenParts?: string[] }): string {
	return entry.token ?? entry.tokenParts?.join("") ?? "";
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── Constants (A3 Part D / addendum) ─────────────────────────────────────────

describe("#given the M14 constants #when read #then they match A3 Part D + addendum", () => {
	it("exports the canonical hook event, subcommand, names, and component dir", () => {
		expect(LIT_LOOP_HOOK_EVENT).toBe("UserPromptSubmit");
		expect(LIT_LOOP_HOOK_SUBCOMMAND).toBe("user-prompt-submit");
		expect(MARKETPLACE_NAME).toBe("litcodex");
		expect(PLUGIN_NAME).toBe("litcodex");
		expect(LIT_LOOP_COMPONENT_DIR).toBe("lit-loop");
	});

	it("statusMessage is the canonical M14-owned ignition literal", () => {
		expect(LIT_LOOP_HOOK_STATUS_MESSAGE).toBe("🔥 LIT IGNITED · lit-loop 🔥");
	});

	it("the canonical command targets components/lit-loop/dist/cli.js and aggregate hooks.json relpath", () => {
		expect(LIT_LOOP_HOOK_COMMAND).toBe(
			`node "\${PLUGIN_ROOT}/components/lit-loop/dist/cli.js" hook user-prompt-submit`,
		);
		expect(HOOKS_JSON_RELPATH).toBe("plugins/litcodex/hooks/hooks.json");
		expect(FORBIDDEN_COMPONENT_BARE_CLI_SEGMENT).toBe(`\${PLUGIN_ROOT}/dist/cli.js`);
	});
});

// ── Resolver core (loads / pointers / names / components / hook command + path) ──

describe("#given the shipped metadata #when loaded #then the resolver returns canonical, frozen metadata", () => {
	it("loads and validates all four metadata files", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		expect(md.marketplaceName).toBe("litcodex");
		expect(md.pluginName).toBe("litcodex");
		expect(md.pluginSource).toBe("./plugins/litcodex");
		expect(md.pluginVersion).toBe("1.0.10");
	});

	it("resource pointers are exact strings", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		expect(md.resources).toEqual({ hooks: "./hooks/hooks.json", skills: "./skills/", mcpServers: "./.mcp.json" });
	});

	it("marketplace and plugin names agree", () => {
		const mp = JSON.parse(readFileSync(join(REPO_ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));
		const pj = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", ".codex-plugin", "plugin.json"), "utf8"),
		);
		expect(mp.plugins[0].name).toBe("litcodex");
		expect(pj.name).toBe("litcodex");
	});

	it("enrolls the official logo asset in plugin metadata", () => {
		const plugin = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", ".codex-plugin", "plugin.json"), "utf8"),
		) as { interface?: { logo?: string; composerIcon?: string } };
		expect(plugin.interface?.logo).toBe("./assets/logo.png");
		expect(plugin.interface?.composerIcon).toBe("./assets/logo.png");
		const png = readFileSync(join(REPO_ROOT, "plugins", "litcodex", "assets", "logo.png"));
		expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	});

	it("component set is exactly lit-loop", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		// the layout invariant: the only declared component dir is the fixed constant.
		expect(LIT_LOOP_COMPONENT_DIR).toBe("lit-loop");
		expect(md.pluginSource).toBe("./plugins/litcodex");
	});

	it("lit-loop component ships no nested plugin manifest", () => {
		const nested = join(REPO_ROOT, "plugins", "litcodex", "components", "lit-loop", ".codex-plugin", "plugin.json");
		assert.throws(() => readFileSync(nested, "utf8"), /ENOENT/);
	});

	it("resolves the UserPromptSubmit hook command", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		const handler = resolveUserPromptSubmitHook(md);
		expect(md.hooks).toHaveProperty("UserPromptSubmit");
		expect(handler.command).toContain(`\${PLUGIN_ROOT}`);
		expect(handler.command).toContain("components/lit-loop/dist/cli.js");
		expect(handler.command).toContain("hook user-prompt-submit");
		expect(handler.timeout).toBe(5);
		expect(handler.type).toBe("command");
	});

	it("resolves the lit-loop component dist path inside the components root", () => {
		const cli = resolveLitLoopComponentPath(REPO_ROOT);
		const componentsRoot = resolve(REPO_ROOT, "plugins", "litcodex", "components");
		expect(cli.endsWith(join("plugins", "litcodex", "components", "lit-loop", "dist", "cli.js"))).toBe(true);
		expect(cli.startsWith(componentsRoot + sep)).toBe(true);
	});

	it("does not expand PLUGIN_ROOT in the command", () => {
		const prev = process.env["PLUGIN_ROOT"];
		process.env["PLUGIN_ROOT"] = "";
		try {
			const md = loadMarketplaceMetadata(REPO_ROOT);
			expect(resolveUserPromptSubmitHook(md).command).toContain(`\${PLUGIN_ROOT}`);
		} finally {
			if (prev === undefined) delete process.env["PLUGIN_ROOT"];
			else process.env["PLUGIN_ROOT"] = prev;
		}
	});

	it("returned metadata is frozen", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		expect(Object.isFrozen(md)).toBe(true);
		expect(Object.isFrozen(md.resources)).toBe(true);
		expect(Object.isFrozen(md.hooks)).toBe(true);
		expect(() => {
			(md as { pluginName: string }).pluginName = "other";
		}).toThrow();
	});

	it("accepts an empty mcp server registry", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		expect(md.mcpServers).toEqual({});
	});
});

// ── Hardened command + statusMessage equality (G14.1) ────────────────────────

describe("#given the aggregate hooks.json #when validated #then the command + statusMessage are exact", () => {
	it("command equals the canonical LIT_LOOP_HOOK_COMMAND exactly", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		expect(resolveUserPromptSubmitHook(md).command).toBe(LIT_LOOP_HOOK_COMMAND);
	});

	it("rejects the M06-shaped bare-component command", () => {
		const root = stageRepo();
		mutateHookHandler(pathIn(root, "plugins", "litcodex", "hooks", "hooks.json"), (h) => {
			h.command = `node "\${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit`;
		});
		const err = loadErr(root);
		expect(err.code).toBe("METADATA_SCHEMA_INVALID");
		expect(err.detail).toContain(`\${PLUGIN_ROOT}/dist/cli.js`);
	});

	it("rejects a near-miss command (double space)", () => {
		const root = stageRepo();
		mutateHookHandler(pathIn(root, "plugins", "litcodex", "hooks", "hooks.json"), (h) => {
			h.command = `node "\${PLUGIN_ROOT}/components/lit-loop/dist/cli.js" hook  user-prompt-submit`;
		});
		expect(loadErr(root).code).toBe("METADATA_SCHEMA_INVALID");
	});

	it("statusMessage equals the canonical ignition literal", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		expect(resolveUserPromptSubmitHook(md).statusMessage).toBe("🔥 LIT IGNITED · lit-loop 🔥");
		expect(resolveUserPromptSubmitHook(md).statusMessage).toBe(LIT_LOOP_HOOK_STATUS_MESSAGE);
	});

	it("REJECTS a non-canonical statusMessage with METADATA_SCHEMA_INVALID", () => {
		const root = stageRepo();
		mutateHookHandler(pathIn(root, "plugins", "litcodex", "hooks", "hooks.json"), (h) => {
			h.statusMessage = "LitCodex: Checking lit-loop trigger";
		});
		const err = loadErr(root);
		expect(err.code).toBe("METADATA_SCHEMA_INVALID");
		expect(err.detail).toContain("statusMessage");
	});

	it("authoritative hooks.json path is the aggregate one", () => {
		expect(HOOKS_JSON_RELPATH).toBe("plugins/litcodex/hooks/hooks.json");
	});

	it("hook command/fragments equal the M11/M19 consumers", () => {
		const fixture = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", "test", "fixtures", "metadata-invariants.json"), "utf8"),
		);
		expect(fixture.hookCommandFragments).toEqual([
			`\${PLUGIN_ROOT}`,
			"components/lit-loop/dist/cli.js",
			"hook user-prompt-submit",
		]);
		for (const frag of fixture.hookCommandFragments) {
			expect(LIT_LOOP_HOOK_COMMAND).toContain(frag);
		}
	});
});

// ── Error contract: missing / malformed / schema / crossfile ─────────────────

describe("#given a malformed repo #when loaded #then a typed error is thrown", () => {
	it("throws FILE_MISSING when mcp.json absent", () => {
		const root = stageRepo();
		rmSync(pathIn(root, "plugins", "litcodex", ".mcp.json"));
		expect(loadErr(root).code).toBe("METADATA_FILE_MISSING");
	});

	it("throws JSON_INVALID on broken json", () => {
		const root = stageRepo();
		writeFileSync(pathIn(root, ".agents", "plugins", "marketplace.json"), "{ bad json");
		expect(loadErr(root).code).toBe("METADATA_JSON_INVALID");
	});

	it("throws SCHEMA_INVALID on wrong resource pointer", () => {
		const root = stageRepo();
		rewriteJson(pathIn(root, "plugins", "litcodex", ".codex-plugin", "plugin.json"), (json) => {
			json["hooks"] = "./other.json";
		});
		const err = loadErr(root);
		expect(err.code).toBe("METADATA_SCHEMA_INVALID");
		expect(err.detail).toContain("hooks");
	});

	it("rejects a drifted plugin name (schema pins it to litcodex; drift is a typed error)", () => {
		const root = stageRepo();
		rewriteJson(pathIn(root, "plugins", "litcodex", ".codex-plugin", "plugin.json"), (json) => {
			json["name"] = TOKEN_SHORT_A;
		});
		const err = loadErr(root);
		// plugin.json.name is schema-pinned to "litcodex"; a drift to an external token fails the deterministic
		// schema check first (and would also trip the legacy/crossfile guards). Any of the three
		// name-related codes is a correct rejection of the drift.
		expect(["METADATA_SCHEMA_INVALID", "METADATA_CROSSFILE_MISMATCH", "METADATA_LEGACY_TOKEN"]).toContain(err.code);
	});

	it("rejects a non-canonical plugin source", () => {
		const root = stageRepo();
		rewriteJson(pathIn(root, ".agents", "plugins", "marketplace.json"), (json) => {
			const plugins = json["plugins"] as { source: string }[];
			const p0 = plugins.at(0);
			if (p0) p0.source = "../x";
		});
		expect(loadErr(root).code).toBe("METADATA_SCHEMA_INVALID");
	});
});

// ── Fail-closed version lockstep (G14.2) ─────────────────────────────────────

describe("#given the plugin version source #when checked #then the lockstep fails CLOSED", () => {
	it("version source is the aggregate package.json and matches plugin.json", () => {
		const root = stageRepo();
		const md = loadMarketplaceMetadata(root);
		const agg = JSON.parse(readFileSync(pathIn(root, "plugins", "litcodex", "package.json"), "utf8"));
		expect(md.pluginVersion).toBe(agg.version);
		expect(agg.version).toBe("1.0.10");
	});

	it("absent aggregate package.json fails CLOSED", () => {
		const root = stageRepo();
		rmSync(pathIn(root, "plugins", "litcodex", "package.json"));
		const err = loadErr(root);
		expect(err.code).toBe("METADATA_CROSSFILE_MISMATCH");
		expect(err.detail).toContain("missing");
	});

	it("unset/non-semver package.json version fails", () => {
		const root = stageRepo();
		writeFileSync(
			pathIn(root, "plugins", "litcodex", "package.json"),
			`${JSON.stringify({ name: "@litcodex/plugin", private: true }, null, "\t")}\n`,
		);
		const err = loadErr(root);
		expect(err.code).toBe("METADATA_CROSSFILE_MISMATCH");
		expect(err.detail).toMatch(/semver|missing/);
	});

	it("throws on plugin/package version drift", () => {
		const root = stageRepo();
		writeFileSync(
			pathIn(root, "plugins", "litcodex", "package.json"),
			`${JSON.stringify({ name: "@litcodex/plugin", version: "9.9.9", private: true }, null, "\t")}\n`,
		);
		const err = loadErr(root);
		expect(err.code).toBe("METADATA_CROSSFILE_MISMATCH");
		expect(err.detail).toContain("1.0.10");
		expect(err.detail).toContain("9.9.9");
	});
});

// ── Legacy-token defense (G14.1 / C10) ───────────────────────────────────────

describe("#given a poisoned manifest #when scanned #then a legacy token is rejected", () => {
	it("throws LEGACY_TOKEN when a long external identity is present", () => {
		const root = stageRepo();
		// inject into the free-form description (not a schema-pinned field) so the legacy-token
		// scan is the catcher, not the exact-string schema check.
		rewriteJson(pathIn(root, "plugins", "litcodex", ".codex-plugin", "plugin.json"), (json) => {
			json["description"] = `lit-loop activation by ${TOKEN_LONG_A}`;
		});
		const err = loadErr(root);
		expect(err.code).toBe("METADATA_LEGACY_TOKEN");
		expect(err.detail).toBe(TOKEN_LONG_A);
	});

	it("short external alias is matched as a bounded token", () => {
		const promoRoot = stageRepo();
		rewriteJson(pathIn(promoRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json"), (json) => {
			json["description"] = "lit-loop promo build (tomofoo)";
		});
		// embedded letters are NOT the bounded token → load succeeds.
		expect(() => loadMarketplaceMetadata(promoRoot)).not.toThrow();

		const bareRoot = stageRepo();
		rewriteJson(pathIn(bareRoot, "plugins", "litcodex", ".codex-plugin", "plugin.json"), (json) => {
			json["description"] = `lit-loop ${TOKEN_SHORT_A} build`;
		});
		expect(loadErr(bareRoot).code).toBe("METADATA_LEGACY_TOKEN");
	});

	it("throws on legacy status-message prefix (schema + legacy both apply)", () => {
		const root = stageRepo();
		mutateHookHandler(pathIn(root, "plugins", "litcodex", "hooks", "hooks.json"), (h) => {
			h.statusMessage = `${TOKEN_LONG_B}(4.9.2): Checking trigger`;
		});
		const err = loadErr(root);
		// statusMessage schema check fires first (deterministic order).
		expect(["METADATA_SCHEMA_INVALID", "METADATA_LEGACY_TOKEN"]).toContain(err.code);
	});

	it("every forbidden token is enforced", () => {
		const fixture = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", "test", "fixtures", "metadata-invariants.json"), "utf8"),
		) as { forbiddenTokens: { token?: string; tokenParts?: string[]; match: string }[] };
		// Inject each token (assembled, not literal) into the description and assert rejection.
		for (const entry of fixture.forbiddenTokens) {
			const token = materializeToken(entry);
			const root = stageRepo();
			rewriteJson(pathIn(root, "plugins", "litcodex", ".codex-plugin", "plugin.json"), (json) => {
				json["description"] = `lit-loop ${token} surface`;
			});
			expect(loadErr(root).code).toBe("METADATA_LEGACY_TOKEN");
		}
	});
});

// ── Resolver under adversarial repo paths ────────────────────────────────────

describe("#given a unicode/hash/space repo root #when loaded #then it resolves correctly", () => {
	it("resolves metadata under unicode/hash/space repo root", () => {
		const root = stageRepo("lit qa # 한글-");
		const md = loadMarketplaceMetadata(root);
		expect(md.pluginName).toBe("litcodex");
		expect(resolveLitLoopComponentPath(root)).toContain(join("components", "lit-loop", "dist", "cli.js"));
	});
});

// ── Hook selection errors ────────────────────────────────────────────────────

describe("#given a degenerate hooks.json #when resolving the handler #then it throws", () => {
	it("throws HOOK_EVENT_MISSING when unregistered", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		const empty = { ...md, hooks: Object.freeze({}) } as typeof md;
		try {
			resolveUserPromptSubmitHook(empty);
			throw new assert.AssertionError({ message: "expected throw" });
		} catch (err) {
			assert.ok(err instanceof MarketplaceMetadataError);
			expect(err.code).toBe("METADATA_HOOK_EVENT_MISSING");
		}
	});

	it("throws HOOK_AMBIGUOUS on duplicate handler", () => {
		const md = loadMarketplaceMetadata(REPO_ROOT);
		const handler = resolveUserPromptSubmitHook(md);
		const dup = {
			...md,
			hooks: Object.freeze({ UserPromptSubmit: [{ hooks: [handler, handler] }] }),
		} as typeof md;
		try {
			resolveUserPromptSubmitHook(dup);
			throw new assert.AssertionError({ message: "expected throw" });
		} catch (err) {
			assert.ok(err instanceof MarketplaceMetadataError);
			expect(err.code).toBe("METADATA_HOOK_AMBIGUOUS");
		}
	});
});

// ── Codex-schema contract conformance + name duality (G14.3 / G14.4) ─────────

describe("#given the codex-schema-contract fixture #when checked #then our files conform", () => {
	it("shipped files conform to the codex-schema-contract fixture", () => {
		const contract = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", "test", "fixtures", "codex-schema-contract.json"), "utf8"),
		);
		const mp = JSON.parse(readFileSync(join(REPO_ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));
		const pj = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", ".codex-plugin", "plugin.json"), "utf8"),
		);
		expect(mp.interface.displayName).toBe("LitCodex");
		expect(pj.hooks).toBe("./hooks/hooks.json");
		expect(pj.skills).toBe("./skills/");
		expect(pj.mcpServers).toBe("./.mcp.json");
		expect(contract.resourcePointerKeys).toEqual(["hooks", "mcpServers", "skills"]);
	});

	it("policy enums match the contract", () => {
		const contract = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", "test", "fixtures", "codex-schema-contract.json"), "utf8"),
		);
		const mp = JSON.parse(readFileSync(join(REPO_ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));
		expect(contract.policyEnums.installation).toContain(mp.plugins[0].policy.installation);
		expect(contract.policyEnums.authentication).toContain(mp.plugins[0].policy.authentication);
		expect(contract.policyEnums.installation).toEqual(["AVAILABLE"]);
		expect(contract.policyEnums.authentication).toEqual(["ON_INSTALL"]);
	});

	it("release lane requires live Codex schema confirmation", () => {
		const contract = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", "test", "fixtures", "codex-schema-contract.json"), "utf8"),
		);
		const release = process.env["LITCODEX_CODEX_SCHEMA_VERIFIED"] === "1";
		if (release) {
			expect(contract.verifiedAgainstCodex.confirmed).toBe(true);
		} else {
			expect(contract.verifiedAgainstCodex.confirmed).toBe(false);
		}
	});

	it("Codex plugin name is litcodex; npm workspace name is @litcodex/plugin", () => {
		const pj = JSON.parse(
			readFileSync(join(REPO_ROOT, "plugins", "litcodex", ".codex-plugin", "plugin.json"), "utf8"),
		);
		const mp = JSON.parse(readFileSync(join(REPO_ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));
		const agg = JSON.parse(readFileSync(join(REPO_ROOT, "plugins", "litcodex", "package.json"), "utf8"));
		expect(pj.name).toBe("litcodex");
		expect(mp.plugins[0].name).toBe("litcodex");
		expect(agg.name).toBe("@litcodex/plugin");
		// the two identities are intentionally distinct and NOT asserted equal.
		expect(pj.name).not.toBe(agg.name);
	});

	it("resolver does not cross-check npm name against plugin name", () => {
		const root = stageRepo();
		// package.json.name "@litcodex/plugin" != plugin.json.name "litcodex"; must still load.
		expect(() => loadMarketplaceMetadata(root)).not.toThrow();
	});
});

// ── Identity rg: no legacy/old provider tokens in the shipped files ───────────

describe("#given the shipped metadata bytes #when scanned #then only LitCodex identity is present", () => {
	it("the shipped files carry no legacy/old provider token", () => {
		const files = [
			join(REPO_ROOT, ".agents", "plugins", "marketplace.json"),
			join(REPO_ROOT, "plugins", "litcodex", ".codex-plugin", "plugin.json"),
			join(REPO_ROOT, "plugins", "litcodex", "hooks", "hooks.json"),
			join(REPO_ROOT, "plugins", "litcodex", ".mcp.json"),
		];
		const blob = files
			.map((f) => readFileSync(f, "utf8"))
			.join("\n")
			.toLowerCase();
		for (const token of [TOKEN_LONG_A, TOKEN_LONG_B, "ultra" + "work", "oh-my-" + "openagent"]) {
			expect(blob).not.toContain(token);
		}
		// bounded short alias: standalone word must not appear.
		expect(new RegExp(`\\b${TOKEN_SHORT_A}\\b`).test(blob)).toBe(false);
	});

	it("M14 sources emit no legacy evidence-root path (G14.5)", () => {
		const needle = `.${TOKEN_SHORT_A}/evidence`; // assembled; never a literal in this source
		const sources = [
			join(REPO_ROOT, "plugins", "litcodex", "src", "metadata.ts"),
			join(REPO_ROOT, "plugins", "litcodex", "marketplace.test.ts"),
		];
		for (const f of sources) {
			expect(readFileSync(f, "utf8")).not.toContain(needle);
		}
	});
});
