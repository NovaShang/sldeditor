---
"sldeditor": patch
---

Auto-remove junctions left orphaned by a delete. When deleting a wire (or an element/node whose removal drops wires), any junction that was an endpoint of a removed wire and now has no remaining connection is deleted in the same step. Junctions that still have another wire, and standalone junctions the user placed deliberately, are kept. This stops bus-less diagrams from accumulating dangling connection dots after edits.
