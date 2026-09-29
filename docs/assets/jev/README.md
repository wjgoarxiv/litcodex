# Jev snapshots

These pictures show what appears on screen when the optional Jev skill hint is off, on, or missing its key.
They are documentation artwork. Like the other files under `docs/assets/`, they stay out of the npm package
and the installed plugin.

How each picture was made:

- `jev-off`, `jev-key-missing`: a real Codex CLI 0.158 session with LitCodex's own `UserPromptSubmit` hook, run in a
  temporary home and project with a local stand-in for the model. The picture keeps the prompt and the hook lines and
  trims the model's reply.
- `jev-on-notice`, `jev-hint-shown`: the same setup, with LitCodex's hook code started through a small launcher that
  answers the Jev request with a canned reply, so nothing was sent to TypeSafe. The skill name `debugging` and the 0.30 s
  are stand-ins.
- `jev-doctor`: the Jev line from three real runs of `litcodex doctor` in a temporary home. The rest of each report is
  left out, and the key is shown as a placeholder.

Each picture comes in a dark and a light version. The terminal window and its colors are drawn around the captured text;
the text itself was not edited. Lettering is set in MesloLGS NF Regular, licensed under the Apache License 2.0
([notice](./MesloLGS-NF-LICENSE.txt)).
