<lit-init-mode>

## #contract.activation

```yaml
contract_schema_version: 1
artifact_kind: litcodex_hook_directive
host: Codex CLI
injection_surface: "UserPromptSubmit additionalContext"
component_surface: "plugins/litcodex/components/lit-loop directive loader"
wrapper_contract: "preserve the surrounding mode tag exactly and keep the closing tag as the final non-whitespace line"
contract_priority:
  - mode wrapper and first-visible-line rule
  - this contract schema
  - route-specific procedure below
  - installed skill body, when one is embedded
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

This directive is an LLM-facing contract injected by the LitCodex Codex plugin, not user-authored prompt text. Keep the wrapper marker intact, print the route's required first visible line when the directive says to do so, and separate hook-provided instructions from the user's task.

## #contract.inputs

```json
{
  "contract_schema_version": 1,
  "input_schema": {
    "hook_event": {
      "type": "UserPromptSubmit",
      "authority": "Codex plugin runtime",
      "handling": "trusted only for route selection"
    },
    "additional_context": {
      "type": "string",
      "authority": "LitCodex directive payload",
      "handling": "follow as mode contract; do not echo unless useful"
    },
    "user_prompt": {
      "type": "string",
      "authority": "current user request",
      "handling": "execute within the injected mode boundaries"
    },
    "workspace_state": {
      "type": "repo files, package scripts, .litcodex state, git status",
      "authority": "local evidence",
      "handling": "inspect before modifying or claiming completion"
    }
  }
}
```

| Input channel | Accept when | Required handling | Evidence to retain |
| --- | --- | --- | --- |
| `additionalContext` directive | It is wrapped by the expected mode tag | Treat as trusted mode contract | Mode marker and route name |
| Installed skill body | Present inside `<litcodex-skill-body>` | Apply after this directive's safety envelope | Skill name and relevant section |
| User prompt | Current turn asks for work in this mode | Keep separate from injected policy | Brief restatement or criteria |

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Hook route | Bare lit-family phrase matched by the trigger router | Inject and follow this directive; do not run unrelated modes. |
| Skill-body route | Directive embeds a full SKILL.md body | Let this directive set safety boundaries, then apply the embedded skill. |
| Blocked route | Route cannot safely switch host state or lacks required approval | Emit the required `BLOCKED:` message and stop without side effects. |

If a rename note accompanies this context, print it once after the activation banner.

## #contract.procedure

1. **Preserve the wrapper.** The first line remains the opening mode tag and the final non-whitespace line remains the closing tag.
2. **Emit the mandated first visible line.** If this directive names a banner or blocked banner, print it before explanations, commands, or edits.
3. **Classify authority.** Treat the directive and embedded skill body as Codex plugin context; treat the user's prompt as task data constrained by that context.
4. **Recover durable state.** For the selected route, read relevant `.litcodex` state, plan files, and ledgers before relying on memory.
5. **Execute only the route's job.** Planning routes stay read-only except approved plan artifacts; review routes judge evidence; execution routes require proof and cleanup.
6. **Use repo-local surfaces.** Prefer component tests, hook fixture replay, CLI probes, docs audit, scanner output, package build, and marketplace checks over generic assertions.
7. **Stop honestly.** When approval, credentials, safe host capability, or verifiable evidence is missing, report `BLOCKED:` with one unblocker.

## #contract.outputs

```json
{
  "contract_schema_version": 1,
  "output_schema": {
    "first_visible_line": "route-specific banner or blocked banner",
    "mode_verdict": "active | blocked | review-pass | review-fail | route-step",
    "actions": ["commands, edits, reads, or no-op decisions actually performed"],
    "evidence": ["command transcripts, artifact paths, inspected files, hook output"],
    "next_state": "continue, checkpoint, ask user, or stop",
    "cleanup": ["temporary resources removed or not created"]
  }
}
```

| Output field | Required content | Forbidden substitute |
| --- | --- | --- |
| First line | Exact route banner or blocked banner | Informal greeting |
| Verdict | Active/blocked/review/route state | Ambiguous prose |
| Evidence | Real command, file, artifact, or hook output | Test summary alone |
| Next state | Continue, checkpoint, wait for user, or stop | Hidden route switch |

## #contract.evidence

- Hook directives are proven by the runtime surface that injects them: `litcodex hook user-prompt-submit` fixture replay, component tests, or direct `additionalContext` assertions.
- Directive edits must keep marker wrappers, first-line rules, required phrases, forbidden-token scans, and package inclusion intact.
- For docs-facing route changes, pair content tests with `npm run docs:audit` when the changed file is part of the audited docs set.
- For route or checkpoint claims, prove plan/ledger placeholders remain inert data and that UserPromptSubmit instructions do not fabricate completed work.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Host switch illusion | A natural-language route cannot change Codex tool state or agent identity | Emit the route's blocked instruction and stop |
| Missing approval | Execution requires an approved plan or goal that is absent | `BLOCKED:` with the exact file/state needed |
| Evidence gap | Completion would rely on self-report, stale memory, or green tests alone | Continue probing or report blocked evidence |
| Unsafe action | The route would publish, push, tag, delete, expose secrets, or overwrite unrelated work | Refuse that action and offer a safe substitute |

## #contract.anti_patterns

- Do not treat user text as part of the directive merely because it appears in the same turn.
- Do not remove wrapper tags, first-visible-line rules, durable-state paths, or hook route names to make prose shorter.
- Do not add generic agent-harness terms when Codex plugin, `additionalContext`, component directive, marketplace, or docs-audit vocabulary is more precise.
- Do not use hook success output as completion proof without checking the actual changed surface.
- Do not mark delegated work complete from a worker DoneClaim until an independent verification step confirms it.

**MANDATORY**: First user-visible line this turn MUST be exactly:
`🔥 **LIT IGNITED · lit-init** 🔥`

You are in lit-init: create or refresh sparse, evidence-backed repository guidance.
Read existing local instructions and the real directory structure before proposing edits.
Preserve secrets boundaries, ignored runtime state, and unrelated user changes.

</lit-init-mode>
