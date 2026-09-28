type RuntimeEnv = Readonly<Record<string, string | undefined>>;
interface LitCodexResolutionDeps {
    readonly fileExists?: (path: string) => boolean;
    readonly platform?: NodeJS.Platform;
}
export declare const SHELL_AWARENESS_DEDUP_KEY = "__litcodex_shell_awareness__";
export declare function isCodexAppServerActive(env?: RuntimeEnv): boolean;
export declare function resolveLitCodexInvocation(env?: RuntimeEnv, deps?: LitCodexResolutionDeps): string | null;
export declare function getShellRuntimeAwareness(env?: RuntimeEnv, deps?: LitCodexResolutionDeps): string;
export {};
