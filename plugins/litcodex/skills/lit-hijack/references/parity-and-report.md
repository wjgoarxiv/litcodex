# Parity proof and report

A port is proven by two observations: the capability fires on the surface a user touches, and the new target behaves differently from the old one on the same prompt. Green tests and new files are necessary and never sufficient. Ports have passed every gate while being unreachable, and A/B runs have measured nothing because the baseline could read the treatment; this step exists to catch both.

## 1. Reachability

Drive the real entry point, read what comes back, then break the wiring and watch the probe fail.

| Target surface | Probe | Break it by |
| --- | --- | --- |
| Prompt-hook route | Pipe a `UserPromptSubmit` JSON payload into the hook and assert the skill is named in the returned context | Removing the route entry |
| Typed skill | `codex exec` with the typed `$litcodex:<id>` mention, reading the model input | Renaming the skill in the catalog |
| Skill discovery | A `codex exec` prompt that should surface the skill, with the request log showing its path | Changing the description or the implicit-invocation policy |
| Script or gate | Run the installed copy's script on a fixture that should fail and one that should pass | Reverting the gate |
| Package payload | Pack the package and list the files (read the JSON listing, not the human text) | Removing the file from the package manifest |

A probe that cannot fail proves nothing; record the broken run beside the passing one, and name the test that went red.

## 2. An isolated baseline

The baseline is the target at the base revision, in a place where the new work cannot be read:

```text
git -C <target root> worktree add <lane folder>/parity-base <base_ref>
```

or the snapshot copied in Phase 0. Check the isolation before running anything: the baseline folder has none of the new files, `git log` inside it stops at the base revision, and the run folder, the spec and the diff are outside any path the baseline session can reach. When the target lives in a repo the baseline session could explore, run the baseline from a copy outside that repo.

## 3. Running both arms

Choose prompts the spec never used as examples: a held-out prompt shows the behaviour generalises, while a prompt copied from the spec only shows the spec was followed.

For a Codex skill or plugin target, run each arm as a real `codex exec` in its own throwaway workspace with its own scratch `CODEX_HOME`:

```text
CODEX_HOME=<scratch>/baseline-home codex exec --skip-git-repo-check -C <scratch>/baseline-ws "<held-out prompt>" < /dev/null
CODEX_HOME=<scratch>/treatment-home codex exec --skip-git-repo-check -C <scratch>/treatment-ws "<held-out prompt>" < /dev/null
```

- Each scratch home gets only that arm's copy of the target, installed the same way (for a plugin: `codex plugin marketplace add <copy>` then `codex plugin add <name>@<marketplace>`; for a project skill: a copy under the workspace's own skills folder).
- The installed copy of the same plugin in the real home stays out of the picture because the real home is never used. Never copy `auth.json` or any credential into a scratch home; when the arm needs a model, sign in inside the scratch home yourself or use a local test provider, and say which.
- A plugin hook stays untrusted in a non-interactive run. For the throwaway arms only, `--dangerously-bypass-hook-trust` is acceptable because the hook source is the arm's own copy in a scratch home.
- Keep the runs cheap: a small prompt, one model. Run each arm at least twice when its output varies. One sample can mislead.
- After the runs, read the real `~/.codex/config.toml` (read only) and confirm no scratch path leaked into it.

For a code target, run the target's tests and its real command on both revisions, and save the outputs.

Save every output under `parity/` (`baseline-1.md`, `treatment-1.md`, …) and list them:

```json
"parity": {
  "baseline_outputs": ["parity/baseline-1.md", "parity/baseline-2.md"],
  "treatment_outputs": ["parity/treatment-1.md", "parity/treatment-2.md"],
  "markers": ["Rejection condition"]
}
```

The parity gate then requires every marker in every treatment output and in no baseline output. A marker missing from a treatment output means the port changed behaviour unreliably. A marker in a baseline output means the baseline saw the new work, or the target already had the behaviour and the gap was imaginary. Either way the proof is void until fixed. Before trusting a tie or a surprising win, grep the baseline transcript for the treatment's distinctive identifiers (file names, section names, the skill's own terms); any hit voids the comparison.

## 4. Visual outputs

When the target makes images, films, slides, documents or pages, the user judges them by eye. Render the baseline and treatment outputs side by side on one contact sheet (rows for arms, columns for runs), save it under `parity/`, and show it. Machine checks such as overlap or layout scores are geometry checks; call them that. Headless browsers used for renders take `--use-mock-keychain --password-store=basic` so no keychain dialog interrupts the user.

The sample output is evidence that the port works. Polishing that one sample is a different task; offer it only when the user asks.

## 5. The report

`REPORT.md` lives in the run folder. The gate requires the three headings, every mechanism id, every source's URL or path, and a credit notice for every `ideas-credit` source that fed a taken mechanism.

```markdown
# Port report: <title>

Target: <root> at <base revision> → <new revision or working tree>
Run: .litcodex/hijack/<slug>/ · gate: check --phase report PASS

## Taken
- M1 <title>: <where it lives now> · parity: marker in 2/2 treatment runs, 0/2 baseline runs
- M4 <title>: …

## Left
- M2 <title>: the target already enforces it (<path:line>)
- M3 <title>: opinion with no gain over the base model in a probe run
- M5 <title>: rests only on S5, which is no-go

## Provenance
| Id | Source | Author | Published | Retrieved | Licence | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | https://… | … | … | … | NOASSERTION | ideas-only |

## Exposure
The spec writer read every source. The implementer worked from SPEC.md as a child agent with
fork_context false, in a separate checkout (or: in the same context, degraded path). The model may
have met these sources before. No run of 12 or more words is shared with any capture; headings were
checked for structural echoes.

## Credit
<attribution notice path, or "credit lives in this report">

## Review by
<date, and what would make this port stale: a model change, a target redesign, a new source>
```

## 6. Closing the run

1. `hijack.mjs check <run> --phase report` passes.
2. The reply to the user says what was taken and left, the parity result in a sentence, the contact sheet when there is one, and the report path.
3. Offer `review-work` for a review of the diff; its provenance lane reads the run folder.
4. The run folder stays local and out of commits. Commits, pushes and releases wait for the user.
