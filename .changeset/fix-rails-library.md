---
"sldeditor": patch
---

Circuit diagrams: supply rails, library search and device tags

- Supply rails can be drawn again on circuit diagrams: the busbar tool is back there as the **Rail** tool (hotkey B), with its own icon and hint, and the quick-start card teaches rails instead of busbars. A selected rail is titled "Supply rail", and one click on L1, L2, L3, N, PE, L, +24V or 0V names and colours it together. Wire and place hints say "rail" too. Single-line diagrams are unchanged ("Busbar").
- Library search matches every word in any order ("push button", "contactor coil"), knows the everyday words for symbols ("lamp", "timer", "coil", "E-stop", "MCB", "overload", "terminal", in several languages), ranks name matches first, ignores accents, also matches English names in any UI language, and only lists symbols that belong in the current drawing type.
- Devices placed on a circuit diagram get the next free IEC 81346 tag of their letter code (-Q1, -F2, -KM1, -K1, -KT1, -S3, -H1, -M1, -X2, -T1, -G1…) instead of names like "breaker-3p1". Contacts keep their old naming (their tag is their operator's).
- The hint above the bottom toolbar no longer swallows drags onto pins underneath it.
