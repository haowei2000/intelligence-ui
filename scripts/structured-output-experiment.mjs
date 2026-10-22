#!/usr/bin/env node
// P0 structured output experiment: does the recursive document schema survive providers' strict
// structured output modes, and do the results validate for the reference scenarios?
//
// Usage: node scripts/structured-output-experiment.mjs <providers.json> [--runs 3] [--out results.json]
// providers.json: [{ "name": "...", "vendor": "...", "baseURL": "https://.../v1", "model": "...", "apiKeyEnv": "ENV_NAME",
//                    "mode": "json_schema" | "json_object" | "prompt", "extraBody": {...} }]
// Each result records whether the raw output was valid and whether deterministic fix() made it valid.
// Configurations with the same vendor (default: name) count as one provider; the best mode decides.
// Network errors and timeouts are reported as inconclusive and do not count for or against a mode.
// Every endpoint must speak OpenAI-compatible chat completions. This script makes paid API calls.
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { validate, fix, instructions, createContract } from '../agent.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { runs: { type: 'string', default: '3' }, out: { type: 'string' }, summarize: { type: 'string' } } });
if (!positionals[0] && !values.summarize) { console.error('Usage: node scripts/structured-output-experiment.mjs <providers.json> [--runs 3] [--out results.json]\n       node scripts/structured-output-experiment.mjs --summarize results.json'); process.exit(2); }
const providers = values.summarize ? [] : JSON.parse(await readFile(positionals[0], 'utf8'));
const schema = JSON.parse(await readFile(new URL('../protocol/ui-document.schema.json', import.meta.url), 'utf8'));
const contract = createContract({ actions: [{ id: 'submit-plan', input: 'form' }, { id: 'refresh-prices', input: 'none' }] });
const scenarios = [
  { id: 'trip-card', prompt: 'Show a card for planning a weekend trip: a cover image from https://images.example.com, a link to a guide, a form with a single choice of destination (Berlin, Paris), a multiple choice of activities, a budget slider and a submit button.' },
  { id: 'hotel-table', prompt: 'Show three hotels in a sortable table with name, price (number) and rating, inside tabs with a summary tab, and a button that refreshes prices.' },
  { id: 'conditional-settings', prompt: 'Show a settings form: required email, a weekly digest toggle, a digest day select that is only visible when the digest is on, and save and reset buttons.' }
];
const { $schema, $id, ...portable } = schema;

async function run(provider, scenario) {
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) return { status: 'skipped', reason: `${provider.apiKeyEnv} is not set` };
  const body = {
    model: provider.model,
    messages: [{ role: 'system', content: instructions(contract) }, { role: 'user', content: scenario.prompt }],
    ...(provider.mode === 'json_schema' ? { response_format: { type: 'json_schema', json_schema: { name: 'ui_document', schema: portable, strict: true } } } : {}),
    ...(provider.mode === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
    ...provider.extraBody
  };
  const started = Date.now();
  const response = await fetch(`${provider.baseURL.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  const text = await response.text();
  if (!response.ok) return { status: 'schema-rejected', httpStatus: response.status, error: text.slice(0, 800), ms: Date.now() - started };
  const content = JSON.parse(text).choices?.[0]?.message?.content ?? '';
  const result = validate(content, { contract });
  const fixed = result.valid ? result : fix(content, { contract });
  return { status: result.valid ? 'valid' : 'invalid', validAfterFix: fixed.valid, ms: Date.now() - started, bytes: content.length, errors: result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code} ${d.path}`), remainingAfterFix: fixed.valid ? [] : fixed.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code} ${d.path}`), content };
}

let results = [];
if (values.summarize) results = JSON.parse(await readFile(values.summarize, 'utf8')).results;
else {
  const results = [];
  for (const provider of providers) {
    for (const scenario of scenarios) {
      for (let i = 0; i < Number(values.runs); i++) {
        let outcome;
        try { outcome = await run(provider, scenario); } catch (error) { outcome = { status: 'error', error: error.message }; }
        results.push({ provider: provider.name, vendor: provider.vendor || provider.name, mode: provider.mode, scenario: scenario.id, run: i + 1, ...outcome });
        console.error(`${provider.name} ${scenario.id} #${i + 1}: ${outcome.status}${outcome.validAfterFix && outcome.status !== 'valid' ? ' (valid after fix)' : ''}${outcome.errors?.length ? ` (${outcome.errors.slice(0, 3).join('; ')})` : ''}${outcome.error ? ` ${outcome.error.slice(0, 200)}` : ''}`);
      }
    }
  }
}

// Go criteria from the implementation plan: each provider accepts the schema (or a documented
// adapter subset) and returns valid documents for the reference scenarios.
const configurations = [...new Map(results.map(r => [r.provider, r])).values()].map(({ provider, mode, vendor }) => ({ provider, mode, vendor: vendor || provider }));
const summary = configurations.map(({ provider, mode, vendor }) => {
  const rows = results.filter(r => r.provider === provider && r.status !== 'skipped');
  const counted = rows.filter(r => r.status !== 'error');
  const valid = counted.filter(r => r.status === 'valid').length, afterFix = counted.filter(r => r.validAfterFix).length;
  return { vendor, provider, mode, runs: rows.length, inconclusive: rows.length - counted.length, valid, validAfterFix: afterFix, schemaRejected: rows.some(r => r.status === 'schema-rejected'), go: counted.length > 0 && afterFix === counted.length };
});
console.table(summary);
const vendors = [...new Set(summary.filter(s => s.runs > s.inconclusive).map(s => s.vendor))];
const passing = vendors.filter(vendor => summary.some(s => s.vendor === vendor && s.go));
for (const vendor of vendors) console.error(`${vendor}: ${passing.includes(vendor) ? `GO (${summary.filter(s => s.vendor === vendor && s.go).map(s => s.mode).join(', ')})` : 'NO GO in every tested mode'}`);
console.error(vendors.length < 3 ? `INCOMPLETE: ${vendors.length} of 3 required providers tested; ${passing.length} passed.`
  : passing.length === vendors.length ? 'GO: keep the recursive schema.' : 'NO GO for at least one provider: evaluate an adapter subset or the flat component list.');
if (values.out) await writeFile(values.out, JSON.stringify({ date: new Date().toISOString(), contract: contract.id, summary, results }, null, 2));
