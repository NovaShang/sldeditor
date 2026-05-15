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
| `className` | `string?` | Defaults to `h-full w-full`. The root div always has `ole-root` regardless. |
| `diagram` | `DiagramFile?` | Initial state. **Only seeded if the store is empty** — preserves in-progress work across remounts. Use the store directly to force-replace. |
| `locale` | `'en' \| 'zh'?` | Force UI language. Falls back to localStorage / `navigator.language`. |
| `theme` | `'light' \| 'dark'?` | Force color mode. Falls back to localStorage / `prefers-color-scheme`. Applied via the `dark` class on `<html>`. |

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
- Library types: `LibraryEntry`, `LibraryLabelAnchor`, `LibraryParamField`, `LibrarySource`, `LibraryStateField`, `LibraryStretchable`, `LibraryTerminal`

See [data-model.md](./data-model.md) for the full schema.
