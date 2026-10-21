// Cover frame worker: decode one 2x capture, Lanczos-downsample it to the cover size, write it as an
// RGB PNG (the encoder's input, and what G0 and the seek-order check hash) and return that PNG's
// SHA-256 with the captured size, so the capture thread only steps the page.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { lanczosResize } from "./cover-image.mjs";
import { decodePng, encodePng } from "./image.mjs";

parentPort.on("message", ({ id, png, width, height, file }) => {
	try {
		const shot = decodePng(Buffer.from(png));
		if (shot.channels !== 4) throw new Error(`capture has ${shot.channels} channel(s); expected RGB or RGBA`);
		const small = lanczosResize(shot.pixels, shot.width, shot.height, width, height);
		const bytes = encodePng(width, height, small, 4, 1);
		if (file) writeFileSync(file, bytes);
		parentPort.postMessage({ id, sha256: createHash("sha256").update(bytes).digest("hex"), captured: `${shot.width}x${shot.height}` });
	} catch (error) {
		parentPort.postMessage({ id, error: String(error?.message ?? error) });
	}
});
