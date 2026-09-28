#!/usr/bin/env node
// tools/assert-ci-workflow.mjs — M18 CI-workflow integrity validator (S18 + M18-addendum).
// Verification-only: parses .github/workflows/ci.yml against tools/ci-gate-manifest.json and
// fails on any drift, missing gate, publish step, secret/registry token, or non-read permission.
// Dependency-free Node ESM. Self-immune: forbidden literals live only in the JSON manifest.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);
const LOCKED_CODEX_BIN = ["$", "{{ github.workspace }}", "/node_modules/.bin/codex"].join("");

// --- Error type ---------------------------------------------------------------

export class CiGateError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "CiGateError";
		this.code = code;
		this.details = details;
	}
}

// --- Manifest loading ---------------------------------------------------------

const GATE_OWNERS = new Set([
	"@litcodex/ci",
	"@litcodex/scaffold",
	"@litcodex/qa",
	"@litcodex/path-robust",
	"@litcodex/legacy-scan",
	"@litcodex/plugin-pack",
]);

const RUN_RE = /^npm (run |test|ci)/;

export function loadCiGateManifest(manifestPath) {
	let raw;
	try {
		raw = readFileSync(manifestPath, "utf8");
	} catch {
		throw new CiGateError("LITCODEX_CI_MANIFEST_MISSING", `manifest not found: ${manifestPath}`, {
			manifestPath,
		});
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new CiGateError("LITCODEX_CI_MANIFEST_INVALID", "manifest is not valid JSON", {
			field: "(root)",
		});
	}
	const fail = (field) => {
		throw new CiGateError("LITCODEX_CI_MANIFEST_INVALID", `manifest field invalid: ${field}`, { field });
	};
	if (parsed.version !== 1) fail("version");
	if (parsed.workflowPath !== ".github/workflows/ci.yml") fail("workflowPath");
	if (
		!Array.isArray(parsed.nodeMatrix) ||
		parsed.nodeMatrix.length < 1 ||
		!parsed.nodeMatrix.every((n) => Number.isInteger(n) && n >= 20)
	) {
		fail("nodeMatrix");
	}
	if (
		!parsed.permissions ||
		typeof parsed.permissions !== "object" ||
		Object.keys(parsed.permissions).length < 1 ||
		!Object.values(parsed.permissions).every((v) => v === "read")
	) {
		fail("permissions");
	}
	if (
		!parsed.lockedHost ||
		parsed.lockedHost.version !== "0.144.0" ||
		parsed.lockedHost.bin !== LOCKED_CODEX_BIN ||
		parsed.lockedHost.verifyRun !== "npm run qa:codex-host-locked" ||
		parsed.lockedHost.doctorRun !== "npm run qa:uiux-installed:doctor"
	) {
		fail("lockedHost");
	}
	if (!Array.isArray(parsed.gates) || parsed.gates.length < 8) fail("gates");
	parsed.gates.forEach((gate, i) => {
		if (!gate || typeof gate.name !== "string" || gate.name === "") fail(`gates[${i}].name`);
		if (typeof gate.run !== "string" || !RUN_RE.test(gate.run)) fail(`gates[${i}].run`);
		if (gate.gateOwner !== undefined && !GATE_OWNERS.has(gate.gateOwner)) fail(`gates[${i}].gateOwner`);
	});
	if (parsed.nonBlockingJobs !== undefined) {
		if (!Array.isArray(parsed.nonBlockingJobs) || parsed.nonBlockingJobs.length < 1) fail("nonBlockingJobs");
		parsed.nonBlockingJobs.forEach((job, i) => {
			if (!job || typeof job.job !== "string" || job.job === "") fail(`nonBlockingJobs[${i}].job`);
			if (typeof job.run !== "string" || job.run === "") fail(`nonBlockingJobs[${i}].run`);
			if (typeof job.summaryStep !== "string" || job.summaryStep === "") fail(`nonBlockingJobs[${i}].summaryStep`);
		});
	}
	if (
		!Array.isArray(parsed.forbiddenTokens) ||
		parsed.forbiddenTokens.length < 1 ||
		!parsed.forbiddenTokens.every((t) => typeof t === "string" && t === t.toLowerCase())
	) {
		fail("forbiddenTokens");
	}
	return parsed;
}

// --- Workflow reading ---------------------------------------------------------

export function readWorkflowText(workflowPath) {
	try {
		return readFileSync(workflowPath, "utf8");
	} catch {
		throw new CiGateError("LITCODEX_CI_WORKFLOW_MISSING", `workflow not found: ${workflowPath}`, {
			workflowPath,
		});
	}
}

// --- YAML subset parser -------------------------------------------------------
// Supports only the authored grammar: nested block maps, "- " block-list items,
// inline [a, b] flow sequences, quoted/plain scalars, and opaque ${{ ... }}
// expression substrings. Anchors (&x), aliases (*x), and merge keys (<<:) outside
// a ${{ ... }} span raise LITCODEX_CI_WORKFLOW_UNPARSEABLE.

function hasUnsupportedYamlSyntax(line) {
	// Strip ${{ ... }} spans so their inner &/*/<< bytes are ignored.
	let stripped = "";
	let i = 0;
	while (i < line.length) {
		if (line.startsWith("${{", i)) {
			const end = line.indexOf("}}", i + 3);
			if (end === -1) {
				throw new CiGateError("LITCODEX_CI_WORKFLOW_UNPARSEABLE", "unterminated GitHub expression", {
					reason: "unterminated-expression",
					line,
				});
			}
			i = end + 2;
			continue;
		}
		stripped += line[i];
		i += 1;
	}
	// Drop trailing comments outside expressions.
	const hashIdx = stripped.indexOf("#");
	const code = hashIdx === -1 ? stripped : stripped.slice(0, hashIdx);
	const trimmed = code.trim();
	if (/(^|\s)&\S/.test(code)) return true; // anchor
	if (/:\s*\*\S/.test(code) || /^\*\S/.test(trimmed)) return true; // alias
	if (/^<<\s*:/.test(trimmed)) return true; // merge key
	return false;
}

function parseScalar(raw) {
	const v = raw.trim();
	if (v === "") return null;
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
		return v.slice(1, -1);
	}
	if (v === "true") return true;
	if (v === "false") return false;
	if (v === "null") return null;
	if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
	if (v.startsWith("[") && v.endsWith("]")) {
		const inner = v.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((item) => parseScalar(item));
	}
	return v; // plain string, including opaque ${{ ... }}
}

function indentOf(line) {
	let n = 0;
	while (n < line.length && line[n] === " ") n += 1;
	return n;
}

function isBlockScalarIndicator(value) {
	return /^[|>][+-]?\d*$/.test(value) || /^[|>][+-]\d*$/.test(value);
}

function hasPlainScalarColonSpace(raw) {
	const value = raw.trim();
	if (value === "") return false;
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'")) ||
		isBlockScalarIndicator(value)
	) {
		return false;
	}
	for (let i = 0; i < value.length; i++) {
		if (value.startsWith("${{", i)) {
			const end = value.indexOf("}}", i + 3);
			if (end === -1) return false;
			i = end + 1;
			continue;
		}
		if (value[i] === ":" && /\s/u.test(value[i + 1] ?? "")) return true;
	}
	return false;
}

export function parseWorkflowYaml(text) {
	const normalized = text.replace(/\r\n/g, "\n");
	const rawLines = normalized.split("\n");
	const lines = [];
	for (let n = 0; n < rawLines.length; n++) {
		const line = rawLines[n];
		if (hasUnsupportedYamlSyntax(line)) {
			throw new CiGateError("LITCODEX_CI_WORKFLOW_UNPARSEABLE", "unsupported YAML construct", {
				line: n + 1,
			});
		}
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		lines.push({ indent: indentOf(line), text: line, n: n + 1 });
	}
	if (lines.length === 0) {
		throw new CiGateError("LITCODEX_CI_WORKFLOW_UNPARSEABLE", "empty workflow", { line: 0 });
	}

	let pos = 0;
	function splitKeyValue(content) {
		// Split on the first ": " or trailing ":" that is not inside ${{ ... }}.
		let depth = 0;
		for (let i = 0; i < content.length; i++) {
			if (content.startsWith("${{", i)) {
				depth += 1;
				i += 2;
				continue;
			}
			if (content.startsWith("}}", i)) {
				depth = Math.max(0, depth - 1);
				i += 1;
				continue;
			}
			if (depth === 0 && content[i] === ":" && (i + 1 >= content.length || content[i + 1] === " ")) {
				return { key: content.slice(0, i).trim(), value: content.slice(i + 1) };
			}
		}
		return null;
	}

	function parseBlock(minIndent) {
		// Decide list vs map by the first line at this indent.
		const first = lines[pos];
		const isList = first.text.trim().startsWith("- ") || first.text.trim() === "-";
		if (isList) return parseList(minIndent);
		return parseMap(minIndent);
	}

	function parseBlockScalar(indicator, parentIndent) {
		const style = indicator[0];
		const chomping = indicator.includes("-") ? "-" : indicator.includes("+") ? "+" : "";
		const chunks = [];
		const contentIndent = lines[pos]?.indent;
		if (contentIndent === undefined || contentIndent <= parentIndent) return "";
		while (pos < lines.length && lines[pos].indent > parentIndent) {
			const line = lines[pos];
			chunks.push(line.text.slice(Math.min(contentIndent, line.text.length)));
			pos += 1;
		}
		const value = style === ">" ? chunks.join(" ") : chunks.join("\n");
		return chomping === "-" || chunks.length === 0 ? value : `${value}\n`;
	}

	function parseMap(indent) {
		const map = {};
		while (pos < lines.length) {
			const line = lines[pos];
			if (line.indent < indent) break;
			if (line.indent > indent) {
				throw new CiGateError("LITCODEX_CI_WORKFLOW_UNPARSEABLE", "bad indentation in map", {
					line: line.n,
				});
			}
			const content = line.text.trim();
			const kv = splitKeyValue(content);
			if (!kv) {
				throw new CiGateError("LITCODEX_CI_WORKFLOW_UNPARSEABLE", "expected key: value", {
					line: line.n,
				});
			}
			pos += 1;
			const value = kv.value.trim();
			if (isBlockScalarIndicator(value)) {
				map[kv.key] = parseBlockScalar(value, indent);
			} else if (value === "") {
				// Nested block (or empty mapping value, e.g. a bare trigger key).
				if (pos < lines.length && lines[pos].indent > indent) {
					map[kv.key] = parseBlock(lines[pos].indent);
				} else {
					map[kv.key] = null;
				}
			} else {
				if (hasPlainScalarColonSpace(kv.value)) {
					throw new CiGateError(
						"LITCODEX_CI_WORKFLOW_UNPARSEABLE",
						"plain scalar contains colon followed by whitespace",
						{ line: line.n, reason: "plain-scalar-colon-space" },
					);
				}
				map[kv.key] = parseScalar(kv.value);
			}
		}
		return map;
	}

	function parseList(indent) {
		const list = [];
		while (pos < lines.length) {
			const line = lines[pos];
			if (line.indent < indent) break;
			if (line.indent > indent) {
				throw new CiGateError("LITCODEX_CI_WORKFLOW_UNPARSEABLE", "bad indentation in list", {
					line: line.n,
				});
			}
			const content = line.text.trim();
			if (content === "-") {
				pos += 1;
				if (pos < lines.length && lines[pos].indent > indent) {
					list.push(parseBlock(lines[pos].indent));
				} else {
					list.push(null);
				}
				continue;
			}
			if (!content.startsWith("- ")) break;
			const itemContent = content.slice(2);
			const kv = splitKeyValue(itemContent);
			if (kv) {
				// Inline map starting on the dash line: treat as a map whose first
				// entry is on this line and continuation lines are indented past the dash.
				const itemIndent = line.indent + 2;
				// Rewrite this line in place as a map line at itemIndent, then parse a map.
				lines[pos] = { indent: itemIndent, text: " ".repeat(itemIndent) + itemContent, n: line.n };
				list.push(parseMap(itemIndent));
			} else {
				pos += 1;
				list.push(parseScalar(itemContent));
			}
		}
		return list;
	}

	const root = parseMap(lines[pos].indent);
	return root;
}

// --- Extraction + scanning ----------------------------------------------------

export function extractRunCommands(workflow) {
	const runs = [];
	const jobs = workflow?.jobs;
	if (!jobs || typeof jobs !== "object") return runs;
	for (const job of Object.values(jobs)) {
		const steps = job?.steps;
		if (!Array.isArray(steps)) continue;
		for (const step of steps) {
			if (step && typeof step.run === "string") runs.push(step.run.trim());
		}
	}
	return runs;
}

export function findForbiddenTokens(text, forbidden) {
	const lower = text.toLowerCase();
	const hits = [];
	for (const token of forbidden) {
		if (lower.includes(token)) hits.push(token);
	}
	return hits;
}

function lineOfToken(text, token) {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].toLowerCase().includes(token)) return i + 1;
	}
	return 0;
}

// --- Orchestration ------------------------------------------------------------

export function runCiCheck(opts) {
	const repoRoot = opts.repoRoot;
	const workflowPath = opts.workflowPath ?? resolve(repoRoot, ".github", "workflows", "ci.yml");
	const manifestPath = opts.manifestPath ?? resolve(repoRoot, "tools", "ci-gate-manifest.json");
	const drifts = [];
	const push = (code, message, details = {}) => drifts.push({ code, message, details });

	const finalize = () => {
		drifts.sort((a, b) =>
			a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0,
		);
		const codes = drifts.map((d) => d.code);
		return {
			ok: drifts.length === 0,
			workflowPath: opts.workflowPath ?? ".github/workflows/ci.yml",
			gatesChecked: manifest ? manifest.gates.length : 0,
			matrixOk: !codes.includes("LITCODEX_CI_NODE_MATRIX_MISMATCH"),
			permissionsOk: !codes.includes("LITCODEX_CI_PERMISSIONS_NOT_READONLY"),
			publishFree:
				!codes.includes("LITCODEX_CI_PUBLISH_STEP_PRESENT") && !codes.includes("LITCODEX_CI_FORBIDDEN_TOKEN"),
			lockedHostOk: !codes.includes("LITCODEX_CI_LOCKED_HOST_INVALID"),
			drifts,
		};
	};

	let manifest = null;
	try {
		manifest = loadCiGateManifest(manifestPath);
	} catch (err) {
		push(err.code, err.message, err.details);
		return finalize();
	}

	let rawText;
	try {
		rawText = readWorkflowText(workflowPath);
	} catch (err) {
		push(err.code, err.message, err.details);
		return finalize();
	}

	let workflow;
	try {
		workflow = parseWorkflowYaml(rawText);
	} catch (err) {
		push(err.code, err.message, err.details);
		return finalize();
	}

	// Trigger check.
	const on = workflow.on;
	const onKeys = on && typeof on === "object" ? Object.keys(on) : [];
	const triggerOk =
		on &&
		typeof on === "object" &&
		!Object.hasOwn(on, "workflow_dispatch") &&
		!Object.hasOwn(on, "pull_request_target") &&
		on.push &&
		on.pull_request &&
		JSON.stringify(on.push.branches) === JSON.stringify(["master"]) &&
		JSON.stringify(on.pull_request.branches) === JSON.stringify(["master"]) &&
		onKeys.every((k) => k === "push" || k === "pull_request");
	if (!triggerOk) {
		push("LITCODEX_CI_TRIGGER_INVALID", "on: must be exactly push+pull_request to [master]", {
			onKeys,
		});
	}

	// Permissions check.
	const permissions = workflow.permissions;
	if (!permissions || typeof permissions !== "object") {
		push("LITCODEX_CI_PERMISSIONS_NOT_READONLY", "permissions block missing", {});
	} else {
		for (const [key, value] of Object.entries(permissions)) {
			if (value !== "read") {
				push("LITCODEX_CI_PERMISSIONS_NOT_READONLY", `permission "${key}" is not read`, { key, value });
			}
		}
	}

	// Node matrix check.
	const matrix = workflow.jobs?.verify?.strategy?.matrix?.node;
	const actual = Array.isArray(matrix) ? matrix : [];
	const expectedSet = new Set(manifest.nodeMatrix);
	const actualSet = new Set(actual);
	const matrixMatch = expectedSet.size === actualSet.size && [...expectedSet].every((n) => actualSet.has(n));
	if (!matrixMatch) {
		push("LITCODEX_CI_NODE_MATRIX_MISMATCH", "matrix.node does not match manifest", {
			expected: manifest.nodeMatrix,
			actual,
		});
	}

	// Gate presence + order check.
	const runs = extractRunCommands(workflow);
	if (!runs.includes("npm ci --ignore-scripts") || runs.includes("npm ci")) {
		push(
			"LITCODEX_CI_INSTALL_COMMAND_INVALID",
			"dependency install must be exactly npm ci --ignore-scripts before build artifacts exist",
			{},
		);
	}
	const steps = workflow.jobs?.verify?.steps;
	const verifyStep = Array.isArray(steps)
		? steps.find((step) => step?.run === manifest.lockedHost.verifyRun)
		: undefined;
	const doctorStep = Array.isArray(steps)
		? steps.find((step) => step?.run === manifest.lockedHost.doctorRun)
		: undefined;
	if (
		verifyStep === undefined ||
		doctorStep === undefined ||
		doctorStep.env?.CODEX_BIN !== manifest.lockedHost.bin ||
		workflow.jobs?.verify?.env?.CODEX_BIN !== undefined
	) {
		push(
			"LITCODEX_CI_LOCKED_HOST_INVALID",
			"CI must verify the lock-owned Codex CLI and pass its absolute path only to doctor-scope QA",
			{
				verifyRun: verifyStep?.run ?? null,
				doctorRun: doctorStep?.run ?? null,
				codexBin: doctorStep?.env?.CODEX_BIN ?? null,
			},
		);
	}
	const foundIndices = [];
	for (const gate of manifest.gates) {
		const idx = runs.indexOf(gate.run);
		if (idx === -1) {
			push("LITCODEX_CI_GATE_MISSING", `required gate not present: ${gate.run}`, { run: gate.run });
		} else {
			foundIndices.push(idx);
		}
	}
	if (foundIndices.length === manifest.gates.length) {
		for (let i = 1; i < foundIndices.length; i++) {
			if (foundIndices[i] < foundIndices[i - 1]) {
				push("LITCODEX_CI_GATE_OUT_OF_ORDER", "gates are not in manifest order", { foundIndices });
				break;
			}
		}
	}

	// Non-blocking jobs must remain observable: the manifest names every such job, its deciding
	// command, and the always-run step that appends an explicit PASS/FAIL result to the Actions
	// step summary. A job-level continue-on-error without that receipt is a silent skip in practice.
	const nonBlockingJobs = Array.isArray(manifest.nonBlockingJobs) ? manifest.nonBlockingJobs : [];
	const declaredNonBlocking = new Set(nonBlockingJobs.map((spec) => spec.job));
	for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
		if (job?.["continue-on-error"] === true && !declaredNonBlocking.has(jobName)) {
			push("LITCODEX_CI_NONBLOCKING_JOB_UNDECLARED", `non-blocking job is not in manifest: ${jobName}`, {
				job: jobName,
			});
		}
	}
	for (const spec of nonBlockingJobs) {
		const job = workflow.jobs?.[spec.job];
		if (!job || typeof job !== "object") {
			push("LITCODEX_CI_NONBLOCKING_JOB_MISSING", `manifest non-blocking job not present: ${spec.job}`, {
				job: spec.job,
			});
			continue;
		}
		if (job["continue-on-error"] !== true) {
			push("LITCODEX_CI_NONBLOCKING_JOB_NOT_CONTINUABLE", `non-blocking job must continue on error: ${spec.job}`, {
				job: spec.job,
			});
		}
		const jobSteps = Array.isArray(job.steps) ? job.steps : [];
		if (!jobSteps.some((step) => step?.run === spec.run)) {
			push("LITCODEX_CI_NONBLOCKING_RUN_MISSING", `non-blocking run not present: ${spec.run}`, {
				job: spec.job,
				run: spec.run,
			});
		}
		const summary = jobSteps.find((step) => step?.name === spec.summaryStep);
		if (
			!summary ||
			summary.if !== "always()" ||
			typeof summary.run !== "string" ||
			!summary.run.includes("GITHUB_STEP_SUMMARY")
		) {
			push(
				"LITCODEX_CI_NONBLOCKING_SUMMARY_INVALID",
				`non-blocking job must append an always-run result to GITHUB_STEP_SUMMARY: ${spec.job}`,
				{ job: spec.job, summaryStep: spec.summaryStep },
			);
		}
	}

	// Publish-step check (parsed run literals).
	const publishMarkers = [["npm", "publish"].join(" "), "gh release", "git tag", "git push"];
	for (const run of runs) {
		const lower = run.toLowerCase();
		for (const marker of publishMarkers) {
			if (lower.includes(marker)) {
				push("LITCODEX_CI_PUBLISH_STEP_PRESENT", `publish step detected: ${run}`, { run, marker });
			}
		}
	}

	// Forbidden-token check (raw text).
	for (const token of findForbiddenTokens(rawText, manifest.forbiddenTokens)) {
		push("LITCODEX_CI_FORBIDDEN_TOKEN", `forbidden token "${token}" found in ci.yml`, {
			token,
			line: lineOfToken(rawText, token),
		});
	}

	return finalize();
}

// --- CLI ----------------------------------------------------------------------

const USAGE =
	"usage: node tools/assert-ci-workflow.mjs [--json] [--repo-root <path>] [--workflow <path>] [--manifest <path>]";

function resolveRepoRoot(cwd) {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
		}).trim();
	} catch {
		return cwd;
	}
}

function abs(base, p) {
	return isAbsolute(p) ? p : resolve(base, p);
}

function parseArgv(argv) {
	const flags = { json: false, repoRoot: null, workflow: null, manifest: null, help: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") flags.json = true;
		else if (arg === "--help" || arg === "-h") flags.help = true;
		else if (arg === "--repo-root") flags.repoRoot = argv[++i] ?? null;
		else if (arg === "--workflow") flags.workflow = argv[++i] ?? null;
		else if (arg === "--manifest") flags.manifest = argv[++i] ?? null;
		else return { error: `unknown argument: ${arg}` };
	}
	return { flags };
}

const UNRECOVERABLE = /(_MISSING|_INVALID|_UNPARSEABLE)$/;

function main() {
	const parsed = parseArgv(process.argv.slice(2));
	if (parsed.error) {
		process.stderr.write(`[assert-ci-workflow] ${parsed.error}\n${USAGE}\n`);
		process.exit(2);
	}
	const flags = parsed.flags;
	if (flags.help) {
		process.stdout.write(`${USAGE}\n`);
		process.exit(0);
	}
	const cwd = process.cwd();
	const repoRoot = flags.repoRoot ? abs(cwd, flags.repoRoot) : resolveRepoRoot(cwd);
	const report = runCiCheck({
		repoRoot,
		workflowPath: flags.workflow ? abs(cwd, flags.workflow) : undefined,
		manifestPath: flags.manifest ? abs(cwd, flags.manifest) : undefined,
	});

	if (flags.json) {
		process.stdout.write(`${JSON.stringify(report)}\n`);
	} else if (report.ok) {
		process.stdout.write(
			`ci-workflow check: OK (${report.gatesChecked} gates, matrix=${report.matrixOk}, read-only, publish-free)\n`,
		);
	} else {
		for (const drift of report.drifts) {
			process.stdout.write(`[${drift.code}] ${drift.message}\n`);
		}
		process.stderr.write(`[assert-ci-workflow] ci-workflow check: FAIL (${report.drifts.length} drifts)\n`);
	}

	if (report.ok) process.exit(0);
	if (report.drifts.some((d) => UNRECOVERABLE.test(d.code))) process.exit(2);
	process.exit(1);
}

if (SELF_PATH === resolve(process.argv[1] ?? "")) {
	main();
}
