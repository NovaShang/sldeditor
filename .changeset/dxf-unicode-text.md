---
"sldeditor": patch
---

DXF export: labels in any language now open correctly in AutoCAD. Non-ASCII characters (Cyrillic, accented letters, Δ, Chinese) are written as `\U+XXXX` escapes under a declared code page instead of raw UTF-8, which R12 readers decoded as mojibake.
