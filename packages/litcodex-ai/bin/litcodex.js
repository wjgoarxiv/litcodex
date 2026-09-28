#!/usr/bin/env node
// Authored ESM entry for the `litcodex` bin (A3 D1: self-contained CLI).
//
// This file owns the shebang and process.exit. It imports the compiled,
// self-contained dispatcher from ../dist/cli.js and runs it. It performs NO
// forwarding and spawns NO child process — all routing lives in the dispatcher.

import { runCli } from "../dist/cli.js";

const exitCode = await runCli(process.argv.slice(2));

process.exit(exitCode);
