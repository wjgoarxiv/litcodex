# Contributing to LitCodex

LitCodex targets Codex CLI. Start with the [usage reference](docs/usage.md),
[contract](docs/spec/litcodex-contract.md), and repository `AGENTS.md`. Keep changes
inside this repository and preserve unrelated worktree changes.

## Development

Use Node.js 22 or newer and the npm version declared in `package.json`. Run commands
from the Git root containing `packages/litcodex-ai/`, not its parent directory.

```sh
npm ci --ignore-scripts
npm run check
npm run hygiene:git
npm run check:skill-payload-hashes
npm run check:version
npm run pack:all
```

Start with a focused regression test for a behavior change. Explain the trigger,
expected result, and actual result in the pull request. Run broader gates after
focused checks pass. Retain the original failure output and direct exit status;
do not pipe a suite through `tail`.

Builds clean generated output first. Run builds, tests, and package probes serially.
Tracked component `dist/` files must be regenerated with `npm run build`, never
edited by hand. For skill payload changes, use the native payload-hash generator
and include its resulting files. Keep optional scientific dependencies and their
skips visible in the result; a skip is not evidence of that integration working.

## Review expectations

- Keep the change focused; include source, relevant tests, and user-facing docs.
- Exercise changed CLI, hook, or installer behavior through its actual entrypoint.
  Installer probes must use disposable homes, product homes, caches, and temp roots.
- Check the real tarball payload when shipped files change. Preserve native plugin
  IDs, managed-state ownership, runtime dependencies, and the required plugin icon.
- Run the legacy-token scanner after prose changes. Refer to other family products
  generically when their names are incompatible with this repository's scanner.
- Exclude credentials, transcripts, local ledgers, and evidence directories from
  commits. Record cleanup and any unverified behavior in the pull request.

Changing `.gitignore` does not change npm publication exclusions: review
`.npmignore` too. Use JSON pack inventories, not the wrapped terminal listing.
Keep existing release guards intact. Version changes, tags, publication, and
registry changes require separate maintainer approval; routine CI does not publish.

Contributions are provided under the existing [MIT license](LICENSE), whose holder
is LitCodex Authors. Follow the [code of conduct](CODE_OF_CONDUCT.md), use
[support guidance](SUPPORT.md) for questions, and report vulnerabilities through
the [security policy](SECURITY.md).
