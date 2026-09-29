# Motion promo

A 24-second film for the READMEs. It follows one small task through LitCodex: a request that starts with `lit`,
a goal card with four checks, evidence recorded for three of them, a handoff that carries the open check into the next
session, and `litcodex doctor` reporting that all checks passed. The task, its four checks and the layout of the handoff
sheet are examples made for the film. The five-row LIT mark and the banner art come from the product's own mark, and the
strings on screen come from the README and from what LitCodex prints.

Files:

- `promo.mp4`: the master. 1920x1080, 60 fps, 24 s, H.264 with a generated music bed (AAC), about 5.8 MiB.
- `promo-preview.webp`: the inline animated preview shown in the READMEs. 960 px wide, 30 fps, about 2.1 MiB.
- `promo-poster.png` and `promo-still.webp`: the poster (the middle of the film) and the finished last frame. The README
  uses the last frame for readers who prefer reduced motion.
- `source/`: the editable page (`index.html`, with its copy in the `COPY` object) and the plan the film was built from
  (`treatment.json`).

The film was rendered with the LitFamily typographic motion skill, on its stage path: the page in `source/` is captured
frame by frame by the skill's renderer, which checks flash safety, text legibility and determinism before it exports
anything. To render again, run the skill's stage command against a folder that holds the page and the treatment.

Type is set in Archivo (SIL Open Font License, see [Archivo-OFL.txt](./Archivo-OFL.txt)) and MesloLGS NF (Apache License
2.0, see the [notice](../jev/MesloLGS-NF-LICENSE.txt)). Like the other files under `docs/assets/`, these files stay out of the
npm package and the installed plugin.
