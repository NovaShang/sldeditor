---
"sldeditor": minor
---

Auto-layout now treats explicit placements as authoritative: the overlap-resolution and repack passes (6b/6c/6d) never move user/AI-provided element positions or rewrite explicit bus geometry, and overlap shifts move by the actual overlap amount instead of the colliding pair's union width (which compounded into huge displacements on dense layouts).
