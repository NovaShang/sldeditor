# API reference

Everything exported from `sldeditor`. The canonical source is [`src/index.ts`](../src/index.ts); this page groups the exports by what you'd reach for.

---

## `<OneLineEditor>`

The full editor surface. Renders the canvas, palettes, toolbars, panels, and registers keyboard shortcuts.

```tsx
import { OneLineEditor, type OneLineEditorProps } from 'sldeditor';

<OneLineEditor
  className="h-screen w-screen"
  diagram={initialDiagram}
  locale="en"
  theme="dark"
/>
```

### Props (`OneLineEditorProps` / alias `SldEditorProps`)

| Prop | Type | Notes |
|---|---|---|
| `className` | `string?` | The root div always has `ole-root` and fills its container (`width: 100%; height: 100%` at zero specificity, so your own class or inline style wins). |
| `diagram` | `DiagramFile?` | Initial state. **Only seeded if the store is empty** — preserves in-progress work across remounts. Use the store directly to force-replace. |
| `locale` | `'en' \| 'zh'?` | Force UI language. Falls back to localStorage / `navigator.language`. |
| `theme` | `'light' \| 'dark'?` | Force color mode. Falls back to localStorage / `prefers-color-scheme`. Applied via the `dark` class on `<html>`. |

---

## `<OneLineViewer>` — read-only runtime viewer

The editor's canvas without the editing: same layers, same `compile()`, driven by a **private** store (several viewers may share a page with an editor and none of them touch its persisted document). Pan (drag / middle button / space) and zoom (wheel / pinch) work; tools, shortcuts, toolbars, context menu and the grid are absent.

```tsx
import { OneLineViewer, createStaticTagSource, type TagSource } from 'sldeditor';
import 'sldeditor/style.css';

const tags = createStaticTagSource({ 'QF1/health': 'critical', 'QF1/I': 128.4 });

<OneLineViewer
  diagram={diagram}          // a DiagramFile carrying `bindings`
  tags={tags}                // any TagSource — omit for a static drawing
  selectedIds={selected}     // controlled selection (optional)
  onElementClick={(id) => setSelected([id])}
  onBackgroundClick={() => setSelected([])}
  onReady={(api) => (viewer.current = api)}
/>
```

### Props (`OneLineViewerProps`)

| Prop | Type | Notes |
|---|---|---|
| `diagram` | `DiagramFile` | Required. Re-renders (and refits) when the reference changes. |
| `tags` | `TagSource?` | Live data. Bindings resolve against `tags.get()`; the viewer subscribes once to every path the bindings mention and re-resolves at most every 100 ms. |
| `selectedIds` | `string[]?` | Controlled selection. Omit to let `api.select()` drive it. |
| `hoveredId` | `string \| null?` | Controlled hover highlight. `undefined` = follow the pointer. |
| `onElementClick` | `(id, ev) => void` | Click on a device, bus, junction or a device's label. |
| `onElementHover` | `(id \| null) => void` | Pointer entered / left an element. |
| `onBackgroundClick` | `() => void` | Click on empty canvas. |
| `theme` | `'light' \| 'dark'?` | Sets `dark` on the viewer's **own** root, never on `<html>`. Omit to follow a `.dark` ancestor. |
| `className`, `style` | | The root always has `ole-root ole-viewer` and fills its container (`width: 100%; height: 100%` at zero specificity) — give the parent a height, or override with your own class / `style`. |
| `fit` | `boolean?` | Fit the diagram on mount, on diagram change and on resize. Default `true`. |
| `onReady` | `(api: OneLineViewerApi) => void` | Called once per mount. |

### `OneLineViewerApi`

`fit()` refits the whole diagram; `focus(id)` centres and zooms to an element / bus / junction; `select(ids)` replaces the selection (no-op while `selectedIds` is controlled).

### What a binding looks like on screen

All colours are CSS custom properties read with a fallback (`var(--ole-alarm-warn, …)`), so a host sets `--ole-alarm-warn` / `--ole-alarm-alarm` / `--ole-alarm-fault` / `--ole-selection` on any ancestor — its wrapper, `:root`, the viewer's own `style` — and the value is honoured. The defaults live on `.ole-root` as `--ole-alarm-*-default` and are never what you override.

| Prop | Rendering |
|---|---|
| `alarm` | `none` no change; `warn` → `--ole-alarm-warn` (`#faad14`); `alarm` → `--ole-alarm-alarm` (`#fa8c16`); `fault` → `--ole-alarm-fault` (`#f5222d`) and blinks (not under `prefers-reduced-motion`). Colours the symbol stroke **and** the wires leaving it. |
| `value` | Small readout at the symbol's bottom-right, with the `unit` of the tag declared in `diagram.tags`. |
| `badge` | Pill on the symbol's top-right corner; takes the alarm colour when the element is alarmed. |
| `visible` | `false` hides the symbol and its label (wires stay). |
| `label.text` | Replaces the structural label block. |
| quality `bad` / `stale` | Symbol greyed + a `?` marker on its top-left corner. `bad` samples are not applied; `stale` ones are (last known value). |
| selection / hover | `--ole-selection` (falls back to the theme's `--selection`) dashed box; hover recolours the symbol. |

## Data binding: `TagSource`, `resolveBindings`, `upsertBinding`, …

The library never fetches data. A host implements `TagSource` (two methods) over whatever it has — WebSocket, MQTT, polling REST — and the viewer does the rest.

```ts
interface TagSource {
  get(path: string): TagValue | undefined;
  subscribe(paths: string[], onChange: (changes: Record<string, TagValue>) => void): () => void;
}
interface TagValue { v: unknown; q?: 'good' | 'bad' | 'stale'; t?: number }
```

- `createStaticTagSource(initial?)` — in-memory reference implementation with `set(path, value)` / `setMany(values)`; values may be bare primitives or full `TagValue`s (`toTagValue` normalises).
- `resolveBindings(diagram, tags)` → `Record<targetId, ResolvedElementProps>` — pure; what the viewer computes on every update. `quality` is the worst of the target's bound tags, or `'unbound'` when none has a value.
- `bindingsOf(diagram, target)` — the target's bindings.
- `upsertBinding(diagram, binding)` — add, or replace the one on the same `target` + `prop`. Returns a new file.
- `removeBindings(diagram, target, prop?)` — drop one prop's binding or all of the target's. Returns a new file (the same object when nothing matched).

The editor keeps `tags` / `bindings` verbatim and removes a binding only when its target element is deleted.

---

## Diagram store: `useEditorStore`

The single source of truth for the editor. Built on [zustand](https://github.com/pmndrs/zustand) — selector, subscribe, and shallow comparison all work as usual.

```ts
import { useEditorStore, type EditorState } from 'sldeditor';

function Wired() {
  const diagram = useEditorStore((s) => s.diagram);
  return <pre>{JSON.stringify(diagram, null, 2)}</pre>;
}

// Imperative access (e.g. inside event handlers, AI tool callbacks)
useEditorStore.getState().setDiagram(nextDiagram);
useEditorStore.subscribe((s) => console.log('diagram changed:', s.diagram));
```

`EditorState` includes the diagram, selection, viewport, undo stack, and the action creators that mutate them. Inspect [`src/store`](../src/store) for the full shape.

---

## Compiler: `compile()`

Turn a `DiagramFile` into an `InternalModel` with resolved placement geometry, terminal positions, and connectivity nodes. Use it when you want to **render** a diagram without the editor (a read-only viewer, an alternative renderer, an analyzer) or **inspect topology** (e.g. find islands).

```ts
import { compile } from 'sldeditor';

const model = compile(diagram);
// model.busses, model.elements, model.wires, model.nodes, model.diagnostics
```

Related exports:

- `LIBRARY` — full element registry (symbol metadata, terminals, params, sources)
- `getLibraryEntry(libraryId)` — look up one entry
- `emptyInternalModel` — sensible empty state
- `resolvePlacement`, `transformPoint`, `transformOrientation`, `orientationVec` — geometry helpers used inside `compile`, exposed for renderers that need the same transforms

Types: `BusGeometry`, `ConnectivityNode`, `Diagnostic`, `InternalModel`, `ResolvedBus`, `ResolvedElement`, `ResolvedPlacement`, `TerminalGeometry`, `WireRender`.

---

## ID allocation: `newBusId`, `newElementId`, `wireIdFromEnds`

For embedders that mint diagram entities programmatically (importers, AI tool-calls):

```ts
import { newBusId, newElementId, wireIdFromEnds } from 'sldeditor';

const id = newElementId(diagram);   // unique within `diagram.elements`
const busId = newBusId(diagram);
const wireId = wireIdFromEnds(endA, endB); // deterministic content-hash
```

`wireIdFromEnds` is stable: the same endpoint pair always produces the same id, so re-running an importer won't create duplicate wires.

---

## Theme: `applyTheme`, `getInitialTheme`

The `theme` prop on `<OneLineEditor>` covers the common path. Use these for **pre-mount** theming (avoid the flash) or to drive theme from outside the React tree:

```ts
import { applyTheme, getInitialTheme, type Theme } from 'sldeditor';

applyTheme(getInitialTheme()); // call as early as possible
```

`applyTheme` adds/removes the `dark` class on `<html>` and writes localStorage.

---

## i18n: `useLocale`

```ts
import { useLocale, type Locale } from 'sldeditor';

const locale = useLocale((s) => s.locale);
useLocale.getState().setLocale('zh');
```

Use this to sync your host app's language picker with the editor.

---

## Bundled toolbar widgets

If the bundled toolbar gives you what you need, you can skip them — they're already rendered inside `<OneLineEditor>`. But if you're building a custom toolbar (or want the file/export UI inside a different chrome), they're available as standalone components:

- `FileMenu` — new / open / save / save-as / recent files (operates on the editor store + browser file APIs)
- `ExportMenu` — SVG / PNG / DXF export

---

## Export primitives

For consumers building their own export UI (e.g. cloud apps with custom file-naming, batch export, cloud upload):

```ts
import {
  buildExportSvg,   // (diagram) => string
  downloadSvg,      // (diagram, filename?) => void
  downloadPng,      // (diagram, filename?, { scale? }) => void
  buildExportDxf,   // (diagram, options?) => string
  downloadDxf,      // (diagram, filename?, options?) => void
  type DxfExportOptions,
} from 'sldeditor';
```

---

## Viewport helpers: `fitToContent`, `fitToContentSoon`

After a big programmatic edit (loaded a new diagram, ran an importer), call `fitToContentSoon()` to reset the viewport. The `Soon` variant waits a few RAF ticks for the new DOM to attach before measuring.

```ts
import { fitToContentSoon } from 'sldeditor';

useEditorStore.getState().setDiagram(newDiagram);
fitToContentSoon();
```

---

## Data-model types

Re-exported from [`src/model`](../src/model) for typed embedders:

- `DiagramFile`, `DiagramMeta`, `DiagramVersion`
- `Bus`, `BusId`, `BusLayout`
- `Element`, `ElementId`
- `Wire`, `WireId`, `WireEnd`
- `Placement`, `Orientation`, `NodeId`
- `TerminalRef`, `PinName`, `ParamValue`
- Runtime: `Tag`, `TagType`, `TagValue`, `TagQuality`, `TagPrimitive`, `Binding`, `BindableProp`, `Mapping`, `AlarmLevel`, `ResolvedElementProps`
- Library types: `LibraryEntry`, `LibraryLabelAnchor`, `LibraryParamField`, `LibrarySource`, `LibraryStateField`, `LibraryStretchable`, `LibraryTerminal`

See [data-model.md](./data-model.md) for the full schema.
