import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SKILL_DIR = fileURLToPath(new URL("./lsp-setup/", import.meta.url));
const SCRIPT = join(SKILL_DIR, "scripts", "verify-lsp.ts");

const workspaces: string[] = [];

function workspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "litcodex-lsp-setup-"));
	workspaces.push(dir);
	return dir;
}

function run(cwd: string, args: readonly string[]): { status: number; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
		cwd,
		encoding: "utf8",
	});
	return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

// A stdio language server that speaks just enough of the protocol to answer one
// roundtrip: reply to initialize, then publish diagnostics for the opened document.
function writeFakeServer(dir: string, diagnosticCount: number): string {
	const path = join(dir, "fake-server.mjs");
	writeFileSync(
		path,
		`let buf = Buffer.alloc(0)
const send = (msg) => {
	const body = Buffer.from(JSON.stringify(msg), "utf-8")
	process.stdout.write(Buffer.concat([Buffer.from(\`Content-Length: \${body.length}\\r\\n\\r\\n\`, "ascii"), body]))
}
process.stdin.on("data", (chunk) => {
	buf = Buffer.concat([buf, chunk])
	while (true) {
		const end = buf.indexOf("\\r\\n\\r\\n")
		if (end === -1) return
		const m = /content-length:\\s*(\\d+)/i.exec(buf.subarray(0, end).toString("ascii"))
		if (!m) { buf = buf.subarray(end + 4); continue }
		const len = Number.parseInt(m[1], 10)
		if (buf.length < end + 4 + len) return
		const msg = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString("utf-8"))
		buf = buf.subarray(end + 4 + len)
		if (msg.id === 1) send({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } })
		if (msg.method === "textDocument/didOpen") {
			send({
				jsonrpc: "2.0",
				method: "textDocument/publishDiagnostics",
				params: {
					uri: msg.params.textDocument.uri,
					diagnostics: Array.from({ length: ${diagnosticCount} }, (_, i) => ({ message: "d" + i })),
				},
			})
		}
	}
})
`,
		"utf8",
	);
	return path;
}

function writeConfig(dir: string, serverId: string, command: readonly string[]): string {
	const path = join(dir, "lsp-config.json");
	writeFileSync(path, JSON.stringify({ lsp: { [serverId]: { command } } }), "utf8");
	return path;
}

afterEach(() => {
	for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("verify-lsp diagnostics roundtrip #given/#when/#then", () => {
	it("exits 2 without a target file", () => {
		const cwd = workspace();
		const result = run(cwd, []);
		expect(result.status).toBe(2);
	});

	it("scopes SKIP to the unknown extension instead of a blanket degraded-mode message", () => {
		const cwd = workspace();
		writeFileSync(join(cwd, "thing.qqq"), "x\n", "utf8");
		const result = run(cwd, ["thing.qqq"]);
		expect(result.status).toBe(3);
		expect(result.stderr).toContain('".qqq"');
		expect(result.stderr).toMatch(/no language server known/i);
	});

	it("completes a real roundtrip and reports the diagnostic count", () => {
		const cwd = workspace();
		writeFileSync(join(cwd, "bad.ts"), 'const a: number = "x"\n', "utf8");
		const server = writeFakeServer(cwd, 3);
		const config = writeConfig(cwd, "typescript", [process.execPath, server]);
		const result = run(cwd, ["bad.ts", `--config=${config}`]);
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/^OK /m);
		expect(result.stdout).toContain("3 diagnostic(s)");
	});

	it("fails with exit 1 when the configured server binary is not installed", () => {
		const cwd = workspace();
		writeFileSync(join(cwd, "bad.ts"), "const a = 1\n", "utf8");
		const config = writeConfig(cwd, "typescript", [join(cwd, "definitely-not-installed")]);
		const result = run(cwd, ["bad.ts", `--config=${config}`]);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/not installed/i);
	});

	it("honours --timeout and fails rather than hanging when diagnostics never arrive", () => {
		const cwd = workspace();
		writeFileSync(join(cwd, "bad.ts"), "const a = 1\n", "utf8");
		const silent = join(cwd, "silent-server.mjs");
		writeFileSync(silent, "process.stdin.resume()\n", "utf8");
		const config = writeConfig(cwd, "typescript", [process.execPath, silent]);
		const result = run(cwd, ["bad.ts", `--config=${config}`, "--timeout=250"]);
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(/timed out after 250ms/);
	});
});
