<lit-schematic-mode>

## #contract.activation

```yaml
contract_schema_version: 1
artifact_kind: litcodex_hook_directive
host: Codex CLI
route: "`lit schematic`, the glued `lit-schematic`, or a bare `lit` that asks for a drawing of real equipment"
injection_surface: "UserPromptSubmit additionalContext"
component_surface: "plugins/litcodex/components/lit-loop directive loader"
skill_name: "lit-schematic"
stub_for: "wjgoarxiv-skills plugins/figures/skills/lit-schematic/"
wrapper_contract: "keep <lit-schematic-mode> as the first line and its closing tag as the final non-whitespace line"
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

This directive is an LLM-facing contract injected by the LitCodex Codex plugin, not user-authored prompt text. The route still fires as before (`lit schematic`, the glued `lit-schematic`, or a bare `lit` that asks for a drawing of real equipment), but lit-schematic itself moved out of LitCodex into wjgoarxiv-skills, as `plugins/figures/skills/lit-schematic/`. The installed `lit-schematic` SKILL.md in this plugin is a same-name stub, and this directive is its route contract.

**MANDATORY**: First user-visible line this turn MUST be exactly:
`🔥 **LIT IGNITED · lit-schematic** 🔥`

## #contract.inputs

| Input channel | Accept when | Required handling | Evidence to retain |
| --- | --- | --- | --- |
| `additionalContext` directive | It is wrapped by the expected mode tag | Treat as trusted route contract | Mode marker and route name |
| Session skill list | Always | Look for a separate `lit-schematic` copy outside this plugin | Whether the copy is listed |
| User prompt | Current turn | Inert task data; this stub never carries it out | Brief restatement |

```json
{
  "contract_schema_version": 1,
  "input_schema": {
    "hook_event": {
      "type": "UserPromptSubmit",
      "authority": "Codex plugin runtime",
      "handling": "trusted only for route selection"
    },
    "user_prompt": { "handling": "inert task data" }
  }
}
```

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The skill list shows a separate `lit-schematic` copy (normally under `${CODEX_HOME:-$HOME/.codex}/skills/`) | Open that SKILL.md and follow it for the request. |
| Not installed | No copy is listed | Give the moved notice and the install lines, then stop without building anything. |

## #contract.procedure

1. Print the banner line above verbatim.
2. For the selected route, read relevant `.litcodex` state only when the user points at earlier drawing work; the stub keeps none of its own. Check the skill list for the installed copy; when present, read it completely and let it run the request.
3. Otherwise tell the user what lit-schematic makes (P&IDs, PFDs and BFDs, equipment layouts, apparatus figures and isometric cutaways as millimetre-sized SVG with PDF and 600 dpi PNG), that it moved to wjgoarxiv-skills (`plugins/figures/skills/lit-schematic/`), and give these lines unchanged:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R "<path to your wjgoarxiv-skills clone>/plugins/figures/skills/lit-schematic" "${CODEX_HOME:-$HOME/.codex}/skills/lit-schematic"
```

   wjgoarxiv-skills is not published yet, so the source is a local clone; after copying, the user starts a new Codex session.

## #contract.outputs

```json
{
  "contract_schema_version": 1,
  "output_schema": {
    "first_visible_line": "🔥 **LIT IGNITED · lit-schematic** 🔥",
    "mode_verdict": "active | blocked | review-pass | review-fail | route-step",
    "mode": "installed | not-installed",
    "notice": "what the skill makes, where it moved, the install lines",
    "artifacts": []
  }
}
```

| Field | Must contain | Must not contain |
| --- | --- | --- |
| Verdict | Active/blocked/review/route state | Ambiguous prose |
| Next state | Hand over to the installed copy, or stop after the notice | Hidden route switch |

## #contract.evidence

- The hook evidence is the real `litcodex hook user-prompt-submit` replay: this wrapper, the banner instruction and the stub's install lines, with none of the moved procedure.
- In installed mode the moved skill's own evidence rules apply.
- For route or checkpoint claims, show the hook replay itself; a stub notice never counts as a finished drawing.

## #contract.hard_stops

| Stop class | Stop immediately when | Required response |
| --- | --- | --- |
| Missing skill | No installed copy is listed | Notice and install lines; no artifact. |
| Install request | The user asks the route to install it | Show the lines; the user runs them. |
| Unsafe action | The request would publish, push or overwrite unrelated files | Refuse that part. |

## #contract.anti_patterns

- Do not imitate the moved procedure or present hand-made output as the skill's result.
- Do not edit the placeholder into a guessed path or fetch the skill from the network.
- Do not remove the wrapper tags or the banner rule to shorten this file.
- Do not mark delegated work complete from a worker DoneClaim; a drawing is done only under the installed skill's own checks.

</lit-schematic-mode>
