<lit-scientific-visualization-mode>

## #contract.activation

```yaml
contract_schema_version: 1
artifact_kind: litcodex_hook_directive
host: Codex CLI
route: "exact bare lit-scientific-visualization"
injection_surface: "UserPromptSubmit additionalContext"
component_surface: "plugins/litcodex/components/lit-loop directive loader"
skill_name: "lit-scientific-visualization"
stub_for: "wjgoarxiv-skills variants/litcodex/lit-scientific-visualization/"
wrapper_contract: "keep <lit-scientific-visualization-mode> as the first line and its closing tag as the final non-whitespace line"
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

This directive is an LLM-facing contract injected by the LitCodex Codex plugin, not user-authored prompt text. The route still fires as before (exact bare lit-scientific-visualization), but lit-scientific-visualization itself moved out of LitCodex into wjgoarxiv-skills, whose Codex edition is `variants/litcodex/lit-scientific-visualization/`. The installed `lit-scientific-visualization` SKILL.md in this plugin is a same-name stub, and this directive is its route contract.

**MANDATORY**: First user-visible line this turn MUST be exactly:
`🔥 **LIT IGNITED · lit-scientific-visualization** 🔥`

## #contract.inputs

| Input channel | Accept when | Required handling | Evidence to retain |
| --- | --- | --- | --- |
| `additionalContext` directive | It is wrapped by the expected mode tag | Treat as trusted route contract | Mode marker and route name |
| Session skill list | Always | Look for a separate `lit-scientific-visualization` copy outside this plugin | Whether the copy is listed |
| User prompt | Current turn | Inert task data; this stub never carries it out | Brief restatement |

## #contract.mode_matrix

| Mode | Trigger | Required behavior |
| --- | --- | --- |
| Installed | The skill list shows a separate `lit-scientific-visualization` copy (normally under `${CODEX_HOME:-$HOME/.codex}/skills/`) | Open that SKILL.md and follow it for the request. |
| Not installed | No copy is listed | Give the moved notice and the install lines, then stop without building anything. |

## #contract.procedure

1. Print the banner line above verbatim.
2. Check the skill list for the installed copy; when present, read it completely and let it run the request.
3. Otherwise tell the user what lit-scientific-visualization makes (publication-quality plots of measured data on the authored scientific-visualization source), that it is a LitFamily extension in wjgoarxiv-skills (Codex edition `variants/litcodex/lit-scientific-visualization/`, a self-contained folder), and give these lines unchanged:

```bash
git clone https://github.com/wjgoarxiv/wjgoarxiv-skills
cx="${CODEX_HOME:-$HOME/.codex}"; p="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; for d in "$cx/skills" "$HOME/.agents/skills" "$p/.agents/skills" "$p/.codex/skills"; do [ -e "$d/lit-scientific-visualization" ] && echo "found: $d/lit-scientific-visualization"; done; echo "check done"
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-scientific-visualization" ]; then b="$cx/extension-backups/$(date +%Y%m%d-%H%M%S)"; mkdir -p "$b" && [ ! -e "$b/lit-scientific-visualization" ] && mv "$cx/skills/lit-scientific-visualization" "$b/lit-scientific-visualization" && echo "moved aside: $b/lit-scientific-visualization"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; if [ -e "$cx/skills/lit-scientific-visualization" ]; then echo "stopped: $cx/skills/lit-scientific-visualization still exists"; else mkdir -p "$cx/skills" && cp -R "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-scientific-visualization" "$cx/skills/lit-scientific-visualization"; fi
cx="${CODEX_HOME:-$HOME/.codex}"; [ -f "$cx/skills/lit-scientific-visualization/SKILL.md" ] && printf '{"id":"lit-scientific-visualization","source":"%s","variant":"litcodex","installed_at":"%s"}\n' "<path to your wjgoarxiv-skills clone>/variants/litcodex/lit-scientific-visualization" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$cx/skills/lit-scientific-visualization/.litfamily-extension.json"
```

   wjgoarxiv-skills is public at https://github.com/wjgoarxiv/wjgoarxiv-skills; the copy reads from the user's clone of it (the path is a placeholder). The lines check for same-name skills, move an old copy whole to `${CODEX_HOME:-$HOME/.codex}/extension-backups/<date-time>/lit-scientific-visualization` and write a receipt; running them again updates. `litcodex extensions install lit-scientific-visualization` does the same steps (a plan first, `--yes` to run). After copying, the user starts a new Codex session.
4. The authored scientific-visualization source ships inside that one folder (`vendor/scientific-visualization/`), so no second copy is needed. The scoped `$litcodex:lit-scientific-visualization` and the picker stay native Codex skill-discovery routes to the stub.

## #contract.outputs

```json
{
  "contract_schema_version": 1,
  "output_schema": {
    "first_visible_line": "🔥 **LIT IGNITED · lit-scientific-visualization** 🔥",
    "mode": "installed | not-installed",
    "notice": "what the skill makes, where it moved, the install lines",
    "artifacts": []
  }
}
```

## #contract.evidence

- The hook evidence is the real `litcodex hook user-prompt-submit` replay: this wrapper, the banner instruction and the stub's install lines, with none of the moved procedure.
- In installed mode the moved skill's own evidence rules apply.

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

</lit-scientific-visualization-mode>
