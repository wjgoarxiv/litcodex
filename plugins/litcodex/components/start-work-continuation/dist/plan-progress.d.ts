export interface PlanProgress {
    readonly remaining: number;
    readonly total: number;
    readonly nextTaskLabel: string | null;
    readonly progressToken: string;
    readonly todoTotal: number;
    readonly finalVerificationTotal: number;
    readonly invalidContractRowTotal: number;
    readonly contractValid: boolean;
}
export declare function analyzePlanProgress(markdown: string): PlanProgress;
