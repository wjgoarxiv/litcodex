<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: seven armored machines power on bay by bay, the LitCodex machine in the third bay wakes with a glowing orange visor and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center">
<a href="#install"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/badge-version.svg" alt="1.0.47" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage.md"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/lucide-book-open.svg" width="16" alt="" /> Docs</a> &nbsp; <a href="#install">Install</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/docs/assets/readme/ignition-film.mp4"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="https://github.com/wjgoarxiv/litcodex/blob/main/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litcodex@1.0.47/readme-assets/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitCodex

**Keep the work lit.**

LitCodex is an add-on for Codex CLI. It makes Codex check its own work before it says "done", and leaves a note
so the next session starts where this one stopped.

You ask Codex for a feature. It writes the code and says it is finished, and a day later you find the tests never
ran. You open a new session and explain the whole project again.

With LitCodex you add `lit` to the same request. Codex first writes down what "finished" means for this task, adds a
test that fails, makes it pass, and ends by telling you what it checked and what it could not. When you stop, type
`handoff`. Codex saves a note, and the next session reads it and carries on.

**[Full guide on GitHub](https://github.com/wjgoarxiv/litcodex#readme)** · [한국어](https://github.com/wjgoarxiv/litcodex/blob/main/packages/litcodex-ai/README-Ko-KR.md)

## Install

You need Node.js 22 or later and Codex CLI.

```sh
npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex install
```

The installer asks which model leads, which model helps and which output style you like, shows what it is
about to write, and changes only the keys it manages in `~/.codex/config.toml`. In a terminal each question is a card
you answer with the arrow keys or a number and Enter; pipes, CI and `TERM=dumb` keep plain prompts. To see the plan first, run
`npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex --dry-run install`. To skip the
questions, add `--yes` after `install`.

The installer, `litcodex doctor` and `litcodex --help` open with the synthwave LIT mark, sized to the terminal. Without
colour it is drawn in plain block characters, and a pipe, a CI log or a terminal without UTF-8 gets one plain
`LIT · codex cli` line instead.

```sh
npm install -g @litfamily/litcodex
litcodex install
```

A global install also gets the video skill's tools ready with a few pinned downloads. The
[install guide](https://github.com/wjgoarxiv/litcodex/blob/main/docs/install.md#a-global-command) lists them
and shows how to skip them.

> Without a global install, use `npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex <command>`.

## Two ways to use it

**The easy way.** Write your request as usual and put `lit` at the start or at the end:

```text
fix the date parsing bug in src/dates.js lit
```

Codex sets the goal, writes a failing test, fixes the bug, checks the result and tells you what it checked.
Most tasks need nothing more.

Either end works the same way: with `lit` at the end, the words before it become the goal, and in a project with a
test command the hook asks `Set goal for this lit-loop: /goal <condition>? (yes / no)` first. A trailing `lit-loop`
or `litwork` picks the same mode as a leading one.

**The full workflow.** For a bigger job, go one step at a time. Each step hands its result to the next, and you can
skip any step you do not need.

| Step | Type | What happens |
| --- | --- | --- |
| 1. Explore | `lit brainstorm <question>` | Many options, scored and cut to a short list you pick from |
| 2. Clarify | `lit deep interview <idea>` | Codex asks questions until the goal is clear |
| 3. Plan | `lit-crucible <approach>` or `lit plan <task>` | Crucible attacks the approach first and hands what survives to lit-plan; lit-plan writes the steps and waits for your yes |
| 4. Build | `yes` to the plan, or `lit <task>` | Codex works through it with tests and checks |
| 5. Review | `lit review` | A review in five lanes, findings first |
| 6. Hand off | `handoff` | The decisions and the next step, saved to a file |

## First task

Open Codex in your project, approve the LitCodex hooks in the startup review, and type:

```text
lit add input validation to the signup form
```

The reply opens with `🔥 **LIT IGNITED · <discipline>** 🔥`, and from there the request is a goal with
checks. It counts as done once every check has passing evidence. The records live under
`.litcodex/lit-loop/` in your project, and `lit adhd recap` reads them back. Before you leave, send
exact bare `handoff` and the next session gets a continuation packet to start from. When you need
publication plots, send the exact bare `lit-scientific-visualization` hook route; it loads the plotting
adapter and does not install Python dependencies.

## Skills

Pick any skill in the Codex skill picker or mention it by scoped name, such as `$litcodex:lit-humanizer`,
`$litcodex:lit-fetch`, `$litcodex:lit-handoff` or `$litcodex:lit-scientific-visualization`. The
[skills page](https://github.com/wjgoarxiv/litcodex/blob/main/docs/skills.md) has a picture of each one.

- Loop and planning: `lit-loop` (`lit`), `litwork`, `lit-plan`, Start Work (`lit start work <approved-plan>`),
  `litgoal`, `deep-interview`, `lit-brainstorm`, `lit-crucible`, `lit-team`, `ultra-brainstorm` and `lit-handoff`.
- Review and research: `review-work`, `litresearch`, `autoresearch`, `autoconference`, `lit-fetch`,
  `wikify`, `coding-session-audit`, `lit-comprehend`, `lit-hijack` and `lit-adhd`.
- Documents, figures and screens: `lit-docx`, `lit-pptx`, `lit-diagram-drawer`,
  `lit-schematic`, `lit-scientific-visualization`, `lit-typographic-motion`, `lit-humanizer`, `readme-studio`,
  `frontend-ui-ux`, `visual-qa` and `browser-drive`. All of these except `lit-humanizer` and `browser-drive` now
  live in wjgoarxiv-skills; their names here are stubs that give the copy command for `~/.codex/skills/`.
- Code: `debugging`, `refactor`, `lit-code`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`,
  `structural-search`, `lsp-setup` and `lit-init`.
- Upkeep: `litcodex-doctor`, `litcodex-report-bug` and `litcodex-contribute-bug-fix`. `rules`, `lsp`
  and `comment-checker` run on their own.

## Extensions

LitCodex carries the LitFamily core, which is complete and works on its own. Nine skills that make files (decks,
documents, figures, design, video and covers) are LitFamily extensions, kept in the extension shelf
[wjgoarxiv-skills](https://github.com/wjgoarxiv/wjgoarxiv-skills). Install the ones you use alongside LitCodex to
get the full LitFamily experience. LitCodex can install them for you, and each command only prints its plan until
you add `--yes`:

```bash
litcodex extensions list
litcodex extensions install lit-docx --yes
litcodex extensions install --family figures --yes
litcodex extensions check
litcodex extensions update --yes
```

`install` stops when a same-name skill sits in `~/.agents/skills` or the project's skill folders, moves an old copy
whole to `~/.codex/extension-backups/`, copies and leaves a receipt. Without `--from <path to your clone>` it keeps a
sparse clone of the shelf in `~/.cache/litcodex/extensions-src`. `remove` refuses folders you made yourself, `check`
prints a fix line per problem, and `prune-backups --yes` deletes old backups.

To do it by hand, clone the shelf once, then run four lines from your project folder with your clone path in place
of the placeholder, for example for `lit-docx`:

```bash
git clone https://github.com/wjgoarxiv/wjgoarxiv-skills
cx="${CODEX_HOME:-$HOME/.codex}"; p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/lit-docx" ] && echo "found: $d/lit-docx"; done; echo "check done"
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-docx" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/lit-docx" ] && mv "$cx/skills/lit-docx" "$b/lit-docx" && echo "moved aside: $b/lit-docx"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-docx" ]; then echo "stopped: $cx/skills/lit-docx still exists"; else mkdir -p "$cx/skills" && cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-docx" "$cx/skills/lit-docx"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; [ -f "$cx/skills/lit-docx/SKILL.md" ] && printf '{"id":"lit-docx","source":"%s","variant":"litcodex","installed_at":"%s"}\n' "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-docx" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/lit-docx/.litfamily-extension.json"
```

The lines look for same-name skills in every folder Codex reads, move an old copy whole to
`~/.codex/extension-backups/<date-time>/lit-docx` (Codex does not read it), copy into the empty folder, and leave a
receipt inside it. Run them again to update; run only the second line to remove. Each stub, such as
`$litcodex:lit-pptx`, prints its own lines. An upgrade saves files you added or changed in
LitCodex skill folders to `~/.codex/litcodex-backups/<date>/` first. Versions up to 1.0.38 left runtimes in
`~/.cache/litcodex/office` and `~/.cache/litcodex/motion-runtime`; delete them if you do not install the extensions.

## What it changes

- Codex gets the plugin, hooks and agents, plus the managed keys in `~/.codex/config.toml`. Your unrelated
  Codex settings stay as they are.
- Each project gets local records under `.litcodex/lit-loop/`, kept out of Git and packages.
- [Automatic handoff](https://github.com/wjgoarxiv/litcodex/blob/main/docs/auto-handoff.md) is on by default
  at 80% of the context window; `lit-handoff auto off` turns it off.
- Tests, fixtures, test helpers and the Vitest configuration live only in the repository. Neither the npm
  package nor the installed marketplace plugin includes them.

LitCodex also keeps an eye on new releases. The doctor diagnostic core never modifies Codex config, install
state or plugin state. After an eligible interactive doctor run (a successful one you start by hand) it may
show a cached advisory notice about a newer version; a detached worker keeps that notice fresh with a fixed
registry refresh saved at `~/.litcodex/update-check.json`, and installs nothing. A separate foreground
updater can install a newer global package after an eligible interactive management command. If you would
rather have neither, set `LITCODEX_NO_UPDATE_CHECK=1`. A doctor run that failed, or ran with `--json`,
`--dry-run`, in a non-TTY or CI shell, or with the opt-out set, stays side-effect-free.

## Check, fix, remove

```sh
npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex doctor
```

`litcodex doctor` checks registration, hooks, config and host capabilities; `litcodex loop doctor` checks
the current project's loop state. If `lit` does nothing, run doctor and check that the hooks are approved
in Codex. A state lock left by a crashed process clears on its own. More fixes are under
[troubleshooting](https://github.com/wjgoarxiv/litcodex#troubleshooting).

```sh
npm exec --yes --package @litfamily/litcodex@1.0.47 -- litcodex uninstall
```

This removes the plugin and the config LitCodex manages, and leaves your other settings alone.

## Links

[Usage reference](https://github.com/wjgoarxiv/litcodex/blob/main/docs/usage.md) ·
[Migration from the old package](https://github.com/wjgoarxiv/litcodex/blob/main/docs/npm-migration.md) ·
[CHANGELOG.md](https://github.com/wjgoarxiv/litcodex/blob/main/CHANGELOG.md) ·
[Privacy](https://github.com/wjgoarxiv/litcodex/blob/main/docs/privacy.md) ·
[Issues](https://github.com/wjgoarxiv/litcodex/issues) · MIT license ·
[Trademark policy](https://github.com/wjgoarxiv/litcodex/blob/main/TRADEMARK.md)
