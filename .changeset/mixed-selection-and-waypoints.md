---
"sldeditor": minor
---

Marquee selection now includes annotations, group moves carry them, and a group move finally translates manual wire waypoints.

Users draw cabinets: a dashed rectangle around a section, a title, a few notes. Selecting that region and moving it did not work — the marquee collected devices, buses and junctions but never annotations, so the frame and its labels stayed behind while the equipment moved.

- **Marquee picks up annotations.** Shift-marquee toggles them like anything else, and an annotation caught in a selection is highlighted.
- **Group moves translate annotations**, in the same dispatch as the rest, so a whole gesture is still one undo entry. Grabbing a selected annotation now drags the entire selection rather than collapsing it to that one object.
- **Manual wire waypoints translate with a group move — but only when BOTH endpoints are moving.** This fixes a bug that predates the selection work: `compile` rebases only a path's first and last points to live terminal positions and passes the interior verbatim, so moving two connected devices left every bend pinned at its old absolute coordinate. A wire routed out to x=400 to dodge something kept that detour while the devices slid past it, and because the path is re-normalised to stay orthogonal the result looked like a plausible-but-wrong route rather than an obviously broken one. Moving only one end still leaves the waypoints alone, which is correct — there the user is repositioning a device and the route should re-adapt. The rule lives in the drag commit, not the compiler, because only the drag knows whether a move was a group translate or a single reposition.

**Breaking:** `EditorState.selectedAnnotation: AnnotationId | null` becomes `selectedAnnotations: AnnotationId[]`. Single-annotation affordances (resize grips, the annotation inspector, click-again-to-edit) now key off the exported `soleSelectedAnnotation(state)` selector, which resolves to null unless that annotation is the entire selection.

Also: the multi-selection readout said "N elements selected" and now says "N objects selected" in all 11 languages, since the set can hold annotations.
