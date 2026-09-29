<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.10/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.10/readme-assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitCodex robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.10/readme-assets/badge-version.svg" alt="1.0.10" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.10/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.10/readme-assets/lucide-book-open.svg" width="16" alt="" /> Docs</a> &nbsp; <a href="#install">Install</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/assets/readme/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.10/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.10/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitCodex

**Keep the work lit.**

LitCodex is a plugin for Codex CLI. It adds planning, review, research and a durable execution loop, so a
piece of work can outlast the conversation it started in. Add `lit` to a request, and the goal, its checks and
the results stay in your project, where a later session can pick them up.

**[Full guide, skills gallery and A/B results on GitHub](https://github.com/wjgoarxiv/litcodex#readme)** · [한국어](https://github.com/wjgoarxiv/litcodex/blob/main/packages/litcodex-ai/README-Ko-KR.md)

## Install

You need Node.js 22 or later and Codex CLI.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.10 -- litcodex install
```

The installer registers the plugin, its hooks and its agents, and changes only the keys it manages in
`~/.codex/config.toml`. It asks which model leads, which model helps, and which output style you like. A
fresh install starts with `gpt-6-astra` at `xhigh` for the lead and `gpt-6-luna` at `max` for helpers. To
see the changes before they happen, run
`npm exec --yes --package @litfamily/litcodex@1.0.10 -- litcodex --dry-run install`. To install without
any questions, add `--yes` after `install`.

For a global command:

```sh
npm install -g @litfamily/litcodex
litcodex install
```

After a global install, unless `CI` is set, a short setup script prints a welcome and gets the video skill,
`lit-typographic-motion`, ready ahead of time, so its rendering tools are in place before your first
video. That means a few downloads: pinned npm packages from your registry and pinned font and license
files from GitHub and apache.org, all into `${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime/`. No
browser is downloaded. If the step does not finish, LitCodex is still installed; run
`litcodex motion-runtime install` later to try again.

To keep the script out of the global install, add `--ignore-scripts` or set `CI=1` for that command.
That only postpones the downloads: `litcodex install` prepares
the same tools after a successful install, with no switch to turn it off.

> Without a global install, use `npm exec --yes --package @litfamily/litcodex@1.0.10 -- litcodex <command>`.

To try LitCodex apart from your existing settings, follow the
[isolated trial guide](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md#isolated-local-trial).
It gives the trial a whole home of its own, since changing only `CODEX_HOME` still lets your existing
settings be found. On Windows the installer and CLI shims work; Python routes that need POSIX stop there
with `BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME`.

## First task

Open Codex in your project, approve the LitCodex hooks in the startup review, and type:

```text
lit add input validation to the signup form
```

The reply opens with `🔥 **LIT IGNITED · <discipline>** 🔥`, which tells you the request reached
LitCodex. A goal is complete once every one of its success criteria passes, and the records live
under `.litcodex/lit-loop/` in your project.

For a first run you can judge yourself, try this in an empty folder:

```text
lit build a single-file HTML task list in this folder. Do not install dependencies.
Check adding and completing a task, and record anything you could not verify.
```

Then look at the result, the checks that actually ran, and what is still open. `lit recap` reads back what
was recorded, and sending `handoff` on its own before you leave gives the next session a place to start.

## Routes people use most

| Type this | What happens |
| --- | --- |
| `lit` | Starts a bounded task, with goals and checks kept in the project. |
| `handoff` or `/lit-handoff` | Carries the checked result and the next step into another session. |
| `lit-plan` | Writes a plan and success criteria before anything is edited. |
| `lit start work <approved-plan>` | Runs a plan you have approved. |
| `review-work` | Reviews the change and its evidence. |
| `litresearch` | Researches with sources and keeps track of what is still uncertain. |

Two words work only when they are the whole message. Send exact bare `handoff` to write a continuation
packet. The exact bare `lit-scientific-visualization` hook route loads the plotting adapter;
it does not install Python dependencies.

## What else is in the package

You can pick these skills in the Codex skill picker or mention one by scoped name, such as
`$litcodex:lit-humanizer`, `$litcodex:lit-fetch`, `$litcodex:lit-handoff` or
`$litcodex:lit-scientific-visualization`. The GitHub page has a picture for each one.

**Planning and running work**

- `lit-loop` (`lit`): works inside a loop that survives across sessions, and writes down what it could not verify.
- `litwork`: a careful build or fix from start to finish, failing test first, then proof where the thing actually runs.
- `lit-plan`: an approved plan with numbered rows in `.litcodex/plans/`; planning only.
- Start Work (`lit start work <approved-plan>`): runs an approved plan through five gates.
- `litgoal`: binds one goal with observable criteria to the loop.
- `deep-interview`: one question at a time until the idea is clear enough to build.
- `lit-crucible`: pressure-tests a brief before planning, so only surviving risks reach the plan.
- `lit-team`: gives several workers separate slices, each reporting back with evidence.
- `lit-recap` and `lit-handoff`: a read-only summary of where things stand, and a file the next session resumes from.

**Review, research and knowledge**

- `review-work`: five separate reviews, and any one of them can hold back approval.
- `litresearch`: parallel evidence gathering and a cited synthesis, only when you ask for research.
- `autoresearch` and `autoconference`: an approved, budgeted experiment loop, and a budgeted research conference.
- `lit-fetch`: reads a public page with URL, DNS and text-safety checks when ordinary retrieval falls short.
- `wikify`: keeps reviewed project knowledge on disk and answers later questions from it, with sources.
- `coding-session-audit`: reads a past Codex session from its evidence and shows where it stopped.
- `lit-comprehend`: an explainer page for agent-written work, ending in a short quiz.

**Documents, figures and interfaces**

- `lit-docx` and `lit-pptx`: a styled Word file or an editable PowerPoint deck, each with its Markdown source.
- `lit-diagram-drawer`: an editable diagram, checked and exported to PNG and Office-safe SVG.
- `lit-scientific-visualization`: a journal-sized figure with vector and 600 DPI exports.
- `lit-typographic-motion`: a short film, starting from a written treatment.
- `lit-humanizer`: rewrites stiff model prose in English or Korean, keeping facts and hedges.
- `readme-studio`: a factual README with a moving cover.
- `frontend-ui-ux`, `visual-qa` and `browser-drive`: builds an interface, checks a real screen at each
  viewport, and drives a real page once the browser driver is verified.

**Code**

- `debugging`: reproduces the bug, tests at least three explanations, fixes only the confirmed cause.
- `refactor`: restructures code while tests pin its behavior.
- `lit-code`: strict implementation rules, with tests first and typed boundaries.
- `lit-commit`: atomic commits in the repository's own style.
- `lit-burnoff` and `lit-burnoff-file`: clean AI-written bloat from a change set or from one file.
- `structural-search`: finds code by syntax shape and previews rewrites.
- `lsp-setup` and `lit-init`: language-server setup checks, and sparse AGENTS.md guidance.

**Keeping LitCodex healthy**

- `litcodex-doctor`, `litcodex-report-bug` and `litcodex-contribute-bug-fix`: install health checks, a
  source-backed bug report, and a tested bug-fix PR.
- `rules`, `lsp` and `comment-checker` run on their own: project rules on each prompt, LSP and comment
  checks after edits.

## A/B results

In ten one-line A/B tasks against plain Codex, the final verdicts for LitCodex were 8 won, 1 tie, 1 lost
(the maintainer's call, except S7, which only the blind judge reviewed); the blind judge's were
3 won, 2 ties, 5 lost. Each arm ran once, and the lit arm used a local pre-release build. The GitHub page has
[every task, both verdicts and the screenshots](https://github.com/wjgoarxiv/litcodex#ab-plain-codex-vs-lit).

## What it changes

Codex hosts the plugin and runs its hooks. The hooks work out which mode a request belongs to, the skills
guide the agent, and the loop CLI keeps the project records. LitCodex never calls Codex's goal tools
itself; the agent uses them when they are there. A paused or blocked goal needs the recovery step below.

- Codex gets the plugin, hooks and agents, plus the managed keys in `~/.codex/config.toml`. Your unrelated
  Codex settings stay as they are. Look at the planned changes before you use `--reconfigure`.
- The model you pick is a setting in your config. Whether it is open to you, and whether it actually
  runs, is up to Codex and your account.
- Each project gets local records under `.litcodex/lit-loop/`, kept out of Git and packages.
- The doctor diagnostic core never modifies Codex config, install state or plugin state. An eligible
  interactive doctor run (a successful one you start by hand) may show a cached advisory notice about a
  newer version; a detached worker keeps it fresh with a fixed registry refresh saved at
  `~/.litcodex/update-check.json`, and installs nothing. A separate foreground updater can install a newer
  global package after an eligible interactive management command. Set `LITCODEX_NO_UPDATE_CHECK=1` to
  turn off both. A doctor run that failed, or ran with `--json`, `--dry-run`, in a non-TTY or CI shell, or
  with the opt-out set, stays side-effect-free.
- Tests, fixtures, test helpers and the Vitest configuration live only in the repository. Neither the npm
  package nor the installed marketplace plugin includes them.

The optional Jev skill hint suggests a bundled skill for a plain prompt, and it is off by default.
Turning it on (`LITCODEX_JEV=1` plus your own `TYPESAFE_API_KEY`) sends each eligible prompt to TypeSafe
(typesafe.ai). The prompt is cut to 2,000 characters and home paths, email addresses and token-shaped
strings are redacted; the rest of it is sent as written. Nothing else from the session goes with it:
no files, tool output or history.
Read [the full description](https://github.com/wjgoarxiv/litcodex#jev-skill-hint-optional) and the
[privacy notes](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md#optional-jev-skill-hint)
before you turn it on.

## Check, fix, remove

```sh
npm exec --yes --package @litfamily/litcodex@1.0.10 -- litcodex doctor
```

`litcodex doctor` checks registration, hooks, config and host capabilities; `litcodex loop doctor` checks the
current project's loop state. Both look at the setup; a small real task shows whether signed-in model work runs.

- **`lit` does nothing.** Run `litcodex doctor` and check that the hooks are approved in Codex.
- **The command is missing.** Use the `npm exec` form above, or put npm's global bin directory on your `PATH`.
- **A native goal is paused or blocked.** Run `/goal resume`, confirm the goal is active, then retry with
  `litcodex loop run --retry-failed`. Keep the unfinished goal.
- **The pane closes before any output.** Find the failing step: run help, install and doctor one at a
  time in an open terminal, note each exit status, and see [troubleshooting](https://github.com/wjgoarxiv/litcodex#troubleshooting).

```sh
npm exec --yes --package @litfamily/litcodex@1.0.10 -- litcodex uninstall
```

This removes the plugin and the config LitCodex manages, and leaves your other settings alone.

## Links

[Usage reference](https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage.md) ·
[Migration from the old package](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md) ·
[CHANGELOG.md](https://github.com/wjgoarxiv/litcodex/blob/main/CHANGELOG.md) ·
[Privacy](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md) ·
[Issues](https://github.com/wjgoarxiv/litcodex/issues) · MIT license
