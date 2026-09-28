# LitCodex Release Provenance & Publish Policy

This is the binding publish policy for `@litfamily/litcodex`. It is the only npm publication target.
`@litcodex/lit-loop` is `private: true`; release packing validates it because the installer bundles
that component, not because it may be published separately.

## Release scripts and non-shipping gates

The root manifest deliberately exposes two human-invoked publication surfaces:

- `npm run release:dry` expands to a dry run for the `@litfamily/litcodex` workspace; npm still executes
  `prepublishOnly`, so it is a clean-source-only publication lifecycle.
- `npm run release` expands to `npm publish -w @litfamily/litcodex`.

No build, test, `npm run check`, `npm run release:check`, or other acceptance command invokes
`npm run release`. `tools/release/` remains non-shipping and records `publishAttempted: false`.
Do not publish merely because those checks pass.

## Fresh release bootstrap order

Every release candidate must start from a fresh checkout or disposable clean copy and run these
commands in order:

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

`git status --short` must be empty. npm workspace installation removes the tracked vendored rules
copy at `plugins/litcodex/components/rules/node_modules/picomatch` while rebuilding the workspace
layout, so the deletion immediately after `npm ci --ignore-scripts` is expected. The normal build's
postbuild step restores picomatch deterministically. `release:check` does not run the product build
before worktree-clean and therefore cannot repair or conceal that deletion. The exact-version
registry query must return `E404`, followed by successful authentication gates, before the dry-run
publication lifecycle may begin.

Before either publication path is considered, the candidate must have exact version lockstep, a
clean tree, local/remote/live HEAD alignment on `main`, a clean legacy-token scan, tracked
marketplace verification, a complete pack payload, and registry evidence that the exact
`@litfamily/litcodex@<VERSION>` target is absent.

The installer package's `prepublishOnly` invokes the complete non-shipping `release:check`, whose
first operation is the clean-worktree guard. Its pack step runs `pack:final` semantics with
`--require-future`; installer prepack then clean-builds source before bundling. This makes stale
ignored output unusable and requires `dist/cli.js`, `dist/postinstall.js`, and regular executable npm
bin metadata. Ordinary developer `npm pack` intentionally skips `prepublishOnly` but retains the
source build and package-payload checks; it is not evidence that a dirty tree is publishable.

The ordinary CI installed-host lane is credentialless: the exact root
`@openai/codex@0.144.0` development dependency supplies `node_modules/.bin/codex`, CI verifies that
version and passes its absolute path as `CODEX_BIN`, and the doctor-scope probe drives the packed,
globally installed `litcodex` public install and doctor commands in an isolated home. This evidence
does not claim authenticated model execution. Full model-host evidence is a separate local or
credentialed run that fails closed when authentication is unavailable.

## Trusted publishing when configured

When npm trusted publishing is configured for this repository and its workflow is verified, prefer
that path. The workflow should be manually dispatched, use `permissions: id-token: write`, and run
`npm publish -w @litfamily/litcodex --provenance --access public` only after reproducing every release gate.
This repository does not treat the presence or success of such a workflow as established evidence;
verify it before relying on OIDC or claiming provenance.

## Guarded manual fallback

If no verified trusted-publishing workflow is available, the approved fallback is an explicit manual
npm publication after npm authentication, a current OTP, all final gates, and final user approval.
The operator must run `npm whoami` without recording credentials, confirm `NPM_OTP` is present, and
rerun the dry release surface:

```bash
npm whoami
test -n "$NPM_OTP"
npm run release:dry
```

Only after reviewing that fresh output and obtaining final user approval may the operator run:

```bash
npm run release -- --access public --otp="$NPM_OTP"
```

Never store, print, or commit the OTP, account credentials, auth headers, cookies, long-lived npm
tokens, or environment dumps. An authentication or OTP failure is a hard stop, not permission to
retry with guessed credentials.

## Hard release boundaries

- DO NOT publish `@litcodex/lit-loop` or any other `@litcodex/*` workspace.
- DO NOT publish when the worktree is dirty, refs differ, the version already exists, or any required
  check is stale or failing.
- DO NOT create a tag or GitHub release unless separately approved.
- DO NOT claim trusted-publishing provenance unless the actual configured workflow and resulting
  registry attestation prove it.
- No published byte may contain a guarded legacy token; scanner findings are never allowlisted for
  release.

The factual repository owner, URL, and default branch are recorded in `.github/REPO_METADATA.md` and
must continue to match the configured remote before publication.
