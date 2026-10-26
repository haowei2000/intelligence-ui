import { createElement, useRef } from 'react';
import { createContract, commitDocument, type UIDocument, type CommittedDocument } from '@haowei2000/intelligence-ui/protocol';
import { validate, fix, repair, instructions } from '@haowei2000/intelligence-ui/agent';
import { mountUI, connectSurface } from '@haowei2000/intelligence-ui/runtime';
import { UIRenderer, type UIRendererRef } from '@haowei2000/intelligence-ui/runtime/react';
import { createUIService, tokenAuth, MemoryUIStore, createMCPHandler } from '@haowei2000/intelligence-ui/node';

const contract = createContract({ actions: [{ id: 'submit-plan', input: 'form' }], policy: { urls: { image: { origins: ['https://images.example.com'] } } } });
const candidate: UIDocument = { schemaVersion: '1.0', root: { type: 'Text', id: 'hello', text: 'Hello', variant: 'heading1' } };
const result = validate(candidate, { contract });
if (result.valid) result.document.root.id.toUpperCase();
else result.candidate;
// @ts-expect-error invalid results have no document
validate(candidate).document;
fix('{}').applied.map(change => change.rule);
await repair('{}', { contract, model: async ({ feedback }) => feedback, maxAttempts: 1 });
instructions(contract).trim();
const { committed } = commitDocument(candidate, { id: 'doc', revision: 1 });
const ui = mountUI(document.createElement('div'), { document: committed, contract, onAction: async event => ({ status: event.values ? 'accepted' : 'failed' }) });
ui.apply(committed).outcome;
connectSurface({ baseUrl: '/ui', surfaceId: 's', container: document.body, headers: async () => ({ Authorization: 'Bearer x' }) });
function App({ value }: { value: CommittedDocument }) {
  const ref = useRef<UIRendererRef>(null);
  return createElement(UIRenderer, { ref, document: value, onAction: () => undefined });
}
App;
const service = createUIService({ contract, store: new MemoryUIStore(), authenticate: tokenAuth({ 'token-for-the-agent-1': { id: 'agent', roles: ['agent'], surfaces: ['*'] } }) });
createMCPHandler({ service, principal: { id: 'agent', roles: ['agent'], surfaces: ['*'] } });
// @ts-expect-error a contract is required
createUIService({ authenticate: () => null });

const chartDocument: UIDocument = {
  schemaVersion: '1.0',
  root: { type: 'Chart', id: 'sales', kind: 'line', dataset: 'sales', x: 'month', title: 'Sales', series: [{ field: 'value', label: 'Revenue' }], height: 300, showLegend: true },
  datasets: { sales: { rows: [{ month: 'Jan', value: 10 }] } }
};
commitDocument(chartDocument, { id: 'chart', revision: 1 });
// @ts-expect-error unsupported chart family
const unsupportedChart: UIDocument['root'] = { ...chartDocument.root, type: 'Chart', kind: 'scatter' };
unsupportedChart;
