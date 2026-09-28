<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily motion cover: five armored robots power on one by one, the LitCodex robot wakes with glowing eyes and a lit frame, then LITFAMILY and KEEP THE WORK LIT. light up." /></picture></p>

<p align="center"><img src="./docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B mark" /></p>

<details>
<summary>Copy ASCII logo</summary>

```
                             ▄▄▄▄
                   ▗███▌   ▗██████▖
 ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘
 ▐█████        ▗▟██████▌    ▝▀▜█▀▘
 ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 ▐█████    ▗▟█████████████████████████ ▐█▀
 ▐█████    ████████████████████████████▀
 ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖
 ▐█████    ▀    ▄██ ████▌█████████████▌
 ▐█████       ▄████ ████▌█████████████▌
 ▐█████     ▄█████▛
 ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖
 ▐█████ ▐█████▀          █████     ▐▛▀
 ▐█████ ▐███▀            █████
 ▐█████ ▐█▀              █████
 ▐█████ ▝                █████
 ▐█████▄▄▄▄▄▄▄▖          █████
 ▐███████████▛           █████
 ▐██████████▀            █████

LIT · codex
```

</details>

<p align="center"><img src="./docs/assets/litcodex-wordmark.svg" width="480" alt="LITCODEX display type" /></p>
<p align="center"><img src="./docs/assets/clay-icon.png" width="160" alt="LitCodex clay mark" /></p>

<p align="center">
<a href="#install"><img src="./docs/assets/readme/badge-version.svg" alt="1.0.9" /></a>
<a href="./LICENSE"><img src="./docs/assets/readme/badge-license.svg" alt="MIT license" /></a>
</p>

<p align="center">
<a href="./docs/usage.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> Docs</a> &nbsp; <a href="#install">Install</a> &nbsp; <a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

# LitCodex

**Keep the work lit.**

[한국어](./README-Ko-KR.md) · [Install](#install) · [First task](#start-with-lit) · [Skills](#skills-at-a-glance) · [A/B results](#ab-plain-codex-vs-lit) · [Commands](#commands) · [Troubleshooting](#troubleshooting) · [Docs](#docs-and-contributing)

## What is LitCodex

LitCodex is a plugin for Codex CLI. It adds planning, review, research and a durable execution loop,
so a piece of work can outlast the conversation it started in.

Add `lit` to a request. LitCodex turns it into a goal with checks that can pass or fail,
keeps the results in your project, and leaves the next session enough to pick up where this one stopped.

## Why LitCodex

**You have been handed a spark.<br>
Bring it to the work you want to finish.**

A bug to fix. A screen to build. A project to finish.

Starting takes a sentence. Picking up where you left off takes more: the decisions you made,
the checks you ran, and the next thing to try.

**LIT keeps that spark with your project.** Goals, plans, checked results and next steps stay in
local records that a later session can read. An enduring spark means work you can return to;
it is not a promise that an agent runs forever.

**Where one conversation ends, the next stretch of work can begin.**

<p align="center"><img src="docs/assets/litcodex-ignition-1600.webp" width="49%" alt="LitCodex ignition editorial cue" /> <img src="docs/assets/litcodex-continuity-1600.webp" width="49%" alt="LitCodex continuity editorial cue" /></p>

## Install

You need Node.js 22 or later and Codex CLI. Then run:

```sh
npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex install
```

The installer registers the plugin, hooks and agents, and updates the keys it manages in
`~/.codex/config.toml`. It asks three things: the lead model, the helper model and the output style.
Fresh installs default to `gpt-6-astra` at `xhigh` for the lead route and `gpt-6-luna` at `max` for
ordinary helpers; you can pick any other supported model and effort instead.

The npm package is self-contained, so you do not need to clone this repository, and installing needs
no GitHub credentials. Codex sign-in and model access are needed once real model work starts.

Two variants are worth knowing:

- To see what would change first, run `npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex --dry-run install`.
- For an unattended setup, run `npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex install --yes`. An explicit `--style <id>` still applies.

Coming from the old unscoped package? The [migration guide](./docs/npm-migration.md) covers the move.

### A global command

If you would rather have `litcodex` on your `PATH`:

```sh
npm install -g @litfamily/litcodex
litcodex install
```

`npm install -g` runs the package's postinstall script. On a global install, unless `CI` is set, it
prints a short welcome and then tries to pre-warm the motion runtime used by `lit-typographic-motion`.

That pre-warm goes to the network. `npm ci` fetches the pinned `opentype.js`, `playwright-core` and
`ws` from your npm registry, and the pinned font and license files come from GitHub and apache.org.
It downloads no browser and installs into `${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime/`.
If it does not finish, the package stays installed and the script tells you to retry later with
`litcodex motion-runtime install`.

To leave the script out, add `--ignore-scripts` (this also drops the welcome) or set `CI=1` for that
one command. `litcodex install` runs the same pre-warm after a successful install and has no switch
to turn it off.

> Without a global install, use `npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex <command>`, such as `npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex doctor`.

### Trying it apart from your setup

To try LitCodex without touching your existing settings, follow the
[isolated trial guide](./docs/npm-migration.md#isolated-local-trial). Changing only `CODEX_HOME` is
not enough: settings in your existing home can still be found.

### Windows

The installer and the CLI shims work on Windows. Python routes that depend on directory descriptors
need POSIX, so on Windows they stop with `BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME`. See
[platform and prompt policy](./docs/usage.md#install).

## Start with lit

Open Codex in your project and approve the LitCodex hooks when the startup review asks. Then type:

```text
lit add input validation to the signup form
```

A bare `lit` selects `<lit-loop-mode>`. The `UserPromptSubmit` hook shows a five-row activation mark
through its `systemMessage`, the same plain text whatever your terminal color settings, and the reply
opens with `🔥 **LIT IGNITED · <discipline>** 🔥`.

Words that merely contain `lit` stay inert: `split`, `literal` and `litmus` do nothing.
Code spans and fences are ignored too, and slash-command-style mentions are ignored except the explicit
`/litresearch` research route.

`handoff` and `lit-scientific-visualization` are exact-only routes: they fire only when the whole
message is that one word. Send exact bare `handoff` to write a continuation packet. The exact bare
`lit-scientific-visualization` hook route selects `<lit-scientific-visualization-mode>`; it does not
install Python dependencies.

### Make one small thing

Start in an empty project, with a task you can check yourself:

```text
lit build a single-file HTML task list in this folder. Do not install dependencies.
Check adding and completing a task, and record anything you could not verify.
```

When it finishes, look for three things: the result, the checks that actually ran, and what is still
unfinished. The status mark only tells you the request was routed. It does not prove the page works.

Ask for `lit recap` to read what was recorded. Before you leave the session, send exact bare
`handoff` as its own message. In the next session, ask Codex to read that packet and the project goals
before it continues.

A goal is complete only after every one of its success criteria passes. Each step leaves something
behind:

| Step | What stays with the work |
| --- | --- |
| Plan | A goal with checks that can pass or fail |
| Make | A small result you can inspect |
| Verify | Evidence for each completed criterion; blockers stay open |
| Hand off | Decisions, remaining work, and where to resume |

Codex's native goals and the local loop records are kept apart. If a native goal is paused or blocked,
use the recovery step under [Troubleshooting](#troubleshooting); a handoff does not resume it for you.

### The routes you will use most

| Type this | What happens |
| --- | --- |
| `lit` | Starts a bounded task, with goals and checks kept in the project. |
| `handoff` or `/lit-handoff` | Carries the checked result and the next step into another session. |
| `lit-plan` | Writes a plan and success criteria before anything is edited. |
| `lit start work <approved-plan>` | Runs a plan you have approved. |
| `review-work` | Reviews the change and its evidence. |
| `litresearch` | Researches with sources and keeps track of what is still uncertain. |

The full list is under [Commands](#commands).

## Skills at a glance

Every bundled skill is here. Each row shows how to start it and what you get back; the last row groups
the checks that run on their own.

<table>
<tr><th>What it looks like</th><th>Skill</th><th>What you get</th></tr>
<tr>
<td><img src="./docs/assets/skills/lit-loop.webp" width="240" alt="Add lit to a request. Codex binds the scope, works with evidence and records what it could not verify." /></td>
<td><code>lit-loop</code><br /><sub><code>lit</code> · <code>$litcodex:lit-loop</code></sub></td>
<td>Add <code>lit</code> to a request. Codex binds the scope, works with evidence and records what it could not verify.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litwork.webp" width="240" alt="Careful end-to-end build or fix: RED first, then proof on the real surface." /></td>
<td><code>litwork</code><br /><sub><code>litwork</code> · <code>$litcodex:litwork</code></sub></td>
<td>Careful end-to-end build or fix: RED first, then proof on the real surface.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-plan.webp" width="240" alt="An approved plan in .litcodex/plans/ with numbered rows. Planning only." /></td>
<td><code>lit-plan</code><br /><sub><code>lit plan</code> · <code>$litcodex:lit-plan</code></sub></td>
<td>An approved plan in <code>.litcodex/plans/</code> with numbered rows. Planning only.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/start-approved-plan.webp" width="240" alt="Runs an approved plan through five gates. All five review lanes must pass at the end." /></td>
<td>Start Work<br /><sub><code>lit start work &lt;approved-plan&gt;</code></sub></td>
<td>Runs an approved plan through five gates. All five review lanes must pass at the end.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/review-work.webp" width="240" alt="Five blocking review lanes. One failing lane blocks approval." /></td>
<td><code>review-work</code><br /><sub><code>lit review</code> · <code>$litcodex:review-work</code></sub></td>
<td>Five blocking review lanes. One failing lane blocks approval.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litgoal.webp" width="240" alt="Binds one goal with observable criteria to the durable lit-loop." /></td>
<td><code>litgoal</code><br /><sub><code>lit goal</code> · <code>$litcodex:litgoal</code></sub></td>
<td>Binds one goal with observable criteria to the durable lit-loop.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-recap.webp" width="240" alt="A read-only summary: done, in progress, blocked, where the evidence is, what comes next." /></td>
<td><code>lit-recap</code><br /><sub><code>lit recap</code> · <code>$litcodex:lit-recap</code></sub></td>
<td>A read-only summary: done, in progress, blocked, where the evidence is, what comes next.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-handoff.webp" width="240" alt="Type handoff to get a continuation file the next session can read and resume from." /></td>
<td><code>lit-handoff</code><br /><sub><code>handoff</code> · <code>/lit-handoff</code></sub></td>
<td>Type <code>handoff</code> to get a continuation file the next session can read and resume from.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/deep-interview.webp" width="240" alt="One question at a time until the idea is clear enough to build. Quick, Standard and Deep set the target." /></td>
<td><code>deep-interview</code><br /><sub><code>deep-interview</code> · <code>$litcodex:deep-interview</code></sub></td>
<td>One question at a time until the idea is clear enough to build. Quick, Standard and Deep set the target.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litresearch.webp" width="240" alt="Parallel evidence gathering and a cited synthesis, only when you ask for research." /></td>
<td><code>litresearch</code><br /><sub><code>lit research</code> · <code>$litcodex:litresearch</code></sub></td>
<td>Parallel evidence gathering and a cited synthesis, only when you ask for research.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-crucible.webp" width="240" alt="Pressure-tests a brief before planning. Only the risks that survive critique reach the plan." /></td>
<td><code>lit-crucible</code><br /><sub><code>lit-crucible</code> · <code>$litcodex:lit-crucible</code></sub></td>
<td>Pressure-tests a brief before planning. Only the risks that survive critique reach the plan.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-init.webp" width="240" alt="Sparse AGENTS.md guidance backed by what is in the repository." /></td>
<td><code>lit-init</code><br /><sub><code>lit-init</code> · <code>$litcodex:lit-init</code></sub></td>
<td>Sparse AGENTS.md guidance backed by what is in the repository.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-comprehend.webp" width="240" alt="An explainer page for agent-written work: intuition first, then the walkthrough, then a short quiz." /></td>
<td><code>lit-comprehend</code><br /><sub><code>lit-comprehend</code> · <code>$litcodex:lit-comprehend</code></sub></td>
<td>An explainer page for agent-written work: intuition first, then the walkthrough, then a short quiz.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-humanizer.webp" width="240" alt="Rewrites stiff model prose in English or Korean. Facts and hedges stay; filler goes." /></td>
<td><code>lit-humanizer</code><br /><sub><code>$litcodex:lit-humanizer</code></sub></td>
<td>Rewrites stiff model prose in English or Korean. Facts and hedges stay; filler goes.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-diagram-drawer.webp" width="240" alt="A checked, editable diagram for slides and documents, with PNG and Office-safe SVG exports." /></td>
<td><code>lit-diagram-drawer</code><br /><sub><code>$litcodex:lit-diagram-drawer</code></sub></td>
<td>A checked, editable diagram for slides and documents, with PNG and Office-safe SVG exports.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-pptx.webp" width="240" alt="Ask for slides with lit and get an editable PowerPoint deck with its Markdown source, AZURE-PRO and Pretendard by default. Layout QA runs on the file; rendered slides are inspected when LibreOffice is present." /></td>
<td><code>lit-pptx</code><br /><sub><code>$litcodex:lit-pptx</code></sub></td>
<td>Ask for slides with <code>lit</code> and get an editable PowerPoint deck with its Markdown source, AZURE-PRO and Pretendard by default. Layout QA runs on the file; rendered slides are inspected when LibreOffice is present.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-docx.webp" width="240" alt="Ask for a report with lit and get a styled Word file with its Markdown source; Korean text uses korean-generic. The file is reopened and linted, and pages are inspected when LibreOffice is present." /></td>
<td><code>lit-docx</code><br /><sub><code>$litcodex:lit-docx</code></sub></td>
<td>Ask for a report with <code>lit</code> and get a styled Word file with its Markdown source; Korean text uses korean-generic. The file is reopened and linted, and pages are inspected when LibreOffice is present.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-fetch.webp" width="240" alt="Reads a public page with URL, DNS and text-safety checks when ordinary retrieval falls short." /></td>
<td><code>lit-fetch</code><br /><sub><code>$litcodex:lit-fetch</code></sub></td>
<td>Reads a public page with URL, DNS and text-safety checks when ordinary retrieval falls short.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-scientific-visualization.webp" width="240" alt="A journal-sized figure with vector and 600 DPI exports. The chart type follows the data." /></td>
<td><code>lit-scientific-visualization</code><br /><sub><code>lit-scientific-visualization</code> · <code>$litcodex:lit-scientific-visualization</code></sub></td>
<td>A journal-sized figure with vector and 600 DPI exports. The chart type follows the data.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-team.webp" width="240" alt="Coordinates several workers with separate slices, each reporting back with evidence." /></td>
<td><code>lit-team</code><br /><sub><code>lit team</code> · <code>$litcodex:lit-team</code></sub></td>
<td>Coordinates several workers with separate slices, each reporting back with evidence.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litcodex-doctor.webp" width="240" alt="Checks LitCodex and Codex install health after an update, drift or a failed setup." /></td>
<td><code>litcodex-doctor</code><br /><sub><code>$litcodex:litcodex-doctor</code></sub></td>
<td>Checks LitCodex and Codex install health after an update, drift or a failed setup.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litcodex-report-bug.webp" width="240" alt="Drafts a bug report for LitCodex or Codex, backed by sources." /></td>
<td><code>litcodex-report-bug</code><br /><sub><code>$litcodex:litcodex-report-bug</code></sub></td>
<td>Drafts a bug report for LitCodex or Codex, backed by sources.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litcodex-contribute-bug-fix.webp" width="240" alt="Turns a diagnosed defect into a tested bug-fix PR." /></td>
<td><code>litcodex-contribute-bug-fix</code><br /><sub><code>$litcodex:litcodex-contribute-bug-fix</code></sub></td>
<td>Turns a diagnosed defect into a tested bug-fix PR.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/coding-session-audit.webp" width="240" alt="Reads a past Codex session from its evidence and shows where it stopped." /></td>
<td><code>coding-session-audit</code><br /><sub><code>$litcodex:coding-session-audit</code></sub></td>
<td>Reads a past Codex session from its evidence and shows where it stopped.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/debugging.webp" width="240" alt="Reproduces the bug, tests at least three explanations, and fixes only the confirmed cause." /></td>
<td><code>debugging</code><br /><sub><code>$litcodex:debugging</code></sub></td>
<td>Reproduces the bug, tests at least three explanations, and fixes only the confirmed cause.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/refactor.webp" width="240" alt="Restructures code while tests pin its behavior before and after every step." /></td>
<td><code>refactor</code><br /><sub><code>$litcodex:refactor</code></sub></td>
<td>Restructures code while tests pin its behavior before and after every step.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-code.webp" width="240" alt="Strict implementation rules: tests first, typed boundaries, small files." /></td>
<td><code>lit-code</code><br /><sub><code>$litcodex:lit-code</code></sub></td>
<td>Strict implementation rules: tests first, typed boundaries, small files.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-commit.webp" width="240" alt="Splits your changes into atomic commits in the repo's own style and leaves unrelated work alone." /></td>
<td><code>lit-commit</code><br /><sub><code>$litcodex:lit-commit</code></sub></td>
<td>Splits your changes into atomic commits in the repo's own style and leaves unrelated work alone.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lsp-setup.webp" width="240" alt="Checks language-server setup and runs a real diagnostics check on demand." /></td>
<td><code>lsp-setup</code><br /><sub><code>$litcodex:lsp-setup</code></sub></td>
<td>Checks language-server setup and runs a real diagnostics check on demand.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/readme-studio.webp" width="240" alt="A factual README with a moving cover, checked at phone and desktop widths in light and dark." /></td>
<td><code>readme-studio</code><br /><sub><code>$litcodex:readme-studio</code></sub></td>
<td>A factual README with a moving cover, checked at phone and desktop widths in light and dark.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-typographic-motion.webp" width="240" alt="Ask for a video with lit. A treatment comes first, then an authored stage page or the type engine, a sound bed, and look rounds on the rendered stills." /></td>
<td><code>lit-typographic-motion</code><br /><sub><code>$litcodex:lit-typographic-motion</code></sub></td>
<td>Ask for a video with <code>lit</code>. A treatment comes first, then an authored stage page or the type engine, a sound bed, and look rounds on the rendered stills.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/structural-search.webp" width="240" alt="Finds code by its syntax shape, not its text, and previews rewrites before applying them." /></td>
<td><code>structural-search</code><br /><sub><code>$litcodex:structural-search</code></sub></td>
<td>Finds code by its syntax shape, not its text, and previews rewrites before applying them.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/visual-qa.webp" width="240" alt="Checks a real screen at each viewport and returns an honest verdict, or names exactly what blocked it." /></td>
<td><code>visual-qa</code><br /><sub><code>$litcodex:visual-qa</code></sub></td>
<td>Checks a real screen at each viewport and returns an honest verdict, or names exactly what blocked it.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/browser-drive.webp" width="240" alt="Drives a real page after verifying the browser driver. If there is none, it says so." /></td>
<td><code>browser-drive</code><br /><sub><code>browser-drive</code> · <code>$litcodex:browser-drive</code></sub></td>
<td>Drives a real page after verifying the browser driver. If there is none, it says so.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/frontend-ui-ux.webp" width="240" alt="Builds a working interface, then a measured probe renders it in seven views: four widths, dark, reduced motion and 200% zoom." /></td>
<td><code>frontend-ui-ux</code><br /><sub><code>$litcodex:frontend-ui-ux</code></sub></td>
<td>Builds a working interface, then a measured probe renders it in seven views: four widths, dark, reduced motion and 200% zoom.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-burnoff.webp" width="240" alt="Cleans AI-written bloat out of a change set after tests lock what it does." /></td>
<td><code>lit-burnoff</code><br /><sub><code>$litcodex:lit-burnoff</code></sub></td>
<td>Cleans AI-written bloat out of a change set after tests lock what it does.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-burnoff-file.webp" width="240" alt="The same cleanup for one file: fewer narrating comments, less defensive noise, flatter code." /></td>
<td><code>lit-burnoff-file</code><br /><sub><code>$litcodex:lit-burnoff-file</code></sub></td>
<td>The same cleanup for one file: fewer narrating comments, less defensive noise, flatter code.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/wikify.webp" width="240" alt="Keeps reviewed project knowledge on disk and answers later questions from it, with sources." /></td>
<td><code>wikify</code><br /><sub><code>$litcodex:wikify</code></sub></td>
<td>Keeps reviewed project knowledge on disk and answers later questions from it, with sources.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/autoresearch.webp" width="240" alt="An approved, budgeted experiment loop. Each round changes one thing and keeps or reverts it." /></td>
<td><code>autoresearch</code><br /><sub><code>$litcodex:autoresearch</code></sub></td>
<td>An approved, budgeted experiment loop. Each round changes one thing and keeps or reverts it.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/autoconference.webp" width="240" alt="A budgeted research conference: separate researchers, reviewers, and a synthesis that keeps disagreement." /></td>
<td><code>autoconference</code><br /><sub><code>$litcodex:autoconference</code></sub></td>
<td>A budgeted research conference: separate researchers, reviewers, and a synthesis that keeps disagreement.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/automatic-checks.webp" width="240" alt="Runs on its own: project rules on each prompt, LSP and comment checks after edits." /></td>
<td><code>rules</code> · <code>lsp</code> · <code>comment-checker</code><br /><sub>runs on its own</sub></td>
<td>Runs on its own: project rules on each prompt, LSP and comment checks after edits.</td>
</tr>
</table>

## A/B: plain Codex vs lit

Each prompt below is one casual line in Korean. The baseline got the line as typed. The lit arm got the
same line with ` lit` added, and nothing else.

Both arms ran Codex CLI 0.157.1 with `gpt-6-sol` at high effort on 2026-09-26, one trial per arm, each
in its own disposable home. The lit arm used a local pre-release build of LitCodex, not a published
version. Where LitCodex was fixed and run again, the table compares the latest lit run with the same
baseline.

A blind judge (Claude Opus 5.5) compared each pair in both orders. The maintainer then looked at both
outputs side by side and made the final call. The judge's verdict stays next to it for reference.

S3 and S4 were run again in a later interface round, together with S11. S5 was run again in an office
round, together with S8 and S9; there the lit arm used `lit-pptx` and `lit-docx`.

| Task | Prompt | Final verdict | Blind judge (same round) |
| --- | --- | --- | --- |
| S1 terminal to-do CLI | `터미널에서 쓰는 할 일 관리 CLI 만들어줘` | **Baseline won** | Baseline won |
| S2 API server bugs | `이 API 서버 가끔 이상하게 동작하는데 고쳐줘` | **Tie** | Baseline won |
| S3 budget dashboard | `개인 가계부 대시보드 웹페이지 만들어줘` | **LitCodex won** | Baseline won |
| S4 café landing page | `동네 카페 브랜드 랜딩페이지 만들어줘` | **LitCodex won** | Tie |
| S5 report and slides from sources | `sources 폴더 자료로 보고서랑 발표자료 만들어줘` | **LitCodex won** | Tie |
| S6 Node 22 to 24 research | `Node 22에서 24로 올릴 때 달라지는 거 조사해줘` | **LitCodex won** | LitCodex won |
| S7 order, payment and shipping diagram | `주문-결제-배송 서비스 구조도 그려줘` | **LitCodex won** (blind judge; not reviewed by eye) | LitCodex won |
| S8 quarterly results deck | `분기 실적 발표자료 만들어줘` | **LitCodex won** | Baseline won |
| S9 new product plan | `신제품 기획서 써줘` | **LitCodex won** | LitCodex won |
| S11 meeting-room booking app | `회의실 예약 웹앱 만들어줘` | **LitCodex won** | Baseline won |
| Total | | **8 won, 1 tie, 1 lost** | 3 won, 2 ties, 5 lost |

The motion skill, `lit-typographic-motion`, was rebuilt after its first A/B and has no A/B result yet. The cover at the top was made with the LitFamily motion skill.

Neither round had a working screen check. In the interface round the Codex sandbox blocked the browser,
so the lit arm's interface probe could not measure its pages, and neither arm checked its rendered
screen. In the office round the renderer failed inside the sandbox, so the lit arm never saw previews
of its slides and pages, and each reply said so. Looking at the office round as a whole, the maintainer
found the LitCodex files much better suited to real work.

### What each side produced

- **S1, lost.** The baseline CLI can add, list, edit, complete, reopen and delete items, with checked due dates. The LitCodex CLI had fewer commands (no editing, no due dates), claimed Python 3.10 support while importing a 3.11-only API, and its own tests did not pass in the checker. The blind judge also preferred the baseline over the two earlier LitCodex runs, and the maintainer called it a clear loss.
- **S2, tie.** Both sides fixed all six seeded bugs, with no failing visible tests. The judge leaned to the baseline because its reply mentioned that creating an item now returns 201 instead of 200, which the LitCodex reply left out. The maintainer called it a tie.
- **S3, won.** The LitCodex dashboard shows monthly income, spending and the budget, and lets you add, delete and search transactions and change the budget. The judge preferred the baseline's richer analysis: an income and expense line chart, a category donut and budgets per category. The maintainer preferred the LitCodex page.
- **S4, won.** The judge called it a tie: the baseline's shop-front photos and menu felt more finished, while the LitCodex page showed mock-up labels to visitors because the prompt gave no address or hours. The checker found no clipped text on the LitCodex page (9 items on the baseline) but more accessibility findings (38 against 29).
- **S5, won.** LitCodex made a Word report and a 7-slide deck, each with an editable Markdown source. The judge called it a tie: the baseline report was better built (a data-period box, an interpretation column and numbered citations), while the LitCodex slides looked more polished. The checker counted 12 of 12 facts right for the baseline and 11 of 12 for LitCodex, none wrong on either side, and 5 invented-number flags against 14.
- **S6, won.** LitCodex correctly lists `dirent.path` as removed, where the baseline called it only deprecated, and notes that `require(esm)` and type stripping already exist in Node 22. The checker found 3 of 10 expected facts against 2; 75% of LitCodex's links were official sources, against 100% for the baseline.
- **S7, won (blind judge; not reviewed by eye).** LitCodex saved a rendered PNG and an editable HTML diagram with labelled arrows and a payment-failure path. The baseline gave Mermaid code in its reply and no rendered file, although its architecture covered more services.
- **S8, won.** The prompt gave no figures. The baseline made a 10-slide fill-in template with blanks for every number, and the checker flagged 18 overflowing text boxes. LitCodex made an 8-slide deck for a fictional company with sample figures labelled as examples and 3 tables; the checker flagged one overflowing box and one overlap. The judge preferred the baseline's template.
- **S9, won.** The baseline answered in chat with a short plan and made no document. LitCodex wrote a 6-page Word plan with its Markdown source: decision gates, scope, schedule, risks and unit economics, with every figure marked as an assumption. The judge agreed, noting leftover checklist files, wrong numbering in one list and too many caveats.
- **S11, won.** The judge preferred the baseline: a weekly date strip and a room-by-time timeline with click-to-book, where the LitCodex app shows a large header and a room list with no view of existing bookings. LitCodex finds rooms by date, size and equipment, blocks overlapping bookings, includes unit tests and had 2 accessibility findings against 124.

### Pictures

**S3, budget dashboard (baseline left, LitCodex right).**

<p><img src="./docs/ab-simple/assets/s3-baseline-desktop.webp" width="49%" alt="Baseline budget dashboard at desktop width" /> <img src="./docs/ab-simple/assets/s3-lit-desktop.webp" width="49%" alt="LitCodex budget dashboard at desktop width" /></p>

<details><summary>S3 on a phone</summary>

<p><img src="./docs/ab-simple/assets/s3-baseline-phone.webp" width="240" alt="Baseline budget dashboard on a phone" /> <img src="./docs/ab-simple/assets/s3-lit-phone.webp" width="240" alt="LitCodex budget dashboard on a phone" /></p>

</details>

**S4, café landing page (baseline left, LitCodex right).**

<p><img src="./docs/ab-simple/assets/s4-baseline-desktop.webp" width="49%" alt="Baseline café landing page at desktop width" /> <img src="./docs/ab-simple/assets/s4-lit-desktop.webp" width="49%" alt="LitCodex café landing page at desktop width" /></p>

<details><summary>S4 on a phone</summary>

<p><img src="./docs/ab-simple/assets/s4-baseline-phone.webp" width="240" alt="Baseline café landing page on a phone" /> <img src="./docs/ab-simple/assets/s4-lit-phone.webp" width="240" alt="LitCodex café landing page on a phone" /></p>

</details>

**S5, first five slides (baseline above, LitCodex below).**

<p><img src="./docs/ab-simple/assets/s5-baseline-slides.webp" width="100%" alt="Baseline slides for the report-and-slides task" /></p>
<p><img src="./docs/ab-simple/assets/s5-lit-slides.webp" width="100%" alt="LitCodex slides for the report-and-slides task" /></p>

**S7, the LitCodex diagram.** The baseline returned Mermaid code without a rendered file.

<p><img src="./docs/ab-simple/assets/s7-lit-diagram.webp" width="720" alt="LitCodex order, payment and shipping service diagram" /></p>

**S8, first five slides (baseline above, LitCodex below).**

<p><img src="./docs/ab-simple/assets/s8-baseline-slides.webp" width="100%" alt="Baseline quarterly results template slides" /></p>
<p><img src="./docs/ab-simple/assets/s8-lit-slides.webp" width="100%" alt="LitCodex quarterly results slides with sample figures" /></p>

**S9, first three pages of the LitCodex plan.** The baseline answered in chat and made no file.

<p><img src="./docs/ab-simple/assets/s9-lit-pages.webp" width="100%" alt="LitCodex new product plan, first three pages" /></p>

**S11, meeting-room booking app (baseline left, LitCodex right).**

<p><img src="./docs/ab-simple/assets/s11-baseline-desktop.webp" width="49%" alt="Baseline meeting-room booking app at desktop width" /> <img src="./docs/ab-simple/assets/s11-lit-desktop.webp" width="49%" alt="LitCodex meeting-room booking app at desktop width" /></p>

<details><summary>S11 on a phone</summary>

<p><img src="./docs/ab-simple/assets/s11-baseline-phone.webp" width="240" alt="Baseline meeting-room booking app on a phone" /> <img src="./docs/ab-simple/assets/s11-lit-phone.webp" width="240" alt="LitCodex meeting-room booking app on a phone" /></p>

</details>

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

The dotted line to native goals is a protocol the agent follows: the package never calls the native
goal tools itself. When those tools are unavailable, the agent keeps the local records and reports that
native goal sync was unavailable. A paused or blocked goal still needs the documented recovery step;
reading a handoff does not resume it.

Codex CLI runs the hooks and the agents. Authentication, model access, permissions and any visual check
stay with Codex and your machine, so a route mark or an image in this README is not proof that the work
is done. The [runtime and state reference](./docs/usage.md) goes deeper.

## Commands

### In the Codex composer

| Type this | Mode | What it does |
| --- | --- | --- |
| `lit` or `lit-loop` | **lit-loop** | Runs the work in a durable loop and checkpoints the evidence |
| `litwork` | **litwork** | Outcome-first work, backed by manual QA evidence |
| `lit-plan` or `lit plan` | **lit-plan** | Planning only: a bounded plan with evidence and a final done claim |
| `deep-interview` or `lit deep interview` | **deep-interview** | Planning only: asks questions until a vague brief is clear |
| `litgoal` or `lit goal` | **litgoal** | Binds an objective and its criteria into the loop state |
| `lit-recap` or `lit recap` | **lit-recap** | A read-only recap from the `.litcodex` ledgers |
| `lit-comprehend` or `comprehend` | **lit-comprehend** | Builds a self-contained explainer outside the worktree |
| `review-work` or `lit review` | **review-work** | A read-only review of a plan or of finished work |
| `litresearch`, `/litresearch`, or `lit research` | **litresearch** | A research journal that keeps facts, hypotheses, sources and uncertainty apart |
| `lit start work <plan-name>` | **Start Work** | Runs an approved plan and keeps its evidence |
| exact bare `handoff` | **lit-handoff** | Creates or refreshes a continuation packet that leaves secrets out |
| exact bare `lit-scientific-visualization` | **lit-scientific-visualization** | Loads the publication plotting adapter through the hook |

Typing the same mode again in one session has no extra effect. You can also pick any standalone skill by
its exact ID in the Codex skill picker, or mention it by scoped name, such as `$litcodex:lit-handoff`,
`$litcodex:lit-scientific-visualization`, `$litcodex:lit-humanizer` or `$litcodex:lit-fetch`.

A few skills are worth knowing by name:

- **Diagrams.** For architecture, workflow, system and conceptual diagrams, pick `lit-diagram-drawer`
  from the Codex skill picker. A diagram request with `lit` also tells Codex to load it. Product screens
  and plots of measured data have their own skills.
- **Word and PowerPoint.** Pick `lit-docx` for a Word report or proposal and `lit-pptx` for slides.
  A bounded `lit` request for either loads the matching skill, and a request for both loads both. Each
  keeps editable Markdown next to the DOCX or PPTX. `litcodex install` prepares their pinned dependencies
  outside the Codex session, and `litcodex office-runtime status` or `litcodex doctor` shows whether they
  are ready. If the install had no network, run `litcodex office-runtime install` later, outside the
  sandbox. The Office runner's doctor command reports the optional LibreOffice, pandoc and XeLaTeX support.
- **Prose.** Pick `lit-humanizer` to edit English or Korean prose. Its pre-write hook blocks a small set
  of high-confidence drafting patterns and only flags the softer ones. Office or PDF files it generates
  are checked after creation when the host can extract their text.

### CLI commands

| Command | What it does |
| --- | --- |
| `litcodex install` | Registers the LitCodex plugin and hook |
| `litcodex doctor` | Diagnoses the install, loop state, host capabilities and effective config |
| `litcodex uninstall` | Removes the plugin and the config LitCodex manages |
| `litcodex config migrate` | Previews or applies the managed Codex config keys |
| `litcodex hook user-prompt-submit` | The entry point the host calls for the hook |
| `litcodex loop create` | Derives goals and criteria from a brief |
| `litcodex loop status --json` | Shows the loop state as JSON |
| `litcodex loop run` | Picks the next goal that can run |
| `litcodex loop record-evidence` | Records a pass, fail or blocked result for one criterion |
| `litcodex loop checkpoint` | Completes a goal, but only when every criterion passes |
| `litcodex loop doctor` | Diagnoses or recovers the loop state |

The Codex skill picker lists the whole library. Skills that were renamed still answer to their previous
leading name for one release; see [rename compatibility](./docs/usage.md#skill-rename-compatibility) and
[CHANGELOG.md](./CHANGELOG.md).

## Where your work is kept

A project's loop state lives under `.litcodex/lit-loop/`: `brief.md`, `goals.json`, `ledger.jsonl` and the
`evidence/` folder. Writes are atomic, and a damaged goals file is kept as `.bak`
instead of being thrown away. This state is local and excluded from Git and from packages. See
[state and recovery](./docs/usage.md#loop-state).

## Check the install

```sh
npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex doctor
```

`litcodex doctor` checks registration, hooks, config and host capabilities. `litcodex loop doctor`
checks the loop state of the current project. A clean install check does not prove that authenticated
model work or child agents will run.

## Safety

- Plans and evidence stay open to review. Running a test command does not, on its own, count as meeting
  a criterion.
- Installing keeps your unrelated Codex settings. Look at the planned changes before you use `--reconfigure`.
- The doctor diagnostic core never modifies Codex config, install state or plugin state. An eligible
  interactive doctor run may show a cached advisory notice. Its detached worker performs a fixed registry
  refresh at `~/.litcodex/update-check.json` and never installs packages.
  A separate foreground updater can install a newer global package after eligible interactive management
  commands. Set `LITCODEX_NO_UPDATE_CHECK=1` to turn off both update paths. Failed, `--json`, `--dry-run`,
  non-TTY, CI and opt-out doctor runs stay side-effect-free. See [privacy](./docs/privacy.md).
- A model route is a configuration choice. It does not guarantee access to that model or that it runs.
  See [managed model compatibility](./docs/usage.md#safety).

## Jev skill hint (optional)

LitCodex can ask Jev, a hosted model from TypeSafe (typesafe.ai), which bundled LitCodex skill fits a plain
prompt. When Jev picks one with enough confidence, the `UserPromptSubmit` hook adds one advisory line naming
that skill to the turn's context. Codex still decides whether to load it. The hint never grants a permission
or runs a tool.

It is off by default. To turn it on, set both variables in the environment Codex runs in, then restart Codex:

```sh
export LITCODEX_JEV=1
export TYPESAFE_API_KEY=<your own TypeSafe key>
```

- **Turning it on sends each eligible prompt to TypeSafe (typesafe.ai).** The text is cut to 2,000
  characters, and home paths, email addresses and token-shaped strings are redacted first. Nothing else from
  the session goes with it: no files, tool output or history. Slash commands, `$skill` mentions and prompts
  that already start a lit route are not sent.
- Anything in the prompt without a token shape is sent as written: hostnames, customer names, or passwords
  that are not written as `password=…`, for example.
- Because `TYPESAFE_API_KEY` is exported in the shell that starts Codex, Codex's own tools can read it too.
  Use a key only for this feature, with low spend limits.
- TypeSafe bills your key, at about $0.04 per million input tokens. Each request carries the prompt and the
  skill list. A session makes at most 200 requests (`LITCODEX_JEV_MAX_CALLS`).
- The hint itself goes only to the model. To see it, also set `LITCODEX_JEV_SHOW=1`: a turn that got a hint
  then shows one line in the Codex transcript, such as `Jev → lit-humanizer (0.37s)`.
- While it is on, the first prompt of each session that does not start a lit route shows `✦ Jev skill hint ON`
  once, so you can tell it is enabled.
- Each request waits at most 1.5 seconds. After a timeout or any other failure the turn carries on without a
  hint, and one short note appears once per session.
- `litcodex doctor` shows `Jev skill hint: off`, `on`, or `flag on but TYPESAFE_API_KEY missing`.
- To turn it off, unset `LITCODEX_JEV` (any value other than `1` also turns it off) and restart Codex.
  See [privacy](./docs/privacy.md#optional-jev-skill-hint).

## Troubleshooting

- **The pane closes before any output.** You cannot tell yet which stage failed. In a terminal that is
  already open, run help, install and doctor one at a time and keep each exit status. Then follow the
  [staged trial](./docs/npm-migration.md#isolated-local-trial) and start the host yourself.
- **Nothing activates.** Run `litcodex doctor` and check that the hooks are approved in Codex.
- **The command is missing.** Use the `npm exec` form above, or check that npm's global bin directory is on
  your `PATH`.
- **A native goal is paused or blocked.** Run `/goal resume`, confirm the goal is active, then retry with
  `litcodex loop run --retry-failed`. Keep the unfinished goal. [Recovery details](./docs/usage.md#troubleshooting).

## Uninstall

```sh
npm exec --yes --package @litfamily/litcodex@1.0.9 -- litcodex uninstall
```

`litcodex uninstall` removes the plugin and the config LitCodex manages, and leaves your other settings alone.

## License

[MIT](./LICENSE)

## Docs and contributing

- [Usage reference](./docs/usage.md): every route, model configuration, platform limits and recovery.
- [LitCodex contract](./docs/spec/litcodex-contract.md): hooks, native goal boundaries and evidence requirements.
- [Reference analysis](./docs/reference-analysis.md): design and compatibility decisions.
- [Release provenance](./docs/release/provenance.md), the [publish checklist](./docs/release/publish-checklist.md)
  and [CHANGELOG.md](./CHANGELOG.md) for release history.

Tests, fixtures, test helpers and the Vitest configuration live only in this repository. Neither the npm
package nor the installed marketplace plugin includes them.

[Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Code of conduct](./CODE_OF_CONDUCT.md) · [Support](./SUPPORT.md) · [Privacy](./docs/privacy.md)

### LITFAMILY

![LITFAMILY editorial illustration with five armored machines against a dark background](./docs/assets/litfamily-machines.png)

Five armored machines, one for each product in the LIT family.

### Ignition motion

Select the poster to watch the 10-second film.

<p align="center"><a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/ignition-poster.png" width="720" alt="Ignition motion graphic poster" /></a></p>

[Animated GIF](./docs/assets/readme/ignition-readme.gif) · [Media and icon credits](./docs/assets/readme/README.md)
