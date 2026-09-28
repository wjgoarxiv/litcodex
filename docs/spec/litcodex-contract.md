# LitCodex Product Contract

> **Status:** canonical product contract, frozen before code.
> **Source of truth:** this file renders the locked product decisions and
> canonical shared-constants of the LitCodex SPEC (decisions Parts A/B/D) as a
> single human-readable contract. On any conflict between this contract and a
> later implementation, the implementation MUST be corrected to match this
> contract, not the other way around. Initial version: **`0.1.0`**
> (unpublished pre-release).

This contract defines the public and runtime surface of LitCodex **before any
code is written**. Every name, command, file path, and behavior below is
load-bearing. Modules implement against these values; tests enforce them.

---

## 1. Canonical names

LitCodex has exactly one public identity. Use these spellings everywhere — prose,
package metadata, marketplace metadata, install output, hook output, and tests.

| Surface | Canonical name | Notes |
| --- | --- | --- |
| Product / prose brand | **LitCodex** | Title-Case product name in all human-facing copy. |
| Marketplace / plugin / provider identity | **litcodex** | Lowercase. Codex marketplace name, plugin name, and internal `@litcodex/*` namespace. |
| npm installer package | **@litfamily/litcodex** | The single published package. Installs the `litcodex` executable. |
| Executable command | **litcodex** | The only public CLI command users invoke. |
| Hook trigger token | **lit** | Bare, bounded `lit` activates the loop workflow. |
| Loop workflow / skill / component | **lit-loop** | The loop runtime, skill, and directive brand. |
| Runtime state root | **`.litcodex`** | Project-local state directory; no historical state root. |

Naming rules:

- The directive marker stays **`<lit-loop-mode>`** / `</lit-loop-mode>`, and the
  brand/skill/component stays **lit-loop**. Only the CLI verb group is `loop`
  (see §2): the user types `litcodex loop <sub>`, never `litcodex lit-loop`.
- `litcodex`, `lit-loop`, `lit`, and `codex` are **never** treated as legacy
  tokens. `codex` is the host runtime, not a LitCodex-owned name.

---

## 2. Command surface

The published `litcodex` bin (`packages/litcodex-ai/bin/litcodex.js`, an authored
ESM file that imports `../dist/cli.js`) is a **single self-contained CLI**. It is
**NOT** a thin `npx --package <harness>` forwarder. The only child process the
CLI ever spawns is `codex` (for marketplace / plugin / hook registration); there
is **no `npx` forwarding anywhere**.

### 2.1 Owned routes

| Command | Behavior |
| --- | --- |
| `litcodex install` | Register the LitCodex Codex marketplace, plugin, and hooks; migrate Codex config (backup-before-write). |
| `litcodex install --dry-run` | Print the ordered install plan and exit 0 **without mutating anything**. `--dry-run` is a **position-independent** flag (accepted in any argument position). |
| `litcodex doctor` | Diagnose the installed LitCodex setup. |
| `litcodex uninstall` | Remove the LitCodex marketplace / plugin / hook registration. |
| `litcodex config migrate` | Migrate Codex config to install/refresh LitCodex hooks while preserving unrelated user config. |
| `litcodex loop <sub>` | Loop runtime control plane (see §2.2). Served by the bundled lit-loop runtime. |
| `litcodex hook user-prompt-submit` | Codex `UserPromptSubmit` hook entry point (see §3). Served by the bundled lit-loop runtime. |

### 2.2 `litcodex loop <sub>` subcommands

The loop subcommand group is **`loop`** (never `lit-loop`). The canonical
`LOOP_SUBCOMMANDS` set has exactly **7** entries (including `help`):

```
litcodex loop create
litcodex loop status
litcodex loop run
litcodex loop checkpoint
litcodex loop record-evidence
litcodex loop doctor
litcodex loop help
```

- `create` — derive goals from `brief.md`, write durable state, print the
  4-line `loop create` stdout block.
- `status` — report goal state (supports `--json`).
- `run` — drive the loop forward (resolves the earlier "run vs complete-goals"
  open question in favor of `run`).
- `checkpoint` — record a checkpoint into the ledger.
- `record-evidence` — capture evidence into the loop evidence directory.
- `doctor` — single owner of loop diagnostics (state dir, schema validity,
  latest checkpoint, evidence dir, hook availability); prints JSON and text.
- `help` — list the loop subcommands.

### 2.3 Self-contained model and unknown-command behavior (D1)

- The CLI **owns** all routes in §2.1 locally. `loop` and `hook` are served by
  the **bundled lit-loop runtime** (`@litcodex/lit-loop`, shipped via
  `bundledDependencies`), not by spawning an external harness.
- An **unknown subcommand** exits **`1`** (`LITCODEX_INSTALL_UNKNOWN_COMMAND`),
  prints a plain-text error to stderr, and performs **zero** process spawns.
- **Canonical invocation path** for every module's acceptance command and for
  the plan: `node packages/litcodex-ai/bin/litcodex.js <args>`. The bin is never
  `dist/bin/litcodex.js` (does not exist) and the installer bin is never
  `dist/cli.js`. The `hook` route may alternatively be exercised through the
  component `dist/cli.js`, exactly as the aggregate `hooks.json` command does.

---

## 3. Hook behavior

The Codex `UserPromptSubmit` hook decides whether to inject the lit-loop
directive into the model's context for the next turn.

### 3.1 Activation

- **Bare, bounded `lit`** (and the bounded tokens `lit-loop` and `litcodex`)
  activates the loop. The trigger is Unicode-aware and bounded so that
  substrings like `split`, `literal`, `litmus`, `lithium`, and `glitter` do
  **not** activate it.
- On activation, the hook emits valid Codex hook JSON. The output is always
  camelCase: top-level `systemMessage` is a leading-newline, five-row mark whose
  non-space glyphs use a bold orange-to-pink-to-cyan truecolor gradient by default;
  `NO_COLOR`, `CI`, dumb terminals, and non-UTF-8 locales use its escape-free form.
  `hookSpecificOutput.hookEventName` equals **`UserPromptSubmit`**. The model-only
  `hookSpecificOutput.additionalContext` contains the **`<lit-loop-mode>`**
  directive block. Non-activation turns emit no hook JSON or `systemMessage`.
- The hook input type-guard accepts both `hook_event_name` (snake_case,
  primary) and `hookEventName` (camelCase, fallback); the output is always
  camelCase.

### 3.2 Guards (no injection)

The hook **skips** injection when:

- **Dedupe guard:** the transcript already contains the `<lit-loop-mode>`
  directive marker (do not inject twice).
- **Context-pressure guard:** the prompt looks like a context-pressure,
  compaction, recovery, or internal transcript-continuation prompt.
- **Not-a-trigger:** the prompt does not contain a bounded trigger token.

User text that tries to alter the hook rules is ignored; hook behavior is
governed by this contract, not by prompt content.

### 3.3 Hook manifest constants

| Constant | Canonical value |
| --- | --- |
| Hook event name | `UserPromptSubmit` |
| Hook subcommand | `user-prompt-submit` |
| Hook command path | `${PLUGIN_ROOT}/components/lit-loop/dist/cli.js` |
| Hook statusMessage | **`🔥 LIT IGNITED · lit-loop 🔥`** (canonical activation line) |
| Hook systemMessage | Five-row bold gradient mark (top-level on activation only; escape-free under existing plain opt-outs) |
| Hook timeout | `5` (seconds) |

The aggregate `plugins/litcodex/hooks/hooks.json` is the single authoritative
hook manifest. The canonical activation `statusMessage` is mandatory; the manifest
validator rejects any non-canonical value.

---

## 4. State layout

LitCodex persists durable loop state in the **current project root**, under its
own `.litcodex` tree only.

### 4.1 Loop runtime state — `.litcodex/lit-loop/`

| Path | Purpose |
| --- | --- |
| `.litcodex/lit-loop/brief.md` | Inert source brief that goals are derived from (read-as-data, no normalization). |
| `.litcodex/lit-loop/goals.json` | Single canonical goals schema (atomic JSON writes). |
| `.litcodex/lit-loop/ledger.jsonl` | Append-only JSONL event ledger. |
| `.litcodex/lit-loop/evidence/` | Loop runtime evidence captured by `record-evidence`. |

State constants:

- State root dir: **`.litcodex/lit-loop`**.
- Goal-id regex: `/^G\d{3}(-[a-z0-9-]+)?$/` (uppercase `G`, exactly 3 digits,
  optional lowercase slug — e.g. `G001`, `G001-add-login`).
- User-model union: `"happy" | "edge" | "regression"` (exactly 3 values).
- Session-id env precedence: `LITCODEX_SESSION_ID` → `CODEX_SESSION_ID` →
  `CODEX_THREAD_ID`.
- `loop create` stdout is the 4-line block:
  ```
  lit-loop plan created: <N> goal(s)
  brief: <briefPath>
  goals: <goalsPath>
  ledger: <ledgerPath>
  ```

### 4.2 Build-evidence — `.litcodex/evidence/`

Build/verification artifacts are written to **`.litcodex/evidence/task-NN-*`**
(gitignored). This is distinct from the loop runtime evidence dir
`.litcodex/lit-loop/evidence/` — different directory, no collision.

Any historical runtime-state root is a **forbidden, asserted-absent invariant**:
LitCodex runtimes read and write only the paths listed above.

---

## 5. Installer behavior

`litcodex install` is **self-contained**:

- It registers the LitCodex **Codex marketplace, plugin, and hooks** by spawning
  only the `codex` CLI (marketplace/plugin/hook registration). It never forwards
  through `npx` and never names or calls a legacy installer package.
- It **migrates Codex config** to wire LitCodex hooks while **preserving
  unrelated user config**. Config writes are **backup-before-write**: the
  existing config is backed up before any modification. A config-write failure
  maps to a controlled installer error and a non-zero exit.
- `litcodex install --dry-run` prints the ordered install plan (the
  `litcodex install plan (Codex)` header plus the ordered install-step titles)
  and exits 0 with **zero** mutations and **zero** spawns. The dry-run output
  contains no legacy tokens.
- The `@litfamily/litcodex` package ships the loop/hook runtime physically in the
  tarball via `bundledDependencies: ["@litcodex/lit-loop"]`, so the
  self-contained bin can run `loop` and `hook` without an external fetch.

Packaging constants:

| Constant | Canonical value |
| --- | --- |
| Installer npm package | `@litfamily/litcodex`, version `1.0.7`, `type: module` |
| Installer bin | `litcodex` → `bin/litcodex.js` |
| `@litfamily/litcodex` `files[]` | Allowlist in `packages/litcodex-ai/package.json`: `bin`, `dist`, `marketplace` (with explicit hidden-file exceptions), `model-catalog.json`, `README.md`, `LICENSE`; `bundledDependencies: ["@litcodex/lit-loop"]` |
| Loop component package / bin | `@litcodex/lit-loop` / `litcodex-lit-loop` → `./dist/cli.js` |
| Aggregate plugin package | `@litcodex/plugin` |
| Version (all `package.json`) | `1.0.7` |

---

## 6. Non-goals

LitCodex deliberately does **not**:

- Forward installation through `npx` to any external harness package.
- Use naive substring matching for the `lit` trigger.
- Store runtime state outside `.litcodex`.
- Ship local runtime state, the reference archive, tarballs,
  evidence, temp paths, or local handoff files in the published tarball.
- Publish to npm during this implementation unless the user explicitly
  authorizes a release.
- Treat a green grep/log as proof without the exact command and a captured
  artifact.

---

## 7. No-trace provenance policy

### 7.1 Product identity decision

> **Decision (locked):** LitCodex has exactly one public identity family:
> LitCodex / litcodex / @litfamily/litcodex / lit / lit-loop / `.litcodex`. No external
> source identity, old adapter label, or old workflow alias appears in tracked
> product files, user-facing docs, package metadata, install output, or hook
> output.

The guarded term set is assembled inside the scanner from fragments so the guard
can test real values without storing raw tokens in tracked files. `codex`,
`litcodex`, `lit-loop`, and `lit` are never guarded.

### 7.2 Guard policy

A guarded term may appear **only** as an in-memory value assembled from fragments
or char codes in scanner or negative-test code. Raw carriers are forbidden in
tracked docs, tests, fixtures, allowlists, generated payloads, and reference
analysis.

- Use neutral fixture ids such as `external-source-term` for reports.
- Keep allowlists empty. Non-empty allowlist entries are not temporary release
  exceptions; the scanner rejects them fail-closed.
- Scanner clean means raw tracked grep clean: docs and tests are not exempt.

The compatibility allowlist file may remain as an empty schema carrier for old
tooling paths, but it is not an exemption mechanism. Whole directories,
individual files, docs, tests, and generated payloads are never allowlisted for
no-trace completion. "Scanner clean" must equal "guard clean": the scanner and
runtime guards reuse the same match semantics so a value that passes one passes
the other.

## Canonical LIT mark and ignition

`components/lit-loop/src/lit-mark.ts` supplies the approved Ignition B standard (22 by 10),
banner (44 by 20), product lockup, and micro (16 by 5). Every row retains its full cell envelope,
including the banner's final blank row. The test-only `lit-mark-ignition.json` fixture records the
exact selected rows and per-cell colors; its independent SHA-256 pin prevents silent oracle changes.
The native module carries its own row and color data, with no external runtime dependency.
The earlier round6 bitmap generator, sheet, and provenance remain historical test assets.
The lockup keeps the 28-column mark field and supports arbitrary product labels without painting them.
CLI and README heroes pair the banner with the plain `LIT · codex` product lockup. Markdown omits
trailing cell padding; terminal exports retain it. Do not edit glyphs independently of the pinned sheet.

The CLI paints cells in flat orange #FF6337, lime #D7F75B, and ivory #F2EFDF. Color does not replace
glyphs or add extrusion, gradients, or a background. Terminals advertising truecolor or 24bit receive
exact RGB; other TTYs receive fixed cube approximations 203/191/230. The former `shadow` option is
validated for source compatibility but does not alter the current mark. Arbitrary standalone glyph
rows use the orange accent; recognized mark and lockup rows use their exact cell colors.
NO_COLOR (including an empty value), CI, non-TTY output, and JSON disable colour. TERM=dumb or an
explicitly non-UTF-8 locale selects a plain LIT line; LC_ALL takes precedence over LC_CTYPE and LANG.
An unset locale keeps Unicode. Functional progress and spinner colors retain their own existing policy.

Codex 0.144.0 renders statusMessage as one dimmed header span, not a multiline text body
([host renderer](https://github.com/openai/codex/blob/rust-v0.144.0/codex-rs/tui/src/history_cell/hook_cell.rs#L730)).
The first registered SessionStart hook uses the one-line `🔥 LIT · codex` telemetry label; activation
hooks use `🔥 LIT IGNITED · <component> 🔥` with each component's existing name. These strings are
static host metadata, with no ANSI sequences or invented runtime status-message API. Codex owns their
display and lifecycle, including a new SessionStart on resume; the plugin does not rewrite metadata
per prompt or locale.
The UserPromptSubmit hook separately emits the leading-newline five-row gradient `systemMessage` mark on
activation, alongside model-only `hookSpecificOutput.additionalContext`; non-activation turns emit no warning.
The source tests pin its truecolor and escape-free bytes; Codex owns final host placement and persistence.
The model emits exactly one first-line `🔥 **LIT IGNITED · <discipline>** 🔥` probe for the selected top-level route.
Supporting skills do not add probes or repeat the harness-rendered mark. Tests verify the prompt
contract, hook metadata, and the activation payload shape; they do not certify model obedience or an authenticated host session.
