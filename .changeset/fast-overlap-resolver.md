---
"sldeditor": patch
---

Auto-layout: the symbol-overlap resolver no longer takes tens of seconds to minutes on large auto-placed drawings (~100+ devices). It now caches symbol boxes and pair splits, rescans only the pairs a shift can have changed, and fast-forwards branches that ping-pong until the pass cap, arriving at exactly the same shifts as before. Layouts are unchanged.
