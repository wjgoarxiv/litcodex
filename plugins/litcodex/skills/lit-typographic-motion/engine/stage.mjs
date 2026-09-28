// Stage path, the browser side: the pre-flight scan of the model-authored stage folder, serving it
// on a synthetic origin with no listening socket, the product's font and kit routes, the capture
// session with the virtual-clock init script, and a worker pool that decodes and analyses frames
// while the next one is stepped. The orchestration (master, stills, determinism) is stage-render.mjs.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { extname, join, relative, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { EXIT, Exit, INSTALL_COMMAND, STAGE_ORIGIN } from "./constants.mjs";
import { launchStage } from "./driver.mjs";
import { FONTS, fontPath, SKILL_ROOT } from "./fonts.mjs";

export const CONTENT_TYPES = Object.freeze({
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".wav": "audio/wav",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".json": "application/json",
});
const TEXT_TYPES = new Set([".html", ".js", ".mjs", ".css", ".svg", ".json"]);
const RASTER_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
export const RASTER_LIMITS = Object.freeze({ count: 24, bytes: 8 * 1024 * 1024, flipbook: 10 });
const NAMESPACES = /^https?:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink|1999\/xhtml|XML\/1998\/namespace|2000\/xmlns\/?)$/u;
const ABSOLUTE_URL = /\bhttps?:\/\/[^\s"'()<>`]+/giu;
const PROTOCOL_RELATIVE = /(?:["'(=]\s*)(\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s"')]*)/giu;
const PREFETCH = /\brel\s*=\s*["']?\s*(?:preconnect|prefetch|dns-prefetch|prerender)\b/iu;
const FORBIDDEN_ELEMENT = /<\s*(video|audio|iframe|object|embed|frame)\b/iu;
const FORBIDDEN_API = /\bnew\s+Audio\s*\(|\b(?:webkit)?AudioContext\b|\bOfflineAudioContext\b|\bnew\s+(?:Shared)?Worker\s*\(|\bSharedWorker\b|\bserviceWorker\b/u;
const NETWORK_API = /\bWebSocket\b|\bWebTransport\b|\bRTCPeerConnection\b|\bEventSource\b/u;

const inside = (root, path) => path === root || path.startsWith(root + sep);

/** Pixel size of a PNG, JPEG, WebP or GIF, and whether it is animated; null when unreadable. */
export function rasterInfo(bytes, ext) {
	if (ext === ".png" && bytes.length > 24) {
		let animated = false;
		for (let o = 8; o + 8 <= bytes.length; ) {
			const length = bytes.readUInt32BE(o);
			const type = bytes.toString("ascii", o + 4, o + 8);
			if (type === "acTL") animated = true;
			if (type === "IDAT") break;
			o += 12 + length;
		}
		return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), animated };
	}
	if (ext === ".gif" && bytes.length > 10) {
		let frames = 0;
		for (let i = 13; i < bytes.length - 1; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9) frames++;
		return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), animated: frames > 1 || bytes.includes(Buffer.from("NETSCAPE2.0")) };
	}
	if (ext === ".webp" && bytes.length > 30) {
		const kind = bytes.toString("ascii", 12, 16);
		const animated = bytes.includes(Buffer.from("ANIM")) || (kind === "VP8X" && (bytes[20] & 0x02) !== 0);
		if (kind === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3), animated };
		if (kind === "VP8L") {
			const b = bytes.readUInt32LE(21);
			return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, animated };
		}
		return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, animated };
	}
	if ((ext === ".jpg" || ext === ".jpeg") && bytes.length > 4) {
		for (let o = 2; o + 9 < bytes.length; ) {
			if (bytes[o] !== 0xff) return null;
			const marker = bytes[o + 1];
			const length = bytes.readUInt16BE(o + 2);
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(o + 7), height: bytes.readUInt16BE(o + 5), animated: false };
			o += 2 + length;
		}
	}
	return null;
}

/**
 * Pre-flight scan of the stage folder before any browser starts. Returns the file list and the
 * raster URLs to decode; throws Exit 17 (contract) or 19 (network) naming the file and the reason.
 */
export function scanStage(stageDir) {
	if (!existsSync(join(stageDir, "index.html"))) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: no stage/index.html in ${stageDir}; author the page first (references/stage.md)`);
	const root = realpathSync(stageDir);
	const files = [];
	const pending = [root];
	while (pending.length) {
		const dir = pending.pop();
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			const rel = relative(root, path);
			const link = lstatSync(path);
			const real = realpathSync(path);
			if (!inside(root, real)) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${rel} is a link that leaves the stage folder`);
			if (name === "node_modules") throw new Exit(EXIT.STAGE_CONTRACT_ERROR, "STAGE_CONTRACT_ERROR: stage/node_modules found; the page uses the kit and its own code, never installed or copied libraries");
			if (statSync(real).isDirectory()) {
				if (!link.isSymbolicLink()) pending.push(path);
				continue;
			}
			const ext = extname(name).toLowerCase();
			if (!CONTENT_TYPES[ext]) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${rel} is not an allowed stage asset (${Object.keys(CONTENT_TYPES).join(" ")})`);
			files.push({ rel, path: real, ext, bytes: statSync(real).size });
		}
	}
	const rasters = [];
	for (const file of files) {
		if (TEXT_TYPES.has(file.ext)) {
			const text = readFileSync(file.path, "utf8");
			for (const match of text.matchAll(ABSOLUTE_URL)) {
				const url = match[0].replace(/[.,;:]+$/u, "");
				if (!NAMESPACES.test(url)) throw new Exit(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: ${file.rel} names an external URL (${url}); every asset must be a local file in stage/`);
			}
			const relativeUrl = PROTOCOL_RELATIVE.exec(text);
			PROTOCOL_RELATIVE.lastIndex = 0;
			if (relativeUrl) throw new Exit(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: ${file.rel} names a protocol-relative URL (${relativeUrl[1]})`);
			if (PREFETCH.test(text)) throw new Exit(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: ${file.rel} has a preconnect or prefetch link`);
			const element = FORBIDDEN_ELEMENT.exec(text);
			if (element && (file.ext === ".html" || file.ext === ".svg")) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${file.rel} uses <${element[1].toLowerCase()}>; draw the film on the page instead`);
			const socket = NETWORK_API.exec(text);
			if (socket && file.ext !== ".css" && file.ext !== ".json") throw new Exit(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: ${file.rel} uses ${socket[0]}; a stage page never opens a connection`);
			const api = FORBIDDEN_API.exec(text);
			if (api && file.ext !== ".css" && file.ext !== ".json") throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${file.rel} uses ${api[0].trim()}, which a stage page may not use (sound comes from the treatment's sound plan)`);
		}
		if (RASTER_TYPES.has(file.ext)) {
			const info = rasterInfo(readFileSync(file.path), file.ext);
			if (info?.animated) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${file.rel} is an animated raster; rasters are textures and stills, never a frame sequence`);
			rasters.push({ ...file, size: info ? `${info.width}x${info.height}` : "unknown" });
		}
	}
	if (rasters.length > RASTER_LIMITS.count) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${rasters.length} raster images; at most ${RASTER_LIMITS.count}`);
	const rasterBytes = rasters.reduce((sum, r) => sum + r.bytes, 0);
	if (rasterBytes > RASTER_LIMITS.bytes) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: raster images total ${rasterBytes} bytes; at most 8 MB`);
	const bySize = new Map();
	for (const r of rasters) bySize.set(r.size, (bySize.get(r.size) ?? 0) + 1);
	for (const [size, count] of bySize) if (size !== "unknown" && count >= RASTER_LIMITS.flipbook) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${count} rasters of ${size} look like a flipbook; animate with the page, not a frame sequence`);
	return { root, files, rasters: rasters.map((r) => `/${r.rel.split(sep).join("/")}`) };
}

const FONT_FORMAT = { ".ttf": "truetype", ".otf": "opentype", ".woff": "woff", ".woff2": "woff2" };

/**
 * The product's verified faces as @font-face rules (font-display: block) plus a route table. Every
 * face is sha256-checked by the caller first; an unwarmed cache exits 14 before this runs.
 */
export function fontRoutes(cacheDir) {
	const routes = new Map();
	const rules = [];
	for (const entry of FONTS) {
		const ext = extname(entry.path).toLowerCase();
		const url = `/lit/fonts/${entry.key}${ext}`;
		routes.set(url, { file: fontPath(entry, cacheDir), type: CONTENT_TYPES[ext] });
		const stretch = entry.width ? `\n\tfont-stretch: ${entry.width}%;` : "";
		rules.push(`@font-face {\n\tfont-family: "${entry.family}";\n\tsrc: url("${url}") format("${FONT_FORMAT[ext]}");\n\tfont-weight: ${entry.weight};${stretch}\n\tfont-style: normal;\n\tfont-display: block;\n}`);
	}
	return { css: `${rules.join("\n")}\n`, routes, families: [...new Set(FONTS.map((f) => f.family))] };
}

/** The product's faces a stage render needs: missing files exit 14, a mismatched pin exits 15. */
export function stageFontFaults(faults) {
	const missing = faults.filter((f) => f.fault === "missing" || f.fault === "licence file missing");
	if (missing.length) throw new Exit(EXIT.BLOCKED_DEPS_NOT_PREWARMED, `BLOCKED_DEPS_NOT_PREWARMED: ${missing.map((f) => `${f.key} ${f.fault}`).join("; ")}. Run \`${INSTALL_COMMAND}\` outside the sandboxed session, then rerun.`);
	if (faults.length) throw new Exit(EXIT.BLOCKED_FONT_FETCH, `BLOCKED_FONT_FETCH: ${faults.map((f) => `${f.key} ${f.fault}`).join("; ")}. Run \`${INSTALL_COMMAND}\` outside the sandboxed session; a mismatched font is never re-fetched mid-render.`);
}

/**
 * Route every request. Only the synthetic origin is served: the kit, fonts.css, the faces, and
 * files whose realpath lies inside the stage folder. Anything else is refused and recorded.
 */
export function stageRouter({ root, fonts, record }) {
	const kit = readFileSync(join(SKILL_ROOT, "engine", "stage-kit.js"));
	return async (route) => {
		const url = route.request().url();
		if (!url.startsWith(`${STAGE_ORIGIN}/`)) {
			record.blocked.push(url);
			return route.abort("blockedbyclient");
		}
		const raw = new URL(url).pathname;
		let path;
		try {
			path = decodeURIComponent(raw);
		} catch {
			record.rejected.push(raw);
			return route.fulfill({ status: 400, body: "" });
		}
		if (path === "/lit/stage-kit.js") return route.fulfill({ status: 200, contentType: CONTENT_TYPES[".js"], body: kit });
		if (path === "/lit/fonts.css") return route.fulfill({ status: 200, contentType: CONTENT_TYPES[".css"], body: fonts.css });
		const font = fonts.routes.get(path);
		if (font) return route.fulfill({ status: 200, contentType: font.type, body: readFileSync(font.file) });
		const rel = path === "/" ? "index.html" : path.replace(/^\/+/u, "");
		if (rel.split("/").some((part) => part === "..")) {
			record.rejected.push(path);
			return route.fulfill({ status: 403, body: "" });
		}
		const target = join(root, ...rel.split("/"));
		if (!existsSync(target)) {
			if (rel !== "favicon.ico") record.missing.push(path);
			return route.fulfill({ status: 404, body: "" });
		}
		const real = realpathSync(target);
		if (!inside(root, real) || !statSync(real).isFile()) {
			record.rejected.push(path);
			return route.fulfill({ status: 403, body: "" });
		}
		const type = CONTENT_TYPES[extname(real).toLowerCase()];
		if (!type) {
			record.rejected.push(path);
			return route.fulfill({ status: 403, body: "" });
		}
		return route.fulfill({ status: 200, contentType: type, body: readFileSync(real) });
	};
}

const INIT = () => readFileSync(join(SKILL_ROOT, "engine", "stage-init.js"), "utf8");

/**
 * Open one stage session: launch, route, inject the clock, load the page, load every face and
 * decode every raster. Returns the session and the page's declared contract.
 */
export async function openStage({ runtime, outDir, scan, fonts, width, height, fps, seed, extraInit = null }) {
	const session = await launchStage({ runtime, outDir, width, height });
	const record = { blocked: [], rejected: [], missing: [], pageErrors: [], console: [] };
	session.record = record;
	try {
		await session.context.route("**/*", stageRouter({ root: scan.root, fonts, record }));
		await session.context.addInitScript({ content: INIT().replaceAll("__LIT_STAGE_CONFIG__", JSON.stringify({ fps, seed })) });
		if (extraInit) await session.context.addInitScript({ content: extraInit });
		session.page.on("pageerror", (error) => record.pageErrors.push(error.message));
		session.page.on("console", (message) => {
			if (message.type() === "error") record.console.push(message.text());
		});
		await session.page.goto(`${STAGE_ORIGIN}/index.html`, { waitUntil: "load", timeout: 60000 });
		session.cdp = await session.context.newCDPSession(session.page);
		session.contract = await session.page.evaluate(async (images) => {
			await Promise.all([...document.fonts].map((face) => face.load().catch(() => {})));
			return window.__litClock.prepare({ images });
		}, scan.rasters);
		return session;
	} catch (error) {
		await closeStage(session);
		throw error;
	}
}

export async function closeStage(session) {
	await session?.context?.close().catch(() => {});
}

/** Raise the named exit for anything the page did that the contract forbids. */
export async function assertClean(session) {
	const { record } = session;
	if (record.blocked.length) throw new Exit(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: the page requested ${record.blocked[0]}${record.blocked.length > 1 ? ` and ${record.blocked.length - 1} more` : ""}; every asset must be a local file in stage/`);
	if (record.rejected.length) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the page requested ${record.rejected[0]}, which is outside the stage folder or not an allowed asset`);
	const report = await session.page.evaluate(() => window.__litClock.report());
	const network = report.violations.filter((v) => v.kind === "network");
	if (network.length) throw new Exit(EXIT.STAGE_NETWORK_REQUEST, `STAGE_NETWORK_REQUEST: the page used ${network.map((v) => v.name).join(", ")}; a stage page never opens a connection`);
	if (report.violations.length) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: the page used ${report.violations.map((v) => v.name).join(", ")}, which a stage page may not use`);
	if (report.webgl && !report.webgl.ok) throw new Exit(EXIT.BLOCKED_NO_WEBGL2, "BLOCKED_NO_WEBGL2: the page requested a WebGL context and the software rung returned none");
	return report;
}

/** Step the clock to output frame f (settle waits two native frames before a capture). */
export async function stepFrame(session, f, settle = true) {
	return session.page.evaluate(({ frame, wait }) => window.__litClock.frame(frame, { settle: wait }), { frame: f, wait: settle });
}

/** Capture the viewport exactly as composited: PNG, from the surface, clipped at scale 1. */
export async function capture(session, width, height) {
	const shot = await session.cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
	return Buffer.from(shot.data, "base64");
}

/** Worker threads that decode and analyse captured PNGs; results come back in submission order. */
export class DecodePool {
	constructor(size = Math.max(2, Math.min(6, availableParallelism() - 2))) {
		this.workers = Array.from({ length: size }, () => new Worker(new URL("./stage-worker.mjs", import.meta.url)));
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

	decode(png, { analyze = false, preview = null } = {}) {
		const id = this.id++;
		const worker = this.workers[this.next++ % this.workers.length];
		return new Promise((resolve, reject) => {
			this.waiting.set(id, { resolve, reject });
			worker.postMessage({ id, png, analyze, preview });
		});
	}

	async close() {
		await Promise.all(this.workers.map((worker) => worker.terminate()));
	}
}
