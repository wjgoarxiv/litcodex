// Cover capture, the browser side. One headless Chrome per pass on the stage path's software rung (the GPU rung for a 3D hero), its
// viewport the cover page's CSS size at device scale 2, the cover folder served on the synthetic
// stage origin (kit, loop kit, faces, nothing else), and the cover init script injected before any page
// script. The renderer SEEKS: it calls window.renderFrame(t, { mask }) for any t in [0, 1) in any
// order, captures the surface, and a worker pool downsamples each capture to the cover size. The
// master, the replay (G0) and the seek-order check each open their own CoverSession.
import { readFileSync, rmSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { EXIT, Exit, STAGE_ORIGIN } from "./constants.mjs";
import { launchCover } from "./driver.mjs";
import { SKILL_ROOT } from "./fonts.mjs";
import { firstLine } from "./runtime.mjs";
import { probeGpu, stageRouter } from "./stage.mjs";

const COVER_INIT = () => readFileSync(join(SKILL_ROOT, "engine", "cover-init.js"), "utf8");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export class CoverSession {
	/** Open the cover page and wait until it sets window.ready and defines window.renderFrame. */
	static async open({ runtime, scan, fonts, width, height, scale, profileDir, rung = "software", env = process.env }) {
		const { context, page } = await launchCover({ runtime, width, height, scale, profileDir, rung, env });
		const session = new CoverSession({ context, page, width, height, scale, profileDir, rung });
		try {
			if (rung === "gpu") await probeGpu(session);
			await context.route("**/*", stageRouter({ root: scan.root, fonts, record: session.record }));
			await context.addInitScript({ content: COVER_INIT() });
			page.on("pageerror", (error) => session.record.pageErrors.push(firstLine(error.message)));
			await page.goto(`${STAGE_ORIGIN}/index.html`, { waitUntil: "load", timeout: 60000 });
			session.cdp = await context.newCDPSession(page);
			await session.#waitReady();
			return session;
		} catch (error) {
			await session.close();
			throw error;
		}
	}

	constructor({ context, page, width, height, scale, profileDir, rung = "software" }) {
		Object.assign(this, { context, page, width, height, scale, profileDir, rung });
		this.record = { blocked: [], rejected: [], missing: [], pageErrors: [] };
	}

	async #waitReady() {
		const deadline = Date.now() + 60000;
		for (;;) {
			const state = await this.page.evaluate(() => [document.readyState, window.ready === true, typeof window.renderFrame]).catch(() => ["loading", false, "undefined"]);
			if (state[0] === "complete" && state[1]) {
				await this.check("while loading");
				if (state[2] !== "function") throw new Exit(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR: the cover page set window.ready but defines no window.renderFrame(t)");
				return;
			}
			// A page that threw before it was ready never recovers; say why now, not after the 60 s wait.
			if (this.record.pageErrors.length) {
				await this.check("while loading");
				throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the cover page threw before it was ready; first page error: ${this.record.pageErrors[0]}`);
			}
			if (Date.now() > deadline) {
				await this.check("while loading");
				const why = this.record.pageErrors[0] ? `; first page error: ${this.record.pageErrors[0]}` : state[0] === "complete" ? "; it never set window.ready = true" : "";
				throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the cover page was not ready within 60 s${why}`);
			}
			await pause(50);
		}
	}

	/** Raise the named exit for anything the page did that a cover page may not do. */
	async check(context) {
		if (this.record.blocked.length) throw new Exit(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: the cover page requested ${this.record.blocked[0].slice(0, 160)}; every asset is a local file in cover/`);
		if (this.record.rejected.length) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the cover page requested ${this.record.rejected[0]}, which is outside the cover folder or not an allowed asset`);
		const calls = await this.page.evaluate(() => (window.__litCoverCalls ? window.__litCoverCalls() : [])).catch(() => []);
		if (calls.length) throw new Exit(EXIT.STAGE_NONDETERMINISTIC, `STAGE_NONDETERMINISTIC: the cover page called ${calls.join(", ")} ${context}; a cover frame is a function of t alone (LitLoop.rng(seed) for layout)`);
	}

	/** Draw loop time t (or its title mask) and let fonts settle. */
	async frame(t, { mask = false } = {}) {
		try {
			await this.page.evaluate(
				async ({ time, asMask }) => {
					await window.renderFrame(time, { mask: asMask });
					await document.fonts.ready;
				},
				{ time: t, asMask: mask },
			);
		} catch (error) {
			await this.check(`at t = ${t.toFixed(4)}`);
			throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: renderFrame(${t.toFixed(4)}${mask ? ", { mask: true }" : ""}) threw: ${firstLine(error.message)}`);
		}
		await this.check(`at t = ${t.toFixed(4)}`);
	}

	/** The surface as composited: a PNG of (width x scale) by (height x scale). */
	async capture() {
		const shot = await this.cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, clip: { x: 0, y: 0, width: this.width, height: this.height, scale: 1 } });
		return Buffer.from(shot.data, "base64");
	}

	async close() {
		await this.context?.close().catch(() => {});
		rmSync(this.profileDir, { recursive: true, force: true });
	}
}

/** Worker threads that downsample and write captures; each job resolves with its PNG's hash. */
export class CoverPool {
	constructor(size = Math.max(2, Math.min(6, availableParallelism() - 2))) {
		this.workers = Array.from({ length: size }, () => new Worker(new URL("./cover-worker.mjs", import.meta.url)));
		this.next = 0;
		this.id = 0;
		this.waiting = new Map();
		for (const worker of this.workers) {
			worker.on("message", (message) => {
				const waiter = this.waiting.get(message.id);
				this.waiting.delete(message.id);
				if (message.error) waiter.reject(new Error(message.error));
				else waiter.resolve(message);
			});
			worker.on("error", (error) => {
				for (const waiter of this.waiting.values()) waiter.reject(error);
				this.waiting.clear();
			});
		}
	}

	downsample(png, width, height, file) {
		const id = this.id++;
		const worker = this.workers[this.next++ % this.workers.length];
		const copy = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
		return new Promise((resolve, reject) => {
			this.waiting.set(id, { resolve, reject });
			worker.postMessage({ id, png: copy, width, height, file }, [copy]);
		});
	}

	async close() {
		await Promise.all(this.workers.map((worker) => worker.terminate()));
	}
}

/**
 * Capture `times` ([index, t] pairs, in the order given) into `dir` as `<prefix>NNNN.png` at the
 * cover size. Returns Map index -> SHA-256 of the written PNG.
 */
export async function capturePass({ session, pool, times, dir, prefix = "f", mask = false, size: [width, height] }) {
	const hashes = new Map();
	const pending = [];
	const expected = `${session.width * session.scale}x${session.height * session.scale}`;
	for (const [index, t] of times) {
		await session.frame(t, { mask });
		const png = await session.capture();
		const job = pool.downsample(png, width, height, join(dir, `${prefix}${String(index).padStart(4, "0")}.png`)).then((done) => {
			if (done.captured !== expected) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: captured ${done.captured}, expected ${expected} (the page must not resize its viewport)`);
			hashes.set(index, done.sha256);
		});
		job.catch(() => {});
		pending.push(job);
		while (pending.length > 8) await pending.shift();
	}
	await Promise.all(pending);
	return hashes;
}
