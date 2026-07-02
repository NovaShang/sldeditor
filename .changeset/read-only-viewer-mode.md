---
"sldeditor": minor
---

Add a `readOnly` prop to `<OneLineEditor>` for a view-only share/viewer mode. All pan/zoom/touch gestures (wheel, trackpad, pinch, multi-touch, space+drag) and fit-to-content on load are preserved, while every editing interaction and all editing chrome (tool/property panels, contextual + library popovers, onboarding, right-click / long-press menu, keyboard shortcuts) are disabled. The passed `diagram` always wins over any persisted document in this mode, and a read-only instance never writes to storage — so mounting a viewer can't clobber the editor's autosaved work.
