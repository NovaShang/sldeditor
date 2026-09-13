---
'sldeditor': minor
---

Runtime stage 1: `<OneLineViewer>` + data bindings.

A drawing can now carry `tags` (data-point declarations) and `bindings`
(element property ← tag, through a `pass` or `discrete` mapping) inside the
`DiagramFile`, and `<OneLineViewer>` renders it live against a host-provided
`TagSource`. The library still fetches nothing: `TagSource` is two methods the
host implements over whatever it has, and `createStaticTagSource()` is the
in-memory reference for demos, tests and hosts that push their own updates.

**On screen.** `alarm` colours the symbol stroke and the wires leaving it
(`--ole-alarm-warn` / `--ole-alarm-alarm` / `--ole-alarm-fault`; fault blinks,
not under `prefers-reduced-motion`). `value` is a small readout with the tag's
unit, `badge` a pill on the top-right corner, `visible: false` hides the
symbol, `label.text` replaces the label. A `bad` or `stale` sample greys the
element and marks it with `?`. Updates are batched at 100 ms. Selection and
hover are controllable (`selectedIds`, `hoveredId`) and reported
(`onElementClick`, `onElementHover`, `onBackgroundClick`); `onReady` hands out
`fit()` / `focus(id)` / `select(ids)`.

**Not a second renderer.** The viewer mounts the editor's own canvas layers
over a *private*, non-persisted store (`createEditorStore()`, reached by the
layers through `EditorStoreContext`), so several viewers can share a page with
an editor and none of them touches the autosaved document. Live values reach
the layers through a `RuntimeContext` snapshot — the editor never mounts one
and renders exactly as before.

**Pure helpers** for authoring UIs and agents: `resolveBindings`,
`bindingsOf`, `upsertBinding` (same target + prop overwrites),
`removeBindings`. Deleting an element in the editor drops the bindings that
target it; everything else round-trips verbatim, and files without the new
fields load unchanged.

Not in this release, by design: the binding author panel, slots, and the
`linear` / `threshold` / `expr` mappings (unknown mapping types are skipped
with a one-time warning so newer files still open).
