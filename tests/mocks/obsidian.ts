export interface EventRef {
  id?: string;
}

export interface FileStat {
  mtime: number;
  ctime: number;
  size: number;
}

export interface Vault {
  getMarkdownFiles(): TFile[];
  getAbstractFileByPath(path: string): TFile | null;
  on(event: string, callback: (...args: any[]) => void): EventRef;
  offref(ref: EventRef): void;
}

export interface CachedMetadata {
  frontmatter?: unknown;
}

export interface MetadataCache {
  getFileCache(file: TFile): CachedMetadata | null;
  on(event: string, callback: (...args: any[]) => void): EventRef;
  offref(ref: EventRef): void;
}

export interface Workspace {
  on(event: string, callback: (...args: any[]) => void): EventRef;
  offref(ref: EventRef): void;
  getActiveFile(): TFile | null;
}

export interface FileManager {
  processFrontMatter(file: TFile, handler: (fm: Record<string, any>) => void): Promise<void> | void;
}

export interface App {
  vault: Vault;
  metadataCache: MetadataCache;
  workspace: Workspace;
  fileManager: FileManager;
}

export interface TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: FileStat;
  vault: Vault;
  parent: unknown;
}

export class Notice {
  constructor(public message: string) {
    // No-op stub; real Obsidian would display UI.
  }
}

export class Plugin {
  app!: App;
}

export class WorkspaceLeaf {
  view: unknown = null;
  setViewState(_state: any): Promise<void> {
    return Promise.resolve();
  }
}

export class ItemView {
  containerEl = {
    empty: () => undefined,
    addClass: (_cls: string) => undefined,
    createDiv: () => ({ createEl: () => undefined, createDiv: () => ({}) })
  };
  constructor(public leaf: WorkspaceLeaf) {}
  registerEvent(_ref: EventRef): void {
    // No-op for tests
  }
}

export class SuggestModal<T> {
  constructor(public app: App) {}
  setPlaceholder(_text: string): void {}
  open(): void {}
  close(): void {}
}

export class MarkdownView {}

export class EditorSuggest<T> {
  constructor(public app: App) {}
}

export interface EditorPosition {
  line: number;
  ch: number;
}

export interface Editor {
  getLine(line: number): string;
  getValue(): string;
  replaceRange(text: string, from: EditorPosition, to: EditorPosition): void;
  posToOffset(pos: EditorPosition): number;
  getCursor(): EditorPosition;
}

export interface EditorSuggestTriggerInfo {
  start: EditorPosition;
  end: EditorPosition;
  query: string;
}

export interface EditorSuggestContext {
  editor: Editor;
  start: EditorPosition;
  end: EditorPosition;
  query: string;
  file?: TFile | null;
}

export function addIcon(_id: string, _svg: string): void {
  // No-op stub used in tests
}
