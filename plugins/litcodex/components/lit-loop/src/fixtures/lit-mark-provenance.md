# Terminal mark provenance

`lit-mark-ignition.json` is the complete selected Ignition B row and per-cell color sheet,
accepted on 2026-09-06. Its exact source SHA-256 is
`e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec`.
The independent literal in `../lit-mark.test.ts` binds the runtime comparison to those bytes.
The renderer carries a product-local encoding of the same sheet; installed code does not read
this test fixture or any external brand directory.

The sheet records 22×10 standard, 44×20 banner, and 16×5 micro envelopes, including spaces.
Its quadrant cells were sampled from authored vector geometry. A cell uses its predominant
non-background color: orange `#FF6337`, lime `#D7F75B`, or ivory `#F2EFDF`. Colorized output
preserves the glyphs exactly; tests compare every cell in both RGB and 256-color modes.

`lit-mark-round6.json`, `lit-mark-round6-sheet.json`, and `lit-mark-round6-generator.mjs`
remain unchanged historical artifacts of the earlier flame/extrusion design. They do not
supply the current mark or its color oracle. Their original bitmap generator and upstream
pins remain available in those historical files.
