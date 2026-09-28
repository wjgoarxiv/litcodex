import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const skillsRoot = fileURLToPath(new URL("./skills/", import.meta.url));
const vendorRoot = fileURLToPath(new URL("./vendor/", import.meta.url));
const sandboxes: string[] = [];

function sandbox(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-next-safety-")));
	sandboxes.push(root);
	return root;
}

function python(script: string, args: string[], cwd: string) {
	return spawnSync("python3", [script, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
}

function filesUnder(root: string): string[] {
	const files: string[] = [];
	const pending = [""];
	while (pending.length > 0) {
		const relativeDirectory = pending.pop() ?? "";
		for (const entry of readdirSync(join(root, relativeDirectory))) {
			const relativePath = relativeDirectory === "" ? entry : `${relativeDirectory}/${entry}`;
			const stat = lstatSync(join(root, relativePath));
			if (stat.isDirectory()) pending.push(relativePath);
			else files.push(relativePath);
		}
	}
	return files.sort();
}

const researchScript = join(skillsRoot, "autoresearch/scripts/init_research.py");
const conferenceScript = join(skillsRoot, "autoconference/scripts/init_conference.py");
const researchArgs = ["--goal", "reduce latency", "--metric", "latency", "--direction", "minimize"];
const conferenceArgs = [
	"--goal",
	"compare approaches",
	"--mode",
	"qualitative",
	"--criteria",
	"evidence-backed comparison",
];

afterEach(() => {
	for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("safe installed scaffold output", () => {
	for (const [name, script, baseArgs, primaryLeaf] of [
		["autoresearch", researchScript, researchArgs, "research.md"],
		["autoconference", conferenceScript, conferenceArgs, "conference.md"],
	] as const) {
		it(`${name} rejects symlink output roots and parents without writing through them`, () => {
			const root = sandbox();
			const outsideRoot = join(root, "outside-root");
			const outsideParent = join(root, "outside-parent");
			mkdirSync(outsideRoot);
			mkdirSync(outsideParent);
			const linkedRoot = join(root, "linked-root");
			const linkedParent = join(root, "linked-parent");
			symlinkSync(outsideRoot, linkedRoot);
			symlinkSync(outsideParent, linkedParent);

			const rootResult = python(script, [...baseArgs, "--output", linkedRoot], root);
			expect(rootResult.status).toBe(1);
			expect(rootResult.stderr).toContain("UNSAFE_OUTPUT_SYMLINK");
			expect(readdirSync(outsideRoot)).toEqual([]);

			const parentResult = python(script, [...baseArgs, "--output", join(linkedParent, "run")], root);
			expect(parentResult.status).toBe(1);
			expect(parentResult.stderr).toContain("UNSAFE_OUTPUT_SYMLINK");
			expect(readdirSync(outsideParent)).toEqual([]);
		});

		it(`${name} rejects a swapped generated leaf and preserves its outside target`, () => {
			const root = sandbox();
			const output = join(root, "output");
			const outside = join(root, "outside.txt");
			mkdirSync(output);
			writeFileSync(outside, "outside-must-not-change\n");
			symlinkSync(outside, join(output, primaryLeaf));

			const result = python(script, [...baseArgs, "--output", output, "--force"], root);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("UNSAFE_GENERATED_LEAF");
			expect(readFileSync(outside, "utf8")).toBe("outside-must-not-change\n");
			expect(lstatSync(join(output, primaryLeaf)).isSymbolicLink()).toBe(true);
		});
	}

	it("--force removes stale run-owned artifacts while preserving unrelated files", () => {
		const root = sandbox();
		for (const [script, baseArgs, directory, staleLeaves] of [
			[
				researchScript,
				researchArgs,
				"research",
				["final_report.md", "autoresearch-run-state.json", ".autoresearch-loop.pid"],
			],
			[
				conferenceScript,
				conferenceArgs,
				"conference",
				["synthesis.md", "autoconference-run-state.json", ".autoconference-loop.pid"],
			],
		] as const) {
			const output = join(root, directory);
			mkdirSync(output);
			writeFileSync(join(output, "sentinel.txt"), "keep\n");
			for (const leaf of staleLeaves) writeFileSync(join(output, leaf), "stale\n");

			const result = python(script, [...baseArgs, "--output", output, "--force"], root);
			expect(result.status, result.stderr).toBe(0);
			expect(readFileSync(join(output, "sentinel.txt"), "utf8")).toBe("keep\n");
			for (const leaf of staleLeaves) expect(existsSync(join(output, leaf)), `${directory}/${leaf}`).toBe(false);
		}
	});

	it("strictly rejects zero, negative, NaN, and infinite budgets", () => {
		const root = sandbox();
		const cases = [
			[researchScript, [...researchArgs, "--max-iterations", "0"]],
			[researchScript, [...researchArgs, "--noise-runs", "0"]],
			[researchScript, [...researchArgs, "--min-delta", "-1"]],
			[researchScript, [...researchArgs, "--min-delta", "nan"]],
			[conferenceScript, [...conferenceArgs, "--iterations-per-round", "0"]],
			[conferenceScript, [...conferenceArgs, "--max-rounds", "0"]],
			[conferenceScript, [...conferenceArgs, "--noise-runs", "0"]],
			[conferenceScript, [...conferenceArgs, "--min-delta", "-1"]],
			[conferenceScript, [...conferenceArgs, "--min-delta", "inf"]],
		] as const;
		for (const [index, [script, args]] of cases.entries()) {
			const result = python(script, [...args, "--output", join(root, `case-${index}`)], root);
			expect(result.status, `${script}: ${args.join(" ")}`).toBe(1);
			expect(result.stderr).toContain("INVALID_BUDGET");
		}
	});

	it("rejects a parent symlink inserted between component inspection and creation", () => {
		const root = sandbox();
		const parent = join(root, "parent");
		const outside = join(root, "outside");
		mkdirSync(parent);
		mkdirSync(outside);
		const probe = `
import importlib.util
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("scaffold", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_mkdir = module.os.mkdir

def raced_mkdir(name, mode=0o777, *, dir_fd=None):
    if name == "run":
        os.symlink(sys.argv[3], name, dir_fd=dir_fd)
        raise FileExistsError(name)
    return original_mkdir(name, mode, dir_fd=dir_fd)

module.os.mkdir = raced_mkdir
module.open_safe_directory(Path(sys.argv[2]))
`;
		for (const script of [researchScript, conferenceScript]) {
			const target = join(parent, "run");
			const result = spawnSync("python3", ["-c", probe, script, target, outside], {
				cwd: root,
				encoding: "utf8",
				timeout: 30_000,
			});
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("UNSAFE_OUTPUT_SYMLINK");
			rmSync(target, { force: true });
			expect(readdirSync(outside)).toEqual([]);
		}
	});

	it("rejects a same-path directory replacement after child stat and before open", () => {
		const root = sandbox();
		const output = join(root, "output");
		mkdirSync(output);
		const probe = `
import importlib.util
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("scaffold", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original_open = module.os.open
swapped = False

def raced_open(name, flags, mode=0o777, *, dir_fd=None):
    global swapped
    if name == "output" and dir_fd is not None and not swapped:
        swapped = True
        os.rename(name, "output-original", src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        os.mkdir(name, 0o755, dir_fd=dir_fd)
    return original_open(name, flags, mode, dir_fd=dir_fd)

module.os.open = raced_open
try:
    module.open_safe_directory(Path(sys.argv[2]))
except SystemExit:
    raise
else:
    raise SystemExit(9)
`;
		for (const script of [researchScript, conferenceScript]) {
			const result = spawnSync("python3", ["-c", probe, script, output], {
				cwd: root,
				encoding: "utf8",
				timeout: 30_000,
			});
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("UNSAFE_OUTPUT_SWAP");
			expect(existsSync(join(root, "output-original"))).toBe(true);
			rmSync(output, { recursive: true, force: true });
			rmSync(join(root, "output-original"), { recursive: true, force: true });
			mkdirSync(output);
		}
	});

	it("cleans sensitive temporary leaves after partial write and fsync failures, including later --force", () => {
		const root = sandbox();
		const probe = `
import importlib.util
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("scaffold", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fd, canonical = module.open_safe_directory(Path(sys.argv[2]))
failure = sys.argv[3]
original_write = module.os.write
original_fsync = module.os.fsync
calls = 0

def partial_then_fail(target_fd, data):
    global calls
    calls += 1
    if calls == 1:
        return original_write(target_fd, data[:1])
    raise OSError("injected partial write failure")

def fail_fsync(target_fd):
    raise OSError("injected fsync failure")

if failure == "write":
    module.os.write = partial_then_fail
else:
    module.os.fsync = fail_fsync

try:
    module.write_new_leaf(fd, canonical, "probe.txt", "sensitive-value")
except OSError:
    pass
else:
    raise SystemExit(9)
finally:
    module.os.write = original_write
    module.os.fsync = original_fsync
    os.close(fd)

residue = [name for name in os.listdir(canonical) if ".tmp-" in name]
if residue:
    print("TEMP_RESIDUE", file=sys.stderr)
    raise SystemExit(8)
`;
		for (const [family, script, baseArgs] of [
			["autoresearch", researchScript, researchArgs],
			["autoconference", conferenceScript, conferenceArgs],
		] as const) {
			for (const failure of ["write", "fsync"]) {
				const output = join(root, `${family}-${failure}`);
				const failed = spawnSync("python3", ["-c", probe, script, output, failure], {
					cwd: root,
					encoding: "utf8",
					timeout: 30_000,
				});
				expect(failed.status, failed.stderr).toBe(0);
				expect(readdirSync(output).filter((name) => name.includes(".tmp-"))).toEqual([]);

				const forced = python(script, [...baseArgs, "--output", output, "--force"], root);
				expect(forced.status, forced.stderr).toBe(0);
				expect(readdirSync(output).filter((name) => name.includes(".tmp-"))).toEqual([]);
			}
		}
	});

	it("fails typed before mutation when required Python/POSIX descriptor capabilities are unavailable", () => {
		const root = sandbox();
		const probe = `
import importlib.util
import os
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("scaffold", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.os.supports_dir_fd = set()
sys.argv = [sys.argv[1], *sys.argv[3:]]
module.main()
`;
		for (const [index, [script, baseArgs]] of [
			[researchScript, researchArgs],
			[conferenceScript, conferenceArgs],
		].entries()) {
			const output = join(root, `unsupported-${index}`);
			const result = spawnSync("python3", ["-c", probe, script, output, ...baseArgs, "--output", output], {
				cwd: root,
				encoding: "utf8",
				timeout: 30_000,
			});
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME");
			expect(existsSync(output)).toBe(false);
		}
		for (const family of ["autoresearch", "autoconference"]) {
			const contract = readFileSync(join(skillsRoot, family, "references/family-contract.md"), "utf8");
			expect(contract).toContain("Python 3.8+");
			expect(contract).toContain("BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME");
		}
	});
});

describe("native-only execution and recursive documentation contracts", () => {
	it("demotes unbound loop and stale status scripts from the executable payload", () => {
		expect(filesUnder(join(skillsRoot, "autoresearch/scripts"))).toEqual(["init_research.py", "style_presets.py"]);
		expect(filesUnder(join(skillsRoot, "autoconference/scripts"))).toEqual(["init_conference.py"]);
	});

	it("recursively excludes foreign-host routes, unbound full-auto, and GNU timeout recipes", () => {
		for (const family of ["autoresearch", "autoconference", "wikify"]) {
			for (const relativePath of filesUnder(join(skillsRoot, family)).filter((path) => path.endsWith(".md"))) {
				const text = readFileSync(join(skillsRoot, family, relativePath), "utf8");
				expect(text, `${family}/${relativePath}`).not.toMatch(
					/\b(?:WebFetch|WebSearch|Claude App|run_in_background|Agent tool|Haiku|Opus|Sonnet)\b|\.claude(?:\/|-plugin)|LITCODEX_APPROVED_PLAN|--full-auto/u,
				);
				expect(text, `${family}/${relativePath}`).not.toMatch(/(?:^|[` ])g?timeout\s+\d+[smh]?\b/mu);
				expect(text, `${family}/${relativePath}`).not.toMatch(
					/(?:autoresearch-loop|autoconference-loop)\.sh|nohup\s+bash|Universal overnight|unattended runner/iu,
				);
			}
		}
	});

	it("marks every top-level and nested mode document as a Codex-native picker contract", () => {
		const expectedTopLevel = { autoresearch: 10, autoconference: 7, wikify: 5 } as const;
		for (const [family, expectedCount] of Object.entries(expectedTopLevel)) {
			const modeRoot = join(skillsRoot, family, "references/modes");
			const modePaths = filesUnder(modeRoot).filter((path) => path.endsWith(".md"));
			expect(
				modePaths.filter((path) => !path.includes("/")),
				family,
			).toHaveLength(expectedCount);
			for (const relativePath of modePaths) {
				const text = readFileSync(join(modeRoot, relativePath), "utf8");
				expect(text, `${family}/${relativePath}`).toContain("## Codex-native contract");
				expect(text, `${family}/${relativePath}`).toContain("picker");
				expect(text, `${family}/${relativePath}`).toContain("start-work");
				expect(text, `${family}/${relativePath}`).toContain("lit-loop");
				expect(text, `${family}/${relativePath}`).toContain("REVIEW_REQUIRED");
			}
		}
	});

	it("keeps family completion review-required instead of claiming package-enforced native state", () => {
		const research = readFileSync(join(skillsRoot, "autoresearch/references/modes/core.md"), "utf8");
		const conference = readFileSync(join(skillsRoot, "autoconference/references/modes/core.md"), "utf8");
		expect(research).toContain("max_iterations=1 executes exactly one work iteration");
		expect(research).toContain("Negated prose is never a completion signal");
		expect(research).toContain("BUDGET_EXHAUSTED");
		expect(research).toContain("non-success");
		expect(research).toContain("REVIEW_REQUIRED");
		expect(conference).toContain("REVIEW_REQUIRED");
		expect(conference).toContain("BUDGET_EXHAUSTED");
		expect(conference).toContain("packet-only");
		expect(conference).toContain("only the root writes");
	});

	it("rejects speculative package enforcement claims across every family document", () => {
		for (const family of ["autoresearch", "autoconference", "wikify"]) {
			for (const relativePath of filesUnder(join(skillsRoot, family)).filter((path) => path.endsWith(".md"))) {
				const text = readFileSync(join(skillsRoot, family, relativePath), "utf8");
				expect(text, `${family}/${relativePath}`).not.toMatch(
					/plan digest|evaluator hash|input hash|\brun id\b|\brevision\b|matching native state|explicit native `completed` state|native state can (?:emit|mark)|start-work.{0,100}\bbind(?:s|ing)?\b/iu,
				);
			}
		}
		for (const family of ["autoresearch", "autoconference", "wikify"]) {
			const skill = readFileSync(join(skillsRoot, family, "SKILL.md"), "utf8");
			expect(skill).toContain("REVIEW_REQUIRED");
			expect(skill).toContain("cannot programmatically claim family completion");
			expect(skill).toContain("Changed evaluator or budget requires re-planning and review");
		}
	});

	it("uses installed helper roots and optional plotting across every mode family", () => {
		const autoresearch = filesUnder(join(skillsRoot, "autoresearch"))
			.filter((path) => path.endsWith(".md"))
			.map((path) => readFileSync(join(skillsRoot, "autoresearch", path), "utf8"))
			.join("\n");
		const autoconference = filesUnder(join(skillsRoot, "autoconference"))
			.filter((path) => path.endsWith(".md"))
			.map((path) => readFileSync(join(skillsRoot, "autoconference", path), "utf8"))
			.join("\n");
		expect(autoresearch).toContain("<loaded-autoresearch-skill-dir>/scripts/init_research.py");
		expect(autoresearch).toContain("<loaded-autoresearch-skill-dir>/scripts/style_presets.py");
		expect(autoresearch).not.toContain("$AUTORESEARCH_ROOT");
		expect(autoresearch).toContain("BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE");
		expect(autoconference).toContain("<loaded-autoconference-skill-dir>/scripts/init_conference.py");
		expect(autoconference).toContain("<loaded-autoresearch-skill-dir>/scripts/style_presets.py");
		expect(autoconference).not.toMatch(/\$AUTORESEARCH_ROOT|\$AUTOCONFERENCE_ROOT/u);
	});

	it("records runner demotion honestly in provenance", () => {
		for (const family of ["autoresearch", "autoconference"]) {
			const provenance = readFileSync(join(skillsRoot, family, "PROVENANCE.md"), "utf8");
			expect(provenance).toContain("removed and demoted");
			expect(provenance).not.toMatch(/scaffolder\/loop\/progress|loop\/progress runtime helpers are retained/iu);
		}
	});

	it("uses stable source identifiers and allows only the verified public Wikify locator", () => {
		const publicWikifyLocator =
			"https://github.com/wjgoarxiv/llm-wikify/tree/dfe8f8bc372c3bc153dd57697f4a36f366a63e74";
		const ownerSourceRecords = [
			["autoresearch", "Source project identifier: `autoresearch-skill`."],
			["autoconference", "Source project identifier: `autoconference-skill`."],
			["wikify", "Source project identifier: `llm-wikify`."],
			["lit-handoff", "Source directory identifier: `022_handoff` (vendored at `vendor/handoff/`)."],
			["lit-scientific-visualization", "Source directory identifier: `045_scientific-visualization`."],
		] as const;
		const records = ownerSourceRecords.map(([family, sourceIdentifier]) => {
			const provenancePath =
				family === "lit-handoff"
					? join(vendorRoot, "provenance/022_handoff.md")
					: family === "lit-scientific-visualization"
						? join(vendorRoot, "provenance/045_scientific-visualization.md")
						: join(skillsRoot, family, "PROVENANCE.md");
			const provenance = readFileSync(provenancePath, "utf8");
			expect(provenance).toContain("Source owner identifier: `wjgoarxiv`.");
			expect(provenance).toContain(sourceIdentifier);
			expect(provenance).not.toMatch(/github\.com\/wjgoarxiv\/my-agent-skills(?:\.git)?/iu);
			return provenance;
		});

		for (const family of ["autoresearch", "autoconference", "lit-handoff", "lit-scientific-visualization"]) {
			const provenancePath =
				family === "lit-handoff"
					? join(vendorRoot, "provenance/022_handoff.md")
					: family === "lit-scientific-visualization"
						? join(vendorRoot, "provenance/045_scientific-visualization.md")
						: join(skillsRoot, family, "PROVENANCE.md");
			const provenance = readFileSync(provenancePath, "utf8");
			expect(provenance).toContain("does not claim anonymous upstream retrieval");
		}

		const wikify = readFileSync(join(skillsRoot, "wikify", "PROVENANCE.md"), "utf8");
		expect(wikify).toContain("`dfe8f8bc372c3bc153dd57697f4a36f366a63e74`");
		expect(wikify).toContain("`ca02699317261cf36f9f89e96186728013778da6`");
		expect(wikify).toContain("Pinned public source locator:");
		expect(wikify).toContain(`\`${publicWikifyLocator}\`.`);
		expect(wikify).toContain("included MIT `LICENSE`");
		expect(wikify).toMatch(/package-local generated skill payload\s+hashes/u);
		expect(wikify).toMatch(/bytes\s+actually\s+present\s+in\s+the\s+packed\s+package/u);

		const urls = records.flatMap((provenance) => provenance.match(/https?:\/\/[^`\s)]+/gu) ?? []);
		expect(urls).toEqual([publicWikifyLocator]);
	});
});
