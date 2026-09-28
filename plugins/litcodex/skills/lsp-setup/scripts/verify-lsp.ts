#!/usr/bin/env bun
// verify-lsp.ts <file> [--timeout=ms] [--config=<path>] — perform a real LSP
// diagnostics roundtrip for <file>: resolve the server for the file extension
// (from a project LSP config when present, else the embedded table), spawn it,
// run the JSON-RPC initialize -> initialized -> didOpen handshake over stdio,
// wait for textDocument/publishDiagnostics, and report OK / FAIL / SKIP.
//
// Dependency-free: only node builtins, so no bundled diagnostics engine is
// required and this runs under both `bun` and `node --experimental-strip-types`.
//
// Exit codes: 0 OK, 1 FAIL (server error / not installed / timeout), 2 usage,
// 3 SKIP (no server known for this extension).

import { spawn } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

import { LANGUAGES, PROJECT_CONFIG_FILES } from "./lsp-server-table.ts"

const DEFAULT_TIMEOUT_MS = 60_000

interface ResolvedServer {
	readonly language: string
	readonly command: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
}

// A project config overrides only the command, and is keyed by serverId under
// `lsp` — the same shape detect-lsp.ts inventories.
function configuredCommand(configPath: string, serverId: string): readonly string[] | null {
	if (!existsSync(configPath)) return null
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(configPath, "utf-8"))
	} catch {
		return null
	}
	if (!isRecord(parsed)) return null
	const lsp = parsed["lsp"]
	if (!isRecord(lsp)) return null
	const entry = lsp[serverId]
	if (!isRecord(entry)) return null
	const command = entry["command"]
	return isStringArray(command) ? command : null
}

function resolveServer(ext: string, explicitConfig: string | null): ResolvedServer | null {
	const server = LANGUAGES.find((entry) => entry.extensions.includes(ext))
	if (server === undefined) return null

	const candidates =
		explicitConfig !== null ? [explicitConfig] : PROJECT_CONFIG_FILES.map((rel) => join(process.cwd(), rel))
	for (const candidate of candidates) {
		const override = configuredCommand(candidate, server.serverId)
		if (override !== null) return { language: server.language, command: override }
	}
	return { language: server.language, command: [...server.command] }
}

interface JsonRpcMessage {
	readonly method?: string
	readonly id?: number
	readonly params?: unknown
	readonly result?: unknown
}

function encode(message: unknown): Buffer {
	const body = Buffer.from(JSON.stringify(message), "utf-8")
	return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body])
}

// Incremental LSP framing parser: pulls complete Content-Length messages off a
// growing buffer and skips frames it cannot parse.
function makeReader(onMessage: (message: JsonRpcMessage) => void): (chunk: Buffer) => void {
	let buffer = Buffer.alloc(0)
	return (chunk: Buffer): void => {
		buffer = Buffer.concat([buffer, chunk])
		while (true) {
			const headerEnd = buffer.indexOf("\r\n\r\n")
			if (headerEnd === -1) return
			const header = buffer.subarray(0, headerEnd).toString("ascii")
			const match = /content-length:\s*(\d+)/i.exec(header)
			if (!match) {
				buffer = buffer.subarray(headerEnd + 4)
				continue
			}
			const length = Number.parseInt(match[1] ?? "0", 10)
			const start = headerEnd + 4
			if (buffer.length < start + length) return
			const body = buffer.subarray(start, start + length).toString("utf-8")
			buffer = buffer.subarray(start + length)
			try {
				onMessage(JSON.parse(body) as JsonRpcMessage)
			} catch {
				// ignore malformed frame
			}
		}
	}
}

function languageId(ext: string): string {
	return LANGUAGES.find((entry) => entry.extensions.includes(ext))?.language ?? ext.replace(/^\./, "")
}

async function run(filePath: string, timeoutMs: number, explicitConfig: string | null): Promise<number> {
	const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
	const ext = extname(absolute).toLowerCase()
	const server = resolveServer(ext, explicitConfig)

	if (server === null) {
		process.stderr.write(`SKIP ${absolute}: no language server known for "${ext}". See references/.\n`)
		return 3
	}

	const [bin, ...binArgs] = server.command
	if (bin === undefined) {
		process.stderr.write(`SKIP ${absolute}: empty command for ${server.language}.\n`)
		return 3
	}

	const text = readFileSync(absolute, "utf-8")
	const uri = pathToFileURL(absolute).href

	return await new Promise<number>((resolveResult) => {
		let child: ReturnType<typeof spawn>
		try {
			child = spawn(bin, binArgs, { stdio: ["pipe", "pipe", "pipe"] })
		} catch {
			process.stdout.write(`FAIL ${absolute}: language server not installed (${bin})\n`)
			resolveResult(1)
			return
		}

		let settled = false
		let stderr = ""
		const finish = (code: number, line: string): void => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			try {
				child.kill("SIGKILL")
			} catch {
				/* already gone */
			}
			process.stdout.write(`${line}\n`)
			resolveResult(code)
		}

		const timer = setTimeout(() => {
			finish(1, `FAIL ${absolute}: timed out after ${timeoutMs}ms waiting for diagnostics`)
		}, timeoutMs)

		child.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") finish(1, `FAIL ${absolute}: language server not installed (${bin})`)
			else finish(1, `FAIL ${absolute}: ${error.message}`)
		})
		child.on("exit", (code) => {
			finish(1, `FAIL ${absolute}: server exited (code ${code ?? "?"})\n${stderr.trim()}`)
		})
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf-8")
		})

		const send = (message: unknown): void => {
			child.stdin?.write(encode(message))
		}

		const read = makeReader((message) => {
			if (message.id === 1 && message.result !== undefined) {
				send({ jsonrpc: "2.0", method: "initialized", params: {} })
				send({
					jsonrpc: "2.0",
					method: "textDocument/didOpen",
					params: { textDocument: { uri, languageId: languageId(ext), version: 1, text } },
				})
			}
			if (message.method === "textDocument/publishDiagnostics" && isRecord(message.params)) {
				if (message.params["uri"] !== uri) return
				const diagnostics = message.params["diagnostics"]
				const count = Array.isArray(diagnostics) ? diagnostics.length : 0
				finish(0, `OK ${absolute}: LSP roundtrip succeeded (${count} diagnostic(s)) via ${server.language}`)
			}
		})
		child.stdout?.on("data", read)

		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				processId: process.pid,
				rootUri: pathToFileURL(process.cwd()).href,
				capabilities: { textDocument: { publishDiagnostics: {} } },
			},
		})
	})
}

function parseTimeout(args: readonly string[]): number {
	const flag = args.find((arg) => arg.startsWith("--timeout="))
	if (flag === undefined) return DEFAULT_TIMEOUT_MS
	const parsed = Number.parseInt(flag.slice("--timeout=".length), 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)
	const configFlag = args.find((arg) => arg.startsWith("--config="))
	const filePath = args.find((arg) => !arg.startsWith("--"))

	if (filePath === undefined) {
		process.stderr.write("Usage: verify-lsp.ts <file> [--timeout=ms] [--config=<path>]\n")
		process.exit(2)
	}
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		process.stderr.write(`verify-lsp: not a file: ${filePath}\n`)
		process.exit(2)
	}

	process.exit(await run(filePath, parseTimeout(args), configFlag ? configFlag.slice("--config=".length) : null))
}

await main()
