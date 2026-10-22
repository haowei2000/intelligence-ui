import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { RuntimeOptions, ApplyOutcome, UIState, CommittedDocument } from './runtime.js';

export interface UIRendererProps extends Omit<RuntimeOptions, 'pageOrigin'> {
  /** Latest committed document. A new id or revision is applied with state preservation. */
  document: CommittedDocument;
  className?: string;
  style?: CSSProperties;
}
export interface UIRendererRef {
  getState(): UIState;
  getDocument(): CommittedDocument;
  flush(): Promise<UIState>;
  apply(document: CommittedDocument, options?: { reset?: string[] }): ApplyOutcome | undefined;
}
export const UIRenderer: ForwardRefExoticComponent<UIRendererProps & RefAttributes<UIRendererRef>>;
