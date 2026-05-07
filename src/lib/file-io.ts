/**
 * Disk I/O for DiagramFile JSON documents.
 *
 * Uses the File System Access API where available so that "save" can write
 * back to the originally opened file; falls back to a hidden `<input>` /
 * download anchor in browsers without it.
 */

import type { DiagramFile } from '../model';

const ACCEPT: Record<string, string[]> = { 'application/json': ['.json'] };

/** Tracks the currently associated on-disk file across open / save calls. */
export interface FileSession {
  /** Present only when the FS Access API is available; lets save() overwrite. */
  handle?: FileSystemFileHandle;
  /** Display name shown in the title bar / save dialog default. */
  name: string;
}

const supportsFsa = (): boolean =>
  typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

const isAbort = (e: unknown): boolean =>
  e instanceof DOMException && e.name === 'AbortError';

function parseDiagram(text: string): DiagramFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败：${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('文件不是 JSON 对象');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== '1') {
    throw new Error(`版本不兼容：期望 "1"，实际 ${JSON.stringify(obj.version)}`);
  }
  if (!Array.isArray(obj.elements)) {
    throw new Error('elements 字段缺失或不是数组');
  }
  return obj as unknown as DiagramFile;
}

function serialize(diagram: DiagramFile): string {
  return JSON.stringify(diagram, null, 2) + '\n';
}

/**
 * Pop the OS file picker and load a DiagramFile. Resolves to `null` when
 * the user cancels.
 */
export async function openDiagram(): Promise<{
  diagram: DiagramFile;
  session: FileSession;
} | null> {
  if (supportsFsa()) {
    let handle: FileSystemFileHandle;
    try {
      [handle] = await window.showOpenFilePicker!({
        multiple: false,
        types: [{ description: 'OneLineEditor diagram', accept: ACCEPT }],
      });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    const file = await handle.getFile();
    return {
      diagram: parseDiagram(await file.text()),
      session: { handle, name: file.name },
    };
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        resolve({
          diagram: parseDiagram(await file.text()),
          session: { name: file.name },
        });
      } catch (e) {
        reject(e);
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Save a DiagramFile to disk. With an existing handle and `saveAs=false`,
 * overwrites in place; otherwise prompts for a destination (or downloads in
 * browsers without FS Access). Resolves to the new session, or `null` if
 * the user cancelled.
 */
export async function saveDiagram(
  diagram: DiagramFile,
  session: FileSession | null,
  options: { saveAs?: boolean } = {},
): Promise<FileSession | null> {
  const text = serialize(diagram);

  if (!options.saveAs && session?.handle) {
    const writable = await session.handle.createWritable();
    await writable.write(text);
    await writable.close();
    return session;
  }

  if (supportsFsa()) {
    let handle: FileSystemFileHandle;
    try {
      handle = await window.showSaveFilePicker!({
        suggestedName: session?.name ?? 'diagram.json',
        types: [{ description: 'OneLineEditor diagram', accept: ACCEPT }],
      });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { handle, name: handle.name };
  }

  // Fallback: browser download. We can't track a real handle.
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = session?.name ?? 'diagram.json';
  anchor.click();
  URL.revokeObjectURL(url);
  return session ?? { name: 'diagram.json' };
}
