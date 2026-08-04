---
"sldeditor": minor
---

Make element and wire **label type size adjustable per document**, and rebuild the label control so the current mode is actually legible.

This comes from a real user: "My problem is that the names are too small when printed on an A4". They worked around it by dropping floating text annotations on top of their diagram purely to get bigger type — rational, because free annotations shipped a 5–32px size picker while element labels were hardcoded at 7 in three separate places with no runtime control at all.

- New optional `DiagramMeta.labelFontSize` (canvas units). Absent → 7, so every existing diagram renders byte-identically; values are clamped to 5–32 by every renderer. Setting it back to 7 removes the field rather than storing it.
- Threaded through **all three** renderers — canvas, SVG/PNG export and DXF export — so what you see is what you export. Line stacking, the wire-label offset and the baseline nudge all scale with it (exact at the default), so multi-line labels don't collide at larger sizes. The halo stroke deliberately does not scale.
- `ExportOptions` / `DxfExportOptions` gain `labelFontSize`. **Embedding apps must pass `meta.labelFontSize` into their own export calls**, or exports will render at 7 while the canvas shows the user's size.
- The label control in the view toolbar was a single unlabeled icon that cycled off → id → all, with the current state visible only on hover. It is now a small panel with a segmented Off / ID / ID + params control plus a size stepper, so the active mode is readable at a glance.
