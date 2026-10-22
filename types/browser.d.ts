import type { InteractiveDocument } from './document.js';
export { createDocument, validateDocument, renderDocument, mergeDocument } from './document.js';
export type { InteractiveDocument, CreateDocumentOptions, DocumentOption, Decision, DocumentState, CodeReference, Analysis } from './document.js';

export interface ChangeContext {
  type: 'selection' | 'notes' | 'field' | 'saved';
  changeId: number;
  decisionId?: string;
  field?: string;
}
export interface SaveContext {
  signal: AbortSignal;
  changeId: number;
  documentId: string;
  baseRevision: number;
}
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
export interface RendererSettings {
  readOnly?: boolean;
  debounceMs?: number;
  styleNonce?: string;
  onChange?(document: InteractiveDocument, context: ChangeContext): void;
  /** Return the saved document to synchronize the server's revision, or void. */
  onSave?(document: InteractiveDocument, context: SaveContext): Promise<InteractiveDocument | void> | InteractiveDocument | void;
  onSaved?(document: InteractiveDocument): void;
  onSaveStatus?(status: SaveStatus): void;
  onError?(error: unknown): void;
}
export interface RendererOptions extends RendererSettings {
  document: InteractiveDocument;
}
export interface DocumentController {
  element: HTMLDivElement;
  getDocument(): InteractiveDocument;
  /** Programmatic updates do not trigger onChange or onSave. Pass undefined to change only settings. */
  update(document: InteractiveDocument | undefined, settings?: RendererSettings): void;
  /** Writes all pending changes; rejects on save failure, allowing explicit retry. */
  flush(): Promise<InteractiveDocument>;
  /** Cancels scheduled saves and signals any in-flight save to abort. */
  destroy(): void;
}
export function mountDocument(container: HTMLElement, options: RendererOptions): DocumentController;
