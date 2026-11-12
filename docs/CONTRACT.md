# 전통발효체험관 메타버스 — Module Contract (for every implementer)

This is the binding interface contract between modules. Read it fully before writing code.
The game is ONE self-contained HTML file built from fragments. 3D = Three.js r170, UI = HTML/CSS, data = `G.data`,
saves = `G.save` (localStorage, or PHP API in server mode).

## 0. Ground rules

- **Fragments**: each `src/game/NN-name.js` is plain script code (NO `import`/`export`, NO top-level `await`).
  `tools/build.mjs` concatenates them in filename order inside one closure and wraps each one in its own
  `try { ... }` block. Available closure variables: `THREE` (three r170 namespace), `ADDONS`
  (`Sky, Lensflare, LensflareElement, BufferGeometryUtils, SimplexNoise, EffectComposer, RenderPass,
  UnrealBloomPass, OutputPass, RoundedBoxGeometry, GLTFLoader`) and `G` (global namespace, also `window.G`).
  Top-level names are private to the fragment; share things only through `G`.
- **CSS**: put module CSS in `src/styles/NN-name.css` using the same NN prefix as your JS. Reuse the tokens and
  components from `src/styles/00-base.css` (`.glass .panel .btn .btn-primary .btn-gold .btn-sm .chip .bar
  .tabs .tab .card .list .list-item .grid .slot .field .seg .pick .pick-grid .kv .stat .notice-box .empty`...).
  Keep the look of the reference images: dark translucent glass panels, green accents, gold highlights.
- **Only edit the files you own** (see §10). If you need something from another module, code against this
  contract with optional chaining (`G.sys.quest?.accept?.(id)`), and list the request in your final report.
- **No external assets or network**: everything (models, textures, sounds, icons) is procedural or inline.
  The only network calls are `G.net.request(...)` in server mode.
- **Robustness**: never assume another system exists. Wrap risky code. Use `G.log.info('FARM', ...)` style
  logging with the spec categories ([AUTH] [PLAYER] [QUEST] [FARM] [FERMENTATION] [INVENTORY] [API] [NETWORK] [SAVE] [UI] ...).
- **Korean UI text** everywhere (the audience is Korean). Code comments may be English.
- **Performance**: target ≥30 FPS on a mid laptop. Use `InstancedMesh` for repeated things, merge static
  geometry per material (`ADDONS.BufferGeometryUtils.mergeGeometries`), share materials (`G.gfx.material(key, fn)`),
  avoid per-frame allocations, keep total draw calls low (~<400 on high). Read `G.sys.engine.preset`
  (`treeDensity`, `grassDensity`, `shadows`, `name`) at init to scale density.
- **Education honesty**: facts are short, general, widely accepted summaries; fermentation numbers are a game
  simulation — say so in UI (`G.data.meta.disclaimer`). Never present game titles as real qualifications.

## 1. Build & test

```bash
SCR=/tmp/claude-0/-home-user-package-json/cc4c183b-3c8c-56f9-afc9-107602ef1727/scratchpad/<you>
mkdir -p $SCR
node tools/build.mjs --out $SCR/game.html --no-font --quiet          # all fragments (syntax-broken ones are skipped with a warning)
node tools/build.mjs --out $SCR/game.html --no-font --only 11,12,20  # core + only the listed prefixes (isolate from other in-progress modules)
node tools/smoke.mjs --file $SCR/game.html --params "autostart=1&notutorial=1&quality=medium" --shot $SCR/a.png --wait 3000
node tools/smoke.mjs --file $SCR/game.html --eval "G.sys.player?.teleport?.(40,0); await new Promise(r=>setTimeout(r,1500)); return G.sys.player?.position" --shot $SCR/b.png
node tools/smoke.mjs --file $SCR/game.html --script $SCR/steps.mjs   # export default async (page, ctx) => { ...page.screenshot({path}) ... }
```
- `smoke.mjs` waits for `G.ready === true`, prints page/console errors, fragment errors (`G.__fragmentErrors`),
  system errors (`G.__systemErrors`) and exits 1 if any occurred — or if `--eval` / `--script` threw (a failed
  assertion in a step script fails the run). `--viewport 1366x768`, `--mobile` are available.
- Headless WebGL is software (SwiftShader): low FPS there is expected. Judge visuals by **reading the PNG
  screenshots** (Read tool) and iterate until it looks good. Use quality=medium or high for visual checks.
- URL params: `autostart=1` (skip title, guest login), `notutorial=1`, `quality=low|medium|high`, `debug=1`, `local=1`.
- Other agents edit other files at the same time; if the full build shows errors from modules you do not own,
  rebuild with `--only` to isolate, and mention those errors in your report.

## 2. Core (already implemented — read these files)

| File | Provides |
|---|---|
| `00-core.js` | `G.log`, `G.bus` (on/once/off/emit), `G.util` (clamp, lerp, damp, angleDiff, angleLerp, rng(seed), hash, uid, clone, defaults, debounce, throttle, formatDuration, formatDate, escapeHtml, isTyping, pointInPoly, distToPolyline, fmt), `G.time.now()` (server-adjusted ms), `G.icon(name)`, `G.register(system)`, loop, `G.sfx(name)`, `G.activity(type, text)`, `G.dirty(reason)`, `G.start` / `G.devBoot` |
| `01-data.js` | all content data: zones, pois, items, crops, recipes, crafts, shops, npcs, quests, achievements, levels, collection, emotes, gestures, weather, dayPhases, tips, visitors, badWords, meta |
| `02-layout.js` | `G.data.layout`: spawn, bounds, river, ponds, roads, paths, plaza, buildings, jangdokdae, jars, jarDisplays, farmPlots, signs, kiosks, hallDoor, eduBoard, exhibits, craftTable, tools, shopStall, photoZones, lanterns, benches, parking, riverDeck, flowerBeds, landmarkTrees, stoneWalls; `layout.get(id)` |
| `03-state.js` | `G.settings` + `G.setSetting(k,v)` (emits `settings:changed`), `G.net` (mode, request), `G.save` (useProfile, load, save, markDirty, startAutosave, createDefaultState, resetProgress, exportJSON, importJSON) |
| `04-ui.js` | `G.ui`: `h, esc, hydrateIcons, setIcon, toast, banner, zoneBanner, objective, modal.open/get/isOpen/closeTop/closeAll, confirm, alert, rewardPopup, popover.open/close, label, loading, fade, fadeThrough, flash, setHudVisible, onAction, triggerAction, setActive, setBadge, onEscape, block, unblock, isBlocking, bar, itemIcon, itemName, tabs` |
| `05-input.js` | `G.input`: `axis {x,y}`, `running`, `update()`, `consumeJump()`, `consumeLook()`, `consumeZoom()`, `onKey(code, fn, opts)`, `isDown`, `gameplay()`, `hasTouch/touchUI`; events `input:interact`, `input:click {x,y,button}`, `input:move-start`, `input:menu` |
| `06-world.js` | `G.world`: `setTerrain`, `terrainHeight`, `heightAt(x,z,fromY)`, `addWalkable`, `addCollider/removeCollider/moveCollider`, `resolve(pos,r,feetY)`, `blocked`, `setWaterFn/isWater`, `setSurfaceFn/surfaceAt`, `zoneAt`, `poiAt`, `zoneById`, `registerObject/getObject/anchor`, `groundMeshes`, `cameraBlockers`, `nightMaterials/addNightMaterial`, `nightLights/addNightLight`, `nightFactor`, `clampToBounds`, `debugDraw(on)` |
| `10-engine.js` | `G.sys.engine` (renderer, scene, camera, sun, hemi, sky, composer, focus, sunDir, preset, quality, setSun, setQuality, updateEnvironment, raycastScreen, worldToScreen, onResize), `G.gfx` (canvasTexture, material cache, radialTexture, signTexture), `G.assets` (loadGLB, tryOverride for `G.data.modelOverrides`) |

### System lifecycle
```js
G.register({
  name: 'farming', order: 60, label: '농장',   // label shown on the loading screen
  init() {},                 // build meshes/UI once (may be async). G.state is NOT available yet.
  postInit() {},             // optional, after every init
  onStateLoaded(state) {},   // called after login/load/reset/import: (re)sync visuals & UI from G.state
  update(dt, t) {},          // every frame (only after init succeeded)
  onLogout() {},             // clear per-user things
  /* public API methods ... */
});
```
Init order (by `order`): engine 0, terrain 10, nature 12, water 13, buildings 20, props 25, player 30, camera 35,
interaction 40, npc 45, dialogue 46, inventory 50, quest 52, progression 54, farming 60, fermentation 62,
education 64, journal 66, minimap 70, weather 72, photo 74, social 80, audio 85, app 90.
`G.state` exists from the first `onStateLoaded` until logout. After mutating `G.state` call `G.dirty('reason')`.

## 3. Coordinates & world conventions
- Meters, Y up, **north = -Z**, east = +X. Playable box ±135. Ground at plaza y = 0. Water surface `layout.waterY` (-1.1).
- Model facing: a character/building with `rotation.y = 0` faces **+Z**; facing angle from a direction `(dx,dz)` is `Math.atan2(dx, dz)`.
- Building footprint `w` along local X, `d` along local Z (front = +Z side). Box colliders use `hw=w/2, hd=d/2, rot`.
- `G.world.heightAt(x, z, feetY)` is the ground for walkers (terrain + walkable platforms ≤ feetY + 0.62).
- Avatars are ~1.45 m tall chibi characters (big head), collision radius 0.35.

## 4. Events (`G.bus`) — names and payloads are fixed

| Event | Payload | Emitted by |
|---|---|---|
| `game:ready` / `game:login` | – / `{profile, isNew}` | app (core devBoot emits game:ready) |
| `state:loaded` / `state:saved` / `state:before-save` | state / `{reason}` | core |
| `settings:changed` | `{key, value}` | core |
| `zone:enter` / `zone:exit` | `{zoneId, zone, first}` | minimap |
| `poi:enter` | `{poiId, poi, first}` | minimap |
| `player:moved` | `{x, z}` (≤4/s) | player |
| `player:distance` | `{meters}` (batched ≥ 5 m) | player |
| `interact` | `{kind, id}` | interaction (after any onInteract) |
| `npc:talk` | `{npcId}` | npc/dialogue (conversation start) |
| `dialogue:end` | `{npcId, dialogueId}` | dialogue |
| `item:added` / `item:removed` | `{itemId, qty, source}` | inventory |
| `farm:watered` / `farm:planted` / `farm:harvested` | `{plotId, cropId}` / same / `{plotId, cropId, itemId, qty}` | farming |
| `ferment:checked` / `ferment:started` / `ferment:completed` / `ferment:claimed` | `{jarId}` / `{jarId, recipeId}` / same / `{jarId, recipeId, quality, itemId, qty}` | fermentation |
| `craft:done` | `{craftId}` | fermentation |
| `edu:viewed` / `edu:completed` | `{eduId, page}` / `{eduId}` | education |
| `quiz:answered` | `{quizId, correct}` | education |
| `journal:created` | `{entry}` | journal |
| `photo:taken` | `{photoId, zoneId, photoZoneId}` | photo |
| `emote:played` / `gesture:played` | `{emoteId}` / `{gestureId}` | social |
| `chat:sent` / `chat:message` | `{text, channel}` / `{msg}` | social |
| `chat:mention` | `{msg}` (a chat message that @mentions my nickname) | social → engagement 알림함 |
| `chat:retracted` | `{ids:['s<n>'], users:['<uid>']}` (moderation took those lines / every line of those accounts back, 13.10) | social → engagement 알림함 |
| `save:auth-lost` / `save:recovered` | `{reason, notify}` (03) or `{source:'social'}` (60) / – | core, social → app (13.10) |
| `quest:accepted` / `quest:progress` / `quest:completed` / `quest:claimed` | `{questId}` / `{questId, objective, value, target}` / `{questId}` / `{questId, reward}` | quest |
| `reward:granted` | `{reward, reason}` | progression |
| `level:up` | `{level}` | progression |
| `achievement:unlocked` / `collection:unlocked` | `{id}` | progression |
| `weather:changed` / `time:phase` | `{id}` / `{phase}` | weather |
| `photo:mode` | `{active}` | photo |
| `ui:modal-open` / `ui:modal-close` | `{id}` | core |

**Stats ownership**: systems only EMIT events; the progression system listens and increments `G.state.stats`
(waters, plants, harvests, harvestedItems, fermentsStarted, fermentsClaimed, fermentChecks, quizAnswered,
quizCorrect, eduCompleted, journals, photos, emotes, gestures, chats, talks, crafts, interacts, distance, logins)
plus `cropKinds`, `npcsTalked`. Derived stats for achievements: `level`, `zonesVisited` (count of `G.state.visited`
in `G.data.visitZones`), `npcsTalked` (count), `cropKinds` (count), `socials` (emotes+gestures).

## 5. State shape (`G.save.createDefaultState`) — who writes what
`profile{id,nickname,email,role,avatar,title,titles}` app+progression · `stats` progression · `player{x,y,z,rotY,zoneId}`
player (+zoneId minimap) · `inventory{itemId:qty}` inventory · `quests{id:{status,progress[],acceptedAt,completedAt,claimedAt,tracked}}`
quest · `farm.plots{id:{cropId,growth,water,health,plantedAt,lastUpdate,lastWaterAt,harvests}}` farming ·
`jars{id:{owned,recipeId,status,progress,quality,hygiene,startedAt,lastUpdate,care:{},completedAt,claimedAt}}` fermentation ·
`education{viewed,completed,quiz}` education · `journal[]` journal · `photos[]` photo · `achievements{}` `collection{}`
`cropKinds{}` `npcsTalked{}` progression · `visited{}` `poisVisited{}` minimap · `flags{}` anyone (namespaced keys like
`'tutorial:moved'`) · `tutorial{step,done}` app · `activity[]` via `G.activity()` · `blocked[]` social.
Time values use `G.time.now()` (ms). Growth/fermentation must be computed from timestamps so offline time counts.

## 6. Module APIs to implement

### 6.1 Terrain / nature / water (`11-terrain.js`, `12-nature.js`, `13-water.js`)
- `G.register({name:'terrain', order:10})`: heightfield mesh (vertex colors grass/dirt/rock by slope/height), playable
  area gently undulating but **flat (y≈0) on the plaza, zones, building footprints, plots, paths and roads**; mountains
  rising beyond ~r120 (valley look of the reference images, taller in the north and east beyond the river).
  Must call `G.world.setTerrain(fn)`, `G.world.setWaterFn(fn)` (river + ponds), `G.world.setSurfaceFn(fn)`
  ('road' on asphalt, 'stone'/'dirt'/'wood' on paths, 'water', 'sand' on banks, else 'grass'), push ground meshes into
  `G.world.groundMeshes`. Roads (asphalt + lane markings + curbs) and paths (stone slabs / dirt) per layout.
- `G.register({name:'nature', order:12})`: instanced trees (pine, deciduous, zelkova, maple; color variety), dense forest on
  mountain slopes, scattered rocks, grass tufts (by `preset.grassDensity`), flowers in `layout.flowerBeds`, landmark trees
  (`layout.landmarkTrees`), drifting clouds, a few birds; **never place on zones/plaza/paths/roads/buildings/water** (use
  the layout + `G.world.zoneAt`). Colliders for trunks/rocks inside the playable box. Optional fireflies at night.
- `G.register({name:'water', order:13})`: animated river + ponds (shader: flow, fresnel, env reflection, foam at edges),
  hall-garden waterfall (`ponds[].waterfall`) with spray particles, river banks with rocks. Expose `G.sys.water.distanceToWater(x,z)`
  for audio.

### 6.2 Buildings / props (`15-buildings.js`, `16-props.js`) — may fine-tune `02-layout.js`
- `G.register({name:'buildings', order:20})`: every `layout.buildings` entry with box colliders and
  `G.world.cameraBlockers` meshes; `G.world.registerObject(id, group)`; try `G.assets.tryOverride(id, group)`.
  Types: `hall` (reference image 1: large multi-storey glass curtain-wall building with wooden balconies and layered
  hanok giwa roofs with upturned eaves), `hanok` (stone base, wooden pillars, hanji windows, curved tile roof),
  `classroom` (hanok-style education hall), `storage` (stone+wood storehouse, big open door with jars inside),
  `thatched` (초가집: rounded straw roof, mud walls), `pavilion` (정자: posts + hip roof on platform; walkable floor),
  `gate` (솟을대문/일주문 with central opening — colliders only on the sides), `stall` (매점 stall with awning).
  Windows emissive at night via `G.world.addNightMaterial`.
- `G.register({name:'props', order:25})`: plaza circle paving + hall plaza, **jangdokdae** (walkable platforms from
  `layout.jangdokdae.platforms` with stone retaining walls/steps, instanced decorative jars in rows + spiral rings
  in 2–3 sizes with lids — leave the `layout.jars` spots J1–J3 EMPTY, fermentation builds those), farm plot beds
  (raised soil boxes with wood frames for every `layout.farmPlots`; set `group.userData.soilMaterial` so farming can
  darken wet soil, `registerObject(plot.id, group)`), signs (wooden boards with `G.gfx.signTexture(title)`),
  kiosks (stand + glowing screen), exhibit tables (bowls/jars of each food), craft table, traditional tools
  (지게, 맷돌, 절구, 키, 호미, 시루), jar displays (독/중두리/항아리/단지), shop stall goods, lanterns (stone 석등 / post
  청사초롱; night glow via addNightMaterial/addNightLight — max ~6 real lights), benches (`registerObject('BENCH_'+i)`),
  parking lot with cars, river deck (walkable), edu board, hall door, photo-zone wooden frames, low stone walls,
  fences around plots. Register EVERY interactive anchor with `G.world.registerObject(id, obj)` (ids from layout).
  Colliders for solid props.

### 6.3 Avatar / player / camera / interaction (`20-avatar.js`, `21-player.js`, `22-camera.js`, `23-interaction.js`)
```text
G.avatar.defaultAppearance, G.avatar.options{skin,hair,hairColor,top,topColor,bottom,bottomColor,shoes,bag,bagColor,accessory,accessoryColor,face}
G.avatar.labels (Korean names for keys and option values), G.avatar.random(seed) -> appearance
G.avatar.create(appearance, {shadow=true}) -> rig
  rig.group (feet at y=0, faces +Z, ~1.45 m), rig.height, rig.headAnchor (Object3D above head), rig.handR
  rig.update(dt, {speed (m/s), grounded, vy})        // locomotion blend idle/walk/run/jump/fall
  rig.setAnim(name, {loop=false, duration, speed=1}) // action layered over locomotion; one-shots end after duration
  rig.stopAction(), rig.currentAction
  rig.setAppearance(appearance), rig.setHeld('watering-can'|'basket'|'camera'|null), rig.setLookTarget(vec3|null), rig.dispose()
  anim names: idle walk run jump fall sit wave bow clap thumbsup point photo celebrate surprise nod heart dance think water harvest interact talk
appearance option values: hair short|long|bun|ponytail|buzz|curly ; top tshirt|hoodie|shirt|hanbok|apron|jacket ;
  bottom pants|shorts|skirt ; bag none|backpack|basket|pouch ; accessory none|glasses|strawhat|headband|cap|beard|gat ;
  face smile|calm|cheer ; colors are '#rrggbb' strings ; height multiplier (0.9–1.1)
```
- `G.sys.player` (order 30): `object`, `position`, `rotY`, `velocity`, `grounded`, `rig`, `radius`, `enabled`,
  `teleport(x, z, rotY?, {fade=true}) -> Promise`, `walkTo({x,z}, {stopDistance=1.2, onArrive, run})`, `cancelWalk()`,
  `playAction(anim, {duration, loop})`, `stopAction()`, `faceTowards(x, z)`, `sit(benchAnchor?)`, `setAppearance(app)`
  (also writes `G.state.profile.avatar`). Camera-relative WASD (`G.sys.camera.getMoveBasis()`), Shift run (walk 3.2 m/s,
  run 6 m/s), Space jump, smooth turning, slope/step via `heightAt`, collisions via `G.world.resolve`, water/bounds blocking,
  footstep sfx (`G.sfx('step', {surface})`), sets `G.sys.engine.focus` every frame, saves position into `G.state.player`.
  Name tag label above head (`.nametag.me`). Registers interactable benches from `layout.benches` (kind `'bench'` → sit).
  Restores position/appearance in `onStateLoaded`.
- `G.sys.camera` (order 35): third-person orbit (mouse/touch drag via `G.input.consumeLook()`, wheel/pinch zoom 2.5–16 m,
  pitch limits, smooth follow, terrain/blocker avoidance), `mode`, `setMode('follow'|'cinematic'|'dialogue'|'photo'|'focus', opts)`,
  `getMoveBasis() -> {forward, right}` (XZ unit vectors), `cinematic({center:[x,y,z], radius, height, speed})` (title screen orbit),
  `focusOn(vec3, {distance, height, duration})` (dialogue framing), `shake(amount)`, `yaw/pitch/distance`. Photo mode drives
  the camera itself through `setMode('photo')` + `photoControl({dx,dy,zoom,height})` (implement a free orbit around the player).
- `G.interact` (system name `interaction`, order 40):
  `register({id, kind, label: string|()=>string, position: Vector3|()=>Vector3, object?: Object3D, radius=2.6, priority=0,
  enabled?: ()=>bool, onInteract: ()=>void, highlight=true}) -> {id, unregister(), setEnabled(b)}`, `unregister(id)`,
  `current`, `trigger()`. Each frame pick the best candidate (distance + facing/screen-centre), show `#interact-prompt`
  (`<kbd>E</kbd> 장독 확인`), pulse-highlight the focused object. On E / d-pad centre / mobile button → `onInteract()` then
  emit `interact {kind,id}`. Clicking a registered object (raycast) interacts when close, otherwise walks there and interacts;
  clicking the ground (`G.world.groundMeshes`) walks there with a ground ring marker when `G.settings.clickToMove`.
  kinds: `npc jar plot sign kiosk exhibit tool jardisp craft shop door board photo bench`.

### 6.4 NPC & dialogue (`25-npc.js`, `26-dialogues.js`)
- `G.sys.npc` (order 45): spawns `G.data.npcs` with `G.avatar.create`, idle/wander within `wander` radius, turn to the player
  when near, name tag label (`.nametag.npc` + role) with an optional marker slot; `get(id) -> {id, data, rig, group, position}`,
  `list()`, `talk(id)`, `setMarker(id, '!'|'?'|null)` (quest system calls it). Registers each NPC as interactable kind `'npc'`.
- `G.sys.dialogue` (order 46): bottom-center dialogue box in `#dialogue-root` (speaker, typewriter text, choice buttons,
  keyboard 1–4/Enter/Space, Esc to close), camera `focusOn`, player disabled while open (`G.ui.block('dialogue')`; while open the
  HUD dims to .45 and `#labels-layer` fades out (.35 s) and is hidden and not tappable (25-npc.css); labels fade back in
  on close), optional TTS when `G.settings.voiceOver` (`G.sys.audio?.speak`). `start(dialogueId, {npcId})`, `close()`, `active`.
  Emits `npc:talk` on start and `dialogue:end`. `{nickname}` placeholder in text.
- `G.data.dialogues = { npc_master: {npc:'NPC001', entries:[{if:{...}, node:'x'}, {node:'start'}], nodes:{ id:{ text, speaker?, emote?,
  actions:[...], choices:[{text, next?, end?, if?, actions?}], next? } } } }` for npc_master, npc_farmer, npc_culture, npc_keeper, npc_guide.
  Conditions: `{questStatus:{Q:'available'|[..]}, hasItem:{ITEM:n}, flag:'x', notFlag:'x', level:n, jarStatus:{J1:'COMPLETE'}, easy:true|false}`
  (full list in the 26-dialogues.js header; `easy` = 쉬운 모드 on/off). In 쉬운 모드 every quest giver opens straight on the offer of
  a quest that is `available` (산골농부 does it in both modes; 전통사랑 / 장독지기 via `KID(...)` entries), so "OO에게 가요" never
  ends in a menu hunt; normal mode keeps their hub menu.
  Actions: `acceptQuest{quest}`, `claimQuest{quest}`, `giveItem{item,qty}`, `takeItem{item,qty}`, `setFlag{flag}`, `openEdu{edu}`,
  `openQuiz{quiz}`, `openShop{shop}`, `openCraft`, `openJar{jar}`, `openMap`, `openJournal`, `teleport{zone}`, `emote{emote}`, `event{name,payload}`.
  Content: warm, short Korean lines (spec #71 style); 발효마스터 runs the tutorial (QUEST001), 산골농부 → Q_FARMER/Q_HERB + farming tips,
  전통사랑 → Q_QUIZ3/Q_CULTURE + culture talk, 장독지기 → Q_MEJU/Q_DOENJANG/Q_NEW_FERMENT + jar care tips, 안내원 → map, shop, intro.

### 6.5 Inventory / quest / progression (`30-inventory.js`, `31-quest.js`, `32-progression.js`)
- `G.sys.inventory` (order 50): `add(itemId, qty=1, {source, silent}) -> added`, `remove(itemId, qty=1) -> bool`,
  `has(itemId, qty=1)`, `count(itemId)`, `list(type?)`, `open(tab?)` (grid of `.slot`s with tabs 전체/씨앗/작물/재료/발효식품/도구/장식,
  detail pane, sell button when in a shop), `openShop(shopId)` (buy/sell with coins via progression.spendCoin/addCoin).
  Hotkey `I`, action `inventory`. Emits `item:added/removed`. Toast "+콩 ×3".
- `G.sys.quest` (order 52): state machine locked→available→accepted→progress→completed→claimed (spec #29). Auto-accept
  `autoAccept` quests when available; `requires` gate availability. Objective types from `01-data.js` (sequential quests only
  count the current objective). `accept(id)`, `claim(id)` (→ `progression.grant(reward, {popup, title})`), `status(id)`,
  `progress(id)`, `openLog(tab)` (진행중/완료 가능/완료/전체, accept & claim buttons), `track(id, bool)`.
  Renders `#quest-list` like the reference (icon, title, desc, `0/1`, coin reward, "보상 받기" button when completed; max ~4,
  main quest first), `G.ui.objective(text, {dist})` for the current main objective, **gold 3D markers** (floating rotating
  diamond + light beam) over the current objective targets (NPC head, zone centre, nearest relevant plot / my jar / nearest
  sign or kiosk for `edu`), `!`/`?` markers over quest-giver NPCs via `G.sys.npc.setMarker`. Expose
  `getMarkers() -> [{x, z, kind, label}]` for the minimap. Hotkey `Q`/`L`, actions `quests`, `quest-collapse`.
- `G.sys.progression` (order 54): owns stats/level/coin/exp/edu/achievements/collection/titles (see §4).
  `grant(reward, {reason, popup=true, title, eyebrow})`, `addCoin(n)`, `spendCoin(n)->bool`, `addExp(n)`, `addEdu(n)`,
  `incStat(key, n)`, `getStat(key)`, `expToNext()`, `unlockCollection(id)`, `isCollected(id)`, `openCollection(category)`
  (도감 grid with categories, ??? for locked, detail), `openAchievements()`, `openProfile()` (stats summary),
  `setTitle(name)`, `addTitle(name)`. Updates HUD `#hud-level #hud-nickname #hud-title #hud-exp-bar #hud-exp-text #hud-coin #hud-edu`.
  Level-up toast + `G.sfx('levelup')`, titles from `G.data.levels.titles` (with `G.data.meta.titleDisclaimer`).
  Hotkey `C`, action `collection`.

### 6.6 Farming & fermentation (`40-farming.js`, `41-fermentation.js`)
- `G.sys.farming` (order 60): plots from `layout.farmPlots` (state init from `prefill` for new players), growth model from
  `G.data.farming` + crop `growthTime/waterUse` computed with `G.time.now()` timestamps (offline catch-up ≤ `offlineCatchUpMax`),
  stages from `G.data.cropStages`. `getPlot(id)`, `water(id)`, `plant(id, cropId)` (needs seed item), `harvest(id)`
  (items via inventory, exp/coin via `progression.grant({exp, coin}, {popup:false})`), `openPlot(id)` (modal: crop, stage,
  성장률/수분/건강 bars, time left, buttons 물 주기/수확/씨앗 심기 with seed picker). Crop visuals per `crop.model` and stage
  (InstancedMesh per plot, gentle sway), wet soil darkening, water droplet particles, harvest pop. Plot labels like the
  reference: `① 콩밭  성장률 65% | 수분 60% | 건강 80%` (`.plot-label`) within ~40 m. Interactables kind `'plot'`
  (label: 물 주기 / 수확하기 / 씨앗 심기). Player anim `water`/`harvest`. Emits `farm:*`.
- `G.sys.fermentation` (order 62): jars J1–J3 meshes (onggi jar with lid; **J1 glows gold** — reference image 3
  "장독대의 빛나는 항아리"; "내 항아리" label), status machine EMPTY→PREPARING→FERMENTING→AGING→COMPLETE→CLAIMED,
  progress from timestamps & `recipe.baseDuration`, environment from `G.sys.weather` (temperature/humidity) or defaults,
  quality = base + temp bonus + humidity bonus + aging bonus − hygiene penalty (show the formula, grade names, and the
  disclaimer). `openJar(id)` (status, progress bar, 남은 시간, 온도/습도/위생, 품질, care buttons 환기/햇볕 쬐기/닦기 with
  cooldown, start with recipe picker, claim), `start(jarId, recipeId)`, `claim(jarId)`, `care(jarId, action)`, `openCraft()`
  + `craft(craftId)` (work table, `G.data.crafts`), `env()`, `myJarIds()`, jar unlock (J2/J3 for `extraJarPrice`).
  New player: J1 owned with `starterRecipe` at `starterProgress`. Interactables kinds `'jar'` (label 장독 확인),
  `'jardisp'` (옹기 살펴보기 → collection + info), `'craft'`. Visual feedback: lid lifts when opened, bubbles/steam particles
  while fermenting, sparkle when COMPLETE. Emits `ferment:*`, `craft:done`.

### 6.7 Education & journal (`45-education-data.js`, `46-education.js`, `47-journal.js`)
- `45-education-data.js`: `G.data.education = { EDU_FERMENT, EDU_JANGDOK, EDU_BEAN, EDU_DOENJANG, EDU_GANJANG,
  EDU_GOCHUJANG, EDU_KIMCHI, EDU_FARMING, EDU_TOOLS }` each `{title, category, icon, summary, pages:[{title, text, visual}],
  quiz:'QZ_*', source, verified:false}` (3–4 pages, accurate general facts) and `G.data.quizzes = {QZ_*: {edu, question,
  choices[4], answer, explain, reward:{exp:100, edu:10}}}` (≥ 2 quizzes per content; include spec example
  "된장과 관련이 깊은 재료는? A.콩 B.사과 C.딸기 D.바나나"). Must stay pure data (no THREE) — it is evaluated in Node.
- `G.sys.education` (order 64): `open(eduId, {page})` (paged modal: visual + text + 이전/다음, last page → 퀴즈 풀기),
  visuals type `model` rendered by a small separate WebGLRenderer in the modal (jar, meju, bean, pepper, cabbage, kimchi
  jar, tools…; dispose on close), `emoji`, `svg`; `openQuiz(quizId)` (4 choices, correct → reward first time, wrong →
  explanation + retry), `openLibrary()` (all contents with completion), `isCompleted(id)`. Registers interactables for
  `layout.signs` (action edu/info/map), `layout.kiosks`, `layout.exhibits` (food card + "자세히 알아보기"), `layout.eduBoard`,
  `layout.hallDoor` (체험관 안내: floors & exhibits modal). Emits `edu:*`, `quiz:answered`.
- `G.sys.journal` (order 66): `open({prefill})` form (날짜, 지역 select defaulting to current zone, 작업 chips auto-filled from
  `G.state.activity`, 수확물, 발효 상태 auto from J1, 배운 내용, 느낀 점, 사진: pick from `G.state.photos` or upload file
  (validate type png/jpeg/webp and size ≤ 5 MB, resize to ≤ 480 px JPEG thumbnail; server mode → `G.net.request('journal/upload.php',
  {form})` and store the returned url)), `openList()` (cards, detail view, delete), `create(entry)`, `count()`. Hotkey `J`,
  action `journal`. Emits `journal:created`.

### 6.8 Minimap / weather / photo (`50-minimap.js`, `51-weather.js`, `52-photo.js`)
- `G.sys.minimap` (order 70): zone/poi detection (every 0.25 s) → `zone:enter/exit`, `poi:enter`, zone banner,
  `G.state.player.zoneId`, `G.state.visited` / `poisVisited` first-visit timestamps; minimap canvas `#minimap-canvas`
  (pre-rendered base map from terrain colours, water, roads, paths, buildings, plots, jangdokdae rings + live markers:
  player arrow with heading, NPCs, other players `G.sys.social.others`, quest markers `G.sys.quest.getMarkers()`, photo zones),
  zoom +/- buttons, collapse/close, click → world map. `openWorldMap()` (M; large map: one finger or the mouse drags, two fingers pinch
  (zoom about the midpoint), wheel and +/− zoom, also when the gesture starts on a zone chip; a press ends wherever it is
  released — outside the map box or the window too — so a plain mouse hover never drags; a tap or click picks the zone
  under it (touch: the nearest ring within ~20 px; correct while the dialog grows in) → description + "여기로 이동", which
  stays pinned at the bottom of the card's scroller), `openFastTravel()` (action `move`), `currentZone`, `worldToMap(x,z)`. Actions: `minimap`, `move`,
  `minimap-collapse`, `minimap-close`, `minimap-zoom-in`, `minimap-zoom-out`.
- `G.sys.weather` (order 72): weather CLEAR/CLOUDY/RAIN/FOG/SNOW and day phases MORNING/DAY/EVENING/NIGHT (game clock,
  `G.data.time`), drives `engine.setSun`, sky uniforms, fog colour/density, hemi/sun colours & intensities, exposure,
  `G.world.nightFactor` + `nightMaterials`/`nightLights`, stars at night, cloud cover tint, rain (GPU points/lines near
  the camera, splashes) and snow particles. `temperature` (°C) & `humidity` (%), `set(id)`, `setHour(h)`, `hour`, `phase`,
  `current`, `auto` (`G.settings.autoWeather`), `lockTime` (`G.settings.lockTime`). Bottom bar `#weather-icon` / `#weather-temp`,
  popover on action `weather` (weather picks, time slider, auto toggles). Emits `weather:changed`, `time:phase`.
- `G.sys.photo` (order 74): action `photo` / hotkey `P` → photo mode (`body.hud-hidden`, `#photo-ui` overlay: shutter, filters
  기본/따뜻한/흑백/빈티지/선명, frame toggle, pose buttons from `G.data.gestures`, zoom/height sliders, exit), camera
  `setMode('photo')`, capture = render then `renderer.domElement.toDataURL` composited with filter/frame on a 2D canvas,
  download PNG + keep a small thumbnail in `G.state.photos`, flash + shutter sfx, photo-zone detection (`layout.photoZones`)
  and interactables kind `'photo'` (포토존 – 사진 찍기). `openGallery()`. Emits `photo:taken`, `photo:mode`.

### 6.9 Social & audio (`60-social.js`, `61-audio.js`)
- `G.sys.social` (order 80): chat panel (`#chat-log`, `#chat-form`, tabs all/local/system, collapse, Enter to focus,
  bad-word masking, 1.2 s rate limit, click a name → 차단/신고), speech bubbles above speakers, `emote(id)` (bubble + anim,
  picker popover on action `emote` / hotkey `T`), `gesture(id)` (anim, picker on action `gesture` / hotkey `G`), `voice`
  action (Web Speech API ko-KR dictation into chat; graceful fallback). Local mode: simulated visitors from `G.data.visitors`
  (avatars wandering between zones, name tags, emotes, chat lines, replies to greetings); online count `#hud-online-count`.
  Server mode: presence (`presence/update.php` every 2 s, interpolate others) and chat polling (`chat/list.php?after=`) +
  `chat/send.php`, `chat/report.php`. `others` Map, `online`, `system(text)`, `npcSay(name, text)`, `sendChat(text, channel)`.
  Actions `chat`, `chat-collapse`, `emote`, `gesture`, `voice`.
- `G.sys.audio` (order 85): WebAudio procedural sound — `play(name, opts)` for sfx (click open close notify error coin reward
  quest levelup achievement water harvest plant jar craft shutter step jump land splash chat emote teleport page correct wrong),
  ambient beds (wind; birds by day; insects at night; water by distance to river/ponds; rain), generative BGM (pentatonic
  gayageum-like Karplus–Strong plucks + soft pad), volumes from settings (`volumeMaster/Music/Sfx/Ambient`, `muted`),
  `speak(text)` (speechSynthesis ko-KR), unlock AudioContext on first user gesture.

### 6.10 App shell (`70-app.js`, `70-app.css`)
`G.app.start()` replaces devBoot: loading (progress per system + tips) → title screen in `#screen-root` over a cinematic
camera orbit (METAVERSE / 전통발효체험관, 만장대(시작)·로그인·회원가입·게스트로 둘러보기) → auth (`G.auth`: local accounts in
localStorage with salted SHA-256 (crypto.subtle, fallback hash); server mode → `auth/register.php`, `auth/login.php`,
`auth/logout.php`, `auth/me.php`) with validation (email format, nickname duplicate, password ≥ 8 with letters+digits,
약관 동의) → `G.save.useProfile(profile, G.net.mode)` → `G.state = await G.save.load()` → `G.applyState()` →
camera follow → HUD → `G.ready = true`, emit `game:login {profile, isNew}` + `game:ready` → onboarding coach marks for new
players (이동 → 카메라 → 금빛 표식 → E 대화). `?autostart=1` skips title (guest), `?notutorial=1` skips onboarding.
Also: Esc main menu (`input:menu`), settings (audio/graphics/controls/accessibility + export/import/reset save), help (all keys),
avatar customizer with live 3D preview (action `avatar`), profile & stats, logout (save → `G.logoutSystems()` → title),
debug panel (F9 / backquote when `?debug=1` or admin: coin/items/quests/teleport/time/weather/grow/ferment/colliders/fps),
admin dashboard (local analytics; server `admin/stats.php`), mobile helpers (`body.show-chat`, `body.show-quests`).

### 6.11 PHP server (`server/`) — optional "server mode"
Copied next to `index.html` by the release build (`dist/metaverse/`). JSON responses `{success:true,data}` /
`{success:false,error:{code,message}}` (spec #58), PDO prepared statements, sessions (HttpOnly, SameSite=Lax, Secure on https),
CSRF token (`X-CSRF-Token` header; token returned by ping/me/login as `csrf` at the top level of the JSON),
`serverTime` (ms) at the top level of every response, rate limiting, password_hash, upload validation.
Endpoints: `api/ping.php` (data `{app:'tfm-metaverse', version, db, serverTime, csrf}`), `auth/register|login|logout|me.php`,
`player/get.php`, `player/save.php` (validates against `server/data/game-data.json`; on violation HTTP 409
`{error:{code:'VALIDATION_FAILED'}, data:{save}}`; also accepts `navigator.sendBeacon` JSON with `csrf` in the body),
`time.php`, `chat/list.php?after=&channel=`, `chat/send.php`, `chat/report.php`, `presence/update.php`, `journal/upload.php`,
`admin/stats.php`. SQLite by default (zero-config, `data/` dir), MySQL via `config/config.php`. `database/schema.sql` (MySQL)
+ `database/schema.sqlite.sql`, `admin.php`.

## 7. HUD DOM (in `src/template.html`, do not restructure; you may add elements dynamically)
`#game-container #labels-layer #hud (#hud-profile #hud-player #hud-left-menu #hud-right(#minimap-panel #quest-panel)
#hud-top-center(#notice-banner #objective-hint) #zone-label #chat-panel #bottom-bar #popover-root #dpad #mobile-controls
#interact-prompt #fps-meter) #dialogue-root #photo-ui #screen-root #modal-root #toast-root #reward-root #fade #loading-screen`.
Buttons use `data-action="..."`; handle them with `G.ui.onAction(action, fn)`.

## 8. Hotkeys (register with `G.input.onKey`)
E interact (core event) · Space jump · Shift run · M world map · J journal · I inventory · Q quest log · C 도감 ·
P photo mode · Enter chat · T emotes · G gestures · H help · Esc menu/close (core chain) · F9 / ` debug.

## 9. Visual direction (reference images)
Korean mountain valley in summer: dense green forested mountains, clear river along the east, modern glass + hanok-roof
experience hall in the north, hundreds of brown onggi jars in terraces and spiral rings in the east, a 3×2 farm grid north of a
round stone plaza, hanok buildings with dark curved giwa roofs, a thatched house, a pavilion by a pond, stone lanterns, warm
sunlight, soft shadows, light haze. Characters: cute chibi (big head, small body), friendly. UI: glass panels as in §0.

## 10. File ownership
| Owner | Files |
|---|---|
| core (lead) | 00–06, 10, template.html, 00–02 css, tools/, docs/ |
| world-terrain | 11-terrain.js, 12-nature.js, 13-water.js, 11-*.css |
| world-buildings | 15-buildings.js, 16-props.js, may tune 02-layout.js |
| player | 20-avatar.js, 21-player.js, 22-camera.js, 23-interaction.js, 2x-*.css |
| npc | 25-npc.js, 26-dialogues.js, 25-npc.css |
| progression | 30-inventory.js, 31-quest.js, 32-progression.js, 3x-*.css |
| farm-ferment | 40-farming.js, 41-fermentation.js, 4x-*.css (40,41) |
| edu-journal | 45-education-data.js, 46-education.js, 47-journal.js, 46/47-*.css |
| map-weather-photo | 50-minimap.js, 51-weather.js, 52-photo.js, 5x-*.css |
| social-audio | 60-social.js, 61-audio.js, 6x-*.css |
| app | 70-app.js, 70-app.css |
| server | server/** , tests/server-*.mjs |

---

## 11. Phase 2 additions (security, engagement, motion graphics, developer center)

### 11.1 Security rules (apply to EVERY module)
- The release HTML carries a strict **Content-Security-Policy** (`tools/build.mjs`): inline `<script>` blocks run only by
  SHA-256 hash. Therefore: **no `eval`, no `new Function`, no string `setTimeout`, no inline event-handler attributes
  (`onclick="..."` in HTML strings), no `javascript:` URLs, no external URLs** (scripts, styles, images, fetches to
  other origins are blocked). Attach listeners with `addEventListener`.
- Treat every user/remote string (nickname, chat, journal text, server data, imported JSON, file names) as untrusted:
  render with `textContent` / `G.ui.h(...)` children / `G.ui.esc()`; never concatenate it into `innerHTML` unescaped.
  Validate lengths/types on input. Images from users: only `data:image/(png|jpeg|webp)` or same-origin relative URLs.
- Never store secrets/passwords in `G.state` or logs. Local accounts use PBKDF2-SHA256 (WebCrypto) with a per-user salt.
- Imported saves (`G.save.importJSON`) are normalized; modules must tolerate missing/odd fields in `onStateLoaded`.

### 11.2 New modules & owners
| Owner | Files | System |
|---|---|---|
| engagement | `62-engagement.js`, `62-engagement.css` | `G.sys.engagement` (order 84) |
| companion | `65-companion.js`, `65-companion.css` | `G.sys.companion` (order 82) + `G.mascot` |
| fx | `66-fx.js`, `66-fx.css` | `G.sys.fx` (order 83) + `G.fx` |
| devcenter | `80-devcenter.js`, `80-devcenter.css`, `docs/HANDOVER.md` | `G.sys.devcenter` (order 95) |
| integration | cross-module fixes in 11–16, 20–23, 25–26, 30–32, 40–41, 45–47, 50–52 | — |

### 11.3 `G.fx` (66-fx.js) — motion graphics, auto-wired to events
`G.fx.burst(pos: Vector3|{x,y,z}, {type:'confetti'|'sparkle'|'hearts'|'leaves'|'coins'|'stars'|'dust'|'splash'|'petals', count, color, spread})`,
`G.fx.emoji3d(target: Object3D|Vector3, emoji, {rise, duration, scale})` (floating 3D emoji sprite),
`G.fx.levelUp(level)` (full-screen 2D celebration), `G.fx.stamp(text, {color})` (big "완료!" stamp),
`G.fx.coinFly(fromScreenXY|Vector3, amount)` (coins fly into `#hud-coin` + count-up),
`G.fx.pulse(color)` (soft screen-edge pulse), `G.fx.ripple(pos)` (ground ring). Respects `G.settings.reduceMotion`
and `G.settings.fxLevel` ('off'|'low'|'high'). Listens to `quest:completed/claimed`, `level:up`, `achievement:unlocked`,
`collection:unlocked`, `farm:watered/harvested/planted`, `ferment:claimed`, `reward:granted`, `emote:played`, `craft:done`
and plays the matching effect. Other modules MAY call `G.fx?.burst?.(...)` directly.

### 11.4 `G.mascot` + `G.sys.companion` (65-companion.js) — mascot "옹이" (a cute onggi-jar spirit)
- 2D: `G.mascot.svg(mood='happy'|'wink'|'surprised'|'sleepy'|'cheer'|'think'|'sad', size=96) -> SVG string` (inline, CSP-safe),
  `G.mascot.say(text, {mood, duration, action:{label, fn}})` (non-blocking speech card, rate-limited, queued),
  `G.mascot.hint()` (context tip for the current objective).
- 3D companion following the player (hop, squash & stretch, idle/sleep at night, reacts to rewards, points at the
  objective, umbrella in rain), interactable kind `'companion'` (pet / 한마디 / 옷 갈아입히기 / 이름 바꾸기), setting `G.settings.companion`.
- Event-driven helper tips (dry crops, unclaimed rewards, completed jar, idle player, first night, rain...).
- Other modules MAY use `G.mascot?.svg?.(mood)` in empty states, tutorials, loading and reward UI.

### 11.5 `G.sys.engagement` (62-engagement.js) — one hub: 출석·오늘의 미션·알림함·수료증·꾸미기·랭킹
- HUD: one bell button (top-left, next to the profile card) with an unread badge → hub modal with tabs
  `출석 체크` (7-day calendar, streak, escalating rewards, auto-opens once per day after login), `오늘의 미션`
  (3 daily missions from a pool, event-driven progress, rewards), `알림함` (history of achievements, quest updates,
  rewards, mentions — fed by events; unread count), `수료증` (canvas-rendered printable certificate PNG after QUEST001
  or with progress summary), `랭킹` (local: me + simulated visitors; server: `api/ranking/top.php`), `꾸미기`
  (place decoration items ITEM_SMALL_JAR / ITEM_FLOWERPOT / ITEM_LANTERN on a small personal yard; persisted).
- State: `G.state.engagement = { checkin:{lastDay, streak, days:[]}, daily:{day, missions:[...]}, notifications:[...],
  decor:[{id, item, x, z, rot}], certificate:{issuedAt} }`. Data for missions/rewards lives in this fragment.

### 11.6 `G.sys.devcenter` (80-devcenter.js) — 개발자 점검·인수인계 센터
Open with `?dev=1`, Ctrl+Shift+D, F9, or the main menu. Full-screen panel, tabs: 개요 (version, build time,
three revision, mode, fragment manifest from `window.__BUILD__.manifest`), 시스템 점검 (browser, WebGL caps, GPU,
DPR, memory, storage quota & usage, secure context, CSP active, AudioContext/Speech support, FPS/draw calls), 모듈 상태
(every `G.systems()` with init/failed/update-disabled, errors from `G.__systemErrors`/`__fragmentErrors`), 데이터 검증
(cross-reference linter over `G.data`: quests→items/npcs/zones/crops/recipes/edu/quiz ids, collection unlock refs,
layout anchors, dialogue node links…), 저장 데이터 (inspect/export/import/reset local saves & accounts, size per key),
서버 점검 (ping + `api/admin/health.php` + endpoint checks in server mode), 자가 테스트 (in-browser test suite of pure
logic: save checksum round-trip, quest state machine, farming growth math, fermentation quality, collision resolve,
zoneAt, bad-word mask, escape helpers…, green/red results), 디버그 도구 (cheats: coin/items/quests/teleport/time/
weather/grow/ferment/colliders/fps — the single place for debug tools), 소스 구조 (file tree + owner + purpose +
lines from the manifest), 문서 (renders `#build-docs` JSON markdown: README, ARCHITECTURE, CONTRACT, HANDOVER,
README-SERVER), 인수인계 (checklist: build, test, deploy, configure server, known issues, roadmap). Button: download
a full diagnostic report (JSON + Markdown). Admin/debug access in production: only in local mode, with `?dev=1` on the
server PC (localhost), or for an admin account — the role the server last answered for the current account
(`G.auth.serverUser` over the `G.auth.current` copy for that same account, so an in-game re-login after admin.php
관리자 지정 / 해제 counts at once; a guest never borrows a remembered session's role; never the save's `profile.role`).
A `G.ui` dialog that opens by itself while the center is up (re-login form, 다른 창 save card) makes the panel step
aside until the last such dialog closes; when the account lost access meanwhile, the center closes instead.

## 12. Phase 3 — 쉬운 모드 (usable by a 5-year-old) & kid safety

### 12.0 Principle (applies to EVERY screen)
A 5-year-old who barely reads must be able to use every page: picture/emoji first; button labels ≤ 2 short words
(≤ 6 Korean chars where possible) + a big emoji; every prompt can be read aloud; ONE obvious next action per screen;
tap targets ≥ 56 px (easy) / 40 px (normal); text ≥ 16 px; always a big ⬅️ / ✖ exit (no dead ends); forgiving
(confirm destructive actions with pictures, undo where cheap); no typing needed anywhere in easy mode; errors are
shown as the mascot + one friendly sentence + a retry button (never stack traces/codes). Friendly 해요체, short
sentences (≤ 12 words), no hanja/jargon; numbers as pictures where possible (💧💧💧 instead of "60%").
Normal mode (adults) keeps the same features with the denser UI. Easy mode is the DEFAULT.

### 12.1 Settings (03-state DEFAULTS additions)
`easyMode: true` · `voiceGuide: true` (read prompts aloud in easy mode) · `voiceRate: 0.95` (0.6–1.4) ·
`playReminderMin: 30` (0 = off, ≤ 240) · `kidChat: true` (chat = phrase/emoji picker only while easyMode) ·
`parentGate: true`. `<body>` gets class `easy` (easy on) or `easy-off` (`G.applySettingsToDom`, at boot and on every
change); CSS var `--tap` = 56px / 40px on `<html>`.
- **Profile-scoped keys** `easyMode`, `kidChat`, `parentGate` (`G.settingsProfileKeys`) always come from the player's
  save: `G.save.applyProfileSettings(state)` runs on load / reset / import / server restore and gives saves that lack
  them the DEFAULT (existing players and new profiles start in easy mode, a parent's "easy off" never leaks into a
  child's profile). After logout they fall back to this device's stored value (`G.restoreDeviceSettings()`).
- Every stored, imported or `setSetting` value is type-checked against the default (`G.sanitizeSetting(key, v)`:
  wrong type → default, numbers clamped, enums checked). **Pass numbers as numbers** (`Number(input.value)`).
  Loading a profile now emits `settings:changed` for each key whose value actually changed (handlers must not assume
  `G.state` exists).
- Change easy mode with `G.easy.set(bool)` (asks the gate before switching OFF), not `G.setSetting('easyMode')`.
- **Device store** `localStorage['tfm.v1.settings']` holds only device values: `G.setSetting(k, v)` writes just that key,
  and never writes a profile-scoped key while a profile is loaded (`G.state` set) — those go to the save only. On the title
  (no profile) a profile key written there becomes the device default. The store carries `_v: 2`; an older store without it
  drops the three profile keys once (back to the child-safe defaults). `G.deviceSetting(key)` reads the stored device value.

### 12.2 `G.easy` (08-easy.js — core fragment, no 3D dependency, safe to call before world init)
- `G.easy.on` (getter) · `G.easy.set(bool)` → Promise<bool>; OFF asks `G.easy.gate({reason:'easy-off'})` first
  (it re-enables free-text chat); emits `easy:changed {on}` (also when a profile load or `setSetting` flips it).
- `G.easy.say(text, {interrupt=true, priority=0, force, rate})` → Promise<bool> (true = finished speaking).
  speechSynthesis ko-KR (best Korean voice: Natural/Online > Google > named female > ko-KR; rate `voiceRate`,
  pitch 1.1); only when easy && voiceGuide && !muted, or `force` (explicit 🔊 / long-press — still silent when muted,
  with a "소리가 꺼져 있어요" hint); strips emoji/markup/symbols; de-dups the same line within 4 s (forced lines too
  while it is still being read); ≤ 140 chars cut at a sentence end. Queue: `interrupt` cancels the current line
  unless it has a higher `priority` (then it is queued); max 4 queued. Ducks music with
  `G.sys.audio?.duck?.('easy-voice', 0.4)` / `unduck('easy-voice')`. `G.easy.stop()`, `G.easy.speaking`.
  Emits `easy:say {text}` (also headless / unsupported, for captions & tests). Never throws.
- `G.easy.speakable(el, text|fn?)` → appends one 🔊 `.easy-speak` button to `el` (idempotent) reading `text` /
  `fn()` / the element text. `G.easy.textOf(el)` = what a 🔊 / long-press reads: `__easySpeak` text, `data-say`,
  visible text, then `aria-label` / `title`.
- `G.easy.gate({reason, title, text})` → Promise<boolean>. Parent gate (UX barrier, not an adult security boundary):
  random 2-digit × 1-digit multiplication (12–98 × 3–9) with **6** big shuffled plausible choices (the answer's rank is
  uniform; 3 columns, 2 below 380 px); **two right answers in a row** are needed (a wrong answer restarts the streak and
  brings a new question; the dots `●○ 1/2번째 문제` show the streak); 3 wrong → 30 s cool-down, doubling on repeated
  failures (max 5 min, persisted in `localStorage['tfm.v1.gate']`, survives reload). Blind-tapping odds ≈ 8 % per round
  (`G.easy._gateSim`). Resolves true immediately when easyMode is off or parentGate is false. One gate at a time
  (concurrent calls share the result). Emits `easy:gate {reason, ok, skipped?, cached?}`.
  **Unlock scope (phase 4, final):** a pass opens a short grown-up *session* bound to the grown-up screen it opened —
  a modal whose className matches `GATE_ROOT_CLASS` (`app-menu-modal` 어른 메뉴, `app-settings-modal`, `app-delete-modal`,
  `admin-modal`; 04-ui sends `ui:modal-open {id, className}`) or the title's 어른 메뉴 view. Reasons that open a screen
  (`parents · settings · admin · delete-account · login · register`) may adopt it within 3 s, the others within 0.6 s
  (they only serve their own action). Screens a child opens alone (가방, 도움말, 스티커북, kid menu) are never adopted.
  The session ends when the last adopted screen closes (650 ms grace for a hop between two), on logout / login /
  profile load, easy-mode switch, tab hide, or after 3 min idle (`GATE_IDLE`). `logout · devcenter · admin ·
  delete-account` always ask again (`GATE_NO_CACHE`); `kid-chat · parent-gate · easy-off · reset · import · forget`
  need a pass from the last 90 s (`GATE_FRESH`). `G.easy.lockGate(why)` ends the session. When it ends because the
  grown-up left (`hidden` / `expired`) the adopted screens close together with every dialog stacked on them, top first
  (a confirm answers false), and the dialogs of the title's 어른 메뉴 view close too. A confirm that stands between a pass
  and its action (진행 초기화, 아이 채팅 / 보호자 확인 끄기, 목록에서 지우기, 가져오기) asks `G.easy.gate` again after its
  yes, so one left over from an ended session can never act.
  `G.easy.gateStatus()` → {unlocked, unlockLeft, screens, cooldownLeft, wrong, streak, need, choices, tries, open, required}.
  Anti-mashing: a tap locks the choices at once and the next question becomes tappable only after a short pause
  (`.easy-gate-choices.is-locked`; stale question ids ignored) → one answer per question. The wrong count of the
  current round is persisted with the cool-down (`{until, strikes, wrong, wt}`, expires after 10 min).
  Scripts that solve the gate must answer each armed question (`.easy-gate-modal:not(.modal-closing)
  .easy-gate-choices:not(.is-locked)`) until the modal closes.
- `G.easy.pick({id, title, say, emoji, text, items:[{id, emoji, label, color?, disabled?, disabledSay?, badge?, sub?,
  selected?, say?}], columns, size})` → Promise<id|null>: big picture chooser (2–4 columns, 3 on phones, 2 below
  380 px; arrows/Home/End/Enter; the focused tile is read aloud; disabled tiles shake + speak). Esc / ⬅️ → null.
- `G.easy.confirm({emoji, heading, title, text, say, yes='좋아요', no='아니요', danger})` → Promise<boolean>
  (danger: the safe ❌ button is focused). `G.easy.alert({emoji, heading, title, text, say, ok='알았어요'})` → Promise.
  In easy mode `G.ui.confirm` / `G.ui.alert` route to these unless `opts.html` or `opts.easy === false`.
- `G.easy.celebrate(text, {emoji='🎉', say, duration=2200, sound})` → Promise: centred emoji pop + slow light rays +
  voice + `G.fx?.burst` confetti at the player (rays/burst off with reduceMotion).
- `G.easy.point(target, {label, say, duration=6000 (0 = until stop), offsetY})` → {stop(), active}: big bouncing 👆
  with a pulse ring; target = Element | selector (resolved lazily) | {x,y?,z} | Object3D; world targets are projected
  every frame (`engine.worldToScreen`), off-screen/behind-camera targets get an edge hand pointing towards them;
  one at a time (`G.easy.stopPoint()`); tapping the target element stops it. Emits `easy:point {label}`.
- `G.easy.nextStep()` → {key, speakKey, emoji, text, say, target:{x,z,label}|null, act?, actLabel?, actEmoji?,
  progress:{value,target}|null, questId?, type?} from `G.sys.quest.focus()` (claim → 🎁 선물 받기 acts
  `quest.claim`, giver → 🙋 go to the NPC, objective → one kid sentence per objective type; journal/photo/emote/chat
  objectives act directly; a craft objective whose ingredient is missing — `G.sys.quest.craftNeed(craftId)` →
  {item, have, need, crop} — reads "🫘 콩을 모아요 1/3" and its marker points at that crop's bed or the 매점 until the
  bag holds enough, then "작업대에서 만들어요"); fallback "🗺️ 구경해요" (act = picture travel menu). Drives the HUD card.
- `G.easy.goTo(target {x,z,label?} | zoneOrPoiId, {label, stopDistance=1.8})` → Promise<bool>: auto-walk
  (`player.walkTo`, runs when > 10 m, destination ring via `G.interact.showDest ?? _showDest`); > 70 m or stuck →
  `G.sys.minimap.travelTo(zone)` first when that lands closer; on arrival "도착했어요!" + the hand points at
  `#interact-prompt`. A walk cancelled by the child (joystick/click) ends silently.
- `G.easy.travelMenu()` → Promise<zoneId|null>: "🗺️ 어디 갈까?" picture menu of the zones (📍 here, ⭐ quest goal).
- `G.easy.t(normalText, easyText)` → easyText when easy mode is on.
- `G.easy.nameIdeas(n=6)` → unique kid-safe nicknames (형용사 + 동물/발효 친구, written without a space so they pass
  the 2–12 char nickname rule, e.g. "용감한다람쥐"), filtered against `G.data.badWords`.
- Healthy play: every `playReminderMin` minutes of ACTIVE play (easy mode, in game, tab visible, input in the last
  90 s; counted per browser session) a non-blocking mascot card offers 😴 쉬기 / ▶️ 계속. 쉬기 = `G.easy.rest()`: a calm
  full-screen breathing break (8 s cycle, tips 👀 🙆 💧, "다시 놀기" always available, Esc closes, blocks gameplay).
  `G.easy.remind()` shows the card now; `G.easy.playSeconds`.
- `G.easy.josa(word, '을/를')` Korean particle helper. Dev-center hooks: `_gateQuestion()`, `_speechText()`, `_voice`.

### 12.3 HUD in easy mode (template.html + 00/01/02 css + 08-easy)
Top-left: avatar + one stats card (nickname, ⭐ level from `#hud-level`, 🪙 `#hud-coin`; exp bar, title, edu and
mode chip hidden). Top-center: `#easy-next` "다음 할 일" card (bouncing emoji, one sentence, ●●○ progress pips,
👉 같이 가기 / 🎁 선물 받기 / ✋ 멈춰, 🔊; a new step is read aloud once nothing else is on screen); `#objective-hint`
is hidden — coach marks must anchor `#easy-next` in easy mode. Right: compact minimap (no header tools) + big
`#easy-where` "🗺️ 어디 갈까?" (minimap hidden ≤ 820 px). Left menu = 4 big tiles: 🎒 가방 · 📖 스티커북 · 🔔 오늘 · ☰ 메뉴
(`#hud-bell` is hidden: merged into 🔔 오늘). Bottom bar: 😊 표현하기 · 📸 사진 · 📝 일기 · 🔊 소리. Chat collapses to the
`#easy-chat-btn` 💬 (badge = chat unread). Interact prompt = big gold pill with the target's emoji and a bouncing 👆.
Quest panel and `.app-mobile-toggles` are hidden. Mobile: bigger joystick / 👆 / jump / run, 📷 hidden (bottom bar).
Verified free of overlaps at 1600×900, 1366×768, 390×844 and 844×390.
- **Actions owned by 08-easy** (other modules implement the target methods, never register these actions):
  `stickerbook` → `G.sys.progression.openHub()` · `today` → `G.sys.engagement.open()` · `express` →
  `G.sys.social.openExpress(anchor)` (fallback `openEmotes`) · `kid-chat` → `G.sys.social.openKidChat(anchor)`
  (fallback: toggles `body.show-chat`, which shows the chat log in easy mode on every screen size) · `where` →
  `G.sys.minimap.openPictureTravel()` (fallback `G.easy.travelMenu()`) · `sound` (mute toggle) · `easy-go` · `easy-read`.
- Badges: `G.ui.setBadge` also paints `[data-badge-host][data-action=X]`; merged tiles sum their parts
  (`stickerbook` = collection + quests, `kid-chat` = chat); 🔔 오늘 polls `G.sys.engagement.unreadCount()` every 2 s.
  `G.ui.getBadge(action)`.
- Utility classes (08-easy.css): `.easy-only` / `.easy-hide`, `.easy-big-btn` (+ `.easy-btn-yes/-no/-danger`),
  `.easy-speak`, `.easy-pick` / `.easy-tile` (`--tile` colour), `.easy-confirm`, `.easy-gate`, `.easy-next`,
  `.easy-shake`. `[data-say="…"]` sets what a long-press reads; `.no-read` opts out.
- 04-ui in easy mode: every closable modal gets a big `⬅️ 닫기` (`.easy-back`, ≥ 56 px) at the top-left instead of
  ✖ plus a 🔊 button; the title (or `opts.say` string) is read aloud on open (`opts.say === false` = silent).
  Error toasts show the mascot + one friendly sentence (technical/long text → "앗, 잘 안 됐어요. 다시 해 봐요!",
  `opts.easy` = custom kid sentence; the original goes to the log); `toast(msg, {retry: fn})` adds a 🔄 다시 button
  (both modes); `opts.say` reads a toast aloud. Reward popups: bigger, no "EXP" words, title read aloud, 8 s.
- 05-input in easy mode: touch/pen long-press (600 ms, < 12 px movement) on a button/tile/card/text reads it
  (`G.easy.textOf`) and swallows the click that follows the release; never on the 3D view, joystick or inputs.

### 12.4 Kid safety (security)
- Easy mode: no free-text input for the child — nickname via `G.easy.nameIdeas`, chat via preset phrases + emoji,
  journal via stickers/moods. Parent gate before: settings (except 소리 & 쉬운 모드 quick toggles), logout,
  login/register forms, progress reset, import/export, developer center, admin.
- PII protection (client AND server, all modes): chat masks phone numbers (010-1234-5678, 01012345678, +82 …),
  e-mail addresses, URLs and Korean street-address fragments with 🔒; the sender gets a friendly mascot tip
  ("이름·전화번호·주소는 비밀이에요! 🤫"). `G.sys.social.maskPII/hasPII` (60-social `PII_SRC`) and
  `ChatFilter::maskPII/hasPII/fold` (server) are the SAME ordered rule list: pass 1 on the text as written, pass 2 on a
  compatibility fold (NFKC, keycap emoji stripped, every `\p{Nd}` digit → ASCII) whose result is used when it found more.
  Covered disguises: separators `/ _ ~ * · – — ㅡ ( ) [ ]`, Korean digit words with separators, numerals mixed with digit
  words, local numbers `1234-5678`, "at … dot" e-mails, "지메일 닷컴", `bad[.]com` / `bad(.)com` / `bad . com`, an address
  with its lot number, "OO 초등학교" with a space. Shared vectors: `tests/pii-vectors.json` (whole / partial / keep) — run
  by `tests/server-e2e.mjs` (PHP) and, embedded as `window.__BUILD__.piiVectors`, by the dev-center self-tests (JS).
  The server's repeat-spam key `chat_messages.text_key` is built from the MASKED text (schema v2 cleared older keys).
- Photosensitivity: nothing flashes faster than 3 Hz; large-area brightness changes are eased; honour reduceMotion.
- Healthy play reminders (12.2). No paid items, no countdown pressure, no dark patterns.

### 12.5 Events (additions)
`easy:changed {on}` · `easy:say {text}` · `easy:gate {reason, ok, skipped?, cached?}` · `easy:point {label}` ·
`easy:celebrate {text, emoji, reduced}` (every `G.easy.celebrate`; 66-fx adds the kid party) · `easy:remind {open}`
(healthy-play card shown / hidden) · `easy:rest {open}` (rest screen; 65-companion naps and wakes) ·
`kid:phrase {phraseId}` (emoji sends use `'emoji:<e>'`) · `easy:gate-left {why, title}` (13.10) · `player:arrived {id, x, z, rescued}` ·
`travel:arrived {id, zoneId, x, z}`. Settings: `settings:changed {key, value}` is also emitted when a profile load changes a key.

### 12.5b Integration APIs added by the phase-3 modules (the implementations are the reference)
- Interaction (23): interactables may add `kidLabel` (2–3 words), `emoji`, `handOffset` (number | () => number).
  `G.interact.showDest(x, z, forEntry)` / `hideDest()` / `radiusOf(entry)` / `promptOf(entry)` / `hint`. Easy mode: reach
  radius ×1.3, and the entry whose id equals the quest focus target (`G.sys.quest.focus().target.id` / `.npc`) wins the
  prompt over nearer things (card and gold prompt agree). Quest targets carry `id` (plot / jar / object) since QA.
- Player (21): `walkTo({x,z}, {stopDistance, onArrive, onFail(reason), run, path=true, rescue=easy, trail=easy, label})` → id |
  false (routes around obstacles, re-plans, easy-mode rescue hop keeps the id; reasons manual · replaced · teleport · stuck ·
  sit · action · logout · travel), `planPath(from, to, goalR?)`, `walkInfo`, `isWalking`. Camera (22): `G.sys.camera.gentle`.
- Minimap (50): `openPictureTravel()` → Promise<id|null> (the one "🗺️ 어디 갈까?" flow; M / move / openWorldMap /
  openFastTravel land there in easy mode), `travelTo(id | {x, z, label?, rotY?}, {say})` → Promise<bool> (one trip at a
  time, closes open windows first). Avatar (20): `G.avatar.presets` (6 × {id, emoji, label, say, appearance}).
- Social / audio / fx / mascot: `G.sys.social.maskPII · hasPII · openKidChat(anchor) · openExpress(anchor)`,
  `G.sys.audio.duck(true|false | key, gain, seconds) · unduck(key)` + kid sounds `tap · oops · sparkle · stamp`,
  `G.mascot.say(text, {…, voice:false})` (silent card), `G.fx.kidParty(pos?, {rain, burst, emoji})`.
- Quest / progression / inventory / journal: `G.sys.quest.current()` (kid `easyText`, `emoji`, walk target),
  `renderList(el, {easy})`, `G.sys.progression.openHub('quest'|'col'|'ach'|'me')` = 📖 스티커북, shared kid kit `G.kidKit`
  (josa, coinChip, empty, gridKeys, say, vars, shake), `G.sys.journal.create({…, mood})`.
- Education data: `content.kid = {title, summary, slides:[{text, vis|steps|emoji}]}`, `quiz.kid = {q, choices:[{e,t}],
  answer, hint, why} | {q, ox:true, answer, hint, why}`; `G.sys.education.answer(quizId, index, {quiet})`.
- One-tap rules in easy mode: crop bed → plant picker / **water first while the current objective is 💧 water** (any
  bed with water < 100, even ripe) / harvest when ripe / water below 80 % / picture card; own jar near → claim when ripe,
  recipe picker when empty (both emit `ferment:checked`, so "내 장독을 살펴봐요" counts), otherwise the jar card.
- Onboarding coach (70-app, easy): a caption that never takes taps (`.coach.kid { pointer-events:none }`, only 🔊 / ⏭️);
  hidden while another interact prompt is visible; using any other interactable during steps 2–3 finishes the tutorial;
  docks above the prompt / bottom controls; "같이 가고 있어요!" after 👉 같이 가기 until the walk stops for 3 s.
- Dev-center kid tour: `settings-kid` (ungated kid sheet) and `settings` (= `G.app.openAdultSettings()`, must show the gate).

### 12.6 Phase-3 file ownership
| Agent | Files |
|---|---|
| easy-core | NEW `src/game/08-easy.js`, `src/styles/08-easy.css`; `00-core.js`, `03-state.js`, `04-ui.js`, `05-input.js`, `src/template.html`, `00-base.css`, `01-hud.css`, `02-responsive.css`, `docs/CONTRACT.md` §12 |
| easy-app | `70-app.js`, `70-app.css` |
| easy-play-1 | `30-inventory`, `31-quest`, `32-progression`, `47-journal` (+ css) |
| easy-play-2 | `23-interaction`, `25-npc`, `26-dialogues`, `40-farming`, `41-fermentation`, `45-education-data`, `46-education` (+ css) |
| easy-world | `20-avatar`, `21-player`, `22-camera`, `50-minimap`, `51-weather`, `52-photo` (+ css) |
| easy-social | `60-social`, `61-audio`, `62-engagement`, `65-companion`, `66-fx` (+ css) |
| devcenter-security | `80-devcenter.js/.css`, `server/**`, `tests/**`, `docs/HANDOVER.md`, `README.md`, `tools/*` |
| qa (last) | any file |

## 13. Phase 4 — 3× speed, start at 정선 만장대, 3D & motion-graphics overhaul, open fixes

### 13.1 Movement ×3 (owner: world-start)
`21-player.js` WALK 3.2→**9.6** m/s, RUN 6.0→**18** m/s (keep both as named constants; derive everything else from
them, never hard-code the old numbers). Requirements that come with it: **sub-stepped movement + collision**
(max 0.25 m per sub-step, so 18 m/s at 10 fps never tunnels through 0.1 m fences/walls; same for walkTo and
rescue paths), acceleration/turn smoothing retuned so control stays precise, **walk/run animation playback rate
scaled to ground speed** (no foot sliding; 20-avatar), footstep audio cadence by distance not time, camera follow
/ look-ahead / FOV kick retuned (22-camera) so the view never lags or jitters, companion 옹이 & visitors that follow
the player keep up (65/60 read `G.sys.player.speedScale`), engagement M_WALK target ×3 (900 m), any distance or
time based balance/anti-cheat (server SaveValidator `stats.distance`) re-checked. Expose
`G.sys.player.WALK / RUN / speedScale (=3)`.

### 13.2 Start at 정선 만장대 (owner: world-start)
New zone **`ZONE_MANJANGDAE` "정선 만장대"** (short "만장대", icon flag/mountain, emoji 🏔️): a high scenic overlook on
the valley's mountain ridge with a traditional pavilion (누각/정자 with dancheong colours), stone viewing deck with
railings, a big carved stone marker "旌善 萬丈臺 · 정선 만장대", a telescope (interactable: zooms the camera over
the valley and names each zone), prayer-flag-free Korean styling (stone lanterns, pine trees, rope fence), and a
safe walkable stone stair/switchback path down to the experience-center paths (no gaps, no colliders blocking,
`walkTo`/A* can route from it to ZONE_MAIN). Data address note stays a display-only disclaimer (location naming
is in-game styling, not verified geography). **New players spawn on the deck facing the valley**
(`G.data.layout.spawn`, 02-layout); returning players keep their saved position. First-entry **intro cinematic** (skippable with
any key/tap, ≤ 9 s, respects reduceMotion → a short fade instead): drone sweep from above the valley up the ridge
onto the pavilion, letterbox bars, 3D title card "정선 만장대" + subtitle, then hand-off to follow camera behind the
player. Everything new lives in **`src/game/17-manjangdae.js` + `src/styles/17-manjangdae.css`**
(`G.sys.manjangdae = { zoneId, lookout:{x,y,z}, intro({force, reduced})->Promise<{skipped, reduced}>, introActive,
whenIntroDone()->Promise, titleShot()->{pos, look, cinematic}, tour(startZoneId?)->Promise, tourActive, openGuide(section?),
walkSpot(from?)->{x,z}|null }`, events `manjangdae:intro {phase:'start'|'end', skipped, reduced}` /
`manjangdae:tour {phase, zoneId}` — the 17-manjangdae.js header is the reference), plus the
needed edits to 01-data (zone, POI, quest/tutorial wording "만장대에서 내려가 발효마스터를 만나요", education/info
sign), 02-layout (spawn, anchors), 11-terrain (plateau + carved path, no zero-normals), 50-minimap (zone shown,
travel target), 70-app title shot uses `G.sys.manjangdae?.titleShot?.()` (owner ui-motion).

### 13.3 3D world & post-processing (owner: engine-atmos)
Quality-scaled (low ≈ today's cost; high = everything): wind-swayed grass/trees/flowers (vertex shader, no CPU per
vertex), drifting petals/leaves & valley mist layers, god rays / sun shafts (cheap screen-space pass on high),
color grading + vignette + subtle filmic tone (one combined pass after bloom, before OutputPass — the
NaNScrubShader stays before bloom), water caustics/foam/ripples, rain splashes, lantern & flag sway, chimney
smoke, night fireflies; selective glow/outline support for hovered interactables
(`G.sys.engine.setOutline(objs[])` or emissive pulse). All shaders NaN-safe (guard normalize/division/pow/sqrt),
no zero-length normals, no flashes > 3 Hz, instanced, no per-frame allocations.

### 13.4 Character & interaction motion graphics (owner: char-fx)
`66-fx`: sprint speed lines + soft afterimage trail at high speed, landing dust/squash, footprint decals that fade,
teleport/travel portal dissolve, zone-enter 3D banner, quest-complete light pillar, coin/item 3D arcs; NPC idle
life (blink, look-at player, small gestures), bouncing 3D quest markers with sparkles, companion 옹이 expressive
3D anims; hover glow on interactables (23-interaction). Everything gated by `G.settings.fxLevel` and reduceMotion.

### 13.5 2D UI/UX motion (owner: ui-motion)
Consistent motion system (tokens: durations 120/200/320/500 ms, ease-out-quint, spring-like overshoot only ≤ 4 %),
animated HUD entrances, panel/modal/page transitions, button press/hover micro-interactions, number count-ups,
shimmer skeletons on loading, toasts with icons, title screen hero with 만장대 and parallax depth, loading screen
motion graphic, accessible focus rings; respects reduceMotion and easy mode (≥ 56 px tap targets).

### 13.6 Open fixes carried over (owners in 13.7)
NEW-1 phone 👆 closes the dialogue it opened (05-input) · voice guide reads strangers' free text aloud (60-social)
· SEC-2 PII mask gaps client+server (judge.json in scratch p3-final-sec) · server cleanText invisible chars (Users)
· nickname allows platform handles/school (Users/ChatFilter) · SEC-3 gate odds + 5-min unlock window re-lock rules
(08-easy) · NEW-4 onboarding hand overlaps HUD (08-easy) · NEW-2 companion tip contradicts 다음 할 일 (65-companion)
· KID-4/NEW-3 tap targets < 56 px (65-companion.css 🔊, 25-npc.css npc-mark, 60-social.css nametag) · SRV-REG-MODE
server register ignores chosen play mode (70-app).

### 13.7 Phase-4 file ownership
| Agent | Files |
|---|---|
| world-start | 01-data, 02-layout, 11-terrain, NEW 17-manjangdae.js/.css, 20-avatar, 21-player, 22-camera, 50-minimap.js, 62-engagement.js |
| engine-atmos | 10-engine, 12-nature, 13-water, 15-buildings, 16-props, 51-weather.js |
| char-fx | 66-fx.js/.css, 23-interaction.js/.css, 25-npc.js/.css, 26-dialogues, 65-companion.js/.css |
| ui-motion | src/template.html, 00-base.css, 01-hud.css, 02-responsive.css, 04-ui.js, 08-easy.css, 70-app.js/.css, all other module CSS not listed elsewhere (30,31,32,40,41,46,47,50,51,52,62,80 .css) |
| fix-security | 05-input.js, 08-easy.js, 60-social.js/.css, 61-audio.js, server/**, tests/** |
| qa (last) | any file |

### 13.8 Final phase-4 behaviour (integrator — this section wins over 13.1–13.6 where they differ)
- **Speed:** `G.sys.player.WALK = 9.6`, `RUN = 18`, `speedScale = 3` (21-player, sub-steps ≤ 0.25 m). Followers read
  `speedScale`: 옹이, simulated visitors (run speed × speedScale clamped 1–3) and remote players (60-social dead
  reckoning ≤ 1.2 s along the last velocity, blocked check, snap when the gap is > 20 m, catch-up damping grows with the
  gap; presence sends every 1 s while moving fast). Server `SaveValidator`: distance per save ≤ `move_max_speed × elapsed
  + move_slack_m`, also on a reset save (≤ 600 s window) → `DISTANCE_TOO_FAST`; `stats` ≤ 200 keys, numeric or null only.
- **Start:** new players spawn on the 만장대 deck; returning players keep their saved position (no intro). The intro
  (`manjangdae:intro {phase}`) runs on game time but never slower than the wall clock (`t = max(t + dt, real elapsed)`,
  ends at 8.3 s), applies a soft grade layer `'md-intro'` (vignette / warmth / contrast, removed at the hand-off),
  hides the HUD, the coach, the pointing hand, `#interact-prompt` and `#labels-layer`, and HOLDS toasts (04-ui; `toast(…,
  {urgent:true})` still shows) and kid voice lines (`G.easy.say` queues while `body.md-intro` / `body.md-scoping`
  unless `opts.intro` / `opts.force`; released on `phase:'end'`). For a new player on the deck the hold starts at
  `game:login`: 17-manjangdae's login handler sets `body.md-intro` synchronously (the cinematic starts 60 ms later), so
  what the login itself unlocks (the first-visit medal toast and voice from 32-progression's later `game:login` handler)
  waits too — its 🏆 chime is not played while `body.md-intro` is on (04-ui's release plays one sound). If the intro does
  not start after all, the class is removed; a logout drops what was held, otherwise `manjangdae:intro {phase:'end',
  skipped:true}` releases it. Any key / tap after 450 ms skips it.
- **Telescope (`tour(startZoneId = 'ZONE_MAIN')`):** each zone is aimed at its largest building (gate ×4 weight; look
  height = ground + 8 m hall / 4.2 m gate / 3 m else); near targets get a closer, higher lens so the foreground fence
  never hides them. Labels and the coach step back while scoping. The guide adds a kid line "체험관 속 풍경이에요. 진짜
  만장대와는 조금 달라요."
- **`walkSpot(from?)`:** a 2.2–3 m deck spot in front of the camera, line-clear, on screen, preferring spots with no
  interactable prompt (telescope / board / marker) nearby. 70-app `_groundPoint()` (the onboarding "tap here" hand)
  uses it first; elsewhere 5 / 3.5 / 2.5 m straight-line samples that are dry, free and level. Ambient interactables
  (`companion · bench · decor`) never push the onboarding coach aside and never count as "the next step".
- **Easy 👉 같이 가기 from the hill:** walks the switchback (run when > WALK × 2.5 m; travel only beyond 170 m from the
  hill), so a new player really walks down "만장대에서 내려가 발효마스터를 만나요".
- **Camera:** the occlusion ray always spans the full follow distance (no pull-in oscillation); the pavilion roof has an
  invisible DoubleSide lathe hull in `G.world.cameraBlockers` so the camera never pokes through the roof corners.
  reduceMotion turns off look-ahead / dolly / FOV kick.
- **Engine (10):** distance culling of small props, decor and jar groups — `CULL_DIST {low:72, medium:125, high:210}` m
  from the camera, checked a few times per second (`G.sys.engine.cullStats` getter → `{items, culled, dist}`);
  `G.gfx.canvasTexture` halves canvases over 600 000 px and uses anisotropy 1 on the low preset; FPS is measured on the
  wall clock and auto-quality only judges windows ≤ 3 s long. `grade(params|null, layer)` layers: contrast / exposure /
  saturation multiply, warmth / vignette / flash add.
  `engine.precompile(maxWait = 12000)` (run by `postInit` behind the loader) compiles every scene material, hidden ones
  included (rain, snow, puddles, night glows, the outline glow, 66-fx portal / zone board / level-up pillar, all built
  hidden at fx init). `engine.render({force})` is what photo capture uses — a forced frame is never thinned out behind
  modals. `engine.onResize(fn(cssW, cssH, pixelRatio))`: the pixel ratio is `min(devicePixelRatio, preset.pixelRatio)`
  and follows browser zoom / a screen change via `matchMedia`. `setSun(el, az, {env:true})` re-bakes the environment;
  otherwise a bake happens every 3° of sun (6° on low), always into the same persistent environment texture
  (`scene.environment` keeps its object, so lit materials keep their programs). The distance-cull limit scales with the
  camera zoom (telescope). 16-props puts small props into per-44 m-cell `props-detail-*` batches (culled as a cell);
  the big `props-cell-*` surfaces are never culled.
- **Motion:** every scale pop ≤ 1.04 (no overshoot past 4 %); the zone banner ends early when the zone changes; it
  rests under the top HUD bars, travels with the camera (same size walking or running), stays on screen when the camera
  turns, and waits for / lifts away from the onboarding coach card;
  minimap travel plays the portal "out" dissolve 220 ms before the teleport (skipped under reduceMotion).
- **UI events:** `ui:modal-open {id, className}` (the parent gate adopts only grown-up screens, 12.2).
- **Kid chat:** in easy mode other players' messages show only when they are preset phrases / emoji (`pub.kidPhrase`);
  free text is hidden and never read aloud; remote names are read as "친구". Nicknames that look like PII (handles such
  as `ig_…`, school + grade, 동 + house number) are refused client- and server-side.
- **One PII rule source:** the client engine between `// >>> PII ENGINE` markers in 60-social.js is exported by
  `node tests/pii-sync.mjs` to `server/lib/pii-rules.json` (deployed next to `ChatFilter.php`, which also mirrors
  fold / units / nickname predicates). The strict build runs `pii-sync --check`; `tests/pii-client.mjs` checks every
  vector of `tests/pii-vectors.json` in the built game and against PHP with and without intl (outputs must match).
- **Small integration rules:** the onboarding coach publishes `--coach-lane-bottom` (a card in the lower half pushes
  the toast lane just above it — no toast ever covers the card on phones); 50-minimap re-checks the zone on the frame
  after any `player:moved` (a teleport registers the zone visit at once); 65-companion says one short line per
  `weather:rainbow {on:true}` and at most one a minute per `weather:shootingstar` (never during the intro / telescope /
  a dialog); the 62-engagement ranking shows `G.ui.skeleton()` rows while loading; the dev-center GPU tab shows the
  current frame's draw calls / triangles and the distance-cull count.

### 13.9 Phase 5 (bug sweep) round 1 — behaviour and APIs added by the fixes
- **World queries (06):** a collider with a finite `maxY` is a standable top in `G.world.heightAt(x, z, fromY)` when
  `maxY <= fromY` (its `minY` is honoured: a walker whose head is below `minY` is not on it); `fromY = Infinity`
  (`surfaceHeight`) ignores collider tops. `G.world.blocked(x, z, r, feetY)` honours `minY` / `maxY` exactly like
  `resolve()` (an overhead beam does not block, a low top the feet are above does not). NPCs, visitors, 옹이 and remote
  players rely on these. `addCollider({…, maxY, stand:false})` keeps `maxY` for blocking only — the top is never a
  platform (12-nature shrubs, 62-engagement decor and sign posts): a walker that lands on one slides off. Shrub tops sit
  0.1 m above the highest ground beside them, so a bush on a slope is never "passed over" from the uphill side.
- **Inventory (30):** `G.sys.inventory.room(itemId)` → how many more fit (0 = that stack is full) and
  `G.sys.inventory.fullNotice(itemId)` (the "가방이 꽉 찼어요" toast, kid words in easy mode). Harvest, jar claim and
  craft refuse to run at 0 room (nothing is used up).
- **Education (45/46):** `G.sys.education.openTool(toolId)` — the traditional-tool card; `layout.tools` are registered as
  interactables of kind `'tool'` (Q_CULTURE counts 3 distinct ones). `G.data.toolInfo[TOOL_*] = {model?, icon, tagline,
  text, facts:[[label, value]…], kid}`; `G.data.kidSigns[SIGN_*] = {title, text}` (the kid sign card). Kid quiz picture
  choices are shuffled per opening (⭕ / ❌ keep their places); `_kidOrder(quizId)` is the dev self-test seam. In kid
  lesson slides the small grown-up caption inside an illustration (`class="ev-cap"`) is hidden — the slide line reads it.
- **Journal (47):** entries reference album photos (`photo: null` + `photoId` → `G.state.photos`); a copy is kept only
  for uploads or photos the album dropped, within a budget fitted under `limits.saveMaxBytes` together with the album
  (oldest copies go first). `onStateLoaded` drops non-object rows.
- **Local storage full (03 LocalAdapter):** a save that hits the quota frees room step by step and retries after each:
  this profile's `<key>.corrupt` stash, then `<key>.bak`, then diary `data:` copies in the written copy (copies of photos
  the album keeps first, then all; entries keep their `photoId`), then the oldest album photos of the written copy (as
  many of the newest photos as fit, binary search). Only the WRITTEN copy is trimmed — `G.state` keeps every photo and diary
  picture, so repeated saves under quota write the same copy and never shrink the album further. `G.save.quota =
  {tight, noted}` (reset per profile): `tight` stops 47-journal copying album photos back into entries; one toast per
  profile session. A load whose storage probe throws a quota error says "저장 공간이 꽉 찼어요" (not "blocked").
  `LocalAdapter.remove()` and local account / kid-profile deletion also remove `<key>.corrupt`.
- **Session expiry in server mode (70-app):** in easy mode the re-login is a kid card ("어른을 불러 주세요") → parent gate
  (`'login'`) → password form; never a password box first. The relogin keeps the account's "로그인 상태 유지" choice;
  register.php accepts `remember` like login.php. An expected 401 on save logs a warning, not an error.
- **Farming (40):** rain fills beds to 92 % at most (`RAIN_WATER_CAP`); watering by hand still reaches 100.
- **Quest kid cards (31):** a `photo` objective with `photoZone` outside that zone shows 👉 같이 가기 (walk there) instead
  of opening the camera — the same rule as `G.easy.nextStep()`.
- **Server saves (03 + server):** `ServerAdapter.rev` is the revision this tab is based on (`get.php` / `save.php`
  answers; 0 for a brand-new player, `null` = unknown); every save — and the page-hide beacon — sends
  `{version, checksum, base, data[, csrf]}` in that key order. A stale base → HTTP 409 `STALE_SAVE` with the stored copy:
  the tab restores it (toast "다른 창(기기)에서 더 새로 저장한 진행 상황을 불러왔어요.") and continues from its revision;
  when the stored copy is one this tab sent itself (`ServerAdapter.sent`: the `savedAt` of its last 8 saves / beacons — a
  page-hide beacon, or a save whose answer was lost) the save is retried once with that revision instead.
  The revision resets on every `useProfile` (login / logout). The server refuses (400 `INVALID_SAVE`) any map key down to
  three levels that is an Object.prototype member name (`__proto__`, `constructor`, `toString`, …), validation on or off.
- **Session end:** 60-social reports a 401 / `AUTH_REQUIRED` from chat or presence polling as
  `save:auth-lost {source:'social'}` once per loss; 70-app's relogin dialog is idempotent (round-2 rules in 13.10).
- **Network (03):** `G.net.request` treats an answer whose body did not finish before the time limit as
  `NETWORK_ERROR` (status 0, retried like any timeout) — never as a refusal `HTTP_200`.
- **Kid text sizes:** in easy mode 3D name tags (`.wl.nametag .nm / .role`) are ≥ 14 px; kid chat bubbles, the 오늘
  hub, kid lesson stats and the kid quiz question are ≥ 16 px; chat initials are dark ink on a light per-name pastel.
- **Camera (15, 22):** tiled hanok roofs add their eave underside and edge strips (`soffit`, `fascia` buckets) to
  `G.world.cameraBlockers` next to `roof`. When the spot the camera would take is crowded (a roof just above or
  below), `_occlusion` bisects (4 probes) for the largest clear distance between 1.05 m and that spot instead of
  stepping in by 0.6 m, so a low roof (정자) keeps the distance it allows.
- **Developer center (80):** with the world up, the linter checks quest `interact` objectives against the registered
  interactables (`G.interact.get(id)`, or ≥ `count` of `G.interact.list(kind)` — quests count distinct ids) and
  collection `{on:'interact', id}` unlocks (error when it is the item's only rule). The kid audit measures SVG text at
  its on-screen size, skips colour contrast for drawings (their `fill` sits on the drawing's own shapes) and ignores
  emoji joiners / variation selectors. Self-tests: 94 (16 added for these fixes).

### 13.10 Phase 5 (bug sweep) round 2 — behaviour and APIs added by the fixes
- **Moderation reaches open games (server + 60 + 62):** `chat/list.php?after=<id>&rafter=<cursor>` also answers
  `retracted {messages:[id], users:[uid]}` — lines hidden (admin.php, 3 reports) and accounts banned since the client's
  retraction cursor (nothing on the first poll, `after=0`) — and `retractId`, the new cursor (pages of 200). Schema v3:
  table `chat_retractions` (`Retractions::add / since`, ChatFilter.php); the v3 migration also moves the text a reporter
  typed for a report without a message id into `chat_reports.memo`, marked unverified (chat/report.php stores it that way
  now). 60-social `_retract(mids, uids)` drops those lines from the log, the kid chat, the unread count and the speech
  bubbles and emits `chat:retracted {ids:['s<n>'], users:['<uid>']}`.
- **알림함 mentions (62):** a mention notice is fixed text — title "친구가 나를 불렀어요", line "눌러서 채팅을 봐요." — and keeps
  no nickname and no chat words; it is saved that way (also to the server), and older saves are scrubbed at load. Who said
  what lives in memory for this session only (`_mentionLive`: the grown-up inbox shows the latest line); a
  `chat:retracted` naming that line or its account removes the notice (a coalesced notice only loses those mentions).
- **Chat pause (server + 60):** chat/send.php `403 MUTED` carries `data.until` (ms); presence/update.php answers
  `mutedUntil` (0 = not paused). 60-social holds sends until then (no line, no bubble, nothing read aloud) and a child in
  easy mode hears "지금은 말하기를 잠깐 쉬어요." — never the grown-up text. Local mode keeps no report log:
  `localStorage['tfm.v1.chat.reports']` is removed on profile load.
- **Session ownership (server):** a login stores the account row's creation time (`'born'`); `Session::ownsAccount($user)`
  is false for a remembered session whose id now names another account row (after a database restore, README-SERVER §9)
  and `Auth::current()` ends it ('other account'). A 401 `AUTH_REQUIRED` carries `data.why` (`'epoch'` | `'banned'` |
  `'deleted'` | `'other account'`) when that request found its session invalid (none for an expired or absent session).
- **Session end (03 / 60 / 70):** 03-state emits `save:auth-lost {reason, notify}` on the first 401 of a loss and again for a
  save the player asked for; 60-social reports once per loss (`{source:'social'}`), pauses presence while the session is
  gone (other players' avatars are cleared, a guest-readable chat poll does not re-arm the report) and resumes on
  `state:saved` or a new login. 70-app: "나중에" — on the kid card, when the parent gate is left, or when the re-login
  form closes without logging in — holds for the rest of that login (`app._loginSeq`): later reports do not ask again; a
  save the player asks for (`reason:'manual'` or `notify`) does; `state:saved`, `save:recovered` or a new login clear it.
  Modal autofocus (04-ui) takes `[autofocus]` first, then the first drawn, enabled field (the re-login form focuses its
  password box, not the hidden username field kept for password managers).
- **Restored saves (server + 03):** admin.php "직전 저장으로 되돌리기" (`AdminOps::restoreBackup`, one transaction) stamps
  `player_saves.meta = {restoredRev, restoredAt}` (the ledger starts over). While the row's revision is still
  `restoredRev`, a stale save is refused with 409 `STALE_SAVE` and `data.restored: true`; 03-state then loads the row as
  `SAVE_RESTORED` (drops the pending copy, toast "운영자가 되돌린 저장 기록을 불러왔어요…") whoever saved that copy. Without
  the flag, `ServerAdapter.confirmed` (savedAt → revision of the copies this tab saw confirmed) still recognises a restore
  of a copy this tab saved. An accepted save clears the stamp.
- **Roles and sign-up (server):** `SaveValidator` sets `profile.role` to the account's role (a stale or forged role is
  overwritten and logged, never refused — `PROFILE_ROLE` is gone); 70-app adopts the server's role / nickname on re-login
  and the dev center trusts `G.auth.serverUser` for the same account. register.php answers the per-address limit
  (`rate_limits.register_ip`) with 429 `REGISTER_IP_LIMIT` (`data.retryAfter`, `Retry-After`); 70-app says the limit
  belongs to this network (학교·집) and when to try again.
- **Taps (04 / 08 / 65):** the global tap shield (`G.ui.shieldTaps(ms)`) and `G.ui.armTaps(el, ms = 360)` judge a press
  by its event time stamp (when the finger came down, not when a slow frame ran the handler) and also swallow the click
  of a swallowed press that arrives after the window; keyboard and synthetic clicks pass. `armTaps` guards every card
  that pops up by itself: the reward popup, the healthy-play reminder and rest screen, and 옹이's speech card. A
  second-finger touch on a `[data-action]` control acts on its release (< 550 ms, < 16 px, still on it); a click that
  follows is swallowed (700 ms).
- **Layout:** `.modal-backdrop` padding and popover placement respect `env(safe-area-inset-*)` (`--bd-pad`, `.safe-probe`
  in 00-base). On touch screens in normal mode `body.is-touch:not(.easy)` controls are ≥ `var(--tap)` (40 px): the shared
  rules in 02-responsive plus module rules (shop stepper, journal chips, hub tabs, emote picker tabs, dev-center icons,
  title chips, world-map zone rows). World-map zone chips and lesson page dots keep their drawn size and get a one-tap
  area around them (`::before`; the dots sit one tap apart); the title's inline text links get a one-tap-high box that
  does not make their line taller (padding + negative margin), and form checkbox rows centre the box on its text. A tab
  row that scrolls sideways (phones) shows the chosen tab once the row is laid out, also when a dialog opens straight
  onto a later tab (`G.ui.tabs`). Kid views: 옹이's card face ≥ `var(--tap)` on phones, the kid
  weather tiles go 3 + 2 under 360 px, kid dialog titles never split a word (`keep-all`; one longer than the line still
  wraps), the hub greeting wraps on phones (no "…").
- **Easy mode (08 / 70):** `easy:gate-left {why, title}` — a gate session ended by a tab hide or `GATE_IDLE` (3 min, counted
  as idle time on the grown-up screens: a tap, key or scroll there extends it) closes the screens its pass opened; the
  title's 어른 메뉴 view goes back to the kid view, and in easy mode the developer center and debug panel close on a tab
  hide. Voice lines said while the tab is hidden are held (last 2) and read on return if < 15 s old. The healthy-play
  counter is per child: `sessionStorage['tfm.v1.playActive'] = {'kind:id': seconds}` for the last 6 children.
  `stats.playTime` counts visible time with input in the last 90 s, only while a game session runs. Input is a press,
  key, wheel or touch, and also a pointer / touch MOVE with a finger or button down (steering the joystick, dragging the
  camera; a bare hover is not), so steady steering counts in full — the healthy-play counter uses the same rule.
- **Photo / weather (52 / 51):** one shutter press = one photo — presses within 600 ms of the last are ignored, by event
  time stamp (this also keeps the soft flash under 3 Hz); entering or leaving photo mode calls `G.ui.shieldTaps()`. Both
  weather cards are capped at `100dvh` minus the placement margins (or safe-area insets) and scroll; the kid weather card
  turns 2-column at `(max-height: 560px) and (min-width: 540px)`. At `max-height: 560px` the album body has no minimum
  (it scrolls, its 📸 / 닫기 row stays on screen) and the opened photo is 2-column with a height-fitted stage.
- **Developer center (80):** self-tests: 108 (13 added for these fixes: retraction, blocked rows in easy chat, mention
  notices, play counter format, rest card, kid card footers, `armTaps`, `[data-action]` once, dialogue label layer,
  intro hold at login, world-map transform mapping, shutter double tap, weather card scroll).

## 14. Phase 6 — server environment (Apache 2.4 · PHP 7.2 · MariaDB 10.3), black-region guard, 2× base speed with paid 2×/3×/4× tiers (토스 결제 + DB), double jump, "게임" wording purge, optimization

The user's hosting (phpMyAdmin screenshot): **Apache/2.4.34 (Win32), PHP 7.2.10, MariaDB 10.3.8**, phpMyAdmin 4.8.3, extensions seen: mysqli, curl, mbstring (XAMPP-style install: pdo_mysql, pdo_sqlite, openssl, gd, json, session are normally on; **intl and sodium must not be required**). Everything in this section ships in both the single HTML (local mode) and the server copy. Requests verbatim: "서버 환경에 맞추어서", "검정색으로 표시되는 모든 부분을 수정", "캐릭터 이동속도를 2배로 기본으로", "진행 속도를 2배 3배 4배 까지 선택 … 비용을 구독으로", "토스결제", "디비랑 연동", "모든 소스를 최적화", "스페이스바 두번 누르면 더블 점프", "게임이라는 모든 문구 및 글자를 없애고 … 만장대라고 표시", "html 파일로도".

### 14.1 Speed: 2× base movement + progression tiers (owner: speed-jump; server part: server)
- **Base movement = 2× the phase-1 pace:** `21-player` `WALK = 6.4`, `RUN = 12` m/s, `speedScale = 2` (phase 4 was 9.6 / 18). Sub-stepping (≤ 0.25 m, ≤ 16 slices) stays. Every module that reads pace reads `G.sys.player.WALK / RUN` (companion keep-up, social anim thresholds, SaveValidator `move_max_speed` = `RUN × movementMultiplier × 1.5`).
- **New fragment `src/game/07-speed.js` → `G.sys.speed`** (order right after 03-state, before everything that moves or grows):
  - `tier` (1 | 2 | 3 | 4) — **read-only mirror of `G.state.sub.tier`**; local mode is always 1 (no purchase possible without a server); server mode: whatever `api/auth/me.php` / `login.php` / `player/get.php` report under `sub` (server-authoritative, see 14.6).
  - `progression()` → number: `tier` (crop growth rate, fermentation progress incl. offline catch-up, jar hygiene decay is NOT sped up, nothing that protects the child is sped up: healthy-play timers, parent-gate cool-down, chat rate limits, rest reminders never scale).
  - `movement()` → `min(tier, 3)` (tier 4 moves 3× — collision, camera and companion are tuned up to RUN 36 m/s; progression still 4×). `G.sys.player` multiplies its target speeds by `movement()` every frame (no caching across tier changes).
  - `setFromServer(sub)` validates and stores `{tier, status, expiresAt, autoRenew, source:'server'}` into `G.state.sub` and emits `speed:changed {tier, prev}`; `G.bus.on('sub:changed')` also calls it. Invalid / missing → tier 1.
  - `label()` → `'⚡2×'` etc.; `devTier(n)` only when `G.sys.devcenter` is open and not in easy mode, never saved, logs `[speed] dev tier`.
- **State:** `G.state.sub = { tier: 1, status: 'none', expiresAt: 0, autoRenew: false, source: 'local' }` (03-state default + migration for older saves; `sanitize` clamps tier to 1..4). The server ignores the client's `sub` on save and forces the DB value (like `role`).
- **HUD:** a chip next to the level chip (`#hud-speed`, hidden at tier 1): normal `⚡2×`, easy `⚡ 2배 빨라요`. Changing tier pulses the chip (transform/opacity only) and 옹이 says `'와, 더 빨라졌어요!'` once.
- **Camera (22):** feed-forward follow, look-ahead and FOV kick re-tuned for 12 / 24 / 36 m/s run; easy mode stays gentle (FOV kick ≤ 4° at any tier). Companion (65) keeps up at `RUN × movement()`; social (60) `runAt` threshold uses `WALK/RUN × movement()`.
- **Server (SaveValidator):** thresholds scale with the user's tier from the `subscriptions` table: `move_max_speed = 12 × min(tier,3) × 1.5`, `ferment_max_speed = 1.2 × tier`, crop growth max rate × tier. A tier change mid-session is accepted either way for the next save (both tiers tried, the larger wins once).

### 14.2 Double jump (owner: speed-jump)
- First Space (or the jump button) on the ground = jump (`JUMP_V 5.7`, coyote + buffer as today). **A second press while airborne after a jump, before landing = double jump:** `v.y = max(v.y, 0) × 0.25 + JUMP2_V (5.2)`, one per airtime (`_doubleUsed`, reset on landing), not from a plain fall, not while sitting / sliding / in a cinematic. Touch: tapping the jump button again while airborne; keyboard: `G.input.consumeJump()` while airborne is consumed by the double jump instead of being buffered.
- **Looks:** 20-avatar `rig.flip()` — a 360° forward tuck-flip (0.5 s, eased, no overshoot), arms in, landing squash as today; 66-fx `doubleJump(pos)` — a small ring + 6–10 sparkles at the feet (pooled, off at `fxLevel 'off'`, no flashes > 3 Hz); 61-audio `'jump2'` chime (reuses the synth, no new asset). Event `player:jump {n: 1|2}`; `stats.doubleJumps` counter; 62-engagement adds achievement `ACH_DOUBLE_JUMP` ("두 번 점프 10번", reward ids/values in 01-data, additive only) and 옹이 tips it once: `'점프하고 한 번 더 누르면 두 번 점프!'`. Easy-mode coach gets no new mandatory step.

### 14.3 "게임" wording purge + the start button says 만장대 (owner: text-purge, serialized after the build)
- **No user-visible "게임" anywhere:** UI strings, `data-say` voice lines, toasts, help, settings tabs, terms, dev-center panels and rendered docs, admin.php, README.md, server/README-SERVER.md, docs/HANDOVER.md, docs/ARCHITECTURE.md, `<title>` / meta description, noscript, fatal screens. Replacement guide: `게임 시작` → **`만장대`** (the normal-mode `.ts-start` label becomes `<b>만장대</b><small>정선 만장대에서 시작해요</small>`; the easy-mode big button `▶ 만장대` with voice `'만장대로 놀러 가요!'`); `게임 방법` → `체험 방법`; `게임 설정` / settings tab `게임` → `체험`; `게임 저장·데이터` → `체험 기록`; `게임으로 돌아가기` → `체험관으로 돌아가기`; `게임 속` → `체험관 속`; `게임 내 칭호` → `체험관 칭호`; `게임을 시작하지 못했` → `체험관을 열지 못했`; `미니게임` → `놀이`; `3D 게임 화면` → `3D 체험 화면`; `교육형 메타버스 게임` → `교육형 메타버스 체험관`. Identifiers, ids, file names, CSS classes and English `game` stay. Regex sources in 60-social / `server/lib/pii-rules.json` / `tests/pii-vectors.json` that *detect* words are data, not UI — keep them.
- **`tools/text-audit.mjs`** (new): builds (or takes `--html`), extracts every string literal / template / HTML text of src/**, server/**/*.php, docs, README, and fails (exit 1) listing file:line for any `게임` outside the allow-list `{60-social.js regex sources, pii-rules.json, pii-vectors.json, CONTRACT.md §13 history quotes}`. The gate runs it.

### 14.4 Black-region guard (owner: render-guard) — "검정색으로 표시되는 모든 부분"
The user's screenshot (normal mode, high quality, Windows GPU) shows an opaque **black rectangle fixed to the screen**, top-centre, ≈ 45 % wide × 56 % tall, with the HUD drawn over it and the world visible around it, while the player stands at the farm after the tutorial step "목표 찾기 3/4". Phase 3 already proved this GPU turns NaN into black. Candidates to reproduce first: a camera-attached quad with a non-finite opacity / scale / uniform (zone banner `CM.banner`, portal, light pillar, speed lines, afterimage, the 만장대 title card, telescope overlay) or a canvas texture that never drew (`G.gfx.canvasTexture` with a null 2D context: Chrome caps live 2D canvases). Fix the cause you find **and** ship all three layers:
1. **Sanitation:** `G.gfx.guard.watch(obj, {uniforms})` — every frame, for registered objects (all screen-space / camera-attached quads and all FX ShaderMaterials, title card, banners, tags) check `material.opacity`, `scale`, `position`, listed uniforms for non-finite values; on failure hide the object for the frame, reset to a safe value, count it (`guard.stats`). `G.gfx.canvasTexture` returns a 1×1 transparent texture (and marks `texture.userData.blank = true`) when `getContext('2d')` is null, and callers that draw text boards skip the mesh when `blank`.
2. **Screen watchdog:** every 2 s render the final frame (a copy pass at the end of the composer, or the plain scene when there is no composer) into a 96×54 target and read it back; find the largest axis-aligned block of pure black (all channels < 6) or pure white (> 250). A block ≥ 5 % of the area in 2 consecutive probes = anomaly → **quarantine ladder**, re-probing after each step: (a) hide all registered FX/quads (`G.fx.quarantine(true)`), (b) disable the composer (plain render), (c) hide canvas-texture boards, (d) switch to the low preset. Each step logs `gpu:anomaly {step, block}`; the child sees nothing (no toast); the dev-center GPU 안전 tab shows the state and offers "다시 켜기". Night sky and shadows are not pure black (they are tinted) — verify the thresholds against noon / night / rain / fog screenshots at the deck, farm, plaza, hall and jangdokdae on low / medium / high.
3. **No-WebGL2 / renderer failure (R3 critical `device-env-3`):** three r170 needs WebGL2. Before boot `10-engine` probes `canvas.getContext('webgl2')`; when missing or the renderer throws, emit `engine:unsupported {reason}` and 70-app shows a friendly full screen (`'이 기기에서는 3D를 열 수 없어요'`, 크롬·엣지·사파리 최신 버전 안내, a `그래도 열기` that starts a **2D-only mode**: HUD, 배움 (education), 일기, 설정, 도움말 usable, the 3D canvas hidden, movement disabled) — never a black dead world. Also fix the other R3 render bugs assigned to you.
- Dev-center: `runTests` gets `guard: NaN opacity on a watched quad is hidden`, `guard: blank canvas texture is skipped`, `watchdog: injected black block is detected and quarantined` (inject by adding a full-screen black quad in a test, then remove).

### 14.5 Server port: Apache 2.4 (Win32) · PHP 7.2 · MariaDB 10.3 (owner: server)
- **PHP ≥ 7.2 syntax only, everywhere under server/** (the suite must also still pass on PHP 8.3 in the sandbox): no arrow functions `fn`, no `match`, no `??=`, no typed properties, no union / `static` / `mixed` / `never` types, no nullsafe `?->`, no named arguments, no constructor promotion, no `catch (\Throwable)` without a variable, no trailing commas in calls or parameter lists, no numeric separators, no `enum`, `readonly`, attributes; no `str_contains/str_starts_with/str_ends_with/array_is_list/array_key_first/array_key_last/is_countable/hrtime/get_debug_type/mb_str_split/fdiv/preg_last_error_msg`; `JSON_THROW_ON_ERROR` replaced by `Json::decode()/encode()` helpers that check `json_last_error()`; `session_set_cookie_params([...])` / `setcookie(…, [...])` array forms replaced by `Cookie::session()` / `Cookie::set()` that emit `Set-Cookie` headers with `SameSite=Lax; HttpOnly; Secure` by hand on `PHP_VERSION_ID < 70300`; `PASSWORD_ARGON2ID` → `Users::algo()` picks ARGON2ID → ARGON2I → BCRYPT by `defined()`; `random_int/random_bytes/hash_equals/password_*` fine. New `lib/compat.php` (polyfills for the string/array helpers, loaded first by bootstrap). No `intl` / `sodium` requirement (fallbacks already exist; verify). Windows: `DIRECTORY_SEPARATOR`-safe paths, `realpath` on `C:\`, `flock` ok, no `posix_*`/`pcntl`, `.htaccess` only uses mod_rewrite/mod_headers/`Require all denied` (Apache 2.4), `AllowOverride All` assumed (XAMPP default) and documented.
- **Verification is mandatory, in this order:** (1) `composer require --dev squizlabs/php_codesniffer phpcompatibility/php-compatibility` in a scratch dir (packagist is reachable) and `tools/php-compat.sh` → `phpcs --standard=PHPCompatibility --runtime-set testVersion 7.2- --extensions=php server/` must report **0 errors**; (2) try, with a 25-minute cap, to get a real PHP ≤ 7.4 CLI (the Ubuntu PPA / sury are unreachable; try `https://www.php.net/distributions/php-7.2.34.tar.gz` built with `--without-openssl --with-pdo-mysql=mysqlnd --with-pdo-sqlite --enable-mbstring --with-curl --disable-all`-style minimal config, or a prebuilt static 7.4 from `dl.static-php.dev`); if you get one, run `php -l` on every file and `tests/server-e2e.mjs` on it; if not, say so and rely on (1); (3) `apt-get install -y mariadb-server mariadb-client` (reachable), start `mysqld` on a free port with a scratch datadir as root (`--user=root`), create the database with `database/schema.sql`, run `tests/server-e2e.mjs` with `TFM_DB_DRIVER=mysql` (+ host/port/user) — all PASS on MySQL **and** on SQLite, on PHP 8.3; (4) `php -l` all files on 8.3.
- **MariaDB 10.3:** `database/schema.sql` uses nothing newer than 10.3 (no `RETURNING`, no `JSON_ARRAYAGG`, no `JSON` validation assumptions; `utf8mb4_unicode_ci`; indexed VARCHAR ≤ 191 chars; `ROW_FORMAT=DYNAMIC`), is importable as-is in phpMyAdmin (optional commented `CREATE DATABASE … CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` at the top) and is also applied by `Db` auto-migrate; new tables of 14.6 are in both schema files with a `schema_version` bump and a migration path for existing installs.
- **Installer `server/install.php`** (web, Korean, grown-up facing): checks PHP ≥ 7.2, required extensions (pdo_mysql or pdo_sqlite, mbstring, curl, json, openssl, session; warns for gd/intl/sodium), writable `data/`, `uploads/`, `data/sessions/`, DB connection (form: host/port/db/user/pass, defaults root / empty like XAMPP), creates the schema, the first admin, writes `config/config.local.php`, then locks itself (`data/install.lock`; rerun only when the lock is deleted). `cli/tfm.php install` does the same headless. `docs/SERVER-INSTALL-KO.md` (new): XAMPP step-by-step with phpMyAdmin import, folder `htdocs/metaverse`, `http://localhost/metaverse/`, Apache `AllowOverride All`, Windows 작업 스케줄러 for `cli\tfm.php sub:renew`, Toss keys, HTTPS note. README-SERVER.md links it.

### 14.6 Subscription tiers + 토스페이먼츠 + DB (owner: server for PHP/DB; sub-ui for the client)
- **Tables** (both schemas): `subscriptions(user_id PK, tier TINYINT 1..4, status ENUM none|active|past_due|canceled, started_at, expires_at, auto_renew TINYINT, billing_key VARCHAR(255) '', customer_key VARCHAR(64) '', last_order_id VARCHAR(64) '', updated_at)`, `orders(id AUTO PK, order_id VARCHAR(64) UNIQUE, user_id, tier, amount INT, currency 'KRW', kind ENUM first|renewal|manual, status ENUM created|confirmed|failed|canceled|refunded, payment_key VARCHAR(200) '', method VARCHAR(40) '', receipt_url VARCHAR(500) '', toss_status VARCHAR(40) '', raw MEDIUMTEXT, requested_at, approved_at, created_at)`, `payment_events(id AUTO PK, order_id, event VARCHAR(60), payload MEDIUMTEXT, created_at)`.
- **Config** `'toss' => ['client_key' => env TFM_TOSS_CLIENT_KEY (no default since phase 7 — §15.7 #8: an empty key means payments are 'unconfigured' unless mock mode is on), 'secret_key' => env TFM_TOSS_SECRET_KEY (no default since phase 7; never committed, only in config.local.php / the environment), 'mock' => env TFM_TOSS_MOCK (default false; the e2e test sets true), 'period_days' => 30, 'grace_days' => 3, 'tiers' => [2 => ['price' => 2900, 'name' => '⚡ 2배'], 3 => ['price' => 4900, 'name' => '⚡⚡ 3배'], 4 => ['price' => 6900, 'name' => '⚡⚡⚡ 4배']]]` — prices are placeholders the operator edits. Never log the secret key; `admin/health` reports whether real keys are set.
- **Toss API (documented contract, servers are NOT reachable from the sandbox — implement by contract + mock):** auth header `Authorization: Basic base64(secretKey + ':')`, JSON, cURL with `CURLOPT_TIMEOUT 15`, TLS verify on. `POST https://api.tosspayments.com/v1/payments/confirm {paymentKey, orderId, amount}` → 200 `{status:'DONE', method, receipt:{url}, approvedAt, totalAmount}`; `GET /v1/payments/{paymentKey}`; `POST /v1/billing/authorizations/issue {authKey, customerKey}` → `{billingKey, customerKey, card:{…}}`; `POST /v1/billing/{billingKey} {customerKey, amount, orderId, orderName, customerEmail?, customerName?}` → payment object; `POST /v1/payments/{paymentKey}/cancel {cancelReason}`. Errors: `{code, message}` with 4xx. Mock mode (`toss.mock`): `confirm` accepts `paymentKey` starting with `mock_` for the stored order, `billing` issues `mock_bk_…` keys and "charges" always succeed unless `orderId` ends with `_fail` (used by tests).
- **Endpoints** (`api/sub/`, all JSON, same CSRF/session rules as the rest, rate-limited): `status.php` GET → `{sub, tiers:[{tier,name,price}], mode:'live'|'mock', clientKey, periodDays}`; `prepare.php` POST `{tier, kind:'card'|'billing'}` → creates an `orders` row (`created`, random 32-char orderId, amount from config, `customerKey` = stable per user `cus_<hash>`), returns `{orderId, amount, orderName, customerKey, clientKey, successUrl, failUrl, mock}`; `confirm.php` POST `{paymentKey, orderId, amount}` → order must be `created`, belong to the user, amount must match exactly, then Toss confirm (or mock) → order `confirmed`, subscription `active` with `expires_at = max(now, expires_at) + period`, `last_order_id`, audit log → `{sub}`; `billing-issue.php` POST `{authKey, customerKey, orderId}` → issue billing key → charge the first period (`/v1/billing/{key}`) → same activation + `auto_renew = 1`; `cancel.php` POST → `auto_renew = 0` (access until `expires_at`); `return.php` GET (the Toss `successUrl`/`failUrl` target: `?kind=card&paymentKey&orderId&amount` or `?kind=billing&authKey&customerKey&orderId` or `?code&message`): a small server-rendered Korean page that performs confirm / issue for the logged-in session (top-level GET navigation → Lax cookie present), then redirects to `../../index.html?sub=ok|fail&tier=N&msg=…`; `webhook.php` POST (no session; Toss `PAYMENT_STATUS_CHANGED`/`CANCEL` events): never trusts the body — re-fetches `GET /v1/payments/{paymentKey}` (skipped in mock), records `payment_events`, marks canceled/refunded orders and downgrades the subscription when the paid period's order is canceled; idempotent by `(order_id, event, status)`; `renew.php` POST admin-only (or `cli/tfm.php sub:renew`): for `active && auto_renew && expires_at - 1 day < now` charge the billing key, on success extend, on failure `past_due` (then `none` after `grace_days`). Login / `me` perform the lazy renewal check too (bounded to once per hour per user). All money fields are integers (KRW).
- **Admin:** admin.php gets a `구독` tab: subscriptions (user, tier, status, expiry, auto-renew, last order), orders list, **수동 부여** (tier + days, for schools / events, audit-logged) and **해지**, both CSRF-protected admin actions; `cli/tfm.php sub:grant <user> <tier> <days>`, `sub:list`, `sub:renew`.
- **Client (`src/game/72-subscription.js` + `72-subscription.css`, `G.sys.subscription`):** `open()` (behind the parent gate reason `'subscription'` in easy mode; from 어른 메뉴 and the settings `체험` tab) shows: the current plan, three tier cards (name, price `₩2,900/월`, what speeds up: 이동·작물 자라기·발효), buttons `자동 갱신 구독 (토스)` and `한 달 이용권 (1회 결제)`, `해지하기` when auto-renew is on, the legal note (상품·요금·결제대행 토스페이먼츠·환불 문의), and in **local mode** the cards are shown disabled with `서버에 설치하면 구독할 수 있어요` + a link to the install guide. `buy(tier, kind)`: `prepare` → load `https://js.tosspayments.com/v2/standard` on demand (once; never in local mode; CSP allows it, see below) → `TossPayments(clientKey).payment({customerKey})` → `requestPayment({method:'CARD', amount:{currency:'KRW', value}, orderId, orderName, successUrl, failUrl, customerName})` or `requestBillingAuth({method:'CARD', successUrl, failUrl, customerName})`. Mock mode: a built-in `테스트 결제` dialog (no SDK) that calls `confirm` with `mock_<orderId>`. On `?sub=ok` the app refreshes `status`, applies `setFromServer`, shows a celebration (confetti ≤ 3 Hz, reduceMotion → none) and a toast `'⚡ 2배 빠르게 시작!'`; on `?sub=fail` a calm error. The URL query is cleaned with `history.replaceState`.
- **CSP (tools/build.mjs):** add `https://js.tosspayments.com` to `script-src`, `https://*.tosspayments.com` to `frame-src` and `connect-src`, keep everything else as strict as today; the same HTML is the standalone file (the SDK is only loaded in server mode after a grown-up action, so the allowance is inert offline).
- **Security / kid safety:** the subscription screen is never reachable from a kid screen without the gate; prices never appear on kid screens; `prepare/confirm/cancel/billing-issue` require a session + CSRF; `confirm` compares the amount with the stored order, refuses replays (`confirmed` orders) and foreign orders; the webhook is rate-limited, verified by re-fetch, and cannot *raise* a tier; secrets stay in config (never in the client); audit log entries for every tier change.
- **Tests:** `tests/server-e2e.mjs` adds (mock mode): status → prepare(card) → confirm → `me.sub.tier` = N → a save with tier-scaled speeds accepted; amount tampering refused; replay refused; another user's order refused; prepare(billing) → billing-issue → auto_renew on → `sub:renew` CLI extends; `_fail` order → past_due; cancel → auto_renew off, access kept; webhook unverifiable → ignored; admin grant/revoke; a non-admin cannot grant; CSRF checks on every POST. Dev-center self-tests: `speed: tier 3 → player target speed ×3 and crop rate ×3`, `sub: setFromServer clamps garbage to tier 1`, `double jump once per airtime`.

### 14.7 Optimization (owner: optimize, serialized) — "모든 소스를 최적화"
Measure first, then act, then re-measure and report numbers: (1) **build:** minify the concatenated game script with esbuild (`minifyWhitespace + minifySyntax`; identifiers only if nothing reads `.name` / `toString()` of our functions — grep first; `keepNames` otherwise), keep a `--dev` unminified build for debugging, CSP hashes are computed on the final text; (2) **font:** if `tools/build.mjs` embeds Pretendard, subset it (all 11,172 Hangul syllables + Hangul Jamo + Latin + punctuation + the symbols/emoji the UI uses; drop other scripts) with fonttools `pyftsubset` if installable, verify the dev-center text audit renders no tofu; (3) **startup:** `renderer.compileAsync` behind the loading screen (was P1), defer non-critical system builds to idle after the first frame; (4) **runtime:** draw calls per zone ≤ 350 on high (merge/instance what is cheap), zero per-frame allocations in the hot paths touched this phase, dispose on logout; (5) report HTML size, load-to-first-frame, draw calls and frame time at the farm/deck/plaza per preset before vs after. No behaviour change; the full regression must stay green.

### 14.8 Open bugs (round 3 of the sweep) — fixed by the owner of the file, see the seed list in the workflow
45 bugs (1 critical, 3 high, 17 medium, 24 low) found by round 3 but never fixed; each builder gets the ones in its files; `fix-rest` gets the rest. Reproduce before fixing, as in §13.9.

### 14.9 Phase-6 file ownership (parallel build; the serialized agents may touch any file)
| Agent | Files |
|---|---|
| server | server/** (all PHP, .htaccess, schema files, install.php, admin.php, cli), tests/server-e2e.mjs, tests/pii-server.php, tools/php-compat.sh, tools/package.mjs, server/README-SERVER.md, docs/SERVER-INSTALL-KO.md |
| speed-jump | NEW 07-speed.js, 03-state.js, 05-input.js, 20-avatar.js, 21-player.js, 22-camera.js, 40-farming.js, 41-fermentation.js, 60-social.js, 61-audio.js, 62-engagement.js, 65-companion.js (+65 css), 01-data.js, 02-layout.js |
| sub-ui | NEW 72-subscription.js/.css, 70-app.js/.css, 04-ui.js, 08-easy.js/.css, template.html, 00-base/01-hud/02-responsive css, 80-devcenter.js/.css, tools/build.mjs, tools/smoke.mjs, tools/kid-audit.mjs |
| render-guard | 10-engine.js, 66-fx.js/.css, 17-manjangdae.js/.css, 11-terrain.js, 12-nature.js, 13-water.js, 15-buildings.js, 16-props.js, 23-interaction.js/.css, 25-npc.js/.css, 26-dialogues.js, 51-weather.js/.css, 52-photo.js/.css, 06-world.js |
| fix-rest | everything else: 00-core.js, 30-inventory, 31-quest, 32-progression, 45/46-education, 47-journal, 50-minimap (+ their css), docs/ARCHITECTURE.md |
| text-purge → optimize → review → gate → release | any file, one at a time, after the parallel build |

### 14.10 Acceptance (the gate re-runs all of it)
Strict build; smoke easy + normal at 1366×768, 390×844 and 844×390 `--mobile`, 1600×900 `quality=high` — zero errors; measured walk / run ≈ 6.4 / 12 m/s at tier 1 and ≈ 19.2 / 36 at `devTier(4)`; double jump works with keys and the touch button, once per airtime; `tools/text-audit.mjs` passes (0 "게임"); the start button reads `만장대`; the black-block watchdog detects an injected black quad and quarantines it; no-WebGL2 shows the friendly screen; `tools/php-compat.sh` 0 errors; server e2e PASS on SQLite and MySQL (PHP 8.3), plus on a real PHP ≤ 7.4 when one could be built; dev-center `runTests` all pass; kid-audit exit 0; README (`이번 업데이트 (6단계)` in simple Korean), HANDOVER §17, SERVER-INSTALL-KO.md updated; `node tools/package.mjs` zip contains 전통발효체험관.html, metaverse/ (index.html + api + install.php + database/schema.sql + .htaccess), docs/, README.md and no secrets / locks / sqlite / sessions / logs.

## 15. Phase 7 — real-time crops, storage (곳간), completion confirmation with the admin, a separate admin site (DB), developer handover & inspection, Claude API, and the 23-point security lock-down

Requests verbatim: "작물 재배를 리얼 타임으로", "작물을 보관을 할 수 있는 곳", "작물 재배가 완료가 되면 관리자에게 완료 확인을 사용자가 보낼 수 있고 관리자가 확인을 해서 메모와 완료가 가능한 부분", "관리자 페이지를 별도로 … 데이터베이스는 연동 … 관리자는 모든 부분을 확인", "개발자 인수인계와 점검이 가능한 부분", "클로드 api를 사용할 수 있게", "해커가 내 웹 또는 앱에 못 들어오게" + 23 numbered security items (15.7). Hosting stays **Apache 2.4 (Win32) · PHP 7.2.10 · MariaDB 10.3.8** — every rule of §14.5 (PHP 7.2 syntax only under `server/`, no intl / sodium requirement, MariaDB 10.3 SQL only, `tools/php-compat.sh` = 0 errors) applies to all new PHP. Kid rules of §12 apply to every new screen (easy mode: no typing, big picture buttons, `data-say`, no prices). No user-visible occurrence of the forbidden word of §14.3 (`tools/text-audit.mjs` stays at 0). Everything ships in the single HTML (local mode, no server) and in the server copy.

### 15.1 Real-time farm — "실시간 텃밭" (client owner: realfarm; server owner: server-farm)
The quick practice plots of §6.6 stay as they are (the first-10-minutes flow needs a harvest within minutes). **New: four real-time beds `RB1`–`RB4`** that grow by the wall clock — also while the browser is closed — with durations of real minutes/hours, a live per-second countdown, and (server mode) **the server's clock as the only judge of when a crop is ready**.
- **Data (`01-data.js`, exported by `tools/build.mjs` into `server/data/game-data.json` as `rtfarm`):**
  `G.data.rtfarm = { beds: ['RB1','RB2','RB3','RB4'], careCooldownMin: 5, carePerAction: 25, starAt: [0, 40, 75], bonusAtStars: 3, localScale: 1, reportNotes: ['물을 열심히 줬어요!', '매일 보러 왔어요!', '쑥쑥 자라서 기뻐요!', '다음에도 또 키울래요!'], crops: { CROP_MINT: {minutes: 10, exp: 60, coin: 45}, CROP_LEMONBALM: {minutes: 20, exp: 70, coin: 55}, CROP_RADISH: {minutes: 30, exp: 80, coin: 60}, CROP_BEAN: {minutes: 60, exp: 100, coin: 80}, CROP_PERILLA: {minutes: 90, exp: 120, coin: 95}, CROP_CABBAGE: {minutes: 120, exp: 140, coin: 110}, CROP_PEPPER: {minutes: 180, exp: 170, coin: 135}, CROP_LAVENDER: {minutes: 240, exp: 200, coin: 160}, CROP_ROSEMARY: {minutes: 360, exp: 260, coin: 200}, CROP_CORN: {minutes: 480, exp: 320, coin: 250} } }`. Harvest item and base amount come from `G.data.crops[id].harvestItem / harvestAmount`. No seed item is consumed (the garden hands out seeds), nothing withers.
- **Duration:** `dur(ms) = minutes × 60000 ÷ (tier × scale)`; `tier` = `G.sys.speed.progression()` (the paid 2×/3×/4× of §14.1), `scale` = the operator's time scale (server setting `farm.rt_scale`, default 1, 0.1–3600 — e.g. 60 for a classroom demo; local mode: `G.data.rtfarm.localScale`, changeable only from the dev center behind the grown-up gate via `G.sys.realfarm.setScale(n)`, never saved into a server-mode profile). The care cooldown uses the same divisor.
- **State (`03-state.js` defaults + sanitize + migration for older saves):** `G.state.rtfarm = { beds: {}, last: [], reports: [] }` and `G.state.stats.rtHarvests = 0`. A growing bed: `beds[bedId] = { cropId, pid, plantedAt, readyAt, dur, tier, care, lastCareAt }` (`pid` = 16 lowercase hex chars from `crypto.getRandomValues`, new for every planting; an empty bed has no key). `last` = ring buffer (max 8) of `{ pid, bedId, cropId, amount, stars, at }` for the most recent harvests. `reports` is used in **local mode only** (15.3).
- **`G.sys.realfarm` (new fragment `src/game/42-realfarm.js` + `src/styles/42-realfarm.css`, registered after farming):** `beds()` → `[{ id, bed|null, crop, status: 'empty'|'growing'|'ready', progress 0..1, leftMs, readyAt, stars }]`, `plant(bedId, cropId)`, `care(bedId)` (물 주기: `care = min(100, care + carePerAction)`, cooldown), `harvest(bedId)` (only when `G.time.now() >= readyAt`; amount = random in `harvestAmount` + 1 when stars = `bonusAtStars`; goes to `G.sys.storage.put` first, overflow to the inventory; exp / coin through `progression.grant`; pushes to `last`; `stats.rtHarvests++`; then the bed is empty), `clear(bedId)` (뽑기, confirm first), `open(bedId)` (panel), `openBook()` (the 확인 기록장 of 15.3), `report(bedId | pid, note?)`, `applyServer(rt)`, `scale()`, `setScale(n)`. Planting, harvesting and clearing call `G.save.save({ reason: 'rtfarm', force: true })` right away in server mode so the server sees the planting within a second.
- **Events:** `rtfarm:planted {bedId, cropId, pid, readyAt}`, `rtfarm:cared {bedId, care}`, `rtfarm:ready {bedId, cropId, pid}` (once per planting — also for beds that got ready while offline, on load), `rtfarm:harvested {bedId, cropId, amount, stars, pid}`, `rtfarm:report {id, status}`.
- **3D / UI:** a fenced garden with 4 raised beds and a wooden clock sign `⏰ 진짜 시간으로 자라요` placed by `02-layout.js` (`L.rtBeds`, near `ZONE_CROP`; no overlap with existing colliders, paths, quest markers — verify with screenshots from 3 angles), crop models reused from 40-farming by growth stage, a label over each bed (`① 박하 · 12:34 남음` / `다 자랐어요! 🎉`, ready beds sparkle with pooled FX — no flashes > 3 Hz), interactable kind `'rtbed'` (labels 씨앗 심기 / 살펴보기 / 수확하기), a minimap marker. Panel: crop picker cards (icon, name, `10분` / `2시간`, reward), a progress ring, the wall-clock line `오후 3시 20분에 다 자라요`, buttons 물 주기 · 수확하기 · 📮 완료 확인 보내기 · 뽑기. The countdown is derived from timestamps every second (`G.time.now()`), never from accumulated frame time. Offline return: `'실시간 텃밭에 다 자란 작물이 있어요!'` toast + 옹이 line. Easy mode: the same panel with big picture buttons, voice lines, no typing; not a mandatory coach step.
- **Server authority (server mode).** The beds live in the validated save blob; the server measures time itself:
  - `player/save.php` (accepted) and `player/get.php` add `data.rt = { scale, tier, beds: { RB1: { pid, cropId, firstSeenAt, readyAt, status } , … } }`; `ping.php` adds `rtScale`. `G.sys.realfarm.applyServer(rt)` overwrites `plantedAt` (= `firstSeenAt`), `readyAt`, `tier`, `dur` of every bed whose `pid` matches and re-renders (no save loop: only when a value moved by more than 1 s).
  - `Tfm\Farm::sync()` runs inside the save transaction after the other validations: (1) a `pid` not yet in `farm_beds` → insert `first_seen_at = now`, `ready_at = now + minutes×60000 ÷ (tier × scale)` computed **by the server** (the client's `plantedAt/readyAt/dur` are ignored), `status = growing`; the crop must be an rt crop, the bed id one of `rtfarm.beds`, the pid 16 hex chars and never seen on another bed / crop of this account (`RT_PID_REUSE`). (2) a bed of the previous save that is gone or has another pid: if it is listed in `rtfarm.last` and `stats.rtHarvests` grew → a harvest: only allowed when `now >= ready_at − 5 s` (else **409 `VALIDATION_FAILED` / `RT_HARVEST_TOO_EARLY`**, the stored save is returned as usual), `amount ≤ harvestAmount.max + 1`, row → `harvested` (harvested_at, amount, stars); otherwise row → `cleared`. (3) the growth of `stats.rtHarvests` must equal the number of harvests validated in this save (`RT_HARVEST_COUNT`). (4) every validated harvest adds its explained reward (item value × amount, `rt.exp`, `rt.coin`) to the economy check of §7 of README-SERVER. (5) tier change: growing rows with another tier get `ready_at = now + (ready_at − now) × rowTier ÷ tier`. (6) rows whose `ready_at <= now` become `ready`. (7) mirror of the quick plots for the admin: one `farm_beds` row per planting, `kind = 'plot'`, `pid = String(plantedAt)`, `growth`, `status` (ready at 100, harvested / cleared when the planting is gone). (8) mirror of `G.state.storage.items` into `farm_storage`.
  - `GET api/farm/state.php` (login) → `{ scale, tier, beds:[{bedId, kind, pid, cropId, firstSeenAt, readyAt, status}], storage:{items, total, cap}, reports:{pending, unseen} }` — the authoritative view (also what the admin lists read).
  - Dev-center self-tests + `tests/server-e2e.mjs`: plant → server `readyAt` returned; harvest before `readyAt` → 409; harvest after (run the test server with `farm.rt_scale` large enough that 10 min ≈ 2 s) → accepted with the reward; a faked `plantedAt` in the past changes nothing; tier 2 halves the time; a second harvest of the same pid is refused; storage mirror equals the save.

### 15.2 Storage — "곳간" (owner: realfarm for the client, server-farm for the mirror / validation)
- **State:** `G.state.storage = { items: {}, cap: 300 }` (`items[itemId] = qty`, total quantity ≤ `cap`). Storable: crop / herb harvest items and finished fermentation goods (the item ids are listed in `G.data.storage.itemIds`, built from the item table; exported to `game-data.json` as `storage: { cap, itemIds }`).
- **`G.sys.storage`** (same fragment): `open()` (two columns 가방 ↔ 곳간 with big `넣기` / `꺼내기` buttons, `모두 넣기`, a capacity bar, easy-mode layout), `put(itemId, n)`, `take(itemId, n)`, `putAll()`, `count(itemId)`, `total()`, `free()`. Event `storage:changed {itemId, delta, total}`.
- **3D:** building `B_STORAGE` "곳간" (thatched store house with a door, sign, straw bags) next to the real-time garden; interactable kind `'storage'` (`곳간 열기`); minimap marker; collider; reachable in easy mode by the "가기" helper.
- **Server:** the storage is part of the save: shape check (known ids, integer 0..9999, total ≤ cap), **net worth includes the storage** (moving items between bag and storage never changes the economy check), mirrored to `farm_storage` on every accepted save.

### 15.3 Completion confirmation — "재배 완료 확인" (user → admin → memo + 완료)
- **When:** a real-time bed is `ready` (or was harvested during the last 7 days) or a quick plot shows 100 % → the panel offers `📮 완료 확인 보내기`. One request per planting. Optional note: easy mode picks one of `rtfarm.reportNotes` (no typing); normal mode may type ≤ 80 chars (PII-masked and bad-word-filtered on the server, like chat). Optional photo: a canvas snapshot of the bed (JPEG, ≤ 1 MB).
- **API (server mode; all JSON, session + CSRF, rate-limited):**
  - `POST api/farm/report.php {kind:'rt'|'plot', bedId, pid, note?}` → `{report}`. The server checks its own records (`farm_beds`: `status` ready / harvested ≤ 7 days, for `plot` the stored save's growth ≥ 100 or a mirrored `ready` / `harvested` row), never the request. Errors: 409 `NOT_READY`, 409 `ALREADY_REPORTED`, 429 `REPORT_LIMIT` (`farm.report_daily`, default 30 per account per day).
  - `POST api/farm/report-photo.php` (multipart `photo`, field `reportId`) → attaches one photo to the caller's own pending report (see 15.7 #14 for the limits) → `{url}`.
  - `GET api/farm/reports.php` → `{reports:[{id, kind, bedId, cropId, stars, amount, note, status:'pending'|'approved'|'rejected', memo, requestedAt, decidedAt, photoUrl}], unseen}` (the caller's last 50).
  - `POST api/farm/seen.php {ids:[…]}` → marks decided reports as seen.
- **Admin (15.4, tab 완료 확인):** list by status (pending first), with the account, crop, bed, first-seen / ready / harvested times measured by the server, stars, the note, the photo, and a form: memo (≤ 500 chars) + `✅ 완료 처리` / `↩️ 돌려보내기`; a decided report can get its memo edited. `Tfm\Farm::decide(array $actor, int $reportId, string $status, string $memo): array` (audit `crop_report_decided`), `Farm::listReports(string $status, int $limit, int $offset, string $q): array`, `Farm::countReports(): array` (`['pending' => n, 'approved' => n, 'rejected' => n]`), `Farm::listBeds(array $filter, int $limit, int $offset): array`, `Farm::listStorage(int $limit, int $offset, string $q): array`, `Farm::scale(): float`, `Farm::setScale(array $actor, float $scale): void`.
- **Client:** `G.sys.realfarm.openBook()` — "📬 확인 기록장": every request with a status chip (⏳ 확인 기다리는 중 / ✅ 확인 완료 + the stamp and the admin's memo / ↩️ 다시 해 봐요 + memo). A new decision → toast, 옹이 line, stamp animation (`G.fx`), an entry in the 알림함 (62-engagement). Polling: on load, when the book opens, and every 60 s while something is pending.
- **Local mode:** requests are kept in `G.state.rtfarm.reports` (`source: 'local'`); "어른 확인" behind the grown-up gate lets a parent / teacher approve or return with a typed memo — the same book UI.

### 15.4 A separate admin site (owner: admin-site) — "관리자 페이지를 별도로 … 모든 부분을 확인"
- **Location:** `server/admin/index.php` (+ `admin/.htaccess`, optional `admin/parts/*.php` includes with the direct-access guard, one static `admin.css`). The old `server/admin.php` answers **404** (no redirect — it must not reveal the new path). Server-rendered HTML, **no JavaScript at all** (CSP `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`), every value through `e()`, every action POST + CSRF + same-origin + audit + 303 (PRG). Live tabs refresh with `<meta http-equiv="refresh" content="20">` when `live=1`.
- **Tabs — the admin sees everything:** 📊 대시보드 (counts incl. growing / ready beds, pending confirmations, security alerts of the day) · 🌱 재배 현황 (all beds of all accounts, live: account, bed, crop, 심은 시각, 완료 예정, 남은 시간, status; filters; the time scale `farm.rt_scale` form) · 🏚️ 곳간 (storage per account / totals per item) · ✅ 완료 확인 (15.3) · 👥 사용자 · ⚡ 구독·결제 · 🚨 신고·채팅 · 🛡️ 보안 (security events, blocked IPs, unblock / block, admin sign-ins, 2FA state) · 🩺 시스템 점검 · 🧑‍💻 개발자 (15.5) · 🤖 AI 도우미 (15.6) · 📜 감사 로그 · 🧰 유지보수. Everything the old page could do must still work (e2e keeps passing after its paths are updated).
- **Path lock (security item 6):** (a) the directory name is free: all includes are `__DIR__`-relative and links are relative, so renaming `admin/` works; `security.admin_dir` records the name; `php cli/tfm.php admin:path [--random|name]` renames the folder and writes `config.local.php`; `install.php` offers a random name; `auth/me.php` returns `adminUrl` **only to admins** (the app's 관리자 link uses it). (b) `security.admin_ip_allowlist` (IPv4/IPv6 addresses or CIDR; empty = any): other addresses get the same 404 as a missing page + a `admin_ip_denied` security event. (c) sign-in = the shared throttled login + role check + **TOTP 2-step** (`security.admin_2fa`: `off` | `optional` (default; health check warns until enrolled) | `required`; RFC 6238 SHA-1 / 30 s / 6 digits, ±1 step, replay-protected by `last_step`; secret shown as text + `otpauth://` URI; 10 one-time backup codes stored hashed; `Tfm\Totp` in `lib/Totp.php`). (d) admin elevation: a session flag that expires after `security.admin_idle` (1800 s) without admin requests, plus a path-scoped `SameSite=Strict; HttpOnly` cookie bound to it. (e) `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. (f) `admin/.htaccess` carries a ready-to-uncomment `Require ip` block and a Basic-Auth block as an extra lock in front of PHP.

### 15.5 Developer handover & inspection (owner: admin-site) — "개발자 인수인계와 점검"
Admin tab 🧑‍💻 개발자: (1) **문서**: `docs/HANDOVER.md`, `ARCHITECTURE.md`, `SERVER-INSTALL-KO.md`, `SECURITY-REPORT-KO.md`, `server/README-SERVER.md` copied by the build into `lib/docs/` (never web-readable) and rendered by `Tfm\Markdown` (escape first, then a small whitelist: headings, lists, tables, code, bold, links to http(s) only with `rel="noopener noreferrer"`). (2) **인수인계 체크리스트** (`handover_items`: key, done, note, by, at — the list itself is a PHP array in `Inspect`; e.g. 관리자 계정·2단계 인증, DB 전용 계정, HTTPS 인증서, 토스 키, Claude 키, 백업 예약, 자동 갱신 예약, 로그 위치, 비밀키 보관). (3) **점검 실행** `Tfm\Inspect::run(string $source, ?array $actor): array` = the health checks + the security configuration audit (15.7 #8, #16) + the exposure self-probe (#19) + DB privilege check (#1) + versions; each run is stored in `inspection_runs` and can be read back and downloaded as Markdown; `php cli/tfm.php inspect` prints the same and exits 1 when something fails. (4) **환경·로그**: PHP / DB / schema / app versions, extensions, disk use, the last 200 log lines with secrets redacted. The in-app dev center (F9) gets a "서버 점검" card that links to this tab for admins.

### 15.6 Claude API (owner: claude) — "클로드 api를 사용할 수 있게"
- **Transport:** the official Anthropic PHP SDK needs PHP 8 (named arguments), the hosting is PHP 7.2 → `lib/Claude.php` talks raw HTTPS with the curl extension: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2026-10-21`, `anthropic-beta: server-side-fallback-2026-07-01`, `content-type: application/json`; body `{model, max_tokens, system, messages, output_config: {effort}, fallbacks: "default"}`; **no** `temperature/top_p/top_k`, no `thinking` field, no assistant prefill. Default model `claude-opus-5-5` (config), effort `low`, `max_tokens` 4096, timeout 60 s, TLS verification on, 2 retries on 429 / 5xx / 529 honouring `retry-after`. The answer is the concatenation of `content[].type == "text"` blocks; `stop_reason` is checked first (`refusal` → a calm "그건 도와줄 수 없어요" answer, `max_tokens` → the partial text). (When the server moves to PHP ≥ 8.1, switch this one file to the official SDK.)
- **Config** `'anthropic' => ['api_key' => env ANTHROPIC_API_KEY ('' = feature off), 'model', 'effort', 'max_tokens', 'timeout', 'api_base', 'mock' => env TFM_AI_MOCK, 'kid_helper' => false, 'daily_user' => 20, 'daily_total' => 2000]`. The key lives only in `config.local.php` / the environment, is never logged, never sent to a browser, never stored in the DB.
- **API:** `Tfm\Claude::enabled(): bool`, `Claude::configured(): bool`, `Claude::ask(array $opt): array` (`['system' => string, 'messages' => [['role' => 'user'|'assistant', 'content' => string]], 'scope' => 'kid'|'admin'|'cli', 'userId' => int|null, 'maxTokens' => int|null]` → `['ok' => bool, 'text' => string, 'stop' => string, 'model' => string, 'usage' => ['in' => int, 'out' => int], 'error' => string|null]`; never throws; writes `ai_usage`), `Claude::selfTest(): array`.
  - `GET api/ai/status.php` → `{enabled, kid, presets:[…], left}`; `POST api/ai/ask.php {question | presetId}` (login, CSRF, `ai_ask` rate limit, per-account and global daily caps): the 옹이 선생님 helper for farming / fermentation questions — a fixed child-safe system prompt (Korean, 2–3 short sentences, only the 체험관 topics, never asks for or repeats personal data, no links), the question is length-limited (≤ 200 chars), `ChatFilter::maskPII`-masked and bad-word-filtered **before** it leaves the server, the answer is masked again and capped at 600 chars. Off unless `anthropic.kid_helper` is true (admin switch in the AI tab, stored in `settings`). Easy mode offers preset questions only.
  - Admin tab 🤖: `메모 초안` for a completion request (crop, stars, note → a warm two-sentence memo the admin can edit before saving), `오늘 요약` (numbers of the day + security events), a free prompt box; admin-only, CSRF, `ai_admin` rate limit, audit `ai_admin_ask`.
  - `php cli/tfm.php ai:test` (one tiny request, prints model / tokens / latency). Mock mode (`TFM_AI_MOCK=1`) answers locally (tests, demos). `tests/ai-stub.mjs` runs a local HTTPS-less stub (`anthropic.api_base` override) and asserts the exact headers / body above.
- **Client (`src/game/73-ai.js` + css, `G.sys.ai`):** `open()` — "🤖 옹이 선생님에게 물어보기" from the 옹이 menu: preset question chips (always), a text box in normal mode only, answers in a speech bubble with `data-say`; shows `서버 모드에서 쓸 수 있어요` in local mode and hides itself when `status.kid` is false.

### 15.7 Security lock-down — the 23 items ("해커가 못 들어오게"), each with a test in `tests/security-e2e.mjs` (owner: server-security unless noted)
| # | Item | What must be true |
|---|---|---|
| 1 | DB locked | MySQL: `install.php` / `cli install` create a **dedicated account** (`tfm_<random>`@host, random 32-char password, `SELECT, INSERT, UPDATE, DELETE` on the app database only), run the schema with the admin connection, write only the app account into `config.local.php` and set `db.auto_migrate = false` (upgrades: `php cli/tfm.php migrate --admin-user …`); PDO: emulation off, multi-statements off, `MYSQL_ATTR_LOCAL_INFILE` off, optional TLS (`db.mysql.ssl_ca`). Health: ⛔ runtime account is root / has an empty password / has global privileges, ⚠ DDL grants. SQLite: random file name under `data/`, 0600 where the OS allows, backups get a random suffix. `subscriptions.billing_key` and `admin_totp.secret_enc` are sealed with `Tfm\Crypto` (AES-256-GCM via openssl, key `data_key` in `data/secret.php`, prefix `enc:v1:`; old plain values are sealed on first use). |
| 2 | HTTPS forced | `security.force_https` = `auto` (default: on unless the request is for localhost) \| `on` \| `off`. Plain-HTTP GET → 308 to the https URL; any other method → 403 `HTTPS_REQUIRED` (credentials are never processed over HTTP). Root `.htaccess`: the redirect block is active (localhost excluded, `X-Forwarded-Proto` honoured only via `trusted_proxies`). HSTS on every HTTPS response, cookies `Secure`. Health ⛔ when off on a non-local host. |
| 3 | Server-side validation | Every endpoint validates type, length, range, enum and rejects unknown shapes through `Tfm\V` (`lib/Validator.php`); JSON depth ≤ 32 and body size caps per endpoint; `$_GET` numbers through `V::int`. Nothing the browser checks is trusted. An audit table of every endpoint × field goes into the security report. |
| 4 | XSS blocked | API: JSON only, `nosniff`, hex-escaped `< > & ' "`; admin: zero scripts + `e()` everywhere; app: strict hash CSP, user-controlled strings only via `textContent` / the escape helper (audit every `innerHTML` in `src/game` that can carry remote data: chat, nicknames, memos, notes, AI answers, admin memo in the book); stored-XSS tests post script / event-handler / SVG payloads through chat, nickname, note, memo and assert they come back inert. |
| 5 | Suspicious activity logged + watched | `Tfm\SecEvent::log(kind, severity, detail)` → `security_events` (+ file log). Kinds: `csrf_fail`, `origin_mismatch`, `admin_denied`, `admin_ip_denied`, `admin_2fa_fail`, `login_locked`, `probe_sqli`, `probe_xss`, `probe_traversal`, `honeypot` (scanner bait paths rewritten to `api/trap.php`), `payment_tamper`, `upload_rejected`, `save_rejected`, `https_required`, `ip_blocked`, `ai_abuse`. `Tfm\Firewall::check()` runs first in every entry point: an address in `ip_blocks` gets 403 `IP_BLOCKED`. Auto-block: ≥ `security.block.threshold` (25) attack-like events from one address within `window` (600 s) → blocked for `duration` (1800 s, doubling up to 24 h); localhost and `security.block.exempt` never auto-blocked. Admin 🛡️ tab + `cli security:events`, `cli ip:block|unblock`. Optional alert e-mail / webhook from config only (off by default). |
| 6 | Admin path locked | 15.4 (owner: admin-site). |
| 7 | Parameterized queries | Only `Db::run/one/all/value/exec/insert/upsert` with bound parameters; identifiers through `Db::ident`. New `tools/sql-audit.mjs` fails on any SQL string built with `$variable` / concatenation outside an allow-list of reviewed constants. SQLi payload tests on login, search, ids, sort / filter parameters. |
| 8 | Environment / config safe | `Tfm\ConfigAudit::run()` (also in `Inspect`, `cli config:check`, install): secrets present and not defaults, `config.local.php` / `data/secret.php` not web-readable and not world-writable, no secrets in `getenv` dumps or `phpinfo`, admin e-mails set, data dir location, debug flags, mock flags, CORS list sane, key ages. **No secret has a default in the repository:** the Toss documentation keys are removed from code and docs (empty default → 결제 "설정 필요" unless mock). |
| 9 | Rate limits | Every endpoint has a named limit (new: `farm_state`, `farm_report`, `farm_reports`, `farm_photo`, `ai_ask`, `ai_status`, `ai_admin`, `admin_login`, `trap`); the tests hammer login, register, save, chat, report, ai and expect 429 + `Retry-After`. |
| 10 | CORS narrowed | Default: no `Access-Control-*` header at all (same-origin only). `security.cors_allowed_origins` (exact `scheme://host[:port]`, never `*`): those origins get `Access-Control-Allow-Origin: <origin>` + `Vary: Origin` on **read-only public GET** endpoints (`ping`, `time`, `ranking/top`, `sub/status`); no credentials, no write methods; preflight for anything else → 403. |
| 11 | Security headers | API / admin / install / static (via `.htaccess`): CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, CORP, `Cache-Control: no-store` (dynamic), HSTS (https), no `X-Powered-By` / `Server` version (`ServerSignature Off`). A header matrix test covers every entry point. |
| 12 | Session cookies | `HttpOnly`, `Secure` (https), `SameSite=Lax`, path = install folder, strict mode, only cookies (no URL ids), regenerate on login / role change / 2FA, idle + absolute timeouts, UA binding; the admin elevation cookie is `SameSite=Strict`. Tests read the `Set-Cookie` attributes and try fixation. |
| 13 | CSRF | Every state-changing endpoint (incl. new farm / ai / admin actions): session token + `Origin` / `Sec-Fetch-Site`. A test walks **all** POST endpoints without / with a wrong token and with a cross-site Origin. |
| 14 | Upload type / size | Only `journal/upload.php` and `farm/report-photo.php` accept files; any other endpoint that receives `multipart/form-data` or `$_FILES` → 400 `UPLOAD_NOT_ALLOWED` + event. Journal: PNG/JPEG/WEBP ≤ 5 MB; report photo: PNG/JPEG/WEBP ≤ 1 MB, ≤ 1280 px after re-encoding; finfo MIME + `getimagesize` + pixel cap + GD re-encode + random name + forced extension; `.htaccess` / `.user.ini`: `upload_max_filesize 6M`, `post_max_size 8M`, `max_file_uploads 2`, `LimitRequestBody`. Tests: gif / svg / pdf / php / html polyglot / oversize / huge-dimension / double extension / wrong owner. (server-farm for the report photo) |
| 15 | Price / amount checked on the server | The order amount is created from the server's tier table, the confirmation must match it exactly, the Toss response `totalAmount` must match too, foreign / replayed orders refused, webhook re-fetched and never raises a tier; `payment_tamper` events. |
| 16 | Debug off in production | `app.env` defaults to `production`: no stack traces / paths in any response, `display_errors` off, mock payment / mock AI / `save.admin_bypass` / debug log level refused or flagged ⛔ on a non-local host, `install.php` answers 404 once locked, no source maps, the dev center stays behind the grown-up gate and cannot change server-side state. |
| 17 | Vulnerable packages updated | `npm audit` and (if any) `composer audit` clean; versions bumped where an advisory exists; the vendored three.js release is checked against advisories. (owner: sec-audit) |
| 18 | Unused packages removed | Every dependency in `package.json` is imported by a tool / the build; anything unused is removed; `tools/package.mjs` proves the zip has no dev files. (owner: sec-audit) |
| 19 | No exposed files | `tools/exposure-audit.mjs`: requests every file of the built server tree over HTTP (Apache with `.htaccess` when available, and `php -S` to prove the PHP-level guards) and fails if anything in `lib/ config/ database/ data/ cli/ admin/parts/`, any `.sqlite .sql .log .md .lock .ini .env .bak`, `config.local.php`, `secret.php`, sessions, backups, logs is readable; directory listing off. |
| 20 | Git history scanned for secrets | `tools/secret-scan.mjs` (working tree + `git log -p --all`): provider key patterns (AWS, Google, GitHub, Slack, Stripe, Toss `live_*`/`test_*`, Anthropic `sk-ant-`), private-key blocks, password assignments, JWTs, high-entropy literals; reviewed allow-list; exit 1 on a finding. (owner: sec-audit) |
| 21 | Leaked keys revoked + replaced | Whatever #20 finds is removed from the tree and listed with the exact revoke / reissue steps; `php cli/tfm.php secret:rotate [--app-key] [--data-key]` (new app secrets, all sessions signed out, sealed columns re-encrypted), `cli db:rotate-password` (new random DB password applied + written to `config.local.php`). External keys (Toss, Anthropic) can only be reissued by the owner in the provider console — the report says so plainly. |
| 22 | Full security review | sec-audit: the automated suite (`security-e2e`, `sql-audit`, `exposure-audit`, `secret-scan`, `npm audit`), plus an adversarial read of every entry point; findings are fixed or listed with a reason. |
| 23 | Tested + reported | `docs/SECURITY-REPORT-KO.md`: for each of the 23 items — 발견한 문제 → 고친 내용 → 테스트 (이름 · 결과) → 운영자가 할 일, in plain Korean with every technical term explained. |

### 15.8 Schema v6 (both `schema.sql` and `schema.sqlite.sql`; `Db::SCHEMA_VERSION = 6`) — already in the tree; append-only changes go through `Db::ADDED_COLUMNS`
`settings(k PK, v, updated_at, updated_by)` · `security_events(id, created_at, ip, ip_hash, user_id, kind, severity, path, detail)` · `ip_blocks(ip_hash PK, ip, reason, until_at, created_at, created_by, hits, strikes)` · `admin_totp(user_id PK, secret_enc, enabled, confirmed_at, backup_codes, last_step, updated_at)` · `farm_beds(id, user_id, bed_id, kind 'rt'|'plot', pid, crop_id, tier, first_seen_at, ready_at, growth, care, status 'growing'|'ready'|'harvested'|'cleared', harvested_at, amount, stars, updated_at; UNIQUE(user_id, bed_id, pid))` · `farm_storage(user_id, item_id, qty, updated_at; PK(user_id, item_id))` · `crop_reports(id, user_id, kind, bed_id, pid, crop_id, stars, amount, note, photo, status 'pending'|'approved'|'rejected', memo, requested_at, decided_at, decided_by, seen_at; UNIQUE(user_id, kind, bed_id, pid))` · `ai_usage(id, created_at, user_id, scope, model, input_tokens, output_tokens, stop_reason, ok, ms)` · `handover_items(k PK, done, note, updated_by, updated_at)` · `inspection_runs(id, created_at, actor_id, source, status, ok_count, warn_count, fail_count, summary, result)`.

### 15.9 Phase-7 file ownership
| Agent | Files |
|---|---|
| server-security | `server/lib/Core.php`, `Api.php`, `Security.php`, `Session.php`, `Users.php`, `Db.php` (connection options only), `Installer.php`, `Toss.php`, `Subscription.php`, NEW `lib/SecurityEvents.php` (`SecEvent`, `Firewall`), `lib/Validator.php` (`V`), `lib/ConfigAudit.php`, `lib/Crypto.php`; every `.htaccess` except `admin/`; `server/install.php`; existing `server/api/**` endpoints; NEW `api/trap.php`; `server/cli/tfm.php`; `config/config.php` (security block); NEW `tests/security-e2e.mjs`, `tools/sql-audit.mjs`, `tools/exposure-audit.mjs`; `server/README-SERVER.md` |
| realfarm (client) | NEW `src/game/42-realfarm.js`, `src/styles/42-realfarm.css`; `01-data.js`, `02-layout.js`, `03-state.js`, `50-minimap.js`, `62-engagement.js` (알림함 entry), `08-easy.js`, `80-devcenter.js` (self-tests), `tools/build.mjs` (export + fragment list) |
| server-farm | NEW `server/lib/Farm.php`, `server/api/farm/*.php`; `SaveValidator.php`, `GameData.php`, `Upload.php`, `api/player/save.php`, `api/player/get.php`, `api/ping.php` (`rtScale`), `uploads/.htaccess`, `config/config.php` (farm block), `tests/server-e2e.mjs` (farm steps); may patch `42-realfarm.js` for protocol mismatches only |
| admin-site | NEW `server/admin/**`, `server/admin.php` (404 stub), `lib/Admin.php`, NEW `lib/Totp.php`, `lib/Inspect.php`, `lib/Markdown.php`, `server/api/admin/*.php`, `api/auth/me.php` (`adminUrl`), `tools/build.mjs` / `tools/package.mjs` (docs → `lib/docs/`, admin folder), `70-app.js` / `80-devcenter.js` (admin links only) |
| claude (orchestrator) | NEW `server/lib/Claude.php`, `server/api/ai/*.php`, `config/config.php` (anthropic block), `tests/ai-stub.mjs`; then `src/game/73-ai.js` + css via the client-integration agent |
| client-integration → optimize → sec-audit → gate | any file, after the parallel builds |

### 15.10 Acceptance (the gate re-runs all of it)
Everything of §14.10 still green, plus: real-time bed plant → live countdown → ready → harvest → storage in local mode and in server mode (server `readyAt` adopted; early harvest refused with 409); storage put / take / capacity; completion request → admin approves with a memo → the book shows the stamp and memo (server mode) and the local grown-up approval (local mode); the admin site works without JavaScript on every tab, the old `admin.php` is 404, IP allow-list / 2FA / idle timeout tested; `Inspect::run` and `cli inspect` report; `Claude` verified against the stub (headers, body) and in mock mode end to end; `tests/security-e2e.mjs` covers items 1–16 and passes on SQLite and MariaDB; `tools/sql-audit.mjs`, `tools/exposure-audit.mjs`, `tools/secret-scan.mjs`, `npm audit` clean; `tools/php-compat.sh` 0 errors; `tools/text-audit.mjs` 0; kid-audit exit 0 with the new panels; `docs/SECURITY-REPORT-KO.md`, README "🆕 이번 업데이트 (7단계)", HANDOVER §18, SERVER-INSTALL-KO updated; the zip contains the new admin folder and no secrets.
