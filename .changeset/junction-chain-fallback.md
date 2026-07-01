---
"sldeditor": patch
---

Fix positionless junctions collapsing when wired to other junctions. The fallback that positions a junction without explicit coordinates only counted device/bus neighbours, so a chain of coordinate-less junctions (e.g. collection-junction → main-junction) landed on top of each other or at the origin. Junction→junction wires now contribute, and the fallback is solved iteratively so device/bus anchors propagate along the chain — junctions spread to sensible positions instead of collapsing.
