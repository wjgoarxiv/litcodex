import { spawn } from "node:child_process";
import http from "node:http";
import { sha256 } from "./provider-cache-skill-primitives.mjs";

const MAX_BUFFER_BYTES = 8_000_000;
const PROBE_TIMEOUT_MS = 20_000;

export function localResponsesServer() {
	const pending = [];
	const waiting = [];
	let responseOrdinal = 0;
	const server = http.createServer((request, response) => {
		let raw = "";
		request.on("data", (chunk) => {
			raw += chunk;
			if (Buffer.byteLength(raw) > MAX_BUFFER_BYTES) request.destroy(new Error("LOCAL_PROBE_OUTPUT_TOO_LARGE"));
		});
		request.on("end", () => {
			if (request.method === "POST" && request.url?.endsWith("/responses")) {
				let parsed;
				try {
					parsed = JSON.parse(raw);
				} catch {
					response.writeHead(400, { "content-type": "application/json" });
					response.end('{"error":"LOCAL_PROBE_REQUEST_INVALID"}');
					return;
				}
				const waiter = waiting.shift();
				if (waiter) waiter(parsed);
				else pending.push(parsed);
			}
			if (request.method === "GET") {
				response.writeHead(404, { "content-type": "application/json" });
				response.end("{}");
				return;
			}
			responseOrdinal += 1;
			const id = `litcodex-local-${responseOrdinal}`;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				`data: {"type":"response.created","response":{"id":"${id}"}}\n\n` +
					`data: {"type":"response.completed","response":{"id":"${id}","output":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}\n\ndata: [DONE]\n\n`,
			);
		});
	});
	return {
		server,
		next: () =>
			pending.length > 0 ? Promise.resolve(pending.shift()) : new Promise((resolve) => waiting.push(resolve)),
	};
}

export function jsonRpcClient(codex, args, options) {
	const child = spawn(codex, args, {
		...options,
		detached: process.platform !== "win32",
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let ordinal = 0;
	const replies = new Map();
	const notifications = [];
	const waiters = [];
	const failPending = (error) => {
		for (const reply of replies.values()) reply.reject(error);
		replies.clear();
		for (const waiter of waiters.splice(0)) waiter.reject(error);
	};
	const acceptNotification = (message) => {
		const index = waiters.findIndex((waiter) => waiter.method === message.method);
		if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
		else notifications.push(message);
	};
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		if (Buffer.byteLength(stdout) > MAX_BUFFER_BYTES) child.kill("SIGTERM");
		for (let newline = stdout.indexOf("\n"); newline >= 0; newline = stdout.indexOf("\n")) {
			const line = stdout.slice(0, newline);
			stdout = stdout.slice(newline + 1);
			if (line.trim() === "") continue;
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				failPending(new Error("APP_SERVER_JSON_INVALID"));
				child.kill("SIGTERM");
				return;
			}
			if (message.id !== undefined && replies.has(message.id)) {
				const reply = replies.get(message.id);
				replies.delete(message.id);
				if (message.error) reply.reject(new Error(`APP_SERVER_RPC_ERROR:${JSON.stringify(message.error)}`));
				else reply.resolve(message.result);
			} else if (message.method) acceptNotification(message);
		}
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
		if (Buffer.byteLength(stderr) > MAX_BUFFER_BYTES) child.kill("SIGTERM");
	});
	child.once("error", (error) => failPending(new Error(`APP_SERVER_SPAWN_FAILED:${error.message}`)));
	child.once("close", () => failPending(new Error("APP_SERVER_EXITED")));
	const deadline = async (promise) => {
		let timer;
		try {
			return await Promise.race([
				promise,
				new Promise((_, reject) => {
					timer = setTimeout(() => reject(new Error("APP_SERVER_PROBE_TIMEOUT")), PROBE_TIMEOUT_MS);
					timer.unref();
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};
	return {
		request(method, params) {
			ordinal += 1;
			const response = new Promise((resolve, reject) => replies.set(ordinal, { resolve, reject }));
			child.stdin.write(`${JSON.stringify({ id: ordinal, method, params })}\n`);
			return deadline(response);
		},
		notify(method, params) {
			child.stdin.write(`${JSON.stringify({ method, params })}\n`);
		},
		wait(method) {
			const index = notifications.findIndex((message) => message.method === method);
			if (index >= 0) return Promise.resolve(notifications.splice(index, 1)[0]);
			return deadline(new Promise((resolve, reject) => waiters.push({ method, resolve, reject })));
		},
		async stop() {
			try {
				if (process.platform === "win32") child.kill("SIGTERM");
				else process.kill(-child.pid, "SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
			if (child.exitCode === null && child.signalCode === null) {
				await new Promise((resolve) => {
					const timer = setTimeout(resolve, 1_000);
					timer.unref();
					child.once("close", () => {
						clearTimeout(timer);
						resolve();
					});
				});
			}
			return { stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) };
		},
	};
}
