export function easeInOutCubic(progress: number) {
	const t = Math.max(0, Math.min(1, progress));
	return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
}

function easedSegment(frame: number, start: number, end: number) {
	if (frame <= start) return 0;
	if (frame >= end) return 1;
	return easeInOutCubic((frame - start) / (end - start));
}

export function coverLoopProgress(frame: number) {
	if (!Number.isFinite(frame)) throw new Error("cover frame must be finite");
	const easeIn = easedSegment(frame, 36, 138);
	const easeOut = easedSegment(frame, 162, 264);
	return easeIn * (1 - easeOut);
}

export function titleMotionAt(frame: number) {
	if (!Number.isFinite(frame)) throw new Error("cover frame must be finite");
	const enter = easedSegment(frame, 0, 18);
	const settle = easedSegment(frame, 18, 48);
	const pulse = enter * (1 - settle);
	return { titleOffsetY: 8 * pulse, subtitleOffsetY: pulse === 0 ? 0 : -4 * pulse };
}
