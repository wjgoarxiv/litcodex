# Installing LitCodex

[README](../README.md) · [한국어](./install-Ko-KR.md)

This page has the whole install story: the variants, what a global install downloads, how to try LitCodex apart from your setup, what the installer prints, and what it will and will not touch. The [README](../README.md#install) has the short version.

## Install

You need Node.js 22 or later and Codex CLI. Then run:

```sh
npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex install
```

The installer sets LitCodex up inside Codex. It registers the plugin, its hooks and its agents, and
it changes only the keys it manages in `~/.codex/config.toml`. Along the way it asks three questions:
which model leads, which model helps, and which output style you like. On a fresh install the lead is
`gpt-6-astra` at `xhigh` and ordinary helpers use `gpt-6-luna` at `max`. Pick another supported model
and effort if you prefer.

Everything comes in the npm package, so there is nothing to clone and no GitHub sign-in. You need your
Codex sign-in and model access once real model work starts.

Two variants are worth knowing:

- If you want to see what would change before anything does, run `npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex --dry-run install`.
- If you are setting up a machine without anyone at the keyboard, run `npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex install --yes`. A `--style <id>` you pass is still used.

Want to see what the installer prints before you run it? [What you will see on screen](#what-you-will-see-on-screen) shows the questions, the receipt and the doctor check.

Coming from the old unscoped package? The [migration guide](./npm-migration.md) covers the move.

### A global command

If you would rather have `litcodex` on your `PATH`:

```sh
npm install -g @litfamily/litcodex
litcodex install
```

A global install does a little more than copy files. Right after the download, unless `CI` is set, a
short setup script prints a welcome and then gets the video skill, `lit-typographic-motion`, ready ahead of time, so the
tools it renders with are already in place the first time you ask for a video.

Getting ready means a few downloads. The script runs `npm ci` to fetch pinned copies of `opentype.js`,
`playwright-core` and `ws` from your npm registry, and it fetches pinned font and license files from
GitHub and apache.org. It downloads no browser. Everything goes into
`${XDG_CACHE_HOME:-~/.cache}/litcodex/motion-runtime/`. If the step does not finish, LitCodex is still
installed, and the script prints the command to try again later: `litcodex motion-runtime install`.

You can keep the script out of the global install in either of two ways:

- Add `--ignore-scripts` to `npm install -g`. The whole script is left out, welcome included.
- Set `CI=1` for that one command. The script sees it and stops before doing anything, just as it does
  on a build server where `CI` is already set.

Leaving it out here only postpones the downloads. `litcodex install` gets the video tools ready the same
way after a successful install, and there is no switch to turn that off.

> Without a global install, use `npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex <command>`, such as `npm exec --yes --package @litfamily/litcodex@1.0.25 -- litcodex doctor`.

### Trying it apart from your setup

To try LitCodex without touching your existing settings, follow the
[isolated trial guide](./npm-migration.md#isolated-local-trial). It gives the trial a whole home of its
own, because with only `CODEX_HOME` changed, settings in your existing home can still be found.

### Windows

The installer and the CLI shims work on Windows. Python routes that rely on POSIX directory
descriptors cannot run there, so on Windows they stop with `BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME`. See [platform and prompt policy](./usage.md#install).

## What you will see on screen

Five pictures show what LitCodex prints, from the first install to your first task. Each one was captured from the
real program in a temporary home, and each caption says which lines were cut to keep the picture short. They come
from Codex CLI 0.162; other Codex versions may word or place hook lines a little differently.

Run interactively, the installer asks three questions: which model leads, which model helps, and which output style
you like. Pressing Enter keeps the first choice each time: the recommended models and your current output style. A box then lists the route the installer is about to write,
and nothing is written until you press Enter once more.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/screens/screen-install-questions-dark.webp" /><img src="./assets/screens/screen-install-questions-light.webp" width="688" alt="A terminal window running litcodex install. It asks &quot;Choose the LEAD model (plans and reviews).&quot; with gpt-6-astra · xhigh as recommended lead and 40 rows ending at 39. gpt-5.6-luna · xhigh, &quot;Choose the HELPER model (spawned/delegated agents).&quot; with gpt-6-luna · max as recommended helper, and &quot;Choose an output style for LitCodex responses.&quot; with five options. A MODEL ROUTE box shows Provider openai, Lead gpt-6-astra · xhigh and Helpers gpt-6-luna · max, then &quot;Enter to continue · Ctrl-C to abort (nothing written yet)&quot;." /></picture><br /><sub>Captured from a real litcodex install in a temporary home, answered with Enter at each question. The start banner is cut, the 40 model rows of each list are cut to the first two and the last, and the route box leaves out its path line; each … marks a cut.</sub></p>

After the last Enter the installer works through six steps and prints a receipt. Start with the Status row: Ready for
Codex means the plugin, the hook, the seven agent roles and the managed config keys are in place and the doctor
check passed. The two lines above the receipt report the Office and film tools that the install prepares ahead of
time. If that step cannot finish, the line says so and names the command to run later.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/screens/screen-install-receipt-dark.webp" /><img src="./assets/screens/screen-install-receipt-light.webp" width="728" alt="A terminal window with the end of litcodex install. Six steps, 01 / 06 MARKETPLACE to 06 / 06 HEALTH CHECK, each with a result line, the last being &quot;Running doctor: doctor passed&quot;. Then &quot;[litcodex] Office runtime ready for presentations and documents.&quot; and &quot;[litcodex] Motion runtime ready for film rendering.&quot; An INSTALL RECEIPT box shows &quot;Status Ready for Codex&quot;, &quot;Codex host codex-cli 0.162.1&quot;, &quot;Model gpt-6-astra · xhigh&quot; and ends with &quot;Installation complete&quot;." /></picture><br /><sub>Captured from the same install. The description and path lines under each step, the host checks before step 01 and several receipt rows are cut.</sub></p>

`litcodex doctor` is the quickest way to check the result. Most rows answer yes or no, and a clean run ends with
All checks passed.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/screens/screen-doctor-dark.webp" /><img src="./assets/screens/screen-doctor-light.webp" width="317" alt="A terminal window running litcodex doctor. Rows read &quot;binary: yes&quot;, &quot;marketplace: yes&quot;, &quot;plugin: yes&quot;, &quot;hook: yes&quot;, &quot;managed config: yes&quot;, &quot;agents: yes&quot;, &quot;skills complete: yes&quot;, &quot;lit-handoff: yes&quot;, &quot;science payload: yes&quot; and &quot;automatic handoff: off&quot;, followed by &quot;All checks passed.&quot; and &quot;office runtime: ready&quot;." /></picture><br /><sub>Captured from litcodex doctor in the same home after the install. The start banner, the rows about model routes, concurrency and updates, the warnings that a home without a Codex sign-in produces, the status-line suggestion and the film-tool lines are cut.</sub></p>

Type a request that starts with `lit` and the hook answers before the model does. It prints the five-row LIT
mark and a line that names the route it picked. The same mark appears for `handoff` and `lit recap`, each with its
own route name, so you can tell at a glance which mode took the request.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/screens/screen-lit-ignited-dark.webp" /><img src="./assets/screens/screen-lit-ignited-light.webp" width="543" alt="A Codex terminal window with three prompts. &quot;lit add input validation to the signup form&quot; is followed by &quot;Hook ·&quot;, a five-row LIT mark, &quot;🔥 LIT IGNITED · lit-loop 🔥&quot; and the workflow map line &quot;🔨 WORK › 🔍 · › 🏁 ·&quot;. &quot;handoff&quot; is followed by the same mark and &quot;🔥 LIT IGNITED · lit-handoff 🔥&quot;, and &quot;lit recap&quot; by the mark and &quot;🔥 LIT IGNITED · lit-recap 🔥&quot;. Each turn ends with &quot;Hook · ✨ turn done&quot;." /></picture><br /><sub>Captured from a real Codex 0.162 session with the LitCodex hooks and a local stand-in for the model, so nothing left the machine. The startup banner, the folder-trust and hook-review screens and the model replies are cut.</sub></p>

Behind the mark, the loop keeps score in your project. A new goal starts with three criteria and none passing. Each
recorded result moves the count, and a request to complete the goal early is refused until every criterion has
passed.

<p><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/screens/screen-loop-dark.webp" /><img src="./assets/screens/screen-loop-light.webp" width="729" alt="A terminal window with loop commands. &quot;litcodex loop create &quot;Fix login&quot;&quot; prints &quot;lit-loop plan created: 1 goal(s)&quot; and the paths of the brief, goals and ledger files. &quot;litcodex loop status&quot; prints &quot;- G001-fix-login [pending] Fix login (criteria 0/3 pass)&quot;. After one record-evidence command prints &quot;lit-loop evidence recorded: G001-fix-login/C001 -&gt; pass&quot;, status shows &quot;criteria 2/3 pass&quot;. &quot;litcodex loop checkpoint&quot; then prints &quot;[lit-loop] Goal G001-fix-login has unresolved criteria.&quot;" /></picture><br /><sub>Captured from the real loop commands in an empty project. The long commands are split with backslashes to fit, and the output of the second evidence command is cut. The pictures and how they were made are listed in the <a href="./assets/screens/README.md">media notes</a>.</sub></p>

## Safety

- Plans and evidence stay where you can read them. A criterion is met by recorded evidence that it
  passed; simply running a test command does not count.
- Installing leaves your unrelated Codex settings as they are. Look at the planned changes before you
  use `--reconfigure`.
- Doctor only looks: the doctor diagnostic core never modifies your Codex config, install state or
  plugin state. There are two small update helpers around it, and you can switch both off.
  - The update notice. An eligible interactive doctor run (a successful run you start by hand in a terminal) may show
    a cached advisory notice about a newer version. To keep that notice fresh, a detached background
    worker does a fixed registry refresh and saves the answer in `~/.litcodex/update-check.json`. It
    never installs anything.
  - The updater. After an eligible interactive management command, a separate foreground updater can
    install a newer global package.

  Set `LITCODEX_NO_UPDATE_CHECK=1` if you want neither. A doctor run that failed, or ran with `--json`,
  `--dry-run`, in a non-TTY or CI shell, or with that opt-out set, stays side-effect-free. See
  [privacy](./privacy.md).
- The model you pick is a setting in your config. Whether that model is open to you, and whether it
  actually runs, is up to Codex and your account. See [managed model compatibility](./usage.md#safety).
