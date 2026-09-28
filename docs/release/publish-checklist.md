# LitCodex npm Publish Checklist (human-gated)

This checklist mirrors `npm run release:check` and the actual root `release` / `release:dry` scripts.
Only `@litfamily/litcodex` may be published. `@litcodex/lit-loop` is private and is validated only because it
must remain packable as the installer's bundled dependency.

> The registry-changing command is HUMAN-ONLY. No acceptance command invokes it. Passing this
> checklist does not replace final user approval.

## Fresh release bootstrap order

Run this sequence from a fresh checkout or disposable clean copy. Do not skip ahead or reorder it:

```bash
npm ci --ignore-scripts
npm run build
git status --short
npm run release:check
VERSION="$(node -p 'require("./packages/litcodex-ai/package.json").version')"
npm view "@litfamily/litcodex@${VERSION}" version --json
npm whoami
test -n "$NPM_OTP"
npm run release:dry
```

`git status --short` must print nothing. The npm workspace install removes the tracked vendored rules
copy at `plugins/litcodex/components/rules/node_modules/picomatch` while reconstructing workspaces.
That deletion after `npm ci --ignore-scripts` is expected and dirty; `npm run build` runs the
postbuild vendor step and restores picomatch deterministically before the clean-tree assertion.
`release:check` does not run the product build before its worktree-clean operation and must never be
used as a substitute for this bootstrap build. The exact-version `npm view` must return `E404`, and
the authentication gates must succeed, before `npm run release:dry` is allowed.

## Automated non-shipping gates

1. **Clean worktree** — `release:check` step `worktree-clean` first runs a read-only, no-renames
   porcelain status check that includes all untracked files. Modified tracked, staged, or untracked
   files block the release; ignored files do not. Inherited Git repository, worktree, common-dir,
   index, and object-store overrides are cleared so they cannot redirect the check. If Git cannot
   verify the repository state, the check fails closed. This gate runs before `.litcodex/evidence`
   is created.

2. **Version lockstep**
   ```bash
   npm run check:version
   ```
   `version-lockstep` must report every guarded manifest aligned at the exact release version.

3. **Legacy-token scan**
   ```bash
   npm run scan:legacy-tokens
   ```
   Findings in a tracked or packed release surface are hard blockers.

4. **Docs audit**
   ```bash
   npm run docs:audit
   ```

5. **Tracked marketplace distribution**
   ```bash
   npm run check:marketplace-dist:tracked
   ```
   This mirrors `release:check` step `marketplace-dist-tracked`. The installer workspace invokes the
   complete `release:check` from `prepublishOnly`, so the clean-worktree guard always runs before this
   step on both real and dry-run publication lifecycles. Ordinary `npm run check` uses candidate mode.

6. **Final package payload**
   ```bash
   npm run pack:final
   ```
   `release:check` invokes this same `--require-future` payload gate. It source-builds the installer
   during prepack, requires `dist/cli.js` and `dist/postinstall.js` in every mode, checks declared npm
   bins as regular executable tar entries, and verifies the marketplace plus bundled private
   `@litcodex/lit-loop` dependency without local state or package archives. A normal development
   `npm pack` does not run `prepublishOnly`, but it still clean-builds source and fails closed if the
   build or required source input is invalid.

7. **Stable semver** — `VERSION` must be an exact stable `MAJOR.MINOR.PATCH`.

8. **Shippable installer** — `packages/litcodex-ai/package.json` must not contain `private: true`;
   `plugins/litcodex/components/lit-loop/package.json` must contain it.

Run the aggregate preflight, which writes ignored evidence only after the clean-worktree gate passes
and never publishes:

```bash
npm run release:check
```

Proceed only when it prints `release:check: READY at <VERSION>` with `publishAttempted: false`.

## Manual repository and registry gates

The npm package carries its own README pair, `packages/litcodex-ai/README.md` and `README-Ko-KR.md`: a short
install card whose images load from jsDelivr at the exact package version. The repository README pair is the
full GitHub page and loads everything by relative path. A version bump moves the jsDelivr pins in both package
READMEs; `node --test tools/readme.test.mjs` fails on a stale pin, a relative target or a missing GitHub guide link.

9. Confirm factual repository metadata and exact refs. The configured remote must be
   `https://github.com/wjgoarxiv/litcodex.git`, the branch must be `main`, and all three hashes must
   match. `git status --short` must print nothing.

   ```bash
   git status --short
   git rev-parse HEAD
   git rev-parse origin/main
   git ls-remote origin refs/heads/main
   ```

10. Confirm the dated `CHANGELOG.md` section matches `VERSION`, then prove the exact registry target
   is absent. The `npm view` command must return `E404`; any existing version is a hard stop.

   ```bash
    VERSION="$(node -p 'require("./packages/litcodex-ai/package.json").version')"
   npm view "@litfamily/litcodex@${VERSION}" version --json
   ```

11. Authenticate without logging secrets and rerun the real root dry-run script. npm runs the
    installer `prepublishOnly` lifecycle here, so a dirty source tree is blocked before prepack or
    package evidence is produced:

   ```bash
   npm whoami
   test -n "$NPM_OTP"
   npm run release:dry
   ```

12. Choose the provenance path honestly. Use trusted publishing only when its repository/workflow
    configuration is verified. If it is unavailable, use the manual OTP fallback below; do not claim
    OIDC provenance for that fallback.

13. Present the final evidence packet and obtain final user approval for the registry mutation.

## Gated manual fallback (HUMAN-ONLY)

If no verified trusted-publishing workflow is available, and only after every gate above plus final
user approval, publish the sole public workspace through the actual root release script:

```bash
npm run release -- --access public --otp="$NPM_OTP"
```

After publication, verify the exact version and dist-tag before considering any separately approved
tag or GitHub release. Never publish `@litcodex/lit-loop` or another workspace.
