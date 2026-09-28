import { type BigIntStats } from "node:fs";
export interface StableReadFileSystem {
    readonly noFollowFlag: number;
    readonly nonBlockFlag: number;
    lstat(path: string): BigIntStats;
    open(path: string, flags: number): number;
    fstat(descriptor: number): BigIntStats;
    read(descriptor: number, buffer: Buffer, offset: number, length: number, position: number): number;
    close(descriptor: number): void;
}
export declare const NODE_STABLE_READ_FS: StableReadFileSystem;
export interface StableDirectorySnapshot {
    readonly path: string;
    readonly stat: BigIntStats;
}
export declare function readStableRegularUtf8(path: string, maxBytes: number, fs?: StableReadFileSystem, expectedDirectories?: readonly StableDirectorySnapshot[]): string | undefined;
export declare function snapshotStableDirectoryChain(path: string, fs?: StableReadFileSystem, root?: string): readonly StableDirectorySnapshot[] | undefined;
export declare function sameDirectoryIdentity(left: BigIntStats, right: BigIntStats): boolean;
