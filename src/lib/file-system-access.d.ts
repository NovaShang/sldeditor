/**
 * Minimal ambient types for the File System Access API.
 *
 * `FileSystemFileHandle` is in TypeScript 5.7's lib.dom, but the picker entry
 * points (`showOpenFilePicker`, `showSaveFilePicker`) are not yet shipped.
 * Declare just enough to call them with type safety; the rest of the API is
 * already covered by the standard lib.
 */

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string | string[]>;
}

interface FilePickerOptions {
  excludeAcceptAllOption?: boolean;
  id?: string;
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions extends FilePickerOptions {
  multiple?: boolean;
}

interface SaveFilePickerOptions extends FilePickerOptions {
  suggestedName?: string;
}

interface Window {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}
