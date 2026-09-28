# Kotlin — LSP setup

- **Advisory server id:** `kotlin-ls` — `kotlin-lsp`
- **Extensions:** `.kt .kts`
- **Install hint:** `https://github.com/Kotlin/kotlin-lsp`

## Install

The official **JetBrains Kotlin LSP** is pre-release. Download a build from the [Kotlin/kotlin-lsp](https://github.com/Kotlin/kotlin-lsp) releases and put the `kotlin-lsp` launcher on PATH.

- **macOS:** Download the release archive, extract, then symlink the launcher: `ln -s /path/to/kotlin-lsp/kotlin-lsp.sh /usr/local/bin/kotlin-lsp`
- **Linux:** Same as macOS — extract the release and place/symlink `kotlin-lsp` on PATH.
- **Windows:** Extract the release and add the directory containing `kotlin-lsp.bat` to PATH (invoke as `kotlin-lsp`).

Requires a **JDK** on the machine to run the server.

Confirm it resolves:

```bash
command -v kotlin-lsp
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "kotlin-ls": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. If `kotlin-lsp` cannot find a Java runtime, set `JAVA_HOME`:

```json
{ "lsp": { "kotlin-ls": { "env": { "JAVA_HOME": "/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home" } } } }
```

The server resolves classpath from Gradle/Maven; keep the build descriptor importable.

## Alternatives

- **`fwcd/kotlin-language-server`** — older community server (not in the advisory default table). Still usable but less actively maintained than the official JetBrains one.

## Troubleshooting

- **PATH:** `kotlin-lsp` on PATH; reopen shell after install.
- **Pre-release churn:** the JetBrains server is early; pin a known-good release and expect occasional breakage.
- **No JDK:** server fails to start — install a JDK and/or set `JAVA_HOME`.
- **Slow first import:** Gradle resolution on first open can be slow on large projects; let it complete.
- **`.kts` scripts:** build/script files resolve more slowly than `.kt` sources; this is expected.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
