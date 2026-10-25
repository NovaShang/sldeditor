---
"sldeditor": minor
---

Time-delay contacts and off-page connectors.

- Four timer contacts from IEC 60617-07-05 under Control: on-delay NO, on-delay NC, off-delay NO, off-delay NC, each with an optional `delay` (s) shown beside the tag.
- Continuation connectors (`continuation-out` / `continuation-in`, QElectroTech's folio-reference arrows). Two continuations with the same name are one conductor: the compiler merges their nodes, so a wire leaving one sheet and arriving on another is connected. The property panel shows the partner and jumps to it.
- The property panel switches a contact between NO, NC and the four delayed forms, and a continuation between outgoing and incoming, in place — id, name, placement and wires are kept (`changeKind` store action, `lib/kind-families.ts`).
- The hover tag showed every symbol's kind in Chinese whatever the UI language; it is localised now.
