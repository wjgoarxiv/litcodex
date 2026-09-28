#!/usr/bin/env python3
"""Pack/install LitCodex, then exercise the real installer with bounded PTY input.

Run serially: npm pack rebuilds the workspace. Requires POSIX PTYs, Python 3,
and the repository's pinned Codex CLI; no authenticated model calls are made.
All profiles, npm state, transcripts and receipts stay in the ignored repo state.
"""

import errno
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
QUESTION = re.compile(r"Select 0-\d+ \[\d+\]: |  Press Enter to install · Ctrl-C to abort: ")


def model_prompts():
    catalog_path = ROOT / "packages/litcodex-ai/model-catalog.json"
    catalog = json.loads(catalog_path.read_text())
    prompts = []
    for role in ("lead", "helper"):
        row_count = sum(
            len(model.get("installer_menu", {}).get(role, []))
            for model in catalog.get("models", [])
            if model.get("visibility") == "list"
        )
        if row_count < 1:
            raise ValueError(f"model catalog has no {role} installer menu rows")
        prompts.append((f"Select 0-{row_count - 1} [0]: ", ""))
    return prompts


MODEL_PROMPTS = model_prompts()
STYLE_PROMPT = [("Select 0-4 [0]: ", "3")]
CONFIRM = [("  Press Enter to install · Ctrl-C to abort: ", "")]
ALL_PROMPTS = MODEL_PROMPTS + STYLE_PROMPT + CONFIRM


def environment(sandbox):
    # An allowlist prevents ambient credentials, config and npm options escaping isolation.
    env = {key: os.environ[key] for key in ("PATH", "SystemRoot") if key in os.environ}
    for name in ("home", "codex", "tmp", "cache", "config", "data"):
        (sandbox / name).mkdir(parents=True, exist_ok=True)
    env.update({
        "PATH": str(ROOT / "node_modules/.bin") + os.pathsep + env.get("PATH", ""),
        "HOME": str(sandbox / "home"),
        "CODEX_HOME": str(sandbox / "codex"),
        "TMPDIR": str(sandbox / "tmp"),
        "XDG_CACHE_HOME": str(sandbox / "cache"),
        "XDG_CONFIG_HOME": str(sandbox / "config"),
        "XDG_DATA_HOME": str(sandbox / "data"),
        "npm_config_cache": str(sandbox / "npm-cache"),
        "npm_config_userconfig": str(sandbox / "npmrc"),
        "npm_config_globalconfig": str(sandbox / "global-npmrc"),
        "LITCODEX_NO_UPDATE_NOTIFIER": "1",
        "TERM": "xterm-256color", "COLORTERM": "truecolor", "LC_ALL": "en_US.UTF-8",
    })
    return env


def run_pty(command, cwd, env, expected):
    master, slave = pty.openpty()
    child = None
    output = bytearray()
    answered = []
    failures = []
    try:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdin=slave, stdout=slave,
                                 stderr=slave, start_new_session=True)
        os.close(slave)
        slave = None
        deadline = time.monotonic() + 60
        while True:
            if time.monotonic() > deadline:
                failures.append("installer exceeded 60-second deadline")
                break
            readable, _, _ = select.select([master], [], [], 0.1)
            if not readable:
                if child.poll() is not None:
                    break
                continue
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
            if not chunk:
                break
            output.extend(chunk)
            if len(output) > 2_000_000:
                failures.append("installer exceeded transcript bound")
                break
            plain = ANSI.sub("", output.decode("utf-8", errors="replace"))
            questions = QUESTION.findall(plain)
            if len(questions) > len(answered):
                index = len(answered)
                if index >= len(expected) or questions[index] != expected[index][0]:
                    failures.append(f"unexpected prompt: {questions[index]!r}")
                    break  # Never answer a forbidden prompt just to get a green exit.
                os.write(master, (expected[index][1] + "\n").encode())
                answered.append(questions[index])
        if not failures:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                failures.append("installer did not exit after PTY closed")
    finally:
        if child is not None:
            # Also stop any child still holding the terminal after the installer exits.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        os.close(master)
        if slave is not None:
            os.close(slave)
    if len(answered) != len(expected):
        failures.append(f"answered {len(answered)}/{len(expected)} expected prompts")
    return child.returncode, bytes(output), answered, failures


def probe(binary, sandbox, evidence, case):
    name, flags, extra_env, expected, color, blocks, style = case
    directory = sandbox / name
    env = environment(directory)
    env.update(extra_env)
    project = directory / "project"
    project.mkdir()
    command = [str(binary), "install", *flags]
    if name == "non-tty":
        result = subprocess.run(command, cwd=project, env=env, input=b"", stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=60, check=False)
        code, output, answered, failures = result.returncode, result.stdout, [], []
    else:
        code, output, answered, failures = run_pty(command, project, env, expected)
    (evidence / f"{name}.txt").write_bytes(output)
    plain = ANSI.sub("", output.decode("utf-8", errors="replace")).replace("\r", "")
    escapes = output.count(b"\x1b")
    has_blocks = bool(re.search("[\u2580-\u259f]", plain))
    config = Path(env["CODEX_HOME"]) / "config.toml"
    installed = config.is_file() and (Path(env["CODEX_HOME"]) / "plugins/cache/litcodex/litcodex").is_dir()
    dry_run = "--dry-run" in flags
    if code != 0:
        failures.append(f"exit {code}, expected 0")
    if installed == dry_run:
        failures.append(f"installed={installed}, dryRun={dry_run}")
    if bool(escapes) != color:
        failures.append(f"escape count {escapes}, color expected={color}")
    if color and b"\x1b[38;2;" not in output:
        failures.append("positive color control lacks truecolor SGR")
    if has_blocks != blocks:
        failures.append(f"blocks={has_blocks}, expected={blocks}")
    if not blocks and "--no-tui" not in flags and "--json" not in flags and "LIT" not in plain.splitlines():
        failures.append("plain LIT wordmark line missing")
    if not expected and (QUESTION.search(plain) or "Choose an output style" in plain):
        failures.append("noninteractive invocation printed a picker")
    config_text = config.read_text() if config.is_file() else ""
    actual_style = re.search(r'^litcodex_output_style = "([^"]+)"$', config_text, re.M)
    actual_style = actual_style[1] if actual_style else None
    if actual_style != style:
        failures.append(f"persisted style={actual_style!r}, expected={style!r}")
    return {"name": name, "exitCode": code, "ok": not failures, "failures": failures,
            "escapeCount": escapes, "blocks": has_blocks, "promptsAnswered": answered,
            "installed": installed, "style": actual_style}


def main():
    evidence_root = ROOT / ".litcodex/installer-tty-policy"
    evidence_root.mkdir(parents=True, exist_ok=True)
    evidence = Path(tempfile.mkdtemp(prefix="run-", dir=evidence_root))
    sandbox = evidence / "sandbox"
    env = environment(sandbox)
    receipt = {"cases": [], "setup": [], "cleaned": False}

    def setup(name, command, cwd):
        result = subprocess.run(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=180, check=False)
        (evidence / f"{name}.stdout").write_bytes(result.stdout)
        (evidence / f"{name}.stderr").write_bytes(result.stderr)
        receipt["setup"].append({"name": name, "exitCode": result.returncode})
        if result.returncode:
            raise RuntimeError(f"{name} failed: exit {result.returncode}")
        return result.stdout

    try:
        codex = ROOT / "node_modules/.bin/codex"
        receipt["codex"] = setup("codex-version", [str(codex), "--version"], sandbox).decode().strip()
        pack_dir = sandbox / "pack"
        pack_dir.mkdir()
        packed = json.loads(setup("pack", ["npm", "pack", "--workspace=packages/litcodex-ai",
                                "--pack-destination", str(pack_dir), "--json"], ROOT))[0]
        tarball = pack_dir / packed["filename"]
        receipt["packageSha256"] = hashlib.sha256(tarball.read_bytes()).hexdigest()
        receipt["packageFiles"] = len(packed["files"])
        prefix = sandbox / "prefix"
        setup("npm-install", ["npm", "install", "-g", "--prefix", str(prefix), "--offline",
                              "--no-audit", "--no-fund", str(tarball)], sandbox)
        binary = prefix / "bin/litcodex"
        cases = [
            ("yes-ci-empty", ["--yes"], {"CI": ""}, [], False, True, None),
            ("yes-no-color-empty", ["--yes"], {"NO_COLOR": ""}, [], False, True, None),
            ("yes-dumb", ["--yes"], {"TERM": "dumb"}, [], False, False, None),
            ("yes-non-utf8", ["--yes"], {"LC_ALL": "C"}, [], False, False, None),
            ("ci-empty", [], {"CI": ""}, [], False, True, None),
            ("explicit-style", ["--yes", "--style", "eli5"], {"NO_COLOR": ""}, [], False, True, "eli5"),
            ("non-tty", [], {}, [], False, True, None),
            ("yes-color", ["--yes"], {}, [], True, True, None),
            ("interactive-color", [], {}, ALL_PROMPTS, True, True, "eli5"),
            ("interactive-no-color", [], {"NO_COLOR": ""}, ALL_PROMPTS, False, True, "eli5"),
            ("interactive-dumb", [], {"TERM": "dumb"}, ALL_PROMPTS, False, False, "eli5"),
            ("interactive-non-utf8", [], {"LC_ALL": "C"}, ALL_PROMPTS, False, False, "eli5"),
            ("interactive-explicit-style", ["--style", "eli5-ko"], {}, MODEL_PROMPTS + CONFIRM, True, True, "eli5-ko"),
            ("no-tui", ["--no-tui"], {}, [], False, False, None),
            ("json", ["--json"], {}, [], False, False, None),
            ("dry-run", ["--dry-run"], {}, [], False, True, None),
        ]
        for case in cases:
            result = probe(binary, sandbox, evidence, case)
            receipt["cases"].append(result)
            print(f"{'PASS' if result['ok'] else 'FAIL'} {result['name']}: {result['failures']}", flush=True)
    except Exception as error:
        receipt["error"] = str(error)
    finally:
        shutil.rmtree(sandbox)
        receipt["cleaned"] = not sandbox.exists()
        receipt["ok"] = (not receipt.get("error") and len(receipt["cases"]) == 16
                         and all(case["ok"] for case in receipt["cases"]) and receipt["cleaned"])
        (evidence / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(f"Evidence: {evidence.relative_to(ROOT)}/receipt.json", flush=True)
        if receipt.get("error"):
            print(receipt["error"], flush=True)
    return 0 if receipt["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
