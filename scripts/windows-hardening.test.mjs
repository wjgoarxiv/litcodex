import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Windows behaviour is simulated by injecting platform, env and a file-existence check into the
// helpers; real Windows is not exercised here.
const root = fileURLToPath(new URL("..", import.meta.url));
const runner = join(root, "plugins/litcodex/skills/lit-pptx/scripts/office-run.mjs");
const docScripts = join(root, "plugins/litcodex/skills/lit-docx/scripts");
const office = await import(runner);
const motion = await import(join(root, "plugins/litcodex/skills/lit-typographic-motion/engine/runtime.mjs"));
const scratch = mkdtempSync(join(tmpdir(), "litcodex-windows-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/iu.test(key)));

for (const [name, npm, quote] of [
	["office runner", (args, e, p, x) => office.npmInvocation(args, e, p, x), office.cmdArgument],
	["motion runtime", (args, e, p, x) => motion.npmCommand(args, e, p, x), motion.cmdArgument],
]) {
	describe(`${name}: npm on Windows`, () => {
		it("never spawns npm.cmd without a shell", () => {
			const plain = npm(["ci", "--prefix", "C:\\Users\\A B\\cache"], {}, "win32", () => false);
			assert.equal(plain.shell, true);
			assert.deepEqual(plain.args, []);
			assert.equal(plain.command, 'npm.cmd ci --prefix "C:\\Users\\A B\\cache"');
		});
		it("prefers npm's own entry script through node, with no shell", () => {
			const viaEnv = npm(["ci"], { npm_execpath: "C:\\npm\\npm-cli.js" }, "win32", () => true);
			assert.deepEqual(viaEnv, { command: process.execPath, args: ["C:\\npm\\npm-cli.js", "ci"] });
			const bundled = npm(["ci"], {}, "win32", (path) => path.endsWith("npm-cli.js"));
			assert.equal(bundled.command, process.execPath);
			assert.match(bundled.args[0], /node_modules.npm.bin.npm-cli\.js$/u);
			assert.equal(bundled.shell, undefined);
		});
		it("keeps plain npm on POSIX", () => {
			assert.deepEqual(
				npm(["ci"], {}, "linux", () => false),
				{ command: "npm", args: ["ci"] },
			);
		});
		it("refuses an argument cmd.exe would interpret", () => {
			for (const bad of ['a"b', "a&b", "%PATH%", "a|b", "a^b", "a<b", "a>b", "a!b", "a\nb"]) {
				assert.throws(() => quote(bad), /refusing to pass/u, bad);
			}
		});
	});
}

describe("PATH lookups honour PATHEXT", () => {
	const files = new Set(["C:\\tools\\ffmpeg.EXE", "C:\\tools\\pandoc.exe"].map((path) => path.toLowerCase()));
	const exists = (path) => files.has(path.replaceAll("/", "\\").toLowerCase());
	const winEnv = { Path: "C:\\nothing;C:\\tools", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
	it("motion which finds ffmpeg.exe for ffmpeg", () => {
		assert.match(motion.which("ffmpeg", winEnv, "win32", exists) ?? "", /ffmpeg\.EXE$/u);
		assert.equal(motion.which("ffprobe", winEnv, "win32", exists), null);
	});
	it("office doctor finds pandoc.exe without `which`", () => {
		assert.match(office.onPath("pandoc", winEnv, "win32", exists) ?? "", /pandoc\.EXE$/iu);
		assert.equal(office.onPath("xelatex", winEnv, "win32", exists), null);
	});
	it("an extensionless name still matches on POSIX", () => {
		assert.equal(
			motion.which("ffmpeg", { PATH: "/opt/bin" }, "linux", (path) => path === "/opt/bin/ffmpeg"),
			"/opt/bin/ffmpeg",
		);
	});
});

describe("office runner keeps the child's exit code and names the failed step", () => {
	const xdg = join(scratch, "xdg");
	const doctor = spawnSync(process.execPath, [runner, "doctor"], {
		encoding: "utf8",
		env: { ...env, XDG_CACHE_HOME: xdg },
	});
	const runtime = JSON.parse(doctor.stdout);

	it("a docx command whose script exits 3 returns 3", () => {
		const cache = runtime.docx.cache;
		mkdirSync(join(cache, "venv/bin"), { recursive: true });
		writeFileSync(join(cache, "python.ready"), "ready\n");
		const python = join(cache, "venv/bin/python");
		writeFileSync(python, "#!/bin/sh\necho gate failed >&2\nexit 3\n");
		chmodSync(python, 0o755);
		const result = spawnSync(process.execPath, [runner, "docx", "qa", "x.docx"], {
			encoding: "utf8",
			env: { ...env, XDG_CACHE_HOME: xdg },
		});
		assert.equal(result.status, 3, result.stderr);
		assert.match(result.stderr, /gate failed/u);
		assert.match(result.stderr, /\[lit-office\] .*exited with 3/u);
	});

	it("an install whose npm cannot start reports the cause, not a stack", () => {
		const cache = runtime.pptx.cache;
		mkdirSync(cache, { recursive: true });
		writeFileSync(join(cache, "python.ready"), "ready\n");
		const result = spawnSync(process.execPath, [runner, "install"], {
			encoding: "utf8",
			env: { ...env, XDG_CACHE_HOME: xdg, PATH: join(scratch, "empty") },
		});
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /\[lit-office\] npm ci .*could not start: .*ENOENT/u);
		assert.doesNotMatch(result.stderr, /^\s+at /mu);
	});
});

describe("PDF profiles", () => {
	it("every LaTeX template loads longtable and defines \\tightlist for pandoc tables and lists", () => {
		for (const profile of ["acs", "elsevier", "ieee", "korean-generic", "nature"]) {
			const body = readFileSync(
				join(root, "plugins/litcodex/skills/lit-docx/templates/latex", profile, "template.tex"),
				"utf8",
			);
			assert.match(body, /\\usepackage\{longtable\}/u, profile);
			assert.match(body, /\\providecommand\{\\tightlist\}/u, profile);
		}
	});

	// The font preflight reads only the standard library, so stub the converter's heavy imports.
	const preflight = (fcList, locale) => {
		const stub = join(scratch, "stub");
		mkdirSync(stub, { recursive: true });
		writeFileSync(
			join(stub, "convert_md_to_docx.py"),
			"detect_locale = fix_dashes = fix_ellipsis = fix_quotes = fix_unit_spacing = load_publisher = normalize_double_spaces = parse_frontmatter = None\n",
		);
		const code = [
			"import shutil, sys",
			`sys.path[:0] = [${JSON.stringify(stub)}, ${JSON.stringify(docScripts)}]`,
			"import convert_md_to_pdf as m",
			"m.ensure_pandoc = lambda: None",
			"m.kpsewhich_has = lambda target: True",
			`m.command_path = lambda name: ${JSON.stringify(fcList)} if name == "fc-list" else "/bin/" + name`,
			"publisher = {'docx': {'font': {'body': {'family': 'UnBatang'}}}, 'latex': {'documentclass': 'oblivoir', 'cjk': {'main_font': 'Pretendard'}}}",
			`m.preflight_pdf_compile('korean-generic', publisher, ${JSON.stringify(locale)})`,
			"print('ok')",
		].join("\n");
		return spawnSync("python3", ["-c", code], { encoding: "utf8", env: { ...env, PYTHONDONTWRITEBYTECODE: "1" } });
	};
	const fakeFcList = (known) => {
		const path = join(scratch, `fc-list-${known.length}`);
		writeFileSync(
			path,
			`#!/bin/sh\ncase "$1" in\n${known.map((font) => `  ":family=${font}") echo "${font}" ;;\n`).join("")}esac\nexit 0\n`,
		);
		chmodSync(path, 0o755);
		return path;
	};

	it("stops before XeLaTeX with a BLOCKED line naming the missing font and how to install it", () => {
		const result = preflight(fakeFcList(["UnBatang"]), "ko");
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			/BLOCKED: publisher 'korean-generic' needs the font 'Pretendard', which is not installed; install Pretendard from https:/u,
		);
	});
	it("passes when fontconfig finds every font, and does not ask an English document for the CJK font", () => {
		assert.equal(preflight(fakeFcList(["UnBatang", "Pretendard"]), "ko").stdout.trim(), "ok");
		assert.equal(preflight(fakeFcList(["UnBatang"]), "en").stdout.trim(), "ok");
	});
});

// The batch file npm writes for a global bin (cmd-shim), and a variant that launches a native binary.
const NPM_SHIM = [
	"@ECHO off",
	"GOTO start",
	":find_dp0",
	"SET dp0=%~dp0",
	"EXIT /b",
	":start",
	"SETLOCAL",
	"CALL :find_dp0",
	'IF EXIST "%dp0%\\node.exe" (',
	'  SET "_prog=%dp0%\\node.exe"',
	") ELSE (",
	'  SET "_prog=node"',
	"  SET PATHEXT=%PATHEXT:;.JS;=;%",
	")",
	'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\agent-browser\\bin\\agent-browser.js" %*',
	"",
].join("\r\n");
const NATIVE_SHIM = '@ECHO off\r\n"%~dp0\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe" %*\r\n';

describe("user-installed CLIs run without cmd.exe", async () => {
	const diagram = await import(join(root, "plugins/litcodex/skills/lit-diagram-drawer/scripts/runtime-probes.mjs"));
	const probe = await import(join(root, "plugins/litcodex/skills/browser-drive/scripts/capability-probe.mjs"));
	const shimDir = "C:\\Users\\A B\\AppData\\Roaming\\npm";
	const winEnv = { Path: `C:\\Windows;${shimDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
	const script = '(async()=>{const s=document.querySelector("svg");return s&&1<2|0})()';

	it("diagram scripts unwrap the agent-browser npm shim and pass every argument untouched", () => {
		const shim = `${shimDir}\\agent-browser.CMD`;
		const run = diagram.shellFreeCommand("agent-browser", ["eval", script], {
			env: winEnv,
			platform: "win32",
			exists: (file) => file === shim,
			read: () => NPM_SHIM,
		});
		assert.deepEqual(run, {
			command: process.execPath,
			args: [`${shimDir}\\node_modules\\agent-browser\\bin\\agent-browser.js`, "eval", script],
		});
		const native = diagram.shellFreeCommand("agent-browser", ["--version"], {
			env: winEnv,
			platform: "win32",
			exists: (file) => file === shim,
			read: () => NATIVE_SHIM,
		});
		assert.deepEqual(native, {
			command: `${shimDir}\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe`,
			args: ["--version"],
		});
	});
	it("diagram scripts run a real .exe directly, refuse a .cmd that is not an npm shim, and keep POSIX unchanged", () => {
		const exe = `${shimDir}\\agent-browser.EXE`;
		assert.deepEqual(
			diagram.shellFreeCommand("agent-browser", ["x"], {
				env: winEnv,
				platform: "win32",
				exists: (file) => file === exe,
			}),
			{ command: exe, args: ["x"] },
		);
		assert.throws(
			() =>
				diagram.shellFreeCommand("agent-browser", ["x"], {
					env: winEnv,
					platform: "win32",
					exists: (file) => file.endsWith(".CMD"),
					read: () => "@echo off\r\nnode %*\r\n",
				}),
			/not an npm shim/u,
		);
		assert.deepEqual(diagram.shellFreeCommand("agent-browser", ["x"], { platform: "darwin" }), {
			command: "agent-browser",
			args: ["x"],
		});
	});
	it("the browser-drive probe unwraps the resolved shim and refuses anything else", () => {
		const shim = `${shimDir}\\agent-browser.CMD`;
		assert.deepEqual(
			probe.shellFreeInvocation(shim, ["--version"], "win32", () => NPM_SHIM),
			{
				command: process.execPath,
				args: [`${shimDir}\\node_modules\\agent-browser\\bin\\agent-browser.js`, "--version"],
			},
		);
		assert.equal(
			probe.shellFreeInvocation(shim, ["--version"], "win32", () => "@echo off\r\n"),
			null,
		);
		assert.deepEqual(probe.shellFreeInvocation("/usr/bin/agent-browser", ["--version"], "linux"), {
			command: "/usr/bin/agent-browser",
			args: ["--version"],
		});
	});
});
