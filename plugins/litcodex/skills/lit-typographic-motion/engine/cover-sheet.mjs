// The cover's review sheet: twelve decoded frames above a frame-difference plot of the whole loop (one
// point per grid step, with the still threshold and the median drawn in). The plot shows what single
// stills cannot: holds lie flat on the still line, encoder pops are regular spikes, a reset is a spike
// at the right end. `marks` shades spans on the plot (a logged defect's window). The sheet is laid out
// as an HTML page and captured by headless Chrome, so its captions are real type; it is a review
// artifact and never feeds a gate.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COVER } from "./constants.mjs";
import { launchCover } from "./driver.mjs";
import { downscale, encodePng } from "./image.mjs";

const esc = (s) => String(s).replace(/[&<>"]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TILE_W = 400;
const COLUMNS = 4;

/** The sheet as one HTML page: tiles [{ png, caption }] four to a row, then the plot of `diffs`. */
export function sheetPage({ tiles, tileHeight, diffs, medianD, label, status, marks = [], durationSec }) {
	const pad = 8;
	const caption = 22;
	const rows = Math.ceil(tiles.length / COLUMNS);
	const width = COLUMNS * TILE_W + (COLUMNS + 1) * pad;
	const plotTop = rows * (tileHeight + caption + pad) + pad + 10;
	const plotH = 170;
	const height = plotTop + plotH + 44;
	const plotW = width - 2 * pad;
	const top = Math.max(0.01, ...diffs) * 1.05;
	const x = (i) => pad + (i / Math.max(1, diffs.length - 1)) * plotW;
	const y = (v) => plotTop + plotH - (v / top) * plotH;
	const at = (sec) => pad + (sec / durationSec) * plotW;
	const cells = tiles
		.map((tile, k) => {
			const left = pad + (k % COLUMNS) * (TILE_W + pad);
			const head = pad + Math.floor(k / COLUMNS) * (tileHeight + caption + pad);
			return `<div class="cap" style="left:${left}px;top:${head}px">${esc(tile.caption)}</div><img src="data:image/png;base64,${tile.png.toString("base64")}" style="left:${left}px;top:${head + caption}px;width:${TILE_W}px;height:${tileHeight}px">`;
		})
		.join("\n");
	const shaded = marks.map((m) => `<rect x="${at(m.t0).toFixed(1)}" y="${plotTop}" width="${Math.max(2, at(m.t1) - at(m.t0)).toFixed(1)}" height="${plotH}" fill="#ffb02e" opacity="0.18"/>`).join("");
	const line = diffs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
	const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#080b10}
img{position:absolute;display:block}.cap{position:absolute;font:13px ui-monospace,Menlo,monospace;color:#9aa}
.foot{position:absolute;left:${pad}px;top:${plotTop + plotH + 12}px;font:14px ui-monospace,Menlo,monospace;color:#ccd;white-space:nowrap}</style>
<body>${cells}<svg width="${width}" height="${height}" style="position:absolute;left:0;top:0"><rect x="${pad}" y="${plotTop}" width="${plotW}" height="${plotH}" fill="#11161d"/>${shaded}
<line x1="${pad}" x2="${pad + plotW}" y1="${y(COVER.stillEps)}" y2="${y(COVER.stillEps)}" stroke="#a33" stroke-dasharray="4 4"/>
<line x1="${pad}" x2="${pad + plotW}" y1="${y(medianD)}" y2="${y(medianD)}" stroke="#5a8" stroke-dasharray="2 3"/>
<polyline points="${line}" fill="none" stroke="#ff7a46" stroke-width="1.5"/></svg><div class="foot">${esc(label)} | ${esc(status)}</div></body>`;
	return { html, width, height };
}

/**
 * Render the sheet to `file`. `tiles` are [{ rgba, width, height, caption }] at the cover size; each is
 * box-downscaled to 400 px wide before it goes into the page.
 */
export async function renderSheet({ file, tiles, diffs, medianD, label, status, marks, durationSec, runtime, workDir, env }) {
	const tileHeight = Math.round((TILE_W * tiles[0].height) / tiles[0].width);
	const small = tiles.map((t) => ({ caption: t.caption, png: encodePng(TILE_W, tileHeight, downscale(t.rgba, t.width, t.height, TILE_W, tileHeight), 4, 3) }));
	const { html, width, height } = sheetPage({ tiles: small, tileHeight, diffs, medianD, label, status, marks, durationSec });
	mkdirSync(workDir, { recursive: true });
	const { context, page } = await launchCover({ runtime, width, height, scale: 1, profileDir: join(workDir, "chrome"), env });
	try {
		await page.setContent(html, { waitUntil: "load" });
		await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
		writeFileSync(file, await page.screenshot({ clip: { x: 0, y: 0, width, height }, type: "png" }));
	} finally {
		await context.close().catch(() => {});
		rmSync(workDir, { recursive: true, force: true });
	}
	return file;
}
