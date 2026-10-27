<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: seven armored machines power on bay by bay, the LitCodex machine in the third bay wakes with a glowing orange visor and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

# LitCodex

**Keep the work lit.**

Put `lit` in front of a request and Codex CLI works toward checks that can pass or fail, calling the job
done only when each one has proof. The proof stays in your project, so tomorrow's session starts where
today's stopped.

<p>
<a href="https://www.npmjs.com/package/@litfamily/litcodex"><img src="https://img.shields.io/npm/v/@litfamily/litcodex?color=FF6337&label=npm" alt="npm version" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litcodex"><img src="https://img.shields.io/npm/dm/@litfamily/litcodex?color=FF6337" alt="npm downloads per month" /></a>
<a href="./LICENSE"><img src="https://img.shields.io/npm/l/@litfamily/litcodex?color=A3E635" alt="MIT license" /></a>
<a href="https://github.com/wjgoarxiv/litcodex/stargazers"><img src="https://img.shields.io/github/stars/wjgoarxiv/litcodex?color=A3E635" alt="GitHub stars" /></a>
</p>

[한국어](./README-Ko-KR.md) · [Install](#install) · [First task](#start-with-lit) · [What you get](#what-you-get) · [Commands](#commands) · [Learn more](#learn-more)

Try it now. You need Node.js 22 or later and Codex CLI:

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex install
```

Then open Codex in your project, approve the LitCodex hooks when Codex asks, and type a request with
`lit` in it:

```text
lit add input validation to the signup form
```

The short film below is one real turn: a test written first, a failing run, the fix, and a passing run
before Codex says the turn is done.

<p><img src="./docs/assets/demo.webp" width="960" alt="A short film of a LitCodex session in Codex CLI. It opens on a title card with the LIT mark: LitCodex, The lit workflow for Codex CLI. Numbered labels then follow one turn in a small Node project. 1: typing &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot; turns LitCodex on. 2: the hook block shows the LIT mark beside &quot;🔥 LIT IGNITED · lit-loop 🔥&quot;. 3: the line under the mark, &quot;🔨 WORK › 🔍 · › 🏁 ·&quot;, is a map of where the turn stands: work now, then review and done. 4: Codex plans first and reads its lit-code playbook, Read SKILL.md (litcodex:lit-code skill). 5: it writes the test before the fix, Edited test/greet.test.js, and npm test fails with exit 1. 6: it fixes greet.js, runs the CLI with --shout and runs npm test again. 7: the summary says the tests and the direct CLI checks pass, and the Stop hook adds &quot;✨ turn done&quot;. The film closes on a card with the install command." /></p> <!-- demo-gif -->

## What is LitCodex

Codex CLI is quick at the next step. The trouble starts when a piece of work is bigger than one
conversation. The context fills up or the session ends, and the next session has to work out again what
was decided, what was checked and what was left half done. Somewhere along the way, a change that nobody
actually verified gets called finished.

LitCodex is a plugin for Codex CLI that keeps that thread. Put `lit` in a request and it becomes a goal
with checks that can pass or fail. The goal counts as finished only when every check has recorded
evidence, and those records stay in your project, where any later session can read them. Send the single
word `handoff` before you stop, and the next session starts from a written note of where you were.

Around that loop come more than forty skills for planning, code review, research, debugging, Word and
PowerPoint files, and English or Korean prose. The work runs inside Codex on your machine, with your
own sign-in and models.

It is built for people who already use Codex CLI on work that outlasts one sitting: a feature that takes a
few days, a refactor you want planned before anyone edits, research you need with sources, a report or
deck that has to end up as a real file. If you want the one-line version for a friend: Codex stops calling
unchecked work done, and you stop explaining the same project twice.

## Install

You need Node.js 22 or later and Codex CLI. Then run:

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex install
```

The installer asks three questions: which model leads, which model helps, and which output style you
like. Pressing Enter keeps the recommended models and your current output style. It then shows the route it is about to
write and waits for one more Enter before it touches anything. It registers the plugin, its hooks and its
agent roles, and it changes only the keys it manages in `~/.codex/config.toml`. When the receipt says
`Status Ready for Codex`, the doctor check has already passed.

To see the plan first, run `npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex --dry-run install`;
it prints every step and writes nothing. To keep the defaults without any questions, add `--yes` after `install`.

If you would rather have `litcodex` on your `PATH`:

```sh
npm install -g @litfamily/litcodex
litcodex install
```

A global install also gets the video skill's rendering tools ready ahead of time, which means a few
pinned downloads. The [install guide](./docs/install.md#a-global-command) lists them and shows how to skip
them.

> Without a global install, use `npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex <command>`, such as `npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex doctor`.

The [install guide](./docs/install.md) also covers trying LitCodex in a home of its own, Windows, and
pictures of every screen the installer shows. Coming from the old unscoped package? The
[migration guide](./docs/npm-migration.md) covers the move.

### Let a coding agent install it

You can also hand the install to a coding agent such as Codex itself. Paste the prompt below into it. The agent
checks what you have, shows you the plan and waits for your yes before it changes anything, then runs the doctor
check and tells you what it found.

```text
Install LitCodex, a plugin for Codex CLI, on this machine. Follow these steps in order.

1. Check that Node.js 22 or later and Codex CLI are installed (node --version, codex --version).
   If either is missing, stop and tell me what to install.
2. Use only the official npm package @litfamily/litcodex. Do not install a package with a similar
   name, and do not download install scripts from anywhere else.
3. Show me the plan first. Run this command, which prints every step and writes nothing:
   npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex --dry-run install
   Summarize what it will change, then ask me whether to go ahead. Do not continue until I say yes.
4. After I say yes, run:
   npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex install --yes
   (--yes keeps the recommended models and my current output style.)
5. Run the check and report its result to me, quoting any issue or warning exactly:
   npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex doctor
6. Remind me to restart Codex so it loads the plugin, and to approve the LitCodex hooks when Codex
   asks me to review them.
```

## Start with lit

Open Codex in your project. The first time, Codex asks you to review the LitCodex hooks; approve them.
Then type:

```text
lit add input validation to the signup form
```

The hook answers before the model does. A five-row LIT mark appears, sent by the `UserPromptSubmit` hook
as plain text, and the reply opens with `🔥 **LIT IGNITED · <discipline>** 🔥`. From there the request
runs in the work loop (`<lit-loop-mode>` internally): a goal, its checks, and evidence recorded as each
check passes.

Under the mark sits a small LIT card, so you can see at a glance how far the work has come:

```text
┃ 🔥 LIT · lit-loop  turn started
┃ ✓ INTERVIEW  ›  ✓ PLAN  ›  🔨 WORK ▰▰▰▱▱▱▱ 3/7  ›  🔍 REVIEW  ›  🏁 DONE
┃ ✓ Render the map
┃ ▸ Show the map in the terminal
┃ · Write the docs
```

The second row is the map. Read left to right, that is the interview, the plan, the work with a bar of
finished plan tasks, review and done. Finished stages carry a ✓; with card colour on, the current stage is
bold orange and later stages are dimmed. Below it are up
to three rows of the plan or the lit-loop goals: the last one finished, the open one and the next. The card
is drawn from what the project has actually saved, so a stage with nothing behind it is left out. Research
has a map of its own (decomposition, waves, verification, synthesis) that resumes from the research journal
in progress, or starts at decomposition when there is none.

When a LIT turn ends, the Stop hook draws the same card with a summary in its first row, such as
`✨ turn done · 2 tasks ✓ · next ▸ Write the docs`. If `lit start work` reaches a checkpoint and keeps going in
the same turn, the summary reads `⏳ 3/7 tasks ✓ · continuing ▸ Write the docs` instead. The card is plain text
by default, because the Codex desktop app and IDE show colour codes in hook text as raw characters.

LitCodex listens for `lit` as a word of its own. Words that merely contain the letters, such as `split`,
`literal` or `litmus`, pass through untouched, and so does `lit` inside a code span or a code block.
Slash commands are left alone as well, with one exception: `/litresearch` starts research.

Two words are exact-only routes: they work only when they are the whole message. Send exact bare `handoff` before you leave a session,
and LitCodex writes a continuation packet for the next one. Send exact bare `lit-scientific-visualization`
when you want publication plots; it switches to plotting mode (`<lit-scientific-visualization-mode>`) and
installs no Python packages.

### Make one small thing

For a first run you can judge yourself, try this in an empty folder:

```text
lit build a single-file HTML task list in this folder. Do not install dependencies.
Check adding and completing a task, and record anything you could not verify.
```

When it finishes, look at three things: the page itself (open it and add a task), the checks that
actually ran, and what is still open. `lit recap` reads back what was recorded. Send `handoff` on its own
before you close the session, and in the next one ask Codex to read that packet and the project goals
first.

## What you get

### Work that finishes for real

`lit` turns a request into a goal with checks. A goal can be completed
only once every check has passing evidence, and anything Codex could not verify is written down where
you will see it.

```text
lit fix the flaky login test and show me the run that proves it
```

### A plan before the edits

`lit plan` writes a plan with numbered steps and success criteria into
`.litcodex/plans/` and edits nothing else. Once you approve it, `lit start work <plan-name>` runs each step
through five gates (re-read, automated checks, manual QA, adversarial QA, cleanup) and finishes only after
all five review lanes pass.

```text
lit plan move the settings page to the new form library
```

### Reviews that can say no

`lit review` runs five separate reviews of a plan or a finished change, and
any one of them can hold back approval.

### Research with sources

`lit research` gathers evidence in parallel and writes a cited synthesis that
keeps facts, hypotheses and open questions apart.

```text
lit research which Node 22 OAuth libraries support PKCE, with sources
```

### Word and PowerPoint files

Ask for a report or slides with `lit` and the matching skill (`lit-docx`
or `lit-pptx`) reads your material, picks a design direction, names it with two alternatives, and builds
an editable file with its Markdown source next to it.

```text
lit turn notes.md into a ten-slide deck for the Monday review
```

### Cleaner prose, in English or Korean

`$litcodex:lit-humanizer` rewrites stiff model writing while
keeping facts and hedges. Before a file is written, its hook stops a few clear drafting tells.

### Also in the box

Every skill can be picked in the Codex skill picker or mentioned by name, such as `$litcodex:debugging`.
[The skills page](./docs/skills.md) has a picture and a one-line description for each.

| For | Skills |
| --- | --- |
| Code | `debugging`, `refactor`, `lit-code`, `lit-commit`, `lit-burnoff`, `lit-burnoff-file`, `structural-search`, `lsp-setup`, `lit-init` |
| Planning and teams | `deep-interview`, `lit-brainstorm`, `lit-crucible`, `litgoal`, `litwork`, `lit-team` |
| Research and knowledge | `autoresearch`, `autoconference`, `wikify`, `lit-fetch`, `coding-session-audit`, `lit-comprehend`, `lit-hijack`, `lit-adhd` |
| Screens, figures and film | `frontend-ui-ux`, `visual-qa`, `browser-drive`, `readme-studio`, `lit-diagram-drawer`, `lit-schematic`, `lit-scientific-visualization`, `lit-typographic-motion` |
| Keeping LitCodex healthy | `litcodex-doctor`, `litcodex-report-bug`, `litcodex-contribute-bug-fix` |
| Running on their own | `rules`, `lsp` and `comment-checker`: project rules on each prompt, LSP and comment checks after edits |

## What you can make

Four pictures, each made by running a bundled skill's own scripts on this machine. Every figure in them is example data.

### Where was I

```text
lit adhd
```

`lit-adhd` reads your recent Codex sessions and lays out what waits on you, what runs, what ended and one next step. This brief is built from fixture sessions and drawn by the Codex terminal.

<p align="center"><img src="./docs/assets/gallery/adhd-brief.webp" width="720" alt="The lit adhd brief in the Codex terminal: a headline counting six sessions, one waiting and one running, a card for each session with its goal, steps and next step, a roadmap with a progress bar, a table of four ended sessions and a boxed recommended next step." /></p>

### A deck

```text
lit turn the district rent survey into a ten-slide briefing, newsroom style
```

`lit-pptx` compiles Markdown into a native, editable deck with Pretendard embedded, then checks overflow, contrast and empty slides. This is the bundled newsroom example, rendered to page images.

<p align="center"><img src="./docs/assets/gallery/deck-newsroom.webp" width="720" alt="Contact sheet of an eleven-slide Korean newsroom-style deck: a cover with three key figures, an agenda, line and bar charts, a survey page, a table of districts, a timeline, a sources page and a closing summary on a warm white ground with one orange series." /></p>

### A page

```text
lit build a landing page for a weekly transit ridership briefing, neo-brutalism
```

`frontend-ui-ux` locks a house style first, builds on its kit and then probes the page at 320, 390, 768 and 1440 pixels. Shown at 1440 and 390 pixels.

<p align="center"><img src="./docs/assets/gallery/page-landing.webp" width="720" alt="A neo-brutalism landing page for a ridership briefing service: a yellow-to-lavender hero with a large 1.28M figure and two outlined stat cards at 1440 pixels wide, beside the same hero stacked in one column at 390 pixels wide." /></p>

### A P&ID

```text
lit draw a P&ID of a sodium hypochlorite dosing skid on one A3 sheet
```

`lit-schematic` draws ISA-style symbols, tagged lines, a legend and a title block, and its QA gate passed on this sheet.

<p align="center"><img src="./docs/assets/gallery/pid-dosing-skid.webp" width="720" alt="P&ID of a dosing skid on an A3 sheet: a storage tank, duty and standby metering pumps with filters and check valves, a relief valve, pressure and flow instruments, a legend column on the right and a title block at the bottom." /></p>

## Let LitCodex save the handoff for you

A long session fills the context window, and the next context starts without what this one learned. Sending
`handoff` by hand works, but only if you notice in time. The automatic handoff notices for you. It stays off until
you turn it on, and you choose the point as a percent of the context window. Send this as your whole prompt:

```text
lit-handoff auto on 60
```

LitCodex answers right away, and the prompt never reaches the model. The command also writes that percent into the
project's `.codex/config.toml`, so in a project you have trusted in Codex, Codex compacts by itself right after the
handoff is saved.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/auto-handoff/auto-handoff-on-dark.webp" /><img src="./docs/assets/auto-handoff/auto-handoff-on-light.webp" width="764" alt="A Codex terminal window. The prompt &quot;lit-handoff auto on 60&quot; is followed by &quot;Blocked by hook&quot; and the reply &quot;Automatic handoff is ON at 60%. When a conversation reaches 60% of the context window, Codex is asked to save a handoff. Codex compacts the conversation as soon as the turn that saved the handoff ends.&quot;" /></picture></p>

`lit-handoff auto status` tells you what is set, and `lit-handoff auto off` turns it off and keeps your number for
next time.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/auto-handoff/auto-handoff-status-off-dark.webp" /><img src="./docs/assets/auto-handoff/auto-handoff-status-off-light.webp" width="764" alt="A Codex terminal window with two prompts. &quot;lit-handoff auto status&quot; is followed by &quot;Automatic handoff is ON at 60% (set by command). Codex compacts the conversation as soon as the turn that saved the handoff ends.&quot; Then &quot;lit-handoff auto off&quot; is followed by &quot;Automatic handoff is OFF. Your last percent (60%) is kept for next time.&quot;" /></picture></p>

When a turn ends at or above your percent, the model saves the handoff, starts no other work, and tells you one
line. If Codex is not going to compact by itself, that line asks you to run `/compact`. After the compaction, the
next context starts from the handoff that was just saved.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/auto-handoff/auto-handoff-saved-dark.webp" /><img src="./docs/assets/auto-handoff/auto-handoff-saved-light.webp" width="764" alt="A Codex terminal window. The model&#39;s line &quot;Handoff saved. Run /compact now.&quot; is followed by the prompt &quot;/compact&quot;." /></picture></p>

The [automatic handoff guide](./docs/auto-handoff.md) covers the environment variables, the doctor line and what
happens in a project you have not trusted yet.

## Watch LIT work in the Codex app

In the Codex desktop app, LitCodex can show a small LIT card in the thread. It shows which LIT skill is running,
the workflow map with the stage it is on, and the tool working right now with a clock beside it. The card updates
by itself while the agent works and slows down when nothing is happening.

The app keeps a card where it was first drawn, so a long thread would scroll it out of view. Each prompt that
starts LIT therefore opens a fresh card next to the newest turn, and the earlier cards fold into one quiet line
that says how their turn ended and stop updating. Prompts that do not start LIT get no card of their own; the
newest card keeps following them.

<p><img src="./docs/assets/app-card/app-card-thread.webp" width="764" alt="A thread in the Codex desktop app. The prompt &quot;lit add a --version flag that prints the package version, with a test&quot; is followed by &quot;Worked for 48s&quot; and the LIT card, then the agent&#39;s summary. The card reads LIT · lit-loop with DONE ✓ on the right, the map work ✓, review, done ✓, the line &quot;✓ turn done in 49s&quot;, and a footer with context use, weekly use, the git branch and the project name." /></p>

<p><img src="./docs/assets/app-card/app-card-done.webp" width="760" alt="A close-up of the LIT card after the turn ends: LIT · lit-loop and DONE ✓ in the header, the workflow map work ✓, review, done ✓, the line &quot;✓ turn done in 49s&quot;, and the footer ctx 16%, 1w 7%, git master, lit-card-demo." /></p>

The card needs the app's MCP Apps feature, which OpenAI still lists as under development; LitCodex never turns it
on for you. The terminal `codex` cannot draw cards, so there the same request prints the map as text, and
`litcodex doctor` shows a `card:` line.

## Watch LIT in a second window

The terminal `codex` has no room for a card, so LitCodex can draw it next door instead. Open a second terminal
window or tab, in any folder, and run:

```bash
litcodex hud
```

It finds the Codex session where LIT was active most recently and keeps its card live: which LIT skill is running, the workflow
map with the stage it is on, the next open task, and the tool working right now with a clock beside it. The top
line names the session, its project folder and when LIT last heard from it. Work in another LIT session and the HUD
moves to it; `--session <id>` keeps it on one session, and `--once` prints a single frame and exits.

The HUD only reads the small records LIT already keeps for that card. It never writes a file, never reads Codex's
own session logs and never talks to Codex, so closing it or killing it changes nothing in the session. A record
it cannot read shows up as one `cannot read …` line. Press Ctrl-C to quit; the terminal
comes back as it was. Colour follows `NO_COLOR`. Tested on macOS; Linux and Windows terminals are not tested yet.

## Colour the LIT card

The LIT card the hooks print is plain text by default. The terminal `codex` (0.162 or newer) can draw it in colour:
finished stages in green, the current stage in bold orange, later stages dimmed.

```bash
litcodex screen-status on
```

Only the terminal `codex` draws the colour. The Codex desktop app and IDE extensions show the colour codes as raw
text in the hook rows, and the hook cannot tell which client is showing it, so turn colour on only if you use the
terminal `codex`. Without colour the card has the same rows as plain text. `litcodex screen-status off` turns it
off and `status` reports it. The setting is kept in `$CODEX_HOME/litcodex/screen-status.json`;
`LITCODEX_SCREEN_STATUS=1` or `0` overrides it, and `NO_COLOR` keeps the card plain.

`litcodex statusline` prints the same status as a single line, such as
`🔥 LIT · lit-loop  🔨 WORK › 🔍 REVIEW › 🏁 DONE  ⠹ Bash 0:12`, for a terminal or tool that runs a command to fill its
status line. Codex itself cannot run one yet.

## Keep LIT under Codex in one terminal

```bash
litcodex run
```

This starts Codex in the same terminal and keeps the bottom four rows for a live LIT panel: the LIT skill and
how long the turn has run, the workflow map, the tool running now with its clock, and the open checklist row.
Codex runs in a pseudo-terminal four rows shorter, so it lays out its whole screen in the space above and the
panel stays put while you type, scroll and resize. Arguments for Codex go after `--`, as in
`litcodex run -- resume --last`, and reach it unchanged.

The panel follows the newest LIT session that started working in this folder after `litcodex run` began; until
then it says, dimmed, that it is waiting for a LIT turn. It reads the same small records as `litcodex hud` and
writes no file. When Codex exits, the panel rows are cleared, the terminal is back to normal and the exit code
is Codex's own. Ctrl-Z does not suspend Codex here (tested on macOS with Codex 0.163.0): quit with Ctrl-C, or run
plain `codex` when you need job control.

The pseudo-terminal comes from `node-pty`, an optional package npm installs with LitCodex wherever a prebuilt
binary exists. Without it, outside a terminal, or in a terminal smaller than 40 columns by 12 rows,
`litcodex run` prints one note and starts Codex the usual way. Tested on macOS; Linux and Windows terminals are
not tested yet.

## How it works

Codex hosts the plugin and runs its hooks. The hooks work out which mode a request belongs to and add
context; the skills tell the agent how to do the work. The loop CLI keeps the project records and prints
instructions for Codex's native goal tools.

```mermaid
flowchart TD
    P["Installed LitCodex plugin"] --> H["Codex hooks: UserPromptSubmit and lifecycle"]
    P --> S["Bundled skills"]
    U["Your request in Codex"] --> H
    H --> A["Codex agent"]
    S --> A
    A --> L["lit-loop CLI: goals, evidence, checkpoints"]
    L --> R["Project records: .litcodex/lit-loop/"]
    L -. "goal instructions" .-> A
    A -. "native tools, when available" .-> G["Codex native /goal"]
    R -. "read when continuing" .-> A
```

The dotted line to Codex's goal tools is an instruction the agent follows when those tools are there;
LitCodex itself never calls them. Sign-in, model access, permissions and every run happen in Codex on
your machine, so judge a piece of work by what it produced and which checks ran. The
[usage reference](./docs/usage.md) goes deeper.

## Commands

### In the Codex composer

| Type this | Mode | What it does |
| --- | --- | --- |
| `lit` or `lit-loop` | **lit-loop** | Runs the work in a durable loop and checkpoints the evidence |
| `litwork` | **litwork** | Outcome-first work, backed by manual QA evidence |
| `lit-plan` or `lit plan` | **lit-plan** | Planning only: a bounded plan with evidence and a final done claim |
| `deep-interview` or `lit deep interview` | **deep-interview** | Planning only: asks questions until a vague brief is clear |
| `lit brainstorm`, `lit ideation` or `lit idea` | **lit-brainstorm** | Many different options, narrowed to a short list you pick from; nothing is built |
| `lit schematic` or `lit-schematic` | **lit-schematic** | Draws real equipment as SVG, PDF and PNG: a P&ID, PFD, apparatus figure or isometric cutaway; a bare `lit` with such a request reaches it too |
| `lit hijack` or `lit-hijack` | **lit-hijack** | Ports a technique someone else published (a post, article, repo or PDF) into your own skill: provenance and licence first, a spec without the source wording, a separate build, and a before and after proof; Korean 하이재킹 and 하이잭 work after `lit` |
| `lit adhd` or `lit rewind` | **lit-adhd** | Read-only "where was I": one brief across your recent Codex sessions with what each was asked, what waits on you, progress gauges, paused work and one next step you run by saying `go`. `lit continue` brings a paused loop back at its stage |
| `litgoal` or `lit goal` | **litgoal** | Sets and keeps the finish line: binds an objective and its criteria into the loop state that lit-loop and Start Work run toward |
| `lit-recap` or `lit recap` | **lit-recap** | A read-only recap from the `.litcodex` ledgers |
| `lit-comprehend` or `comprehend` | **lit-comprehend** | Builds a self-contained explainer outside the worktree |
| `review-work` or `lit review` | **review-work** | A read-only review: plan review before Start Work, work review after it; it picks the mode from what exists, or you force one with `lit review plan` or `lit review work` |
| `litresearch`, `/litresearch`, or `lit research` | **litresearch** | A research journal that keeps facts, hypotheses, sources and uncertainty apart |
| `lit start work <plan-name>` | **Start Work** | Runs an approved plan and keeps its evidence |
| exact bare `handoff` | **lit-handoff** | Creates or refreshes a continuation packet that leaves secrets out |
| exact bare `lit-scientific-visualization` | **lit-scientific-visualization** | Loads the publication plotting adapter through the hook |

The first `lit …` of a session sends the full activation. A later `lit …` that names the same mode gets a short
note that the mode is already active: nothing is read, created or reset again. `lit plan` after `lit` switches,
and sends the plan activation once. A bare `lit` or `lit continue` never switches: it carries on whichever mode is active, and over an active Start Work plan, a published
plan or open goals says it is resuming that work and makes no new plan. `lit new …`, `lit restart …`, a new
session and the first `lit` after a compaction start over in full. A bare `lit` with no task and no work in
flight asks what to start. Start Work always sends its full activation, because its prompt carries the grant.

### CLI commands

| Command | What it does |
| --- | --- |
| `litcodex install` | Registers the LitCodex plugin and hook |
| `litcodex doctor` | Diagnoses the install, loop state, host capabilities and effective config |
| `litcodex uninstall` | Removes the plugin and the config LitCodex manages |
| `litcodex config migrate` | Previews or applies the managed Codex config keys |
| `litcodex office-runtime install` or `status` | Prepares or checks the pinned tools for Word and PowerPoint files |
| `litcodex motion-runtime install` or `status` | Prepares or checks the film renderer tools |
| `litcodex hud` | Shows the LIT card of the newest session live in a second terminal window |
| `litcodex screen-status on`, `off` or `status` | Colours the LIT card in the terminal `codex` |
| `litcodex statusline` | Prints the LIT status as one line, for a terminal status line command |
| `litcodex run` | Runs Codex with a live LIT panel in the bottom rows of the same terminal |
| `litcodex loop create` | Derives goals and criteria from a brief |
| `litcodex loop status --json` | Shows the loop state as JSON |
| `litcodex loop run` | Picks the next goal that can run |
| `litcodex loop record-evidence` | Records a pass, fail or blocked result for one criterion |
| `litcodex loop checkpoint` | Completes a goal, but only when every criterion passes |
| `litcodex loop doctor` | Diagnoses or recovers the loop state |

## Where your work is kept

A project's loop state lives under `.litcodex/lit-loop/`: `brief.md`, `goals.json`, `ledger.jsonl` and the
`evidence/` folder. Each write lands whole or not at all, and if the goals file is ever damaged, it is
kept as `.bak` so you can recover it. The state stays on your machine, out of Git and out of packages.
See [state and recovery](./docs/usage.md#loop-state).

## Check the install

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex doctor
```

`litcodex doctor` checks registration, hooks, config and host capabilities, and a clean run ends with
All checks passed. `litcodex loop doctor` checks the loop state of the current project. Both look at the
setup; to see signed-in model work and child agents actually run, give Codex a small real task.

Codex draws its own status line and terminal title, and a plugin cannot add to them. When every check
passes and your config has no status line or title, doctor suggests a `[tui]` block to paste: model
and reasoning, context used, the five-hour and weekly limits, task progress and the Git branch below
the prompt, and the activity spinner with the project name in the window title. You can also pick items inside Codex with `/statusline` and `/title`.
Doctor only prints the suggestion and never edits your config.

## Updates

With the `npm exec` form, run the install command again with the newer version number. A global install
can update itself after an interactive command, and an interactive `litcodex doctor` may mention a newer
version. Set `LITCODEX_NO_UPDATE_CHECK=1` to turn both off. Details are in
[privacy](./docs/privacy.md#registry-traffic-and-updates).

Inside Codex the check also runs when a session starts, about once a day. Codex runs it only after you approve
the LitCodex hooks in its hook review, and `codex exec` never shows that review. A new version takes effect in the
next Codex session. `litcodex doctor` shows the update state and what to do about it.

## Troubleshooting

- If the terminal window closes right away, open a terminal that stays open, run help, install and doctor
  one at a time, and note each exit code. Then follow the
  [staged trial](./docs/npm-migration.md#isolated-local-trial) and start Codex yourself.
- If `lit` does nothing, run `litcodex doctor` and check that the hooks are approved in Codex.
- If the `litcodex` command is missing, use the `npm exec` form above, or check that npm's global bin
  directory is on your `PATH`.
- If a native goal is paused or blocked, run `/goal resume`, confirm the goal is active, then retry with
  `litcodex loop run --retry-failed`. Keep the unfinished goal.
  [Recovery details](./docs/usage.md#troubleshooting).

## Uninstall

```sh
npm exec --yes --package @litfamily/litcodex@1.0.32 -- litcodex uninstall
```

`litcodex uninstall` removes the plugin and the config LitCodex manages, and leaves your other settings alone.

## Learn more

- [Install guide](./docs/install.md): every install variant, what a global install downloads, Windows,
  pictures of each installer screen, and what installing will and will not change.
- [Skills](./docs/skills.md): every bundled skill with a picture, and which ones are worth knowing by name.
- [Automatic handoff](./docs/auto-handoff.md): writes the handoff for you when the context reaches a
  percent you choose. Off by default.
- [Usage reference](./docs/usage.md): every route, model configuration, platform limits and recovery.
- [Privacy and network behavior](./docs/privacy.md) and the [migration guide](./docs/npm-migration.md).
- [Media and brand](./docs/media.md): the films, the logo and the story behind the name.
- For contributors: the [LitCodex contract](./docs/spec/litcodex-contract.md), the
  [reference analysis](./docs/reference-analysis.md), [release provenance](./docs/release/provenance.md),
  the [publish checklist](./docs/release/publish-checklist.md) and [CHANGELOG.md](./CHANGELOG.md). Tests, fixtures,
  test helpers and the Vitest configuration live only in this repository. Neither the npm package nor the
  installed marketplace plugin includes them.
- [The LitFamily hub](https://github.com/wjgoarxiv/litfamily): the same lit workflow for other coding agents.

If LitCodex saves you from explaining the same project twice, a star helps other Codex users find it.

[Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Code of conduct](./CODE_OF_CONDUCT.md) · [Support](./SUPPORT.md)

## License

[MIT](./LICENSE). The LitCodex and LitFamily names and art are covered by the [trademark policy](./TRADEMARK.md).
