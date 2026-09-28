<lit-handoff-mode>

## #contract.activation

```yaml
contract_schema_version: 1
artifact_kind: litcodex_hook_directive
host: Codex CLI
route: "exact bare handoff"
injection_surface: "UserPromptSubmit additionalContext"
skill_name: "lit-handoff"
skill_invocation: "$litcodex:lit-handoff"
wrapper_contract: "keep <lit-handoff-mode> as the first line and </lit-handoff-mode> as the final non-whitespace line"
required_sections:
  - "#contract.activation"
  - "#contract.inputs"
  - "#contract.mode_matrix"
  - "#contract.procedure"
  - "#contract.outputs"
  - "#contract.evidence"
  - "#contract.hard_stops"
  - "#contract.anti_patterns"
```

This trusted LitCodex directive activates only when the complete trimmed user prompt is the word
`handoff`, case-insensitively. It does not activate for extra prose, paths, quoted text, code spans,
fences, block quotes, or `$litcodex:lit-handoff`; the scoped form is handled by Codex skill discovery.

**MANDATORY:** the exact first user-visible line is
`🔥 **LIT IGNITED · lit-handoff** 🔥`.

## #contract.inputs

```json
{
  "contract_schema_version": 1,
  "input_schema": {
    "user_prompt": { "type": "string", "handling": "use only as the exact route signal" },
    "installed_skill_body": { "type": "lit-handoff SKILL.md", "handling": "follow after this safety envelope" },
    "workspace_state": { "type": "files, git, ledgers, tests, runtime state", "handling": "verify before writing current claims" },
    "sensitive_material": { "type": "secret values and credentials", "handling": "redact values; retain only safe credential locations" }
  }
}
```

| Input channel | Accept when | Required handling | Evidence to retain |
| --- | --- | --- | --- |
| Hook route | Prompt is exactly bare `handoff` | Follow this directive and the installed skill body | Mode marker and destination |
| Installed skill body | Embedded in `<litcodex-skill-body name="lit-handoff">` | Read the bundled authored workflow in full | Authored root and hashes |
| Existing handoff | Selected by the authored destination resolver | Cross-check against live state | Drift found and corrected |
| Sensitive data | Encountered during inspection | Redact secret values and authorization headers | Safe credential locations only |

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Create | No compatible handoff exists | Resolve the authored destination and use the canonical bundled template. |
| Refresh | A compatible handoff exists | Replace stale facts with current evidence and leave one coherent packet. |
| Blocked | Safe, factual continuation state cannot be produced | Report `BLOCKED:` with one safe unblocker and do not fabricate. |

## #contract.procedure

1. Emit the exact activation banner before any other user-visible text.
2. Read the installed `lit-handoff` adapter and its authored `../../vendor/handoff/SKILL.md` in full.
3. Resolve the real repo boundary and destination before editing.
4. Inspect relevant handoff, ledger, JSONL, git, package, and runtime surfaces; current evidence wins
   over stale prose.
5. Redact secret values, passwords, keys, tokens, cookies, authorization headers, and `.env`
   contents. Record only safe credential locations or that login is required.
6. Apply the canonical authored template and completeness checks.
7. Re-read the result, verify commands and paths, and report the destination plus remaining blockers.

## #contract.outputs

```json
{
  "contract_schema_version": 1,
  "output_schema": {
    "first_visible_line": "🔥 **LIT IGNITED · lit-handoff** 🔥",
    "destination": "resolved HANDOFF.md path",
    "operation": "created | refreshed | blocked",
    "evidence": ["live probes and inspected artifacts"],
    "redactions": ["categories only, never secret values"],
    "next_state": "exact continuation step"
  }
}
```

| Output field | Required content | Forbidden substitute |
| --- | --- | --- |
| Destination | One resolved path | Multiple speculative files |
| State | Verified current facts | Unchecked memory |
| Next step | Exact resumable action | “Continue later” |
| Credentials | Safe location or login requirement | Secret values |

### Conversational boundary

Apply the always-on reader-facing communication contract to the human receipt. Keep the handoff body
detailed and resumable; do not forward it verbatim by default. Report the result, material risk,
required action, and detail requested by the current authoritative user request.

## #contract.evidence

- Use hook fixture replay to prove exact-only activation and transcript idempotency.
- Use byte hashes to prove the authored subtree is unchanged.
- Use current git, file, ledger, test, package, or runtime probes for claims written into the handoff.
- Re-read the final artifact and perform a secret-value review before reporting success.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Secret risk | The handoff would expose secret values or authorization headers | Redact; if still unsafe, report `BLOCKED:` and a safe credential location. |
| Ambiguous destination | The authored resolver cannot choose one destination | Ask for the smallest user decision. |
| Unverified state | A critical current claim cannot be checked | Mark it unverified or blocked. |
| Scope expansion | Work would require release actions, destructive cleanup, or unrelated edits | Stop and request explicit authority. |

## #contract.anti_patterns

- Do not paraphrase or partially load the authored workflow.
- Do not edit the immutable authored subtree.
- Do not trust stale handoff prose over current evidence.
- Do not include secret values, authorization headers, cookies, keys, or `.env` contents.
- Do not treat a successful hook injection as proof that the resulting handoff is factual.

</lit-handoff-mode>
