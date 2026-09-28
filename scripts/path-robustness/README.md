# Path-robustness suite (M20 / plan T24)

`npm run qa:path-robustness` proves every LitCodex executable surface — the self-contained
`litcodex-ai` installer bin, the `lit-loop` plugin `cli.js` (hook + loop), and the durable
`.litcodex/lit-loop` state store — behaves correctly when the repo, the working directory, and the
bundled `directive.md` all live at **hostile filesystem paths** (spaces, `#`, Korean 한글, percent
bytes, a trailing dot, a symlink hop, a non-git "archive" layout, and a nested-git-parent layout).

It also runs a **static path-fragility lint** over the source: any `import.meta.url` `.pathname`
access or `repoRoot`-from-module-url derivation is a hard gate (the fix is always `fileURLToPath`).

## Run

```sh
npm run build                 # the harness needs the built dist/ first
npm run qa:path-robustness  # the gate: scan + the hostile-path matrix
```

Exit codes: `0` scan clean and every non-skipped case passes; `1` a case failed; `2` a forbidden
path pattern was found; `3` build artifacts absent (run `npm run build`); `4` a scan root is missing.

## Standalone static lint

```sh
node scripts/path-robustness/no-import-meta-pathname.mjs           # real src: exit 0 = clean
node scripts/path-robustness/no-import-meta-pathname.mjs <root...>  # exit 2 on any hit
```

## Env knobs

| Env var | Effect |
| --- | --- |
| `LIT_PATHROBUST_ONLY=<label>` | Run only one case (e.g. `space-hash-hangul`) plus the scan. |
| `LIT_PATHROBUST_KEEP=1` | Do NOT `rm -rf` the temp workspaces (post-mortem inspection). |
| `LIT_PATHROBUST_BASE=<dir>` | Override the `mkdtemp` base volume. |
| `LIT_PATHROBUST_EVIDENCE_DIR=<dir>` | Where to write `task-24-report.json` (default `.litcodex/evidence`). |

## Evidence

The full machine-readable `PathRobustnessReport` is written to
`.litcodex/evidence/task-24-report.json` (`{ ok, node, platform, scan, cases[], skipped[] }`).
stdout is a greppable one-line-per-case table plus a final tally.

## A3 corrections baked in

- **Install dry-run asserts the SELF-CONTAINED M12 plan** (the `litcodex install plan (Codex)` header
  + ordered `InstallStep` titles, imported from the built `litcodex-ai` dist), **never an npx
    forwarder line** (A3 D1 supersedes the M20-addendum §A1 forwarder golden). The litcodex-ai `dist/`,
  `package.json`, `model-catalog.json`, and the bundled `node_modules/@litcodex/lit-loop` are staged
  into each hostile workspace so the self-contained bin runs.
- **Directive resolves via `../directive.md`** — the authored component-root file shipped in
  `files[]` — staged as a `dist/`-sibling, NOT a `dist/directive.md` copy (A3 G6 supersedes C8).
- Symlink / Windows-hostile cases **self-skip** (not fail) when the OS rejects the leaf or symlink.
