#!/usr/bin/env node
// Intelligence UI reference Agent in TypeScript. Runs with `node agent.ts` (Node 22.18+ strips types).
// Unlike the Python example it validates and repairs locally with @haowei2000/intelligence-ui/agent and only
// calls the service to publish and to read events.
import { instructions, repair, assertContract, type Contract, type UIDocument } from '@haowei2000/intelligence-ui/agent';

const service = (process.env.IUI_SERVICE ?? 'http://127.0.0.1:4320').replace(/\/$/, '') + '/ui';
const token = process.env.IUI_AGENT_TOKEN ?? 'demo-agent-token-change-me';
const surface = process.argv[2] ?? 'demo';
type Message = { role: 'system' | 'user' | 'assistant'; content: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(service + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as T };
}

// Any model works: this adapter speaks OpenAI-compatible chat completions when configured.
async function complete(messages: Message[]): Promise<string> {
  const { AI_BASE_URL, AI_MODEL, AI_API_KEY } = process.env;
  if (!AI_BASE_URL || !AI_MODEL || !AI_API_KEY) return scripted(messages);
  const response = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` }, body: JSON.stringify({ model: AI_MODEL, messages }) });
  if (!response.ok) throw new Error(`model returned ${response.status}`);
  return (await response.json()).choices[0].message.content;
}
function scripted(messages: Message[]): string {
  const repairing = messages.at(-1)!.content.startsWith('The UI document was rejected');
  const card: UIDocument = { schemaVersion: '1.0', root: { type: 'Card', id: 'welcome', title: 'Welcome back', children: [
    { type: 'Text', id: 'intro', text: 'Pick what to plan next.' },
    { type: 'Stack', id: 'buttons', direction: 'horizontal', children: [
      { type: 'Button', id: 'refresh', label: 'Refresh prices', action: { type: 'action', actionId: repairing ? 'refresh-prices' : 'refresh' } }
    ] }
  ] } };
  return JSON.stringify(card);
}

const contract: Contract = assertContract((await call<Contract>('GET', '/contract')).body);
const system = `You help users plan trips.\n\n${instructions(contract)}`;
const messages: Message[] = [{ role: 'system', content: system }, { role: 'user', content: 'Show me what I can do next.' }];
const result = await repair(await complete(messages), {
  contract,
  maxAttempts: 2,
  model: async ({ candidate, feedback }) => complete([...messages, { role: 'assistant', content: JSON.stringify(candidate) }, { role: 'user', content: feedback }])
});
for (const step of result.history) console.error(`[agent] attempt ${step.attempt}: ${step.valid ? 'valid' : step.diagnostics.filter(d => d.severity === 'error').map(d => d.code).join(', ')}`);
if (!result.valid) throw new Error(`no valid document after ${result.attempts} repairs`);

const published = await call<{ status: string; committed?: { revision: number } }>('PUT', `/surfaces/${surface}/documents/welcome`, { document: result.document, baseRevision: 0 });
console.error(`[agent] ${published.body.status}${published.body.committed ? ` revision ${published.body.committed.revision}` : ''}`);
