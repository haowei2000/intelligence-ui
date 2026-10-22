import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from '../lib/cli.mjs';
import { connectSurface } from '@haowei2000/intelligence-ui/runtime';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const python = ['python3', 'python'].find(command => spawnSync(command, ['--version']).status === 0);
const waitFor = async (predicate, message, ms = 15000) => { const end = Date.now() + ms; while (!(await predicate())) { if (Date.now() > end) throw new Error(`timeout: ${message}`); await new Promise(r => setTimeout(r, 25)); } };

test('reference cycle: a separate Python Agent, the service and a browser frontend complete an interaction', { skip: !python && 'python3 is not installed', timeout: 60000 }, async () => {
  const config = JSON.parse(await readFile(path.join(root, 'examples/protocol/config.json'), 'utf8'));
  const { server } = await createServer(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM('<main id="surface"></main>', { url: 'https://frontend.example/' });
  const deliveries = [];
  // The frontend uses only fetch, the service URL and its user token.
  const client = connectSurface({ baseUrl: `${base}/ui`, surfaceId: 'demo', container: dom.window.document.querySelector('#surface'), headers: { Authorization: 'Bearer demo-user-token-change-me' }, onDelivery: message => deliveries.push(message), retryMs: 100 });
  const agentLog = [];
  const agent = spawn(python, [path.join(root, 'examples/protocol/agent-python/agent.py'), '--service', base, '--max-events', '1', '--poll', '0.1'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AI_BASE_URL: '', AI_MODEL: '', AI_API_KEY: '' } });
  agent.stderr.on('data', chunk => agentLog.push(String(chunk)));
  const exited = new Promise(resolve => agent.once('exit', resolve));
  try {
    await waitFor(() => client.controllers.get('trip-plan'), 'first card');
    const log = () => agentLog.join('');
    // Scenario 2 and 5: errors were found and resolved before anything reached the frontend.
    assert.match(log(), /autofix strip-markdown-fence/);
    assert.match(log(), /UNREGISTERED_ACTION/);
    assert.equal(deliveries.filter(m => m.type === 'document.committed').length, 1, 'only the valid result was delivered');
    const shadow = client.controllers.get('trip-plan').element.shadowRoot;
    const change = (selector, checked = true) => { const input = shadow.querySelector(selector); input.checked = checked; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
    // Scenario 3: local interaction without model calls, then submission.
    change('input[value=paris]');
    change('input[value=food]');
    change('input[value=museums]');
    shadow.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => shadow.querySelector('.status')?.textContent.includes('Received'), 'acceptance');
    await waitFor(() => client.controllers.get('trip-plan').getDocument().revision === 2, 'second revision');
    const updated = client.controllers.get('trip-plan').element.shadowRoot;
    assert.equal(updated.querySelector('h3').textContent, 'Your Paris weekend');
    assert.equal(updated.querySelector('input[value=paris]').checked, true, 'compatible state preserved');
    assert.deepEqual(client.controllers.get('trip-plan').getState().values.activities, ['museums', 'food'], 'multiple choice values follow option order');
    assert.equal(updated.querySelectorAll('tbody tr').length, 2);
    await waitFor(() => deliveries.some(m => m.type === 'action.status' && m.status === 'succeeded'), 'action status');
    assert.equal(await exited, 0, log());
  } finally {
    agent.kill();
    await client.close();
    server.closeAllConnections(); server.close();
    dom.window.close();
  }
});
