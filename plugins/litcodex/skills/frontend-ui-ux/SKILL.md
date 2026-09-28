---
name: frontend-ui-ux
description: "Design frontend interfaces from a compact direction; resolve material ambiguity, then inspect authorized implementation."
---

## #contract.activation

```yaml
contract_schema_version: 1
artifact_kind: litcodex_skill_entrypoint
skill_name: frontend-ui-ux
host: Codex CLI
reader_projection: shared_rule
selection_surface: "$litcodex:frontend-ui-ux in the Codex skill picker"
automatic_route: false
registration_surface: plugins/litcodex/skills/frontend-ui-ux/SKILL.md
```

On activation, emit exactly one first-line probe: `🔥 **LIT IGNITED · frontend-ui-ux** 🔥`.

Do not write because the user only mentioned a keyword or left the target ambiguous. Review-only and plan-only work is read-only. Clarify material intent; keep authorized implementation scoped.

## #contract.inputs

Outcome, constraints, and authorization define scope. See `references/complete-contract.md` for inputs and safeguards.

## #contract.mode_matrix

| Mode | Use when | Required result |
| --- | --- | --- |
| build | Default authorized interface work | Working source, probe, and review handoff. |
| polish | Styling values on an existing UI | Probe before/after; no restructure. |
| audit | Same-surface pivot after work in this session | Read-only findings; no fix. Cold review goes to `visual-qa`. |
| harden | Cue-gated stress of an existing UI | Repair observed breaks, at most three rounds. |

## #contract.procedure

Follow `references/complete-contract.md`, `references/production-interview.md`, `references/motion-guide.md`, and `references/probe-and-review.md`; default direction is `references/default-editorial-pixel.json`. Always load `references/craft-floor.md` and `references/slop-register.md` once selected. Use `litfamily.design-contract/v1beta2` with `schemas/design-contract.v1beta2.json`. Lead with the user's primary information and actions; implement the interactions needed for the user's task. Inspect real 390/1440 renders, navigation, links, and visible controls. Source/tests are not visual proof; `visual-qa` owns verdicts.

Mode words apply only after picker selection or a bounded lit-loop delegation. `scripts/route-mode.mjs` checks English/Korean UI objects and excludes video, slides, prose, and server work; text alone never activates this skill. Use build by default, polish for value-only edits, audit only after same-surface session work, and harden for stress cues.

## #contract.outputs

Report result, preview and material gap. Keep full evidence in the work area.

## #contract.evidence

Load `references/complete-contract.md` and `references/canonical-library.md` for detail. Imported scripts stay inert. The exact host-selected SKILL.md path anchors every validator/resource lookup; never hardcode a cache path. Derive the validator path from that file:

```bash
FRONTEND_UIUX_SKILL_FILE="<absolute path of the SKILL.md selected for this turn>"
FRONTEND_UIUX_SKILL_ROOT="$(cd "$(dirname "$FRONTEND_UIUX_SKILL_FILE")" && pwd -P)"
node "$FRONTEND_UIUX_SKILL_ROOT/scripts/validate-design-contract.mjs" --input design-contract.json
```

See `references/evidence-review.md` for evidence-root and host-review limits.

## #contract.hard_stops

Never change host config/auth, widen authority, fabricate evidence, or overwrite work. Missing renderer means `BLOCKED`.

## #contract.anti_patterns

Avoid keyword-only authorization, schema-only stops, and source-as-render proof.
