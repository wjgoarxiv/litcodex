export declare const GROUND_QUERY = "\u001B]11;?\u001B\\";
/** A terminal that draws 24-bit colour; Windows Terminal says so by its own name alone. */
export declare function drawsTruecolor(env: NodeJS.ProcessEnv): boolean;
export interface GroundReader {
    /** The typed keys in these bytes, and what an answer that ended in them said (the last one, null for none). */
    push(text: string): {
        readonly keys: string;
        readonly light: boolean | null;
    };
}
export declare function createGroundReader(): GroundReader;
