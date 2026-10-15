// test/vitest-setup.ts — every test file gets its own temporary Codex home.
//
// The hooks write the LIT card's thread pointer under the Codex home they see. A test that calls a hook
// without its own environment would otherwise write into the developer's real one.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = realpathSync(mkdtempSync(join(tmpdir(), "litcodex-test-codex-home-")));
process.env["CODEX_HOME"] = home;
afterAll(() => rmSync(home, { recursive: true, force: true }));
