# AGENTS.md — LitCodex

Family-wide rules live in the umbrella `AGENTS.md`. Read that first if you started here; an agent
launched inside this directory does not see it automatically.

This file covers only what differs in this repository.

## What this is

LitCodex — the **Codex CLI** port of the lit workflow family. npm package `@litfamily/litcodex`.
TypeScript, Node ≥22, Vitest, Biome, npm workspaces. Branch `master`.

**You are already in the right place.** The git root is this directory. The parent wrapper is only
holding archives and local state — it has no git history and no package. Every command below must
run from here, never from the parent.

## Entry points

| Surface | Path |
|---|---|
| Plugin manifest | `plugins/litcodex/.codex-plugin/` |
| Workflow components | `plugins/litcodex/components/<name>/src/` |
| Skills | `plugins/litcodex/skills/<id>/` |
| Installer / skill catalog | `packages/litcodex-ai/src/install/` |
| Repo tooling and scanners | `tools/` |

## Verification

```bash
npm run check        # aggregate: workspaces + typecheck + lint + Vitest + token scan + dist
npm run build        # NOTE: starts with `tsc --build --clean`
npm run test
npm run docs:audit
npm run hygiene:git
```

Two traps:

- **`npm run build` empties `dist/` first.** A test run racing against a build fails with
  `ENOENT … components/lit-loop/dist` or a missing `loop-doctor-render.js`. This is not a
  regression. Re-run serially.
- **Do not pipe a suite through `| tail`** — `$?` then reports tail's exit code, not the
  suite's. Redirect to a file instead.

Test scripts and the installer QA scripts enter `scripts/run-isolated-tests.mjs`, which gives
children disposable HOME, CODEX_HOME, XDG, npm and migration-state paths. On macOS, its native
sandbox also denies writes in the original home outside this worktree, its Git admin directory and
shared object store, and denies all original CODEX_HOME writes, including from subprocesses that discard
their environment. Other platforms use the
disposable environment and profile-discovery regression tests; the macOS OS guard is platform-specific.
For an ad-hoc test, use `node scripts/run-isolated-tests.mjs <command> [args...]` as well. Never point
test fixtures at an actual user profile. The installer migration must not scan parents of CODEX_HOME.

`dist/` directories under `plugins/litcodex/components/*/` are generated **but tracked**.
Rebuild rather than hand-editing them, and expect them in release diffs.

## The brand-hygiene scanner

`npm run scan:legacy-tokens` enumerates every tracked or untracked-non-ignored text file and
fails on seven guarded legacy tokens, reconciled against `tools/legacy-token-allowlist.json`.
Two of them match as **case-insensitive substrings**, which has a non-obvious consequence:

> Some sibling product names in this family cannot be written anywhere in this repository,
> because a guarded token is a substring of the product name.

Refer to sibling ports generically ("the sibling harness ports") rather than by name. Read
`tools/scan-legacy-tokens.mjs` for the exact token set — it assembles them from fragments so
the scanner never flags its own source. Re-run the scan after any prose change.

## Do not touch

- `# REFERENCE/` in the parent wrapper is a read-only legacy archive (the name literally
  starts with `# `, so quote it in shell).
- `.litclaude/rules/session-*.json` is dogfooding session state, deliberately untracked.
- `HANDOFF.md` in this directory and in the parent wrapper are **deprecated**. The
  authoritative handoff is `HANDOFF.md` at the family root.

## Packaging — read before touching `.gitignore`

This package has no `files[]` allowlist. npm resolves ignores as
`files[]` → `.npmignore` → `.gitignore`, so publication is now governed by **`.npmignore`**,
and the `.gitignore` fallback is **disabled**. Consequences:

- Adding a rule to `.gitignore` no longer keeps anything out of the registry. **Mirror every
  new rule into `.npmignore`**. Shared local-state exclusions must agree in both files.
  Publication-only exclusions for historical `cover.png` and `generate_cover.py` paths,
  `docs/assets/`, and release operations stay only in `.npmignore`. Obsolete root artwork
  and its generator are archived outside this repository; the active cover remains in Git.
- `.npmignore` carries the same load-bearing negations as `.gitignore`
  (`!plugins/litcodex/components/*/dist/`, the vendored picomatch, the canonical lit-handoff
  source assets). Dropping one silently breaks the marketplace channel, where
  `codex plugin add` copies the tree verbatim with no build step.
- Verify any change with `npm pack --dry-run --json` and read `[0].files`. Do **not** parse the
  human-readable listing — it wraps long paths, which silently corrupts a diff.
  Baseline: **1216** files. Deleting `.npmignore` yields 1217; the difference is exactly
  `AGENTS.md`, which is how the switch was proven behavior-preserving.

`AGENTS.md` itself is tracked in git and excluded from the registry by `.npmignore`.
README covers use `docs/assets/cover-motion.webp`, with `docs/assets/cover-motion-still.webp` as the
reduced-motion still; both are excluded from npm, and the package README loads the copies in
`packages/litcodex-ai/readme-assets/`. The older `docs/assets/cover.svg` and `cover.webp` stay in Git
but are no longer shown. The SVG uses explicit vector paths and outlined glyphs. The small native
plugin icon at `plugins/litcodex/assets/logo.png` remains required in the runtime payload.

Separately, `.litclaude/` session state written here by a sibling lit tool was shipping in the
tarball (3 files) until 2026-08-01. It is now ignored in both files. Note that the equivalent
directory for one other sibling harness **cannot be named in either ignore file**, because its
name contains a guarded legacy token — see the scanner section above.
