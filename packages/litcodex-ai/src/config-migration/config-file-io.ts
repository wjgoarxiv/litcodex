import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CodexConfigMigrationError } from "./errors.js";

export async function readConfigFile(configPath: string): Promise<string> {
	try {
		return await readFile(configPath, "utf8");
	} catch (error) {
		if (isErrnoCode(error, "ENOENT")) {
			return "";
		}
		throw new CodexConfigMigrationError("CONFIG_UNWRITABLE", "Could not read the Codex config file.", configPath, {
			errno: errnoOf(error),
		});
	}
}

export async function configPathExists(configPath: string): Promise<boolean> {
	try {
		await readFile(configPath);
		return true;
	} catch (error) {
		if (error instanceof Error) {
			return !isErrnoCode(error, "ENOENT");
		}
		throw error;
	}
}

export async function writeConfigFile(
	configPath: string,
	config: string,
	fs: AtomicWriteFs = NODE_ATOMIC_FS,
): Promise<void> {
	return writeConfigFileWith(configPath, config, fs);
}

export interface AtomicWriteFs {
	readonly mkdir: typeof mkdir;
	readonly writeFile: typeof writeFile;
	readonly rename: typeof rename;
	readonly rm: typeof rm;
}

const NODE_ATOMIC_FS: AtomicWriteFs = { mkdir, writeFile, rename, rm };

export async function writeConfigFileWith(configPath: string, config: string, fs: AtomicWriteFs): Promise<void> {
	const temporaryPath = `${configPath}.litcodex-tmp.${process.pid}.${Date.now()}`;
	try {
		await fs.mkdir(dirname(configPath), { recursive: true });
		await fs.writeFile(temporaryPath, `${config.trimEnd()}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
		await fs.rename(temporaryPath, configPath);
	} catch (error) {
		try {
			await fs.rm(temporaryPath, { force: true });
		} catch (cleanupError) {
			if (!(cleanupError instanceof Error)) throw cleanupError;
		}
		throw new CodexConfigMigrationError("CONFIG_UNWRITABLE", "Could not write the Codex config file.", configPath, {
			errno: errnoOf(error),
			temporaryPath,
		});
	}
}

function isErrnoCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

function errnoOf(error: unknown): string | null {
	if (error instanceof Error && "code" in error) {
		return typeof error.code === "string" ? error.code : null;
	}
	return null;
}
