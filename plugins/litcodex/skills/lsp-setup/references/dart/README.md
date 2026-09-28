# Dart — LSP setup

- **Advisory server id:** `dart` — `dart language-server --lsp`
- **Extensions:** `.dart`
- **Install hint:** `Included with the Dart/Flutter SDK`

## Install

The language server ships inside the Dart SDK (and the Flutter SDK, which bundles Dart). There is no separate package to install — just put `dart` (or `flutter`) on PATH.

- **macOS:** `brew install dart` (or install Flutter and use its bundled `dart`)
- **Linux:** install the Dart SDK from your package manager / `https://dart.dev/get-dart`, or install Flutter
- **Windows:** install the Dart SDK or Flutter SDK and add its `bin` to PATH

Confirm it resolves:

```bash
command -v dart
```

## Configure

Advisory only — LitCodex does not auto-resolve or start this server in the current build. Keep this JSON shape only for future/runtime experiments or for a separately configured external LSP client:

```json
{ "lsp": { "dart": { "priority": 100 } } }
```

For current LitCodex, this config is advisory. If an external client consumes it, keep command/extensions explicit; no bundled runtime supplies defaults.

### Initialization options (only if commonly needed)

None commonly required.

## Alternatives

None.

## Troubleshooting
- **PATH:** `dart` must be on PATH; reopen the shell after installing the SDK. Flutter users: ensure `<flutter>/bin/cache/dart-sdk/bin` or the Flutter `bin` is exported.
- **Flutter vs Dart:** if you only have Flutter installed, the bundled `dart` works — make sure Flutter's `bin` is on PATH rather than relying on a separate Dart install.
- **SDK out of date:** run `dart --version` / `flutter upgrade` if analysis behaves oddly on newer language features.

## Verify

LitCodex itself cannot run diagnostics for this server in the current build. Verify with your editor,
project typecheck/tests/linter, or the server's own health command. The bundled `scripts/verify-lsp.ts`
only reports `SKIP` / exit 3 as a degraded-mode probe.
