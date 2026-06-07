---
'sldeditor': minor
---

Auto-layout: fix overlapping / sprawling layouts in complex diagrams.

- Multiple sources/transformers feeding one bus no longer stack on the same column (co-tier feeds are spread laterally).
- Same-tier independent buses are packed tightly to their actual extent instead of sprawling to fixed wide spans.
- Parallel-branch tap slots now size to their subtree width, so a CT feeding a load + earthing switch no longer collides with adjacent taps.
- Bus-less / sparse diagrams (e.g. a PV string → inverter chain) lay out as vertical chains instead of dumping into a fallback grid.
- Verified zero symbol overlaps across the repro + clean diagram set; 90/90 tests pass.

i18n: added English names, descriptions, and param/state labels for all 41 library symbols introduced in v0.3 (resistor, relays, power-electronics, instruments, PLC/UPS, …). They previously fell back to their Chinese names in English mode.
