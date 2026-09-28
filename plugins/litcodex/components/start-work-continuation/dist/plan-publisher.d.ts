import { type PlanProgress } from "./plan-progress.js";
export type PublishedPlan = {
    readonly path: string;
    readonly progress: PlanProgress;
};
export declare class PlanPublisherError extends Error {
    readonly code: string;
    readonly name = "PlanPublisherError";
    constructor(code: string, message: string);
}
export declare function publishPlan(cwd: string, slug: string, markdown: string): PublishedPlan;
