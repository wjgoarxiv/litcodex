# Support

Read the [usage reference](docs/usage.md) and [npm migration guide](docs/npm-migration.md)
before reporting an installation problem. Use this repository's issue tracker for
reproducible bugs and feature requests. Support is best effort; no response time
or commercial support commitment is implied.

For an installed command, collect:

```sh
litcodex --version
litcodex doctor --json
```

For project loop state, also run `litcodex loop doctor`. Doctor JSON avoids the
interactive update-check path. A healthy doctor result verifies local integration;
it does not prove model authentication, entitlement, or successful model work.

Include the OS, Node.js and Codex CLI versions, install method, exact command,
direct exit status, expected behavior, and a minimal reproduction. State whether
the failure occurs on fresh install, repeat install, migration, or removal. Keep
optional dependency failures separate from the core installer result.

Review diagnostics before posting: redact tokens, account details, private paths,
prompts, and repository contents. Do not attach whole config or transcript folders.
Use the [security policy](SECURITY.md) for vulnerabilities and the
[privacy guide](docs/privacy.md) to understand local and network activity.
