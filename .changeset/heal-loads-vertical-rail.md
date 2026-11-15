---
'sldeditor': patch
---

Circuit diagrams: deleting a device only closes the conductor back up when the device sat in line (contacts, push-buttons, switches, fuses, breakers, overload elements, terminals; new `series` library flag). Deleting a lamp, coil, motor or other load now leaves the rung open instead of drawing a wire straight from the supply to the return, and a switch between two different named potentials (rail L and rail N, conductors L1 and L2) is never healed into a short.

A branch pulled out of a vertical rail now leaves it sideways from the pressed point, so the tap stays where you pressed, and the drag preview shows the same route the release stores.
