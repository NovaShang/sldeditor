---
"sldeditor": patch
---

Fixes from SmartSLD production sessions and the W26 expert review:

- Note fields in the properties panel now autosave while typing (debounced ~350ms) and flush on blur/unmount, so a note can no longer be lost by clicking away or closing the panel. Enter still inserts a newline.
- Element name labels are rotation/mirror-aware: at rot 180 the label sits beside the symbol instead of striking through it, and at rot 90/270 it centers below/above the symbol. Applied consistently to the canvas, SVG/PNG export, and DXF export.
- Breaker terminal pin digits ("1"/"2") no longer clutter diagrams and exports: they are hidden during normal viewing (fixing the garbled look of rot-90 bus-tie breakers) and excluded from SVG/PNG/DXF exports entirely, appearing only while the wire/place tool is active or the breaker is selected.
