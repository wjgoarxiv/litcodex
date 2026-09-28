# Probe, modes, and review

The Codex skill picker is the activation boundary. A bounded `lit` task can delegate screen work here after the user has authorized that work. `scripts/route-mode.mjs` classifies a selected UI request; it cannot grant selection by matching a word in ordinary chat. A cold request for an independent review belongs to `visual-qa`.

## Choose the mode

`build` is the default for an authorized new screen or structural change. English cues include build, create, implement, add, and wire up; Korean cues include 만들어, 구현해, 추가해, 붙여줘, 새로 짜줘. Resolve consequential direction choices in the finite contract before coding, then implement the requested interface.

`polish` applies to an existing UI when the user says polish, clean up the styling, tighten up, or 다듬어 with a UI object. Measure first. Change only a flagged value such as spacing, color, type size, radius, or a motion token. A new component, navigation structure, or information hierarchy is build work. Generic prose 다듬어 does not activate frontend work.

`audit` is a same-surface pivot: this skill already worked on this surface during this session, and the user now asks for audit, read-only review, just check, don't fix, or UI 점검. Run the probe and report. Make zero source edits and perform no fix round. Without that session context, use `visual-qa`. Server or deployment 점검 is outside this skill.

`harden` is stress-test, hold up under, robust to, 튼튼하게, or 견고하게 for a UI. Test only applicable axes: longer/shorter content, mixed script and shape, count from zero to about tenfold, squeezed/narrow/wide containers, loading/error/disabled states, and dark/zoom/reduced-motion environment. State why an axis is not applicable. Repair only a break observed on that axis.

Video, 영상, 모션, and 발표 alone never select frontend. A button's motion value can still be polish when a UI object and value-only request are explicit.

## Run and repair

Use the host-selected skill directory, not a guessed cache path:

```bash
node "$FRONTEND_UIUX_SKILL_ROOT/scripts/probe.mjs" --page path/to/index.html --evidence-root path/to/evidence --out path/to/evidence/probe.json
```

The driver serves a local HTML page from an owned 127.0.0.1 server, checks `agent-browser` identity, runs the 320/390/768/1440 light matrix plus 390 dark/reduced and 720×450 zoom emulation, and captures screenshots. No installer or remote fetch is a remedy for a missing browser. Exit 0 means no measured HIGH, 1 means at least one HIGH, and 2 prints one `BLOCKED: <reason>` line. `--static path/to/source.html` gives source-only signals and marks rendered checks not verified; never call it a browser pass.

Build follows build → probe → fix, at most three fix rounds, then a final probe. Polish probes before and after. Harden probes each applicable stress axis and uses at most three repair rounds. Choose the cheaper repair first: delete an unnecessary pattern; use a browser/platform behavior; reuse a sound local component; correct a value; add a new element last. Remaining HIGH blocks a clean done claim unless named as a limitation with a reason. MEDIUM and LOW findings stay visible but do not block by themselves.

The probe's JSON contains `{manifest,findings}`. A finding has `rule`, `severity`, `tier`, `viewport`, `value`, `threshold`, and optionally `selector`/`note`. `measured` means a direct style, rect, pixel, or state read; `derived` means a calculation from sound measured inputs. If a source value is unreadable or stale, downgrade the claim to inferred prose or put the rule in `manifest.not_verified`. Human-only JUDG observations are `Inferred` in the report and never fabricated as machine JSON.

## Human review

Present the findings table with exactly these columns:

| Severity | Rule | Where | Measured | Fix |
| --- | --- | --- | --- | --- |
| HIGH/MEDIUM/LOW | CF/RS/SLOP id | selector @ viewport, or file:line in static mode | actual value and threshold, tagged Measured/Derived/Inferred | one specific lower-cost correction |

Then list every unrun rule with its reason under **Not verified**. Cross-origin frames and image layers, unexercised disclosures, a blocked browser, and static-only runs belong there. The review gate says `Block` while an unresolved HIGH remains without a reasoned limitation, otherwise `Approve` for this probe's scope. That gate supplies evidence to independent `visual-qa`; it is not the independent visual verdict.

For a diff review, examine removed attributes and styles before judging additions: accessible names, semantic controls, focus rules, color tokens, recovery wording, reduced-motion guards, and `will-change` cleanup. Re-measure any behavior a removed line used to provide. A visually-hidden assistive span is intentional, not clipped page copy. Open discoverable accordions, tabs, drawers, and dialogs before calling their hidden content unreachable. Mark opaque cross-origin content not verified.
