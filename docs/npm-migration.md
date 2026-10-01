# Migrating the npm package name

The local candidate changes the external npm name from `litcodex-ai` to
`@litfamily/litcodex`. Its local release candidate is **1.0.14**. The commands below describe the
candidate interface; publication and registry availability have not been
established. Use them only once that exact package is available, or use an
approved local tarball for pre-release testing. No automatic old-package bridge
or registry deprecation is assumed.

## Identities that stay the same

| Surface | Preserved identity |
| --- | --- |
| Executable | `litcodex` |
| Codex marketplace and plugin | `litcodex`, plugin reference `litcodex@litcodex` |
| Codex integration | `~/.codex/` or the configured Codex home |
| Managed marketplace copy | `<Codex home>/marketplaces/litcodex/` |
| Project ledgers and local update state | `.litcodex/` |
| Source workspace | `packages/litcodex-ai/` |
| Bundled private components | Existing `@litcodex/*` identities |

The npm rename does not rename skills, hook routes, ownership records, or model
settings. Native registration is defined by
[marketplace.ts](../packages/litcodex-ai/src/install/marketplace.ts).

## Existing global install

Back up any custom Codex config and agent files before changing an installation.
Both npm names expose the same executable, so do not keep both global packages
installed. Remove the old npm package to release its executable, then install
the new one:

```sh
npm uninstall -g litcodex-ai
npm install -g @litfamily/litcodex@1.0.14
litcodex --version
litcodex --dry-run install
litcodex install --yes --no-auto-update
litcodex doctor --json
```

Run the preview separately and review it before running install. Do not use
`litcodex uninstall` as a migration step: that command removes the Codex plugin
integration. The npm uninstall above removes the old npm package and executable,
leaving the existing Codex registration and project ledgers for the new installer.

For a pinned migration, set `LITCODEX_NO_UPDATE_CHECK=1` in the shell environment
before these commands so later interactive checks cannot advance the selected
version. See [privacy and update controls](privacy.md). Check command lookup if
`litcodex --version` reports an unexpected result; another npm prefix or stale
shell command cache may still select the old executable.

## One-shot or local-tarball install

Use the package explicitly instead of relying on npm to infer the executable:

```sh
npm exec --yes --package @litfamily/litcodex@1.0.14 -- litcodex --dry-run install
npm exec --yes --package @litfamily/litcodex@1.0.14 -- litcodex install --yes --no-auto-update
npm exec --yes --package @litfamily/litcodex@1.0.14 -- litcodex doctor --json
```

For local candidate verification, substitute the approved tarball's absolute path
for `@litfamily/litcodex@1.0.14` in `--package`. Follow the isolated trial below before
any local candidate command; a separate product home alone is insufficient.
A local tarball passing doctor does not prove public npm availability or
authenticated model execution.

## Isolated local trial

Use an already-open POSIX terminal. This trial changes neither your shell's `HOME` nor its existing
Codex profile: each tool receives a clean environment through the helper below. It is a manual
procedure, not a script to paste and run all at once. Keep paths on one line. Stop after any failed
command; do not use `exec`, a wrapping subshell, or an exit-on-failure block that closes the terminal.
The pane-closing report has no confirmed cause yet; these steps expose the failing stage.

**Why the whole home matters.** Config migration checks `CODEX_HOME/config.toml` and project
`.codex/config.toml` files up the current directory's ancestors, including the directory returned by
Node's `os.homedir()` before stopping. If the current directory is outside that home, traversal can
continue to the filesystem root. A trial `CODEX_HOME` under your ordinary home can therefore still
reach its `.codex/config.toml`. `HOME`, project cwd, temporary files, product home, npm config/cache,
and npm prefix must all be inside one disposable tree. Nested tools must preserve that relationship.

### Prepare the paths

First create a short, unique directory:

```sh
mktemp -d /tmp/lc-trial.XXXXXX
```

Copy the path it prints into `TRIAL_CREATED`, then resolve that directory physically before deriving
any home or project path. On macOS `/tmp` is a symlink: the physical result normally starts with
`/private/tmp`. Keeping a logical `/tmp` home while native cwd resolves to `/private/tmp` would break
the ancestor stop condition. These are separate commands; stop if `cd -P` fails.

```sh
TRIAL_CREATED='/tmp/lc-trial.REPLACE_WITH_CREATED_DIRECTORY'
```

```sh
cd -P "$TRIAL_CREATED"
```

```sh
pwd -P
```

Confirm the printed physical path refers to the newly created directory, then bind it:

```sh
TRIAL_ROOT="$PWD"
```

Replace every `/absolute/path/` value below with a real, reviewed path before proceeding.
`TRIAL_BIN_PATH` must contain the installed Node, npm, and Codex
launcher directories plus system utilities; no trial dependency install is needed for these tools.
Check that their launchers do not hard-code another home, personal config, or inherited runtime flags.
Use the supplied candidate archive and its recorded checksum; do not substitute a registry download.

```sh
TRIAL_TARBALL='/absolute/path/to/the-approved-candidate.tgz'
TRIAL_NPM='/absolute/path/to/npm'
TRIAL_CODEX='/absolute/path/to/codex'
TRIAL_BIN_PATH='/absolute/path/to/node-bin:/absolute/path/to/codex-bin:/usr/bin:/bin'
```

Only continue once the directory is the one you just created and all tool/archive paths are correct.
Create the trial layout and two empty npm config files, then change into its project.
If any command fails, stop here.

```sh
mkdir -p "$TRIAL_ROOT/h/project" "$TRIAL_ROOT/h/tmp" "$TRIAL_ROOT/h/.codex" "$TRIAL_ROOT/h/npm-cache" "$TRIAL_ROOT/h/npm-prefix"
```

```sh
touch "$TRIAL_ROOT/h/npm-user.conf" "$TRIAL_ROOT/h/npm-global.conf"
```

```sh
cd "$TRIAL_ROOT/h/project"
```

Define the helper. It resolves the current directory physically before comparing it with the canonical
trial project, and launches only the command you explicitly pass to it. It does not read shell startup
files or copy credentials. The empty npm config inputs avoid personal npm configuration.
The clean environment omits inherited `NODE_OPTIONS`, host-home overrides, npm injection variables,
and automatic-update settings. The two explicit update opt-outs keep the selected candidate fixed.

```sh
trial_run() {
  if ! cd -P .; then
    printf '%s\n' 'Stop: cannot resolve the current directory physically.'
    return 1
  fi
  if [ "$PWD" != "$TRIAL_ROOT/h/project" ]; then
    printf '%s\n' 'Stop: return to the trial project before running this command.'
    return 1
  fi
  env -i HOME="$TRIAL_ROOT/h" CODEX_HOME="$TRIAL_ROOT/h/.codex" \
    TMPDIR="$TRIAL_ROOT/h/tmp" PATH="$TRIAL_BIN_PATH" TERM=xterm-256color \
    LANG=en_US.UTF-8 NPM_CONFIG_USERCONFIG="$TRIAL_ROOT/h/npm-user.conf" \
    NPM_CONFIG_GLOBALCONFIG="$TRIAL_ROOT/h/npm-global.conf" \
    NPM_CONFIG_CACHE="$TRIAL_ROOT/h/npm-cache" NPM_CONFIG_PREFIX="$TRIAL_ROOT/h/npm-prefix" \
    NPM_CONFIG_WORKSPACES=false LITCODEX_NO_UPDATE_CHECK=1 NO_UPDATE_NOTIFIER=1 "$@"
}
```

### Check one stage at a time

Check help first, then print its exit status on the immediately following line. Zero means that
command exited successfully; it is not proof of a working model session.

```sh
trial_run "$TRIAL_NPM" exec --yes --package "$TRIAL_TARBALL" -- litcodex --help
printf 'help exit status: %s\n' "$?"
```

If help succeeds, preview the install and inspect the proposed paths. Every writable path must be
inside your trial tree. Stop on an unexpected path or a nonzero status.

```sh
trial_run "$TRIAL_NPM" exec --yes --package "$TRIAL_TARBALL" -- litcodex --dry-run install
printf 'preview exit status: %s\n' "$?"
```

Install only after reviewing that preview. Retain the output and status.

```sh
trial_run "$TRIAL_NPM" exec --yes --package "$TRIAL_TARBALL" -- litcodex install --no-auto-update
printf 'install exit status: %s\n' "$?"
```

After successful installation, run doctor separately.

```sh
trial_run "$TRIAL_NPM" exec --yes --package "$TRIAL_TARBALL" -- litcodex doctor --no-auto-update
printf 'doctor exit status: %s\n' "$?"
```

Review doctor before launching Codex yourself in the same project:

```sh
trial_run "$TRIAL_CODEX"
```

Authenticate through the host's supported login flow for this disposable profile if needed. Never
copy personal auth files, tokens, or configuration into it. Model access and authenticated execution
are separate from installation. Approve the installed hooks and try the
[first small task](../README.md#make-one-small-thing). Keep the exact archive path/checksum, the last
visible stage, sanitized output, and direct exit status when reporting a failure.

For trial removal, leave the host first and run the candidate's uninstall with the same helper and
project cwd. Review retained-file notices; do not delete files to bypass ownership refusals.

```sh
trial_run "$TRIAL_NPM" exec --yes --package "$TRIAL_TARBALL" -- litcodex uninstall --no-auto-update
printf 'uninstall exit status: %s\n' "$?"
```

To return to your usual profile, use a fresh terminal without the helper and start Codex normally.
This procedure did not replace your ordinary `HOME` or `CODEX_HOME`. Retain trial records until the
feedback is captured; inspect the exact disposable directory before removing it yourself.

## Settings, repeat installs, and removal

Repeat install reuses the native identities and registration probes. Existing
valid agent roles are preserved unless you explicitly choose `--reconfigure`;
unsafe paths or invalid roles can block installation. Symlinked cache roots or
parents and unrecognized existing cache identities block replacement and removal.
Unrelated config settings
remain intact. Review reported skips and failures instead of deleting ownership
state to force installation. See
[agent installation](../packages/litcodex-ai/src/install/agents-install.ts) and
the [usage reference](usage.md#install).

When you actually want to remove LitCodex, run `litcodex uninstall`, then
`npm uninstall -g @litfamily/litcodex` if globally installed. Removal retains
modified, foreign, or symlinked agent roles rather than treating their filenames
as permission to delete them. Retained custom files may need your own review.
Project ledgers are not removed by changing the npm package name.

The managed marketplace directory is generated runtime payload: installation
refreshes that copy and successful marketplace removal deletes it recursively.
Do not store personal files or custom source changes there; back up any such
changes before installing or removing the plugin. Agent-role preservation does
not make that runtime directory a user-data store.

If migration fails, retain the error and sanitized diagnostics. Restore the
previous executable using a trusted saved old-package tarball or an explicitly
chosen old version after removing the conflicting new global package. Review
your config backup before any manual restore; do not overwrite unrelated changes.
