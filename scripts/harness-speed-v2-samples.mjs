export const PHASES = ["B0", "S1", "S2"];

function object(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields) {
	return (
		object(value) &&
		Object.keys(value).length === fields.length &&
		fields.every((field) => Object.hasOwn(value, field))
	);
}

function seriesError(series) {
	if (!Array.isArray(series) || series.length !== 5) return "INVALID_COHORT_SHAPE";
	for (const [position, sample] of series.entries()) {
		if (!exactFields(sample, ["index", "value_ms"]) || sample.index !== position + 1)
			return "INVALID_SAMPLE_IDENTITY";
		if (typeof sample.value_ms !== "number" || !Number.isFinite(sample.value_ms) || sample.value_ms <= 0)
			return "INVALID_COHORT_SHAPE";
	}
	return null;
}

export function blocksError(value) {
	if (!Array.isArray(value) || value.length !== 6) return "INVALID_COHORT_SHAPE";
	for (const [index, block] of value.entries()) {
		if (!exactFields(block, ["index", "order", "samples"]) || block.index !== index + 1)
			return "INVALID_COHORT_SHAPE";
		if (block.order !== (index % 2 === 0 ? "AB" : "BA")) return "INVALID_BLOCK_ORDER";
		if (!exactFields(block.samples, ["baseline", "candidate"])) return "INVALID_COHORT_SHAPE";
		for (const arm of ["baseline", "candidate"]) {
			if (!exactFields(block.samples[arm], PHASES)) return "INVALID_COHORT_SHAPE";
			for (const phase of PHASES) {
				const error = seriesError(block.samples[arm][phase]);
				if (error !== null) return error;
			}
		}
	}
	return null;
}

export function armSampleValues(input, arm, phase = null, blockSlice = input.blocks) {
	return blockSlice
		.flatMap((block) => (phase === null ? PHASES.flatMap((id) => block.samples[arm][id]) : block.samples[arm][phase]))
		.map((sample) => sample.value_ms);
}

export function createSelfCheckBlocks() {
	const series = (value) => Array.from({ length: 5 }, (_, index) => ({ index: index + 1, value_ms: value }));
	const arm = (value) => Object.fromEntries(PHASES.map((phase) => [phase, series(value)]));
	return Array.from({ length: 6 }, (_, index) => ({
		index: index + 1,
		order: index % 2 === 0 ? "AB" : "BA",
		samples: { baseline: arm(100), candidate: arm(85) },
	}));
}
