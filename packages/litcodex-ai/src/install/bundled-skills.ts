import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	HANDOFF_SOURCE_HASHES,
	SCIENTIFIC_VISUALIZATION_SOURCE_HASHES,
	SCIENTIFIC_VISUALIZATION_SOURCE_MANIFEST,
} from "./bundled-skill-manifests.js";
import type { ReadonlyFsLike } from "./codex.js";

const HANDOFF_FILES = ["SKILL.md"] as const;

const SCIENTIFIC_VISUALIZATION_FILES = ["SKILL.md", "scripts/dependency-preflight.py"] as const;

const VENDOR_LEGAL_FILES = [
	"NOTICE",
	"licenses/022_handoff-MIT.txt",
	"licenses/045_scientific-visualization-MIT.txt",
	"provenance/022_handoff.md",
	"provenance/045_scientific-visualization.md",
] as const;

export interface BundledSkillReport {
	readonly handoffInstalled: boolean;
	readonly scientificVisualizationInstalled: boolean;
}

export function probeBundledSkills(fs: ReadonlyFsLike, marketplaceRoot: string): BundledSkillReport {
	const pluginRoot = join(marketplaceRoot, "plugins", "litcodex");
	const skillsRoot = join(pluginRoot, "skills");
	const vendorRoot = join(pluginRoot, "vendor");
	const handoffRoot = join(skillsRoot, "lit-handoff");
	const scientificVisualizationRoot = join(skillsRoot, "lit-scientific-visualization");
	const vendorComplete = payloadComplete(fs, vendorRoot, VENDOR_LEGAL_FILES);
	return {
		handoffInstalled:
			vendorComplete &&
			payloadComplete(fs, handoffRoot, HANDOFF_FILES) &&
			payloadExact(fs, join(vendorRoot, "handoff"), HANDOFF_SOURCE_HASHES),
		scientificVisualizationInstalled:
			vendorComplete &&
			payloadComplete(fs, scientificVisualizationRoot, SCIENTIFIC_VISUALIZATION_FILES) &&
			payloadExact(
				fs,
				join(vendorRoot, "scientific-visualization"),
				SCIENTIFIC_VISUALIZATION_SOURCE_HASHES,
				SCIENTIFIC_VISUALIZATION_SOURCE_MANIFEST,
				"045_scientific-visualization",
			),
	};
}

function payloadComplete(fs: ReadonlyFsLike, root: string, files: readonly string[]): boolean {
	return files.every((path) => fs.existsSync(join(root, path)));
}

export function payloadExact(
	fs: Pick<ReadonlyFsLike, "listFilesRecursive" | "readFileBufferSync">,
	root: string,
	expectedHashes: Readonly<Record<string, string>>,
	expectedManifest?: string,
	manifestPrefix?: string,
): boolean {
	const listFilesRecursive = fs.listFilesRecursive;
	const readFileBufferSync = fs.readFileBufferSync;
	if (listFilesRecursive === undefined || readFileBufferSync === undefined) return false;
	try {
		const expectedPaths = Object.keys(expectedHashes).sort();
		const actualEntries = [...listFilesRecursive(root)].map((entry) =>
			typeof entry === "string"
				? { relativePath: normalizeRelativePath(entry), kind: "file" as const }
				: { relativePath: normalizeRelativePath(entry.relativePath), kind: entry.kind },
		);
		if (actualEntries.some((entry) => entry.kind !== "file")) return false;
		const actualPaths = actualEntries.map((entry) => entry.relativePath).sort();
		if (!samePaths(actualPaths, expectedPaths)) return false;
		const records: string[] = [];
		for (const path of expectedPaths) {
			const digest = sha256(readFileBufferSync(join(root, path)));
			if (digest !== expectedHashes[path]) return false;
			records.push(`${digest}  ${manifestPrefix}/${path}\n`);
		}
		return expectedManifest === undefined || sha256(records.join("")) === expectedManifest;
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

function normalizeRelativePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function samePaths(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((path, index) => path === expected[index]);
}

function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}
