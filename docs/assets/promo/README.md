# Motion promo

A 23-second film for the READMEs, in an English and a Korean version. It follows one small task through LitCodex. A
request starts with `lit` and becomes a goal with four checks. Three checks turn green once evidence is recorded, and
one stays open. A handoff sheet carries the open check into the next session, where it turns green and grows into the
closing emblem, and `litcodex doctor` reports that all checks passed. The task, its four checks and the layout of the
handoff sheet are examples made for the film. The five-row LIT mark comes from the product's own mark, and the strings
on screen come from the README and from what LitCodex prints.

Files:

- `promo.mp4` and `promo-ko.mp4`: the masters. 1920x1080, 60 fps, 23.4 s, H.264 with a generated music bed (AAC),
  about 6.3 MiB each.
- `promo-preview.webp` and `promo-ko-preview.webp`: the inline animated previews shown in the READMEs. 960x540, 30 fps,
  about 1.8 MiB and 1.6 MiB. The last 0.6 s dissolves into the first frame so the loop has no hard seam.
- `promo-poster.png` and `promo-still.webp` (and the `promo-ko-` pair): the poster (the handoff beat) and the finished
  last frame. The README uses the last frame for readers who prefer reduced motion.
- `source/`: the editable pages (`index.html` for English and `index-ko.html` for Korean, each with its copy in the
  `COPY_SET` object) and the plans the films were built from (`treatment.json`, `treatment-ko.json`).

The films were rendered with the LitFamily typographic motion skill, on its stage path: the page in `source/` is
captured frame by frame by the skill's renderer, which checks flash safety, text legibility and determinism before it
exports anything. To render again, copy a page to `stage/index.html` inside a folder that holds the matching treatment,
and run the skill's stage command against that folder.

Type is set in Pretendard Regular and Bold (SIL Open Font License, see [Pretendard-OFL.txt](./Pretendard-OFL.txt)),
and the terminal text inside the drawn pane and its tags in MesloLGS NF (Apache License 2.0, see the
[notice](../jev/MesloLGS-NF-LICENSE.txt)). Like the other files under `docs/assets/`, these files stay out of the npm
package and the installed plugin.
