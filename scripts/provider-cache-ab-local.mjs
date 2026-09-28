function promptIdentity(receipt) {
	return JSON.stringify([
		receipt?.identity?.executableSha256,
		receipt?.identity?.versionSha256,
		receipt?.model?.requested,
		receipt?.scenario?.sha256,
		receipt?.prompt,
		receipt?.control?.promptInput?.totalBytes,
		receipt?.control?.promptInput?.identitySha256,
	]);
}

function validDelta(receipt) {
	const active = receipt?.active?.promptInput?.totalBytes;
	const control = receipt?.control?.promptInput?.totalBytes;
	return (
		Number.isSafeInteger(active) &&
		Number.isSafeInteger(control) &&
		Number.isSafeInteger(receipt?.deltaBytes) &&
		active > 0 &&
		control > 0 &&
		receipt.deltaBytes > 0 &&
		receipt.deltaBytes === active - control
	);
}

export function evaluateLocalPrefixGate(baseline, candidate) {
	if (!validDelta(baseline) || !validDelta(candidate)) {
		return { status: "BLOCKED", code: "BLOCKED_PROMPT_INPUT_INVALID" };
	}
	if (promptIdentity(baseline) !== promptIdentity(candidate)) {
		return { status: "BLOCKED", code: "BLOCKED_PROMPT_INPUT_IDENTITY" };
	}
	const measured = {
		baselineDeltaBytes: baseline.deltaBytes,
		candidateDeltaBytes: candidate.deltaBytes,
		twiceCandidateDeltaBytes: candidate.deltaBytes * 2,
	};
	return candidate.deltaBytes * 2 <= baseline.deltaBytes
		? { status: "PASS", code: "LOCAL_PREFIX_REDUCTION_ACCEPTED", ...measured }
		: { status: "BLOCKED", code: "BLOCKED_LOCAL_PREFIX_REDUCTION", ...measured };
}
