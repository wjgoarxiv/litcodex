import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexBin, codexHome, doctorDeps, sentinelPath } from "../../test/install-doctor-fixtures.js";
import { runDoctor } from "./doctor.js";
import {
	listPayloadEntries,
	type PayloadDirectoryCapability,
	type PayloadDirectoryReader,
	readRegularFileBuffer,
} from "./file-walk.js";
import { REPO_ROOT } from "./install-test-helpers.js";
import {
	BROWSER_DRIVE_PAYLOAD_HASHES,
	FRONTEND_UIUX_PAYLOAD_HASHES,
	README_STUDIO_PAYLOAD_HASHES,
	VISUAL_QA_PAYLOAD_HASHES,
} from "./skill-resource-hashes.js";

const tempRoots: string[] = [];
const managedSkills = join(codexHome, "marketplaces/litcodex/plugins/litcodex/skills");
const windowsStablePathCapability: PayloadDirectoryCapability = "windows-stable-path";

afterEach(() => {
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function copyExpectedSkill(
	sandbox: string,
	skillId: "browser-drive" | "frontend-ui-ux" | "readme-studio" | "visual-qa",
	hashes: Readonly<Record<string, string>>,
): string {
	const source = join(REPO_ROOT, "plugins/litcodex/skills", skillId);
	const target = join(sandbox, skillId);
	for (const relativePath of Object.keys(hashes)) {
		const destination = join(target, relativePath);
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(join(source, relativePath), destination);
	}
	return target;
}

function realUiDoctor(
	visualDirectoryReader?: PayloadDirectoryReader,
	directoryCapability?: PayloadDirectoryCapability,
) {
	const sandbox = mkdtempSync(join(tmpdir(), "litcodex-doctor-real-fs-"));
	tempRoots.push(sandbox);
	const actualRoots = new Map([
		[
			join(managedSkills, "frontend-ui-ux"),
			copyExpectedSkill(sandbox, "frontend-ui-ux", FRONTEND_UIUX_PAYLOAD_HASHES),
		],
		[join(managedSkills, "readme-studio"), copyExpectedSkill(sandbox, "readme-studio", README_STUDIO_PAYLOAD_HASHES)],
		[join(managedSkills, "browser-drive"), copyExpectedSkill(sandbox, "browser-drive", BROWSER_DRIVE_PAYLOAD_HASHES)],
		[join(managedSkills, "visual-qa"), copyExpectedSkill(sandbox, "visual-qa", VISUAL_QA_PAYLOAD_HASHES)],
	]);
	const base = doctorDeps([codexBin, sentinelPath]);
	const listFilesRecursive = base.fs.listFilesRecursive;
	const readFileBufferSync = base.fs.readFileBufferSync;
	return {
		actualRoots,
		run: () =>
			runDoctor({
				...base,
				fs: {
					...base.fs,
					listFilesRecursive: (root) => {
						const actual = actualRoots.get(root);
						return actual === undefined
							? (listFilesRecursive?.(root) ?? [])
							: listPayloadEntries(
									actual,
									actual.endsWith("/visual-qa") ? visualDirectoryReader : undefined,
									directoryCapability,
								);
					},
					readFileBufferSync: (path) => {
						for (const [managed, actual] of actualRoots) {
							if (path.startsWith(`${managed}/`))
								return readRegularFileBuffer(join(actual, path.slice(managed.length + 1)));
						}
						if (readFileBufferSync === undefined) throw new Error(`unexpected binary read: ${path}`);
						return readFileBufferSync(path);
					},
				},
			}),
	};
}

describe("doctor — real filesystem UI skill payloads", () => {
	it("accepts exact regular files and rejects outside and broken symlinks", () => {
		const healthy = realUiDoctor();
		const report = healthy.run();
		expect(report.skillCatalogComplete, JSON.stringify(report, null, 2)).toBe(true);

		const visualRoot = healthy.actualRoots.get(join(managedSkills, "visual-qa"));
		expect(visualRoot).toBeDefined();
		if (visualRoot === undefined) return;
		const outside = join(dirname(visualRoot), "outside.txt");
		writeFileSync(outside, "sentinel");
		symlinkSync(outside, join(visualRoot, "scripts/outside-link"));
		expect(healthy.run().skillCatalogComplete).toBe(false);
		expect(readFileSync(outside, "utf8")).toBe("sentinel");

		rmSync(join(visualRoot, "scripts/outside-link"));
		symlinkSync(join(visualRoot, "missing-target"), join(visualRoot, "scripts/broken-link"));
		expect(healthy.run().skillCatalogComplete).toBe(false);
	});

	it("rejects an expected payload file replaced by a same-byte symlink", () => {
		const fixture = realUiDoctor();
		const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
		expect(visualRoot).toBeDefined();
		if (visualRoot === undefined) return;
		const expectedPath = join(visualRoot, "scripts/cli.mjs");
		const outside = join(dirname(visualRoot), "same-byte-cli.mjs");
		writeFileSync(outside, readFileSync(expectedPath));
		rmSync(expectedPath);
		symlinkSync(outside, expectedPath);

		expect(fixture.run().skillCatalogComplete).toBe(false);
	});

	it("rejects an expected skill root replaced by a same-byte directory symlink", () => {
		const fixture = realUiDoctor();
		const managedRoot = join(managedSkills, "visual-qa");
		const visualRoot = fixture.actualRoots.get(managedRoot);
		expect(visualRoot).toBeDefined();
		if (visualRoot === undefined) return;
		const outside = join(dirname(visualRoot), "same-byte-visual-root");
		renameSync(visualRoot, outside);
		symlinkSync(outside, visualRoot, "dir");

		expect(fixture.run().skillCatalogComplete).toBe(false);
	});

	it.runIf(process.platform !== "win32")(
		"cannot hide an unexpected file with a traversed-directory swap and restore",
		() => {
			let scriptsRoot = "";
			let cleanScripts = "";
			let parkedScripts = "";
			let attacked = false;
			const fixture = realUiDoctor((directory, lexicalPath) => {
				if (!attacked && lexicalPath === scriptsRoot) {
					attacked = true;
					renameSync(scriptsRoot, parkedScripts);
					renameSync(cleanScripts, scriptsRoot);
					writeFileSync(join(parkedScripts, "unexpected-at-verdict.mjs"), "unexpected");
					const entries = [];
					for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
					renameSync(scriptsRoot, cleanScripts);
					renameSync(parkedScripts, scriptsRoot);
					return entries;
				}
				const entries = [];
				for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
				return entries;
			});
			const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
			expect(visualRoot).toBeDefined();
			if (visualRoot === undefined) return;
			scriptsRoot = join(visualRoot, "scripts");
			cleanScripts = join(dirname(visualRoot), "clean-scripts");
			parkedScripts = join(dirname(visualRoot), "parked-scripts");
			cpSync(scriptsRoot, cleanScripts, { recursive: true });

			expect(fixture.run().skillCatalogComplete).toBe(false);
			expect(attacked).toBe(true);
			expect(readFileSync(join(scriptsRoot, "unexpected-at-verdict.mjs"), "utf8")).toBe("unexpected");
		},
	);

	it.runIf(process.platform !== "win32")(
		"detects an unexpected file appended after descriptor enumeration reaches EOF",
		() => {
			let scriptsRoot = "";
			let attacked = false;
			const fixture = realUiDoctor((directory, lexicalPath) => {
				const entries = [];
				for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
				if (!attacked && lexicalPath === scriptsRoot) {
					attacked = true;
					writeFileSync(join(scriptsRoot, "unexpected-after-eof.mjs"), "unexpected");
				}
				return entries;
			});
			const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
			expect(visualRoot).toBeDefined();
			if (visualRoot === undefined) return;
			scriptsRoot = join(visualRoot, "scripts");

			expect(fixture.run().skillCatalogComplete).toBe(false);
			expect(attacked).toBe(true);
			expect(readFileSync(join(scriptsRoot, "unexpected-after-eof.mjs"), "utf8")).toBe("unexpected");
		},
	);

	it("treats an installed test file as an orphaned managed-payload mutation", () => {
		const fixture = realUiDoctor();
		const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
		expect(visualRoot).toBeDefined();
		if (visualRoot === undefined) return;
		const tests = join(visualRoot, "tests");
		mkdirSync(tests);
		writeFileSync(join(tests, "orphan.test.ts"), "orphan");
		expect(fixture.run().skillCatalogComplete).toBe(false);
	});

	it.runIf(process.platform !== "win32")("rejects a FIFO special entry", () => {
		const fixture = realUiDoctor();
		const frontendRoot = fixture.actualRoots.get(join(managedSkills, "frontend-ui-ux"));
		expect(frontendRoot).toBeDefined();
		if (frontendRoot === undefined) return;
		const fifo = join(frontendRoot, "scripts/unexpected-fifo");
		const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
		expect(created.status, created.stderr).toBe(0);
		expect(fixture.run().skillCatalogComplete).toBe(false);
	});

	describe("Windows-compatible stable-path capability", () => {
		it("accepts a healthy payload using two exact handle-bound enumerations", () => {
			const reads = new Map<string, number>();
			const fixture = realUiDoctor((directory, lexicalPath) => {
				reads.set(lexicalPath, (reads.get(lexicalPath) ?? 0) + 1);
				const entries = [];
				for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
				return entries;
			}, windowsStablePathCapability);

			expect(fixture.run().skillCatalogComplete).toBe(true);
			expect(reads.size).toBeGreaterThan(0);
			expect([...reads.values()].every((count) => count === 2)).toBe(true);
		});

		it("rejects a symlinked skill root", () => {
			const fixture = realUiDoctor(undefined, windowsStablePathCapability);
			const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
			expect(visualRoot).toBeDefined();
			if (visualRoot === undefined) return;
			const outside = join(dirname(visualRoot), "windows-same-byte-root");
			renameSync(visualRoot, outside);
			symlinkSync(outside, visualRoot, "dir");

			expect(fixture.run().skillCatalogComplete).toBe(false);
		});

		it("rejects a same-byte leaf symlink", () => {
			const fixture = realUiDoctor(undefined, windowsStablePathCapability);
			const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
			expect(visualRoot).toBeDefined();
			if (visualRoot === undefined) return;
			const expectedPath = join(visualRoot, "scripts/cli.mjs");
			const outside = join(dirname(visualRoot), "windows-same-byte-cli.mjs");
			writeFileSync(outside, readFileSync(expectedPath));
			rmSync(expectedPath);
			symlinkSync(outside, expectedPath);

			expect(fixture.run().skillCatalogComplete).toBe(false);
		});

		it("rejects a traversed-directory swap and restore", () => {
			let scriptsRoot = "";
			let cleanScripts = "";
			let parkedScripts = "";
			let attacked = false;
			const fixture = realUiDoctor((directory, lexicalPath) => {
				if (!attacked && lexicalPath === scriptsRoot) {
					attacked = true;
					renameSync(scriptsRoot, parkedScripts);
					renameSync(cleanScripts, scriptsRoot);
					writeFileSync(join(parkedScripts, "unexpected-windows-swap.mjs"), "unexpected");
					const entries = [];
					for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
					renameSync(scriptsRoot, cleanScripts);
					renameSync(parkedScripts, scriptsRoot);
					return entries;
				}
				const entries = [];
				for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
				return entries;
			}, windowsStablePathCapability);
			const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
			expect(visualRoot).toBeDefined();
			if (visualRoot === undefined) return;
			scriptsRoot = join(visualRoot, "scripts");
			cleanScripts = join(dirname(visualRoot), "windows-clean-scripts");
			parkedScripts = join(dirname(visualRoot), "windows-parked-scripts");
			cpSync(scriptsRoot, cleanScripts, { recursive: true });

			expect(fixture.run().skillCatalogComplete).toBe(false);
			expect(attacked).toBe(true);
		});

		it("rejects an append after the first enumeration reaches EOF", () => {
			let scriptsRoot = "";
			let attacked = false;
			const fixture = realUiDoctor((directory, lexicalPath) => {
				const entries = [];
				for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
				if (!attacked && lexicalPath === scriptsRoot) {
					attacked = true;
					writeFileSync(join(scriptsRoot, "unexpected-windows-after-eof.mjs"), "unexpected");
				}
				return entries;
			}, windowsStablePathCapability);
			const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
			expect(visualRoot).toBeDefined();
			if (visualRoot === undefined) return;
			scriptsRoot = join(visualRoot, "scripts");

			expect(fixture.run().skillCatalogComplete).toBe(false);
			expect(attacked).toBe(true);
		});

		it("rejects directory metadata mutation after enumeration", () => {
			let scriptsRoot = "";
			let attacked = false;
			const fixture = realUiDoctor((directory, lexicalPath) => {
				const entries = [];
				for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) entries.push(entry);
				if (!attacked && lexicalPath === scriptsRoot) {
					attacked = true;
					utimesSync(scriptsRoot, new Date(0), new Date(0));
				}
				return entries;
			}, windowsStablePathCapability);
			const visualRoot = fixture.actualRoots.get(join(managedSkills, "visual-qa"));
			expect(visualRoot).toBeDefined();
			if (visualRoot === undefined) return;
			scriptsRoot = join(visualRoot, "scripts");

			expect(fixture.run().skillCatalogComplete).toBe(false);
			expect(attacked).toBe(true);
		});
	});
});
