export interface DocumentOption {
  id: string;
  label: string;
  description: string;
}
export interface Decision {
  id: string;
  title: string;
  description: string;
  options: DocumentOption[];
}
export interface DocumentState {
  selections: Record<string, string>;
  notes: string;
}
export interface CodeReference {
  decisionId: string;
  path: string;
  startLine: number;
  endLine: number;
  hash: string;
}
export interface ResolvedReference {
  path: string;
  startLine: number;
  endLine: number;
  hash: string;
  lineCount: number;
  content: string;
}
export interface Analysis {
  id: string;
  kind: 'ai' | 'local';
  text: string;
  createdAt: string;
  selections: Record<string, string>;
  notes: string;
  references: Array<Omit<ResolvedReference, 'content'> & { decisionId: string }>;
  model: string | null;
}
export interface InteractiveDocument {
  manifest: {
    formatVersion: 1;
    id: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  };
  title: string;
  description: string;
  decisions: Decision[];
  state: DocumentState;
  references: CodeReference[];
  analysis: Analysis[];
  archivedSelections?: Array<{ decisionId: string; optionId: string; archivedAt: string }>;
  ui: { html: string };
}

export function createDocument(title?: string, description?: string): InteractiveDocument;
/** Validates the protocol and returns the same document. Throws on invalid data. */
export function validateDocument(document: unknown): InteractiveDocument;
/** Renders an isolated preview, or a portable HTML file when standalone is true. */
export function renderDocument(document: InteractiveDocument, standalone?: boolean): string;
/** Preserves still-valid selections and archives removed selections. Does not save. */
export function mergeDocument(current: InteractiveDocument, next: InteractiveDocument): InteractiveDocument;
export function hash(text: string): string;
export function escapeHtml(text: unknown): string;
