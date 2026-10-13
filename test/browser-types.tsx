import { createDocument, mountDocument, type InteractiveDocument } from 'intelligence-ui';
import { DocumentRenderer, type DocumentRendererRef } from 'intelligence-ui/react';
import { createRef } from 'react';

const document: InteractiveDocument = createDocument();
document.state.values = { label: 'demo', enabled: true, count: 1 };
const ref = createRef<DocumentRendererRef>();
const component = <DocumentRenderer ref={ref} value={document} onChange={(next, context) => {
  next.state.values?.enabled;
  context.type satisfies 'selection' | 'notes' | 'field' | 'saved';
}} onSave={async (next, context) => {
  context.signal satisfies AbortSignal;
  return next;
}} />;
const controller = mountDocument(globalThis.document.body, { document, onSave: async next => next });
controller.update(document, { readOnly: true });
await controller.flush();
controller.destroy();
// @ts-expect-error callbacks return a document or void, not an arbitrary value
const bad = <DocumentRenderer value={document} onSave={async () => 12} />;
// @ts-expect-error the browser entry does not expose filesystem/server APIs
import { startStudio } from 'intelligence-ui';
