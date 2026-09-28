// Stage frame worker: decodes one captured PNG to RGBA, hashes the decoded bytes (never the PNG),
// and computes the flash-audit cell grid and the near-black percentile, so the main thread only
// orders frames and feeds ffmpeg while the next frame is being stepped.
import { parentPort } from "node:worker_threads";
import { cellGrid, gridFor } from "./flash.mjs";
import { decodePng, downscale, encodePng, luminancePercentile, rgbaSha256 } from "./image.mjs";
import { NEAR_BLACK } from "./constants.mjs";

parentPort.on("message", ({ id, png, analyze, preview }) => {
	try {
		const image = decodePng(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
		const rgba = image.pixels;
		const out = { id, width: image.width, height: image.height, sha: rgbaSha256(rgba) };
		if (analyze) {
			out.grid = cellGrid(rgba, image.width, image.height, gridFor(image.width, image.height));
			out.p995 = luminancePercentile(rgba, NEAR_BLACK.percentile);
		}
		if (preview) out.previewPng = encodePng(preview[0], preview[1], downscale(rgba, image.width, image.height, preview[0], preview[1]), 4, 3);
		out.rgba = rgba;
		const transfer = [rgba.buffer];
		if (out.grid) transfer.push(out.grid.lum.buffer, out.grid.redValue.buffer, out.grid.saturated.buffer);
		parentPort.postMessage(out, transfer);
	} catch (error) {
		parentPort.postMessage({ id, error: String(error?.stack ?? error) });
	}
});
