# README decoration patterns

Use these patterns as visual references for an authorized full-README pass. They are observations, not project facts, endorsements, copy, or assets to reuse. Adapt the layout to evidence from the target repository. Decoration never fabricates status: retain only repository-backed facts and verified endpoints.

## Inspection record

Pages below were inspected on 2026-09-20. Approximate star counts were visible on the repository pages at that time; they are transient selection context only and must never be copied into a generated README or treated as current facts.

| Public repository and observed stars | README page inspected | Observed structure |
| --- | --- | --- |
| [oven-sh/bun](https://github.com/oven-sh/bun) — about 96.0k | [README](https://github.com/oven-sh/bun/blob/main/README.md?plain=1) | Centered logo/title and a compact badge row sit above centered documentation/community/issue links; a short Quick Links list gives readers a direct path into the long page. |
| [vitejs/vite](https://github.com/vitejs/vite) — about 82.9k | [README](https://github.com/vitejs/vite/blob/main/README.md?plain=1) | A theme-aware logo, npm/Node/CI/community badges, emoji-led feature bullets, a compact package/version table, and direct documentation/contribution/license links establish hierarchy. |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) — about 124.2k | [README](https://github.com/shadcn-ui/ui/blob/main/README.md?plain=1) | A brief title and summary lead into a large hero image; documentation, contribution, and license destinations are easy to find without a dense badge wall. |
| [ant-design/ant-design](https://github.com/ant-design/ant-design) — about 99.5k | [README](https://github.com/ant-design/ant-design/blob/master/README.md?plain=1) | A centered logo/title and badge rows precede language/report links. Emoji mark sections such as sponsors, development, and contributing; a table arranges sponsor marks as a logo grid. |
| [huggingface/transformers](https://github.com/huggingface/transformers) — about 166.4k | [README](https://github.com/huggingface/transformers/blob/main/README.md?plain=1) | A theme-aware logo and badge/language row precede content. `<details>` blocks hold long code examples and model lists, while a curated project page serves as a linked showcase. |
| [assimp/assimp](https://github.com/assimp/assimp) — about 13.2k | [README](https://github.com/assimp/assimp/blob/master/Readme.md?plain=1) | Contributor/OpenCollective links, an external star-history chart, activity graphics, and third-party badges show the richer end of remote embeds; each remote dependency needs a verified endpoint and a readable link fallback. |

The observations above describe what those pages contained during inspection. Do not copy their wording, logos, artwork, or badge values. Recheck a source page before using it as a current design reference.

## Pattern guidance

- **Centered hero block.** A logo or cover, project name, one precise purpose sentence, and a small action row can create a clear first screen. Keep the name and purpose in ordinary text; omit unavailable images or destinations instead of leaving broken placeholders.
- **Badge and logo row composition.** Place a short row below the hero rather than scattering badges through the document. Include a badge only when its claim is relevant, its source is inspected, its destination is a verified endpoint, and its alt text explains the mark. Prefer a text link when a remote image fails or the host does not show it.
- **Emoji-led section headings and section iconography.** A single familiar emoji can help scan a heading or mark a compact callout. Keep the heading text meaningful on its own; emoji are decoration and never indicate a pass, release, security state, or other status.
- **Collapsible `<details>` sections.** Use a descriptive `<summary>` for optional examples, long model lists, or secondary implementation notes. Keep installation, limitations, core facts, and primary navigation outside the collapse. Test the rendered host or provide a normal link when details behavior is uncertain.
- **Contributors, star-history, and showcase embeds.** These are optional. Before an embed, verify that the endpoint resolves, points to the correct repository, and shows the claimed subject; then inspect it in the target README host. A link to the verified contributor page, history chart, or curated showcase is the plain-text fallback. Omit the item when either the endpoint or destination cannot be checked. Never imply popularity or endorsement from a decorative graphic.
- **Table-based feature grids.** A small Markdown table can align a feature name with a short, source-backed behavior and an optional repository path. Use a short bullet list when descriptions wrap heavily or the table becomes hard to read on a narrow screen. The table changes layout, not the evidence standard.
- **Footer navigation.** End with a compact group of useful destinations that exist in the repository or have verified project endpoints. Confirm each relative path resolves to an existing regular file; omit customary paths that are absent.

## npm and host fallback

The [npm package README documentation](https://docs.npmjs.com/about-package-readme-files/) says that the package README must be at the package root, npm renders it as GitHub Flavored Markdown through GitHub's API, and the displayed README updates when a new package version is published. A local preview does not verify GitHub or npm rendering, and the documentation does not promise the behavior of each HTML block, remote image, animation, or external embed. Keep the project name, purpose, quick start, and essential navigation usable as ordinary Markdown. Treat HTML alignment, collapsible details, responsive pictures, badge images, and embeds as host-dependent until inspected on that host; provide a direct text/link fallback and report a rendering gap without implying a hosted result.

## Fact and endpoint rule

Before adding decoration to a generated README, compare every factual label with its cited source in the repository and verify each retained endpoint. Do not invent badges, version/status claims, contributor counts, star counts, showcase membership, logos, or conventional navigation paths. If the source or endpoint is absent, unknown, unreachable, or points somewhere else, remove the decoration or replace it with a verified plain-text link. A structure checker can validate URL shape and local paths; it cannot certify claim truth or endpoint state.
