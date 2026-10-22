import type { Contract, CommittedDocument, UIState, InteractionEvent, ActionResult, MergeOutcome, DeliveryMessage } from './protocol.js';
import type { Component } from './protocol-components.js';
export type { Contract, CommittedDocument, UIState, InteractionEvent, ActionResult, MergeOutcome, DeliveryMessage };
export { createContract, standardContract } from './protocol.js';

export type SaveStatus = 'pending' | 'saving' | 'saved' | 'error';
export type Labels = Record<string, string>;
export type ApplyOutcome =
  | { outcome: 'applied'; merge: MergeOutcome[] }
  | { outcome: 'unchanged' | 'stale' | 'conflict' }
  | { outcome: 'rejected' | 'unsupported-protocol' | 'incompatible-capabilities'; diagnostics: unknown[] };
export interface StateChangeContext { type: 'field' | 'reset' | 'merge'; bind?: string; formId?: string; changeId: number; documentId: string; revision: number }
export interface SaveContext { signal: AbortSignal; documentId: string; revision: number; changeId: number }
export type ExtensionRenderer = (node: Component & Record<string, unknown>, context: { document: Document; labels: Labels; renderChildren(children: unknown[]): Node[] }) => Node;

export interface RuntimeSettings {
  readOnly?: boolean;
  debounceMs?: number;
  styleNonce?: string;
  lang?: string;
  labels?: Partial<Labels>;
  /** Receives form submissions and Button actions. Resolve with the acceptance or execution status. */
  onAction?(event: InteractionEvent, context: { signal: AbortSignal }): Promise<ActionResult | void> | ActionResult | void;
  onStateChange?(state: UIState, context: StateChangeContext): void;
  /** Optional persistence; called debounced and serially with the latest state. */
  onSave?(state: UIState, context: SaveContext): Promise<unknown> | unknown;
  onMerge?(outcomes: MergeOutcome[], context: { documentId: string; revision: number }): void;
  onSaveStatus?(status: SaveStatus): void;
  onError?(error: unknown): void;
}
export interface RuntimeOptions extends RuntimeSettings {
  document: CommittedDocument;
  /** Capability contract used for defensive checks and URL policy. Defaults to the standard profile. */
  contract?: Contract;
  renderers?: Record<string, ExtensionRenderer>;
  extensionValidators?: Record<string, (node: unknown) => boolean>;
  /** Origin of the embedding page; defaults to window.location.origin. */
  pageOrigin?: string;
}
export interface UIController {
  element: HTMLDivElement;
  /** Applies a newer committed revision, merging user input per binding. */
  apply(document: CommittedDocument, options?: { reset?: string[] }): ApplyOutcome;
  getState(): UIState;
  getDocument(): CommittedDocument;
  update(settings: RuntimeSettings): void;
  setActionStatus(eventId: string, status: ActionResult['status'], message?: string): void;
  flush(): Promise<UIState>;
  destroy(): void;
}
export const defaultLabels: Readonly<Labels>;
export function mountUI(container: HTMLElement, options: RuntimeOptions): UIController;
export function connectSurface(options: {
  baseUrl: string;
  surfaceId: string;
  container: HTMLElement;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
  mountOptions?: Omit<RuntimeOptions, 'document' | 'onAction' | 'onSave'>;
  onDelivery?(message: DeliveryMessage): void;
  /** open when the stream is connected, retrying after a failure, closed after close(). */
  onConnection?(status: 'open' | 'retrying' | 'closed'): void;
  onError?(error: unknown): void;
  retryMs?: number;
}): { controllers: Map<string, UIController>; close(): Promise<void> };
export function readEventStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string; data: string }>;
