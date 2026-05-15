# sldeditor

In-browser editor component for **electrical single-line diagrams (SLD / 一次系统图)**. Pure-frontend, no backend, no cloud. Designed to be dropped into a React app or used standalone.

> The local source directory is named `oneline-editor` (legacy); the npm package is `sldeditor`.

## What's in the box

- **47 built-in symbols** — breaker, disconnector, transformer (2W/3W), busbar, CT/PT, generator, motor, PV, inverter, EV charger, battery, meter, arrester, fuse, recloser, VFD, and more. Symbol set lives in `src/element-library/*.json` and is hot-loaded into a typed registry.
- **Terminal-level wiring** — connect to pins, not bounding boxes. Auto-snap + orthogonal routing.
- **Busbar as a first-class element** — stretchable, multi-tap, handles arbitrary device attachments.
- **Explicit topology model** — connectivity nodes computed from terminal coincidence, separate from rendering geometry. Exposed via the `compile()` function so you can run your own analyses on top.
- **Undo/redo, multi-select, copy/paste, alignment, snap, grid, zoom/pan**.
- **Local-first persistence** — JSON file open/save, plus SVG / PNG / DXF export. State is also cached in `localStorage` so refresh doesn't lose work.
- **i18n** — Chinese + English UI, locale store exposed so embedders can sync with their own translation layer.

## Install

```bash
npm install sldeditor
```

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

Peer deps: `react >= 18`, `react-dom >= 18` (React 19 tested).

`OneLineEditor` mounts a full editor (canvas + toolbars + panels). Pass `diagram` to seed an initial `DiagramFile`; otherwise it loads from `localStorage` or starts empty.

### Style isolation

Every selector in `sldeditor/style.css` is scoped under `.ole-root` — including all Tailwind utilities and CSS variables. The editor always renders that wrapper, so the stylesheet is safe to drop into a host app that has its own Tailwind, design system, or hand-written CSS without collisions.

### Migrating from a git submodule

If your repo currently pulls this project as a submodule:

```bash
git submodule deinit -- oneline-editor
git rm oneline-editor
rm -rf .git/modules/oneline-editor
npm install sldeditor
```

Then rewrite imports:

```diff
- import { OneLineEditor } from '../oneline-editor/src';
+ import { OneLineEditor } from 'sldeditor';
+ import 'sldeditor/style.css';
```

The `style.css` import is **required** in npm mode (in the submodule layout your bundler probably picked up the source Tailwind file via content scan; in npm mode you get the prebuilt bundle).

## Public API

The editor reads/writes from a built-in zustand store. For embedding apps that want programmatic control (importers, AI tool-calling, custom renderers), `src/index.ts` exports:

- `useEditorStore` — full store: diagram, selection, viewport, undo stack
- `compile(diagram)` — produces an `InternalModel` with resolved geometry + connectivity nodes; use it to build viewers or run topology analysis without re-implementing the model
- `LIBRARY`, `getLibraryEntry` — the symbol registry
- `newBusId`, `newElementId`, `wireIdFromEnds` — id allocators for programmatic edits (deterministic content-hash wire ids so the same endpoint pair always maps to the same id)
- `FileMenu`, `ExportMenu` — optional toolbar widgets if you want the bundled file/export UX
- `buildExportSvg`, `downloadSvg`, `downloadPng`, `buildExportDxf`, `downloadDxf` — export primitives if you're building your own export UI
- `fitToContent`, `fitToContentSoon` — reset the viewport after programmatic edits
- `useLocale` — sync editor UI language with your app's i18n

## What it's not

- Not a format converter — does **not** read/write CIM, IEC 61850 SCL, PSD-BPA, PSS/E, or PowerFactory formats. JSON only.
- Not a simulator — no power flow, short-circuit, or stability calculations.
- Not a SCADA viewer — no real-time binding.
- Not a secondary / control-loop diagram tool.

## Docs

- [Getting started](./docs/getting-started.md) — install, sizing, seeding, theme/locale, exports
- [API reference](./docs/api.md) — every public export, grouped by purpose
- [Data model](./docs/data-model.md) — `DiagramFile` schema
- [Embedding + viewer API design](./docs/binding-and-viewer-api.md) — runtime data-binding plans
- [Runtime PRD](./docs/runtime-prd.md) — read-only viewer roadmap
- [Blog / changelog notes](./docs/blog/)

## Develop

```bash
npm install
npm run dev          # standalone demo at localhost:5173
npm run build:lib    # produces dist/sldeditor.js + dist/style.css
npm run typecheck
npm test
```

### Releasing

Versions ship via [Changesets](https://github.com/changesets/changesets). After making a publishable change:

```bash
npx changeset             # write a patch/minor/major note
git commit -am "feat: ..."
```

When the PR lands on `master`, the **Release** GitHub Action opens a "Version Packages" PR; merging that PR publishes to npm and creates a GitHub release. Repo needs an `NPM_TOKEN` secret with automation-token scope.

## License

MIT. Third-party attributions in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
