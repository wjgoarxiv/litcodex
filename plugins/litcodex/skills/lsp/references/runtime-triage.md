# Language-Server Runtime Triage

Use this reference when a user expects symbol navigation, diagnostics, rename, hover, or workspace search
from LitCodex. It distinguishes three different systems that are often called “LSP support”:

1. a language-server executable installed on the machine;
2. a client that starts the server and speaks the protocol;
3. a Codex-visible tool or hook that exposes the result to the current session.

Having only the first item does not make the feature operational. An editor can also have all three for
itself while Codex has none.

## Establish the capability boundary

Check the repository and current installation before prescribing setup:

```sh
rg -n '"mcpServers"|"languageServer"|"lsp"' .codex plugins package.json 2>/dev/null
find plugins/litcodex/components/lsp -maxdepth 3 -type f -print 2>/dev/null
```

Then classify the request:

| User need | Required capability | Honest fallback |
| --- | --- | --- |
| compile or type errors | compiler or type checker | run the project’s checked command |
| lint findings | linter | run the project’s configured linter |
| go to definition | initialized language-server client | `rg`, import tracing, compiler metadata |
| find references | indexed workspace client | scoped text search plus call-site review |
| symbol rename | server rename edit with workspace application | inventory references, edit deliberately, compile and test |
| hover or type display | server hover response | compiler/type-checker reveal mechanism |
| live post-edit diagnostics | hook connected to a client | explicit check after the edit |

Never describe a fallback as equivalent to a protocol result. Text search can find lexical references but
cannot prove symbol identity. A clean compile can reject invalid code but cannot prove every editor
diagnostic is absent.

## Current LitCodex probe

From the plugin source tree, the component’s public routes provide the authoritative product boundary:

```sh
node plugins/litcodex/components/lsp/dist/cli.js hook post-tool-use
node plugins/litcodex/components/lsp/dist/cli.js hook post-compact
node plugins/litcodex/components/lsp/dist/cli.js mcp
```

Use fixture-shaped input when the component documentation requires it. Record command, exit code, stdout,
and stderr. An intentional no-output hook proves only that the placeholder accepted the event. It does not
prove a server ran. A non-zero unavailable response from the `mcp` route is expected degraded-mode
evidence in the current build.

## External server diagnosis

When the user has separately configured a client, diagnose it in protocol order.

### 1. Executable and version

Confirm the resolved binary, not merely the package-manager record:

```sh
command -v <server>
<server> --version
```

If a wrapper script resolves, inspect which runtime and package it actually launches. Version skew between
an editor extension, global executable, project toolchain, and lockfile is a common cause of contradictory
results.

### 2. Root selection

Determine the workspace root and the project marker the server expects. Monorepos frequently need one
server per package or a root URI above several packages. A server started at the wrong root can initialize
successfully while returning empty symbols and incomplete diagnostics.

Capture:

- canonical root path;
- target document URI;
- project/config file selected;
- workspace folders sent by the client;
- whether generated, vendored, and build directories are excluded.

### 3. Initialization

The client must send `initialize`, receive capabilities, then send `initialized`. Do not assume support for
rename, workspace symbols, semantic tokens, or pull diagnostics. Read the returned capability object.

If logs are available, verify request identifiers and response errors. A response for another document
version is stale evidence.

### 4. Document lifecycle

For file-scoped features, verify that the client opened the document with the correct language id and
version. After an edit, the client must send a matching change notification before requesting diagnostics
or navigation. Save-only servers may require a write to disk.

Check newline and position encodings when edits land in the wrong column. UTF-16 positions are common;
byte offsets and Unicode scalar counts are not interchangeable.

### 5. Result interpretation

An empty result may mean:

- the server returned a valid empty set;
- the document was never opened;
- indexing is incomplete;
- the root is wrong;
- the requested feature is unsupported;
- the request was cancelled or timed out;
- the response is stale;
- the client filtered the result.

Distinguish these with logs and capability data. Do not turn “empty” into “no problems” without that
discrimination.

## Safe rename fallback

Without an operational rename provider, use a reversible manual sequence:

1. identify the declaration and export boundary;
2. search exact and transformed spellings;
3. classify code, strings, configuration, generated files, and public documentation separately;
4. capture compiler, typecheck, lint, and test baselines;
5. edit one ownership region at a time;
6. rerun the narrow check after each region;
7. run the full relevant suite and the user-visible scenario;
8. inspect the diff for accidental text replacements.

Never run an unrestricted replacement across a repository based only on a spelling match.

## Evidence record

For each claim, retain:

```text
Need:
Capability expected:
Client surface:
Executable and version:
Workspace root:
Document URI and version:
Request:
Raw result or error:
Fallback command:
What this proves:
What remains unproven:
Cleanup:
```

Remove scratch protocol logs if they contain source text, environment values, or absolute private paths.
Confirm no background server, port, temp directory, or edited client configuration remains unless the
user asked to keep it.
