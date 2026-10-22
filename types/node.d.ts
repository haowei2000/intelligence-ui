import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Contract, CommittedDocument, UIState, InteractionEvent, ActionResult, MergeOutcome } from './protocol.js';
import type { Diagnostic, ExtensionValidators } from './agent.js';
import type { Server } from 'node:http';
import type { InteractiveDocument, ResolvedReference } from './document.js';
export { createDocument, validateDocument, renderDocument, mergeDocument } from './document.js';
export type { InteractiveDocument, DocumentOption, Decision, DocumentState, CodeReference, ResolvedReference, Analysis } from './document.js';

/** One store instance serializes writes; use a single host per data directory. */
export class DocumentStore {
  constructor(directory: string);
  directory: string;
  file(id: string): string;
  list(): Promise<InteractiveDocument[]>;
  get(id: string): Promise<InteractiveDocument>;
  save(document: InteractiveDocument, expectedRevision: number, create?: boolean): Promise<InteractiveDocument>;
}
/** SHA-256 hex digest used for CodeReference.hash. */
export function hash(text: string): string;
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


export interface Principal { id: string; roles: Array<'agent' | 'user' | string>; surfaces: string[]; defaultSurface?: string }
export type Operation = 'contract' | 'validate' | 'publish' | 'read' | 'read-events' | 'report-status' | 'stream' | 'event' | 'state';
export class UIServiceError extends Error { status: number; code: string }
export interface StoredEvent { eventId: string; surfaceId: string; event: InteractionEvent; status: ActionResult['status']; message?: string; receivedAt: string }
export interface EventPage { events: StoredEvent[]; cursor: string; expired: boolean }
export type PublishResult =
  | { status: 'committed'; contractId: string; committed: CommittedDocument; merge: MergeOutcome[]; diagnostics: Diagnostic[] }
  | { status: 'rejected'; contractId: string; diagnostics: Diagnostic[]; truncated: boolean }
  | { status: 'conflict'; contractId: string; currentRevision: number; message?: string };
/** Store contract; commit() must compare and set atomically. */
export interface UIStore {
  getDocument(surfaceId: string, documentId: string): Promise<CommittedDocument | null>;
  listDocuments(surfaceId: string): Promise<CommittedDocument[]>;
  commit(surfaceId: string, committed: CommittedDocument, expectedRevision: number): Promise<boolean>;
  getState(surfaceId: string, documentId: string): Promise<UIState | null>;
  putState(surfaceId: string, documentId: string, state: UIState): Promise<void>;
  findEvent(eventId: string): Promise<{ eventId: string; surfaceId: string; principalId: string; event: InteractionEvent; status: ActionResult['status']; message?: string } | null>;
  appendEvent(record: { eventId: string; surfaceId: string; principalId: string; event: InteractionEvent; status: ActionResult['status'] }): Promise<number>;
  updateEvent(eventId: string, changes: { status?: ActionResult['status']; message?: string }): Promise<unknown>;
  readEvents(options: { cursor?: string | number; limit?: number; surfaces?: string[] | null }): Promise<{ events: Array<{ eventId: string; surfaceId: string; event: InteractionEvent; status: ActionResult['status']; message?: string; receivedAt: number }>; cursor: string; expired: boolean }>;
}
export class MemoryUIStore implements UIStore {
  constructor(options?: { eventRetentionMs?: number; maxEvents?: number; now?: () => number });
  getDocument(surfaceId: string, documentId: string): Promise<CommittedDocument | null>;
  listDocuments(surfaceId: string): Promise<CommittedDocument[]>;
  commit(surfaceId: string, committed: CommittedDocument, expectedRevision: number): Promise<boolean>;
  getState(surfaceId: string, documentId: string): Promise<UIState | null>;
  putState(surfaceId: string, documentId: string, state: UIState): Promise<void>;
  findEvent(eventId: string): ReturnType<UIStore['findEvent']>;
  appendEvent(record: Parameters<UIStore['appendEvent']>[0]): Promise<number>;
  updateEvent(eventId: string, changes: { status?: ActionResult['status']; message?: string }): Promise<unknown>;
  readEvents(options: Parameters<UIStore['readEvents']>[0]): ReturnType<UIStore['readEvents']>;
}
/** Durable store on node:sqlite (Node 22.13+); processes on one machine may share the file. */
export class SqliteUIStore extends MemoryUIStore {
  constructor(file: string, options?: { eventRetentionMs?: number; now?: () => number });
  close(): void;
}
export interface UIServiceOptions {
  contract: Contract;
  store?: UIStore;
  authenticate(request: IncomingMessage): Principal | null | Promise<Principal | null>;
  authorize?(principal: Principal, request: { operation: Operation; surfaceId?: string }): boolean | Promise<boolean>;
  /** Business execution for interaction events. Runs after re-validation and deduplication. */
  onEvent?(event: InteractionEvent, context: { principal: Principal; surfaceId: string; committed: CommittedDocument }): Promise<ActionResult | void> | ActionResult | void;
  cors?: { origins?: string[] };
  basePath?: string;
  maxBodyBytes?: number;
  extensionValidators?: ExtensionValidators;
  onError?(error: unknown): void;
}
export interface UIService {
  contract: Contract;
  store: UIStore;
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  publish(options: { principal: Principal; surfaceId: string; documentId: string; document: unknown; baseRevision: number; reset?: string[]; resolvesEventId?: string }): Promise<PublishResult>;
  submitEvent(options: { principal: Principal; surfaceId: string; event: unknown }): Promise<ActionResult & { duplicate?: boolean }>;
  saveState(options: { principal: Principal; surfaceId: string; documentId: string; state: unknown; baseRevision: number }): Promise<{ status: 'saved'; revision: number }>;
  readEvents(options: { principal: Principal; surfaceId?: string; cursor?: string | number; limit?: number }): Promise<EventPage>;
  reportStatus(options: { principal: Principal; surfaceId: string; eventId: string; status: ActionResult['status']; message?: string }): Promise<{ status: string }>;
  getDocument(options: { principal: Principal; surfaceId: string; documentId: string }): Promise<CommittedDocument>;
  subscribe(surfaceId: string, listener: (message: unknown) => void): () => void;
}
export function createUIService(options: UIServiceOptions): UIService;
export function tokenAuth(tokens: Record<string, Principal>): (request: IncomingMessage) => Principal | null;
export function defaultAuthorize(principal: Principal | null, request: { operation: Operation; surfaceId?: string }): boolean;
export interface MCPHandler { handleMessage(message: unknown): Promise<unknown | null>; callTool(name: string, args?: Record<string, unknown>): Promise<unknown> }
export const mcpTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
export function createMCPHandler(options: { service: UIService; principal: Principal; defaultSurfaceId?: string; serverName?: string }): MCPHandler;
export function serveStdio(handler: MCPHandler, options?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream }): { close(): void; done: Promise<void> };
export function createMCPHttpHandler(options: { authenticate(request: IncomingMessage): Principal | null | Promise<Principal | null>; handlerFor(principal: Principal, request: IncomingMessage): MCPHandler; path?: string; allowedOrigins?: string[]; maxBodyBytes?: number }): (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
export function createAssetHandler(options?: { prefix?: string; csp?: string }): (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
