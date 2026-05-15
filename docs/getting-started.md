# Getting started

Install, mount the editor, save your first diagram. Everything in this guide is React 18+ on the web — no backend, no build-time codegen.

## Install

```bash
npm install sldeditor
# or: pnpm add sldeditor / yarn add sldeditor
```

Peer dependencies: `react >= 18` and `react-dom >= 18`. Tested against React 19 too.

## Minimal example

```tsx
import { OneLineEditor } from 'sldeditor';
import 'sldeditor/style.css';

export default function App() {
  return (
    <div style={{ height: '100vh' }}>
      <OneLineEditor />
    </div>
  );
}
```

That's it. The editor mounts a full canvas with toolbars and panels. State (current diagram, viewport, undo stack) persists to `localStorage` automatically, so a page refresh doesn't lose work.

### Why the explicit `style.css` import?

The library ships a single bundled stylesheet at `sldeditor/style.css`. We don't auto-inject it from JS because:

1. Bundlers can't tree-shake CSS that's imported via side-effect inside vendor JS.
2. SSR (Next.js etc.) gives you the choice of where styles load.

**Every selector in `style.css` is scoped under `.ole-root`**, so the file is safe to drop into a host page that has its own Tailwind, design system, or hand-written CSS. The `<OneLineEditor>` component renders that wrapper for you.

## Sizing

`<OneLineEditor>` expands to fill its parent. Make sure the parent has a height:

```tsx
<div style={{ height: '100vh' }}>
  <OneLineEditor />
</div>
```

Or pass your own `className`:

```tsx
<OneLineEditor className="h-screen w-screen" />
```

## Seeding an initial diagram

Pass `diagram` (typed `DiagramFile`) for first-render content. It's only consumed when the store is empty — the editor won't clobber a user's in-progress work on remount.

```tsx
import { OneLineEditor, type DiagramFile } from 'sldeditor';

const seed: DiagramFile = {
  schema: 'sld/1',
  meta: { name: 'My substation' },
  busses: [],
  elements: [],
  wires: [],
};

<OneLineEditor diagram={seed} />
```

For replacing the diagram imperatively later (loading from cloud, AI-generated edits, etc.), reach into the store:

```ts
import { useEditorStore, fitToContentSoon } from 'sldeditor';

useEditorStore.getState().setDiagram(newDiagram);
fitToContentSoon();
```

See [api.md](./api.md) for the full store surface.

## Theme + locale

```tsx
<OneLineEditor theme="dark" locale="en" />
```

- `theme`: `'light' | 'dark'`. Omit to follow the user's previous choice or OS `prefers-color-scheme`. Internally toggles the `dark` class on `<html>`, matching the Tailwind pattern — if your host app does the same, the editor stays in sync automatically.
- `locale`: `'en' | 'zh'`. Omit to follow localStorage or `navigator.language`.

For pre-mount theming (avoiding a flash of the wrong palette):

```ts
import { applyTheme, getInitialTheme } from 'sldeditor';

applyTheme(getInitialTheme()); // run as early as you can
```

## Subscribing to changes

```ts
import { useEditorStore } from 'sldeditor';

const unsubscribe = useEditorStore.subscribe((state, prev) => {
  if (state.diagram !== prev.diagram) {
    saveToCloud(state.diagram);
  }
});
```

The store is a [zustand](https://github.com/pmndrs/zustand) instance, so all of zustand's selector/subscribe/middleware APIs apply.

## Exports (SVG / PNG / DXF)

The bundled `<ExportMenu>` (in the toolbar) covers most cases. If you want a custom UI:

```ts
import { buildExportSvg, downloadSvg, downloadPng, buildExportDxf, downloadDxf } from 'sldeditor';

const svg = buildExportSvg(diagram);  // returns string
downloadSvg(diagram, 'my-diagram.svg');
downloadPng(diagram, 'my-diagram.png', { scale: 2 });
downloadDxf(diagram, 'my-diagram.dxf');
```

## Migrating from the submodule layout

If your repo currently has `sldeditor` (or `oneline-editor`) as a git submodule:

```bash
git submodule deinit -- oneline-editor
git rm oneline-editor
rm -rf .git/modules/oneline-editor

npm install sldeditor
```

Then rewrite the imports:

```diff
- import { OneLineEditor } from '../oneline-editor/src';
+ import { OneLineEditor } from 'sldeditor';
+ import 'sldeditor/style.css';
```

The `style.css` import is **required** in npm mode. In the submodule layout your host bundler probably picked up `src/styles.css` via Tailwind's content scan; in npm mode you get a pre-built bundle.

## Next

- [API reference](./api.md) — every export from `sldeditor`, grouped by purpose
- [Data model](./data-model.md) — `DiagramFile` schema details
- [Embedding + viewer API design](./binding-and-viewer-api.md) — runtime data binding plans
