---
'sldeditor': minor
---

Free drawing gets colour, an ellipse tool, and real line styles.

Free annotations were the escape hatch users reached for whenever the
electrical model couldn't express what they needed — and the hatch was
monochrome, rectangle-only and hairline-thin. This makes it a first-class way
to draw.

- **Ellipse / circle tool** (`O`). Anchored by a bounding box like a rect, so
  it inherits the same drag-to-draw gesture, 8 resize grips and marquee
  behaviour; Shift constrains to a circle.
- **Named ink palette** — `red`, `blue`, `green`, `amber`, `gray` — on
  elements, buses, wires and every annotation kind. Names rather than free hex
  because the canvas has a dark theme: each name resolves to a value that
  reads correctly in both, and to an ACI index in DXF. Exposed as
  `NAMED_COLORS` / `COLOR_ORDER` / `inkClass` / `exportInk` / `dxfColor` for
  embedding apps that want to offer the same six colours.
- **Stroke styles and weights** — `dotted` joins `solid`/`dashed`, and shapes
  take `strokeWidth` 1/2/3.
- **Wire labels take their wire's ink**; element labels deliberately do not.
  A device tag (QF1, 630 A) is identity and stays neutral, which is what
  electrical CAD does — the conductors carry the colour, not the tags. A wire
  label is a phase designation, and phase colour-coding is the canonical
  reason to colour a conductor at all, so a black `L1` beside a brown
  conductor reads as a mistake.

Colour reaches element symbols without touching any of the 91 element-library
files: the stylesheet already rewrote their literal black to `currentColor`,
so the canvas needed one `color` declaration, and the SVG exporter performs
the identical substitution on the markup it inlines.

Every new field is optional, and `default` resolves to exactly what the
renderers emitted before: a diagram with no colour fields produces
byte-identical SVG and DXF, verified by diffing both against the previous
release.

Note for DXF: an ellipse is written as a closed `POLYLINE`, not an `ELLIPSE`
entity — `ELLIPSE` arrived in R13 and this writer declares `AC1009` (R12),
the same version mismatch that once made every exported file unreadable.
