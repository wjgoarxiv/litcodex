<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.25/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.25/readme-assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitCodex robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.25/readme-assets/badge-version.svg" alt="1.0.25" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.25/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.25/readme-assets/lucide-book-open.svg" width="16" alt="" /> Docs</a> &nbsp; <a href="#install">Install</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/assets/readme/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.25/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.25/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitCodex

**Keep the work lit.**

A plugin for Codex CLI that turns a request into a goal with checks, keeps the evidence in your project,
and hands unfinished work to the next session.

**[Full guide on GitHub](https://github.com/wjgoarxiv/litcodex#readme)** · [한국어](https://github.com/wjgoarxiv/litcodex/blob/main/packages/litcodex-ai/README-Ko-KR.md)

## Install

You need Node.js 22 or later and Codex CLI.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex install
```

The installer asks which model leads, which model helps and which output style you like, shows what it is
about to write, and changes only the keys it manages in `~/.codex/config.toml`. To see the plan first, run
`npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex --dry-run install`. To skip the
questions, add `--yes` after `install`.

```sh
npm install -g @litfamily/litcodex
litcodex install
```

A global install also gets the video skill's tools ready with a few pinned downloads. The
[install guide](https://github.com/wjgoarxiv/litcodex/blob/main/docs/install.md#a-global-command) lists them
and shows how to skip them.

> Without a global install, use `npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex <command>`.

## First task

Open Codex in your project, approve the LitCodex hooks in the startup review, and type:

```text
lit add input validation to the signup form
```

The reply opens with `🔥 **LIT IGNITED · <discipline>** 🔥`. A goal is complete once every check has
passing evidence, and the records live under `.litcodex/lit-loop/` in your project; `lit recap` reads them
back. Send exact bare `handoff` before you leave, and the next session gets a continuation packet to start
from. The exact bare `lit-scientific-visualization` hook route loads the plotting adapter;
it does not install Python dependencies.

## Skills

Pick any skill in the Codex skill picker or mention it by scoped name, such as `$litcodex:lit-humanizer`,
`$litcodex:lit-fetch`, `$litcodex:lit-handoff` or `$litcodex:lit-scientific-visualization`. The
[skills page](https://github.com/wjgoarxiv/litcodex/blob/main/docs/skills.md) has a picture of each one.

- **Loop and planning:** `lit-loop` (`lit`), `litwork`, `lit-plan`, Start Work (`lit start work <approved-plan>`),
  `litgoal`, `deep-interview`, `lit-crucible`, `lit-team`, `lit-recap` and `lit-handoff`.
- **Review and research:** `review-work`, `litresearch`, `autoresearch`, `autoconference`, `lit-fetch`,
  `wikify`, `coding-session-audit` and `lit-comprehend`.
- **Documents, figures and screens:** `lit-docx`, `lit-pptx`, `lit-diagram-drawer`,
  `lit-scientific-visualization`, `lit-typographic-motion`, `lit-humanizer`, `readme-studio`,
  `frontend-ui-ux`, `visual-qa` and `browser-drive`.
- **Code:** `debugging`, `refactor`, `lit-code`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`,
  `structural-search`, `lsp-setup` and `lit-init`.
- **Upkeep:** `litcodex-doctor`, `litcodex-report-bug` and `litcodex-contribute-bug-fix`. `rules`, `lsp`
  and `comment-checker` run on their own.

## What it changes

- Codex gets the plugin, hooks and agents, plus the managed keys in `~/.codex/config.toml`. Your unrelated
  Codex settings stay as they are.
- Each project gets local records under `.litcodex/lit-loop/`, kept out of Git and packages.
- The doctor diagnostic core never modifies Codex config, install state or plugin state. An eligible
  interactive doctor run (a successful one you start by hand) may show a cached advisory notice about a
  newer version; a detached worker keeps it fresh with a fixed registry refresh saved at
  `~/.litcodex/update-check.json`, and installs nothing. A separate foreground updater can install a newer
  global package after an eligible interactive management command. Set `LITCODEX_NO_UPDATE_CHECK=1` to
  turn off both. A doctor run that failed, or ran with `--json`, `--dry-run`, in a non-TTY or CI shell, or
  with the opt-out set, stays side-effect-free.
- Two optional features are off by default:
  [automatic handoff](https://github.com/wjgoarxiv/litcodex/blob/main/docs/auto-handoff.md) and the
  [Jev skill hint](https://github.com/wjgoarxiv/litcodex/blob/main/docs/jev-skill-hint.md), which sends
  prompts to a third party once you turn it on.
- Tests, fixtures, test helpers and the Vitest configuration live only in the repository. Neither the npm
  package nor the installed marketplace plugin includes them.

## Check, fix, remove

```sh
npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex doctor
```

`litcodex doctor` checks registration, hooks, config and host capabilities; `litcodex loop doctor` checks
the current project's loop state. If `lit` does nothing, run doctor and check that the hooks are approved
in Codex. More fixes are under [troubleshooting](https://github.com/wjgoarxiv/litcodex#troubleshooting).

```sh
npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex uninstall
```

This removes the plugin and the config LitCodex manages, and leaves your other settings alone.

## Links

[Usage reference](https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage.md) ·
[Migration from the old package](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md) ·
[CHANGELOG.md](https://github.com/wjgoarxiv/litcodex/blob/main/CHANGELOG.md) ·
[Privacy](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md) ·
[Issues](https://github.com/wjgoarxiv/litcodex/issues) · MIT license
