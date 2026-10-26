// Test driver for the stage gate tests: runs the stage renderer (or the board text check) on a run
// folder whose treatment.json is already in the shape the renderer takes, so a test can vary one rule
// without going through the treatment validator. Prints the exit code and the message on stderr.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT, Exit, STAGE_FORMATS } from "../engine/constants.mjs";
import { resolveRuntime } from "../engine/runtime.mjs";
import { closeStage, DecodePool, fontRoutes, openStage, scanStage } from "../engine/stage.mjs";
import { runStage } from "../engine/stage-render.mjs";
import { boardQA, qaScript } from "../engine/stage-qa.mjs";

const [out, mode = "full"] = process.argv.slice(2);
const treatment = JSON.parse(readFileSync(join(out, "treatment.json"), "utf8"));
try {
	if (mode === "board") {
		const runtime = resolveRuntime();
		const format = STAGE_FORMATS[treatment.format];
		const pool = new DecodePool();
		const session = await openStage({ runtime, outDir: out, scan: scanStage(join(out, "stage")), fonts: fontRoutes(runtime.dir), width: format.width, height: format.height, fps: treatment.fps ?? 60, seed: 1, extraInit: qaScript() });
		try {
			const fps = session.contract.fps ?? 60;
			const result = await boardQA({ session, treatment, fps, frameCount: Math.round(session.contract.duration * fps), width: format.width, height: format.height, pool });
			writeFileSync(join(out, "board-qa.json"), JSON.stringify(result, null, 2));
		} finally {
			await closeStage(session);
			await pool.close();
		}
		process.exit(EXIT.OK);
	}
	process.exit(await runStage({ outDir: out, treatment, round: 1, stillsOnly: mode === "stills", log: (line) => console.log(line) }));
} catch (error) {
	if (error instanceof Exit) {
		console.error(error.message);
		process.exit(error.code);
	}
	throw error;
}
