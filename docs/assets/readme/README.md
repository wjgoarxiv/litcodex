# README media and credits

The outlined ASCII image presents the same banner and `LIT · codex` lockup as the
copyable code block on the media pages ([English](../../media.md), [한국어](../../media-Ko-KR.md)).
It needs no installed font. The original characters remain available in each page's expandable section. Its outlined
JetBrains Mono glyphs retain the upstream [SIL Open Font License](./JetBrainsMono-OFL.txt).

The Ignition poster, 10-second MP4 and animated GIF are documentation artwork.
Use the [poster](./ignition-poster.png), [film](./ignition-film.mp4) or
[animation](./ignition-readme.gif). These files and the other assets in this
directory are excluded from npm and installed marketplace payloads.

The local badges describe the `1.0.51` candidate and the product's
[MIT license](../../../LICENSE). They are static Shields-style images, with dark
lettering on the orange candidate field and lime license field. They do not
report registry availability or CI results.

The `book-open`, `play` and `shield-check` icons come from
[Lucide at commit 2bfb9bb1bae5d74f6a9f81640ddd8bccc2c71860](https://github.com/lucide-icons/lucide/tree/2bfb9bb1bae5d74f6a9f81640ddd8bccc2c71860).
Their strokes use the Ignition lime color. The complete upstream
[ISC and applicable Feather MIT notices](./Lucide-LICENSE.txt) are retained.
Only these three icons are used and distributed here.

The landing pages lead with the motion cover at `../cover-motion.webp`
(SHA-256 `41293053c9439afc4ad0893d205b618d0b061bb6dcf586fd9e4cc1c7fc28adba`,
1,140,562 bytes). It is a looping 960x640 animated WebP of about 8 seconds,
made with the LitFamily motion skill: a terminal in the sunset look with the LitCodex
hud card, a pixel LITFAMILY wordmark and a striped half-sunk sun. When reduced motion is
preferred, the READMEs show `../cover-motion-still.webp`
(SHA-256 `2ff3779e87ed757af30e79a47523c7d1661de79bac702f6d65d4fd391f000d0f`,
63,902 bytes), its first frame. The package README loads identical
copies from the published package's `readme-assets/` directory. The cover is
documentation artwork, not a registry-availability claim.

The static seven-machine armory WebP at `../cover.webp`
(SHA-256 `90099f77838a47c26ebd52fdec8c25a67071345a6c3b2bcbe7324d35d7ebb086`)
and the editable `../cover.svg` remain in the repository but are no longer
shown on the landing pages.

The `diagrams/` and `schematic/` folders hold the explainer pictures on the landing READMEs: what
the installer writes, the route a `lit` prompt takes, the core and the extensions, and the same
route drawn as a process plant. Each comes in a light and a dark copy per language, and the plant
also has a moving dark copy. They stay in the repository and are not packed into npm.
