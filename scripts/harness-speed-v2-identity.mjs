export const FIXTURE_SHA256 = "aaef5ba778532013248f0b5c0a9f958468786840595e48cb84851ab88bf2b4be";
export const FROZEN_STATUS = "da7d543c260f9b5b01134275969b0bfd3de9cf66e7aace93fbfd4f31bcd04710";
export const FROZEN_HEAD = "1ee4c6a5264625f2055a8e8d64a404a0eb450112";
export const FROZEN_SOURCE_ARTIFACT = "d7aaf030e1239e0c4e2a459bb21fb7d5f806eeb1d9bbddd6f5827cf97b8f025b";

const BASELINE_FIELDS = [
	"kind",
	"head",
	"status_sha256",
	"source_artifact_sha256",
	"artifact_sha256",
	"fixture_sha256",
];
const CANDIDATE_FIELDS = [
	"kind",
	"head",
	"status_sha256",
	"base_source_artifact_sha256",
	"source_artifact_sha256",
	"artifact_sha256",
	"fixture_sha256",
];

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

function artifactValid(value, fields) {
	return (
		exactFields(value, fields) &&
		/^[0-9a-f]{40}$/u.test(value.head) &&
		fields.filter((field) => field.endsWith("sha256")).every((field) => /^[0-9a-f]{64}$/u.test(value[field]))
	);
}

export function sourceIdentityError(value) {
	if (
		!exactFields(value, ["baseline", "candidate"]) ||
		!artifactValid(value.baseline, BASELINE_FIELDS) ||
		!artifactValid(value.candidate, CANDIDATE_FIELDS)
	)
		return "MALFORMED_RECEIPT";
	const { baseline, candidate } = value;
	if (baseline.kind !== "frozen-final-repaired") return "WRONG_BASELINE_SOURCE";
	if (baseline.head !== FROZEN_HEAD || baseline.status_sha256 !== FROZEN_STATUS) return "FROZEN_BASELINE_MISMATCH";
	if (baseline.source_artifact_sha256 !== FROZEN_SOURCE_ARTIFACT) return "FROZEN_SOURCE_ARTIFACT_MISMATCH";
	if (baseline.fixture_sha256 !== FIXTURE_SHA256 || candidate.fixture_sha256 !== FIXTURE_SHA256)
		return "FIXTURE_IDENTITY_MISMATCH";
	if (candidate.kind !== "candidate" || candidate.head !== FROZEN_HEAD) return "CANDIDATE_IDENTITY_MISMATCH";
	if (
		candidate.base_source_artifact_sha256 !== FROZEN_SOURCE_ARTIFACT ||
		candidate.source_artifact_sha256 === FROZEN_SOURCE_ARTIFACT
	)
		return "CANDIDATE_SOURCE_MISMATCH";
	if (candidate.status_sha256 === baseline.status_sha256 || candidate.artifact_sha256 === baseline.artifact_sha256)
		return "CANDIDATE_IDENTITY_MISMATCH";
	return null;
}

export function createSelfCheckSource() {
	const baselineArtifact = "a".repeat(64);
	return {
		baseline: {
			kind: "frozen-final-repaired",
			head: FROZEN_HEAD,
			status_sha256: FROZEN_STATUS,
			source_artifact_sha256: FROZEN_SOURCE_ARTIFACT,
			artifact_sha256: baselineArtifact,
			fixture_sha256: FIXTURE_SHA256,
		},
		candidate: {
			kind: "candidate",
			head: FROZEN_HEAD,
			status_sha256: "b".repeat(64),
			base_source_artifact_sha256: FROZEN_SOURCE_ARTIFACT,
			source_artifact_sha256: "d".repeat(64),
			artifact_sha256: "c".repeat(64),
			fixture_sha256: FIXTURE_SHA256,
		},
	};
}
