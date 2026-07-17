---
"sldeditor": patch
---

Fix the tool tooltip colliding with the mode-hint bar. Hovering a tool showed its tooltip in the same band as the persistent hint bar above the toolbar, so the two translucent panels overlapped and the tooltip looked covered. The hint now fades out while the pointer is over the toolbar (its layout space is preserved so the bar doesn't jump) — you see the hint at rest and the tooltip on hover.
