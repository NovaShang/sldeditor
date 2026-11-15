---
"sldeditor": minor
---

Drop a symbol on a wire to put it in line, and branch straight out of a rail.

- **Drop on wire = insert.** Placing a symbol (place tool click, palette drag-and-drop) or dragging a loose, unconnected device onto a straight run of wire cuts the wire and connects the symbol in series, turned to lie along the run. A multi-pole device dropped across parallel phase conductors at its pole pitch goes into each of them. The ghost lights up the conductor(s) that will be cut and marks the cut points. Both halves keep the wire's label and colour; a hand-drawn route keeps its shape. Works on single-line and circuit diagrams.
- **Delete heals (circuit diagrams).** Deleting a device that sits in series closes each conductor back up through its poles, in the same undo step.
- **Branch from a rail (circuit diagrams).** In the select tool, pressing an unselected rail and dragging pulls a wire out of it, with the tap where you pressed; a click still selects the rail, and a selected rail drags as before.
- **Hang from a rail (circuit diagrams).** A symbol placed below a rail (within reach, nothing in between) gets its top pin wired to the rail; a multi-pole device under L1/L2/L3 taps one phase per pole. The ghost previews the taps.
- `connectWire` takes an optional route for the new wire.
