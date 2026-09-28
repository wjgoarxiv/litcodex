# Phase 2 + 3 — Hypothesis Formation & Parallel Investigation

One hypothesis is a hunch. Three hypotheses is a decision. Investigation is how you turn the decision into runtime evidence.

---

## Phase 2 — Hypothesis Formation (Minimum Three)

### Why three, not one

A single hypothesis creates confirmation bias: you'll read runtime state looking for evidence that confirms it and unconsciously discount contradictions. Three hypotheses force you to design queries that *distinguish* between them, which is the only way runtime evidence becomes decisive.

### Generate across orthogonal axes

If your three hypotheses are all variations of "the handler has a bug", you don't actually have three hypotheses. Span the space:

| Axis | Example framing |
|---|---|
| **User-code logic** | "The handler early-returns because condition X is unexpectedly true" |
| **Library/SDK behavior** | "The third-party client swallows the error and returns a stub" |
| **Environment/config** | "The env var is read at module-load time before it gets populated, so it's empty" |
| **Async/timing** | "The promise rejects (or goroutine panics) after the response is already sent" |
| **Silent side-effect** | "An earlier turn mutated shared state that the current turn inherits" |
| **Observability gap** | "The error is raised but suppressed before logging; it only exists as an unawaited rejection / ignored signal" |
| **Binary-level** (when applicable) | "The function we think is running is actually jumped over by a patched thunk / a different version loaded" |
| **Build-vs-runtime** | "The code we're reading is not the code that's running — stale build, wrong symlink, cached wheel, or dist/ ahead of src/" |

### For each hypothesis, write in the journal

1. **Claim** — one sentence.
2. **Distinguishing evidence** — the exact value or state that confirms or refutes it, AND where to read it (file:line, log source, breakpoint location, memory address).
3. **If true, the fix is** — two words. Forces you to think through fix cost before committing to the hunt.

### Collapse rule

If two hypotheses have identical distinguishing evidence, they aren't actually different — collapse them and find a real alternative. If you can't come up with a third distinct hypothesis, you don't understand the system well enough yet. Go read a little more code before investigating.

---

## Phase 3 — Independent Investigation Lanes

Parallelism is useful only when the evidence sources do not contend for the same process, port, fixture,
or editable file. Start by writing a lane table in the journal:

| Lane | Hypothesis | Read-only target | Decisive observation | Shared resource |
|---|---|---|---|---|
| Runtime | H1 | live process state | exact value at the branch | process id |
| Trace | H2 | logs and spans | ordered timestamped events | log directory |
| Reproduction | H3 | isolated invocation | input plus observed output | temp directory |

Do not parallelize two debugger attaches to one process, two writers to one trace file, or two
instrumentation edits to the same source. Those lanes run serially even if the Codex host exposes
subagent controls.

### Codex host with subagent controls

Use one read-only explorer for each genuinely independent lane. Give every explorer a self-contained
assignment containing:

- the symptom and exact reproduction command;
- one hypothesis only;
- the file, process, log, or address it may inspect;
- the value that would confirm or refute the hypothesis;
- a prohibition on source edits and Git mutations;
- the requested report shape: commands, exit codes, raw observations, and uncertainty.

The coordinating agent remains responsible for the journal and verdict. A child report is a lead, not
evidence: replay the decisive command or inspect the cited artifact before changing a hypothesis status.
If a lane needs instrumentation, stop that lane, journal the proposed edit, and let one owner make the
smallest reversible change.

Suggested lane roles are runtime-state inspection, trace correlation, and reproduction minimization.
Adding more roles rarely adds independence; prefer three strong evidence streams over many agents reading
the same code.

### Codex host without subagent controls

Run the same lanes sequentially. Preserve the lane table and execute the cheapest falsification query
first. A missing delegation surface changes scheduling, not rigor:

1. capture the baseline reproduction;
2. read the runtime value most likely to split the hypothesis set;
3. correlate logs against that run;
4. update every hypothesis status before starting another round.

### Lane completion and failure modes

A lane is complete only when it returns one of these:

- **confirmed** — raw evidence matches the predeclared confirming value;
- **refuted** — raw evidence contradicts the claim;
- **inconclusive** — the evidence source was reached but cannot distinguish the hypotheses;
- **blocked** — a named capability, permission, credential, or live resource is unavailable.

Timeout is not refutation. Empty output is evidence only after confirming the command targeted the right
process, file, time range, and build. When two lanes disagree, retain both artifacts and run a single
query designed to discriminate between them; do not average the conclusions.

---

## Evidence capture discipline (both paths)

For every piece of runtime state captured, record in the journal:

```markdown
### <ISO timestamp> — <what you looked at>
- Source: <file:line | log source | curl command | breakpoint address>
- Value: `<verbatim>`
- Interpretation: <one line — why this matters>
- Refutes/Confirms: H<n>
```

**Verbatim values only. No paraphrasing.**

- `messages.length=0` is evidence.
- "messages seemed empty" is not evidence — it's a memory of an observation, and memory of observations is where debug sessions go to die.

If you find yourself about to paraphrase, stop, go back, and copy the raw value.

---

## Round completion

A "round" is complete when every hypothesis has either confirming or refuting evidence — or when you have exhausted the evidence sources available without a decisive result. If the round ends inconclusively, that counts as a failed round for the counter in the journal. See `04-oracle-triple.md` for what to do at 2 consecutive failed rounds.
