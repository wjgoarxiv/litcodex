// When a film turn counts as done. The verdict itself lives in look.mjs (director brief section 9):
// gate PASS, a valid treatment, at least two look rounds with the last on the final render's stills
// and full viewing coverage. `render.mjs completion --out <dir>` prints it for the host model.
import { evaluateDone } from "./look.mjs";

export function evaluateCompletion(outDir) {
	const verdict = evaluateDone(outDir);
	return { ...verdict, complete: verdict.status !== "not complete" };
}
