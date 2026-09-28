// Motion runtime: a product-owned cache under ${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime,
// filled only by `litcodex motion-runtime install` (or the installer/postinstall pre-warm) from the
// pinned lockfile, pinned font URLs and a hash-pinned audio requirements file. Renders only read it
// (MO-A-42/43). This module also carries the five doctor/status probes (MO-A-44/55).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { CHROME_COMMON_FLAGS, CHROME_GPU_FLAGS, CHROME_KEYCHAIN_FLAGS, CHROME_SOFTWARE_FLAGS, CHROME_STAGE_FLAGS, INSTALL_COMMAND, SOFTWARE_GL, UNKNOWN_RENDERER } from "./constants.mjs";
import { FETCHED, FONTS, SKILL_ROOT, verifyFonts, verifyStrokeFonts } from "./fonts.mjs";

const RUNTIME_SOURCES = join(SKILL_ROOT, "runtime");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const DEPENDENCIES = Object.freeze(["opentype.js", "playwright-core", "ws"]);
export const AUDIO_REQUIREMENTS = join(RUNTIME_SOURCES, "requirements-audio.txt");
export const WORD_TIMING_PINS = join(RUNTIME_SOURCES, "word-timing-models.json");

export function cacheRoot(env = process.env) {
	return join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache"), "litcodex", "motion-runtime");
}

/** The versioned cache directory: a new lockfile or font pin list gets a fresh directory. */
export function cacheDir(env = process.env) {
	const id = sha256(Buffer.concat([readFileSync(join(RUNTIME_SOURCES, "package-lock.json")), Buffer.from(JSON.stringify(FETCHED))])).slice(0, 16);
	return join(cacheRoot(env), id);
}

const lockDigest = () => sha256(readFileSync(join(RUNTIME_SOURCES, "package-lock.json")));

/** Pinned engine dependencies: present, at the locked versions, with a matching receipt. */
export function depsState(dir) {
	const missing = [];
	const lock = JSON.parse(readFileSync(join(RUNTIME_SOURCES, "package-lock.json"), "utf8"));
	for (const name of DEPENDENCIES) {
		const manifest = join(dir, "node_modules", name, "package.json");
		const want = lock.packages[`node_modules/${name}`]?.version;
		if (!existsSync(manifest)) missing.push(`dependency ${name}@${want} not installed`);
		else if (JSON.parse(readFileSync(manifest, "utf8")).version !== want) missing.push(`dependency ${name} is not the locked ${want}`);
	}
	const receipt = join(dir, "ready.json");
	if (!existsSync(receipt)) missing.push("pre-warm receipt missing");
	else if (JSON.parse(readFileSync(receipt, "utf8")).lockSha256 !== lockDigest()) missing.push("pre-warm receipt does not match the pinned lockfile");
	return { ready: missing.length === 0, missing };
}

export function fontsState(dir) {
	const faults = [...verifyFonts(FONTS.map((f) => f.key), dir), ...verifyStrokeFonts()];
	return { ready: faults.length === 0, faults, missing: faults.map((f) => `font ${f.key}: ${f.fault}${f.path ? ` (${f.path})` : ""}`) };
}

const requirementsDigest = () => sha256(readFileSync(AUDIO_REQUIREMENTS));
export const venvPython = (dir) => join(dir, "audio-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Tier 2 venv: absent, stale (pins changed), or ready. Never repaired in a session (MO-A-54). */
export function audioState(dir) {
	const receipt = join(dir, "audio-venv", "litcodex-audio.json");
	if (!existsSync(venvPython(dir)) || !existsSync(receipt)) return { state: "absent", ready: false, detail: `audio analysis not prewarmed: run ${INSTALL_COMMAND} --audio` };
	if (JSON.parse(readFileSync(receipt, "utf8")).requirementsSha256 !== requirementsDigest()) return { state: "stale", ready: false, detail: `audio venv no longer matches its pinned requirements: run ${INSTALL_COMMAND} --audio` };
	return { state: "ready", ready: true, detail: "librosa venv ready" };
}

/** Tier 3 pins. With no licence-verified Korean-capable model pinned, the tier fails closed. */
export function wordTimingPins() {
	return JSON.parse(readFileSync(WORD_TIMING_PINS, "utf8"));
}
export function wordTimingState(dir) {
	const pins = wordTimingPins();
	if (!pins.models.length) return { ready: false, detail: `word timing unavailable: ${pins.status}` };
	const missing = pins.models.filter((m) => !existsSync(join(dir, "word-timing", m.id.replaceAll("/", "__"), "receipt.json")));
	return missing.length ? { ready: false, detail: `word-timing models absent: run ${INSTALL_COMMAND} --word-timing` } : { ready: true, detail: "word-timing models present" };
}

/** Resolve the cache for a render; never installs. */
export function resolveRuntime(env = process.env) {
	const dir = cacheDir(env);
	const deps = depsState(dir);
	return {
		dir,
		deps,
		playwright: join(dir, "node_modules", "playwright-core", "index.mjs"),
		opentype: join(dir, "node_modules", "opentype.js", "dist", "opentype.mjs"),
		ws: join(dir, "node_modules", "ws", "wrapper.mjs"),
	};
}

async function fetchPinned(item, mirror) {
	let bytes;
	if (mirror) bytes = readFileSync(join(mirror, item.path));
	else {
		const response = await fetch(item.url, { redirect: "follow" });
		if (!response.ok) throw new Error(`fetch ${item.url}: HTTP ${response.status}`);
		bytes = Buffer.from(await response.arrayBuffer());
	}
	if (item.bytes !== undefined && bytes.length !== item.bytes) throw new Error(`${item.path}: ${bytes.length} bytes, pinned ${item.bytes}`);
	if (sha256(bytes) !== item.sha256) throw new Error(`${item.path}: sha256 mismatch against its pin`);
	return bytes;
}

function withLock(root, action) {
	mkdirSync(root, { recursive: true });
	const lock = join(root, ".install.lock");
	if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 15 * 60 * 1000) rmSync(lock, { force: true });
	let fd;
	try {
		fd = openSync(lock, "wx");
	} catch {
		throw new Error(`another motion-runtime install holds ${lock}`);
	}
	return Promise.resolve()
		.then(action)
		.finally(() => {
			closeSync(fd);
			rmSync(lock, { force: true });
		});
}

/** npm config an enclosing `npm install -g` or `--dry-run` exports; each one turns the child `npm ci` into a different command. */
const INHERITED_NPM_MODE = /^npm_config_(global|location|prefix|dry[-_]run)$/iu;
const npmChildEnv = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !INHERITED_NPM_MODE.test(key)));

function npmCommand(env) {
	if (env.npm_execpath && existsSync(env.npm_execpath)) return [process.execPath, [env.npm_execpath]];
	return [process.platform === "win32" ? "npm.cmd" : "npm", []];
}

/**
 * Pre-warm: npm ci from the pinned lockfile, pinned font fetches, optional audio venv. The only
 * place this skill touches the network. Returns { ready, dir, lines }.
 */
export async function install({ env = process.env, audio = false, wordTiming = false, log = () => {} } = {}) {
	if (wordTiming) {
		const pins = wordTimingPins();
		log(`word timing: download size ${pins.downloadBytes} B; pinned models: ${pins.models.length ? pins.models.map((m) => `${m.id}@${m.revision} (${m.licence})`).join(", ") : "none"}`);
		if (!pins.models.length) throw Object.assign(new Error(`word timing fails closed: ${pins.status}`), { code: "WORD_TIMING_UNPINNED" });
	}
	const dir = cacheDir(env);
	await withLock(cacheRoot(env), async () => {
		mkdirSync(dir, { recursive: true });
		if (!depsState(dir).missing.every((m) => m === "pre-warm receipt missing")) {
			for (const name of ["package.json", "package-lock.json"]) copyFileSync(join(RUNTIME_SOURCES, name), join(dir, name));
			const [command, prefix] = npmCommand(env);
			const args = [...prefix, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];
			if (env.LITCODEX_MOTION_NPM_CACHE) args.push("--offline", "--cache", env.LITCODEX_MOTION_NPM_CACHE);
			log(`installing pinned engine dependencies into ${dir}`);
			const result = spawnSync(command, args, { cwd: dir, encoding: "utf8", env: { ...npmChildEnv(env), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" }, timeout: 300000 });
			if (result.status !== 0) throw new Error(`npm ci failed: ${(result.error?.message || result.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
		}
		for (const item of FETCHED) {
			const target = join(dir, item.path);
			if (existsSync(target) && sha256(readFileSync(target)) === item.sha256) continue;
			log(`fetching ${item.path}`);
			const bytes = await fetchPinned(item, env.LITCODEX_MOTION_FONT_MIRROR);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(`${target}.part`, bytes);
			renameSync(`${target}.part`, target);
		}
		writeFileSync(join(dir, "ready.json"), `${JSON.stringify({ schema: 1, lockSha256: lockDigest(), fonts: FETCHED.map((f) => ({ path: f.path, sha256: f.sha256 })) }, null, 2)}\n`);
		if (audio) installAudio(dir, env, log);
	});
	const deps = depsState(dir);
	const fonts = fontsState(dir);
	return { ready: deps.ready && fonts.ready, dir, missing: [...deps.missing, ...fonts.missing] };
}

function installAudio(dir, env, log) {
	const venv = join(dir, "audio-venv");
	const python = env.LITCODEX_MOTION_PYTHON || "python3";
	log(`creating the librosa venv with ${python}`);
	rmSync(venv, { recursive: true, force: true });
	const made = spawnSync(python, ["-m", "venv", venv], { encoding: "utf8", env, timeout: 120000 });
	if (made.status !== 0) throw new Error(`python venv failed: ${(made.error?.message || made.stderr || "").trim()}`);
	const pip = spawnSync(venvPython(dir), ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--require-hashes", "--only-binary=:all:", "-r", AUDIO_REQUIREMENTS], { encoding: "utf8", env, timeout: 900000 });
	if (pip.status !== 0) throw new Error(`pip install --require-hashes failed: ${(pip.stderr || "").trim().split("\n").slice(-2).join(" ")}`);
	writeFileSync(join(venv, "litcodex-audio.json"), `${JSON.stringify({ requirementsSha256: requirementsDigest() })}\n`);
}

// ---------------------------------------------------------------------------- doctor probes

export function findChrome(env = process.env) {
	const explicit = env.CHROME_PATH || env.LITCODEX_MOTION_CHROME;
	if (explicit) return existsSync(explicit) ? explicit : null;
	const candidates =
		process.platform === "darwin"
			? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
			: process.platform === "win32"
				? [join(env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"), join(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe")]
				: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].flatMap((name) => (env.PATH || "").split(delimiter).map((d) => join(d, name)));
	return candidates.find((path) => existsSync(path)) ?? null;
}

export function chromeLadder(platform = process.platform) {
	const gpu = CHROME_GPU_FLAGS[platform] ?? CHROME_GPU_FLAGS.linux;
	return [
		[...gpu, ...CHROME_COMMON_FLAGS, ...CHROME_KEYCHAIN_FLAGS],
		[...CHROME_SOFTWARE_FLAGS, ...CHROME_COMMON_FLAGS, ...CHROME_KEYCHAIN_FLAGS],
	];
}

/**
 * The stage path's one launch rung: the ladder's software rung (SwiftShader, CPU raster), the stage
 * determinism and network flags, and the frame size. There is no GPU rung on the stage path, so a
 * determinism mismatch is always a page leak.
 */
export function stageFlags(width, height, platform = process.platform) {
	return [...chromeLadder(platform)[1], ...CHROME_STAGE_FLAGS, `--window-size=${width},${height}`];
}

export const isSoftware = (renderer) => SOFTWARE_GL.some((needle) => String(renderer).toLowerCase().includes(needle));

function which(command, env) {
	for (const dir of (env.PATH || "").split(delimiter)) {
		const path = join(dir, command);
		if (dir && existsSync(path)) return path;
	}
	return null;
}

export function ffmpegProbe(env = process.env) {
	const path = which("ffmpeg", env);
	if (!path) return { ok: false, line: "not found on PATH", previewEncoder: null };
	const version = spawnSync(path, ["-hide_banner", "-version"], { encoding: "utf8", env });
	const first = (version.stdout || "").split("\n")[0].trim();
	const encoders = spawnSync(path, ["-hide_banner", "-encoders"], { encoding: "utf8", env }).stdout || "";
	const img2webp = which("img2webp", env);
	const previewEncoder = /\blibwebp_anim\b/u.test(encoders) ? "libwebp_anim" : img2webp ? "img2webp" : "gif";
	return { ok: version.status === 0, path, line: first, previewEncoder, img2webp, ffprobe: which("ffprobe", env) };
}

/** Real headless WebGL2 probe across the MO-A-51 ladder, in a unique temporary profile. */
export function webglProbe(chrome, env = process.env) {
	if (!chrome) return { ok: false, renderer: null, flags: [], detail: "Chrome not found" };
	const base = mkdtempSync(join(tmpdir(), "litcodex-motion-probe-"));
	try {
		const page = join(base, "probe.html");
		writeFileSync(page, `<!doctype html><title>probe</title><body><script>const gl=document.createElement("canvas").getContext("webgl2");const i=gl&&gl.getExtension("WEBGL_debug_renderer_info");document.body.textContent="RESULT:"+(gl?(i?gl.getParameter(i.UNMASKED_RENDERER_WEBGL):${JSON.stringify(UNKNOWN_RENDERER)}):"NO_WEBGL2")+":END";</script>`);
		let failure = null;
		for (const flags of chromeLadder()) {
			const profile = mkdtempSync(join(base, "p"));
			const result = spawnSync(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, ...flags, "--dump-dom", `file://${page}`], { encoding: "utf8", env, timeout: 30000 });
			const found = /RESULT:(.*?):END/su.exec(result.stdout || "")?.[1];
			if (found && found !== "NO_WEBGL2") return { ok: true, renderer: found, flags };
			failure ??= found === "NO_WEBGL2" ? `no WebGL2 context on rung ${flags[0]}` : `Chrome did not start headless: ${firstLine(result.error?.message || result.stderr || `exit ${result.status}`)}`;
		}
		return { ok: false, renderer: null, flags: [], detail: failure };
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
}

export const firstLine = (text) => String(text).trim().split("\n").find((line) => line.trim())?.trim() ?? String(text);

/** The five MO-A-44 probes, plus audio and word-timing state, every time. */
export function status({ env = process.env, browser = true } = {}) {
	const chrome = findChrome(env);
	const version = chrome ? spawnSync(chrome, ["--version"], { encoding: "utf8", env, timeout: 15000 }) : null;
	const ffmpeg = ffmpegProbe(env);
	const gl = browser ? webglProbe(chrome, env) : { ok: false, renderer: null, flags: [], detail: "not probed" };
	const dir = cacheDir(env);
	const deps = depsState(dir);
	const fonts = fontsState(dir);
	const missing = [...deps.missing, ...fonts.missing];
	const warning = !gl.ok ? "no WebGL2 context obtainable (not even software)" : gl.renderer === UNKNOWN_RENDERER ? "renderer type unknown — debug-info extension unavailable" : isSoftware(gl.renderer) ? `software GL detected (${gl.renderer}); renders will be slower, --samples lowered automatically` : "none (real GPU renderer)";
	return {
		chrome: chrome ? `${chrome} (${firstLine(version?.stdout || version?.stderr || "version unknown")})` : "not found on PATH / not installed",
		ffmpeg: ffmpeg.ok ? `${ffmpeg.path} (${ffmpeg.line}); preview encoder ${ffmpeg.previewEncoder}` : "not found on PATH",
		webgl2: gl.ok ? gl.renderer : gl.detail,
		rendererWarning: warning,
		prewarm: missing.length ? `missing: ${missing.join("; ")}; fix: ${INSTALL_COMMAND}` : `ready (${dir})`,
		ready: missing.length === 0,
		missing,
		cache: dir,
		audio: audioState(dir).detail,
		wordTiming: wordTimingState(dir).detail,
		chromeFlags: gl.flags,
		softwareRenderer: gl.ok && isSoftware(gl.renderer),
		previewEncoder: ffmpeg.previewEncoder,
	};
}

export function renderStatus(report) {
	return [
		`Chrome: ${report.chrome}`,
		`ffmpeg: ${report.ffmpeg}`,
		`WebGL2 renderer: ${report.webgl2}`,
		`Renderer warning: ${report.rendererWarning}`,
		`Pre-warm: ${report.prewarm}`,
		`Audio tier: ${report.audio}`,
		`Word timing: ${report.wordTiming}`,
	].join("\n");
}
