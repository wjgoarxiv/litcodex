#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const deckRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docRoot = resolve(deckRoot, "../lit-docx");
const cacheBase = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "litcodex", "office");
const commands = {
  pptx: {
    compile: ["node", join(deckRoot, "scripts/compile-deck.js")],
    qa: ["python", join(deckRoot, "scripts/qa_deck.py")],
    inventory: ["python", join(deckRoot, "scripts/inventory.py")],
    embed: ["python", join(deckRoot, "scripts/embed_fonts.py")],
    render: ["python", join(deckRoot, "scripts/render_pages.py")],
    learn: ["python", join(deckRoot, "scripts/learn_template.py")],
    validate: ["python", join(deckRoot, "scripts/validate_pptx.py")],
  },
  docx: {
    convert: ["python", join(docRoot, "scripts/convert_md_to_docx.py")],
    qa: ["python", join(docRoot, "scripts/docx_craft.py")],
    edit: ["python", join(docRoot, "scripts/edit_docx.py")],
    pdf: ["python", join(docRoot, "scripts/convert_md_to_pdf.py")],
    extract_pdf: ["python", join(docRoot, "scripts/convert_pdf.py")],
    slop: ["python", join(docRoot, "scripts/slop_lint.py")],
    audit: ["python", join(docRoot, "scripts/visual_audit.py")],
    clean: ["python", join(docRoot, "scripts/clean_markdown.py")],
    images: ["python", join(docRoot, "scripts/embed_images.py")],
  },
};

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { stdio: "inherit", ...options });
  // Name the failed step: a bare stack or exit code is all the installer could show otherwise.
  if (result.error) {
    process.stderr.write(`[lit-office] ${options.shell ? program : [program, ...args].join(" ")} could not start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`[lit-office] ${options.shell ? program : [program, ...args].join(" ")} exited with ${result.status ?? result.signal}\n`);
    process.exit(result.status ?? 1);
  }
}

// Node refuses to spawn a .cmd/.bat shim without a shell (CVE-2024-27980), so on Windows npm runs as
// node + npm's own entry script; only when neither entry exists does cmd.exe get a quoted command line.
export function npmInvocation(args, env = process.env, platform = process.platform, exists = existsSync) {
  const entry = env.npm_execpath;
  if (entry && exists(entry)) return { command: process.execPath, args: [entry, ...args] };
  if (platform !== "win32") return { command: "npm", args };
  const bundled = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (exists(bundled)) return { command: process.execPath, args: [bundled, ...args] };
  return { command: ["npm.cmd", ...args].map(cmdArgument).join(" "), args: [], shell: true };
}

/** One argument for a cmd.exe line: quoted when it holds spaces; refused when cmd would interpret it. */
export function cmdArgument(value) {
  if (/["%^&|<>!\r\n]/u.test(value)) throw new Error(`refusing to pass ${JSON.stringify(value)} through cmd.exe`);
  return /[\s()]/u.test(value) ? `"${value}"` : value;
}

/** A PATH lookup that also tries PATHEXT on Windows, where `which` does not exist. */
export function onPath(name, env = process.env, platform = process.platform, exists = existsSync) {
  const extensions = platform === "win32" ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

// npm config an enclosing `npm install -g` or `--dry-run` exports; each one turns the child `npm ci` into a different command.
const inheritedNpmMode = /^npm_config_(global|location|prefix|dry[-_]run)$/iu;
function npmChildEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !inheritedNpmMode.test(key)));
}

function cacheFor(skill) {
  const root = skill === "pptx" ? deckRoot : docRoot;
  const lock = join(root, "runtime/requirements.lock");
  const hash = createHash("sha256").update(readFileSync(lock));
  if (skill === "pptx") hash.update(readFileSync(join(root, "runtime/package-lock.json")));
  return join(cacheBase, skill, hash.digest("hex").slice(0, 16));
}

function ready(skill) {
  const cache = cacheFor(skill);
  return existsSync(join(cache, "python.ready")) &&
    existsSync(join(cache, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")) &&
    (skill === "docx" || (existsSync(join(cache, "node.ready")) && existsSync(join(cache, "node_modules/pptxgenjs"))));
}

function ensurePython(skill, cache) {
  if (existsSync(join(cache, "python.ready"))) return;
  const root = skill === "pptx" ? deckRoot : docRoot;
  const venv = join(cache, "venv");
  const python = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  process.stderr.write(`[lit-office] preparing ${skill} Python runtime in product cache\n`);
  mkdirSync(cache, { recursive: true });
  const uv = spawnSync("uv", ["--version"], { stdio: "ignore" });
  if (uv.status === 0) {
    run("uv", ["venv", venv]);
    run("uv", ["pip", "sync", "--python", python, join(root, "runtime/requirements.lock")]);
  } else {
    run("python3", ["-m", "venv", venv]);
    run(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", join(root, "runtime/requirements.lock")]);
  }
  writeFileSync(join(cache, "python.ready"), "ready\n");
}

function ensureNode(cache) {
  if (existsSync(join(cache, "node.ready"))) return;
  process.stderr.write("[lit-office] preparing pptx Node runtime in product cache\n");
  mkdirSync(cache, { recursive: true });
  for (const name of ["package.json", "package-lock.json"]) {
    copyFileSync(join(deckRoot, "runtime", name), join(cache, name));
  }
  const npm = npmInvocation(["ci", "--ignore-scripts", "--omit=dev", "--prefix", cache]);
  run(npm.command, npm.args, {
    env: { ...npmChildEnv(), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
    ...(npm.shell ? { shell: true } : {}),
  });
  writeFileSync(join(cache, "node.ready"), "ready\n");
}

function main() {
  const [skill, command, ...args] = process.argv.slice(2);
  if (skill === "install" && command === undefined) {
    for (const name of ["pptx", "docx"]) {
      const cache = cacheFor(name);
      ensurePython(name, cache);
      if (name === "pptx") ensureNode(cache);
    }
    process.stdout.write("[lit-office] office runtime ready\n");
    return;
  }
  if (skill === "doctor") {
    const which = (name) => onPath(name) !== null;
    process.stdout.write(`${JSON.stringify({
      pptx: { ready: ready("pptx"), cache: cacheFor("pptx") },
      docx: { ready: ready("docx"), cache: cacheFor("docx") },
      optional: { pandoc: which("pandoc"), xelatex: which("xelatex"), soffice: which("soffice") },
    }, null, 2)}\n`);
    return;
  }
  const selected = commands[skill]?.[command];
  if (!selected) {
    process.stderr.write("Usage: office-run.mjs doctor | pptx <compile|qa|inventory|embed|render|learn|validate> ... | docx <convert|qa|edit|pdf|extract_pdf|slop|audit|clean|images> ...\n");
    process.exitCode = 2;
    return;
  }
  const cache = cacheFor(skill);
  if (!ready(skill)) {
    process.stderr.write("office runtime not installed; run `npm exec --package @litfamily/litcodex -- litcodex office-runtime install` outside the sandbox or approve network for this one step\n");
    process.exitCode = 78;
    return;
  }
  const python = join(cache, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const program = selected[0] === "python" ? python : process.execPath;
  const path = join(cache, "venv", process.platform === "win32" ? "Scripts" : "bin");
  run(program, [selected[1], ...args], {
    env: {
      ...process.env,
      PATH: `${path}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}`,
      NODE_PATH: join(cache, "node_modules"),
    },
  });
}

const invoked = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : "";
if (invoked === realpathSync(fileURLToPath(import.meta.url))) main();
