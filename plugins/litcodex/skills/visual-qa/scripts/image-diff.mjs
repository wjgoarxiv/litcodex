const GRID = 8;

function rounded(value) {
	return Math.round(value * 10000) / 10000;
}

function pixelDiff(reference, actual, refOffset, actualOffset) {
	for (let channel = 0; channel < 4; channel += 1) {
		if (reference[refOffset + channel] !== actual[actualOffset + channel]) return true;
	}
	return false;
}

export function diffImages(reference, actual) {
	if (reference.width !== actual.width || reference.height !== actual.height) {
		throw new Error("IMAGE_DIMENSION_MISMATCH: dimensions must match before scoring");
	}
	const width = Math.min(reference.width, actual.width);
	const height = Math.min(reference.height, actual.height);
	const columns = Math.max(1, Math.min(GRID, width));
	const rows = Math.max(1, Math.min(GRID, height));
	const changed = new Array(columns * rows).fill(0);
	const totals = new Array(columns * rows).fill(0);
	let diffPixels = 0;
	let alphaDiffPixels = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const cell = Math.min(rows - 1, Math.floor(y * rows / height)) * columns +
				Math.min(columns - 1, Math.floor(x * columns / width));
			totals[cell] += 1;
			if (pixelDiff(reference.rgba, actual.rgba, (y * reference.width + x) * 4, (y * actual.width + x) * 4)) {
				diffPixels += 1;
				changed[cell] += 1;
			}
			if (reference.rgba[(y * reference.width + x) * 4 + 3] !== actual.rgba[(y * actual.width + x) * 4 + 3]) {
				alphaDiffPixels += 1;
			}
		}
	}
	const hotspots = changed.flatMap((count, index) => count === 0 ? [] : [{
		gridX: index % columns,
		gridY: Math.floor(index / columns),
		diffRatio: rounded(count / totals[index]),
	}]).sort((left, right) => right.diffRatio - left.diffRatio);
	const totalPixels = width * height;
	const ratio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
	const dimensionsMatch = true;
	return {
		command: "image-diff",
		dimensionsMatch,
		reference: { width: reference.width, height: reference.height },
		actual: { width: actual.width, height: actual.height },
		totalPixels,
		diffPixels,
		diffRatio: rounded(ratio),
		similarityScore: Math.round((1 - ratio) * 100),
		alphaChannelIntact:
			reference.hasAlphaChannel === actual.hasAlphaChannel &&
			alphaDiffPixels === 0,
		hotspots,
		summary: `${Math.round((1 - ratio) * 100)}/100 similarity; ${diffPixels}/${totalPixels} pixels differ${dimensionsMatch ? "" : "; dimensions differ"}.`,
	};
}
