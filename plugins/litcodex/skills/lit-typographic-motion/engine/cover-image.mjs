// Pixel helpers for cover mode, on RGBA8 buffers: the separable Lanczos-3 resize that takes the 2x
// seek capture down to the cover size, the gate's luma grid (Rec. 709 weights on the gamma values,
// box-averaged to about COVER.lumaWidth wide, so every motion number is a thumbnail-scale number), a
// rectangle crop, and a tile SSIM on luma for the frame-0 base-art check.
import { COVER } from "./constants.mjs";

const sinc3 = (x) => {
	if (x === 0) return 1;
	if (Math.abs(x) >= 3) return 0;
	const px = Math.PI * x;
	return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};

/** For each output index, the first source index and the normalized taps (the support widens when shrinking). */
function taps(src, dst) {
	const scale = src / dst;
	const reach = 3 * Math.max(1, scale);
	return Array.from({ length: dst }, (_, i) => {
		const centre = (i + 0.5) * scale - 0.5;
		const first = Math.max(0, Math.ceil(centre - reach));
		const last = Math.min(src - 1, Math.floor(centre + reach));
		const weights = [];
		for (let j = first; j <= last; j++) weights.push(sinc3((j - centre) / Math.max(1, scale)));
		const total = weights.reduce((a, b) => a + b, 0);
		return { first, weights: weights.map((w) => w / total) };
	});
}

const byte = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/** Lanczos-3 resize of an opaque RGBA8 frame; the output alpha is 255. */
export function lanczosResize(src, sw, sh, dw, dh) {
	if (sw === dw && sh === dh) return Buffer.from(src);
	const across = taps(sw, dw);
	const down = taps(sh, dh);
	const rows = new Float32Array(dw * sh * 3);
	for (let y = 0; y < sh; y++)
		for (let x = 0; x < dw; x++) {
			const { first, weights } = across[x];
			let r = 0;
			let g = 0;
			let b = 0;
			for (let k = 0; k < weights.length; k++) {
				const o = (y * sw + first + k) * 4;
				r += src[o] * weights[k];
				g += src[o + 1] * weights[k];
				b += src[o + 2] * weights[k];
			}
			const o = (y * dw + x) * 3;
			rows[o] = r;
			rows[o + 1] = g;
			rows[o + 2] = b;
		}
	const out = Buffer.alloc(dw * dh * 4);
	for (let y = 0; y < dh; y++) {
		const { first, weights } = down[y];
		for (let x = 0; x < dw; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			for (let k = 0; k < weights.length; k++) {
				const o = ((first + k) * dw + x) * 3;
				r += rows[o] * weights[k];
				g += rows[o + 1] * weights[k];
				b += rows[o + 2] * weights[k];
			}
			const o = (y * dw + x) * 4;
			out[o] = byte(r);
			out[o + 1] = byte(g);
			out[o + 2] = byte(b);
			out[o + 3] = 255;
		}
	}
	return out;
}

/** Box-averaged luma (0..255) about COVER.lumaWidth wide: { luma, w, h }. */
export function lumaGrid(rgba, width, height) {
	const f = Math.max(1, Math.round(width / COVER.lumaWidth));
	const w = Math.floor(width / f);
	const h = Math.floor(height / f);
	const luma = new Float32Array(w * h);
	for (let y = 0; y < h * f; y++) {
		const row = Math.floor(y / f) * w;
		for (let x = 0; x < w * f; x++) {
			const p = (y * width + x) * 4;
			luma[row + Math.floor(x / f)] += 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
		}
	}
	for (let i = 0; i < luma.length; i++) luma[i] /= f * f;
	return { luma, w, h };
}

/** The rectangle [x, y, w, h] of an RGBA8 frame as its own buffer. */
export function crop(rgba, width, [x, y, w, h]) {
	const out = Buffer.alloc(w * h * 4);
	for (let row = 0; row < h; row++) out.set(rgba.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
	return out;
}

/** SSIM of two same-size RGBA8 images on luma: the mean SSIM over 8x8 tiles. */
export function ssim(a, b, width, height) {
	const lum = (img, i) => 0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2];
	const T = 8;
	const c1 = (0.01 * 255) ** 2;
	const c2 = (0.03 * 255) ** 2;
	let sum = 0;
	let tiles = 0;
	for (let ty = 0; ty + T <= height; ty += T)
		for (let tx = 0; tx + T <= width; tx += T) {
			const xs = [];
			const ys = [];
			for (let y = ty; y < ty + T; y++)
				for (let x = tx; x < tx + T; x++) {
					xs.push(lum(a, y * width + x));
					ys.push(lum(b, y * width + x));
				}
			const n = xs.length;
			const mx = xs.reduce((s, v) => s + v, 0) / n;
			const my = ys.reduce((s, v) => s + v, 0) / n;
			let vx = 0;
			let vy = 0;
			let cov = 0;
			for (let i = 0; i < n; i++) {
				vx += (xs[i] - mx) ** 2;
				vy += (ys[i] - my) ** 2;
				cov += (xs[i] - mx) * (ys[i] - my);
			}
			vx /= n - 1;
			vy /= n - 1;
			cov /= n - 1;
			sum += ((2 * mx * my + c1) * (2 * cov + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2));
			tiles++;
		}
	return tiles ? sum / tiles : 0;
}
