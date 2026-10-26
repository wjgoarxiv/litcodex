/**
 * True when a bare-`lit` prompt asks for a drawing of real equipment: a strong noun, or a weak noun with a
 * drawing or making verb and no web container, and none of the exclusions: a chart of data, an interface
 * deliverable, or a Word or deck deliverable with no drawing verb. Code spans and fences are ignored.
 */
export declare function classifySchematicRequest(prompt: string): boolean;
