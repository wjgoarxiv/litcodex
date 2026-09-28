# Changelog

All notable changes to `@litcodex/lit-loop` are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.44] - 2026-07-23

### Fixed
- Distinguished an absent native goal from a matching stopped goal and now guides user-owned
  `/goal resume` before durable `--retry-failed` execution without replacing or clearing the goal.
- Removed unobserved claims that blocked or failed checkpoints leave the native goal active, and
  fail closed for `budgetLimited` or malformed native state.

## [0.3.43] - 2026-07-23

### Added
- Schema 3 Start Work authority lifecycle state with revisioned, idempotent transitions and strict
  internal `init`, `transition <pause|cancel|complete>`, and JSON `doctor` CLI routes.
- Root `Stop` continuation and `UserPromptSubmit` explicit-resume hooks. Resume grammar is
  `lit start work <plan> --resume <boundary-id> --grant <grant-id> [--worktree <absolute-path>]`;
  resume is host-observed and reaches the internal lifecycle API rather than a generic CLI transition.

### Changed
- The npm marketplace payload now carries the continuation CLI, lifecycle store, and directive used
  by the installed hooks.
- The component package is private and remains distributed only as a bundled dependency of
  `litcodex-ai`, not as a separate npm publication target.

## [0.3.38] - 2026-07-18

### Added
- Exact-only bare `lit-handoff` and `lit-scientific-visualization` UserPromptSubmit routes.
- Full adapter injection for both routes, including the scientific-visualization activation banner
  and read-only dependency preflight contract.

## [0.1.0] - 2026-06-13

### Added
- Bounded `lit` trigger (Unicode-aware; rejects `split`/`literal`/`litmus`/`lithium`/`glitter`).
- Codex `UserPromptSubmit` hook that injects the `<lit-loop-mode>` directive, with duplicate,
  context-pressure, and prompt-injection guards.
- Durable `.litcodex/lit-loop` state store: atomic writes (tmp + fsync + rename), append-only
  ledger, schema validation, and non-destructive corruption recovery.
- `litcodex loop` command model: `create`, `status`, `run`, `checkpoint`, `record-evidence`,
  `doctor`, `help`.
- Loop doctor diagnostics (six checks) and the lit-loop operational skill.
