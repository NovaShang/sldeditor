---
'sldeditor': minor
---

Recolour a whole selection from the contextual toolbar.

Colour has been on the model since 0.21 — elements, buses, wires and every
annotation carry a `DiagramColor`, and the exporters resolve it for SVG, PNG
and DXF — but the only way to set it was one object at a time. The palette
that `COLOR_ORDER` was written for never got built.

The floating selection toolbar now carries the six swatches, and one click
paints everything currently picked: elements, buses, the selected wire and any
annotations caught in the same marquee, all in a single undo entry. Junctions
are skipped because they carry no colour of their own.

Two details worth knowing:

- `Default` **removes** the colour rather than storing the word, so a diagram
  nobody has coloured still serialises exactly as it did before colours
  existed — which the SVG and DXF writers depend on.
- Picking the colour something already is, or recolouring a junction-only
  selection, pushes no undo entry. A history step that changes nothing visible
  means the next Ctrl+Z appears to do nothing.

The swatch dots wear the same `ole-ink-*` classes the canvas uses, so they show
the real ink in both themes instead of a hard-coded hex that would disagree
with one of them.
