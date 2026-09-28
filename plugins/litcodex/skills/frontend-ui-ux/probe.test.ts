import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FRONTEND_UIUX_PAYLOAD_HASHES } from "../../../../packages/litcodex-ai/src/install/skill-resource-hashes.js";
import { cases, formatProbeConsole, matrixExitCode, probe, startServer, staticFallback } from "./scripts/probe.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

describe("frontend probe Phase 0", () => {
	it("covers the responsive and state matrix", () => {
		expect(cases.map((item) => item.id)).toEqual([
			"320", "390", "768", "1440", "390-dark", "390-reduced-motion", "1440-zoom200",
		]);
	});

	it("reports static signals and leaves rendered rules unverified", () => {
		const rough = readFileSync(new URL("./fixtures/sloppy.html", import.meta.url), "utf8");
		const clean = readFileSync(new URL("./fixtures/clean.html", import.meta.url), "utf8");
		expect(staticFallback(rough).findings.map((item) => item.rule)).toContain("SLOP-058");
		expect(staticFallback(rough).findings.map((item) => item.rule)).toContain("CF-503");
		expect(staticFallback(clean).findings).toEqual([]);
		expect(staticFallback(clean).manifest.not_verified.length).toBeGreaterThan(0);
		expect(staticFallback(rough).findings.every((item) => item.viewport === 'static' && /:\d+$/.test(item.selector))).toBe(true);
		expect(staticFallback(clean).manifest.url).toBeNull();
		expect(staticFallback(clean).manifest.browser_version).toBeNull();
	});

	it("runs through a symlinked skill directory with the same usage result", () => {
		const temp = mkdtempSync(join(tmpdir(), "uiux-probe-symlink-"));
		try {
			const actual = fileURLToPath(new URL("./scripts/probe.mjs", import.meta.url));
			symlinkSync(fileURLToPath(new URL("./", import.meta.url)), join(temp, "linked skill"), "dir");
			const linked = join(temp, "linked skill", "scripts", "probe.mjs");
			const run = (path: string) => spawnSync(process.execPath, [path, "--unknown"], { encoding: "utf8" });
			const realResult = run(actual);
			const linkedResult = run(linked);
			expect(realResult.status).toBe(2);
			expect(linkedResult.status).toBe(realResult.status);
			expect(linkedResult.stdout).toBe(realResult.stdout);
			expect(linkedResult.stderr).toBe(realResult.stderr);
			expect(linkedResult.stderr).toContain("Usage: probe.mjs");
		} finally { rmSync(temp, { recursive: true, force: true }); }
	});

	it("reports server startup failure as browser unavailable with its cause", async () => {
		const temp = mkdtempSync(join(tmpdir(), "uiux-probe-server-"));
		try {
			const page = join(temp, "index.html");
			const serverScript = join(temp, "fail-server.mjs");
			writeFileSync(page, "<!doctype html><title>Present</title>");
			writeFileSync(serverScript, "process.stderr.write('EPERM listen 127.0.0.1:0\\n'); process.exit(1);\n");
			await expect(startServer(page, serverScript)).rejects.toThrow(/EPERM listen/);
			const result = await probe(page, join(temp, "evidence"), {
				capability: { available: true, command: "agent-browser", version: "test" },
				serverStart: async () => { throw new Error("EPERM listen 127.0.0.1:0"); },
			});
			expect(result.manifest.blocked_reason).toBe("browser unavailable");
			expect(result.manifest.detail).toContain("EPERM listen");
			expect(formatProbeConsole(result)).toMatchObject({
				stdout: "BLOCKED: browser unavailable\n",
				stderr: expect.stringContaining("EPERM listen"),
			});
		} finally { rmSync(temp, { recursive: true, force: true }); }
	});

	it("reserves no entry page found for absent HTML and explains browser launch failure", async () => {
		const temp = mkdtempSync(join(tmpdir(), "uiux-probe-launch-"));
		try {
			const page = join(temp, "index.html");
			const fakeBrowser = join(temp, "fake-browser.sh");
			const capability = { available: true, command: fakeBrowser, version: "test" };
			const missing = await probe(page, join(temp, "missing-evidence"), { capability });
			expect(missing.manifest.blocked_reason).toBe("no entry page found");
			writeFileSync(page, "<!doctype html><title>Present</title>");
			writeFileSync(fakeBrowser, "#!/bin/sh\nif [ \"$3\" = close ]; then exit 0; fi\necho 'EPERM browser launch' >&2\nexit 1\n");
			chmodSync(fakeBrowser, 0o755);
			const result = await probe(page, join(temp, "browser-evidence"), {
				capability,
				serverStart: async () => ({ child: { exitCode: 0, kill: () => {} }, url: "http://127.0.0.1:49152/index.html" }),
			});
			expect(result.manifest.blocked_reason).toBe("browser unavailable");
			expect(result.manifest.detail).toContain("EPERM browser launch");
			expect(formatProbeConsole(result).stderr).toContain("EPERM browser launch");
		} finally { rmSync(temp, { recursive: true, force: true }); }
	});

	it("runs the C.6 source checks in --static mode with file:line evidence", () => {
		const temp = mkdtempSync(join(tmpdir(), "uiux-probe-static-"));
		try {
			const page = join(temp, "static.html");
			const output = join(temp, "result.json");
			writeFileSync(page, `<!doctype html><style>
h1 { color: #8a2be2; background-image: linear-gradient(red, blue); -webkit-background-clip: text; }
.card { border-left: 4px solid violet; }
.motion { animation: bounce 1s; transition: width 300ms; will-change: all; background-image: repeating-linear-gradient(red, blue 2px); }
@keyframes bounce { from { transform: translateX(0); } to { transform: translateX(100%); } }
</style><h1>lorem ipsum — seamless experience — — — — — — —</h1><a href="#">Empty link</a><img src="#"><marquee>News</marquee>`);
		const result = spawnSync(process.execPath, [fileURLToPath(new URL("./scripts/probe.mjs", import.meta.url)), "--static", page, "--out", output], { encoding: "utf8" });
		expect(result.status).toBe(2);
		expect(result.stdout).toContain("BLOCKED: browser unavailable");
			expect(result.stderr).toMatch(/Static source checks: \d+ rules \([^)]*\), \d+ findings/);
		const json = JSON.parse(readFileSync(output, "utf8"));
		const found = new Set(json.findings.map((finding: { rule: string }) => finding.rule));
		for (const rule of ["SLOP-009", "SLOP-008", "SLOP-015", "CF-505", "SLOP-026", "SLOP-057", "SLOP-058", "SLOP-060", "SLOP-061", "SLOP-012", "SLOP-036", "SLOP-040", "CF-507"]) expect(found).toContain(rule);
		expect(json.findings.every((finding: { viewport: string; selector: string }) => finding.viewport === "static" && finding.selector.startsWith(`${page}:`) && /:\d+$/.test(finding.selector))).toBe(true);
		expect(json.manifest.not_verified.some((item: { rule: string }) => item.rule === "CF-201")).toBe(true);
		} finally { rmSync(temp, { recursive: true, force: true }); }
	});

	it('blocks incomplete matrices unless a measured HIGH already exists', () => {
		expect(matrixExitCode([], cases.map((item) => item.id))).toBe(0);
		expect(matrixExitCode([], ['320'])).toBe(2);
		expect(matrixExitCode([{ rule: 'CF-201', severity: 'HIGH', tier: 'measured' }], ['320'])).toBe(1);
		expect(matrixExitCode([{ rule: 'CF-201', severity: 'HIGH', tier: 'not_verified' }], ['320'])).toBe(2);
	});

	it("keeps the package clear of source-file hashes from the studied repositories", () => {
		const sources = ["impeccable-skill-sha256.txt", "krehel-skills-sha256.txt"];
		const forbidden = new Map<string, string>();
		for (const name of sources) {
			const list = readFileSync(join(root, "tools/forbidden-uiux-hashes", name), "utf8");
			let count = 0;
			for (const line of list.split("\n")) {
				const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
				if (match) { forbidden.set(match[1], `${name}: ${match[2]}`); count += 1; }
			}
			expect(count).toBe(name.startsWith("impeccable") ? 54 : 57);
		}
		const manifest = JSON.parse(readFileSync(join(root, "tools/pack-payload-manifest.json"), "utf8")) as { packages: Array<{ name: string; exactFileSets: Array<{ prefix: string; allowedPaths: string[] }> }> };
		const packed = manifest.packages.find((entry) => entry.name === "@litfamily/litcodex")?.exactFileSets.find((entry) => entry.prefix === "marketplace/plugins/litcodex/skills/frontend-ui-ux/")?.allowedPaths;
		for (const relative of packed ?? []) expect(FRONTEND_UIUX_PAYLOAD_HASHES).toHaveProperty(relative);
		const matches = [];
		for (const relative of Object.keys(FRONTEND_UIUX_PAYLOAD_HASHES)) {
			const path = join(root, "plugins/litcodex/skills/frontend-ui-ux", relative);
			const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
			if (forbidden.has(hash)) matches.push(`${relative} matches ${forbidden.get(hash)}`);
		}
		expect(matches).toEqual([]);
	});

	it("credits all three consulted sources in the packaged notice", () => {
		const notice = readFileSync(join(root, "plugins/litcodex/skills/frontend-ui-ux/THIRD-PARTY-NOTICE.txt"), "utf8");
		for (const anchor of ["pbakaus/impeccable", "Paul Bakaus", "Apache", "9d715cc", "jakubkrehel/skills", "Jakub Krehel", "MIT", "267330e", "ibelick/ui-skills", "Julien Thibeaut"]) expect(notice).toContain(anchor);
	});

	it('separates clean and sloppy pages in a real browser when available', async (context) => {
		const evidence = mkdtempSync(join(tmpdir(), 'litcodex-uiux-fixtures-'));
		try {
			const clean = await probe(join(root, 'plugins/litcodex/skills/frontend-ui-ux/fixtures/clean.html'), join(evidence, 'clean'));
			if (clean.manifest.exit_code === 2) { context.skip(`browser blocked: ${clean.manifest.blocked_reason}`); return; }
			expect(clean.manifest.exit_code).toBe(0);
			expect(clean.manifest.viewports_run).toHaveLength(7);
			const sloppy = await probe(join(root, 'plugins/litcodex/skills/frontend-ui-ux/fixtures/sloppy.html'), join(evidence, 'sloppy'));
			if (sloppy.manifest.exit_code === 2) { context.skip(`browser blocked: ${sloppy.manifest.blocked_reason}`); return; }
			expect(sloppy.manifest.exit_code).toBe(1);
			for (const rule of ['RS-006', 'CF-201', 'CF-701', 'SLOP-058', 'CF-503']) expect(sloppy.findings.map((finding) => finding.rule)).toContain(rule);
			for (const rule of ['SLOP-002', 'SLOP-052']) expect(sloppy.findings.map((finding) => finding.rule)).toContain(rule);
		} finally { rmSync(evidence, { recursive: true, force: true }); }
	}, 240_000);
});
