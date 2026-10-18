# Screen snapshots

These pictures show what LitCodex prints while you install it, check it and start a task. They are documentation
artwork. Like the other files under `docs/assets/`, they stay out of the npm package and the installed plugin.

How each picture was made:

- `screen-install-questions`: a real `litcodex install` in a temporary home, run in a terminal and answered with Enter at
  every question. The start banner is cut, the 40 model rows of each list are cut to the first two rows and the last
  one, and the route box leaves out its path line. Each `…` marks a cut.
- `screen-install-receipt`: the same install. The host checks before step 01, the description and path lines under each
  step and several receipt rows are left out.
- `screen-doctor`: a real `litcodex doctor` run in that home after the install. The start banner, the rows about model
  routes, concurrency and updates, the warnings that a home without a Codex sign-in produces, the status-line
  suggestion and the film-tool lines that follow the Office line are left out. One row for a retired option was also
  cut from the picture without changing the other lines.
- `screen-lit-ignited`: a real Codex CLI 0.162 session with the LitCodex hooks, run in a temporary home and project with
  a local stand-in for the model. The picture keeps each prompt and the hook lines, including the workflow map under
  the lit-loop mark and the Stop hook's `✨ turn done`, and cuts the startup banner, the folder-trust and hook-review
  screens and the model's reply.
- `screen-loop`: the real `litcodex loop` commands in an empty project. The long commands are split with backslashes to
  fit, and the output of the second evidence command is cut.

The demo film in the README, `../demo.webp`, is an animated WebP of one LitCodex turn in Codex CLI, in a small Node
project shown as `~/greet`. Numbered labels name each step as it happens: the word `lit` turns LitCodex on, the hook
picks lit-loop, the map line under the hook block shows the turn at WORK with review and done still ahead, Codex reads
its lit-code playbook before it edits anything, writes a test and sees `npm test` fail, fixes `greet.js`, checks the CLI
and runs `npm test` again, and the summary ends with the Stop hook's `✨ turn done` line. The film opens on a title card
with the LitCodex mark and ends on a card with the install command.

Each picture comes in a dark and a light version. The terminal window is drawn around the captured text; the text
itself was not edited. The light version darkens any color that would be hard to read on a light window, the way a
terminal's minimum-contrast setting does. Lettering is set in MesloLGS NF Regular, licensed under the Apache License
2.0 ([notice](../MesloLGS-NF-LICENSE.txt)).
