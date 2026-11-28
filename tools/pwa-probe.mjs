// =============================================================================
// [opt] tools/pwa-probe.mjs — the installable page in a real browser, against a private server copy (CONTRACT §18.6)
//
//   php -S 127.0.0.1:<port> -t <docroot>      (a server copy built with --data-out: index.html + sw.js + manifest …)
//   node tools/smoke.mjs --url http://127.0.0.1:<port>/ --params "autostart=1&notutorial=1&quality=low" --script tools/pwa-probe.mjs --json
//
// Checks (the result object; a failed check throws, so smoke fails):
//   W1 server mode (G.net.mode === 'server') · W2 the manifest link and the home-screen icon link are in the page ·
//   W3 the worker is active and controls the page after a reload · W4 its cache holds the shell, and nothing of api/ ·
//   W5 offline, the page answers offline.html (calm text, two links) · W6 offline with ?local=1 the stored page starts
//   in local mode · W7 the manifest parses and names its icons, which load. A page opened as a file is checked by smoke
//   itself (no worker, no manifest link: G.net.mode is 'local').
// =============================================================================
export default async (page, ctx) => {
  const out = {};
  const must = (name, ok, detail) => { out[name] = ok ? (detail ?? true) : `FAIL ${detail ?? ''}`; if (!ok) throw new Error(`${name} failed: ${detail ?? ''}`); };
  const base = new URL(page.url());
  const home = new URL('./', base).href;

  must('W1 server mode', await page.evaluate(() => G.net?.mode === 'server'), await page.evaluate(() => G.net?.mode));
  const links = await page.evaluate(() => ({ manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'), icon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') }));
  must('W2 manifest + icon links', links.manifest === 'manifest.webmanifest' && links.icon === 'icons/icon-180.png', JSON.stringify(links));

  const ready = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => r.active?.state || 'none'), new Promise((r) => setTimeout(() => r('timeout'), 60000))]));
  must('W3 worker active', ready === 'activated' || ready === 'activating', ready);
  // the shell is stored while the worker installs — wait until the cache holds the page
  const cached = await page.evaluate(async () => {
    for (let i = 0; i < 120; i++) {
      const keys = await caches.keys();
      const k = keys.find((x) => x.startsWith('tfm-shell-'));
      if (k) { const c = await caches.open(k); const reqs = (await c.keys()).map((r) => new URL(r.url).pathname); if (reqs.some((p) => p.endsWith('/offline.html')) && reqs.some((p) => p.endsWith('/'))) return { k, reqs }; }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { k: null, reqs: [] };
  });
  must('W4 the shell is cached, never the API', !!cached.k && cached.reqs.length >= 7 && !cached.reqs.some((p) => /\/api\/|\.php$/.test(p)), `${cached.k} · ${cached.reqs.join(' ')}`);

  await page.goto(home + '?autostart=1&notutorial=1&quality=low', { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.G && G.ready === true, null, { timeout: 240000, polling: 500 });
  must('W3 the reloaded page is controlled', await page.evaluate(() => !!navigator.serviceWorker.controller));

  const man = await page.evaluate(async () => { const r = await fetch('manifest.webmanifest'); const j = await r.json(); const ok = []; for (const i of j.icons) { const x = await fetch(i.src); ok.push(x.ok && (x.headers.get('content-type') || '').includes('png')); } return { name: j.short_name, start: j.start_url, icons: ok }; });
  must('W7 manifest + icons', man.start === './' && man.icons.length === 3 && man.icons.every(Boolean), JSON.stringify(man));

  await page.context().setOffline(true);
  try {
    await page.goto(home, { waitUntil: 'load', timeout: 60000 });
    const off = await page.evaluate(() => ({ title: document.title, h1: document.querySelector('h1')?.textContent, links: document.querySelectorAll('a').length, scripts: document.scripts.length }));
    must('W5 offline: the calm page', /연결/.test(off.h1 || '') && off.links === 2 && off.scripts === 0, JSON.stringify(off));
    await page.goto(home + '?local=1&autostart=1&notutorial=1&quality=low', { waitUntil: 'load', timeout: 240000 });
    await page.waitForFunction(() => window.G && G.ready === true, null, { timeout: 240000, polling: 500 });
    must('W6 offline ?local=1: the stored page in local mode', await page.evaluate(() => G.net?.mode === 'local'), await page.evaluate(() => G.net?.mode));
  } finally {
    await page.context().setOffline(false);
  }
  return out;
};
