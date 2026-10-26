# Choose the design first

The user has the right to choose the look. Before `treatment.json`, ask once, with the rules' pick first as `(Recommended)`:

1. `Path`: the type path (the words are the film; 16:9 only) or stage (the film shows things). A README or banner loop is a cover and asks nothing.
2. `Style`: `swiss-signal`, `tidal`, `terminalcore` or `paper` (stage only), by the rules in `references/studio.md`, Choosing the style. When the user wants to see them first, run `node "$R" styles --out <dir>` and show `styles.png`.
3. `Register`: rich (the default: layered world, moving camera, authored score) or minimal (calm, one hero, preset bed).
4. `Format`: 16:9 or 9:16.

Put the answers into the treatment through the request: the validator derives style, register and format from `treatment.request`, so append each answer in the user's words (`<request> Style: tidal. Calm. Vertical.`) and write the matching `style`, `register` and `format`. `typePlan.presetSource` is `user` only for a style the user picked. A 3D subject takes the stage path with `depth: "3d"` (`references/depth.md`). Cover mode asks nothing.

## How to ask

Ask with `request_user_input` when this turn offers it (Plan mode): 2–4 options per question, the recommended one first and labelled `(Recommended)`, a one-line description each; the tool takes a free-text answer on its own, so no Other option is written.

When it is not offered (Default mode), put the same question in the reply as a short numbered list with the recommended option first as `1. … (Recommended)`, and end the turn to wait for the pick; build nothing before it arrives.

In a non-interactive `codex exec` run nobody can answer: take the recommended option, say so in one line ("Non-interactive run: building the stage path at 16:9, the recommended options") and continue.

## When to skip

Skip a question only when the prompt already names its answer (a style, calm or minimal, 9:16 or 16:9, a lyric or title-sequence video) or hands the choice over ("you choose", "just make it good", "알아서", "네가 골라"), or under a bare `lit`: take the recommended options and say so in the reply.
