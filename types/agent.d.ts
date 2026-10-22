import type { Contract, ContractOptions } from './protocol.js';
import type { UIDocument } from './protocol-components.js';
export type { Contract, ContractOptions, UIDocument };
export { createContract, standardContract, assertContract } from './protocol.js';

export interface Diagnostic {
  /** Stable code, for example UNKNOWN_COMPONENT or UNREGISTERED_ACTION. */
  code: string;
  /** JSON Pointer into the candidate. Empty for the whole input. */
  path: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  expected?: Record<string, unknown>;
  suggestion?: string;
  alternatives?: string[];
  /** Advisory patch; never applied automatically. Check preconditions first. */
  proposedPatch?: Array<{ op: string; path: string; from?: string; value?: unknown }>;
  preconditions?: string[];
  /** Present when fix() can repair this diagnostic deterministically. */
  autofix?: { rule: string; value?: unknown };
}
export type ExtensionValidators = Record<string, (node: unknown) => boolean>;
export interface ValidOutcome { valid: true; document: UIDocument; diagnostics: Diagnostic[]; truncated: false; contractId: string }
/** Invalid candidates use `candidate`, never `document`, so they cannot be published by mistake. */
export interface InvalidOutcome { valid: false; candidate: unknown; diagnostics: Diagnostic[]; truncated: boolean; contractId: string }
export type ValidationResult = ValidOutcome | InvalidOutcome;
export interface AppliedFix {
  rule: string;
  path: string;
  reason: string;
  change: { op: 'replace' | 'add' | 'text'; path?: string; value?: unknown; previous?: unknown; description?: string };
}
export type FixResult = ValidationResult & { applied: AppliedFix[] };
export type RepairResult = FixResult & {
  attempts: number;
  status: 'valid' | 'max-attempts' | 'cancelled' | 'model-error';
  history: Array<{ attempt: number; valid: boolean; applied: AppliedFix[]; diagnostics: Diagnostic[] }>;
  error?: unknown;
};
export interface ValidateOptions { contract?: Contract; extensionValidators?: ExtensionValidators }

export function validate(input: unknown, options?: ValidateOptions): ValidationResult;
/** Deterministic, idempotent repairs on a detached copy. */
export function fix(input: unknown, options?: ValidateOptions): FixResult;
export const fixRules: Readonly<Record<string, string>>;
/** Optional bounded model repair loop; deterministic fixes run before every attempt. */
export function repair(input: unknown, options: ValidateOptions & {
  model(request: { candidate: unknown; diagnostics: Diagnostic[]; feedback: string; attempt: number; signal?: AbortSignal }): Promise<unknown> | unknown;
  maxAttempts?: number;
  signal?: AbortSignal;
}): Promise<RepairResult>;
/** Generation instructions to add to an Agent's existing instructions. */
export function instructions(contract: Contract): string;
/** Text for the next Agent turn after a rejected candidate. */
export function repairFeedback(result: InvalidOutcome | FixResult): string;
/** Compiles validators for extension components (uses Ajv; not for CSP-restricted browsers). */
export function compileExtensions(contract: Contract): Promise<ExtensionValidators>;
