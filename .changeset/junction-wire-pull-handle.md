---
"sldeditor": minor
---

Pull a wire out of a junction in the select tool. A solo-selected junction now shows a small wire-pull handle offset from its dot; dragging the handle starts a wire from the junction (resolving to a connectable, a wire-tap, or empty space → a new junction, with the live preview), while dragging the dot itself still moves the junction. This closes the last gap in the unified gesture model: a junction is now a full peer of a device terminal as a select-tool wire source, without overloading its move gesture.
