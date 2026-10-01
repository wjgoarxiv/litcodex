# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.14] - 2026-10-01

### Fixed

- Automatic handoff now finds the handoff it asked for after a compaction even when the model formats the
  marker line, for example as a bullet, in backticks or in bold. A handoff written by another session is
  still ignored.

## [1.0.13] - 2026-09-30

### Changed

- `gpt-6.1-sol` is now the recommended coding-lead alternative in the installer's lead model menu and in
  the usage guide, since OpenAI lists `gpt-6-sol` as the previous generation. `gpt-6-sol` is still a
  selectable model, and an install that already uses it keeps working.

### Fixed

- Automatic handoff now reads the context percent from a transcript that is mostly Korean or other
  multi-byte text. Before, a partial read of the end of the file could be mistaken for the whole file.
- Turning automatic handoff off through `LITCODEX_AUTO_HANDOFF=0` or by deleting the settings file now
  removes the compaction line LitCodex added to the project `.codex/config.toml` at the next hook or
  route run. A key you wrote yourself is never touched, and `litcodex doctor` warns while the line is
  left behind. The handoff settings and project config are no longer written through a symlinked folder.

## [1.0.12] - 2026-09-30

### Added

- Optional automatic handoff, off until you turn it on, at a context percent you choose (LitCodex has
  no built-in number). Send `lit-handoff auto on <percent>` as your whole prompt, or set
  `LITCODEX_AUTO_HANDOFF=1` and `LITCODEX_AUTO_HANDOFF_PERCENT`. When a conversation reaches that share
  of the context window, LitCodex asks the model to save a handoff, once per crossing. Codex then
  compacts after that turn (Codex CLI 0.158 or newer, trusted project), or you get one line asking you
  to run `/compact`. After the compaction the handoff comes back on its own. `litcodex doctor` shows
  the state.

### Changed

- The README no longer shows the A/B comparison, on the GitHub pages or the npm page; one run per side
  was too little to support its verdicts. Its pictures are gone too.
- The GitHub pages show terminal pictures of what LitCodex prints during install, doctor, the lit
  hook and loop commands. The motion film was remade in Pretendard and now has a Korean version.

## [1.0.11] - 2026-09-30

### Fixed

- `litcodex doctor` no longer warns about an update receipt that the installed version has already
  passed. If an earlier automatic update failed and a later install reached its target version or
  went beyond it, doctor now reports that update as resolved instead of asking you to look into an
  unknown installation state. A receipt whose target is newer than what is installed still warns.

### Changed

- The GitHub pages show what Jev looks like when it is on, off, or unavailable, in English and
  Korean. Jev stays off unless you turn it on yourself.
- The GitHub pages gained a short motion film under "Watch it in motion", in English and Korean, and
  the READMEs were rewritten again in plainer language.
- Development dependencies (vitest and postcss) were updated. The installed package is unaffected.

## [1.0.10] - 2026-09-29

### Changed

- The READMEs in English and Korean are rewritten in plainer language, both the full guide on GitHub
  and the short install card on the npm page that links to it. Each section now gives the reason first
  and the switches after it.

## [1.0.9] - 2026-09-29

### Fixed

- The Jev skill hint no longer reads its per-session record through a symlink. If `.litcodex`,
  `.litcodex/jev` or the record itself is a link, the hint stays silent for that turn and sends
  nothing.
- The motion runtime pre-warm that `npm install -g` starts now works. It used to fail every time,
  because npm's global-install settings reached its inner `npm ci`, which refuses to run globally.
  The Office runtime install drops the same settings before its own `npm ci`.

### Changed

- `docs/privacy.md` now describes the Jev per-session record: where it lives, its four fields, and
  that it holds no prompt text, response, skill choice or key.
- The README explains what `npm install -g` runs after install: a short welcome and a motion runtime
  pre-warm that uses the network. It also lists how to skip it, with `--ignore-scripts` or `CI=1`.
- The READMEs are rewritten in plainer language. The GitHub README keeps the full guide, the skills
  gallery and the A/B results; the npm page is now a short install card that links there, and a Korean
  npm README ships in the package.

## [1.0.8] - 2026-09-28

### Added

- Add an optional Jev skill hint. It is off by default. With `LITCODEX_JEV=1` and your own
  `TYPESAFE_API_KEY`, the prompt hook sends each eligible prompt to TypeSafe and may add one advisory
  line that names a bundled skill. Slash commands, `$skill` mentions and prompts that already start a
  `lit` route are not sent.
- The request holds the prompt, cut to 2,000 characters with home paths, email addresses and
  token-shaped strings redacted, plus the names and short descriptions of the bundled skills. It holds
  no files, tool output or history. Other text, such as hostnames, is sent as written. Codex's own
  tools can read the key too, so use a key made for this feature. `docs/privacy.md` has the details.
- While the hint is on, each session shows `✦ Jev skill hint ON` once. `LITCODEX_JEV_SHOW=1` also
  shows the skill id and latency of each hinted turn in the Codex transcript, and `litcodex doctor`
  shows whether the hint is on. Unset `LITCODEX_JEV` and restart Codex to turn it off.

## [1.0.7] - 2026-09-28

### Added

- Add `lit-humanizer` for English and Korean prose. A pre-write check blocks a small set of
  high-confidence drafting patterns; softer matches stay as warnings.
- Add `lit-pptx` for editable PowerPoint decks and `lit-docx` for styled Word reports, each kept
  beside its Markdown source. A `lit` request for slides or a report loads the matching skill.
- Add `litcodex office-runtime install|status`. `litcodex install` prepares the Office dependencies
  outside the Codex session, and `litcodex doctor` shows whether they are ready.
- Add `lit-diagram-drawer` for architecture, workflow and concept diagrams, with PNG and
  Office-safe SVG exports, measured composition checks and a bundled Pretendard font.
- Add `lit-typographic-motion`, which directs short films. It writes a treatment first, renders
  through the type engine or an authored stage page, adds a generated sound bed, and needs
  review rounds on the rendered stills before a film counts as done. `lit` film requests use it.
- Add the `motion-runtime` command, which prepares or inspects the film renderer, and film renderer
  checks in `litcodex doctor`.
- Add a measured probe to `frontend-ui-ux` that renders a page at four widths, in dark mode, with
  reduced motion and at 200% zoom. `lit` web interface work hands off to it.
- Add motion guidance to `frontend-ui-ux`, plus guidance for data dashboards, mobile navigation
  and visible controls.
- Add a "Skills at a glance" table to the README with a picture for each skill, and the results
  of plain Codex against `lit` on ten tasks.

### Changed

- Route the former `lit-korean` skill name and older aliases to `lit-humanizer`; preserve modified
  managed copies on upgrade.
- Open the README with the robot motion cover. It replaces the orbit animation and the static cover.
- Handle bounded `lit` tasks in the current session without durable loop state. Bounded coding
  work loads `lit-code`, and diagram requests load `lit-diagram-drawer`.
- Accept well-formed `agent-browser` versions at or above the verified floor in `browser-drive`
  and document the user-run setup.
- Write `lit-comprehend` explainers and `litresearch` syntheses as plain reading. Verification
  details go to an internal record, and the reply names a limitation only when it affects the
  decision.

### Fixed

- Stop the installer's config migration from scanning the parent folders of `CODEX_HOME`.

## [1.0.6] - 2026-09-24

### Changed

- Show the robot cover directly under the hero instead of hiding it behind a "View the static cover"
  link, and remove the now-duplicate cover image further down the README.

## [1.0.5] - 2026-09-23

### Added

- Add README Studio with visual decoration patterns, deeper cover treatments, and a bounded multi-round design interview.

### Changed

- Default new LitCodex installs to the GPT-6 model family.
- Align both README languages with the family layout and pin npm-served package asset URLs to this release.

## [1.0.4] - 2026-09-23

### Fixed

- Show the activation mark as plain text in Codex. Codex CLI 0.156 prints hook control characters literally,
  which turned the coloured mark into escape-code noise; the five-row mark and the
  `🔥 LIT IGNITED · <discipline> 🔥` label now render cleanly in every terminal.
- Remove the placeholder captions from the animated README cover.

## [1.0.3] - 2026-09-22

### Changed

- Use the `🔥 **LIT IGNITED · <discipline>** 🔥` activation line in route prompts and documentation,
  with the plain-text form in Codex hook status messages.
- Emit `🔥 LIT IGNITED · <discipline> 🔥` as the top-level UserPromptSubmit `systemMessage` warning
  on activation while keeping `additionalContext` in the model-only hook channel.
- Render the activating UserPromptSubmit mark as a bold per-character orange-to-pink-to-cyan truecolor
  gradient while preserving the existing escape-free `NO_COLOR` and plain-environment fallbacks.

## [1.0.2] - 2026-09-20

- Add an animated README cover with a static fallback for reduced-motion preferences.
- Remove the automatic skill review; it never completed a review in practice. Any leftover
  `.litcodex/pending-review.json` or `.litcodex/skill-loop-state.json` files are inert and may be
  deleted; no other state is affected.
- Prevent publishing when the full test suite fails.
- Make the browser-drive capability probe report unavailable when its input is malformed or its
  runner fails.
- Run the full test suite in `release:check` and correct the README version badge.
- Preserve the full baseline rule during post-compaction recovery when long plugin paths consume the optional directive budget.

## [1.0.1]

- Fix installation preflight from a trusted home by running strict-config checks from their disposable probe directory, accepting Codex warnings only when the configuration parsed successfully, and surfacing Codex's own diagnostic detail on refusal.
- Remove LitCodex-managed per-model profiles and the empty managed `agents/` directory during uninstall while preserving user-edited files.

## [1.0.0]

Scoped package release for `@litfamily/litcodex@1.0.0`; native CLI, plugin, ownership, and home identities remain unchanged.

- Align the installer, private runtime components, dependency pins, and current installation guidance at 1.0.0 while retaining historical migration fixtures.
- Preserve modified, foreign, and symlinked named agent roles during uninstall; reject redirected or unrecognized generated-cache paths before installation and removal. Add migration, contribution, security, support, and source-grounded privacy guidance.


### Fixed

- Apply the installer's noninteractive policy to the output-style picker, including `--yes`,
  empty `CI`, and dry runs. Keep explicit `--style` choices and interactive selection.
- Use the shared terminal policy for readline, cards, and spinners so empty `NO_COLOR`, CI,
  dumb terminals, and non-UTF-8 locales do not emit ANSI cursor or color escapes.

### Changed

- Replace the README cover with Ignition vector paths and outlined glyphs, retain a WebP fallback, and keep installation commands in editable README text.
- Introduce the matching native plugin icon and `#FF6337` brand color with the matching Ignition terminal mark.
- Reorganized the English and Korean README entry paths around installation, first use, core routes,
  and safety, with detailed operational guidance retained in linked usage references.
- Excluded documentation covers, their old generator, and release-only documents from npm payloads
  while retaining the native plugin icon and all runtime assets.
- Pin the selected Ignition B cell geometry and palette in an independent test-only fixture; retain the previous generator and sheet as historical assets.
- Align the CLI, README heroes, and hook micro statuses with the interlocking mark, exact RGB and 256-colour cell palettes, and preserved no-colour and plain-text terminal fallbacks.
- Use a one-line session lockup in Codex hook status headers and the flat micro mark in subsequent
  hook statuses. Model replies begin with one `🔥 **LIT IGNITED · <discipline>** 🔥` probe across skills and routes.
- Renamed skills: `hyperplan` → `lit-crucible`, `init-deep` → `lit-init`, `git-master` → `lit-commit`,
  `teammode` → `lit-team`, `remove-ai-slops` → `lit-burnoff`, `ai-slop-remover` → `lit-burnoff-file`,
  `korean-ai-slop-remover` → `lit-korean`, `public-page-reader` → `lit-fetch`, and `programming` → `lit-code`.
  Old leading typed names and scoped mentions redirect for one release, with one deprecation note;
  the old names are removed in the next minor. Listings contain only canonical ids.
- Added the single-file cleanup adapter because its old skill directory was absent from this port.
  Same-version install/update removes old managed skill directories through the existing manifest
  and SHA-256 tree replacement; unrelated user skills remain outside that managed tree.

## [0.4.8] - 2026-09-03

### Changed

- Separated reader-facing replies from internal execution evidence across shared rules,
  workflow directives, skills, and subagent return contracts while preserving requested
  technical/audit detail and detailed handoffs.

## [0.4.7] - 2026-09-02

### Fixed

- Moved vendored handoff and scientific-visualization corpora out of skill
  trees into `vendor/`, leaving thin wrappers in the skill paths.
- Counted vendor license and provenance companions in family payload-parity
  so packed skills keep the material they name.

## [0.4.6] - 2026-09-01

### Fixed

- Kept the generated Codex configuration schema-compatible with the pinned `@openai/codex` 0.144.0 by removing legacy global `[agents]` defaults that the host rejects, while preserving the managed model routes and migration cleanup.
- Hardened `PathPin` launcher identity checks so a recreated launcher with a reused inode cannot be accepted as the pinned executable.
- Aligned packed catalog role routes with the shipped agent set.
- Validated workflow YAML syntax as part of `check:ci`.
- Documented Windows partial support, raised the Node floor to >=22, and split performance-sensitive tests into a non-blocking lane without changing thresholds.
- Resolved npm shim execution on Windows, including `.cmd`/`.bat` and PowerShell-only paths.

## [0.4.5] - 2026-08-31

### Added

- Added a stacked LitFamily ASCII wordmark to the human-facing LitCodex CLI, installer,
  doctor, and uninstall surfaces, and to the English and Korean READMEs. Structured
  (`--json`, non-interactive, and session-start) routes remain free of presentation output.

- Added a Windows CI job on `windows-latest` that builds and tests the package and runs a
  native `codex.ps1`-only PATH probe against isolated homes.

### Fixed

- A failed capability preflight no longer blames LitCodex's managed settings for a
  host configuration it never touched. The installer always reported `Codex strict
  config rejected LitCodex managed settings`, but a differential on codex-cli
  0.144.0 against a real `~/.codex/config.toml` shows the overrides are innocent:
  `config.load` fails with them AND without them, while an empty `CODEX_HOME`
  accepts them. The strict-config probe deliberately copies the machine's own
  `config.toml` into the probe home, so a rejection can come from that pre-existing
  file being unreadable by whichever Codex was resolved.

  A no-override baseline probe now runs when the override probe is rejected. If the
  baseline also fails, the error is `LITCODEX_INSTALL_HOST_CONFIG_INCOMPATIBLE`
  (exit 3, the same code this case already returned) and says the existing
  configuration could not be loaded and that Codex is likely older than the one
  that wrote it. Only when the baseline passes does the message still name the
  managed settings. The happy path is unchanged and still costs one strict-config
  spawn.

- Every capability preflight message now names the resolved Codex binary. `npx`
  puts `node_modules/.bin` at the front of PATH, so an install started inside a
  repository that pins `@openai/codex` probes that pin rather than the system
  Codex, and the failure was previously indistinguishable.

- Removed the bare `gpt-5.6` alias from the lead and helper model menus because it is a
  public alias absent from `codex debug models --bundled` and is rejected for
  ChatGPT-subscription accounts. The menus now expose bundled model IDs, with effort
  selecting the faster `gpt-5.6-sol` route where applicable.

### Changed

- Extended the version-lockstep registry beyond package manifests to cover the installer
  workspace dependency, its lockfile entry, and CLI, install-doctor, and marketplace
  version fixtures. `npm run check:version` now verifies 27 aligned sites for `0.4.5`.

## [0.4.4] - 2026-08-31

### Fixed

- The install confirmation now prints a visible prompt. Previously the model-route
  card ended with `Enter to continue` and then `readline.question("")` printed
  nothing, so the terminal showed a bare cursor. After three menus that each ended
  in a visible `Select 0-N [0]: `, the fourth wait looked identical to a frozen
  process. The line now reads `Press Enter to install · Ctrl-C to abort:`.
  Non-interactive, piped and CI runs are unchanged and still never prompt.

## [Unreleased]

### Fixed
- Routed a `codex.ps1`-only Windows PATH through `powershell -NoProfile -ExecutionPolicy Bypass
  -File`, and documented the Windows / PowerShell install path with the pinned npx recovery command.

## [0.4.3] - 2026-08-31

### Added
- Added packed-payload substance, cross-product parity, and referenced-path checks
  so the installed marketplace retains the skill material it names.

### Fixed
- Made the repository-boundary check work from inside a Git worktree.

### Changed
- Refreshed the canonical legal attribution metadata without changing the four
  upstream attributions it records. This is a local release candidate only; no
  publish, tag, or push was performed.

## [0.4.2] - 2026-08-30

### Added
- Added the plan-file gate: `lit-plan` persists an executable `.litcodex/plans/<slug>.md`
  packet before the planning turn ends, while approval still gates execution.
- Added installer choices for separate lead and helper model/provider routes, retaining
  Sol/xhigh for named planning and review roles and Luna/max for unnamed helpers.

### Changed
- Completed the Windows `.ps1` install path documentation and shim routing, and removed
  the retired handoff name from model-facing guidance.
- This is a local release candidate only; no publish, tag, or push was performed.

## [0.4.1] - 2026-08-29

### Added
- Added the Codex-native skill learning loop: bounded foreground review, schema-validated pending
  proposals, explicit apply or reject decisions, compare-and-swap rollback, and a recoverable curator
  for agent-owned skills under `$HOME/.agents/skills/`.
- Added project-local proposal, decision-ledger, blob, and usage-sidecar records plus the formerly
  public `litcodex skill-loop` command family, which is not available in current
  versions. Stop hooks only marked validated sessions for later review and never
  started a model.

### Security
- Kept `autoApply` permanently disabled. Apply refuses bundled and runtime ids, plugin or marketplace
  payloads, escaping paths, secret-shaped proposals, and existing user skills without the
  `litcodexAgentGenerated` marker. Rollback refuses to overwrite bytes changed after apply.
- Kept review user-invoked, bounded, secret-scrubbed, and stdin-independent. A missing authenticated
  Codex route blocks review without changing the pending proposal queue.
- Pinned the physical workspace and every `.litcodex/lit-loop` session directory component before
  and after enumeration, reads, and pending-state writes, so symlink or ancestor swaps fail closed
  without redirecting Stop-hook state outside the workspace.
- Added signed-journal recovery coverage for patch, add-reference, archive, rollback, and curator
  transitions. Recovery has an explicit loss exception: if an external actor destroys both the
  trusted journal/authority and the exact preimage, only an unambiguous proposal-derived create
  postimage may be reconciled on a fresh explicit retry; other mutations remain fail-closed rather
  than reconstructing unauthenticated bytes.

### Changed
- Documented the manual curator policy: two idle hours, stale after 30 days, recoverable archive after
  90 days, and no automatic deletion or consolidation. The configured seven-day interval is not a
  hook scheduler.
- Isolated the release-checklist final pack runner in Vitest so a clean-tree pack cannot start a
  second root clean build while other test workers read tracked runtime output.

## [0.4.0] - 2026-08-27

### Added
- Added machine-readable output-channel declarations across all 38 bundled skills. Thirty-six
  skills nest `output_channels` inside their sole `#contract.activation` YAML block;
  `frontend-ui-ux` and `visual-qa` keep the declaration in `references/complete-contract.md`
  to preserve their bounded activation entry points.
- Added a structural contract gate that requires every skill to declare one of the five supported
  artifact genres and the genre's exact limitations channel.
- Added a `PostToolUse` deliverable hedge check for file-writing tools. This event carries the
  pending write, edit, or patch content and can return model-visible `additionalContext`, so the
  guard reports genre-aware findings on the next model turn without replacing a successful write
  result.
- Added a deterministic deliverable scanner and regression fixtures for Korean and English hedge
  phrasing, including the author-evidence versus subject-fact distinction.

### Security
- Bound guard genre selection to an exact current-turn `UserPromptSubmit` route receipt rather than
  historical or compacted transcript text. The guard never opens an artifact path: it preflights a
  maximum of 64 declared paths and 4 MiB of aggregate pending content before any inspection, caps
  findings and hook output, and fails open for path-only or unknown write shapes. Transcript reads
  and the repository-only scanner remain bounded and fail open on unsafe or unstable input.

### Changed
- Treat output-channel declarations as machine-readable metadata consumed by the guard. Two
  isolated A/B experiments found no measurable behavior change from the declaration prose alone;
  this release does not claim that prose independently makes model-authored documents cleaner.

## [0.3.66] - 2026-08-26

### Fixed
- Fixed the Windows install failure `LITCODEX_INSTALL_CODEX_VERSION_UNSUPPORTED ·
  codex-version-unrecognized · codex-cli unknown` seen on 0.3.65: `codex.cmd`/`codex.bat` npm shims
  are now spawned through `ComSpec` (`cmd.exe /d /s /c`) instead of directly, and the Codex version
  is parsed from stdout, so the installer recognizes the host again (e7ee98a).

### Changed
- Aligned the guarded package, plugin, marketplace, documentation, and release-fixture
  version surfaces at `0.3.66` for G20 slice 19.

## [0.3.65] - 2026-08-23

### Changed
- Added frontend/UI/UX and visual QA support for `litfamily.design-contract/v1beta2`.
  The optional `taste` object accepts integer `variance`, `motion`, and `density` values from 1 through 10.
- Added the explicit `browser-drive` skill with capability probing, driver identity checks,
  snapshot-act guidance, credential boundaries, and blocked-state receipts.
- Added the explicit `skill-observer` skill with proposal-only storage at
  `.litcodex/skill-observer/observations.jsonl`.
- Extended package and marketplace coverage for skill catalog enrollment, generated payload hashes,
  compiled routes, installer and doctor checks, packed files, and installed probes.

### Security
- Hardened observer storage with bounded input validation, forced `applied: false`, secret redaction,
  checked project-root paths, symlink and swap checks, finite lock and read boundaries, atomic rollback,
  and typed post-commit cleanup failures.

## [0.3.64] - 2026-08-16

### Fixed
- Restored the bounded deep-interview progress card with round budgets, an ambiguity gauge,
  clarity dimensions, readiness gates, duplicate-question protection, early exit, and a hard cap.
- Added synchronized hook, payload, marketplace, and install regression coverage.

## [0.3.63] - 2026-08-16

### Changed
- Render `deep-interview` results as concise, human-readable Markdown by default,
  while reserving the full JSON contract for explicit `--json` or machine-readable requests.
- Preserve Korean prose, technical tokens, decision boundaries, evidence, and cleanup facts
  in structured Markdown sections without dumping the enclosing object syntax.

## [0.3.62] - 2026-08-15

### Changed
- Simplified the English, Korean, and npm README surfaces and kept the logo
  links pinned to the exact package release.
- Kept every guarded package, plugin, CLI, and marketplace version at `0.3.62`.

## [0.3.61] - 2026-08-15

### Added
- Added the official LitCodex clay-loop logo to the plugin manifest, README surfaces, and
  packaged marketplace payload.

## [0.3.60] - 2026-08-14

### Added
- Added provider-free activation/cache measurement contracts and packed-surface
  guards for deterministic local speed checks.

### Fixed
- Hardened local speed test execution and split large runner responsibilities
  without changing provider behavior.

## [0.3.59] - 2026-08-12

### Added
- Added advisory evidence review guidance to the Codex-native `frontend-ui-ux` skill.
- Added packed-payload and skill-level coverage for the guidance.

## [0.3.58] - 2026-08-11

### Added
- Added reviewed project knowledge through the Wikify component and bounded local knowledge hooks.

### Fixed
- Hardened installer config and payload reads with parent-directory and regular-file identity checks.

## [0.3.57] - 2026-08-09

### Added
- Added the Codex-native `deep-interview` planning skill, directive, trigger routes, installer catalog, and packed-payload coverage.
- Added a foreground, exact-version automatic-update barrier with sanitized npm execution, transactional rollback, doctor verification, lock ownership, and fail-closed host hooks.

## [0.3.56] - 2026-08-06

### Added
- Output styles feature: five writing-style presets (`off`, `asd-ste100`, `asd-ste100-ko`, `eli5`,
  `eli5-ko`) that inject a style directive into every `SessionStart` and `UserPromptSubmit` hook
  turn. Style is persisted as `litcodex_output_style` in `~/.codex/config.toml`. Install with
  `--style <id>` or via the new TTY-interactive menu. The rules engine loads the matching
  `output-styles/*.md` file and appends it to the additional context block via
  `combineStaticContext`.

## [0.3.55] - 2026-08-05

### Changed
- Re-routed the managed model catalog from `gpt-5.6` (Sol alias) / `high` effort, with `gpt-5.6-terra`
  / `xhigh` for the `explorer` and `librarian` roles, to `gpt-5.6-luna` / `max` for every role,
  following price/performance data showing Luna at max effort matches Sol at high effort on pass
  rate at roughly a quarter of the cost. `--model` now accepts only `luna` (previously `sol`/`terra`)
  and `--effort` now accepts `high`, `xhigh`, or `max` (previously `high`/`xhigh`). The Luna safety
  guard was re-aimed rather than removed: Luna below `high` reasoning effort is still rejected without
  a silent fallback, the same way Terra below `high` always was. A new `gpt56-luna-max.config.toml`
  generated profile joins the existing `gpt56-sol-high` / `gpt56-terra-high` files.

## [0.3.54] - 2026-08-04

### Fixed
- Aligned every planner surface with the parseable numbered `## Todos` and `F`-numbered
  `## Final verification wave` checkbox grammar consumed by the execution continuation, including a bundled
  `analyze-plan` pre-handoff check.
- Fresh execution initialization now rejects plans with no real tasks, missing final verification,
  malformed rows, or unfilled placeholders before state or ledger writes. Already-persisted legacy
  plans retain their existing transition-time progress compatibility.

## [0.3.53] - 2026-08-02

### Added
- `verify-lsp.ts` now performs a real LSP diagnostics roundtrip. It resolves the server for the file
  extension, spawns it, runs the JSON-RPC `initialize` → `initialized` → `didOpen` handshake over
  stdio, and waits for `textDocument/publishDiagnostics`. Exit codes are `0` OK, `1` FAIL (server
  not installed, server crashed, or a 60000 ms diagnostics timeout), `2` usage, `3` SKIP for an
  extension no server is known for. Previously it printed `SKIP` and exited `3` for every file in
  every language, because the bundled diagnostics engine it delegated to no longer exists. It needs
  no engine now — only node builtins — and runs under both `bun` and `node --experimental-strip-types`.

### Fixed
- `teammode`: `archive` refuses with exit 65 while any member is neither `reported` nor `blocked`.
  It previously marked every member archived unconditionally, destroying the record that they never
  reported and neutering the `delete` guard that depends on it.
- `teammode`: every mutating command now serialises on an owner lock. Two concurrent `add-member`
  calls previously both exited 0 with one member silently lost.
- `teammode`: `team.json` is read with `O_NOFOLLOW` plus an fd-vs-lstat re-check, so a symlinked or
  swapped state file is refused instead of read. Team state directories are created `0700` and
  `team.json` / `guide.md` `0600`; they previously landed world-readable with member focus, thread
  ids, and absolute worktree paths in them.
- `autoconference`: restored the all-lanes-failed hard stop (`BLOCKED_NO_VALID_PACKET`) and the
  ordered first-match-wins termination sequence, including the requirement that a plateau needs two
  consecutive complete reviewed rounds. Budget exhaustion was the only terminal condition left.
- `autoresearch`: restored the rule that figure scripts must call `rcparams()` before
  `plt.subplots()`/`plt.figure()`. Matplotlib snapshots rcParams at figure construction, so the
  shipped style contract was dead code at plot time.

## [0.3.52] - 2026-08-02

- Add the `lit-comprehend` skill to the bundled Codex plugin, registered in the canonical skill
  catalog and reachable through the lit-loop directive surface.
- Stop publishing sibling dogfooding state: `.litclaude/` session files were shipping in the
  tarball because `.gitignore` covered only this project's own state directory. Publication is
  now governed by a new `.npmignore` that mirrors `.gitignore` and additionally excludes the
  repo-local `AGENTS.md`.

## [0.3.51] - 2026-07-30

### Fixed
- Route ChatGPT-subscription accounts to `gpt-5.6-sol` at install time: auth-mode detection reads
  `CODEX_HOME/auth.json` and rewrites config.toml and agent TOMLs from the public `gpt-5.6` alias
  (which the API rejects for ChatGPT accounts) to the explicit Sol representation. API-key and
  unknown auth keep the current alias. Doctor warns when auth mode is unknown or when a ChatGPT
  account still uses the public alias.
- Corrected current install/model guidance for the approved backend-compatibility mitigation: `--model sol`
  writes `model = "gpt-5.6"`; OpenAI documents this alias as routing to Sol, while TERRA remains on
  `gpt-5.6-terra`.
- Clarified that normal installs preserve existing explicit Sol representations and provider-qualified
  routes that pass the existing safety policy. A one-time reviewed `litcodex install --reconfigure`
  updates an existing root; Luna and TERRA below high continue to fail closed. This does not describe
  `gpt-5.6-sol` as invalid, deprecated, or unsupported or require a recurring `-m gpt-5.5` workaround.
- Stopped authoring fixed context and auto-compaction overrides for managed profiles. Numeric capability
  output now describes probe-only explicit-override acceptance, and only explicit reconfiguration removes
  old root overrides.

## [0.3.50] - 2026-07-29

### Added
- Added the exact, provenance-recorded frontend reference corpus with deterministic manifest and
  hash verification, packaged attribution, and fail-closed catalog enrollment.
- Added picker-native Autoresearch, Autoconference, and Wikify skill families with bounded
  scaffolding, review-required outputs, and native plan-execution / `lit-loop` handoff guidance.

### Changed
- Extended installer, doctor, marketplace, documentation, and packed-payload coverage to include
  the new skill families and their runtime resources without adding hook or slash activation.
- Kept human doctor output bounded while retaining exact missing skill and resource paths in the
  structured report.

### Security
- Hardened family scaffolders against symlink and leaf-swap writes, unsafe force replacement,
  invalid numeric budgets, and stale text-based completion claims.
- Made the external-term scan cover every tracked file while reserving exact-hash corpus handling
  for the built-in legacy-token scan.

## [0.3.49] - 2026-07-28

### Added
- Added evidence-eligible beta design and visual-evidence schemas that bind finite acceptance
  criteria and bounded PNG bytes to a caller-authorized evidence root.

### Changed
- Kept the model-facing frontend and visual QA skill entrypoints bounded while preserving their
  complete, hash-pinned contracts as packaged references.
- Expanded the packed installed probe with typed checks for valid, missing, non-image, stale,
  root-escaping, symlinked, and reviewer-blocked visual evidence.

### Security
- Hardened installed skill payload verification against symlinked or non-regular entries and
  directory swap, append, and metadata races on POSIX and Windows-compatible paths.

## [0.3.48] - 2026-07-28

### Added
- Added picker-native `structural-search` and `coding-session-audit` skills, plus operational
  references across the existing programming, planning, review, and maintenance skill families.

### Changed
- Rebuilt frontend design guidance as independently authored, dataset-free Codex workflows and
  made visual QA own its validation runtime instead of importing frontend implementation helpers.
- Reclassified installed smoke and scenario drivers as QA surfaces. Tests, fixtures, test helpers, and Vitest configuration remain tracked repository coverage and are excluded from npm and installed marketplace payloads.

### Fixed
- Corrected picker-only skill contracts so they no longer claim UserPromptSubmit body injection,
  and made relative skill links plus their packaged targets fail closed when omitted.
- Pinned the officially tested `@openai/codex@0.144.0` host as an exact root development dependency
  and made CI verify its lock-owned executable before passing the absolute `CODEX_BIN` path to the
  credentialless installed-doctor probe.
- Replaced the installed UI/UX probe's manual marketplace copy and ambient host lookup with the
  packed, globally installed non-interactive JSON installer public surface,
  strict installed `doctor --json` validation, typed terminal receipts, and atomic stale-evidence
  replacement. CI now proves packed install plus doctor health; authenticated model execution stays
  a separate fail-closed full-scope probe.
- Made installer prepack clean-build all source-owned runtime output before marketplace bundling, so
  source-only checkouts cannot reuse stale ignored `dist` files and build failures produce no package.
- Restored executable bits for every package-declared workspace bin after root or workspace builds,
  and made package-payload checks reject bins whose actual pack metadata is missing, non-regular, or
  non-executable.
- Routed publication lifecycles through the clean-tree-first non-shipping release preflight and made
  its pack step run the complete final payload gate; ordinary development `npm pack` remains usable.
- Extended installed-package smoke coverage to verify `dist/cli.js`, `dist/postinstall.js`, and the
  installed `litcodex --version` surface without requiring a caller-built installer `dist` directory.

### Removed
- Removed the reused frontend design dataset together with its dedicated license, notice,
  provenance, import manifest, and importer/search machinery.

## [0.3.47] - 2026-07-25

### Added
- Added picker-native `frontend-ui-ux` and `visual-qa` skills with finite design/evidence contracts,
  deterministic local design-intelligence retrieval, bounded PNG/TUI tooling, and installed-package
  probes that execute literal documented command blocks from an unrelated working directory.

### Security
- Kept the pinned design-intelligence corpus read-only and provenance-bound with its required MIT
  attribution, strict source replay, bounded inputs, and prompt-injection-safe runtime behavior.
- Made marketplace installation, repair, and doctor payload equality fail closed on outside or
  broken symlinks, FIFOs, special entries, tampering, missing files, and orphan runtime files.

## [0.3.46] - 2026-07-24

### Fixed
- Made `litcodex doctor` verify all 29 canonical bundled skill entry points, report the exact
  missing skill IDs, and fail installation health when a marketplace payload is incomplete.
- Added bounded README inventory auditing and repository-directory parity tests so shipped Codex
  skill IDs remain user-visible and the doctor catalog cannot drift from the packaged skill tree.

## [0.3.45] - 2026-07-24

### Security
- Restricted automatic update notices to successful, fully interactive `install` and `doctor`
  commands and kept CI, pipes, machine-readable, preview, informational, destructive, config, hook,
  and loop surfaces silent.
- Hardened the detached npm refresh with a credential-filtered helper environment, a strict fenced
  cache, mutation-level transition ownership, stale-lock recovery only for malformed abandoned owners or a
  well-formed owner whose PID is definitely absent, attempted-at throttling, immutable version
  instructions, strict stable-semver parsing, and bounded validation of the single official HTTPS
  registry response. The notifier remains cache-only in the foreground and never installs an update.

### Fixed
- Made release preparation fail closed before creating evidence when the worktree contains modified,
  staged, or untracked files, is not a Git checkout, or cannot be inspected reliably; ignored local
  state remains non-blocking, and inherited Git repository/index/object redirects cannot inspect a
  different checkout.
- Kept the packed CLI compatible with the declared Node 20 minimum by loading the bundled model
  catalog through the standard CommonJS bridge instead of unsupported import-attribute syntax.

## [0.3.44] - 2026-07-23

### Fixed
- Distinguished an absent Codex native goal from an unfinished stopped goal, guiding matching
  `paused`, `blocked`, and `usageLimited` goals through user-owned `/goal resume` before durable
  `--retry-failed` execution instead of attempting an invalid replacement.
- Stopped claiming that the native goal remains active when package runtime did not observe its
  status, made native objective comparisons exact and inert, and fail closed for `budgetLimited`
  or malformed native state.

## [0.3.43] - 2026-07-23

### Added
- Added schema 3 Start Work authority state with revisioned, idempotent lifecycle transitions and
  strict internal `init`, `transition <pause|cancel|complete>`, and JSON `doctor` CLI routes.
- Added a root `Stop` continuation hook and a `UserPromptSubmit` resume hook for explicit
  `lit start work <plan> --resume <boundary-id> --grant <grant-id> [--worktree <absolute-path>]` use;
  resume is host-observed and reaches the internal lifecycle API rather than a generic CLI transition.

### Changed
- Included the continuation CLI, lifecycle store, and directive in the npm marketplace payload.
- Split marketplace verification into candidate mode for ordinary local `npm run check` and tracked
  fail-closed mode for `release:check` and the installer package's `prepublishOnly` lifecycle.
- Marked the bundled `@litcodex/lit-loop` component private so `litcodex-ai` remains the sole npm
  publication target, and aligned repository metadata and guarded manual-release documentation.

## [0.3.42] - 2026-07-22

### Fixed
- Hardened lit-loop lifecycle completion so goals require criterion-level evidence before downstream
  work can proceed, while preserving explicit verification and checkpoint receipts.
- Tightened visual QA guidance and tests so rendered-artifact inspection is required instead of
  source-only or code-only validation claims.

## [0.3.41] - 2026-07-19

### Added
- Expanded LitResearch with a root-owned claim/evidence graph, bounded research waves, explicit
  scientific-artifact lifecycle states, convergence receipts, and current Codex collaboration APIs.
- Added guarded GPT-5.6 SOL/high and TERRA/high-or-above agent routing with honest configured-versus-
  observed model reporting across installer and doctor surfaces.

### Security
- Hardened the public-page reader against DNS rebinding, private or mapped network targets,
  misleading content types and error payloads, reflected URL secrets, and unsafe redirect chains.
- Hardened marketplace payload assembly against symlink, non-regular, non-canonical, and out-of-root
  inputs while closing the runtime import dependency set.

## [0.3.40] - 2026-07-19

### Fixed
- Isolated strict-config validation in a temporary config-only Codex home so the installer no
  longer scans unrelated rollout files or the state database and times out on history-heavy hosts.
- Preserved the user's exact `config.toml` bytes for validation, forwarded the isolated environment
  only to strict probes, and removed the temporary home after every accepted, rejected, or timed-out
  result.

## [0.3.39] - 2026-07-19

### Fixed
- Replaced six serial strict-config doctor probes with at most two purpose-specific bounded probes,
  extended each cold-host allowance to 60 seconds, and switched model discovery to the bundled
  local catalog.
- Kept model-metadata timeouts isolated from concurrency proof so unavailable context metadata
  preserves host defaults instead of stopping an otherwise strict-valid install.

## [0.3.38] - 2026-07-18

### Added
- Bundled Codex-native `lit-handoff` with the approved exact four-file payload, an exact-only bare
  UserPromptSubmit route, and installer/doctor enrollment.
- Bundled `lit-scientific-visualization` with the approved exact 16-file payload and provenance,
  exact-only invocation, the `🔥 LITBURN IGNITED · lit-scientific-visualization 🔥` activation
  banner, and a read-only dependency preflight.

### Changed
- Extended marketplace generation, hook routing, payload guards, and packed-install diagnostics to
  reject missing, changed, extra, symlinked, cache, or bytecode files in either bundled skill.

## [0.3.37] - 2026-07-14

### Fixed
- Made explicit leading work-execution prompts run the embedded Codex-native contract instead of
  returning the obsolete blocked handoff.
- Kept diagnostic, copied, quoted, code, and mid-sentence mentions inert; aligned
  `lit-plan` guidance, continuation state, evidence paths, and collision-safe invocation docs.

## [0.3.36] - 2026-07-12

### Fixed
- Normalized managed and already-enabled multi-agent V2 settings to GPT-5.6's reserved
  `collaboration.spawn_agent` schema by hiding spawn metadata, capping concurrency at 20, and
  retaining depth one; doctor now fails health if the request-breaking metadata shape remains.
- Made explicit `--reconfigure` apply SOL/high (or the selected profile) even over a customized root
  model while preserving unrelated config keys, and stopped the installer receipt from presenting a
  preserved request as the effective model.

## [0.3.35] - 2026-07-12

### Fixed
- Replaced exact Codex-version rejection with a capability-first compatibility policy: verified
  `0.144.0`/`0.144.1` hosts remain hard, while newer stable hosts that pass every live strict-config
  and model probe install with an explicit advisory concurrency receipt.
- Added fail-before-mutation diagnostics for too-old, prerelease, unrecognized, timed-out, and
  strict-rejected Codex hosts; doctor now treats probe-gated advisory compatibility as a warning
  instead of a failed installation.

## [0.3.34] - 2026-07-11

### Fixed
- Kept the interactive spinner moving while synchronous Codex capability probes are running by
  rendering frames from a blocking-safe worker with an atomic stop boundary.
- Made repo-local `npx litcodex-ai@<matching-version>` installs self-contained when npm selects the
  local workspace binary after postpack cleanup: the installer now stages a filtered disposable
  marketplace payload from the current LitCodex source tree and removes it after installation.

## [0.3.33] - 2026-07-11

### Changed
- Made the interactive installer visible from the first host check: it now explains and reports
  host discovery, read-only strict-config validation, and bundled marketplace staging before the
  existing six-step install checklist. Active preparation failures also close their spinner before
  the actionable failure panel is rendered.

## [0.3.32] - 2026-07-11

### Changed
- Made `lit-plan` emit proportionate, objective-achievable execution checklists with one bounded
  objective, task-level action/output/verification, evidence, decision branches, and a final DoneClaim.
- Added a read-only draft-plan mode to `review-work` with `PASS`, `ITERATE`, and `NEEDS-CONTEXT`
  verdicts while preserving the completed-work five-lane gate.

### Fixed
- Switched managed orchestration to stable V1 with hard concurrency 20 and depth one, while
  preserving unmarked user multi-agent settings and safely migrating recognizable older guards.

## [0.3.31] - 2026-07-11

### Changed
- Redesigned the interactive installer as a verbose, structured progress checklist with isolated
  Codex command receipts and a final model/config/capability summary that names the installed
  subagent model policy.
- Assigned the research-oriented explorer and librarian roles to `gpt-5.6-terra` with `xhigh`
  reasoning effort; plan, metis, momus, and litwork-reviewer remain on `gpt-5.6-sol` with `high`
  reasoning effort.

## [0.3.30] - 2026-07-11

### Fixed
- The npm installer now bundles the runtime-only Codex marketplace, installs it atomically under
  `CODEX_HOME`, migrates legacy Git-backed marketplace registrations to that stable local source,
  and removes both the registration and managed payload on uninstall. New users no longer need
  access to the GitHub repository during installation.
- `doctor` now distinguishes the expected managed local marketplace from a stale same-name Git
  registration, and install dry-runs describe the current 372K / 334.8K context policy.

## [0.3.29] - 2026-07-10

### Fixed
- Installer and doctor output now distinguish host capability support from applied, preserved, or
  partially applied root configuration, including explicit reconfiguration guidance.

## [0.3.28] - 2026-07-10

### Changed
- Fresh LitCodex configuration and explicit managed reconfiguration now use the strict-probed,
  metadata-verified 372K context window with its 90% (334.8K) auto-compaction trigger for SOL/TERRA.
- Existing managed and user-modified settings remain preserved until explicit reconfiguration.

## [0.3.27] - 2026-07-10

### Fixed
- Prevented valid Codex strict configuration from being rejected when the full doctor probe takes
  longer than five seconds, and report deadline expiry as a timeout instead of schema rejection.
- Accepted the verified Codex 0.144.1 patch schema for hard multi-agent concurrency 20.

## [0.3.26] - 2026-07-10

### Added
- Added SOL/high defaults, TERRA and medium/high/xhigh choices, collision-safe named profiles,
  and strict fail-closed model/config migration surfaces.
- Added capability receipts for hard multi-agent concurrency 20 and metadata-gated 650K auto-compaction.

### Changed
- Updated primary authored roles and post-compaction metadata handling for GPT-5.6 SOL/TERRA.
- Current 372K host metadata now leaves context and auto-compaction overrides unset instead of guessing.

## [0.3.25] - 2026-07-09

### Changed
- Prepared `litcodex-ai@0.3.25` after aligning packed CLI hook output,
  bundled skill-body release docs, and package-payload assertions for manual
  npm publication.

## [0.3.24] - 2026-07-08

### Changed
- Prepared `litcodex-ai@0.3.24` after tightening LSP and comment-checker organicity: unavailable bundled LSP runtime paths now report honest SKIP/unavailable behavior, and missing comment-checker engines stay documented as no-op.
- Added regression guards against stale LSP MCP/tool overpromises while preserving the explicit approved-execution boundary.

## [0.3.23] - 2026-07-08

### Changed
- Prepared `litcodex-ai@0.3.23` for npm publication after extending bare lit-family routes to inject the installed bundled skill body.
- Added the repository guidance directive surface and kept explicit execution approval boundaries intact.

## [0.3.21] - 2026-07-07

### Fixed
- Kept `lit-plan` and the approved execution workflow usable when the Codex host does not
  expose `multi_agent_v1` subagent tools, recording a direct-execution fallback
  instead of hard-blocking the approved workflow.
- Accepted current lit-plan checklist headings such as `## Todos` and final
  verification wave suffixes in the execution continuation parser.

## [0.3.20] - 2026-07-07

### Changed
- Deepened bare Hyperplan invocation context and preserved direct execution
  handoff boundaries in the packaged Codex plugin release.
- Reflected the published `litcodex-ai@0.3.20` state in the root and package READMEs.

## [0.3.19] - 2026-07-05

### Added
- Bare `hyperplan` and natural `lit hyperplan` routing now activate the Hyperplan
  directive while slash commands, code spans/fences, and substrings remain guarded.

## [0.3.18] - 2026-07-05

### Added
- `hyperplan` adversarial planning skill for pressure-testing high-risk work before
  handing surviving constraints, evidence needs, and cleanup obligations to `lit-plan`.

## [0.3.17] - 2026-07-04

### Added
- Read-only `lit-recap` mode in lit-loop with a Korean recap directive and bounded routing.

### Fixed
- Packaged `litcodex-ai` README now reports the correct 26-skill bundle count.

## [0.3.16] - 2026-06-26

### Added
- Bundled `korean-ai-slop-remover` skill for reducing generic AI-like Korean prose while preserving
  meaning, protected spans, facts, quotes, citations, and requested register.

### Changed
- Updated skill-library documentation and validation coverage for the 25-skill bundle.

## [0.3.15] - 2026-06-26

### Added
- Redacted external-term scanning for caller-supplied term files without storing raw terms in product files.

### Changed
- Strengthened minimum-first gates across bundled rules, planning, and review-work surfaces.

### Fixed
- `@litcodex/rules` workspace tests now run real package-local tests and clean transient Vitest cache artifacts.

## [0.3.14] - 2026-06-23

### Added
- Public-page-reader now includes a Node-stdlib runtime CLI for safe public-only URL retrieval, with
  SSRF/private-host preflight, unsafe redirect blocking, credential-free fetches, content validation,
  public feed alternate discovery, trace output, and runtime-backed deterministic A/B coverage.

## [0.3.13] - 2026-06-23

### Added
- Public-page-reader skill for public-only page retrieval with SSRF/private-network guards, content
  validation beyond HTTP status, browser fallback guidance, trace evidence, and deterministic A/B
  coverage for guarded retrieval vs a one-shot fetch baseline.

## [0.3.12] - 2026-06-21

### Added
- Native Codex `create_goal` PreToolUse guard that allows objective-only goals and denies numeric
  budgets, status, metadata, or other non-objective keys.
- Local-only `teammode` skill for durable `.litcodex/teams` coordination packets, member prompts,
  thread binding, status updates, archive/delete cleanup, and safety checks.

### Changed
- `lit-loop` goal handoff text now documents the installed `create_goal` guard and unlimited-goal
  constraint explicitly.

## [0.3.11] - 2026-06-20

### Added
- Always-applied build-decision bundled rule: minimum-first strategy preferring stdlib, native, and
  already-installed dependencies before writing custom code.
- Programming self-review check for skill-based code quality gates.

## [0.3.10] - 2026-06-19

### Added
- Natural lit-family phrases now route through the Codex hook: `lit plan`, `lit review`,
  `lit research`, `lit goal`, and `lit start work`. The parser ignores code spans/fences and
  slash-command mentions while allowing path-like text before a later valid trigger.
- Added hook directives for blocking five-lane review, source-separated research synthesis, and the
  safe `lit start work` handoff.

### Changed
- lit-loop now documents the native `/goal` fallback explicitly: when `get_goal`, `create_goal`, or
  `update_goal` are unavailable, `.litcodex/lit-loop` remains the durable source of truth and evidence
  records `native-goal-unavailable` instead of pretending the native tool ran.
- The release preflight checklist now includes `npm run docs:audit` so package-readiness checks cover
  user-facing docs as well as version, token, payload, semver, and shippability gates.

### Fixed
- Durable loop writes now redact common secret shapes before persisting briefs, goals, ledger entries,
  evidence notes, and Codex goal handoff payloads.

## [0.3.9] - 2026-06-18

### Changed
- **lit-loop now uses one aggregate Codex native `/goal` per durable plan by default.** Non-final
  checkpoints keep the aggregate goal active and explicitly avoid `update_goal` until every lit-loop
  goal is complete, preventing the repeated-goal conflict that required manual `/goal clear` between
  goals. New plans carry `codexGoalMode: "aggregate"` and a stable `codexObjective`; compatibility
  `per_story` mode remains accepted for existing state.
- **lit-plan now cooperates honestly with native Codex Plan Mode.** The hook documents that LitCodex
  cannot programmatically switch the host UI mode; when native Plan Mode is already active it returns
  a `<proposed_plan>` instead of writing plan files, while regular lit-plan remains file-backed under
  `.litcodex/plans/`.

### Fixed
- Added `--session-id`, `LITCODEX_SESSION_ID`, `CODEX_SESSION_ID`, and `CODEX_THREAD_ID` aliases for
  lit-loop state scoping, while preserving existing compatibility env vars.
- Completed lit-loop plans no longer silently absorb a second `loop create`; they now fail with a
  clear message pointing to `--session <new-id>` or intentional `--force`.
- Restored the missing `lit-plan/references/full-workflow.md` and added contract tests so future skill
  references must resolve.
- Normalized documented subagent role names to installed `litcodex-*` TOML names and current
  `multi_agent_v1.spawn_agent` / `wait_agent` / `close_agent` APIs.
- Fixed a stale continuation component source path.

## [0.3.8] - 2026-06-14

### Fixed
- **`litcodex loop doctor` no longer false-warns "UserPromptSubmit hook not registered"** on a
  perfectly healthy install. The probe read a **dev-repo-relative** manifest
  (`<cwd>/plugins/litcodex/hooks/hooks.json`), which only exists when run from the source repo — so a
  real `loop doctor` from any other directory always reported the hook missing, even though
  `litcodex doctor` and the live hook both confirmed it was wired. The probe is now **install-aware**:
  it trusts the dev-tree manifest when present, and otherwise looks where the installed plugin actually
  lives — the Codex plugin cache (`<CODEX_HOME>/plugins/cache/.../hooks/hooks.json`). Pure-read,
  hermetic (injectable `codexHome`), still fail-soft (never `fail`, always exit 0).

## [0.3.7] - 2026-06-14

### Fixed
- **Codex plugin hooks no longer fail on a clean marketplace install** (`SessionStart hook (failed) —
  hook exited with code 1`, `PreToolUse hook (failed)`, etc., seen on a fresh WSL2/Windows install).
  **Root cause:** `codex plugin add` fetches this repo from GitHub and copies the plugin tree verbatim
  — it runs **no build and no `npm install`** — but the compiled component `dist/` was gitignored, so
  the distributed plugin shipped **zero hook code**. Every hook (`node "${PLUGIN_ROOT}/components/*/
  dist/cli.js" …`) then crashed with `MODULE_NOT_FOUND`. It only "worked" on the dev Mac because that
  machine resolved a locally-built copy.
  **Fix:** the compiled component `dist/` and the `rules` component's sole vendored runtime dep
  (`picomatch`) are now **committed to the repo** (the marketplace distribution channel; `packages/*/
  dist` stays npm-only via `files[]`). Marked `linguist-generated` and kept LF for Windows/WSL2 clones.
  **Regression guard:** new `check:marketplace-dist` (in `npm run check`) reconstructs the exact tree a
  clean `codex plugin add` would copy (`git archive` of the index) and runs every `hooks.json`-
  referenced hook from it, failing if any dist is missing or crashes — the gap that let this ship.

## [0.3.6] - 2026-06-14

### Fixed
- **`npx litcodex-ai install` no longer fails with `LITCODEX_INSTALL_HOOKS_MISSING`.** The install's
  hook-verify and agent-install steps resolved bundled assets relative to `process.cwd()` and depended
  on dev-only files (`@litcodex/plugin` + `.agents/plugins/marketplace.json`) that are **never** in the
  published tarball — so any real npx/global install died at the "Wiring UserPromptSubmit hook" step.
  Now: (1) hook verification is a best-effort **dev-only** drift guard that passes silently in a
  published install (the hook is wired by `codex plugin add` from the marketplace anyway); (2) the
  bundled `@litcodex/lit-loop` agent roles resolve relative to the **installed package**, not the cwd,
  so `npx litcodex-ai install` works from any directory. Regression-guarded by a new
  `real-install-end-to-end` install-smoke probe that runs the real (non-dry-run) install against the
  packed tarball from a neutral cwd — the gap that let this ship.

## [0.3.5] - 2026-06-14

### Added
- **`litwork` skill** — outcome-first delivery is now a discoverable, triggerable skill at the plugin
  root (`plugins/litcodex/skills/litwork/`), not just a hook-injected mode directive. It condenses the
  litwork loop (bind goal → RED-first proof → real-surface evidence → verify → clean) with LIGHT/HEAVY
  tier triage, the manual-QA channels (HTTP/tmux/Browser/Computer), subagent delegation roles, hard
  invariants, and stop rules. Carries the mandatory LITBURN activation banner. With this, both
  `litwork` and `litgoal` are full skills (no longer directive-only).
- **Update notifier** — the CLI now surfaces a non-blocking "🔥 Update available  X → Y" notice when a
  newer `litcodex-ai` is published on npm. A previous run's detached background child refreshes a
  24h-stale cache (`~/.litcodex/update-check.json`); the foreground only ever reads that cache, so it
  never blocks on the network and is fully offline-safe. Gated to an interactive TTY (silent in CI,
  pipes, `--json`, and under `NO_UPDATE_NOTIFIER` / `LITCODEX_NO_UPDATE_CHECK`); the notice writes to
  stderr so stdout stays clean. **Zero new dependencies.**

## [0.3.3] - 2026-06-14

### Added
- **`litgoal` skill** — goal-binding is now a discoverable, triggerable skill at the plugin root
  (`plugins/litcodex/skills/litgoal/`), not just a hook-injected mode directive. It guides binding a
  request into one crisp objective + 1-3 checkable success criteria (each with a scenario, a real
  surface, and observable evidence) via `litcodex loop create`, then hands off to lit-loop — bind
  only, never implement. Carries the mandatory LITBURN activation banner. (litwork remains a
  directive-only mode for now.)

## [0.3.2] - 2026-06-14

### Added
- **CLI greeting on the bare `litcodex` / `litcodex --help` surface** — the fire title banner now
  renders when you run `litcodex` with no command (interactive TTY only). This is the reliable
  post-install welcome: npm 7+ **suppresses postinstall output by default**, so the `npm install`
  banner only shows under `--foreground-scripts` — the CLI-owned banner always shows. `--version`
  and error/piped/CI output stay plain.

## [0.3.1] - 2026-06-14

### Added
- **Install TUI polish** — a fire/ember-branded title banner (gradient `litcodex` wordmark + 🔥),
  animated per-step loading spinners during `litcodex install`, and an npm **postinstall welcome**
  (greets you on `npm install -g litcodex-ai` with next-steps). All hand-rolled ANSI, **zero new
  dependencies**, and fully TTY/CI-safe: non-interactive / `--no-tui` / `--json` / `NO_COLOR` / CI
  output stays byte-identical to before, so nothing breaks in pipes or CI. The postinstall banner
  only shows on a real global install (`npm_config_global`), staying silent for dev/workspace/CI.

## [0.3.0] - 2026-06-14

### Added
- **Codex native goal (`/goal`) integration** — lit-loop now keeps Codex's native goal surface in
  sync with the active loop goal. `litcodex loop run` prints a "Codex goal handoff" instructing the
  agent to `get_goal` then `create_goal({ objective })` (per-story: each goal → one Codex goal);
  `litcodex loop checkpoint --status complete` hands off `update_goal({ status: "complete" })`, and
  `/goal clear` once the whole plan is done. The `<lit-loop-mode>` directive drives the agent to
  actually call these tools; `litgoal` still only binds `goals.json` (lit-loop owns `/goal`). Ported
  and adapted from the reference loop's `goal-status` / `codex-goal-instruction`.

## [0.2.0] - 2026-06-14

### Added
- **🔥 LITBURN** — every LitCodex skill now carries a mandatory activation banner: the instant a
  skill fires, it emits `🔥 LITBURN IGNITED · <skill-name> 🔥` as the first line of its response, so
  an active LitCodex skill is always visible at a glance. Enforced at the directive level across all
  20 skills (the same mechanism as the `🔥 <MODE> ENABLED 🔥` banners) and guarded by a per-skill test.

### Changed
- Brand polish: a fire/ember `cover.png` (generated by `generate_cover.py`) and restyled README
  files (centered cover, badges, callouts); GitHub About description + topics.

## [0.1.0] - 2026-06-14

### Added
- Initial LitCodex release: the `litcodex-ai` installer CLI, the bare `lit` UserPromptSubmit
  hook that activates lit-loop, and the durable `lit-loop` runtime that persists multi-goal
  orchestration state under `.litcodex/lit-loop`.
- Self-contained `litcodex install` flow for the Codex platform (marketplace, plugin, and hook
  registration) with `doctor`, `uninstall`, and `config migrate` routes.
- `litcodex loop <create|status|run|checkpoint|record-evidence|doctor|help>` subcommand surface.
- The **lit command family**: a single `UserPromptSubmit` hook routes four bounded trigger
  words to four modes — `lit`/`lit-loop` (execution loop), `litwork` (outcome-first work mode with
  manual-QA evidence + a verification gate + selectable subagent roles installed into
  `~/.codex/agents/`), `lit-plan` (approval-gated planning to `.litcodex/plans/`), and `litgoal`
  (goal binding into `.litcodex/lit-loop/goals.json`). Per-mode idempotency; mode switching allowed.
- A 🔥 HUD banner: every mode mandates `🔥 <MODE> ENABLED 🔥` as its first line,
  and the hook status message carries 🔥. (Codex has no persistent custom statusline.)
- `litcodex install` installs the six `litwork` subagent roles (`litcodex-*.toml`) into the Codex
  agents directory, backup-safe and idempotent; `litcodex uninstall` removes them; `litcodex doctor`
  reports their presence.
- **Full toolkit port** — the complete reference skill + component set, lit-branded and
  legacy-token-free:
  - 18 additional plugin-root skills (now 20 total), discoverable under `plugins/litcodex/skills/` —
    spanning debugging, frontend/UI-UX, git, programming, refactoring, code review, research,
    visual QA, project rules, and the `litcodex-doctor`/`-report-bug`/`-contribute-bug-fix` helpers.
  - Six hook components wired through the registry-validated aggregate `hooks.json`: `git-bash`
    (Windows git_bash reminder), `comment-checker` (edit-comment review; degrades gracefully without
    its external engine), `lsp` (post-edit diagnostics — inert placeholder until an LSP daemon is
    provided), a Stop/SubagentStop continuation hook (nudges resuming in-flight work), `rules`
    (project-rule injection across the session lifecycle), and `telemetry` (a deliberately inert
    **local no-op** stub — no network, no data collection).
- Release-metadata policy: single-source `VERSION`, the version-lockstep guard, and the
  release preflight checklist.
