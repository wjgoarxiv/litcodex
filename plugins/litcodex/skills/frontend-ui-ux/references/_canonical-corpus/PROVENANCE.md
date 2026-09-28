# Canonical frontend reference corpus

This directory is an immutable, byte-preserving reference library. It is not an executable skill,
hook, command, agent, or dependency. LitCodex routes into it only after the concise
`frontend-ui-ux` picker skill identifies a relevant design question. The Python files under
`ui-ux-db/scripts/` are reference source and must remain inert: do not import, execute, or modify
them as part of skill selection.

- Source commit: `8ec16c5129df7b9778959e8367657d0e79c2c3bb`
- Source references tree: `9188410be0af35f2421ba300d91a0d7a7341caf0`
- Canonical content files: 167
- Canonical content bytes: 2,596,349
- Aggregate SHA-256: `f6959eeae02685102df9fbedafb2c437be4d51df8e102f9fcf32298f7674e7d7`
- Aggregate format: SHA-256 of sorted lines `<file-sha256><two spaces><relative-path><LF>`.

`MANIFEST.json` records every canonical content path, byte size, and SHA-256, plus exact legal-file
hashes. `scripts/verify-canonical-corpus.mjs` rejects missing, extra, changed, symbolic-link,
special, unreadable, malformed-manifest, and legal mismatch states. The repository scanner may
protect only manifest-listed exact-hash files after that complete verification succeeds. A copy at
another path, any changed byte, or any carrier field remains subject to ordinary scanning.

The three legal files are byte-for-byte copies from the pinned source. Their text names the original
projects, licenses, notices, and modifications. Do not rewrite or normalize them. Git attributes
disable text conversion for this directory so mixed line endings remain unchanged.
