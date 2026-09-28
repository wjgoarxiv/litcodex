---
name: visual-qa
description: "Validate material visual evidence. Use for visual QA or an exact blocked receipt."
---

## #contract.activation

```yaml
contract_schema_version: 1
artifact_kind: litcodex_skill_entrypoint
skill_name: "visual-qa"
host: Codex CLI
reader_projection: shared_rule
registration_surface: "plugins/litcodex/skills/visual-qa/SKILL.md"
selection_surface: "$litcodex:visual-qa in the Codex skill picker"
automatic_route: false
```

Activation begins with one `🔥 **LIT IGNITED · visual-qa** 🔥` line; supporting skills add none. No browser access is implied.

## #contract.inputs

Require an evidence-eligible `litfamily.design-contract/v1beta2` with immutable source identity, finite inventory, tier, material captures, and truthful capture/auth/reviewer capabilities. Existing `v1beta1` contracts remain valid. Optional `taste` uses integer `variance`, `motion`, and `density` values from 1 through 10. Alpha cannot PASS evidence.

## #contract.mode_matrix

| Mode | Required inventory | Appropriate use | PASS boundary |
| --- | --- | --- | --- |
| `smoke` | Primary route, critical interaction, extreme viewports | Fast checkpoint | Proves only the finite smoke inventory |
| `full` | Complete declared inventory | Product-ready review | Requires complete coverage and host-proven independent review |
| `reference-fidelity` | Full inventory plus hashed references | Supplied-target comparison | Requires integrity and reference comparison |
| `blocked` | Exact unavailable capability | Missing safe capture/auth/review | Cannot become PASS through prose |

## #contract.procedure

1. Use the first current-session capture option actually callable through Codex or the project; installed-only is unavailable.
2. Record renderer/process identity, session, target, interaction, viewport, source hash, and binary observable.
3. Validate bounded regular artifact bytes, dimensions, hashes, freshness, inventory coverage, and cleanup.
4. For `full` and `reference-fidelity`, require host-proven independent review over identical immutable inputs.
5. Return PASS, measured FAIL, or an exact BLOCKED receipt. BLOCKED outranks FAIL.

## #contract.outputs

Return tier, hashes, renderer identity, inventory, findings, review/cleanup status, and `PASS`, `FAIL`, or `BLOCKED`.

## #contract.evidence

Use `schemas/design-contract.v1beta2.json` for new contracts. Use evidence-eligible `schemas/evidence-manifest.v1beta1.json`, compatibility-only `schemas/evidence-manifest.v1alpha1.json`, and `litfamily.review-receipt/v1alpha1` with the installed validators. Beta binds a caller-authorized evidence root to bounded regular PNG files. Load `references/capture-playbook.md` and `references/complete-contract.md` for details.

```bash
LITCODEX_VISUAL_QA_ROOT="${CODEX_HOME:-$HOME/.codex}/marketplaces/litcodex/plugins/litcodex/skills/visual-qa"
node "$LITCODEX_VISUAL_QA_ROOT/scripts/validate-design-contract.mjs" --input design-contract.json
node "$LITCODEX_VISUAL_QA_ROOT/scripts/validate-review-receipt.mjs" < receipt.json
node "$LITCODEX_VISUAL_QA_ROOT/scripts/validate-evidence.mjs" \
  --input evidence-bundle.json \
  --tier smoke --now 2026-07-25T06:00:00.000Z \
  --evidence-root evidence-root
node "$LITCODEX_VISUAL_QA_ROOT/scripts/cli.mjs" image-diff reference.png actual.png
node "$LITCODEX_VISUAL_QA_ROOT/scripts/cli.mjs" tui-check capture.txt --cols 80
```

## #contract.hard_stops

Do not install dependencies, mutate Codex configuration, reuse personal cookies, attach to unrelated processes, or accept self-attested independence. Return stable codes including `BLOCKED_RENDERER_UNAVAILABLE`, `BLOCKED_AUTH_UNAVAILABLE`, `BLOCKED_RENDERER_OWNERSHIP_UNVERIFIED`, `BLOCKED_EVIDENCE_STALE`, `BLOCKED_REVIEW_TIMEOUT`, and `BLOCKED_INDEPENDENT_REVIEW_UNAVAILABLE`. Full and reference-fidelity remain blocked until Codex exposes host-owned reviewer provenance.

## #contract.anti_patterns

Reject prose-only PASS, paths without validated bytes, stale or non-image captures, HTTP as render proof, similarity as verdict, hidden failure states, and incomplete cleanup.
