# sldeditor

Lightweight in-browser editor component for **electrical single-line diagrams (SLD)**. Designed to be embedded into other React applications.

> The local source directory is named `oneline-editor` (legacy); the npm package is `sldeditor`.

## Install

```bash
npm install sldeditor
```

```tsx
import { OneLineEditor } from 'sldeditor';
import 'sldeditor/style.css';

export default function App() {
  return <OneLineEditor />;
}
```

The editor reads/writes its diagram from a built-in zustand store, exposed as `useEditorStore`. See `src/index.ts` for the full public API.

## Develop

```bash
npm install
npm run dev          # standalone demo at localhost:5173
npm run build:lib    # produces dist/sldeditor.js + dist/style.css
npm run typecheck
npm test
```

## License

MIT
