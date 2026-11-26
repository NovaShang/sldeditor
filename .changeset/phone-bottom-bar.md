---
'sldeditor': minor
---

Phone-width bottom bar and host-toolbar File menu.

- **The unified bottom bar fits narrow phones.** Below about 480 px the bar was wider than the editor and ran off both edges, so the outline toggle and the View menu could not be reached. It never scrolls; instead, as the editor narrows, the outline toggle and then the Junction tool fold into More, then the buttons narrow, and only then do the labels go. Everything folded stays one tap away in More, and while the folded Junction tool is held, More lights up wearing its icon. New pure helper `denseBarFit` (in `hooks/bottom-bar`) does the arithmetic.
- **`FileMenu` renders correctly in a host toolbar.** The library stylesheet is scoped under `.ole-root`, and a `FileMenu` mounted outside the editor got none of it: its icon fell back to lucide's 24 px default in the page's text colour. It now carries its own `ole-root ole-inline` scope (`display: contents`, so it adds no box).
- **New `useFileActions` / `useFileShortcuts`** for hosts that draw the File menu in their own design system: the same New / Open / Save / Save As actions with labels in the editor's locale, and the ⌘O / ⌘S / ⌘⇧S shortcuts.
