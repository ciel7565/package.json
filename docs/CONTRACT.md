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
  need a pass from the last 90 s (`GATE_FRESH`). `G.easy.lockGate(why)` ends the session.
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
`kid:phrase {phraseId}` (emoji sends use `'emoji:<e>'`) · `player:arrived {id, x, z, rescued}` ·
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
  unless `opts.intro` / `opts.force`; released on `phase:'end'`). Any key / tap after 450 ms skips it.
- **Telescope (`tour(startZoneId = 'ZONE_MAIN')`):** each zone is aimed at its largest building (gate ×4 weight; look
  height = ground + 8 m hall / 4.2 m gate / 3 m else); near targets get a closer, higher lens so the foreground fence
  never hides them. Labels and the coach step back while scoping. The guide adds a kid line "게임 속 풍경이에요. 진짜
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
  `save:auth-lost {source:'social'}` once per server session (re-armed by the next successful request); 70-app's relogin
  dialog is idempotent.
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

