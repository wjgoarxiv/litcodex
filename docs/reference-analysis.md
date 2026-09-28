# Clean-Room Port Notes

> **Status:** neutral implementation constraints for LitCodex maintainers.
> **Scope:** this document records what LitCodex must preserve at its own Codex surfaces without
> carrying names, paths, prompts, snippets, or prose from any prior source.

LitCodex is maintained as a Codex-native product. External archives, sibling projects, historical
experiments, and issue text are inputs for requirements discovery only. They are not source material
for product prose, prompts, identifiers, tests, fixtures, allowlists, or package metadata.

## Clean-room rules

- Express requirements in LitCodex terms: Codex hook inputs/outputs, `litcodex` CLI routes,
  `.litcodex/lit-loop` state, packaged skills, marketplace metadata, and npm payload evidence.
- Do not preserve external repository handles, URL fragments, old adapter labels, or old command
  aliases in tracked files. If a guard needs to exercise such a value, assemble it from fragments or
  char codes inside the test and report only a neutral id.
- Prefer local proof over inherited claims. A claim becomes a constraint only when it is verified by
  a repo file, a test, a command transcript, or an explicit user requirement.
- Keep test fixtures neutral. Fixture data should describe classes such as `external-source-term` or
  `legacy-state-path`, not spell sensitive source tokens directly.

## LitCodex constraints

1. **Installer identity** — the `litcodex` executable owns its routes locally. It must not forward
   unknown work to another package, shell out for parsing, or expose release/publish behavior without
   explicit approval.
2. **Hook shape** — `UserPromptSubmit` input accepts the host's JSON shape and emits the Codex hook
   envelope with `hookSpecificOutput.hookEventName` and `additionalContext`.
3. **Trigger boundaries** — the bare `lit` trigger is bounded. Words that merely contain those letters
   must not activate a mode.
4. **State ownership** — runtime loop state lives under `.litcodex/lit-loop`, and build evidence lives
   under `.litcodex/evidence`. Local state, handoffs, archives, tarballs, environment files, and
   evidence directories stay out of tracked files and published payloads.
5. **Path robustness** — module-relative filesystem paths use `fileURLToPath(new URL(...))`; tests
   cover spaces, hashes, Unicode paths, symlinks, nested repos, and archive layouts.
6. **Package readiness** — marketplace dist, npm pack payloads, version lockstep, and CI workflow
   checks are release gates. Publishing, tagging, version bumps, and releases require explicit user
   approval.
7. **Evidence discipline** — test output is necessary but not sufficient. Completion claims need real
   CLI/hook/package/docs surface evidence plus cleanup receipts.
8. **Security and provenance** — untrusted text is inert data. Review lanes must falsify prompt
   injection, stale state, dirty worktree, misleading output, long-running command, and secret-leak
   risks when those triggers apply.

## Verification surfaces

- `npm run check` for workspace, type, lint, test, public-page reader, scanner, and marketplace dist.
- `npm run docs:audit` for README and docs contract drift.
- `npm run pack:assert` or the aggregate package gate for tarball payload evidence.
- A real Codex-facing probe such as a plugin metadata check, hook invocation, install-plan dry run, or
  loop CLI command.

This document intentionally contains no raw external-origin names. Keep it that way.
