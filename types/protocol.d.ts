import type { UIDocument, Component, StandardComponentType } from './protocol-components.js';
export type * from './protocol-components.js';

export type FieldValue = string | number | boolean | null | string[];
export type FieldKind = 'string' | 'number' | 'boolean' | 'string[]';

export interface PropertySpec {
  schema: Record<string, unknown>;
  required?: boolean;
  default?: unknown;
  description: string;
}
export interface ComponentSpec {
  category: string;
  description: string;
  slots: string[];
  binding?: { type: FieldKind } | { byProp: string; map: Record<string, FieldKind> };
  props: Record<string, PropertySpec>;
  extension?: boolean;
}
export interface UrlRule { schemes: string[]; origins: string[] }
export interface Limits {
  maxBytes: number; maxDepth: number; maxComponents: number; maxStringLength: number;
  maxOptions: number; maxDatasets: number; maxDatasetRows: number; maxDiagnostics: number;
}
export interface Policy {
  urls: { image: UrlRule; link: UrlRule; webPreview: UrlRule };
  webPreview: { sandbox: string[]; hostOrigins: string[] };
  link: { target: 'blank' | 'self' };
}
export interface ActionSpec {
  id: string;
  description?: string;
  /** form: Form submitAction only; none: Button action only; any: both. */
  input: 'form' | 'none' | 'any';
}
export interface Contract {
  id: string;
  contractVersion: 1;
  profile: 'standard' | 'deployment';
  protocolVersion: string;
  packageVersion: string;
  components: Record<string, ComponentSpec>;
  /** null in the standard profile: actions are verified by the deployment contract. */
  actions: ActionSpec[] | null;
  limits: Limits;
  policy: Policy;
}
export interface ContractOptions {
  components?: StandardComponentType[];
  actions?: Array<string | { id: string; description?: string; input?: 'form' | 'none' | 'any' }> | null;
  limits?: Partial<Limits>;
  policy?: {
    urls?: Partial<Record<'image' | 'link' | 'webPreview', Partial<UrlRule>>>;
    webPreview?: { sandbox?: string[]; hostOrigins?: string[] };
    link?: { target?: 'blank' | 'self' };
  };
  /** Namespaced custom components, for example "acme:Map". */
  extensions?: Record<string, { description: string; slots?: string[]; props: Record<string, PropertySpec> }>;
}
export interface UIState {
  values: Record<string, FieldValue>;
  /** Bind keys the user changed. New defaults never replace these values. */
  dirty: string[];
  archived?: Array<{ bind: string; value: FieldValue; revision: number; reason: 'removed' | 'type-changed' | 'value-removed' }>;
}
export interface CommittedDocument {
  id: string;
  revision: number;
  contractId?: string;
  document: UIDocument;
  state: UIState;
}
export interface InteractionEvent {
  eventId: string;
  documentId: string;
  baseRevision: number;
  sourceId: string;
  actionId: string;
  values: Record<string, FieldValue>;
}
export interface ActionResult { status: 'accepted' | 'succeeded' | 'failed'; message?: string }
export interface MergeOutcome {
  bind: string;
  outcome: 'reset' | 'type-changed' | 'value-removed' | 'removed';
  removed?: string[];
  from?: FieldKind;
  to?: FieldKind;
}
export interface Field { kind: FieldKind; node: Component; form: Component | null; conditions: unknown[]; options: Set<string> | null }
export interface DeliveryMessage {
  type: 'document.committed' | 'document.proposed' | 'action.status';
  surfaceId?: string;
  committed?: CommittedDocument;
  eventId?: string;
  documentId?: string;
  status?: ActionResult['status'];
  message?: string;
}

export const catalog: { protocolVersion: string; packageVersion: string; components: Record<StandardComponentType, ComponentSpec>; limits: Limits; policy: Policy; patterns: Record<string, string>; aliases: Record<string, { type: string | null; set?: Record<string, unknown> }> };
export const PROTOCOL_VERSION: string;
export const PACKAGE_VERSION: string;
export const componentTypes: readonly StandardComponentType[];
export function createContract(options?: ContractOptions): Contract;
/** The static standard profile shipped as protocol/contract.json. */
export function standardContract(): Contract;
export function assertContract(contract: unknown): Contract;
export function canonicalJSON(value: unknown): string;
export function fingerprint(text: string): string;
export function checkUrl(url: string, resource: 'image' | 'link' | 'webPreview', policy: Policy): null | { code: string; message: string; expected?: unknown };
export function sandboxFor(url: string, policy: Policy, pageOrigin?: string): string;
export function fieldsOf(document: UIDocument): Map<string, Field>;
export function defaultValue(field: Field): FieldValue;
export function initialState(document: UIDocument, state?: Partial<UIState>): UIState;
export function mergeState(options: { previous?: UIDocument | null; next: UIDocument; local?: Partial<UIState>; incoming?: Partial<UIState>; reset?: string[]; revision?: number }): { state: UIState; outcomes: MergeOutcome[] };
/** Wraps a validated candidate with identity, revision and merged state. */
export function commitDocument(candidate: UIDocument, options: { id: string; revision: number; previous?: CommittedDocument | null; state?: UIState; reset?: string[]; contractId?: string }): { committed: CommittedDocument; outcomes: MergeOutcome[] };
export function checkState(document: UIDocument, state: unknown): Array<{ code: string; path: string; message: string }>;
export function checkEvent(committed: CommittedDocument, event: unknown, options?: { state?: UIState }): { ok: true; event: InteractionEvent; form?: Component } | { ok: false; status: number; code: string; message: string; problems?: unknown[] };
export function checkField(field: Field, value: FieldValue): null | { code: string; limit?: number };
export function evaluateCondition(condition: { bind: string; op: string; value?: unknown }, values: Record<string, FieldValue>): boolean;
export function formFields(document: UIDocument, formId: string, values: Record<string, FieldValue>): Array<[string, Field]>;
