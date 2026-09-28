import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs";

const skillRoot = fileURLToPath(new URL("./", import.meta.url));
const sourceCorpusRoot = `${skillRoot}references/_canonical-corpus`;
const verifierPath = `${skillRoot}scripts/verify-canonical-corpus.mjs`;
const sandboxes: string[] = [];

async function verifier() {
	expect(existsSync(verifierPath), "canonical corpus verifier must exist").toBe(true);
	if (!existsSync(verifierPath)) return undefined;
	return import("./scripts/verify-canonical-corpus.mjs");
}

function sandboxCorpus(): string {
	const sandbox = mkdtempSync(join(tmpdir(), "litcodex-canonical-corpus-"));
	sandboxes.push(sandbox);
	const root = join(sandbox, "corpus");
	cpSync(sourceCorpusRoot, root, { recursive: true, preserveTimestamps: true });
	return root;
}

afterEach(() => {
	for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { force: true, recursive: true });
});

describe("canonical frontend corpus verifier", () => {
	it("accepts only the pinned path/size/hash/legal closure", async () => {
		const module = await verifier();
		if (!module) return;
		expect(module.verifyCanonicalCorpus(sourceCorpusRoot)).toMatchObject({
			ok: true,
			fileCount: 167,
			totalBytes: 2_596_349,
			aggregateSha256: "f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7",
		});
	});

	it.each([
		["missing", (root: string) => rmSync(join(root, "design/apple.md"))],
		["extra", (root: string) => writeFileSync(join(root, "design/extra.md"), "extra")],
		["changed", (root: string) => writeFileSync(join(root, "design/apple.md"), "changed")],
		["legal mismatch", (root: string) => writeFileSync(join(root, "ATTRIBUTION.md"), "changed")],
		[
			"manifest tamper",
			(root: string) => {
				const manifest = JSON.parse(readFileSync(join(root, "MANIFEST.json"), "utf8"));
				manifest.carrier = "untrusted carrier";
				writeFileSync(join(root, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
			},
		],
		[
			"symlink",
			(root: string) => {
				rmSync(join(root, "design/apple.md"));
				symlinkSync(join(root, "LICENSE"), join(root, "design/apple.md"));
			},
		],
		[
			"special entry",
			(root: string) => {
				rmSync(join(root, "design/apple.md"));
				mkdirSync(join(root, "design/apple.md"));
			},
		],
	] as const)("fails closed for %s", async (_label, mutate) => {
		const module = await verifier();
		if (!module) return;
		const root = sandboxCorpus();
		mutate(root);
		expect(() => module.verifyCanonicalCorpus(root)).toThrowError(/LITCODEX_CANONICAL_CORPUS_/);
	});

	it("fails closed when a declared file cannot be read", async () => {
		const module = await verifier();
		if (!module) return;
		const root = sandboxCorpus();
		const target = join(root, "design/apple.md");
		chmodSync(target, 0o000);
		try {
			expect(() => module.verifyCanonicalCorpus(root)).toThrowError(/LITCODEX_CANONICAL_CORPUS_/);
		} finally {
			chmodSync(target, 0o644);
		}
	});

	it.each([
		[
			"root lstat permission failure",
			(root: string) => ({
				...nodeFs,
				lstatSync: (path: nodeFs.PathLike) => {
					if (path === root) throw Object.assign(new Error("denied"), { code: "EACCES" });
					return nodeFs.lstatSync(path);
				},
			}),
			"LITCODEX_CANONICAL_CORPUS_UNREADABLE",
		],
		[
			"root realpath failure",
			(root: string) => ({
				...nodeFs,
				realpathSync: (path: nodeFs.PathLike) => {
					if (path === root) throw Object.assign(new Error("gone"), { code: "ENOENT" });
					return nodeFs.realpathSync(path);
				},
			}),
			"LITCODEX_CANONICAL_CORPUS_UNREADABLE",
		],
		[
			"entry disappearance during enumeration",
			(root: string) => ({
				...nodeFs,
				lstatSync: (path: nodeFs.PathLike) => {
					if (String(path).endsWith("/design/apple.md")) throw Object.assign(new Error("gone"), { code: "ENOENT" });
					return nodeFs.lstatSync(path);
				},
			}),
			"LITCODEX_CANONICAL_CORPUS_UNREADABLE",
		],
		[
			"read permission failure",
			(_root: string) => ({
				...nodeFs,
				openSync: (path: nodeFs.PathLike, flags: nodeFs.OpenMode) => {
					if (String(path).endsWith("/MANIFEST.json")) throw Object.assign(new Error("denied"), { code: "EACCES" });
					return nodeFs.openSync(path, flags);
				},
			}),
			"LITCODEX_CANONICAL_CORPUS_UNREADABLE",
		],
	] as const)("normalizes %s into CanonicalCorpusError", async (_label, makeFs, expectedCode) => {
		const module = await verifier();
		if (!module) return;
		const root = sandboxCorpus();
		expect(() => module.verifyCanonicalCorpus(root, makeFs(root))).toThrowError(
			expect.objectContaining({ name: "CanonicalCorpusError", code: expectedCode }),
		);
	});

	it("detects a root identity swap as a typed verifier error", async () => {
		const module = await verifier();
		if (!module) return;
		const root = sandboxCorpus();
		let rootStats = 0;
		const fs = {
			...nodeFs,
			lstatSync: (path: nodeFs.PathLike) => {
				const stat = nodeFs.lstatSync(path);
				if (path !== root || rootStats++ === 0) return stat;
				return new Proxy(stat, { get: (target, property) => (property === "ino" ? target.ino + 1 : target[property]) });
			},
		};
		expect(() => module.verifyCanonicalCorpus(root, fs)).toThrowError(
			expect.objectContaining({ name: "CanonicalCorpusError", code: "LITCODEX_CANONICAL_CORPUS_ROOT_CHANGED" }),
		);
	});

	it("rejects a final-file substitution after verified bytes are captured", async () => {
		const module = await verifier();
		if (!module) return;
		const root = sandboxCorpus();
		const target = join(root, "design/apple.md");
		const displaced = join(root, "design/apple.original");
		let substituted = false;
		let targetDescriptor: number | undefined;
		const fs = {
			...nodeFs,
			openSync: (path: nodeFs.PathLike, flags: nodeFs.OpenMode) => {
				const descriptor = nodeFs.openSync(path, flags);
				if (path === target) targetDescriptor = descriptor;
				return descriptor;
			},
			readSync: (...args: Parameters<typeof nodeFs.readSync>) => {
				const count = nodeFs.readSync(...args);
				if (args[0] === targetDescriptor && count > 0 && !substituted) {
					substituted = true;
					renameSync(target, displaced);
					writeFileSync(target, "substituted after capture\n");
				}
				return count;
			},
		};

		expect(() => module.verifyCanonicalCorpus(root, fs)).toThrowError(
			expect.objectContaining({ name: "CanonicalCorpusError", code: "LITCODEX_CANONICAL_CORPUS_FILE_CHANGED" }),
		);
		expect(substituted).toBe(true);
	});

	it("rejects an ancestor substitution after verified bytes are captured", async () => {
		const module = await verifier();
		if (!module) return;
		const root = sandboxCorpus();
		const target = join(root, "design/apple.md");
		const ancestor = join(root, "design");
		const displaced = join(root, "design-original");
		let substituted = false;
		let targetDescriptor: number | undefined;
		const fs = {
			...nodeFs,
			openSync: (path: nodeFs.PathLike, flags: nodeFs.OpenMode) => {
				const descriptor = nodeFs.openSync(path, flags);
				if (path === target) targetDescriptor = descriptor;
				return descriptor;
			},
			readSync: (...args: Parameters<typeof nodeFs.readSync>) => {
				const count = nodeFs.readSync(...args);
				if (args[0] === targetDescriptor && count > 0 && !substituted) {
					substituted = true;
					renameSync(ancestor, displaced);
					cpSync(displaced, ancestor, { recursive: true, preserveTimestamps: true });
				}
				return count;
			},
		};

		expect(() => module.verifyCanonicalCorpus(root, fs)).toThrowError(
			expect.objectContaining({ name: "CanonicalCorpusError", code: "LITCODEX_CANONICAL_CORPUS_ANCESTOR_CHANGED" }),
		);
		expect(substituted).toBe(true);
	});
});
