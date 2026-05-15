import './styles.css';

export { OneLineEditor } from './OneLineEditor';
export type { OneLineEditorProps } from './OneLineEditor';
export type { OneLineEditorProps as SldEditorProps } from './OneLineEditor';

export type {
  Bus,
  BusId,
  BusLayout,
  DiagramFile,
  DiagramMeta,
  DiagramVersion,
  Element,
  ElementId,
  LibraryEntry,
  LibraryLabelAnchor,
  LibraryParamField,
  LibrarySource,
  LibraryStateField,
  LibraryStretchable,
  LibraryTerminal,
  NodeId,
  Orientation,
  ParamValue,
  PinName,
  Placement,
  TerminalRef,
  Wire,
  WireEnd,
  WireId,
} from './model';

// Compiler / runtime model — exported so library consumers can build their
// own renderers or analysis tools on top of the same DiagramFile pipeline.
export {
  compile,
  LIBRARY,
  getLibraryEntry,
  emptyInternalModel,
  resolvePlacement,
  transformPoint,
  transformOrientation,
  orientationVec,
} from './compiler';
export type {
  BusGeometry,
  ConnectivityNode,
  Diagnostic,
  InternalModel,
  ResolvedBus,
  ResolvedElement,
  ResolvedPlacement,
  TerminalGeometry,
  WireRender,
} from './compiler';

export { useEditorStore } from './store';
export type { EditorState } from './store';

// ID allocator — for embedding apps (e.g. AI agents) that build elements
// programmatically and need to mint stable ids without colliding with the
// existing diagram. `wireIdFromEnds` produces deterministic content-hash
// WireIds so the same endpoint pair always maps to the same id.
export {
  newBusId,
  newElementId,
  wireIdFromEnds,
} from './store/id-allocator';

// Locale store — exposed so embedding apps can sync the editor's UI language
// with their own i18n system.
export { useLocale } from './i18n';
export type { Locale } from './i18n';

// Theme primitives — exposed so embedding apps can drive color mode (the
// `theme` prop on `<OneLineEditor>` covers the common case; `applyTheme` is
// here for hosts that need to flip the editor's theme outside the React tree,
// e.g. before the editor mounts to avoid a flash of the wrong palette).
export { applyTheme, getInitialTheme } from './hooks/use-theme';
export type { Theme } from './hooks/use-theme';

// Optional toolbar widgets — file ops + image export. For embedding apps that
// want a "local file" mode without their own persistence layer.
export { FileMenu } from './components/FileMenu';
export { ExportMenu } from './components/ExportMenu';

// Viewport helpers — embedders that perform programmatic edits (AI tool
// calls, importing from another format, etc.) can call `fitToContentSoon`
// to reset the canvas to fit the new diagram once the DOM updates settle.
export { fitToContent, fitToContentSoon } from './canvas/fit-to-content';

// Image export primitives — exposed so consumers (e.g. cloud apps with their
// own naming/persistence) can build their own export UI on top of the same
// SVG/PNG pipeline the bundled ExportMenu uses.
export { buildExportSvg, downloadSvg, downloadPng } from './lib/export-image';
export { buildExportDxf, downloadDxf } from './lib/export-dxf';
export type { DxfExportOptions } from './lib/export-dxf';
