---
"sldeditor": patch
---

Typing names no longer loses text or triggers shortcuts:

- A name or value typed in the property panel is kept when you click the canvas to finish (it used to be thrown away), and is saved to the element you were editing even when the click selects another one.
- Selecting another element no longer shows the previous element's half-typed text in its Name box (the "KM1↵KM1" carry-over).
- The Name field and the on-canvas name editor (double-click a device): Enter finishes, Shift+Enter starts a second line, Escape cancels, clicking anywhere else saves. Clicking inside the on-canvas editor moves the caret instead of closing it.
- Thin symbols such as contacts are easier to hit: every device is at least 24 px wide to the pointer at normal zoom, so a double-click to rename no longer misses and sends the typed name to the M / R / Backspace shortcuts. Symbols look exactly the same.
- Single-key shortcuts stay inert while any text field or on-canvas editor is in use, including during IME composition.
- Esc returns from the hand (pan) tool to the select tool.
