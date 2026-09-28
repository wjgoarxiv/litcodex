import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

const MAX_BUFFER_BYTES = 8_000_000;

export class ProcessProbeError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "ProcessProbeError";
		this.code = code;
		this.details = details;
	}
}

/** Run one argv-only subprocess with a hard deadline and process-group cleanup. */
export function runBoundedProcess(executable, args, options = {}) {
	const timeoutMs = options.timeoutMs ?? 60_000;
	return new Promise((resolvePromise, reject) => {
		const child = spawn(executable, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
			shell: false,
			detached: process.platform !== "win32",
		});
		let stdout = Buffer.alloc(0);
		let stderr = Buffer.alloc(0);
		let settled = false;
		let timedOut = false;
		let aborted = false;
		let bufferError;

		const terminate = () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			try {
				if (process.platform === "win32") child.kill("SIGTERM");
				else process.kill(-child.pid, "SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
		};

		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
			setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					try {
						if (process.platform === "win32") child.kill("SIGKILL");
						else process.kill(-child.pid, "SIGKILL");
					} catch {
						child.kill("SIGKILL");
					}
				}
			}, 250).unref();
		}, timeoutMs);
		const onAbort = () => {
			aborted = true;
			terminate();
		};
		if (options.signal?.aborted) onAbort();
		else options.signal?.addEventListener("abort", onAbort, { once: true });

		const append = (current, chunk) => {
			const next = Buffer.concat([current, Buffer.from(chunk)]);
			if (next.byteLength > MAX_BUFFER_BYTES) {
				terminate();
				throw new ProcessProbeError("PROCESS_OUTPUT_TOO_LARGE", "subprocess output exceeded the bounded buffer");
			}
			return next;
		};
		child.stdout.on("data", (chunk) => {
			try {
				stdout = append(stdout, chunk);
			} catch (error) {
				bufferError = error;
				terminate();
			}
		});
		child.stderr.on("data", (chunk) => {
			try {
				stderr = append(stderr, chunk);
			} catch (error) {
				bufferError = error;
				terminate();
			}
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			reject(new ProcessProbeError("PROCESS_SPAWN_FAILED", error.message));
		});
		child.once("close", (exitCode, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			if (bufferError !== undefined) return reject(bufferError);
			if (aborted) return reject(new ProcessProbeError("PROCESS_ABORTED", "subprocess was aborted", { signal }));
			if (timedOut) {
				return reject(new ProcessProbeError("PROCESS_TIMEOUT", `subprocess exceeded ${timeoutMs} ms`, { signal }));
			}
			resolvePromise({
				exitCode: exitCode ?? -1,
				stdout: stdout.toString("utf8"),
				stderr: stderr.toString("utf8"),
			});
		});
		if (options.input !== undefined) child.stdin.end(options.input);
	});
}

export async function runCommand(executable, args, options = {}) {
	const result = await runBoundedProcess(executable, args, options);
	if (result.exitCode !== 0) throw new Error(`PROCESS_NONZERO:${result.exitCode}:${result.stderr.slice(0, 500)}`);
	return result;
}

export function resolveExecutable(name, env) {
	if (isAbsolute(name) || name.includes("/")) {
		accessSync(name, constants.X_OK);
		return resolve(name);
	}
	for (const folder of (env.PATH ?? "").split(delimiter)) {
		const candidate = join(folder, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Keep searching the declared PATH.
		}
	}
	throw new Error("CODEX_EXECUTABLE_NOT_FOUND");
}
