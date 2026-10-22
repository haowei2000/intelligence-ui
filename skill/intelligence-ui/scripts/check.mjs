#!/usr/bin/env node
// Applies deterministic fixes and validates a UI document. Prints one JSON object on stdout:
// { ok, valid, document | candidate, applied, diagnostics } or { ok: false, missing, message }.
// Usage: node check.mjs <file | -> [--deployment <contract-options.json>] [--write]
// Exit codes: 0 valid, 1 invalid, 2 usage, 3 missing dependency or I/O failure.
import { readFile, writeFile } from 'node:fs/promises';

const fail = (code, payload) => { process.stdout.write(JSON.stringify({ ok: false, ...payload }, null, 2) + '\n'); process.exit(code); };
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) fail(3, { missing: 'node>=22', message: `Node.js 22 or newer is required; found ${process.versions.node}.` });

let agent;
try { agent = await import('@haowei2000/intelligence-ui/agent'); }
catch { fail(3, { missing: '@haowei2000/intelligence-ui', message: 'Install the package where this script runs: npm install @haowei2000/intelligence-ui (or run `npx @haowei2000/intelligence-ui fix --format json <file>`).' }); }

const args = process.argv.slice(2);
const deploymentIndex = args.indexOf('--deployment');
const deployment = deploymentIndex >= 0 ? args[deploymentIndex + 1] : undefined;
const write = args.includes('--write');
const input = args.find((arg, i) => !arg.startsWith('--') && (deploymentIndex < 0 || i !== deploymentIndex + 1));
if (!input) fail(2, { message: 'Usage: node check.mjs <file | -> [--deployment <file>] [--write]' });

let text;
try {
  if (input === '-') { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); text = Buffer.concat(chunks).toString('utf8'); }
  else text = await readFile(input, 'utf8');
} catch (error) { fail(3, { message: `Cannot read ${input}: ${error.message}` }); }

let contract;
try { contract = deployment ? agent.createContract(JSON.parse(await readFile(deployment, 'utf8'))) : agent.standardContract(); }
catch (error) { fail(3, { message: `Cannot load deployment ${deployment}: ${error.message}` }); }

const result = agent.fix(text, { contract });
if (write && input !== '-' && (result.document ?? result.candidate) !== undefined) await writeFile(input, JSON.stringify(result.document ?? result.candidate, null, 2) + '\n');
process.stdout.write(JSON.stringify({ ok: true, contractId: contract.id, ...result }, null, 2) + '\n');
process.exit(result.valid ? 0 : 1);
