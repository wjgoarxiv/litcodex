import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readdirSync,
	readSync,
	realpathSync,
} from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	assertStableFileSnapshot,
	readStableRegularFile,
	StableFileReadError,
} from "./stable-file-read.mjs";

export const CANONICAL_CORPUS_RELATIVE_ROOT =
	"plugins/litcodex/skills/frontend-ui-ux/references/_canonical-corpus";

const EXPECTED = Object.freeze({
	commit: "8ec16c5129df7b9778959e8367657d0e79c2c3bb",
	tree: "9188410be0af35f2421ba300d91a0d7a7341caf0",
	fileCount: 167,
	totalBytes: 2_596_349,
	aggregateSha256: "f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7",
	manifestSha256: "0d5a6df21da1abecd3830a1127e2a447fa10461226ec65b448096729f2b5977e",
	provenanceSha256: "f22a6dc1bebfd8667c6641506d802ef9579632b77d319a158abc9eaba8cdb25d",
	roots: ["design", "designpowers", "perfection", "ui-ux-db"],
	legal: {
		LICENSE: { size: 1_068, sha256: "b083425948376611de9b92b0aeb7377e604505756ea427e541a34d9b030d4dc1" },
		"ATTRIBUTION.md": {
			size: 12_075,
			sha256: "a73cd147a533442218a9adef53d99e0eaf15c10d8db4819d9d1542727f077b92",
		},
		"LICENSE-Apache-2.0.txt": {
			size: 11_296,
			sha256: "9d95806a26532623360eb84bb17d298f394b55ef73fb4c0796d99b4319b2b0da",
		},
	},
});

const ROOT_KEYS = Object.freeze([
	"aggregateFormat",
	"aggregateSha256",
	"fileCount",
	"files",
	"legalFiles",
	"roots",
	"schemaVersion",
	"sourceCommit",
	"sourceTree",
	"totalBytes",
]);
const RECORD_KEYS = Object.freeze(["path", "sha256", "size"]);
const DEFAULT_FS = Object.freeze({
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readdirSync,
	readSync,
	realpathSync,
});
const MAX_CANONICAL_FILE_BYTES = 8 * 1024 * 1024;

export class CanonicalCorpusError extends Error {
	constructor(code, message) {
		super(`${code}: ${message}`);
		this.name = "CanonicalCorpusError";
		this.code = code;
	}
}

function fail(code, message) {
	throw new CanonicalCorpusError(code, message);
}

function missing(error) {
	return error?.code === "ENOENT";
}

function openRoot(root, fs) {
	let stat;
	try {
		stat = fs.lstatSync(root);
	} catch (error) {
		fail(
			missing(error) ? "LITCODEX_CANONICAL_CORPUS_MISSING" : "LITCODEX_CANONICAL_CORPUS_UNREADABLE",
			missing(error) ? "canonical corpus root is missing" : "canonical corpus root is unreadable",
		);
	}
	if (stat.isSymbolicLink()) fail("LITCODEX_CANONICAL_CORPUS_SYMLINK", "canonical corpus root is a link");
	if (!stat.isDirectory()) fail("LITCODEX_CANONICAL_CORPUS_SPECIAL", "canonical corpus root is not a directory");
	let canonical;
	try {
		canonical = fs.realpathSync(root);
	} catch {
		fail("LITCODEX_CANONICAL_CORPUS_UNREADABLE", "canonical corpus root cannot be resolved");
	}
	return { canonical, dev: stat.dev, ino: stat.ino };
}

function assertRootStable(root, opened, fs) {
	let stat;
	let canonical;
	try {
		stat = fs.lstatSync(root);
		canonical = fs.realpathSync(root);
	} catch {
		fail("LITCODEX_CANONICAL_CORPUS_ROOT_CHANGED", "canonical corpus root changed during verification");
	}
	if (
		stat.isSymbolicLink() ||
		!stat.isDirectory() ||
		stat.dev !== opened.dev ||
		stat.ino !== opened.ino ||
		canonical !== opened.canonical
	) {
		fail("LITCODEX_CANONICAL_CORPUS_ROOT_CHANGED", "canonical corpus root changed during verification");
	}
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function sameArray(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactKeys(value, expected, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_SCHEMA", `${label} must be an object`);
	}
	const actual = Object.keys(value).sort();
	if (!sameArray(actual, [...expected].sort())) {
		fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_SCHEMA", `${label} fields are not exact`);
	}
}

function canonicalRelativePath(path, roots) {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.includes("\0") ||
		path.includes("\\") ||
		posix.isAbsolute(path) ||
		posix.normalize(path) !== path ||
		!roots.some((root) => path.startsWith(`${root}/`))
	) {
		fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_PATH", "manifest contains a noncanonical content path");
	}
	return path;
}

function stableReadError(relativePath, error) {
	const code = error instanceof StableFileReadError ? error.code : "UNREADABLE";
	if (code === "MISSING") fail("LITCODEX_CANONICAL_CORPUS_MISSING", `missing declared file: ${relativePath}`);
	if (code === "SYMLINK") fail("LITCODEX_CANONICAL_CORPUS_SYMLINK", `symbolic link rejected: ${relativePath}`);
	if (code === "SPECIAL") fail("LITCODEX_CANONICAL_CORPUS_SPECIAL", `non-regular file rejected: ${relativePath}`);
	if (code === "PATH_ESCAPE") fail("LITCODEX_CANONICAL_CORPUS_ESCAPE", `declared file escapes corpus root: ${relativePath}`);
	if (code === "ANCESTOR_INVALID" || code === "ANCESTOR_CHANGED") {
		fail("LITCODEX_CANONICAL_CORPUS_ANCESTOR_CHANGED", `ancestor changed during read: ${relativePath}`);
	}
	if (code === "FILE_CHANGED") {
		fail("LITCODEX_CANONICAL_CORPUS_FILE_CHANGED", `declared file changed during read: ${relativePath}`);
	}
	if (code === "TOO_LARGE") fail("LITCODEX_CANONICAL_CORPUS_TOO_LARGE", `declared file exceeds read bound: ${relativePath}`);
	fail("LITCODEX_CANONICAL_CORPUS_UNREADABLE", `cannot read declared file: ${relativePath}`);
}

function safeReadFile(root, relativePath, fs, opened, captures, maxBytes = MAX_CANONICAL_FILE_BYTES) {
	assertRootStable(root, opened, fs);
	const candidate = join(root, relativePath);
	try {
		const capture = readStableRegularFile(root, candidate, maxBytes, fs);
		assertRootStable(root, opened, fs);
		captures.set(relativePath, capture);
		return capture.bytes;
	} catch (error) {
		if (error instanceof CanonicalCorpusError) throw error;
		stableReadError(relativePath, error);
	}
}

function enumerate(root, fs, opened) {
	const paths = [];
	const pending = [""];
	while (pending.length > 0) {
		const directory = pending.pop() ?? "";
		let entries;
		try {
			assertRootStable(root, opened, fs);
			entries = fs.readdirSync(join(root, directory));
		} catch {
			fail("LITCODEX_CANONICAL_CORPUS_UNREADABLE", `cannot enumerate corpus directory: ${directory || "."}`);
		}
		for (const name of entries) {
			const path = directory === "" ? name : `${directory}/${name}`;
			let stat;
			try {
				stat = fs.lstatSync(join(root, path));
			} catch {
				fail("LITCODEX_CANONICAL_CORPUS_UNREADABLE", `cannot inspect corpus entry: ${path}`);
			}
			if (stat.isSymbolicLink()) fail("LITCODEX_CANONICAL_CORPUS_SYMLINK", `symbolic link rejected: ${path}`);
			if (stat.isDirectory()) pending.push(path);
			else if (stat.isFile()) paths.push(path);
			else fail("LITCODEX_CANONICAL_CORPUS_SPECIAL", `special file rejected: ${path}`);
		}
	}
	return paths.sort();
}

function parseManifest(root, fs, opened, captures) {
	const bytes = safeReadFile(root, "MANIFEST.json", fs, opened, captures);
	if (sha256(bytes) !== EXPECTED.manifestSha256) {
		fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_TAMPER", "manifest bytes do not match the pinned digest");
	}
	let manifest;
	try {
		manifest = JSON.parse(bytes.toString("utf8"));
	} catch {
		fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_JSON", "manifest is not valid JSON");
	}
	exactKeys(manifest, ROOT_KEYS, "manifest");
	if (
		manifest.schemaVersion !== 1 ||
		manifest.sourceCommit !== EXPECTED.commit ||
		manifest.sourceTree !== EXPECTED.tree ||
		manifest.fileCount !== EXPECTED.fileCount ||
		manifest.totalBytes !== EXPECTED.totalBytes ||
		manifest.aggregateSha256 !== EXPECTED.aggregateSha256 ||
		manifest.aggregateFormat !== "sha256(<sorted sha256><two spaces><path><LF>)" ||
		!Array.isArray(manifest.roots) ||
		!sameArray(manifest.roots, EXPECTED.roots) ||
		!Array.isArray(manifest.legalFiles) ||
		!Array.isArray(manifest.files)
	) {
		fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_SCHEMA", "manifest authority fields do not match the pin");
	}
	return manifest;
}

function validateRecords(records, expectedCount, roots, label) {
	if (records.length !== expectedCount) {
		fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_SCHEMA", `${label} record count does not match`);
	}
	let previous = "";
	const seen = new Set();
	for (const record of records) {
		exactKeys(record, RECORD_KEYS, `${label} record`);
		const path = label === "content" ? canonicalRelativePath(record.path, roots) : record.path;
		if (typeof path !== "string" || typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 0) {
			fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_SCHEMA", `${label} record values are invalid`);
		}
		if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) {
			fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_SCHEMA", `${label} digest is invalid`);
		}
		if (path <= previous || seen.has(path)) {
			fail("LITCODEX_CANONICAL_CORPUS_MANIFEST_ORDER", `${label} paths must be unique and sorted`);
		}
		previous = path;
		seen.add(path);
	}
}

export function verifyCanonicalCorpus(root, fs = DEFAULT_FS) {
	const opened = openRoot(root, fs);
	const captures = new Map();
	const manifest = parseManifest(root, fs, opened, captures);
	validateRecords(manifest.files, EXPECTED.fileCount, EXPECTED.roots, "content");
	validateRecords(manifest.legalFiles, 3, EXPECTED.roots, "legal");
	const expectedLegalPaths = Object.keys(EXPECTED.legal).sort();
	if (!sameArray(manifest.legalFiles.map((record) => record.path), expectedLegalPaths)) {
		fail("LITCODEX_CANONICAL_CORPUS_LEGAL", "legal manifest paths do not match");
	}

	const contentPaths = manifest.files.map((record) => record.path);
	const expectedAllPaths = [...contentPaths, ...expectedLegalPaths, "MANIFEST.json", "PROVENANCE.md"].sort();
	const actualPaths = enumerate(root, fs, opened);
	if (!sameArray(actualPaths, expectedAllPaths)) {
		fail("LITCODEX_CANONICAL_CORPUS_FILE_SET", "canonical corpus has missing or extra paths");
	}

	let totalBytes = 0;
	const aggregateRecords = [];
	for (const record of manifest.files) {
		const bytes = safeReadFile(root, record.path, fs, opened, captures, record.size);
		const digest = sha256(bytes);
		if (bytes.byteLength !== record.size || digest !== record.sha256) {
			fail("LITCODEX_CANONICAL_CORPUS_CHANGED", `content does not match manifest: ${record.path}`);
		}
		totalBytes += bytes.byteLength;
		aggregateRecords.push(`${digest}  ${record.path}\n`);
	}
	if (totalBytes !== EXPECTED.totalBytes || sha256(aggregateRecords.join("")) !== EXPECTED.aggregateSha256) {
		fail("LITCODEX_CANONICAL_CORPUS_AGGREGATE", "content aggregate does not match the pinned authority");
	}

	for (const record of manifest.legalFiles) {
		const expected = EXPECTED.legal[record.path];
		const bytes = safeReadFile(root, record.path, fs, opened, captures, record.size);
		if (
			expected === undefined ||
			record.size !== expected.size ||
			record.sha256 !== expected.sha256 ||
			bytes.byteLength !== expected.size ||
			sha256(bytes) !== expected.sha256
		) {
			fail("LITCODEX_CANONICAL_CORPUS_LEGAL", `legal file mismatch: ${record.path}`);
		}
	}
	if (sha256(safeReadFile(root, "PROVENANCE.md", fs, opened, captures)) !== EXPECTED.provenanceSha256) {
		fail("LITCODEX_CANONICAL_CORPUS_PROVENANCE", "provenance bytes do not match the pinned digest");
	}
	assertRootStable(root, opened, fs);

	const report = {
		ok: true,
		fileCount: EXPECTED.fileCount,
		totalBytes: EXPECTED.totalBytes,
		aggregateSha256: EXPECTED.aggregateSha256,
		protectedRelativePaths: [...contentPaths, ...expectedLegalPaths],
	};
	Object.defineProperty(report, "verifiedFiles", { value: captures, enumerable: false });
	return report;
}

export function assertCanonicalCorpusSnapshotStable(report, fs = DEFAULT_FS) {
	if (!(report?.verifiedFiles instanceof Map)) {
		fail("LITCODEX_CANONICAL_CORPUS_UNSTABLE", "canonical corpus byte snapshot is unavailable");
	}
	try {
		for (const capture of report.verifiedFiles.values()) assertStableFileSnapshot(capture.snapshot, fs);
	} catch {
		fail("LITCODEX_CANONICAL_CORPUS_UNSTABLE", "canonical corpus changed after byte capture");
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	const root = process.argv[2] ?? fileURLToPath(new URL("../references/_canonical-corpus/", import.meta.url));
	try {
		process.stdout.write(`${JSON.stringify(verifyCanonicalCorpus(root))}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
