# C# — LSP setup

- **Advisory server id:** `csharp` — `csharp-ls`
- **Extensions:** `.cs`
- **Install hint:** `dotnet tool install -g csharp-ls`

## Install

Requires the **.NET SDK**. Install the tool globally:

- **macOS:** `dotnet tool install -g csharp-ls`
- **Linux:** `dotnet tool install -g csharp-ls`
- **Windows:** `dotnet tool install -g csharp-ls`

Global .NET tools land in `~/.dotnet/tools` — ensure that directory is on PATH (Windows: `%USERPROFILE%\.dotnet\tools`).

Confirm it resolves:

```bash
command -v csharp-ls
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "csharp": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required. `csharp-ls` picks up the nearest `.sln` or `.csproj`; keep the solution restorable (`dotnet restore`).

## Razor / Blazor

Razor and Blazor files use a separate advisory server entry:

- **Advisory server id:** `razor` — `roslyn-language-server --stdio`
- **Extensions:** `.razor .cshtml`
- **Install hint:** `dotnet tool install -g roslyn-language-server --prerelease` (requires **v5.8.0+**; see [dotnet/razor](https://github.com/dotnet/razor))

```bash
dotnet tool install -g roslyn-language-server --prerelease
command -v roslyn-language-server
```

Enable it in a project/user config:

```json
{ "lsp": { "razor": { } } }
```

## Alternatives

- **OmniSharp** — legacy C# language server (not in the advisory default table). Still works but is being superseded by the Roslyn-based servers; prefer `csharp-ls` / `roslyn-language-server`.

## Troubleshooting

- **PATH:** `csharp-ls` / `roslyn-language-server` on PATH (`~/.dotnet/tools`); reopen shell after install.
- **No .NET SDK:** install the SDK (not just the runtime) before installing the tool.
- **No symbols:** run `dotnet restore`; an unrestored solution yields empty results.
- **Razor needs v5.8.0+:** older `roslyn-language-server` builds lack the `--stdio` Razor support — install with `--prerelease`.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
