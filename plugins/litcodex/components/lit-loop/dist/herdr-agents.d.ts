export interface HerdrAgent {
    readonly agent: string;
    readonly status: string;
    readonly pane: string | null;
    readonly workspace: string | null;
    readonly cwd: string | null;
    readonly foregroundCwd: string | null;
    readonly session: string | null;
}
export interface HerdrAgents {
    readonly state: "off" | "ok" | "unknown";
    readonly agents: readonly HerdrAgent[];
}
/** Runs `herdr agent list` and returns its stdout, or null when it fails. Injectable for tests. */
export type HerdrRunner = () => string | null;
export declare const runHerdr: HerdrRunner;
/** The agents herdr reports; `off` unless `HERDR_ENV=1`, `unknown` when the list cannot be read. */
export declare function readHerdrAgents(env: NodeJS.ProcessEnv, run?: HerdrRunner): HerdrAgents;
