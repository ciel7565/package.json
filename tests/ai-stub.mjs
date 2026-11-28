#!/usr/bin/env node
// tests/ai-stub.mjs — a local stand-in for the Claude Messages API (CONTRACT §15.6 / §16.10), started by
// tests/ai-unit.php (anthropic.api_base → http://127.0.0.1:<port>/s/<scenario>). Nothing here talks to the internet.
//
//   node tests/ai-stub.mjs --port 31346 --key <the test key>
//
// Every POST …/s/<scenario>/v1/messages is checked against the request the server must send today:
//   method POST · content-type application/json · x-api-key = --key · anthropic-version 2026-10-21 ·
//   anthropic-beta server-side-fallback-2026-07-01 exactly when the model offers server-side fallbacks (then the body has
//   fallbacks: "default", else neither) · body keys only model / max_tokens / system / messages / output_config / fallbacks ·
//   no temperature / top_p / top_k / thinking · output_config.effort one of low…max · messages: plain text turns, the last
//   one from the user (no prefill) · max_tokens an integer 64 … 64000.
// A broken rule is recorded as a violation (GET /_log → {requests, violations, hits}); the reply is played anyway.
// Scenarios: ok · fallback · refusal · maxempty · maxpartial · r429 (one 429 with retry-after: 1, then ok) · r429long
// (always 429, retry-after: 30) · o529 (529 twice, then ok) · o529x (always 529) · noretry (500 + x-should-retry: false)
// · slow (answers after 8 s) · garbage (200, not JSON) · auth (401) · leak (401 whose message repeats the key) · echo
// (the answer is the user's text, as received). GET /_reset clears the log. Developer tooling; never deployed.
import http from 'node:http';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };
const PORT = Number(opt('port', '31346'));
const KEY = String(opt('key', 'stub-test-key'));
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const BODY_KEYS = new Set(['model', 'max_tokens', 'system', 'messages', 'output_config', 'fallbacks']);

let requests = [];
let violations = [];
let hits = {};

function check(scn, req, raw) {
  const v = [];
  const h = req.headers;
  if (req.method !== 'POST') v.push('method ' + req.method);
  if (h['content-type'] !== 'application/json') v.push('content-type ' + h['content-type']);
  if (h['x-api-key'] !== KEY) v.push('x-api-key is not the configured key');
  if (h['anthropic-version'] !== '2026-10-21') v.push('anthropic-version ' + h['anthropic-version']);
  if (h.authorization) v.push('an Authorization header was sent');
  let b = null;
  try { b = JSON.parse(raw); } catch { v.push('the body is not JSON'); }
  if (b && typeof b === 'object') {
    for (const k of Object.keys(b)) if (!BODY_KEYS.has(k)) v.push('unexpected body key ' + k);
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) if (k in b) v.push('forbidden key ' + k);
    if (typeof b.model !== 'string' || !b.model) v.push('model missing');
    if (!Number.isInteger(b.max_tokens) || b.max_tokens < 64 || b.max_tokens > 64000) v.push('max_tokens ' + b.max_tokens);
    if (!b.output_config || !EFFORTS.has(b.output_config.effort) || Object.keys(b.output_config).length !== 1) v.push('output_config ' + JSON.stringify(b.output_config));
    if ('system' in b && typeof b.system !== 'string') v.push('system is not a string');
    if (!Array.isArray(b.messages) || !b.messages.length) v.push('messages missing');
    else {
      for (const m of b.messages) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || Object.keys(m).length !== 2) v.push('bad message ' + JSON.stringify(m).slice(0, 80));
      }
      if (b.messages[0]?.role !== 'user') v.push('the first message is not from the user');
      if (b.messages[b.messages.length - 1]?.role !== 'user') v.push('the last message is an assistant prefill');
    }
    const wantsFallback = FALLBACK_MODELS.has(b.model);
    if (wantsFallback && b.fallbacks !== 'default') v.push('fallbacks should be "default" for ' + b.model);
    if (!wantsFallback && 'fallbacks' in b) v.push('fallbacks sent for ' + b.model);
    if (wantsFallback && h['anthropic-beta'] !== 'server-side-fallback-2026-07-01') v.push('anthropic-beta ' + h['anthropic-beta']);
    if (!wantsFallback && h['anthropic-beta']) v.push('anthropic-beta sent for ' + b.model);
  }
  const shownHeaders = {};
  for (const [k, val] of Object.entries(h)) shownHeaders[k] = k === 'x-api-key' ? '***' : val;
  requests.push({ scenario: scn, path: req.url, headers: shownHeaders, body: b });
  for (const x of v) violations.push(scn + ': ' + x);
  return b;
}

const message = (model, content, stop, extra = {}) => ({
  id: 'msg_stub', type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null,
  stop_details: stop === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: 'stub' } : null,
  usage: { input_tokens: 120, output_tokens: 48, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...extra },
});
const thinking = { type: 'thinking', thinking: '', signature: 'stub-signature' };
const errBody = (type, message) => JSON.stringify({ type: 'error', error: { type, message } });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/_log') return send(res, 200, { requests, violations, hits });
  if (req.method === 'GET' && req.url === '/_reset') { requests = []; violations = []; hits = {}; return send(res, 200, { ok: true }); }
  const m = /^\/s\/([a-z0-9]+)\/v1\/messages$/.exec(req.url || '');
  if (!m) return send(res, 404, errBody('not_found_error', 'no such path'));
  const scn = m[1];
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const b = check(scn, req, raw) || {};
    const n = (hits[scn] = (hits[scn] || 0) + 1);
    const model = typeof b.model === 'string' ? b.model : 'claude-opus-5-5';
    const lastUser = Array.isArray(b.messages) ? String(b.messages[b.messages.length - 1]?.content ?? '') : '';
    switch (scn) {
      case 'ok': return send(res, 200, message(model, [thinking, { type: 'text', text: '배추를 소금에 절여 양념을 발라요. ' }, { type: 'text', text: '항아리에서 천천히 익어요.' }], 'end_turn'));
      case 'fallback': return send(res, 200, message('claude-opus-5', [{ type: 'fallback', from: { model }, to: { model: 'claude-opus-5' } }, { type: 'text', text: '다른 모델이 답했어요.' }], 'end_turn',
        { iterations: [{ type: 'message', input_tokens: 60, output_tokens: 3 }, { type: 'fallback_message', input_tokens: 60, output_tokens: 45 }] }));
      case 'refusal': return send(res, 200, message(model, [{ type: 'text', text: '그건 중간까지만 쓴 글' }], 'refusal'));
      case 'maxempty': return send(res, 200, message(model, [thinking], 'max_tokens'));
      case 'maxpartial': return send(res, 200, message(model, [thinking, { type: 'text', text: '된장은 콩으로 만들어요. 그리고' }], 'max_tokens'));
      case 'r429': return n === 1 ? send(res, 429, errBody('rate_limit_error', 'slow down'), { 'retry-after': '1' }) : send(res, 200, message(model, [{ type: 'text', text: '기다렸다가 받은 답이에요.' }], 'end_turn'));
      case 'r429long': return send(res, 429, errBody('rate_limit_error', 'slow down'), { 'retry-after': '30' });
      case 'o529': return n <= 2 ? send(res, 529, errBody('overloaded_error', 'Overloaded')) : send(res, 200, message(model, [{ type: 'text', text: '세 번째에 받은 답이에요.' }], 'end_turn'));
      case 'o529x': return send(res, 529, errBody('overloaded_error', 'Overloaded'));
      case 'noretry': return send(res, 500, errBody('api_error', 'internal'), { 'x-should-retry': 'false' });
      case 'slow': { const t = setTimeout(() => send(res, 200, message(model, [{ type: 'text', text: '너무 늦은 답' }], 'end_turn')), 8000); res.on('close', () => clearTimeout(t)); return undefined; }
      case 'garbage': return send(res, 200, '<html>not json at all');
      case 'auth': return send(res, 401, errBody('authentication_error', 'invalid x-api-key'));
      case 'leak': return send(res, 401, errBody('authentication_error', 'invalid x-api-key ' + (req.headers['x-api-key'] || '')));
      case 'echo': return send(res, 200, message(model, [{ type: 'text', text: lastUser }], 'end_turn'));
      default: return send(res, 400, errBody('invalid_request_error', 'unknown stub scenario'));
    }
  });
});
server.listen(PORT, '127.0.0.1', () => { process.stdout.write(`ai-stub listening on ${PORT}\n`); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
