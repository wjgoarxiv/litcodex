# Screen snapshots

These pictures show what LitCodex prints while you install it, check it and start a task. They are documentation
artwork. Like the other files under `docs/assets/`, they stay out of the npm package and the installed plugin.

How each picture was made:

- `screen-install-questions`: a real `litcodex install` in a temporary home, run in a terminal and answered with Enter at
  every question. The 20 model rows of each list are cut to the first two rows and the last one, and the route box
  leaves out its path line. Each `…` marks a cut.
- `screen-install-receipt`: the same install. The description and path lines under each step are left out, and so are
  some receipt rows. The temporary home started with the film tools already in its cache, so the two runtime lines
  appeared at once.
- `screen-doctor`: a real `litcodex doctor` run in that home after the install. The rows about model routes,
  concurrency and updates, the warnings that a home without a Codex sign-in produces, and the film-tool lines that
  follow the Office line are left out.
- `screen-lit-ignited`: a real Codex CLI 0.158 session with the LitCodex `UserPromptSubmit` hook, run in a temporary
  home and project with a local stand-in for the model. The picture keeps each prompt and the hook lines and cuts the
  startup banner, the hook-review screen and the model's reply.
- `screen-loop`: the real `litcodex loop` commands in an empty project. The long commands are split with backslashes to
  fit, and the output of the second evidence command is cut.

The demo film in the README, `../demo.webp`, is an animated WebP made from one real Codex CLI 0.159 session with
LitCodex 1.0.18 installed, in a small Node project made for it. The screen was captured while Codex worked on
`lit add a --shout flag that prints the greeting in capitals, with a test`, and the captured screens were redrawn on a
terminal window in a dark room that a camera drifts across, with focus and light picking out each step. Waiting is
shortened, and the hook banner, the plan, the failing and the passing test run and the summary are held long enough to
read. The scratch folder Codex prints in its header (a long temporary path) is written as `~/greet`, and a few labels
(the permission mode, a temporary file name and the warning count) are blurred; no other text was edited. The film
ends on a closing card with the LitCodex mark and the install command.

Each picture comes in a dark and a light version. The terminal window is drawn around the captured text; the text
itself was not edited. The light version darkens any color that would be hard to read on a light window, the way a
terminal's minimum-contrast setting does. Lettering is set in MesloLGS NF Regular, licensed under the Apache License
2.0 ([notice](../jev/MesloLGS-NF-LICENSE.txt)).
