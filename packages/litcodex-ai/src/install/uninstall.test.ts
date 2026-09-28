import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { installedAgentPath } from "./agent-routing.js";
import { prepareAgentSources } from "./agents-install.js";
import { runUninstall, type UninstallFs } from "./uninstall.js";

const MANAGED_DEFAULT = `${[
	'name = "default"',
	'description = "General-purpose LitCodex helper route for omitted-agent dispatch."',
	'nickname_candidates = ["Worker"]',
	'model = "gpt-5.6-luna"',
	'model_reasoning_effort = "max"',
	"",
	'developer_instructions = """',
	"Role: general-purpose LitCodex helper.",
	"",
	"Work on the parent task using the permissions, tools, and sandbox supplied by Codex. Follow the",
	"parent's scope and safety constraints, inspect before changing anything, and report concrete files,",
	"commands, results, and blockers. Do not assume that a role-specific research or review contract",
	"applies unless the parent asks for it.",
	'"""',
].join("\n")}\n`;

function nativeBinding(codexHome: string): string {
	return `[agents.default]\nconfig_file = ${JSON.stringify(join(codexHome, "litcodex-default.toml"))}\n`;
}

function writeManagedMarketplace(codexHome: string): string {
	const root = join(codexHome, "marketplaces", "litcodex");
	mkdirSync(join(root, ".agents", "plugins"), { recursive: true });
	mkdirSync(join(root, "plugins", "litcodex", ".codex-plugin"), { recursive: true });
	for (const relative of [".agents/plugins/marketplace.json", "plugins/litcodex/.codex-plugin/plugin.json"]) {
		writeFileSync(join(root, relative), readFileSync(join(process.cwd(), relative), "utf8"));
	}
	return root;
}

function realFs(): UninstallFs {
	return {
		existsSync,
		lstatSync,
		readdirSync: (path) => readdirSync(path) as string[],
		rmSync: (path, options) => rmSync(path, options),
		rmdirSync: (path) => rmdirSync(path),
		readFileSync: (path, encoding) => readFileSync(path, encoding),
		writeFileSync: (path, data) => writeFileSync(path, data),
	};
}

describe("runUninstall", () => {
	const bundled = prepareAgentSources({ now: () => 0, repoRoot: process.cwd() }).sources;
	const namedRole = bundled.find((source) => source.file === "litcodex-plan.toml");
	if (namedRole === undefined) throw new Error("Bundled plan role missing");

	it.each(["api-key", "chatgpt"] as const)("removes byte-identical bundled roles for %s auth", (authMode) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-bundled-"));
		const codexHome = join(root, ".codex");
		mkdirSync(join(codexHome, "agents"), { recursive: true });
		const sources = prepareAgentSources({ now: () => 0, repoRoot: process.cwd(), authMode }).sources;
		try {
			for (const source of sources) writeFileSync(installedAgentPath(codexHome, source.file), source.content);
			writeFileSync(join(codexHome, "config.toml"), nativeBinding(codexHome));
			const result = runUninstall({ codexBin: "codex", codexHome, spawn: () => ({ status: 0 }), fs: realFs() });
			expect(result.ok).toBe(true);
			for (const source of sources) expect(existsSync(installedAgentPath(codexHome, source.file))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each(["modified", "foreign", "symlink", "directory"] as const)("preserves %s same-prefix roles", (kind) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-ownership-"));
		const codexHome = join(root, ".codex");
		const agentsDir = join(codexHome, "agents");
		mkdirSync(agentsDir, { recursive: true });
		const target = join(agentsDir, kind === "foreign" ? "litcodex-user-owned.toml" : namedRole.file);
		const victim = join(root, "user-owned.toml");
		const expected = kind === "modified" ? `${namedRole.content}# user modification\n` : namedRole.content;
		try {
			if (kind === "symlink") {
				writeFileSync(victim, expected);
				symlinkSync(victim, target);
			} else if (kind === "directory") {
				mkdirSync(target);
				writeFileSync(join(target, "keep.txt"), expected);
			} else writeFileSync(target, expected);
			const result = runUninstall({ codexBin: "codex", codexHome, spawn: () => ({ status: 0 }), fs: realFs() });
			expect(result.ok).toBe(true);
			expect(existsSync(target)).toBe(true);
			if (kind === "symlink") expect(lstatSync(target).isSymbolicLink()).toBe(true);
			expect(readFileSync(kind === "directory" ? join(target, "keep.txt") : target, "utf8")).toBe(expected);
			if (kind === "symlink") expect(readFileSync(victim, "utf8")).toBe(expected);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not treat customized marketplace payload as canonical ownership evidence", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-marketplace-"));
		const codexHome = join(root, ".codex");
		const target = installedAgentPath(codexHome, namedRole.file);
		const marketplaceAgents = join(codexHome, "marketplaces/litcodex/plugins/litcodex/components/lit-loop/agents");
		const custom = `${namedRole.content}# identical user customization in marketplace and installed role\n`;
		try {
			mkdirSync(join(codexHome, "agents"), { recursive: true });
			writeManagedMarketplace(codexHome);
			mkdirSync(marketplaceAgents, { recursive: true });
			writeFileSync(target, custom);
			writeFileSync(join(marketplaceAgents, namedRole.file), custom);
			runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: (_cmd, args) => ({ status: args.includes("marketplace") ? 1 : 0 }),
				fs: realFs(),
			});
			expect(readFileSync(target, "utf8")).toBe(custom);
			expect(readFileSync(join(marketplaceAgents, namedRole.file), "utf8")).toBe(custom);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves unreadable roles and continues removing independently verified roles", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-unreadable-"));
		const codexHome = join(root, ".codex");
		const preserved = installedAgentPath(codexHome, namedRole.file);
		const other = bundled.find((source) => source.file === "litcodex-explorer.toml");
		if (other === undefined) throw new Error("Bundled explorer role missing");
		try {
			mkdirSync(join(codexHome, "agents"), { recursive: true });
			writeFileSync(preserved, namedRole.content);
			writeFileSync(installedAgentPath(codexHome, other.file), other.content);
			runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: () => ({ status: 0 }),
				fs: {
					...realFs(),
					readFileSync: (path, encoding) => {
						if (path === preserved) throw new Error("unreadable role");
						return readFileSync(path, encoding);
					},
				},
			});
			expect(readFileSync(preserved, "utf8")).toBe(namedRole.content);
			expect(existsSync(installedAgentPath(codexHome, other.file))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each(["agents-symlink", "home-symlink", "agents-file"] as const)("preserves roles beneath unsafe %s", (kind) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-unsafe-dir-"));
		const codexHome = join(root, ".codex");
		const outside = join(root, "user-owned");
		mkdirSync(outside);
		let target: string;
		try {
			if (kind === "home-symlink") {
				mkdirSync(join(outside, "agents"));
				symlinkSync(outside, codexHome);
				target = join(outside, "agents", namedRole.file);
			} else {
				mkdirSync(codexHome);
				if (kind === "agents-symlink") {
					symlinkSync(outside, join(codexHome, "agents"));
					target = join(outside, namedRole.file);
				} else target = join(codexHome, "agents");
			}
			writeFileSync(target, namedRole.content);
			runUninstall({ codexBin: "codex", codexHome, spawn: () => ({ status: 0 }), fs: realFs() });
			expect(readFileSync(target, "utf8")).toBe(namedRole.content);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([
		"marketplace-parent-symlink",
		"marketplace-root-symlink",
		"marketplace-parent-file",
		"marketplace-root-file",
		"foreign-marketplace-root-directory",
		"home-symlink",
		"home-file",
		"broken-marketplace-parent-symlink",
		"broken-marketplace-root-symlink",
	] as const)("rejects unsafe %s before native removal or local mutations", (kind) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-cache-boundary-"));
		const codexHome = join(root, ".codex");
		const outside = join(root, "user-owned");
		const victim = join(outside, "marketplaces", "litcodex", "keep.txt");
		const calls: string[][] = [];
		let unsafePath: string;
		try {
			mkdirSync(join(outside, "marketplaces", "litcodex"), { recursive: true });
			writeFileSync(victim, "user-owned victim");
			if (kind.startsWith("home-")) unsafePath = codexHome;
			else {
				mkdirSync(codexHome);
				unsafePath = join(codexHome, "marketplaces");
				if (kind.includes("root")) {
					mkdirSync(unsafePath);
					unsafePath = join(unsafePath, "litcodex");
				}
			}
			if (kind.endsWith("file")) writeFileSync(unsafePath, "foreign file");
			else if (kind.endsWith("directory")) {
				mkdirSync(unsafePath);
				writeFileSync(join(unsafePath, "keep.txt"), "foreign directory");
			} else {
				const linkTarget = kind.startsWith("broken-")
					? join(root, "missing")
					: kind === "home-symlink"
						? outside
						: kind.includes("parent")
							? join(outside, "marketplaces")
							: join(outside, "marketplaces", "litcodex");
				symlinkSync(linkTarget, unsafePath);
			}
			const result = runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: (_cmd, args) => {
					calls.push([...args]);
					return { status: 0 };
				},
				fs: realFs(),
			});
			expect.soft(result).toEqual({ ok: false, codexHome });
			expect.soft(calls).toEqual([]);
			expect.soft(existsSync(victim)).toBe(true);
			if (existsSync(victim)) expect.soft(readFileSync(victim, "utf8")).toBe("user-owned victim");
			if (kind.endsWith("file")) {
				expect.soft(existsSync(unsafePath)).toBe(true);
				if (existsSync(unsafePath)) expect.soft(readFileSync(unsafePath, "utf8")).toBe("foreign file");
			} else if (kind.endsWith("directory")) {
				expect.soft(existsSync(join(unsafePath, "keep.txt"))).toBe(true);
				if (existsSync(join(unsafePath, "keep.txt"))) {
					expect.soft(readFileSync(join(unsafePath, "keep.txt"), "utf8")).toBe("foreign directory");
				}
			} else {
				expect.soft(() => lstatSync(unsafePath)).not.toThrow();
				try {
					expect.soft(lstatSync(unsafePath).isSymbolicLink()).toBe(true);
				} catch {
					/* Missing link already reported. */
				}
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([1, 2])("stops if native removal %i changes the cache parent into a symlink", (changeAfterCall) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-cache-swap-"));
		const codexHome = join(root, ".codex");
		const outside = join(root, "user-owned");
		const victim = join(outside, "litcodex", "keep.txt");
		let calls = 0;
		try {
			writeManagedMarketplace(codexHome);
			mkdirSync(join(outside, "litcodex"), { recursive: true });
			writeFileSync(victim, "user-owned victim");
			const result = runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: () => {
					calls += 1;
					if (calls === changeAfterCall) {
						renameSync(join(codexHome, "marketplaces"), join(root, "saved-marketplaces"));
						symlinkSync(outside, join(codexHome, "marketplaces"));
					}
					return { status: 0 };
				},
				fs: realFs(),
			});
			expect.soft(result.ok).toBe(false);
			expect.soft(calls).toBe(changeAfterCall);
			expect.soft(existsSync(victim)).toBe(true);
			if (existsSync(victim)) expect.soft(readFileSync(victim, "utf8")).toBe("user-owned victim");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each(["subagent-keys", "native-binding"] as const)("preserves an external config symlink with %s", (kind) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-config-victim-"));
		const codexHome = join(root, ".codex");
		const configPath = join(codexHome, "config.toml");
		const victim = join(root, "user-config.toml");
		const content =
			kind === "native-binding"
				? `model = "gpt-6-astra"\n${nativeBinding(codexHome)}`
				: '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\ndefault_subagent_reasoning_effort = "max"\nmax_depth = 2\n';
		let calls = 0;
		try {
			mkdirSync(codexHome);
			writeFileSync(victim, content);
			symlinkSync(victim, configPath);
			if (kind === "native-binding") writeFileSync(join(codexHome, "litcodex-default.toml"), MANAGED_DEFAULT);
			const result = runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: () => {
					calls += 1;
					return { status: 0 };
				},
				fs: realFs(),
			});
			expect.soft(result).toEqual({ ok: false, codexHome });
			expect.soft(calls).toBe(0);
			expect.soft(readFileSync(victim, "utf8")).toBe(content);
			expect.soft(lstatSync(configPath).isSymbolicLink()).toBe(true);
			if (kind === "native-binding") expect.soft(existsSync(join(codexHome, "litcodex-default.toml"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each(["broken-symlink", "directory", "unreadable"] as const)("rejects %s config before native calls", (kind) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-config-leaf-"));
		const codexHome = join(root, ".codex");
		const configPath = join(codexHome, "config.toml");
		let calls = 0;
		try {
			mkdirSync(codexHome);
			if (kind === "broken-symlink") symlinkSync(join(root, "missing.toml"), configPath);
			else if (kind === "directory") {
				mkdirSync(configPath);
				writeFileSync(join(configPath, "keep.txt"), "user data");
			} else writeFileSync(configPath, "user data");
			const result = runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: () => {
					calls += 1;
					return { status: 0 };
				},
				fs: {
					...realFs(),
					readFileSync: (path, encoding) => {
						if (kind === "unreadable" && path === configPath) throw new Error("unreadable config");
						return readFileSync(path, encoding);
					},
				},
			});
			expect.soft(result).toEqual({ ok: false, codexHome });
			expect.soft(calls).toBe(0);
			if (kind === "broken-symlink") expect.soft(lstatSync(configPath).isSymbolicLink()).toBe(true);
			else
				expect
					.soft(readFileSync(kind === "directory" ? join(configPath, "keep.txt") : configPath, "utf8"))
					.toBe("user data");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it.each([1, 2])("stops when native removal %i redirects config to an external file", (changeAfterCall) => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-config-swap-"));
		const codexHome = join(root, ".codex");
		const configPath = join(codexHome, "config.toml");
		const victim = join(root, "user-config.toml");
		const content = '[agents]\ndefault_subagent_model = "gpt-5.6-luna"\nmax_depth = 2\n';
		let calls = 0;
		try {
			mkdirSync(codexHome);
			writeFileSync(configPath, 'model = "gpt-6-astra"\n');
			writeFileSync(victim, content);
			const result = runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: () => {
					calls += 1;
					if (calls === changeAfterCall) {
						rmSync(configPath);
						symlinkSync(victim, configPath);
					}
					return { status: 0 };
				},
				fs: realFs(),
			});
			expect.soft(result.ok).toBe(false);
			expect.soft(calls).toBe(changeAfterCall);
			expect.soft(readFileSync(victim, "utf8")).toBe(content);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("removes plugin, marketplace registration, managed payload, and only LitCodex agents", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-managed-cache-"));
		const codexHome = join(root, ".codex");
		const calls: string[] = [];
		try {
			const managedRoot = writeManagedMarketplace(codexHome);
			mkdirSync(join(codexHome, "agents"));
			writeFileSync(join(codexHome, "litcodex-default.toml"), MANAGED_DEFAULT);
			writeFileSync(join(codexHome, "agents", namedRole.file), namedRole.content);
			writeFileSync(join(codexHome, "agents", "user-agent.toml"), "user-owned agent");
			const result = runUninstall({
				codexBin: "codex",
				codexHome,
				spawn: (_cmd, args) => {
					calls.push(args.join(" "));
					return { status: 0 };
				},
				fs: realFs(),
			});
			expect(result.ok).toBe(true);
			expect(calls).toEqual(["plugin remove litcodex@litcodex", "plugin marketplace remove litcodex"]);
			expect(existsSync(managedRoot)).toBe(false);
			expect(existsSync(join(codexHome, "litcodex-default.toml"))).toBe(false);
			expect(existsSync(join(codexHome, "agents", namedRole.file))).toBe(false);
			expect(readFileSync(join(codexHome, "agents", "user-agent.toml"), "utf8")).toBe("user-owned agent");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not delete the managed payload if marketplace deregistration fails", () => {
		const removed: string[] = [];
		const result = runUninstall({
			codexBin: "/usr/local/bin/codex",
			codexHome: "/tmp/codex-home",
			spawn: (_cmd, args) => ({ status: args.includes("marketplace") ? 1 : 0 }),
			fs: { existsSync: () => true, readdirSync: () => [], rmSync: (path) => removed.push(path) },
		});
		expect(result.ok).toBe(false);
		expect(removed).not.toContain("/tmp/codex-home/marketplaces/litcodex");
	});

	it("preserves a valid customized native default role and its binding on uninstall", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-custom-"));
		const codexHome = join(root, ".codex");
		mkdirSync(codexHome, { recursive: true });
		const target = join(codexHome, "litcodex-default.toml");
		const configPath = join(codexHome, "config.toml");
		const custom = MANAGED_DEFAULT.replace("report concrete files,", "report user-customized files,");
		const config = `model = "gpt-6-astra"\n\n${nativeBinding(codexHome)}`;
		writeFileSync(target, custom);
		writeFileSync(configPath, config);

		try {
			const result = runUninstall({
				codexBin: "/usr/local/bin/codex",
				codexHome,
				spawn: () => ({ status: 0 }),
				fs: realFs(),
			});

			expect(result.ok).toBe(true);
			expect(existsSync(target)).toBe(true);
			expect(readFileSync(target, "utf8")).toBe(custom);
			expect(readFileSync(configPath, "utf8")).toBe(config);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves a symlinked native default role and its victim on uninstall", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-symlink-"));
		const codexHome = join(root, ".codex");
		mkdirSync(codexHome, { recursive: true });
		const target = join(codexHome, "litcodex-default.toml");
		const victim = join(root, "user-owned-default.toml");
		const configPath = join(codexHome, "config.toml");
		const victimBytes = [
			'name = "default"',
			'description = "User-owned symlink target."',
			'model = "custom/provider-model"',
			'model_reasoning_effort = "medium"',
			'developer_instructions = """',
			"Do not follow or remove this user-owned target.",
			'"""',
		].join("\n");
		writeFileSync(victim, victimBytes);
		symlinkSync(victim, target);
		writeFileSync(configPath, nativeBinding(codexHome));

		try {
			runUninstall({
				codexBin: "/usr/local/bin/codex",
				codexHome,
				spawn: () => ({ status: 0 }),
				fs: realFs(),
			});

			expect(lstatSync(target).isSymbolicLink()).toBe(true);
			expect(readFileSync(victim, "utf8")).toBe(victimBytes);
			expect(readFileSync(configPath, "utf8")).toBe(nativeBinding(codexHome));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves a managed-looking role when its binding text is inside a user multiline value", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-multiline-"));
		const codexHome = join(root, ".codex");
		mkdirSync(codexHome, { recursive: true });
		const target = join(codexHome, "litcodex-default.toml");
		const configPath = join(codexHome, "config.toml");
		const config = `notes = """
[agents.default]
config_file = ${JSON.stringify(target)}
"""
`;
		writeFileSync(target, MANAGED_DEFAULT);
		writeFileSync(configPath, config);

		try {
			const result = runUninstall({
				codexBin: "/usr/local/bin/codex",
				codexHome,
				spawn: () => ({ status: 0 }),
				fs: realFs(),
			});

			expect(result.ok).toBe(true);
			expect(readFileSync(target, "utf8")).toBe(MANAGED_DEFAULT);
			expect(readFileSync(configPath, "utf8")).toBe(config);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves a managed-looking role when its native table has additional user fields", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-table-"));
		const codexHome = join(root, ".codex");
		mkdirSync(codexHome, { recursive: true });
		const target = join(codexHome, "litcodex-default.toml");
		const configPath = join(codexHome, "config.toml");
		const config = `model = "gpt-6-astra"

[agents.default]
config_file = ${JSON.stringify(target)}
user_owned_field = "keep in agents.default"

[unrelated]
keep = true
`;
		writeFileSync(target, MANAGED_DEFAULT);
		writeFileSync(configPath, config);

		try {
			const result = runUninstall({
				codexBin: "/usr/local/bin/codex",
				codexHome,
				spawn: () => ({ status: 0 }),
				fs: realFs(),
			});

			expect(result.ok).toBe(true);
			expect(readFileSync(target, "utf8")).toBe(MANAGED_DEFAULT);
			expect(readFileSync(configPath, "utf8")).toBe(config);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("removes only the exact managed native default and its native binding", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-managed-"));
		const codexHome = join(root, ".codex");
		mkdirSync(codexHome, { recursive: true });
		const target = join(codexHome, "litcodex-default.toml");
		const configPath = join(codexHome, "config.toml");
		const config = `model = "gpt-6-astra"\n\n${nativeBinding(codexHome)}\n[unrelated]\nkeep = true\n`;
		writeFileSync(target, MANAGED_DEFAULT);
		writeFileSync(configPath, config);

		try {
			const result = runUninstall({
				codexBin: "/usr/local/bin/codex",
				codexHome,
				spawn: () => ({ status: 0 }),
				fs: realFs(),
			});

			expect(result.ok).toBe(true);
			expect(existsSync(target)).toBe(false);
			const after = readFileSync(configPath, "utf8");
			expect(after).not.toContain("[agents.default]");
			expect(after).not.toContain(target);
			expect(after).toContain('model = "gpt-6-astra"');
			expect(after).toContain("[unrelated]\nkeep = true");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// docs/usage.md:216 promises `litcodex uninstall` removes LitCodex-managed config; the
	// per-model profile files ensureGpt56ProfileFiles writes at codexHome were never cleaned up.
	it("removes managed per-model profile files and preserves a user-edited one", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-profiles-"));
		const codexHome = join(root, ".codex");
		mkdirSync(codexHome, { recursive: true });
		writeFileSync(
			join(codexHome, "gpt6-astra-xhigh.config.toml"),
			'model = "gpt-6-astra"\nmodel_reasoning_effort = "xhigh"\n',
		);
		writeFileSync(
			join(codexHome, "gpt56-sol-high.config.toml"),
			'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "high"\nmodel_auto_compact_token_limit = 650000\n',
		);
		const userEdited = 'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\n# user edit\n';
		writeFileSync(join(codexHome, "gpt56-terra-high.config.toml"), userEdited);
		try {
			const result = runUninstall({ codexBin: "codex", codexHome, spawn: () => ({ status: 0 }), fs: realFs() });
			expect(result.ok).toBe(true);
			expect(existsSync(join(codexHome, "gpt6-astra-xhigh.config.toml"))).toBe(false);
			expect(existsSync(join(codexHome, "gpt56-sol-high.config.toml"))).toBe(false);
			expect(readFileSync(join(codexHome, "gpt56-terra-high.config.toml"), "utf8")).toBe(userEdited);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("removes the agents directory once every managed role inside it is gone", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-empty-agents-"));
		const codexHome = join(root, ".codex");
		const agentsDir = join(codexHome, "agents");
		mkdirSync(agentsDir, { recursive: true });
		for (const source of bundled) writeFileSync(installedAgentPath(codexHome, source.file), source.content);
		writeFileSync(join(codexHome, "config.toml"), nativeBinding(codexHome));
		try {
			const result = runUninstall({ codexBin: "codex", codexHome, spawn: () => ({ status: 0 }), fs: realFs() });
			expect(result.ok).toBe(true);
			expect(existsSync(agentsDir)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("leaves the agents directory in place when a user file still lives in it", () => {
		const root = mkdtempSync(join(tmpdir(), "litcodex-uninstall-nonempty-agents-"));
		const codexHome = join(root, ".codex");
		const agentsDir = join(codexHome, "agents");
		mkdirSync(agentsDir, { recursive: true });
		for (const source of bundled) writeFileSync(installedAgentPath(codexHome, source.file), source.content);
		writeFileSync(join(agentsDir, "user-agent.toml"), "user-owned agent");
		writeFileSync(join(codexHome, "config.toml"), nativeBinding(codexHome));
		try {
			const result = runUninstall({ codexBin: "codex", codexHome, spawn: () => ({ status: 0 }), fs: realFs() });
			expect(result.ok).toBe(true);
			expect(existsSync(agentsDir)).toBe(true);
			expect(readFileSync(join(agentsDir, "user-agent.toml"), "utf8")).toBe("user-owned agent");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
