#!/usr/bin/env node
// =============================================================================
// [opt] tools/weight.mjs — what a built page weighs, part by part (CONTRACT §19.4 / §16.0 budgets)
//
//   node tools/weight.mjs <page.html> [--json out.json] [--md out.md] [--top 25] [--fast] [--budget]
//
// Splits one built page into its parts and reports raw, gzip (level 9) and brotli (quality 11, --fast: 9) bytes of
// each part on its own, plus the whole page:
//   font/<weight>        each embedded @font-face (base64 woff2) of <style id="embedded-font">
//   css/<file>           each stylesheet (the build's /* ==== file ==== */ markers; one part when they are gone)
//   vendor/three         the bundled three.js (the inline script that starts with /*! three.js)
//   game/__BUILD__       the window.__BUILD__ object (manifest + kid-safety test vectors)
//   game/<fragment>      each src/game fragment (the build's fragment markers, unminified or minified)
//   docs                 <script id="build-docs"> (the documents shown in the developer centre)
//   pack/manifest        <script id="pack-manifest">
//   pack/<name>          each asset-pack block (base64 inside an inert script); bin = its decoded bytes
//   other                everything else (template markup, small scripts, the CSP meta)
// The parts add up to the page exactly (checked). Compressed sizes of the parts do not add up to the compressed page
// (a compressor shares its dictionary across the page) — they show where the weight is, the page line shows the total.
// --budget exits 1 when the page is over the §16.0 budget for its kind (release: font + pack → 12.5 MB raw / 7 MB
// brotli; test build without font and pack → 6.8 MB raw).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const file = args.find((a) => !a.startsWith('--') && !['--json', '--md', '--top'].includes(args[args.indexOf(a) - 1]));
if (!file || !fs.existsSync(file)) { console.error('usage: node tools/weight.mjs <page.html> [--json out.json] [--md out.md] [--top 25] [--fast] [--budget]'); process.exit(2); }
const FAST = flag('--fast');
const TOP = Number(opt('--top', 30)) || 30;

const html = fs.readFileSync(file, 'utf8');
const B = (s) => Buffer.byteLength(s, 'utf8');
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const br = (buf) => zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: FAST ? 9 : 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length;

/** @type {{ part: string, group: string, text: string, bin?: number }[]} */
const parts = [];
let cursor = 0;
const other = [];
const take = (from, to) => { if (to > from) other.push(html.slice(from, to)); };
const add = (group, part, text, extra) => { parts.push({ group, part, text, ...(extra || {}) }); };

// split a game script into __BUILD__, fragments (by the build's markers) and the rest
function splitGame(body) {
  const out = [];
  let rest = body;
  const bm = /window\.__BUILD__\s*=\s*\{/.exec(rest);
  if (bm) {
    // string-aware bracket match from the '{'
    let i = bm.index + bm[0].length - 1, depth = 0, q = null;
    for (; i < rest.length; i++) {
      const c = rest[i];
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    const end = rest.indexOf(';', i) + 1;
    out.push(['game', 'game/__BUILD__', rest.slice(0, end)]);
    rest = rest.slice(end);
  }
  // unminified markers: "// ====…==== NAME\ntry {" ; minified markers: "//@ NAME\n"
  const re = /\n(?:\/\/ =+ ([\w.-]+\.js)\n|\/\/@ ([\w.-]+\.js)\n)/g;
  const marks = [];
  let m;
  while ((m = re.exec(rest))) marks.push({ at: m.index, name: m[1] || m[2] });
  if (!marks.length) { out.push(['game', 'game/(script)', rest]); return out; }
  out.push(['game', 'game/(prologue)', rest.slice(0, marks[0].at)]);
  for (let k = 0; k < marks.length; k++) {
    const to = k + 1 < marks.length ? marks[k + 1].at : rest.length;
    let seg = rest.slice(marks[k].at, to);
    if (k === marks.length - 1) {
      // the boot epilogue after the last fragment's catch
      const ep = seg.search(/\nfunction __boot\(|function __boot\(/);
      if (ep > 0) { out.push(['game', `game/${marks[k].name}`, seg.slice(0, ep)]); out.push(['game', 'game/(epilogue)', seg.slice(ep)]); continue; }
    }
    out.push(['game', `game/${marks[k].name}`, seg]);
  }
  return out;
}

function splitCss(body) {
  const re = /\/\* ==== ([\w.-]+\.css) ==== \*\//g;
  const marks = [];
  let m;
  while ((m = re.exec(body))) marks.push({ at: m.index, name: m[1] });
  if (!marks.length) return [['css', 'css/(all)', body]];
  const out = [];
  if (marks[0].at > 0) out.push(['css', 'css/(head)', body.slice(0, marks[0].at)]);
  for (let k = 0; k < marks.length; k++) out.push(['css', `css/${marks[k].name}`, body.slice(marks[k].at, k + 1 < marks.length ? marks[k + 1].at : body.length)]);
  return out;
}

// walk <style> and <script> elements in order
const tagRe = /<(style|script)(\s[^>]*)?>/g;
let tm;
while ((tm = tagRe.exec(html))) {
  const tag = tm[1];
  const attrs = tm[2] || '';
  const openEnd = tm.index + tm[0].length;
  const close = html.indexOf(`</${tag}>`, openEnd);
  if (close < 0) break;
  const body = html.slice(openEnd, close);
  const whole = [tm.index, close + tag.length + 3];
  let pieces = null;
  if (tag === 'style' && /id="embedded-font"/.test(attrs)) {
    pieces = [];
    const fre = /@font-face\{[^}]*font-weight:(\d+)[^}]*\}/g;
    let fm, last = 0;
    while ((fm = fre.exec(body))) { if (fm.index > last) other.push(body.slice(last, fm.index)); pieces.push(['font', `font/${fm[1]}`, fm[0]]); last = fm.index + fm[0].length; }
    if (last < body.length) other.push(body.slice(last));
  } else if (tag === 'style' && /\/\* ==== /.test(body)) {
    pieces = splitCss(body);
  } else if (tag === 'style' && body.length > 20000) {
    pieces = [['css', 'css/(all)', body]];
  } else if (tag === 'script' && /data-pack="([^"]+)"/.test(attrs)) {
    const name = /data-pack="([^"]+)"/.exec(attrs)[1];
    pieces = [['pack', `pack/${name}`, body, { bin: Buffer.from(body, 'base64').length }]];
  } else if (tag === 'script' && /id="pack-manifest"/.test(attrs)) {
    pieces = [['pack', 'pack/manifest', body]];
  } else if (tag === 'script' && /id="build-docs"/.test(attrs)) {
    pieces = [['docs', 'docs', body]];
  } else if (tag === 'script' && !attrs.trim() && /^\s*\/\*! three\.js/.test(body)) {
    pieces = [['vendor', 'vendor/three', body]];
  } else if (tag === 'script' && !attrs.trim() && /window\.__BUILD__/.test(body)) {
    pieces = splitGame(body);
  }
  if (!pieces) continue;
  take(cursor, openEnd);
  for (const [g, p, t, x] of pieces) add(g, p, t, x);
  cursor = close;
  tagRe.lastIndex = whole[1];
}
take(cursor, html.length);
add('other', 'other', other.join(''));

// every inline script that runs must be allowed by its exact hash in the page's CSP (a minified script gets a new hash)
const cspMeta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
const cspHashes = new Set(((cspMeta && cspMeta[1]) || '').match(/'sha256-[^']+'/g) || []);
const csp = { scripts: 0, allowed: 0 };
html.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => { csp.scripts++; if (cspHashes.has(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`)) csp.allowed++; return m; });
csp.ok = !!cspMeta && csp.scripts === csp.allowed;

const total = B(html);
const sum = parts.reduce((a, p) => a + B(p.text), 0);
if (sum !== total) { console.error(`✖ parts add up to ${sum} bytes, the page has ${total}`); process.exit(1); }

const t0 = Date.now();
for (const p of parts) { const buf = Buffer.from(p.text, 'utf8'); p.raw = buf.length; p.gzip = gz(buf); p.brotli = br(buf); delete p.text; }
const pageBuf = Buffer.from(html, 'utf8');
const page = { raw: total, gzip: gz(pageBuf), brotli: br(pageBuf) };
const groups = {};
for (const p of parts) { const g = (groups[p.group] ||= { raw: 0, gzip: 0, brotli: 0, n: 0, bin: 0 }); g.raw += p.raw; g.gzip += p.gzip; g.brotli += p.brotli; g.n++; g.bin += p.bin || 0; }
const kind = groups.font && groups.pack ? 'release' : !groups.font && !groups.pack ? 'test' : 'mixed';
const BUDGET = { release: { raw: 12.5e6, brotli: 7e6 }, test: { raw: 6.8e6 }, mixed: {} }[kind];
const over = (BUDGET.raw && page.raw > BUDGET.raw) || (BUDGET.brotli && page.brotli > BUDGET.brotli);

const MB = (n) => (n / 1e6).toFixed(3) + ' MB';
const KB = (n) => (n / 1024).toFixed(1) + ' KB';
const lines = [];
lines.push(`# Weight of ${path.basename(file)} (${kind} page)`, '');
lines.push(`page: raw ${MB(page.raw)} · gzip ${MB(page.gzip)} · brotli ${MB(page.brotli)}${BUDGET.raw ? ` — budget raw ${MB(BUDGET.raw)}${BUDGET.brotli ? ` / brotli ${MB(BUDGET.brotli)}` : ''}: ${over ? 'OVER' : 'inside'}` : ''}`, '');
lines.push(`CSP: ${csp.allowed}/${csp.scripts} inline scripts allowed by their hash — ${csp.ok ? 'ok' : 'MISMATCH'}`, '');
lines.push('| group | parts | raw | gzip | brotli | share of raw |', '|---|---:|---:|---:|---:|---:|');
for (const [g, v] of Object.entries(groups).sort((a, b) => b[1].raw - a[1].raw)) lines.push(`| ${g} | ${v.n} | ${KB(v.raw)} | ${KB(v.gzip)} | ${KB(v.brotli)} | ${(v.raw / total * 100).toFixed(1)} % |`);
lines.push('', `## The ${TOP} largest parts`, '', '| part | raw | gzip | brotli |', '|---|---:|---:|---:|');
for (const p of [...parts].sort((a, b) => b.raw - a.raw).slice(0, TOP)) lines.push(`| ${p.part}${p.bin ? ` (bin ${KB(p.bin)})` : ''} | ${KB(p.raw)} | ${KB(p.gzip)} | ${KB(p.brotli)} |`);
const md = lines.join('\n') + '\n';
const json = { file: path.resolve(file), kind, page, budget: BUDGET, over: !!over, csp, groups, parts, ms: Date.now() - t0 };
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(json, null, 1));
if (opt('--md')) fs.writeFileSync(opt('--md'), md);
process.stdout.write(md);
if (!csp.ok) process.exit(1);
if (flag('--budget') && over) process.exit(1);
