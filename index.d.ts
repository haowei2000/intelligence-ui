import type { Server } from 'node:http';
import type { InteractiveDocument, ResolvedReference } from './types/document.js';
export { createDocument, validateDocument, renderDocument, mergeDocument } from './types/document.js';
export type { InteractiveDocument, DocumentOption, Decision, DocumentState, CodeReference, ResolvedReference, Analysis } from './types/document.js';

/** One store instance serializes writes; use a single host per data directory. */
export class DocumentStore {
  constructor(directory: string);
  directory: string;
  file(id: string): string;
  list(): Promise<InteractiveDocument[]>;
  get(id: string): Promise<InteractiveDocument>;
  save(document: InteractiveDocument, expectedRevision: number, create?: boolean): Promise<InteractiveDocument>;
}
export function readReference(workspaceRoot: string, relativePath: string, startLine?: number, endLine?: number): Promise<ResolvedReference>;
export interface AIMessage {
  role: 'system' | 'user';
  content: string;
}
/** Adapter for an existing model service. No credentials enter the browser. */
export interface AIProvider {
  model?: string;
  complete(messages: AIMessage[]): Promise<string> | string;
}
export interface StudioOptions {
  /** Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Defaults to <workspaceRoot>/.data/documents, never the installed package. */
  dataDirectory?: string;
  /** Defaults to 4310; 0 selects an available port. Used by startStudio only. */
  port?: number;
  ai?: AIProvider;
  /** Initial document for an empty store. Defaults to the built-in template. */
  seedDocument?: InteractiveDocument | false;
}
export interface Studio {
  server: Server;
  store: DocumentStore;
  workspaceRoot: string;
  dataDirectory: string;
}
export interface RunningStudio extends Studio {
  url: string;
  close(): Promise<void>;
}
/** Creates an unbound HTTP server. Importing this package does not create a server. */
export function createStudio(options?: StudioOptions): Promise<Studio>;
/** Binds to 127.0.0.1 and resolves after listening succeeds. */
export function startStudio(options?: StudioOptions): Promise<RunningStudio>;
export function createChatCompletionProvider(options: { baseURL: string; model: string; apiKey: string; timeout?: number }): AIProvider;
