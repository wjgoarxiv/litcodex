# @litcodex/lit-loop

The **lit-loop** component of [LitCodex](../../../../README.md) — the bare-`lit` trigger, the Codex
`UserPromptSubmit` hook, and the durable loop runtime.

This package is bundled and installed by [`@litfamily/litcodex`](https://www.npmjs.com/package/@litfamily/litcodex);
you normally don't install it directly.

## What it does

Typing a bare **`lit`** (bounded — `split`, `literal`, `litmus` do not trigger) in Codex makes the
hook inject a `<lit-loop-mode>` directive that puts the agent into **lit-loop**: an evidence-bound,
autonomous work loop that maintains durable state, verifies progress, checkpoints evidence, and
continues until the work is genuinely done or blocked. The same hook also routes bounded phrases such
as `lit plan`, `lit review`, `lit research`, `lit goal`, and `lit start work`; code spans/fences and
slash-command-style mentions are ignored except the explicit `/litresearch` research route.
Exact bare `handoff` and `lit-scientific-visualization` prompts are dedicated standalone routes. The
scientific route injects its `<lit-scientific-visualization-mode>` envelope plus the complete bundled
adapter, while quoted, fenced, mixed, slash-style, scoped, and near-miss forms remain inert.

## Automatic handoff

This component also carries the opt-in automatic handoff (off by default). The exact prompt
`lit-handoff auto on <percent>` (or `off`, `status`) sets it without reaching the model. The Stop hook then
reads the context percent from the session transcript and, once per crossing, asks the model to save a
handoff. The PostCompact hook, the SessionStart hook (source `compact`) and the next prompt bring the fresh
handoff back once. `src/auto-handoff-settings.ts` holds the switch and the project `.codex/config.toml`
line, `src/auto-handoff.ts` holds the crossing and reload logic, and the
[root README](../../../../README.md#automatic-handoff-optional) explains it for users.

## Loop state

Durable state lives under `.litcodex/lit-loop/` in the project:

| File | Role |
| --- | --- |
| `brief.md` | the run brief |
| `goals.json` | the plan + goals + success criteria |
| `ledger.jsonl` | append-only event ledger |
| `evidence/` | captured evidence artifacts |

Writes are atomic (tmp + fsync + rename) and corruption is recovered to a timestamped `.bak`, never
auto-discarded.

### Platform boundary

The descriptor-bound guarantees used by the lit-loop filesystem helpers are POSIX-only. Node has no
Windows directory-descriptor or `openat`/`dir_fd` equivalent, and Python's `dir_fd` APIs are Unix-only.
Descriptor-dependent Python routes therefore fail closed on Windows with
`BLOCKED_UNSUPPORTED_PYTHON_POSIX_RUNTIME`; Windows support is partial and does not claim exact parity.

## Commands

`litcodex loop create | status | run | checkpoint | record-evidence | doctor` — see the
[repository README](../../../../README.md) for the full loop model.

## License

MIT — see [LICENSE](./LICENSE).
