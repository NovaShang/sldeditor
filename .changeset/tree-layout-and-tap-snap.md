---
"sldeditor": minor
---

Top-down tree layout for bus-less diagrams + forgiving wire-tap snap

**Bus-less auto-layout.** Radial / tree circuits (a source → chain → branches at junctions, with no busbar) previously fell into a weak seed-and-grid fallback that crammed everything into a thin horizontal strip with mixed rotations. They now get a proper **top-down tidy-tree** layout: the source at the top, flow descending, branches spreading horizontally at each junction, and devices rotated so the upstream terminal faces up. Junctions are positioned as the hub of their net (the tree branches *at* the junction). Bus-structured diagrams are unaffected — the tree pass only runs for connected components with no bus and no explicit placement, and its placements are frozen against the bus cleanup sweeps.

**Wire-tap snap.** Dropping a wire near an existing wire now snaps onto it and taps in a junction within a forgiving screen-space tolerance (not just an exact hit), making the "tap a line" gesture reliable at any zoom.
