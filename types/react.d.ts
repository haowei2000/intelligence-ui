import type { CSSProperties, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { InteractiveDocument } from './document.js';
import type { RendererSettings } from './browser.js';
export interface DocumentRendererProps extends RendererSettings {
  value: InteractiveDocument;
  className?: string;
  style?: CSSProperties;
}
export interface DocumentRendererRef {
  getDocument(): InteractiveDocument;
  flush(): Promise<InteractiveDocument>;
}
export const DocumentRenderer: ForwardRefExoticComponent<DocumentRendererProps & RefAttributes<DocumentRendererRef>>;
