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
  system errors (`G.__systemErrors`) and exits 1 if any occurred. `--viewport 1366x768`, `--mobile` are available.
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
  keyboard 1–4/Enter/Space, Esc to close), camera `focusOn`, player disabled while open (`G.ui.block('dialogue')`), optional
  TTS when `G.settings.voiceOver` (`G.sys.audio?.speak`). `start(dialogueId, {npcId})`, `close()`, `active`.
  Emits `npc:talk` on start and `dialogue:end`. `{nickname}` placeholder in text.
- `G.data.dialogues = { npc_master: {npc:'NPC001', entries:[{if:{...}, node:'x'}, {node:'start'}], nodes:{ id:{ text, speaker?, emote?,
  actions:[...], choices:[{text, next?, end?, if?, actions?}], next? } } } }` for npc_master, npc_farmer, npc_culture, npc_keeper, npc_guide.
  Conditions: `{questStatus:{Q:'available'|[..]}, hasItem:{ITEM:n}, flag:'x', notFlag:'x', level:n, jarStatus:{J1:'COMPLETE'}}`.
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
  zoom +/- buttons, collapse/close, click → world map. `openWorldMap()` (M; large map, zone labels clickable → description +
  "여기로 이동"), `openFastTravel()` (action `move`), `currentZone`, `worldToMap(x,z)`. Actions: `minimap`, `move`,
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
camera orbit (METAVERSE / 전통발효체험관, 게임 시작·로그인·회원가입·게스트로 둘러보기) → auth (`G.auth`: local accounts in
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
a full diagnostic report (JSON + Markdown). Admin/debug access in production: only when `?dev=1`, local mode, or
profile role `admin`.
