# Repository facts and README assembly

## Fact pass

Inspect the actual repository root and, for a monorepo, the package that users install. Read the governing `AGENTS.md`, existing README(s), `package.json` or equivalent manifest, lockfile, license file, install/build/test scripts, CI workflow, support and contribution documents, and relevant entry points. Use `git status --short` before writing. Don't recursively read unrelated docs or rewrite a working README wholesale when a focused correction is safer.

Fill `templates/readme-facts.json` with one entry per factual claim that will appear in the README. Each claim needs a concise `claim` id, the exact reader-facing `value`, and a repository-relative `source` file. Verify the cited file and the meaning of its content; the validator checks local path safety and existence, not semantic truth. For a source that is missing, ambiguous, or contradictory, omit the claim or mark it `unknown` in your private notes—never replace it with a plausible guess. Resolve version from the package root and current source, not from a badge image or unrelated checkout. Copy license wording from the actual license file/manifest.

Badges are claims too. Inspect the actual badge source (for example, the workflow/status file or maintained project endpoint) and confirm the label, URL, and displayed claim match before inclusion. Record its label, HTTP(S) URL, and local evidence source in the ledger. Before rendering or interpolating any badge URL into a template, require a clean structural-check result and accept only an absolute HTTP(S) URL with no embedded credentials or raw control/whitespace. The helper enforces that URL shape when run; it does not fetch the URL, check its status, or prove that the badge reports the stated fact. Never invent a passing build, coverage percentage, release version, star count, platform matrix, or license badge. Avoid badges that duplicate the title or add no user decision value.

Run this read-only, network-free checker from the authorized project root. Bind its runtime path to the exact selected skill entrypoint; do not assume a marketplace or cache layout:

```bash
README_STUDIO_SKILL_FILE="<absolute path of the SKILL.md selected for this turn>"
README_STUDIO_SKILL_ROOT="$(cd "$(dirname "$README_STUDIO_SKILL_FILE")" && pwd -P)"
README_STUDIO_PROJECT_ROOT="$(pwd -P)"
test -f "$README_STUDIO_SKILL_FILE" || {
  printf '%s\n' 'readme-studio selected SKILL.md does not exist' >&2
  exit 1
}
node "$README_STUDIO_SKILL_ROOT/scripts/validate-readme-facts.mjs" \
  --facts "$README_STUDIO_PROJECT_ROOT/.readme-studio/readme-facts.json" \
  --project-root "$README_STUDIO_PROJECT_ROOT"
```

The JSON result always includes `validation_scope: "structure-only"`, `factual_accuracy: "not-checked"`, `source_contents_compared: false`, and `badge_truth_checked: false`. `valid: true` means only that safe relative paths resolve to regular, non-symlink files, claim ids are unique, values are present, and each badge URL has a safe HTTP(S) shape and a source. It does not prove that a value matches its source, that a source supports the interpretation, or that a badge endpoint is live/correct. Repository fact inspection and actual badge-source checks remain required; re-open each source and compare the exact claim before writing it into the README.

## README order

Prefer a single unmistakable cover, then a compact row of verified badges/logos, a one-sentence purpose, the shortest successful quick start, three to five concrete capabilities or a verified demo, and only then detailed usage/configuration. Add docs, support, contribution, and license destinations only when the fact ledger has a source-reviewed entry and the repository-relative target currently resolves to an existing regular, non-symlink file; omit unknown/absent targets and omit the whole optional-link section when it would be empty. Do not assume conventional paths. Use headings and code blocks that match actual command names and package roots. Explain prerequisites and expected output. Keep Korean and English line breaks intentional; avoid hiding requirements in badges or artwork.

When a README already has strong content, retain its useful anchors and links. Fix claim drift first, then improve hierarchy and navigation. Keep links relative where repository files are the source of truth. For a full visual demo, use the responsive `<picture>` fragment in `templates/readme-cover-section.md`: choose only generated, locally inspected assets; list reduced-motion static posters before animated sources; and keep the static `<img>` poster as the fallback. Include wide/mobile and light/dark media sources only for variants the selected renderer actually produced. Include a normal Markdown link to the MP4 master only when that local file exists and was inspected; never embed autoplay video. Each inline animated preview must meet the 2.5 MiB budget. If optimization cannot meet it, record `INLINE_PREVIEW_SIZE_BLOCKED` and an explicit partial-delivery decision instead of silently dropping the preview or claiming full completion. GitHub README rendering and npm package README display are later presentation gates: a local render does not prove either remote surface preserves `<picture>` media selection or animation.

## Completion record

Record source paths for the facts checked, asset provenance, renderer identity/license, dimensions/fps/duration, image/video/GIF/WebP byte sizes, viewports inspected, repository tests, and cleanup. Separate `SOURCE_READY`, `STATIC_RENDERED`, and `MOTION_RENDERED`; never merge those states into one broad “done” claim.
