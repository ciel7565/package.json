// =============================================================================
// [opt] tools/minify.mjs — safe minification of the page's own code for tools/build.mjs (CONTRACT §14.7 / §16.11 / §19.4)
//
// minifyFragment(name, code, { mangle }) → { code, minified, reason }
//   One src/game fragment, exactly as the build wraps it: `try { <code> } catch (e) { __fragErr(<name>, e); }`.
//   It is minified on its own, as a strict-mode script, so that
//     - whitespace and comments go, and syntax is shortened (esbuild minifySyntax);
//     - with `mangle` (the default) the fragment's OWN names are shortened: everything a fragment declares lives in the
//       try block (block scope in strict mode), so no other fragment can see it — fragments share state only through G;
//     - free names stay as they are: G, THREE, ADDONS, window, document, __fragErr and every global. esbuild never gives
//       a local the name of a free name the fragment uses, so nothing is shadowed;
//     - property names are never touched (no mangleProps): G.* names, data ids, `name:` of systems, data-say texts and
//       every string survive byte for byte (charset utf8: Korean text stays as it is, not \u escapes);
//     - `var` at the top of a fragment (none today) would be top level of the script here and so keep its name, which is
//       what sharing it through the closure needs.
//   The result is checked: it must parse again in the real wrapper, must not pull in an esbuild helper (__publicField …),
//   and the catch must still name the fragment — otherwise the fragment is kept as it was (minified:false + reason).
// minifyCss(name, css) → { code, minified, reason }   one stylesheet: whitespace, comments, shorter colours / numbers.
// =============================================================================
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = 1;   // bump when the rules below change (the cache key of minifyFragmentCached)

// syntax the browsers of the page understand (WebGL2 already needs Safari 15 / Chrome 80+); esbuild never emits anything newer
const TARGET = ['es2020'];
const HELPERS = /\b__(publicField|defNormalProp|defProp|name|require|toESM|commonJS|export|async|spreadValues|objRest|privateIn|privateAdd|privateGet|privateSet|accessCheck)\b/;

export function wrapFragment(name, code) {
  return `try {\n${code}\n} catch (e) { __fragErr(${JSON.stringify(name)}, e); }`;
}

/** minifyFragment with a disk cache (opts.cacheDir): the same fragment text, name and options give the same result */
export function minifyFragmentCached(name, code, opts = {}) {
  if (!opts.cacheDir) return minifyFragment(name, code, opts);
  const key = crypto.createHash('sha256').update(`${VERSION}\0${esbuild.version}\0${opts.mangle !== false}\0${name}\0${code}`).digest('hex').slice(0, 32);
  const file = path.join(opts.cacheDir, `frag-${key}.json`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* not cached yet */ }
  const r = minifyFragment(name, code, opts);
  try { fs.mkdirSync(opts.cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(r)); } catch (e) { /* a cache is optional */ }
  return r;
}

export function minifyFragment(name, code, opts = {}) {
  const mangle = opts.mangle !== false;
  const raw = wrapFragment(name, code);
  const keep = (reason) => ({ code: raw, minified: false, reason });
  let out;
  try {
    out = esbuild.transformSync(`"use strict";\n${raw}`, {
      loader: 'js', format: undefined, target: TARGET, charset: 'utf8', legalComments: 'none', logLevel: 'silent',
      minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: mangle,
    }).code;
  } catch (e) {
    return keep('esbuild: ' + ((e.errors || [])[0]?.text || e.message));
  }
  const m = /^\s*(["'])use strict\1;?/.exec(out);
  if (!m) return keep('the strict directive was not kept');
  out = out.slice(m[0].length).trim();
  if (HELPERS.test(out) && !HELPERS.test(raw)) return keep('esbuild added a helper (' + HELPERS.exec(out)[0] + ')');
  if (!out.includes(`__fragErr(${JSON.stringify(name)},`)) return keep('the catch no longer names the fragment');
  try {
    esbuild.transformSync(`(function(){'use strict';const THREE=1,ADDONS=1,G={};function __fragErr(){}\n${out}\n})`, { loader: 'js', logLevel: 'silent' });
  } catch (e) {
    return keep('the result does not parse: ' + ((e.errors || [])[0]?.text || e.message));
  }
  return { code: out, minified: true, reason: null };
}

export function minifyCss(name, css) {
  try {
    const out = esbuild.transformSync(css, { loader: 'css', charset: 'utf8', legalComments: 'none', logLevel: 'silent', minify: true }).code.trim();
    return { code: out, minified: true, reason: null };
  } catch (e) {
    return { code: css, minified: false, reason: 'esbuild: ' + ((e.errors || [])[0]?.text || e.message) };
  }
}
