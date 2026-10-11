# Automatic handoff (optional)

[README](../README.md) · [한국어](./auto-handoff-Ko-KR.md)

A long session eventually runs out of room, and the next context starts without what this one learned. A
handoff file carries that knowledge across. This option writes the handoff for you when the conversation
reaches a size you choose, so you never have to watch the context meter.

It is off by default, and you choose the percent of the context window at which it acts. LitCodex has no
default percent. To turn it on, send this as your whole prompt (60 is only an example; any whole number
from 1 to 99 works):

```text
lit-handoff auto on 60
```

LitCodex answers right away and does not send that prompt to the model. The same prompt family covers the rest:

- `lit-handoff auto off` turns it off and remembers your number.
- `lit-handoff auto on` with no number brings back the last number you used, and asks you for one when you never gave one.
- `lit-handoff auto status` shows what is set and why.

If you prefer the environment, set `LITCODEX_AUTO_HANDOFF=1` and `LITCODEX_AUTO_HANDOFF_PERCENT=60` before you
start Codex. While they are set they take priority over the command. A percent outside 1 to 99, or one that is
not a whole number, leaves the option off, and `litcodex doctor` says so.

Here is what happens at the chosen percent, and which steps LitCodex does by itself on Codex:

1. **Watching (automatic).** When a turn ends, the Stop hook reads how much of the context window the last model
   request used. That is the same number Codex compares with its own compaction setting.
2. **Saving (automatic, once per crossing).** At or above your percent, LitCodex asks the model to write the
   handoff now with the lit-handoff skill, and to put a line naming this session in the file. It asks once.
   It asks again only after the context has dropped below your percent and climbed back.
3. **Compacting (automatic when you turned it on by command, a reminder otherwise).** Turning it on by command also
   writes your percent into the project's `.codex/config.toml`, so Codex compacts as soon as the turn that saved
   the handoff ends. Codex reads that file only in a trusted project, and the setting needs Codex CLI 0.158 or
   newer. LitCodex looks at your Codex config to see whether the project is trusted and promises the automatic
   compaction only when it is. When Codex is not set up to compact (you used the environment variables, the
   project is not trusted yet, or the project file already holds a value of its own), the model ends the turn with
   one line: "Handoff saved. Run /compact now."
4. **Coming back (automatic).** After the compaction, LitCodex hands the model the start of the handoff this session
   just saved, with its path, once. A handoff written before the trigger, or one that names another session, is left out.

Choose a percent below the point where Codex compacts on its own; otherwise Codex can compact before the
handoff is saved, and `litcodex doctor` warns when your percent reaches that point. Turning the option off
removes only the lines LitCodex added to `.codex/config.toml`. That also holds when the environment
(`LITCODEX_AUTO_HANDOFF=0`) or a deleted settings file turns it off: the next hook or route run removes the lines,
and `litcodex doctor` warns while they are still there. Your choice and the per-session records live in
`.litcodex/auto-handoff/` inside the project, on your machine and out of Git. See
[privacy](./privacy.md#automatic-handoff).
