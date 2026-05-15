import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import dts from 'vite-plugin-dts';
import prefixer from 'postcss-prefix-selector';
import path from 'node:path';

// Wrap every selector in the library's CSS output under `.ole-root` so
// utility classes (`.flex`, `.p-2`, …) emitted by Tailwind cannot collide
// with the host page's own styles. The editor's React tree always renders
// inside a `.ole-root` div (see OneLineEditor.tsx), so this is invisible
// to consumers. The standalone demo build (vite.config.ts) skips this
// transform, because the demo's `<body>` is the editor root.
const SCOPE = '.ole-root';
const scopeCss = prefixer({
  prefix: SCOPE,
  transform(prefix, selector, prefixedSelector) {
    // Already scoped to the editor root — don't double-prefix.
    if (selector.includes(SCOPE)) return selector;

    // CSS variables emitted on `:root` by Tailwind's theme layer must move
    // onto `.ole-root` so they don't redefine tokens for the host page.
    if (selector === ':root' || selector === ':host') return prefix;

    // Dark-mode parent selector. We keep `.dark` as an ancestor so the host
    // toggling `<html class="dark">` still flips the editor.
    if (selector === '.dark') return `.dark ${prefix}`;
    if (selector.startsWith('.dark ')) {
      return `.dark ${prefix} ${selector.slice('.dark '.length)}`;
    }

    return prefixedSelector;
  },
});

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    dts({
      tsconfigPath: './tsconfig.lib.json',
      include: ['src'],
      exclude: ['src/demo', 'src/**/*.test.*'],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    postcss: {
      plugins: [scopeCss],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'OneLineEditor',
      formats: ['es', 'cjs'],
      fileName: (format) =>
        format === 'es' ? 'sldeditor.js' : 'sldeditor.cjs',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'style.css';
          return assetInfo.name ?? 'asset-[hash][extname]';
        },
      },
    },
  },
});
