---
"sldeditor": patch
---

Placing and wiring multi-pole devices, and a few snapping fixes:

- Placing a device from a pin of a multi-pole device now connects the matching pole (breaker 2 → contactor 1, 4 → 3, 6 → 5) instead of whichever pole sat nearest the cursor, lines the new device up so the conductor runs straight, and wires every matching pole pair in one step (one undo). Works from any outgoing pin, by tap or drag; the ghost previews every conductor. Single-pole chaining is unchanged.
- A multi-pole device placed by clicking (or dropped from the library) just below or above another one snaps sideways — by up to one pole — so the poles line up, instead of landing one pole off.
- Releasing a wire a few pixels off a pin, junction or bus now connects to it rather than creating a loose junction next to it. Releasing in open space still drops a junction.
- Tapping a junction at the end of a horizontal run places the device hanging downward (and continues a vertical run straight on) instead of standing it on its head.
- Fit view no longer zooms past 200% on a tiny drawing, and keeps the drawing clear of the bottom toolbar row and its hint.
