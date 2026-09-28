// Headless Chrome driver. Launches over the pipe transport (no control port), tries the MO-A-51
// ladder and keeps the first rung whose page really gets WebGL2 plus a half-float target. Frames
// leave the page over a WebSocket on 127.0.0.1:0 (MO-A-02 option 1); if listen is refused, the
// same readback buffer is pulled per frame over CDP instead (the sanctioned fallback). Every
// failure is reported as its real cause (MO-A-45). Method adapted from the credited render.ts.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { EXIT } from "./constants.mjs";
import { SKILL_ROOT } from "./fonts.mjs";
import { chromeLadder, findChrome, firstLine, stageFlags } from "./runtime.mjs";

export class Blocked extends Error {
	constructor(exit, name, message) {
		super(message);
		this.exit = exit;
		this.blockedName = name;
	}
}

const APP = () => readFileSync(join(SKILL_ROOT, "engine", "browser-app.js"), "utf8");

export async function launch({ runtime, outDir, scale, env = process.env, log = () => {}, rung: only = null }) {
	const chrome = findChrome(env);
	if (!chrome) throw new Blocked(EXIT.BLOCKED_NO_CHROME, "BLOCKED_NO_CHROME", "Chrome/Chromium not found: install Google Chrome or set CHROME_PATH");
	const { chromium } = await import(pathToFileURL(runtime.playwright).href);
	const runDir = join(outDir, ".run");
	mkdirSync(runDir, { recursive: true });
	const profileRoot = mkdtempSync(join(runDir, "p"));
	const fault = env.LITCODEX_MOTION_FAULT ?? "";
	let launchError = null;
	let launched = false;
	let glMessage = null;
	for (const [index, rung] of chromeLadder().entries()) {
		if (only !== null && index !== only) continue;
		const args = fault === "no-webgl2" ? [...rung, "--disable-webgl", "--disable-3d-apis"] : rung;
		let context;
		try {
			context = await chromium.launchPersistentContext(join(profileRoot, String(index)), {
				executablePath: chrome,
				headless: true,
				args,
				viewport: { width: 1920, height: 1080 },
				deviceScaleFactor: 1,
				timeout: 45000,
			});
		} catch (error) {
			launchError ??= firstLine(error.message.replace(/^browserType\.launchPersistentContext:\s*/u, ""));
			log(`chrome rung ${index} failed to launch: ${launchError}`);
			continue;
		}
		launched = true;
		const page = context.pages()[0] ?? (await context.newPage());
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000"><script>${APP()}</script></body></html>`);
		const probe = await page.evaluate(() => window.__litMotion.probe());
		if (probe.webgl2 && probe.halfFloat) {
			const info = await page.evaluate((config) => window.__litMotion.init(config), { scale });
			return { context, page, chrome, flags: rung, renderer: info.renderer, profileRoot, errors };
		}
		glMessage = probe.webgl2 ? `WebGL2 without a half-float render target (renderer: ${probe.renderer})` : `getContext('webgl2') returned null on rung ${rung[0]}`;
		log(`chrome rung ${index}: ${glMessage}`);
		await context.close();
	}
	rmSync(profileRoot, { recursive: true, force: true });
	if (!launched) throw new Blocked(EXIT.BLOCKED_NO_CHROME, "BLOCKED_NO_CHROME", `Chrome failed to launch headless: ${launchError}`);
	throw new Blocked(EXIT.BLOCKED_NO_WEBGL2, "BLOCKED_NO_WEBGL2", `no WebGL2 context on any rung (Chrome ran): ${glMessage}`);
}

/**
 * Launch the stage path's Chrome: one software rung with the stage flags, a profile under the run's
 * .run/ folder, service workers blocked, and a viewport exactly the film's frame. The caller
 * installs routes before the first navigation.
 */
export async function launchStage({ runtime, outDir, width, height, env = process.env }) {
	const chrome = findChrome(env);
	if (!chrome) throw new Blocked(EXIT.BLOCKED_NO_CHROME, "BLOCKED_NO_CHROME", "Chrome/Chromium not found: install Google Chrome or set CHROME_PATH");
	const { chromium } = await import(pathToFileURL(runtime.playwright).href);
	const runDir = join(outDir, ".run");
	mkdirSync(runDir, { recursive: true });
	const profileRoot = mkdtempSync(join(runDir, "s"));
	const flags = stageFlags(width, height);
	let context;
	try {
		context = await chromium.launchPersistentContext(join(profileRoot, "p"), {
			executablePath: chrome,
			headless: true,
			args: flags,
			viewport: { width, height },
			deviceScaleFactor: 1,
			serviceWorkers: "block",
			timeout: 45000,
		});
	} catch (error) {
		rmSync(profileRoot, { recursive: true, force: true });
		throw new Blocked(EXIT.BLOCKED_NO_CHROME, "BLOCKED_NO_CHROME", `Chrome failed to launch headless: ${firstLine(error.message.replace(/^browserType\.launchPersistentContext:\s*/u, ""))}`);
	}
	const page = context.pages()[0] ?? (await context.newPage());
	return { context, page, chrome, flags, profileRoot };
}

/** Open the frame socket; on a refused listen, return the CDP-pull fallback with the real error. */
export async function openEgress({ runtime, page, env = process.env }) {
	let listenError = null;
	try {
		if (env.LITCODEX_MOTION_FAULT === "listen-eperm") throw Object.assign(new Error("listen EPERM: operation not permitted 127.0.0.1"), { code: "EPERM" });
		const { WebSocketServer } = await import(pathToFileURL(runtime.ws).href);
		const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 1 << 29 });
		await new Promise((resolve, reject) => {
			server.once("listening", resolve);
			server.once("error", reject);
		});
		const queue = [];
		const waiters = [];
		let socket = null;
		server.on("connection", (ws) => {
			socket = ws;
			ws.on("message", (data, binary) => {
				if (!binary) return;
				const bytes = Buffer.isBuffer(data) ? data : Buffer.concat(data);
				const waiter = waiters.shift();
				if (waiter) waiter(bytes);
				else queue.push(bytes);
				ws.send("1");
			});
		});
		const { port } = server.address();
		await page.evaluate((url) => window.__litMotion.connect(url), `ws://127.0.0.1:${port}`);
		return {
			kind: "websocket",
			next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve))),
			close: () => {
				socket?.close();
				server.close();
			},
		};
	} catch (error) {
		listenError = `${error.code ? `${error.code} ` : ""}${firstLine(error.message)}`;
	}
	return { kind: "cdp-pull", listenError, next: null, close: () => {} };
}

/** Render one command; returns { meta, bytes } with bytes the exact RGBA frame. */
export async function renderFrame(session, egress, cmd) {
	const pull = egress.kind !== "websocket";
	let meta;
	try {
		meta = await session.page.evaluate((c) => window.__litMotion.frame(c), { ...cmd, pull });
	} catch (error) {
		const detail = firstLine(error.message);
		if (pull && egress.listenError) throw new Blocked(1, "EGRESS_FAILED", `frame egress failed: listen refused (${egress.listenError}) and the CDP pull fallback failed (${detail})`);
		throw error;
	}
	if (cmd.discard) return { meta, bytes: null };
	const bytes = meta.egress === "websocket" ? await egress.next() : Buffer.from(meta.rgba, "base64");
	delete meta.rgba;
	return { meta, bytes };
}

export async function perfFrame(session, cmd) {
	return session.page.evaluate((c) => window.__litMotion.perfFrame(c), cmd);
}

export async function close(session, egress) {
	egress?.close();
	await session?.context.close().catch(() => {});
	if (session?.profileRoot) rmSync(session.profileRoot, { recursive: true, force: true });
}
