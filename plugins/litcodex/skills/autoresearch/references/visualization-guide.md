# Optional autoresearch visualization

Picker guidance hands approved writes to native `start-work` and `lit-loop`. Plots remain
`REVIEW_REQUIRED` and cannot programmatically claim family completion. Changed evaluator or budget
requires re-planning and review.

Resolve `<loaded-autoresearch-skill-dir>/scripts/style_presets.py --check`. The preflight must actually
`import matplotlib`; discovery alone is insufficient. On
`BLOCKED_OPTIONAL_MATPLOTLIB_UNAVAILABLE`, omit plots and do not modify the environment.

The preflight only proves matplotlib imports; it applies nothing. Every figure script must also
`import rcparams` from that same `scripts/style_presets.py` and call `rcparams()` **before**
`plt.subplots()` or `plt.figure()`. Matplotlib reads its rcParams when the figure is constructed, so
a call placed after that point silently does nothing and the shipped contract — `savefig.dpi` 600,
`legend.framealpha` 1, `legend.edgecolor` black, the Okabe-Ito `axes.prop_cycle`, white facecolor,
inward ticks — never reaches the output.

For figure work beyond these run plots — journal sizing, multi-panel layout, export formats — use the
`lit-scientific-visualization` skill rather than re-deriving its rules here.

When available, show baseline, executed work points, kept/reverted/inconclusive labels, uncertainty,
best-so-far, and target. Use accessible colors, visible units/endpoints, nonoverlapping labels, and a
nonobscuring legend. Never hide failures or imply causality beyond receipts. Writes stay under the
approved root and reject unsafe parents/leaves.
