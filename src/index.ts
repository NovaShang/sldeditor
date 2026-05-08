import './styles.css';

export { OneLineEditor } from './OneLineEditor';
export type { OneLineEditorProps } from './OneLineEditor';

export type {
  DiagramFile,
  DiagramMeta,
  DiagramVersion,
  Element,
  ElementId,
  PinName,
  NodeId,
  TerminalRef,
  ParamValue,
  Connection,
  NamedConnection,
  Placement,
  Route,
  LibraryEntry,
  LibraryTerminal,
  LibraryStretchable,
  LibraryStateField,
  LibraryParamField,
  LibrarySource,
  Orientation,
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
  ConnectivityNode,
  Diagnostic,
  InternalModel,
  InternalRoute,
  ResolvedElement,
  ResolvedPlacement,
  TerminalGeometry,
} from './compiler';

export { useEditorStore } from './store';
export type { EditorState } from './store';

// ID allocator — for embedding apps (e.g. AI agents) that build elements
// programmatically and need to mint stable kebab-case ids without colliding
// with the existing diagram.
export { newElementId } from './store/id-allocator';

// Locale store — exposed so embedding apps can sync the editor's UI language
// with their own i18n system.
export { useLocale } from './i18n';
export type { Locale } from './i18n';

// Optional toolbar widgets — file ops + image export. For embedding apps that
// want a "local file" mode without their own persistence layer.
export { FileMenu } from './components/FileMenu';
export { ExportMenu } from './components/ExportMenu';
