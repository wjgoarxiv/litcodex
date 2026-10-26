// Motion runtime: a product-owned cache under ${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime,
// filled only by `litcodex motion-runtime install` (or the installer/postinstall pre-warm) from the
// pinned lockfile, pinned font URLs and a hash-pinned audio requirements file. Renders only read it
// (MO-A-42/43). This module also carries the six doctor/status probes (MO-A-44/55): the five film
// probes and the cover encoder that cover mode needs.
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

const PIN_TIMEOUT_MS = 120_000;
const PIN_MAX_BYTES = 64 * 1024 * 1024;

/**
 * One pinned file: from the local mirror, or over the network inside a deadline and a byte cap (the pin's
 * own size, else maxBytes), hashed while it streams. The size and sha256 pin is checked either way.
 * `fetchImpl`, `timeoutMs` and `maxBytes` are injectable for tests.
 */
export async function fetchPinned(item, mirror, { fetchImpl = globalThis.fetch, timeoutMs = PIN_TIMEOUT_MS, maxBytes = PIN_MAX_BYTES } = {}) {
	let bytes;
	let digest;
	if (mirror) {
		bytes = readFileSync(join(mirror, item.path));
		digest = sha256(bytes);
	} else {
		const limit = item.bytes ?? maxBytes;
		const signal = AbortSignal.timeout(timeoutMs);
		const tooLarge = () => new Error(`fetch ${item.url}: larger than ${limit} bytes`);
		try {
			const response = await fetchImpl(item.url, { redirect: "follow", signal });
			if (!response.ok) throw new Error(`fetch ${item.url}: HTTP ${response.status}`);
			if (Number(response.headers.get("content-length") ?? 0) > limit) {
				await response.body?.cancel();
				throw tooLarge();
			}
			const hash = createHash("sha256");
			const chunks = [];
			let total = 0;
			const reader = response.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				total += value.length;
				if (total > limit) {
					await reader.cancel();
					throw tooLarge();
				}
				hash.update(value);
				chunks.push(Buffer.from(value));
			}
			bytes = Buffer.concat(chunks);
			digest = hash.digest("hex");
		} catch (error) {
			if (signal.aborted) throw new Error(`fetch ${item.url}: timed out after ${timeoutMs / 1000} s`);
			throw error;
		}
	}
	if (item.bytes !== undefined && bytes.length !== item.bytes) throw new Error(`${item.path}: ${bytes.length} bytes, pinned ${item.bytes}`);
	if (digest !== item.sha256) throw new Error(`${item.path}: sha256 mismatch against its pin`);
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

/**
 * How to run npm: node + npm's own entry script when one exists. Node refuses to spawn a .cmd/.bat
 * shim without a shell (CVE-2024-27980), so on Windows the last resort is a quoted cmd.exe line.
 */
export function npmCommand(args, env = process.env, platform = process.platform, exists = existsSync) {
	if (env.npm_execpath && exists(env.npm_execpath)) return { command: process.execPath, args: [env.npm_execpath, ...args] };
	if (platform !== "win32") return { command: "npm", args };
	const bundled = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
	if (exists(bundled)) return { command: process.execPath, args: [bundled, ...args] };
	return { command: ["npm.cmd", ...args].map(cmdArgument).join(" "), args: [], shell: true };
}

/** One argument for a cmd.exe line: quoted when it holds spaces; refused when cmd would interpret it. */
export function cmdArgument(value) {
	if (/["%^&|<>!\r\n]/u.test(value)) throw new Error(`refusing to pass ${JSON.stringify(value)} through cmd.exe`);
	return /[\s()]/u.test(value) ? `"${value}"` : value;
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
			const ci = ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];
			if (env.LITCODEX_MOTION_NPM_CACHE) ci.push("--offline", "--cache", env.LITCODEX_MOTION_NPM_CACHE);
			const npm = npmCommand(ci, env);
			log(`installing pinned engine dependencies into ${dir}`);
			const result = spawnSync(npm.command, npm.args, { cwd: dir, encoding: "utf8", env: { ...npmChildEnv(env), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" }, timeout: 300000, ...(npm.shell ? { shell: true } : {}) });
			if (result.status !== 0) throw new Error(`npm ci failed (exit ${result.status ?? result.signal}): ${(result.error?.message || result.stderr || "").trim().split(/\r?\n/u).slice(-2).join(" ")}`);
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

// The audio requirements are compiled for CPython 3.10 and up, but --only-binary needs a wheel for
// every pin, and those stop at MAX_PYTHON: a newer host python3 (3.15 on some Macs) fails pip on the
// first package without one. So the venv is built from the newest python3.X inside the range.
const MIN_PYTHON = [3, 10];
const MAX_PYTHON = [3, 14];
const PYTHON_RANGE = `${MIN_PYTHON.join(".")} to ${MAX_PYTHON.join(".")}`;

export function probePython(command, env = process.env) {
	const probe = spawnSync(command, ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], { encoding: "utf8", env, timeout: 30000 });
	if (probe.error || probe.status !== 0) return { ok: false, command, detail: probe.error?.code === "ENOENT" || !probe.stderr ? "not found" : probe.stderr.trim().split(/\r?\n/u).pop() };
	const version = probe.stdout.trim();
	const [major, minor] = version.split(".").map(Number);
	if (major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1])) return { ok: false, command, version, detail: `${version} is older than ${MIN_PYTHON.join(".")}` };
	if (major > MAX_PYTHON[0] || (major === MAX_PYTHON[0] && minor > MAX_PYTHON[1])) return { ok: false, command, version, detail: `${version} is newer than ${MAX_PYTHON.join(".")}` };
	return { ok: true, command, version, detail: version };
}

/** $LITCODEX_MOTION_PYTHON alone when set; otherwise python3.14 down to python3.10, then python3 and python. */
export function pickPython(env = process.env, probe = (command) => probePython(command, env)) {
	if (env.LITCODEX_MOTION_PYTHON) return probe(env.LITCODEX_MOTION_PYTHON);
	const candidates = [];
	for (let minor = MAX_PYTHON[1]; minor >= MIN_PYTHON[1]; minor -= 1) candidates.push(`python3.${minor}`);
	const tried = [];
	for (const command of [...candidates, "python3", "python"]) {
		const found = probe(command);
		if (found.ok) return found;
		if (found.detail !== "not found") tried.push(`${command}: ${found.detail}`);
	}
	return { ok: false, command: "python3", detail: `no supported Python (${PYTHON_RANGE}) on PATH${tried.length ? `; tried ${tried.join(", ")}` : ""}` };
}

function installAudio(dir, env, log) {
	const venv = join(dir, "audio-venv");
	const picked = pickPython(env);
	if (!picked.ok) throw new Error(`audio venv needs Python ${PYTHON_RANGE}: ${picked.detail}; set LITCODEX_MOTION_PYTHON to one`);
	const python = picked.command;
	log(`creating the librosa venv with ${python} ${picked.version}`);
	rmSync(venv, { recursive: true, force: true });
	const made = spawnSync(python, ["-m", "venv", venv], { encoding: "utf8", env, timeout: 120000 });
	if (made.status !== 0) throw new Error(`python venv failed: ${(made.error?.message || made.stderr || "").trim()}`);
	const pip = spawnSync(venvPython(dir), ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--require-hashes", "--only-binary=:all:", "-r", AUDIO_REQUIREMENTS], { encoding: "utf8", env, timeout: 900000 });
	if (pip.status !== 0) throw new Error(`pip install --require-hashes failed (exit ${pip.status ?? pip.signal}): ${(pip.error?.message || pip.stderr || "").trim().split(/\r?\n/u).slice(-2).join(" ")}`);
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
 * The stage path's launch flags: the software rung (SwiftShader, CPU raster) by default, or the
 * platform's GPU rung for a 3D film (WebGL on the GPU through the platform's angle backend; page
 * raster stays on the CPU on both), then the stage determinism and network flags and the frame size.
 * A round uses one rung for the master and every replay, so a determinism mismatch is still a page
 * leak. Accepts (width, height, platform, rung) or ({ width, height, rung, platform }).
 */
export function stageFlags(width, height, platform = process.platform, rung = "software") {
	if (width && typeof width === "object") return stageFlags(width.width, width.height, width.platform ?? process.platform, width.rung ?? "software");
	if (rung !== "gpu" && rung !== "software") throw new Error(`stageFlags: rung is gpu or software (got ${rung})`);
	const ladder = chromeLadder(platform);
	const base = rung === "gpu" ? [...ladder[0].filter((flag) => flag !== "--enable-gpu-rasterization"), "--disable-gpu-rasterization", "--disable-partial-raster"] : ladder[1];
	return [...base, ...CHROME_STAGE_FLAGS, `--window-size=${width},${height}`];
}

/**
 * Cover mode's launch: the stage rung at the cover's device scale, with raster kept off the GPU path
 * and never partial: at 2x, glyph edges rastered in GPU tiles came out one level apart between fresh
 * browsers.
 */
export function coverFlags(width, height, scale, platform = process.platform, rung = "software") {
	return [...stageFlags(width, height, platform, rung).map((flag) => (flag === "--force-device-scale-factor=1" ? `--force-device-scale-factor=${scale}` : flag)), "--disable-gpu-rasterization", "--disable-partial-raster"];
}

export const isSoftware = (renderer) => SOFTWARE_GL.some((needle) => String(renderer).toLowerCase().includes(needle));

/** A PATH lookup; on Windows it tries each PATHEXT extension, so ffmpeg.exe answers for ffmpeg. */
export function which(command, env = process.env, platform = process.platform, exists = existsSync) {
	const extensions = platform === "win32" ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
	for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : delimiter)) {
		if (!dir) continue;
		for (const extension of extensions) {
			const path = join(dir, `${command}${extension}`);
			if (exists(path)) return path;
		}
	}
	return null;
}

export function ffmpegProbe(env = process.env) {
	const path = which("ffmpeg", env);
	if (!path) return { ok: false, line: "not found on PATH", previewEncoder: null };
	const version = spawnSync(path, ["-hide_banner", "-version"], { encoding: "utf8", env });
	const first = (version.stdout || "").split(/\r?\n/u)[0].trim();
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

/** Cover mode's encoder: img2webp with dwebp (encode, then decode for the gate), else the gifski fallback. */
export function coverEncoderProbe(env = process.env) {
	const img2webp = which("img2webp", env);
	const dwebp = which("dwebp", env);
	const version = (tool) => /\d+\.\d+(?:\.\d+)?/u.exec(`${spawnSync(tool, ["-version"], { encoding: "utf8", env }).stdout ?? ""}`)?.[0] ?? "version unknown";
	if (img2webp && dwebp) return { ok: true, line: `img2webp ${version(img2webp)} and dwebp ${version(dwebp)}: README covers encode as animated WebP and the gate reads the decoded file` };
	const gifski = which("gifski", env);
	if (gifski) return { ok: true, line: `gifski at ${gifski}: covers fall back to GIF (${[img2webp ? null : "img2webp", dwebp ? null : "dwebp"].filter(Boolean).join(" and ")} missing)` };
	return { ok: false, line: "BLOCKED_NO_COVER_ENCODER: install libwebp (img2webp, dwebp) or gifski; cover renders stop with exit 21" };
}

/** The six MO-A-44 probes, plus audio and word-timing state, every time. */
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
		coverEncoder: coverEncoderProbe(env).line,
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
		`Cover encoder: ${report.coverEncoder}`,
		`Audio tier: ${report.audio}`,
		`Word timing: ${report.wordTiming}`,
	].join("\n");
}
