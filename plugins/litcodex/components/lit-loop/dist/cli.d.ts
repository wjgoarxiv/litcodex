#!/usr/bin/env node
/**
 * Dispatch one argv vector to a route and resolve its exit code. Pure of process.exit; writes only
 * to the injected streams.
 */
export declare function main(argv: readonly string[], stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): Promise<number>;
