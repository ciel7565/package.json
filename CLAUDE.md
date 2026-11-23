# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

전통발효체험관 메타버스 — a 3D educational world for children (Three.js r170) that ships as **one HTML file**, plus an
optional PHP server (accounts, saves, chat, payments, allotment, admin site). Target hosting: Apache 2.4 (XAMPP on
Windows), **PHP 7.2**, **MariaDB 10.3**; SQLite is the default driver. The specification of every feature is
`docs/CONTRACT.md` (§12 kid rules, §14–§15 speed tiers / payments / security, §16 rendering / places / allotment / scale,
§17–§18 later phases). Read the section of what you touch before changing it; when code and contract disagree, say so.

## Commands

```bash
# Build a page to try (NEVER build without --out during development: the default output dist/metaverse and the tracked
# server/data/game-data.json belong to the release step)
node tools/build.mjs --no-font --no-assets --quiet --out /path/scratch/x.html   # fast test page
node tools/build.mjs --no-font --quiet --out /path/scratch/x.html              # with the texture / artwork pack
node tools/build.mjs --only 11,12 --out …   |   --exclude 70 --out …           # isolate fragments (core ones always in)
# The tool has no --help: an unknown flag still builds. Flags are documented in the header of tools/build.mjs.

# A private server copy (fresh directory each time)
D=/path/scratch/docroot-1 && mkdir -p $D && cp -a server/. $D/ && \
  node tools/build.mjs --no-font --quiet --out $D/index.html --data-out $D/data/game-data.json

# Browser checks (headless Chromium with software WebGL — slow; functional checks at quality=low)
node tools/smoke.mjs --file x.html --params "autostart=1&notutorial=1&quality=low" --json   # ready + 0 errors
node tools/smoke.mjs --file x.html --mode normal …      # normal (grown-up) mode;  --mobile --viewport 390x844 for phones
node tools/smoke.mjs --file x.html --script steps.mjs    # export default async (page, ctx) => {…};  --eval "return …"
node tools/kid-audit.mjs x.html [--both] [--screens a,b] # easy-mode screens: tap sizes, text sizes, dead ends (0 critical)

# Tests — one file is one suite; run a single one directly
php tests/allot-unit.php                                  # PHP unit suites (SQLite); MariaDB: TFM_DB_DRIVER=mysql
                                                          #   TFM_DB_HOST=… TFM_DB_PORT=… TFM_DB_USER=… TFM_DB_NAME=…
node tests/complex-plan.mjs | controls-unit.mjs | content-data.mjs | myroom-logic.mjs      # Node-only suites
node tests/<name>-client.mjs --file x.html                # browser suites (many take --only <ids>, --skip-medium, --skip-phone)
TFM_TOSS_MOCK=1 node tests/server-e2e.mjs --docroot $D    # functional end-to-end against a private docroot
node tests/security-e2e.mjs --docroot $D [--apache] [--only S03,S09]   # attack suite (ports: TFM_SEC_PORT_BASE, …)
node tests/admin-lock.mjs --docroot $D [--only <section>] # the admin site without JavaScript (fixed default ports)

# Static audits (all must stay clean)
bash tools/php-compat.sh          # PHP 7.2 syntax
node tools/sql-audit.mjs          # every dynamic SQL statement reviewed
node tools/secret-scan.mjs        # no secrets in the tree
node tools/text-audit.mjs --no-html   # forbidden word + no Chinese characters (see Conventions)
node tools/exposure-audit.mjs --docroot $D [--apache]

# Release (default build + zip into release/, verified): node tools/package.mjs
```

## Architecture

**Client = fragments.** `src/game/NN-name.js` files are plain scripts (no import / export, no top-level await).
`tools/build.mjs` concatenates them in file-name order inside one closure, each in its own `try` block, together with
`src/styles/*.css`, `src/template.html`, the vendored three.js bundle, the font and the asset pack (`assets/pack`, listed
in its `MANIFEST.json` with licences) into one HTML with a hash-based CSP (no eval, no wasm, no new hosts). Fragments
share state only through the global `G`:
- `G.data.*` — pure data (items, recipes, crops, zones, layout, the complex's master plan `G.data.complex`, …). The
  build evaluates the data fragments in Node and exports `server/data/game-data.json`, which is how the server knows
  every valid id — new ids must reach it through `G.data`, and data fragments must stay evaluable without DOM / THREE.
- `G.register({ name, order, init, update })` puts a system on `G.sys[name]`; systems talk through `G.bus` events and
  each other's public methods (documented in the header comment of each fragment — those headers are the API reference).
- `G.state` (the profile save, sanitised in `03-state.js`, validated again by the server), `G.settings` (per device),
  `G.net` (local file mode vs server mode), `G.ui`, `G.easy` (easy mode: the default, for young children),
  `G.sys.entitle` / `G.site` (what the account may do; operator settings sent by the server).
- Engine (`10-engine.js`): presets `low | medium | high` (`low` is frozen: no texture maps, no extra passes), a post
  chain, a black-region watchdog and a guard against NaN — new rendering must keep both quiet.
- **Places** (`18-places.js`): rooms and districts live far from the valley in the same scene; entering swaps bounds,
  ground, camera, light and zone behind one fade. Rooms are built with the hanok kit `G.hanok` (`19-hanok-kit.js`);
  the allotment complex `PL_ALLOT` is assembled from parts registered in `G.complexParts` (files 53–57, 44).
- The developer centre (`80-devcenter.js`) holds the source map, expected systems and in-page self-tests; new fragments
  and systems add their rows there.

**Server** (`server/`, namespace `Tfm\`): every endpoint is `Api::run([... method, auth, csrf, rate ...], fn)` with all
input checked by `Tfm\V`; SQL only through `Db` with bound parameters; `SaveValidator` re-checks saves against
`game-data.json`; `Settings` is a typed registry of operator settings (edited in the admin tab ⚙️ 설정, public subset
sent to the client as `site`); `Entitle` computes what an account may do. The admin site is `server/admin/index.php`
(server-rendered, works without JavaScript: POST + CSRF + same-origin + audit + 303); bigger tabs live in their own
`lib/Admin*.php`. Schema changes go into `database/schema.sql`, `schema.sqlite.sql` and the migration in `lib/Db.php`
together (one shared block per schema version, idempotent statements). CLI tools are in `server/cli/`.

## Conventions that are easy to break

- **PHP 7.2 syntax only** under `server/` (no arrow functions, `match`, typed properties, nullsafe, named arguments,
  `str_contains`, trailing commas in calls, …) and SQL that runs on MariaDB 10.3 **and** SQLite (no RETURNING, JSON
  functions, partial indexes; `rowCount` differs — a compare-and-set must change a value).
- **Text rules** (`tools/text-audit.mjs`): the word U+AC8C U+C784 must not appear anywhere — code, comments, documents,
  tests (say 체험관 / 체험 / 놀이); no Chinese characters in anything a visitor sees or in source strings.
- **Kid rules** (CONTRACT §12): easy mode needs no typing, tap targets ≥ 56 px, a `data-say` voice line, no prices, never
  a dead end, nothing flashing above 3 Hz, reduce-motion respected. Prices and anything that leaves the app sit behind
  the grown-up gate (`G.easy.gate`). No health claims in content.
- **Security** (CONTRACT §15.7): server text reaches the DOM as text (`textContent` / `G.ui.h`), never as unescaped
  HTML; secrets only in `config.local.php` / the environment; personal data sealed (`Crypto::seal`) and masked; uploads
  only through `Upload` (type by content, re-encoded); new endpoints are added to the attack suite's S03 / S09 lists.
- **Shared files are add-only**: `70-app.js`, `80-devcenter.js`, `08-easy.js`, `03-state.js`, `01-data.js`,
  `src/template.html`, `tools/build.mjs`, `tools/kid-audit.mjs`, `tools/package.mjs`, `server/admin/index.php`,
  `server/config/config.php`, `server/lib/bootstrap.php`, `Db.php` + schema files, `Settings.php`, `SaveValidator.php`,
  `tests/security-e2e.mjs`. Several people (or agents) edit them at once: small marked blocks (`// [topic]`), no
  reformatting, no reordering; commit only your own paths (`git add -- <files>` then `git commit … -- <files>`).
- Under browser automation (`navigator.webdriver`) pointer-lock mouse look and the real-time Korean clock are off by
  default so suites stay deterministic (`?mouselook=…`, `?clock=kst` switch them on).
- `tests/` and `assets/reference/` (the owner's planning images) are never shipped; `assets/pack` only holds files with
  a proven CC0 / public-domain licence.
- User-facing writing is calm, plain Korean with hard words explained.
