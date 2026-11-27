import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ancestorReason, containedReason, isProtectedFileName, protectedReason, resolveLinks, } from "./protected-paths.js";
const READERS = new Set([
    "cat",
    "head",
    "tail",
    "wc",
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ls",
    "find",
    "sed",
    "jq",
    "sort",
    "uniq",
    "cut",
    "diff",
    "cmp",
    "stat",
    "file",
    "echo",
    "printf",
    "pwd",
    "which",
    "type",
    "true",
    "false",
    "test",
    "[",
    "date",
    "basename",
    "dirname",
    "realpath",
    "readlink",
    "tree",
    "du",
    "df",
    "whoami",
    "uname",
    "hostname",
    "id",
    "less",
    "more",
    "nl",
    "od",
    "hexdump",
    "strings",
    "shasum",
    "sha256sum",
    "md5",
    "md5sum",
    "tr",
    "column",
    "paste",
    "comm",
    "fold",
    "expand",
    "rev",
    "seq",
    "sleep",
    "wait",
]);
const RUNNERS = new Set([
    "node",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "bun",
    "bunx",
    "deno",
    "tsx",
    "ts-node",
    "python",
    "python3",
    "pytest",
    "uv",
    "pip",
    "pip3",
    "perl",
    "ruby",
    "php",
    "make",
    "just",
    "cargo",
    "go",
    "rustc",
    "gcc",
    "cc",
    "clang",
    "tsc",
    "vitest",
    "jest",
    "biome",
    "eslint",
    "prettier",
    "bash",
    "sh",
    "zsh",
    "java",
    "javac",
    "mvn",
    "gradle",
    "dotnet",
    "swift",
]);
const OUTWARD_TOOLS = new Set([
    "curl",
    "wget",
    "ssh",
    "scp",
    "sftp",
    "rsync",
    "ftp",
    "nc",
    "ncat",
    "telnet",
    "gh",
    "hub",
    "glab",
    "docker",
    "podman",
    "kubectl",
    "helm",
    "aws",
    "gcloud",
    "gsutil",
    "az",
    "terraform",
    "pulumi",
    "heroku",
    "vercel",
    "netlify",
    "fly",
    "flyctl",
    "firebase",
    "wrangler",
    "twine",
    "gem",
    "brew",
    "apt",
    "apt-get",
    "yum",
    "dnf",
    "port",
    "launchctl",
    "systemctl",
    "crontab",
    "defaults",
    "osascript",
    "open",
    "shutdown",
    "reboot",
    "killall",
    "pkill",
    "kill",
    "security",
    "diskutil",
    "mount",
    "umount",
]);
/** Prefixes that run another program: the inner verb is still checked, and the step is held. */
const PREFIXES = new Set([
    "time",
    "nice",
    "nohup",
    "timeout",
    "stdbuf",
    "ionice",
    "chroot",
    "doas",
    "sudo",
    "command",
    "builtin",
    "exec",
    "env",
    "caffeinate",
    "!",
]);
/** Verbs whose effect the word parser cannot follow; always held. */
const HIDDEN = new Set([
    "eval",
    "source",
    ".",
    "xargs",
    "pushd",
    "popd",
    "alias",
    "unalias",
    "set",
    "shopt",
    "trap",
    "enable",
    "export",
    "unset",
    "declare",
    "typeset",
    "local",
    "readonly",
    "function",
    "exit",
    "return",
    "base64",
    "xxd",
    "openssl",
    "uudecode",
    "parallel",
    "watch",
    "script",
]);
const WRITERS = new Set([
    "touch",
    "mkdir",
    "cp",
    "mv",
    "ln",
    "rm",
    "rmdir",
    "unlink",
    "tee",
    "truncate",
    "chmod",
    "chown",
    "chgrp",
    "install",
    "dd",
    "shred",
    "patch",
]);
const DELETERS = new Set(["rm", "rmdir", "unlink", "shred"]);
/** Writers whose effect the guard does not follow (links, modes, sizes, raw copies, archives, patches): always parked. */
const ALWAYS_PARKED = new Set(["ln", "truncate", "chmod", "chown", "chgrp", "install", "dd", "shred", "patch", "tar"]);
/** The repo's own test and check scripts or targets, which run without parking inside the run's roots. */
const OWN_CHECK = /^(?:test|check|lint|build|typecheck|type-check|vet|clippy|fmt|format)(?::[\w:.-]+)?$/u;
/** Test runners and checkers that run without parking inside the run's roots. */
const TEST_RUNNERS = new Set(["vitest", "jest", "pytest", "tsc", "biome", "eslint", "prettier"]);
/** Interpreters whose first operand is the script file they run. */
const SCRIPT_RUNNERS = new Set([
    "node",
    "tsx",
    "ts-node",
    "python",
    "python3",
    "perl",
    "ruby",
    "php",
    "bash",
    "sh",
    "zsh",
]);
const GIT_READS = new Set([
    "status",
    "diff",
    "log",
    "show",
    "blame",
    "ls-files",
    "rev-parse",
    "grep",
    "describe",
    "shortlog",
    "ls-tree",
    "cat-file",
    "show-ref",
    "merge-base",
    "rev-list",
    "whatchanged",
    "name-rev",
    "for-each-ref",
    "check-ignore",
    "version",
    "help",
]);
const GIT_LOCAL = new Set([
    "add",
    "commit",
    "checkout",
    "switch",
    "restore",
    "stash",
    "branch",
    "merge",
    "rebase",
    "cherry-pick",
    "revert",
    "rm",
    "mv",
    "apply",
    "am",
    "notes",
    "worktree",
    "init",
    "bisect",
]);
const PACKAGE_RELEASE = new Set([
    "publish",
    "unpublish",
    "deprecate",
    "version",
    "dist-tag",
    "owner",
    "access",
    "adduser",
    "login",
    "logout",
    "token",
    "team",
    "org",
    "star",
    "hook",
]);
const RELEASE_SCRIPT = /publish|release|deploy|ship|bump|version|tag|push|upload|clean|reset|nuke|purge/iu;
const NAME_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
/** Assess one command for an active run. Never throws. */
export function assessCommand(command, context) {
    const result = assessSafely(command, context);
    if (result.kind === "refused")
        return result;
    if (!result.mustPark)
        return { kind: "pass" };
    return { kind: "park", tier: result.tier, held: result.held, outward: result.outward, why: result.why };
}
/**
 * The tier a command gets when it is parked, whether or not the guard would refuse it now. Replay runs this again,
 * so a stored step that was edited, or whose folder moved, is checked against the files as they are.
 */
export function parkedTier(command, context) {
    const result = assessSafely(command, context);
    if (result.kind === "refused")
        return result;
    return { kind: "tier", tier: result.tier, held: result.held, outward: result.outward };
}
function assessSafely(command, context) {
    try {
        return assess(command, context);
    }
    catch {
        const held = "the command could not be read";
        return { kind: "assessed", mustPark: true, tier: "X", held, outward: true, why: held };
    }
}
function assess(command, context) {
    const parsed = parse(command);
    const homes = homesOf(context.env);
    let dir = context.cwd;
    let held = parsed.held;
    let outward = held !== null;
    let mustPark = held !== null;
    let why = held ?? "";
    let tierB = held === null;
    const note = (reason, isOutward, isHeld = false, park = true) => {
        if (park)
            mustPark = true;
        // A local note (a write outside the granted roots but inside the project) leaves a B-shaped step B.
        if (isOutward || isHeld)
            tierB = false;
        if (isOutward)
            outward = true;
        if (isHeld && held === null)
            held = reason;
        if (why === "")
            why = reason;
    };
    for (const segment of parsed.segments) {
        // Refusals first: a protected path, `~user`, or a bare `cd` is refused whatever else the command does.
        for (const word of [...segment.words, ...segment.writes, ...segment.reads]) {
            if (word.tildeUser)
                return { kind: "refused", reason: "it names another account's home folder (`~user`)" };
            const refusal = protectedWord(word.value, dir, homes, context.env);
            if (refusal !== null)
                return { kind: "refused", reason: refusal };
        }
        const redirected = refuseWrites(segment.writes, dir, homes, context.env);
        if (redirected !== null)
            return redirected;
        const { verb, args, prefixHeld } = peel(segment.words);
        if (prefixHeld !== null)
            note(prefixHeld, true, true);
        const flagged = [...segment.words, ...segment.writes, ...segment.reads].find((word) => word.flag !== null);
        if (flagged !== undefined)
            note(`${flagged.flag} (${flagged.raw}) is not read by the word parser`, true, true);
        if (verb === null)
            continue;
        const name = basename(verb.value);
        if (name === "cd") {
            const target = args.filter((word) => !word.value.startsWith("-") || word.value === "-");
            if (target.length === 0)
                return { kind: "refused", reason: "a bare `cd` moves to the home folder" };
            if (target[0]?.value === "-") {
                note("`cd -` returns to a folder the parser cannot know", true, true);
                dir = null;
                continue;
            }
            // `cd` itself changes nothing; the folder it leaves is what the next segments are checked against.
            dir = resolveIn(dir, target[0]?.value ?? "", homes);
            if (!bPathOk(dir, context.project)) {
                tierB = false;
                outward = true;
            }
            continue;
        }
        if (HIDDEN.has(name)) {
            note(`\`${name}\` runs code or moves the shell in a way the guard cannot follow`, true, true);
            continue;
        }
        if (name === "git") {
            // `REV:path` (and `:path`) names a file inside a commit or the index; it is checked like a path.
            for (const word of args) {
                const spec = /^[^-:][^:]*:(?!\/\/)(.+)$|^:(?:[0-3]:)?(.+)$/u.exec(word.value);
                const inner = spec?.[1] ?? spec?.[2];
                if (inner === undefined)
                    continue;
                if (isProtectedFileName(basename(inner)))
                    return { kind: "refused", reason: `${word.value} names a secret file inside the repository` };
                const refusal = protectedWord(inner.includes("/") ? inner : `./${inner}`, dir, homes, context.env);
                if (refusal !== null)
                    return { kind: "refused", reason: refusal };
            }
            const gitForm = gitWritingForm(args);
            if (gitForm !== null) {
                const refusal = refuseWrites(args, dir, homes, context.env);
                if (refusal !== null)
                    return refusal;
                tierB = false;
                note(gitForm, true);
                continue;
            }
            assessGit(args, dir, context, homes, note, () => {
                tierB = false;
            });
            continue;
        }
        if (OUTWARD_TOOLS.has(name)) {
            note(`\`${name}\` may reach outside this machine or change it`, true);
            continue;
        }
        if (RUNNERS.has(name) || verb.value.includes("/")) {
            assessRunner(verb.value.includes("/") ? verb.value : name, args, dir, context, homes, note);
            tierB = false;
            for (const write of segment.writes)
                writeCheck(write, dir, context, homes, note, false);
            continue;
        }
        const inPlace = name === "sed" && args.some((word) => /^-[a-zA-Z]*i/u.test(word.value) || word.value.startsWith("--in-place"));
        const kind = inPlace ? "writer" : READERS.has(name) ? "reader" : WRITERS.has(name) ? "writer" : "unknown";
        const writingForm = kind === "reader" ? readerWritingForm(name, args) : null;
        if (writingForm !== null || ALWAYS_PARKED.has(name) || kind === "unknown") {
            // A verb that writes or runs something the guard does not follow: every operand is a possible write target.
            const refusal = refuseWrites(args, dir, homes, context.env) ??
                (ALWAYS_PARKED.has(name) ? refuseContaining(name, args, dir, homes, context) : null) ??
                (name === "find" && args.some((word) => word.value === "-delete")
                    ? refuseContaining(name, findRoots(args), dir, homes, context)
                    : null);
            if (refusal !== null)
                return refusal;
            tierB = false;
            if (writingForm !== null)
                note(writingForm, true);
            else if (ALWAYS_PARKED.has(name))
                note(`\`${name}\` changes files in a way the guard does not follow`, false);
            else
                note(`\`${name}\` is not a command the guard knows`, true);
            for (const write of segment.writes)
                writeCheck(write, dir, context, homes, note, false);
            continue;
        }
        if (kind === "reader") {
            tierB = false;
            const recursive = refuseRecursiveRead(name, args, dir, homes, context);
            if (recursive !== null)
                return recursive;
            const patterns = patternFiles(name, args);
            for (const file of patterns) {
                const path = resolveIn(dir, file, homes);
                if (path === null || !insideAny(path, context.roots))
                    note(`\`${name}\` reads its patterns from ${file}, outside the run's granted roots`, true);
            }
            for (const write of segment.writes)
                writeCheck(write, dir, context, homes, note, false);
            if (segment.writes.length > 0 && dir !== null && !insideAny(dir, [context.project])) {
                note("a write from a folder outside the project", true);
            }
            continue;
        }
        const refusal = refuseWrites(args, dir, homes, context.env) ??
            refuseContaining(name, args, dir, homes, context) ??
            refuseRecursiveRead(name, args, dir, homes, context);
        if (refusal !== null)
            return refusal;
        if (inPlace) {
            const files = args.filter((word, index) => index > 0 && !word.value.startsWith("-"));
            for (const file of files)
                writeCheck(file, dir, context, homes, note, true);
            tierB = false;
            continue;
        }
        const targets = writeTargets(name, args);
        for (const target of targets)
            writeCheck(target, dir, context, homes, note, !DELETERS.has(name));
        for (const write of segment.writes)
            writeCheck(write, dir, context, homes, note, false);
        if (DELETERS.has(name)) {
            const outside = targets.some((target) => {
                const path = resolveIn(dir, target.value, homes);
                return path === null || !insideAny(path, [context.project]) || inGit(path, context.project);
            });
            if (outside)
                note(`\`${name}\` deletes outside the project or inside .git`, true);
        }
        if (!bWriter(name, args, dir, context))
            tierB = false;
    }
    const tier = tierB && held === null && parsed.segments.length > 0 ? "B" : "X";
    return { kind: "assessed", mustPark, tier, held, outward: tier === "X" ? outward : false, why };
}
function assessGit(args, dir, context, homes, note, notB) {
    const first = args[0];
    if (first === undefined)
        return;
    if (first.value.startsWith("-")) {
        note("git with a global option (`-C`, `-c`, …) is not followed", true);
        notB();
        return;
    }
    const sub = first.value;
    const rest = args.slice(1);
    if (GIT_READS.has(sub)) {
        notB();
        return;
    }
    if (sub === "branch" &&
        rest.every((word) => /^(?:--list|-l|--show-current|-a|-r|-v|-vv|--all)$/u.test(word.value))) {
        notB();
        return;
    }
    if (sub === "worktree" && rest[0]?.value === "list") {
        notB();
        return;
    }
    // `git remote`, `-v` and `get-url` only print the local config; `show`, `update` and `prune` reach the remote
    // and the other subcommands change the config, so those stay outward.
    if (sub === "remote" &&
        (rest.every((word) => /^(?:-v|--verbose)$/u.test(word.value)) ||
            (rest[0]?.value === "get-url" &&
                rest.slice(1).every((word) => /^(?:--push|--all)$/u.test(word.value) || !word.value.startsWith("-"))))) {
        notB();
        return;
    }
    if (sub === "add") {
        const files = rest.filter((word) => !word.value.startsWith("-"));
        const flags = rest.filter((word) => word.value.startsWith("-") && word.value !== "--");
        const wide = flags.length > 0 || files.length === 0 || files.some((word) => word.value === "." || word.value === "*");
        if (wide) {
            note("`git add` without named files", false);
            notB();
            return;
        }
        for (const file of files) {
            const path = resolveIn(dir, file.value, homes);
            if (path === null || !insideAny(path, [context.project]) || inGit(path, context.project)) {
                note("`git add` names a path outside the project", true);
                notB();
                return;
            }
            if (!insideAny(path, context.roots))
                note("`git add` names a path outside the run's granted roots", false);
        }
        return;
    }
    notB();
    if (sub === "commit") {
        const allowed = commitAllowedHere(rest, dir, context);
        if (!allowed.ok)
            note(allowed.reason, false);
        return;
    }
    if (GIT_LOCAL.has(sub)) {
        note(`\`git ${sub}\` changes the repository`, false);
        return;
    }
    note(`\`git ${sub}\` may push, rewrite or reach outside`, true);
}
function commitAllowedHere(rest, dir, context) {
    const no = (reason) => ({ ok: false, reason });
    for (let index = 0; index < rest.length; index += 1) {
        const value = rest[index]?.value ?? "";
        if (value === "-m" || value === "-F" || value === "--message" || value === "--file") {
            index += 1;
            continue;
        }
        if (/^--(?:message|file)=/u.test(value))
            continue;
        if (/^-[aq]+$/u.test(value) || value === "--all" || value === "--quiet")
            continue;
        if (/^-[aq]*m./u.test(value))
            continue;
        return no(`\`git commit ${value}\` is not a plain charter commit`);
    }
    if (context.commitAllowed === undefined || dir === null)
        return no("a commit needs a consented `Run charter:` line");
    const repo = repoOf(dir);
    if (repo === null)
        return no("a commit outside a Git repository");
    const branch = headBranch(repo.gitDir);
    if (branch === null)
        return no("a commit on a detached HEAD");
    return context.commitAllowed(repo.root, branch)
        ? { ok: true }
        : no(`a commit on \`${branch}\` in ${repo.root} is not covered by a consented \`Run charter:\` line`);
}
/**
 * Runners. Only the repo's own test and check commands, the known test runners and a script runner on a file inside
 * the run's roots run without parking; anything else a runner does (install, fetch, `go run`, a script outside the
 * project, an unplanned package script) parks as X. A script inside the project can still do anything its author
 * wrote: that indirection is the documented residual.
 */
function assessRunner(name, args, dir, context, homes, note) {
    const first = args.find((word) => !word.value.startsWith("-"))?.value ?? "";
    const inRoots = (value) => {
        if (value.startsWith("-"))
            return false;
        const path = resolveIn(dir, value, homes);
        return path !== null && insideAny(path, context.roots);
    };
    if (name.includes("/")) {
        if (!inRoots(name))
            note(`the script ${name} is outside the run's granted roots`, true);
        else if (dir === null || !insideAny(dir, context.roots))
            note(`\`${name}\` runs outside the run's granted roots`, true);
        return;
    }
    const runnerNote = assessRunnerForm(name, first, args, inRoots, note);
    if (runnerNote !== null) {
        note(runnerNote, true);
        return;
    }
    if (dir === null || !insideAny(dir, context.roots))
        note(`\`${name}\` runs outside the run's granted roots`, true);
}
/** Why a runner call parks, or null when it is one of the forms that run; may note a hold itself. */
function assessRunnerForm(name, first, args, inRoots, note) {
    const held = runnerHeld(name, args);
    if (held !== null) {
        note(held, true, true);
        return held;
    }
    if (["npm", "pnpm", "yarn", "bun"].includes(name)) {
        if (PACKAGE_RELEASE.has(first))
            return `\`${name} ${first}\` changes a registry or an account`;
        if (args.some((word) => word.value === "-g" || word.value === "--global" || word.value === "--location=global"))
            return `\`${name}\` with a global install writes outside the project`;
        const script = first === "run" || first === "run-script"
            ? (args.find((w, i) => i > 0 && !w.value.startsWith("-") && w.value !== first)?.value ?? "")
            : first;
        if (RELEASE_SCRIPT.test(script))
            return `the package script \`${script}\` may release, push or delete`;
        if (first === "t" || OWN_CHECK.test(script))
            return null;
        if (name === "bun" && first !== "run" && /\.[cm]?[jt]sx?$/u.test(first)) {
            return inRoots(first) ? null : `the script ${first} is outside the run's granted roots`;
        }
        return `\`${name} ${first}\` is not one of the repo's own test or check commands`;
    }
    if (name === "make" || name === "just") {
        const targets = args.filter((word) => !word.value.startsWith("-") && !NAME_ASSIGNMENT.test(word.value));
        if (targets.some((word) => RELEASE_SCRIPT.test(word.value)))
            return `the \`${name}\` target may release, push or delete`;
        if (targets.length > 0 && targets.every((word) => OWN_CHECK.test(word.value)))
            return null;
        return `the \`${name}\` target is not one of the repo's own test or check targets`;
    }
    if (["cargo", "go", "deno", "swift", "dotnet", "mvn", "gradle"].includes(name)) {
        if (OWN_CHECK.test(first))
            return null;
        return `\`${name} ${first}\` is not one of the repo's own test or check commands`;
    }
    if (TEST_RUNNERS.has(name))
        return null;
    if (SCRIPT_RUNNERS.has(name)) {
        const script = scriptOperand(args);
        if (script === null)
            return null;
        return inRoots(script) ? null : `the script ${script} is outside the run's granted roots`;
    }
    return `\`${name}\` runs code the guard does not follow`;
}
/** Inline code or a nested shell: the hold reason, or null. */
function runnerHeld(name, args) {
    if ((name === "bash" || name === "sh" || name === "zsh") &&
        args.some((word) => /^-[a-z]*c[a-z]*$/u.test(word.value))) {
        return `a nested shell (\`${name} -c\`) hides the command it runs`;
    }
    if ((name === "node" ||
        name === "deno" ||
        name === "bun" ||
        name.startsWith("python") ||
        name === "perl" ||
        name === "ruby" ||
        name === "php") &&
        args.some((word) => /^-(?:e|c|p|r|-eval|-print)$/u.test(word.value))) {
        return `\`${name}\` with inline code hides what it runs`;
    }
    return null;
}
/** The script file an interpreter runs: its first operand after the flags, or null when it runs none. */
function scriptOperand(args) {
    for (let index = 0; index < args.length; index += 1) {
        const value = args[index]?.value ?? "";
        if (value === "--")
            return args[index + 1]?.value ?? null;
        if (value === "-m") {
            const module = args[index + 1]?.value ?? "";
            return module === "pytest" || module === "unittest" ? null : `-m ${module}`;
        }
        if (/^--(?:import|require|loader|experimental-loader)/u.test(value))
            return value;
        if (!value.startsWith("-"))
            return value;
    }
    return null;
}
/** Readers checked by an allowlist: getopt_long takes clusters (`-uo F`) and any unambiguous prefix (`--out`). */
const READER_FLAGS = {
    sort: {
        short: "bdfghiMnRrsuVzcC",
        shortValue: "ktS",
        long: [
            "ignore-leading-blanks",
            "dictionary-order",
            "ignore-case",
            "general-numeric-sort",
            "human-numeric-sort",
            "ignore-nonprinting",
            "month-sort",
            "numeric-sort",
            "random-sort",
            "reverse",
            "sort",
            "stable",
            "unique",
            "version-sort",
            "zero-terminated",
            "key",
            "field-separator",
            "check",
            "debug",
            "parallel",
            "buffer-size",
            "help",
            "version",
        ],
        forbidden: ["output", "compress-program", "temporary-directory", "files0-from", "random-source"],
    },
    file: {
        short: "bcEhikLNnprsv0dlS",
        shortValue: "efFmP",
        long: [
            "brief",
            "checking-printout",
            "exclude",
            "exclude-quiet",
            "files-from",
            "separator",
            "no-dereference",
            "dereference",
            "mime",
            "mime-type",
            "mime-encoding",
            "keep-going",
            "list",
            "magic-file",
            "no-pad",
            "print0",
            "parameter",
            "raw",
            "special-files",
            "extension",
            "apple",
            "no-buffer",
            "help",
            "version",
        ],
        forbidden: ["compile", "uncompress", "uncompress-noreport", "preserve-date"],
    },
};
function flagsAllowed(values, list) {
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index] ?? "";
        if (value === "--")
            return true;
        if (value.startsWith("--")) {
            const option = /^--([a-z0-9-]+)(?:=|$)/u.exec(value)?.[1];
            if (option === undefined)
                return false;
            if (list.forbidden.some((name) => name.startsWith(option)))
                return false;
            if (!list.long.some((name) => name.startsWith(option)))
                return false;
            continue;
        }
        if (!value.startsWith("-") || value === "-")
            continue;
        for (let at = 1; at < value.length; at += 1) {
            const letter = value[at] ?? "";
            if (list.shortValue.includes(letter)) {
                if (at === value.length - 1)
                    index += 1;
                break;
            }
            if (!list.short.includes(letter))
                return false;
        }
    }
    return true;
}
/** Why a known reader in this form writes a file or runs a program, or null for its read-only form. */
function readerWritingForm(name, args) {
    const values = args.map((word) => word.value);
    if (name === "sed")
        return sedReadOnly(values) ? null : "`sed` with a script that writes, reads or runs";
    const allowlist = READER_FLAGS[name];
    if (allowlist !== undefined && !flagsAllowed(values, allowlist))
        return `\`${name}\` with a flag outside its read-only list (it may write a file or run a helper program)`;
    if (name === "uniq") {
        const operands = values.filter((value, index) => !value.startsWith("-") && !/^-[fsw]$/u.test(values[index - 1] ?? ""));
        if (operands.length > 1)
            return "`uniq` with an output file";
    }
    if (name === "tree" && values.some((value) => /^-o|^-[a-zA-Z]*R/u.test(value)))
        return "`tree` writing files";
    if ((name === "rg" || name === "ripgrep") && values.some((value) => /^--(?:pre|hostname-bin)(?:=|$)/u.test(value)))
        return "`rg --pre` or `--hostname-bin` runs a program";
    // `+cmd` makes the pager run a command on open, and `!` inside one starts a shell.
    if ((name === "less" || name === "more") && values.some((value) => value.startsWith("+")))
        return `\`${name} +\` runs a pager command on open`;
    if (name === "jq" && values.some((value) => /\$ENV|\benv\b|input_filename|\$__loc__/u.test(value)))
        return "`jq` reading the environment or file names";
    if (name === "find" && values.some((value) => /^-(?:delete|exec|execdir|ok|okdir|fprint\w*|fls)$/u.test(value)))
        return "`find` with an action deletes, writes or runs other programs";
    return null;
}
/**
 * The folders a recursive reader walks: its path operands, or `null` for the current folder when it names none.
 * Empty when the call does not recurse.
 */
function recursiveRoots(name, args) {
    const values = args.map((word) => word.value);
    const flags = values.filter((value) => value.startsWith("-"));
    const plain = values.filter((value) => !value.startsWith("-"));
    const clustered = (letters) => flags.some((flag) => !flag.startsWith("--") && letters.test(flag));
    const long = (full) => flags.some((flag) => {
        const option = /^--([a-z-]+)(?:=|$)/u.exec(flag)?.[1];
        return option !== undefined && option.length >= 3 && full.startsWith(option);
    });
    const withPattern = () => {
        const named = flags.some((flag) => /^-[a-zA-Z]*[ef]|^--(?:regexp|file)/u.test(flag));
        const paths = named ? plain : plain.slice(1);
        return paths.length === 0 ? [null] : paths;
    };
    if (["grep", "egrep", "fgrep"].includes(name)) {
        return clustered(/r|R/u) || long("recursive") || long("dereference-recursive") ? withPattern() : [];
    }
    if (name === "rg" || name === "ripgrep")
        return flags.includes("--files") ? (plain.length === 0 ? [null] : plain) : withPattern();
    if (name === "find") {
        return findRoots(args).map((word) => word.value);
    }
    if (name === "tree")
        return plain.length === 0 ? [null] : plain;
    if (name === "ls")
        return clustered(/R/u) || long("recursive") ? (plain.length === 0 ? [null] : plain) : [];
    if (name === "diff")
        return clustered(/r/u) || long("recursive") ? plain : [];
    if (name === "cp") {
        if (!(clustered(/[rRa]/u) || long("recursive") || long("archive")))
            return [];
        // With -t/--target-directory every plain word may be a source, so none is dropped as the destination.
        return clustered(/t/u) || long("target-directory") ? plain : plain.slice(0, -1);
    }
    return [];
}
/** The start folders of a `find` call: every word before the first option or expression; none means `.`. */
function findRoots(args) {
    const roots = [];
    let leading = true;
    for (const word of args) {
        // The link options -H, -L and -P come before the start folders.
        if (leading && /^-[HLP]+$/u.test(word.value))
            continue;
        leading = false;
        if (word.value.startsWith("-") || word.value === "(" || word.value === "!")
            break;
        roots.push(word);
    }
    return roots.length === 0 ? [{ value: ".", raw: ".", flag: null, tildeUser: false }] : roots;
}
/** Refuse a recursive read (`grep -r`, `find`, `diff -r`, `cp -R` sources) of the home, the Codex home or a folder holding a secret folder. */
function refuseRecursiveRead(name, args, dir, homes, context) {
    for (const root of recursiveRoots(name, args)) {
        const path = root === null ? dir : resolveIn(dir, root, homes);
        if (path === null)
            continue;
        for (const variant of envVariants(context.env)) {
            const reason = ancestorReason(path, variant);
            if (reason !== null)
                return {
                    kind: "refused",
                    reason: `\`${name}\` would read ${root ?? "the current folder"} recursively, and it is ${reason}`,
                };
        }
    }
    return null;
}
/** The pattern files a `grep`-family call reads (`-f F`, `-fF`, `--file=F`, `--file F`); `-` is standard input. */
function patternFiles(name, args) {
    if (!["grep", "egrep", "fgrep", "rg", "ripgrep"].includes(name))
        return [];
    const files = [];
    for (let index = 0; index < args.length; index += 1) {
        const value = args[index]?.value ?? "";
        if (value === "-f" || value === "--file")
            files.push(args[index + 1]?.value ?? "");
        else if (value.startsWith("--file="))
            files.push(value.slice(7));
        else if (/^-[a-zA-Z]*f./u.test(value) && !value.startsWith("--"))
            files.push(value.slice(value.indexOf("f") + 1));
    }
    return files.filter((file) => file !== "" && file !== "-");
}
/** Why a git read in this form writes a file or runs a program, or null. */
function gitWritingForm(args) {
    const sub = args[0]?.value ?? "";
    const rest = args.slice(1).map((word) => word.value);
    // git's option parser takes any unambiguous prefix of a long option (`--out=F`), so prefixes count too.
    const longPrefixOf = (value, full) => {
        const option = /^--([a-z-]+)(?:=|$)/u.exec(value)?.[1];
        return option !== undefined && full.startsWith(option);
    };
    if (["diff", "log", "show", "whatchanged", "format-patch", "range-diff"].includes(sub) &&
        rest.some((value) => /^-o/u.test(value) || longPrefixOf(value, "output") || longPrefixOf(value, "output-directory")))
        return `\`git ${sub} --output\` writes a file`;
    if (sub === "grep" && rest.some((value) => /^-O/u.test(value) || longPrefixOf(value, "open-files-in-pager")))
        return "`git grep -O` runs a pager program";
    return null;
}
/** A sed call whose every script only prints, deletes, quits or substitutes (no w/W/e/r/R, no script file). */
function sedReadOnly(values) {
    const scripts = [];
    const operands = [];
    let named = false;
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index] ?? "";
        if (value === "-e" || value === "--expression" || /^-[nErsuz]+e$/u.test(value)) {
            const script = values[index + 1];
            if (script === undefined)
                return false;
            scripts.push(script);
            named = true;
            index += 1;
            continue;
        }
        if (value.startsWith("--expression=")) {
            scripts.push(value.slice("--expression=".length));
            named = true;
            continue;
        }
        if (/^-[nErsuz]+$/u.test(value))
            continue;
        if (["--quiet", "--silent", "--regexp-extended", "--posix", "--separate", "--null-data", "--unbuffered"].includes(value))
            continue;
        if (value.startsWith("-"))
            return false;
        operands.push(value);
    }
    if (!named) {
        const script = operands.shift();
        if (script === undefined)
            return false;
        scripts.push(script);
    }
    return scripts.every(sedScriptReadOnly);
}
function sedScriptReadOnly(script) {
    let i = 0;
    const at = (offset = 0) => script[i + offset] ?? "";
    const blank = () => {
        while (at() === " " || at() === "\t")
            i += 1;
    };
    const regex = (delimiter) => {
        while (i < script.length) {
            const c = at();
            if (c === "\\") {
                i += 2;
                continue;
            }
            if (c === "\n")
                return false;
            i += 1;
            if (c === delimiter)
                return true;
        }
        return false;
    };
    const address = () => {
        blank();
        const c = at();
        if (/[0-9]/u.test(c)) {
            while (/[0-9~]/u.test(at()))
                i += 1;
            return true;
        }
        if (c === "$") {
            i += 1;
            return true;
        }
        if (c === "/" || c === "\\") {
            const delimiter = c === "/" ? "/" : at(1);
            if (delimiter === "" || delimiter === "\n" || delimiter === "\\")
                return false;
            i += c === "/" ? 1 : 2;
            if (!regex(delimiter))
                return false;
            while (at() === "I" || at() === "M")
                i += 1;
        }
        return true;
    };
    while (i < script.length) {
        while (at() === ";" || at() === "\n" || at() === " " || at() === "\t")
            i += 1;
        if (i >= script.length)
            break;
        if (!address())
            return false;
        blank();
        if (at() === ",") {
            i += 1;
            if (at() === "+" || at() === "~")
                i += 1;
            if (!address())
                return false;
            blank();
        }
        if (at() === "!") {
            i += 1;
            blank();
        }
        const command = at();
        i += 1;
        if (command === "{" || command === "}")
            continue;
        if (command === "q" || command === "Q") {
            blank();
            while (/[0-9]/u.test(at()))
                i += 1;
        }
        else if (command === "s") {
            const delimiter = at();
            if (delimiter === "" || delimiter === "\\" || delimiter === "\n" || delimiter === " ")
                return false;
            i += 1;
            if (!regex(delimiter) || !regex(delimiter))
                return false;
            while (/[gpiImM0-9]/u.test(at()))
                i += 1;
        }
        else if (command !== "p" && command !== "d" && command !== "=")
            return false;
        blank();
        const after = at();
        if (after !== "" && after !== ";" && after !== "\n" && after !== "}")
            return false;
    }
    return true;
}
/** The first operand of a writing form that names a protected place (state, `.git` internals, a Codex home). */
function refuseWrites(words, dir, homes, env) {
    for (const word of words) {
        const eq = word.value.indexOf("=");
        const values = eq > 0 ? [word.value, word.value.slice(eq + 1)] : [word.value];
        for (const value of values) {
            if (value === "" || value.startsWith("-") || value.startsWith("/dev/"))
                continue;
            const target = resolveIn(dir, value, homes);
            if (target === null)
                continue;
            for (const variant of envVariants(env)) {
                const reason = protectedReason(target, "write", variant);
                if (reason !== null)
                    return { kind: "refused", reason: `${value} is ${reason}` };
            }
        }
    }
    return null;
}
/**
 * Refuse a remove, move or replace whose operand would take the run state, the Codex home or a secret folder with it
 * (`mv .litcodex x`, `rm -rf .`). A copy's sources are only read, and a destination that is an existing folder is
 * written into, not replaced, so neither counts.
 */
function refuseContaining(name, args, dir, homes, context) {
    const plain = args.filter((word) => !word.value.startsWith("-"));
    const last = plain.slice(-1);
    const operands = name === "cp" || name === "install" || name === "ln"
        ? last
        : name === "chmod" || name === "chown" || name === "chgrp"
            ? plain.slice(1)
            : name === "tar" || name === "patch" || name === "dd"
                ? []
                : plain;
    for (const word of operands) {
        const target = resolveIn(dir, word.value, homes);
        if (target === null)
            continue;
        if (word === last[0] && ["cp", "mv", "install", "ln"].includes(name) && plain.length > 1 && isFolder(target))
            continue;
        for (const variant of envVariants(context.env)) {
            const reason = containedReason(target, variant, [context.project]);
            if (reason !== null)
                return { kind: "refused", reason: `${word.value} is ${reason}` };
        }
    }
    return null;
}
function isFolder(path) {
    try {
        return lstatSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
function writeCheck(word, dir, context, homes, note, mayBeB) {
    if (word.value === "/dev/null" || word.value === "/dev/stdout" || word.value === "/dev/stderr")
        return;
    const target = resolveIn(dir, word.value, homes);
    if (target === null || !insideAny(target, [context.project])) {
        note(`it writes ${word.raw}, outside the project`, true);
        return;
    }
    if (inGit(target, context.project)) {
        note(`it writes ${word.raw}, inside .git`, true);
        return;
    }
    if (!insideAny(target, context.roots))
        note(`it writes ${word.raw}, outside the run's granted roots`, !mayBeB);
}
function writeTargets(name, args) {
    const plain = args.filter((word) => !word.value.startsWith("-"));
    if (name === "cp" || name === "mv" || name === "ln" || name === "install")
        return plain.slice(-1);
    if (name === "chmod" || name === "chown" || name === "chgrp")
        return plain.slice(1);
    if (name === "dd")
        return args
            .filter((word) => word.value.startsWith("of="))
            .map((word) => ({ ...word, value: word.value.slice(3) }));
    if (name === "patch")
        return [];
    return plain;
}
/** The tier-B check: the verb and its flags are on the allow-list and every path stays a fresh local one. */
function bWriter(name, args, dir, context) {
    if (dir === null)
        return false;
    const plain = args.filter((word) => !word.value.startsWith("-"));
    const flags = args.filter((word) => word.value.startsWith("-"));
    if (name === "touch")
        return (flags.length === 0 && plain.length > 0 && plain.every((w) => bPathOk(resolve(dir, w.value), context.project)));
    if (name === "mkdir") {
        return (flags.every((word) => word.value === "-p") &&
            plain.length > 0 &&
            plain.every((w) => bPathOk(resolve(dir, w.value), context.project)));
    }
    if (name === "cp" || name === "mv") {
        const allowed = name === "cp" ? /^-[rRp]+$/u : /^$/u;
        if (!flags.every((word) => allowed.test(word.value)) || plain.length < 2)
            return false;
        const sources = plain.slice(0, -1).map((w) => resolve(dir, w.value));
        const dest = resolve(dir, plain.at(-1)?.value ?? "");
        if (![...sources, dest].every((path) => bPathOk(path, context.project)))
            return false;
        if (present(dest)) {
            let isDir = false;
            try {
                isDir = lstatSync(dest).isDirectory();
            }
            catch {
                return false;
            }
            if (!isDir)
                return false;
            return sources.every((source) => !present(join(dest, basename(source))) && bPathOk(join(dest, basename(source)), context.project));
        }
        return true;
    }
    return false;
}
/** True when `path` is a fresh or existing local path: inside the project after links resolve, never in `.git`. */
function bPathOk(path, project) {
    if (path === null)
        return false;
    const abs = resolve(path);
    if (!insideAny(abs, [project]))
        return false;
    const rel = relative(project, abs);
    if (rel.split(sep).some((part) => part.toLowerCase() === ".git"))
        return false;
    let head = project;
    for (const part of rel.split(sep).filter(Boolean)) {
        head = join(head, part);
        let stat;
        try {
            stat = lstatSync(head);
        }
        catch {
            return true;
        }
        if (stat.isSymbolicLink()) {
            let real;
            try {
                real = realpathSync(head);
            }
            catch {
                return false;
            }
            if (!insideAny(real, [project]) || inGit(real, project))
                return false;
        }
    }
    try {
        const real = realpathSync(abs);
        return insideAny(real, [project]) && !inGit(real, project);
    }
    catch {
        return !present(abs);
    }
}
function present(path) {
    try {
        lstatSync(path);
        return true;
    }
    catch {
        return false;
    }
}
function inGit(path, project) {
    const rel = relative(project, path);
    return rel.split(sep).some((part) => part.toLowerCase() === ".git");
}
/** Strip prefixes such as `time`, `nice -n 5`, `NAME=value` or `env X=1`; report the first as a hold reason. */
function peel(words) {
    let index = 0;
    let prefixHeld = null;
    while (index < words.length) {
        const word = words[index];
        if (word === undefined)
            break;
        if (NAME_ASSIGNMENT.test(word.value) && word.flag === null) {
            prefixHeld ??= `an assignment (${word.raw}) before the command`;
            index += 1;
            continue;
        }
        const name = basename(word.value);
        if (!PREFIXES.has(name))
            break;
        prefixHeld ??= `the prefix \`${name}\` runs another program`;
        index += 1;
        // Skip the prefix's own options and operands: flags, NAME=value pairs, a duration, a niceness or a folder.
        while (index < words.length) {
            const next = words[index]?.value ?? "";
            if (next.startsWith("-") || NAME_ASSIGNMENT.test(next) || /^\d+[smhd]?$/u.test(next)) {
                index += 1;
                continue;
            }
            if (name === "chroot" && index > 0 && words[index - 1]?.value === "chroot") {
                index += 1;
                continue;
            }
            break;
        }
    }
    const verb = words[index] ?? null;
    return { verb, args: words.slice(index + 1), prefixHeld };
}
function protectedWord(value, dir, homes, env) {
    if (value.length === 0)
        return null;
    const eq = value.indexOf("=");
    if (eq > 0) {
        // `--flag=path` and `name=path` operands (`dd if=…`): the value is checked as a path too.
        const inner = protectedWord(value.slice(eq + 1), dir, homes, env);
        if (inner !== null || value.startsWith("-"))
            return inner;
    }
    if (value.startsWith("-"))
        return null;
    // Every word is read as a path in the folder the segment runs in, so a `cd` into a protected folder is followed
    // (`cd ~/.config/gh && cat hosts.yml`). With an unknown folder only words that look like paths are checked.
    if (dir === null &&
        !(value.includes("/") || value.startsWith(".") || value.startsWith("~") || isProtectedFileName(value))) {
        return null;
    }
    const path = resolveIn(dir ?? "/", value, homes);
    if (path === null)
        return null;
    for (const variant of envVariants(env)) {
        const reason = protectedReason(path, "read", variant);
        if (reason !== null)
            return `${value} is ${reason}`;
    }
    return null;
}
/** The env as given, plus the account's real home when the hook's HOME was replaced. */
function envVariants(env) {
    const real = realHome();
    const variants = [env];
    if (real !== null && real !== env["HOME"])
        variants.push({ HOME: real });
    return variants;
}
function homesOf(env) {
    const out = [];
    const home = env["HOME"];
    if (typeof home === "string" && isAbsolute(home))
        out.push(canonicalOf(home));
    const real = realHome();
    if (real !== null)
        out.push(canonicalOf(real));
    return [...new Set(out)];
}
function realHome() {
    try {
        const home = userInfo().homedir;
        return isAbsolute(home) ? home : null;
    }
    catch {
        return null;
    }
}
function resolveIn(dir, value, homes) {
    if (value === "~" || value.startsWith("~/")) {
        const home = homes[0];
        return home === undefined ? null : resolve(home, `.${value.slice(1)}`);
    }
    if (isAbsolute(value))
        return resolve(value);
    if (dir === null)
        return null;
    return resolve(dir, value);
}
/** `path` through every link, a dangling last one included; a link loop resolves inside no folder. */
function canonicalOf(path) {
    return resolveLinks(path) ?? join(sep, "\u0000link-loop");
}
function insideAny(path, roots) {
    const target = fold(canonicalOf(path));
    return roots.some((root) => {
        const rel = relative(fold(canonicalOf(root)), target);
        return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    });
}
function fold(value) {
    const nfc = value.normalize("NFC");
    return process.platform === "darwin" || process.platform === "win32" ? nfc.toLowerCase() : nfc;
}
/** The repository holding `dir`: its work-tree root and Git folder (a linked worktree's `.git` file is followed). */
export function repoOf(dir) {
    let current = canonicalOf(dir);
    for (let level = 0; level < 64; level += 1) {
        const marker = join(current, ".git");
        try {
            const stat = lstatSync(marker);
            if (stat.isDirectory())
                return { root: current, gitDir: marker };
            if (stat.isFile()) {
                const pointer = readFileSync(marker, "utf8").match(/^gitdir:[ \t]*(.+?)[ \t]*$/mu)?.[1];
                if (pointer === undefined)
                    return null;
                return { root: current, gitDir: isAbsolute(pointer) ? pointer : resolve(current, pointer) };
            }
            return null;
        }
        catch {
            // No marker here; look one level up.
        }
        const parent = dirname(current);
        if (parent === current)
            return null;
        current = parent;
    }
    return null;
}
/** The branch `HEAD` names, read from the file at call time; null for a detached or unreadable HEAD. */
export function headBranch(gitDir) {
    try {
        const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
        return head.match(/^ref: refs\/heads\/(.+)$/u)?.[1] ?? null;
    }
    catch {
        return null;
    }
}
// ── parsing ────────────────────────────────────────────────────────────────
const SEPARATORS = new Set(["&&", "||", ";", "|", "&", "\n", "|&"]);
/** Split a command into `&&`/`||`/`;`/`|` segments of words, with redirect targets apart. */
export function parse(command) {
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/u.test(command))
        return { segments: [], held: "a control character" };
    const tokens = [];
    let held = null;
    let value = "";
    let raw = "";
    let flag = null;
    let started = false;
    let tildeUser = false;
    const end = () => {
        if (started)
            tokens.push({ word: { value, raw, flag, tildeUser } });
        value = "";
        raw = "";
        flag = null;
        started = false;
        tildeUser = false;
    };
    const mark = (reason) => {
        flag ??= reason;
    };
    for (let i = 0; i < command.length; i += 1) {
        const c = command[i] ?? "";
        if (c === "'") {
            const close = command.indexOf("'", i + 1);
            if (close < 0)
                return { segments: [], held: "the quotes do not pair" };
            value += command.slice(i + 1, close);
            raw += command.slice(i, close + 1);
            started = true;
            i = close;
            continue;
        }
        if (c === '"') {
            let j = i + 1;
            let inner = "";
            for (; j < command.length && command[j] !== '"'; j += 1) {
                const d = command[j] ?? "";
                if ((d === "$" && command[j + 1] !== "?") || d === "`")
                    mark("an expansion");
                if (d === "\\")
                    mark("an escape");
                inner += d;
            }
            if (j >= command.length)
                return { segments: [], held: "the quotes do not pair" };
            value += inner;
            raw += command.slice(i, j + 1);
            started = true;
            i = j;
            continue;
        }
        if (c === " " || c === "\t") {
            end();
            continue;
        }
        if (c === "#" && !started)
            break;
        if (c === "\n" || c === ";" || c === "&" || c === "|" || c === "<" || c === ">" || c === "(" || c === ")") {
            end();
            const two = command.slice(i, i + 2);
            if (c === "(" || c === ")") {
                held ??= "a subshell";
                continue;
            }
            if (two === ">&" && /[0-9]/u.test(command[i + 2] ?? "")) {
                tokens.push({ op: ">&" });
                i += 2;
                continue;
            }
            if (two === "&&" || two === "||" || two === ">>" || two === "|&" || two === "&>") {
                tokens.push({ op: two });
                i += 1;
                continue;
            }
            tokens.push({ op: c });
            continue;
        }
        if ((c === "1" || c === "2") && !started && command[i + 1] === ">") {
            if (/^[12]>&[12]/u.test(command.slice(i, i + 4)))
                i += 3;
            continue;
        }
        if (c === "\\") {
            mark("an escape");
            value += command[i + 1] ?? "";
            raw += command.slice(i, i + 2);
            started = true;
            i += 1;
            continue;
        }
        if (c === "$" && command[i + 1] === "?") {
            // The last exit status reveals nothing and runs nothing, so a self-check may print it.
            value += "$?";
            raw += "$?";
            started = true;
            i += 1;
            continue;
        }
        if (c === "$" || c === "`")
            mark("an expansion");
        if (c === "*" || c === "?" || c === "[")
            mark("a glob");
        if (c === "{" || c === "}")
            mark("a brace");
        if (c === "~" && !started) {
            const after = command[i + 1] ?? "";
            if (after !== "" && after !== "/" && after !== " " && after !== "\t")
                tildeUser = true;
            mark("a `~` path");
        }
        value += c;
        raw += c;
        started = true;
    }
    end();
    const segments = [];
    let words = [];
    let writes = [];
    let reads = [];
    let pending = null;
    let lastOp = null;
    const soft = (op) => op === ";" || op === "&" || op === "\n";
    for (const token of tokens) {
        if ("op" in token) {
            if (token.op === ">&") {
                pending = null;
                continue;
            }
            if (!SEPARATORS.has(token.op)) {
                if (pending !== null)
                    held ??= "a redirect with no target";
                pending = token.op === "<" ? "read" : "write";
                continue;
            }
            if (pending !== null)
                held ??= "a redirect with no target";
            pending = null;
            if (words.length === 0 && writes.length === 0) {
                // A blank line is fine; any other separator with nothing before it is an empty step.
                if (!(token.op === "\n" && (lastOp === null || soft(lastOp))))
                    held ??= "an empty step";
            }
            else
                segments.push({ words, writes, reads });
            words = [];
            writes = [];
            reads = [];
            lastOp = token.op;
            continue;
        }
        if (pending === "write")
            writes.push(token.word);
        else if (pending === "read")
            reads.push(token.word);
        else
            words.push(token.word);
        pending = null;
    }
    if (pending !== null)
        held ??= "a redirect with no target";
    if (words.length > 0 || writes.length > 0)
        segments.push({ words, writes, reads });
    else if (lastOp !== null && !soft(lastOp))
        held ??= "an empty step";
    if (segments.length === 0)
        held ??= "an empty step";
    return { segments, held };
}
