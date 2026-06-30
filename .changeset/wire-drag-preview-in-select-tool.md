---
"sldeditor": patch
---

Show the dashed wire preview while dragging a wire out of a selected element's terminal in the select tool. The gesture already created the wire on release, but `WirePreview` only renders when `wireDragFrom` is set and the select-tool path never set it — so there was no rubber-band line and users couldn't tell a wire was being created. The select-tool drag now feeds the same drag-origin the wire tool uses (and clears it on end), so the preview line + landing marker show throughout the drag.
