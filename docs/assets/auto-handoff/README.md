# Automatic handoff snapshots

These pictures show what appears on screen when you turn the automatic handoff on, check it, turn it off, and
when it saves a handoff. They are documentation artwork. Like the other files under `docs/assets/`, they stay
out of the npm package and the installed plugin.

How each picture was made:

- `auto-handoff-on`, `auto-handoff-status-off`: the replies come from LitCodex 1.0.19's own `UserPromptSubmit`
  hook, run on a sample project that the Codex config in a temporary home marks as trusted. The "Blocked by hook"
  line and the layout follow a real Codex CLI 0.162 session in which the same prompts were sent; that session ran
  in a project Codex had not saved as trusted, so its `on` reply ended with the sentence about trusting the
  project, which the page quotes.
- `auto-handoff-saved`: drawn from the line the hook tells the model to say when Codex will not compact by itself,
  followed by the `/compact` prompt. The model's wording and the rest of that turn can differ in a real session.
- `auto-handoff-doctor`: the `automatic handoff` line from three real runs of `litcodex doctor` 1.0.19 in that
  sample project. The rest of each report is left out.

Each picture comes in a dark and a light version. The terminal window and its colors are drawn around the text,
and long lines wrap at the window edge the way a terminal wraps them. Lettering is set in MesloLGS NF Regular,
licensed under the Apache License 2.0 ([notice](../MesloLGS-NF-LICENSE.txt)).
