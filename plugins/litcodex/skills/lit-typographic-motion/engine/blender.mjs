// The offline Blender rung. A 3D film with `render3d: "blender"` writes its world as a Blender Python
// scene (<out>/stage/scene.py); `render.mjs blender` renders it headless with Cycles through the bundled
// runner: first preview stills at the beat midpoints (half size, few samples) to look at, then with
// --final the whole plate sequence in <out>/stage/plate/ with plate.json, the receipt the stage trusts.
// The stage page shows the plate through LitStage.plate() and draws its type and labels over it, so the
// page itself stays on the software rung. Without Blender the command renders nothing and names the
// fallback: the three.js world on the GPU rung (references/depth.md).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, Exit, STAGE_FORMATS } from "./constants.mjs";
import { fnv1a32 } from "./util.mjs";

export const BLENDER = Object.freeze({
	macApp: "/Applications/Blender.app/Contents/MacOS/Blender",
	runner: fileURLToPath(new URL("./blender/runner.py", import.meta.url)),
	plateFps: 30,
	device: "METAL",
	preview: Object.freeze({ percent: 50, samples: 40 }),
	final: Object.freeze({ percent: 100, samples: 160 }),
});

/**
 * Where Blender is: an explicit LITCODEX_BLENDER path (used only if it exists, never second-guessed),
 * then the macOS app, then `blender` on PATH. Returns { path, source } or null. Nothing is assumed.
 */
export function findBlender({ env = process.env, exists = existsSync, platform = process.platform } = {}) {
	if (env.LITCODEX_BLENDER) return exists(env.LITCODEX_BLENDER) ? { path: env.LITCODEX_BLENDER, source: "LITCODEX_BLENDER" } : null;
	if (platform === "darwin" && exists(BLENDER.macApp)) return { path: BLENDER.macApp, source: "app" };
	for (const dir of String(env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const file = join(dir, platform === "win32" ? "blender.exe" : "blender");
		if (exists(file)) return { path: file, source: "PATH" };
	}
	return null;
}

export const plateFrameCount = (treatment) => Math.round(treatment.durationSec * BLENDER.plateFps);

/** The film's Cycles seed: the treatment's seed (or the same derivation the stage uses), below 2^31. */
export const cyclesSeed = (treatment) => (treatment.seed ?? fnv1a32(`${treatment.request}\u0000${treatment.idea}`)) % 2147483648;

/** The headless command line: factory settings, the runner, and the runner's own arguments after `--`. */
export function blenderArgs({ treatment, scene, out, quality }) {
	const q = BLENDER[quality];
	if (quality !== "preview" && quality !== "final") throw new Error(`blenderArgs: quality is preview or final (got ${quality})`);
	const { width, height } = STAGE_FORMATS[treatment.format];
	const args = ["-b", "--factory-startup", "-P", BLENDER.runner, "--", "--scene", scene, "--out", out, "--width", String(width), "--height", String(height), "--percent", String(q.percent), "--samples", String(q.samples), "--device", BLENDER.device, "--fps", String(BLENDER.plateFps), "--seed", String(cyclesSeed(treatment))];
	if (quality === "preview") args.push("--stills", treatment.beats.map((b) => +((b.t0 + b.t1) / 2).toFixed(3)).join(","));
	else args.push("--frames", `1-${plateFrameCount(treatment)}`);
	return args;
}

export const blenderFallback = (out) =>
	[
		"FALLBACK: no Blender found (LITCODEX_BLENDER, /Applications/Blender.app, blender on PATH), so nothing was rendered.",
		`Set render3d to "three" in ${join(out, "treatment.json")} and build the world in three.js on the GPU rung (references/depth.md),`,
		"and say in the reply that the film used the GPU rung because Blender is not installed.",
	].join("\n");

const listPngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".png")).sort() : []);

function runBlender({ bin, args, dir, expected, progress }) {
	return new Promise((resolve) => {
		const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
		let tail = "";
		const keep = (chunk) => {
			tail = (tail + chunk).slice(-4000);
		};
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		const timer = progress ? setInterval(() => progress(listPngs(dir).length, expected), 2000) : null;
		child.on("close", (code) => {
			if (timer) clearInterval(timer);
			resolve({ code, tail });
		});
		child.on("error", (error) => {
			if (timer) clearInterval(timer);
			resolve({ code: -1, tail: error.message });
		});
	});
}

/**
 * `render.mjs blender --out <dir> [--final]`. Preview: stills in stage/plate-preview/. Final: the plate
 * sequence in stage/plate/ and plate.json listing every frame by name and size, with the device,
 * samples and Blender version from the runner's receipt. Returns { code, message }.
 */
export async function blenderCommand({ out, treatment, final = false, env = process.env, log = () => {}, progress = null }) {
	if (treatment.render3d !== "blender") throw new Exit(EXIT.USAGE, `blender renders a treatment with render3d "blender" (this one is ${treatment.render3d ?? "three"})`);
	const stageDir = join(out, "stage");
	const scene = join(stageDir, "scene.py");
	if (!existsSync(scene)) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: ${scene} is missing; write the Blender scene first (references/depth.md, the Blender rung)`);
	const found = findBlender({ env });
	if (!found) return { code: EXIT.OK, fallback: true, message: blenderFallback(out) };
	const quality = final ? "final" : "preview";
	const dir = join(stageDir, final ? "plate" : "plate-preview");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const args = blenderArgs({ treatment, scene, out: dir, quality });
	const expected = final ? plateFrameCount(treatment) : treatment.beats.length;
	log(`blender ${quality}: ${found.path} (${found.source}), ${expected} ${final ? "frames" : "stills"}`);
	const run = await runBlender({ bin: found.path, args, dir, expected, progress });
	const receiptFile = join(dir, "receipt.json");
	if (run.code !== 0 || !existsSync(receiptFile)) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: Blender ${quality} failed (exit ${run.code}); fix stage/scene.py and run it again. Last output: ${run.tail.trim().split("\n").slice(-8).join(" | ")}`);
	const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
	const frames = receipt.files.map((name) => ({ name, bytes: statSync(join(dir, name)).size }));
	if (frames.length !== expected) throw new Exit(EXIT.STAGE_CONTRACT_ERROR, `STAGE_CONTRACT_ERROR: Blender wrote ${frames.length} of ${expected} ${final ? "frames" : "stills"}`);
	const plate = { kind: quality, blender: receipt.blender, engine: receipt.engine, device: receipt.device, samples: receipt.samples, percent: receipt.percent, fps: BLENDER.plateFps, frames };
	writeFileSync(join(dir, "plate.json"), `${JSON.stringify(plate, null, 1)}\n`);
	const label = `Blender ${receipt.blender}, ${receipt.engine} ${receipt.device}, ${receipt.samples} spp at ${receipt.percent} %`;
	if (!final) return { code: EXIT.OK, message: `BLENDER preview: ${frames.length} stills at the beat midpoints in ${dir} (${label}). Open them, fix scene.py, then render the plate: blender --out ${out} --final` };
	return { code: EXIT.OK, message: `BLENDER plate: ${frames.length} frames at ${BLENDER.plateFps} fps in ${dir} (${label}). Show it with LitStage.plate() under the type, then render the stage: stage --out ${out} --round N` };
}

/** The plate a stage dir carries: { dir, frames, device, ... } when plate.json lists frames that are all there as listed, else null. */
export function readPlate(stageDir, sub = "plate") {
	const file = join(stageDir, sub, "plate.json");
	if (!existsSync(file)) return null;
	let plate;
	try {
		plate = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
	if (!Array.isArray(plate.frames)) return null;
	const ok = plate.frames.every((f) => {
		const p = join(stageDir, sub, String(f.name));
		return /^[A-Za-z0-9._-]+$/u.test(String(f.name)) && existsSync(p) && statSync(p).size === f.bytes;
	});
	return ok ? { ...plate, dir: sub } : null;
}
