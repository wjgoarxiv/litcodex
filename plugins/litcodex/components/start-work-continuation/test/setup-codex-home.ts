// The hooks keep their tamper-evident seals under the Codex home of the process. Tests never touch the real one:
// every test file gets a throwaway CODEX_HOME before any hook runs.

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = realpathSync(mkdtempSync(join(tmpdir(), "start-work-codex-home-")));
process.env["CODEX_HOME"] = home;
afterAll(() => rmSync(home, { recursive: true, force: true }));
