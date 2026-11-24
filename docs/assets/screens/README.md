# Screen snapshots

These pictures show what LitCodex prints while you install it, check it and start a task. They are documentation
artwork. Like the other files under `docs/assets/`, they stay out of the npm package and the installed plugin.

How each picture was made:

- `screen-install-questions`: a real `litcodex install` with Codex CLI 0.163 in a temporary home, run in an 80-column
  terminal. The picture stacks two moments: the first card, then the folded answers above the fourth card. The start
  banner and the second and third cards are cut. Each `…` marks a cut.
- `screen-install-receipt`: the same install. The lines Codex printed under the Marketplace and Plugin steps, the Models
  and Codex host rows of the receipt card and the extensions notice are left out.
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

The demo film in the README, `../demo.webp` (`../demo-ko.webp` on the Korean page), is a silent 18-second loop of one
LitCodex turn in a small Node project shown as `~/greet`, with Codex in the top pane and `litcodex hud` in a pane
under it. The hud card is drawn by the HUD's own card code with the round caps on, and the hook lines are the hook's real
output; the Codex chat around them is redrawn. In it the word `lit` turns LitCodex on, the hook names lit-loop, Codex
reads its lit-code playbook, writes a test and sees `npm test` fail while two lanes run under the map, fixes `greet.js`,
checks the CLI, and the card ends on DONE with its two-second burst before it rests under the sunset. The Korean
file has the same turn with Korean lines; the card itself stays in English.

Each picture comes in a dark and a light version. The terminal window is drawn around the captured text; the text
itself was not edited. The light version darkens any color that would be hard to read on a light window, the way a
terminal's minimum-contrast setting does. Lettering is set in MesloLGS NF Regular and Bold, licensed under the Apache License
2.0 ([notice](../MesloLGS-NF-LICENSE.txt)).
