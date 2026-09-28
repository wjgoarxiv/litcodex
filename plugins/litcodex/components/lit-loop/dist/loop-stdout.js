// src/loop-stdout.ts — M09/T14 `loop create` stdout contract (A3 C14). M20 imports this const.
//
// The single owner of the exact `loop create` stdout block: 4 lines, trailing `\n`. Exported as a
// named const so M20 (path-robustness) imports it rather than hardcoding the literal. Split out of
// loop-cli so both loop-cli (the dispatcher) and loop-handlers (the create handler) can import it
// without an import cycle.
/** The exact `loop create` stdout block (A3 C14): 4 lines, trailing `\n`. */
export const LOOP_CREATE_STDOUT = (goalCount, paths) => `lit-loop plan created: ${goalCount} goal(s)\n` +
    `brief: ${paths.briefPath}\n` +
    `goals: ${paths.goalsPath}\n` +
    `ledger: ${paths.ledgerPath}\n`;
