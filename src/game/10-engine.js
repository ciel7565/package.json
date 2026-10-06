// =============================================================================
// 10-engine.js — Three.js renderer / scene / camera / sun & sky / post-processing / quality.
//
//   G.sys.engine.renderer | scene | camera | sun | hemi | sky | composer | bloomPass
//   G.sys.engine.focus (Vector3)  shadow-camera follow target (player sets it every frame)
//   G.sys.engine.preset           quality preset {name, pixelRatio, shadows, shadowSize, bloom, treeDensity, grassDensity, drawDistance}
//   G.sys.engine.setSun(elevationDeg, azimuthDeg, {intensity, color})
//   G.sys.engine.setQuality('low'|'medium'|'high'|'auto')
//   G.sys.engine.updateEnvironment(force)   re-bake scene.environment from the sky (PMREM)
//   G.sys.engine.raycastScreen(clientX, clientY, objects, recursive) -> intersections
//   G.sys.engine.worldToScreen(vec3) -> {x, y, visible}
//   G.gfx.canvasTexture(w, h, drawFn(ctx,w,h), opts) / G.gfx.material(key, factory)
// =============================================================================
(function () {
  const PRESETS = {
    low: { name: 'low', label: '낮음', pixelRatio: 1, shadows: false, shadowSize: 0, bloom: false, antialias: false, treeDensity: 0.45, grassDensity: 0.0, drawDistance: 700, flare: false },
    medium: { name: 'medium', label: '중간', pixelRatio: 1.25, shadows: true, shadowSize: 1024, bloom: false, antialias: true, treeDensity: 0.75, grassDensity: 0.5, drawDistance: 1200, flare: true },
    high: { name: 'high', label: '높음', pixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, antialias: true, treeDensity: 1.0, grassDensity: 1.0, drawDistance: 2000, flare: true },
  };

  function autoQuality() {
    if (G.input?.touchUI) return 'low';
    const mem = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 4;
    if (mem <= 2 || cores <= 2) return 'low';
    if (mem <= 4 || cores <= 4) return 'medium';
    return 'high';
  }
  function resolveQuality() {
    const q = G.flags.quality || G.settings.quality || 'auto';
    return PRESETS[q] ? q : autoQuality();
  }

  // ---------------------------------------------------------------- tiny graphics helpers shared by world modules
  const matCache = new Map();
  G.gfx = {
    /** CanvasTexture from a 2D drawing function */
    canvasTexture(w, h, draw, opts = {}) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      draw(ctx, w, h);
      const t = new THREE.CanvasTexture(c);
      if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat[0], opts.repeat[1]); }
      t.anisotropy = opts.anisotropy ?? 4;
      if (opts.nearest) { t.magFilter = THREE.NearestFilter; }
      t.needsUpdate = true;
      return t;
    },
    /** shared material cache: G.gfx.material('roofTile', () => new THREE.MeshStandardMaterial({...})) */
    material(key, factory) {
      if (!matCache.has(key)) matCache.set(key, factory());
      return matCache.get(key);
    },
    /** soft radial sprite texture (glows, clouds, flares) */
    radialTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
      return G.gfx.canvasTexture(size, size, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, inner); g.addColorStop(1, outer);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      });
    },
    /** wooden sign board texture with Korean text */
    signTexture(title, sub, opts = {}) {
      const w = opts.w || 512, h = opts.h || 256;
      return G.gfx.canvasTexture(w, h, (ctx) => {
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, opts.bg1 || '#7a5232'); bg.addColorStop(1, opts.bg2 || '#5b3a22');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.12; ctx.strokeStyle = '#000';
        for (let y = 10; y < h; y += 14) { ctx.beginPath(); ctx.moveTo(0, y + Math.sin(y) * 3); ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = opts.border || '#3b2414'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, w - 14, h - 14);
        ctx.fillStyle = opts.color || '#fff6e0';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const font = `"PretendardEmbed","Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
        let size = opts.size || Math.round(h * 0.3);
        ctx.font = `800 ${size}px ${font}`;
        while (ctx.measureText(title).width > w * 0.86 && size > 12) { size -= 2; ctx.font = `800 ${size}px ${font}`; }
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
        ctx.fillText(title, w / 2, sub ? h * 0.42 : h / 2);
        if (sub) { ctx.font = `600 ${Math.round(size * 0.45)}px ${font}`; ctx.fillStyle = opts.subColor || '#f4d9a8'; ctx.fillText(sub, w / 2, h * 0.72); }
      });
    },
  };

  // ---------------------------------------------------------------- GLB asset hook (spec #22/#66: code and models are separated)
  // Modules build procedural blockout models; when G.data.modelOverrides[anchorId] = 'assets/models/x.glb'
  // exists and the file loads (http/https hosting), modules may swap the procedural mesh for the GLB.
  G.data.modelOverrides = G.data.modelOverrides || {};
  G.assets = {
    _cache: new Map(),
    loadGLB(url) {
      if (!ADDONS.GLTFLoader) return Promise.reject(new Error('GLTFLoader missing'));
      if (!/^https?:$/.test(location.protocol)) return Promise.reject(new Error('GLB loading needs http(s) hosting'));
      if (!this._cache.has(url)) {
        this._cache.set(url, new Promise((resolve, reject) => new ADDONS.GLTFLoader().load(url, resolve, undefined, reject)));
      }
      return this._cache.get(url);
    },
    /** replace children of `group` with the GLB at G.data.modelOverrides[id] (keeps procedural model on failure) */
    async tryOverride(id, group) {
      const url = G.data.modelOverrides[id];
      if (!url || !group) return false;
      try {
        const gltf = await this.loadGLB(url);
        const model = gltf.scene.clone(true);
        model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        group.clear();
        group.add(model);
        G.log.info('ASSETS', `model override applied: ${id} <- ${url}`);
        return true;
      } catch (e) { G.log.warn('ASSETS', `model override failed for ${id}`, e.message || e); return false; }
    },
  };

  const engine = {
    name: 'engine',
    label: '3D 엔진',
    order: 0,
    renderer: null, scene: null, camera: null,
    sun: null, hemi: null, sky: null, composer: null, bloomPass: null, flare: null,
    focus: new THREE.Vector3(0, 0, 0),
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
    sunElevation: 45, sunAzimuth: 160,
    preset: PRESETS.high,
    quality: 'high',
    fps: 60,
    _fpsAcc: 0, _fpsFrames: 0, _lowFpsTime: 0,
    _envDirty: true, _envTimer: 0,
    _resizeFns: [],

    init() {
      const container = document.getElementById('game-container');
      this.quality = resolveQuality();
      this.preset = PRESETS[this.quality];
      const renderer = new THREE.WebGLRenderer({
        antialias: this.preset.antialias && !this.preset.bloom, // MSAA happens in the composer target when bloom is on
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.88;
      renderer.shadowMap.enabled = !!this.preset.shadows && G.settings.shadows !== false;
      renderer.shadowMap.type = this.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      renderer.domElement.setAttribute('tabindex', '0');
      renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.ui?.toast?.('그래픽 장치가 초기화되었습니다. 문제가 계속되면 새로고침해 주세요.', { type: 'warn', duration: 6000 }); });
      container.appendChild(renderer.domElement);
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9cc7ea);
      scene.fog = new THREE.FogExp2(0xbcd6e8, 0.0028);
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 3000);
      camera.position.set(0, 12, 30);
      camera.lookAt(0, 0, 0);
      scene.add(camera); // allows camera-attached children (rain emitters, flare anchor)
      this.camera = camera;

      // sky dome (Preetham)
      if (ADDONS.Sky) {
        const sky = new ADDONS.Sky();
        sky.scale.setScalar(2800);
        const u = sky.material.uniforms;
        u.turbidity.value = 5.5; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
        sky.frustumCulled = false;
        sky.renderOrder = -10;
        scene.add(sky);
        this.sky = sky;
        this._envScene = new THREE.Scene();
        this._envSky = new ADDONS.Sky();
        this._envSky.scale.setScalar(1000);
        Object.assign(this._envSky.material.uniforms.turbidity, { value: 5.5 });
        this._envScene.add(this._envSky);
        this._pmrem = new THREE.PMREMGenerator(renderer);
      }

      // lights
      const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5c6b3c, 0.85);
      scene.add(hemi);
      this.hemi = hemi;
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
      sun.castShadow = renderer.shadowMap.enabled;
      if (sun.castShadow) this._configureShadow(sun);
      scene.add(sun);
      scene.add(sun.target);
      this.sun = sun;
      const fill = new THREE.DirectionalLight(0xbfd6ff, 0.35); // soft sky bounce from the opposite side
      fill.position.set(-50, 40, -60);
      scene.add(fill);
      this.fill = fill;

      // sun lens flare (high/medium)
      if (ADDONS.Lensflare && this.preset.flare) {
        const flare = new ADDONS.Lensflare();
        const tMain = G.gfx.radialTexture(256, 'rgba(255,250,235,0.95)', 'rgba(255,230,180,0)');
        const tRing = G.gfx.canvasTexture(128, 128, (ctx, w) => {
          const g = ctx.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.8, 'rgba(180,220,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
        });
        flare.addElement(new ADDONS.LensflareElement(tMain, 380, 0, new THREE.Color(1, 0.95, 0.85)));
        flare.addElement(new ADDONS.LensflareElement(tRing, 60, 0.6));
        flare.addElement(new ADDONS.LensflareElement(tRing, 90, 0.75));
        flare.addElement(new ADDONS.LensflareElement(tRing, 140, 0.95));
        this.flareAnchor = new THREE.Object3D();
        this.flareAnchor.add(flare);
        scene.add(this.flareAnchor);
        this.flare = flare;
      }

      this._setupComposer();
      this.setSun(this.sunElevation, this.sunAzimuth);

      window.addEventListener('resize', () => this.resize());
      G.bus.on('settings:changed', ({ key }) => {
        if (key === 'quality') this.setQuality(G.settings.quality);
        if (key === 'shadows') this.setShadows(G.settings.shadows);
        if (key === 'bloom') this._setupComposer();
        if (key === 'showFps') document.getElementById('fps-meter').hidden = !G.settings.showFps;
      });
      document.getElementById('fps-meter').hidden = !G.settings.showFps;
      G.log.info('ENGINE', `three r${THREE.REVISION}, quality=${this.quality}`);
    },

    _configureShadow(sun) {
      const s = sun.shadow;
      const size = this.preset.shadowSize || 1024;
      s.mapSize.set(size, size);
      const R = this.quality === 'high' ? 55 : 45;
      Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 400 });
      s.camera.updateProjectionMatrix();
      s.bias = -0.00035;
      s.normalBias = 0.035;
      s.radius = 3;
    },

    _setupComposer() {
      if (this.composer) { this.composer.dispose?.(); this.composer = null; this.bloomPass = null; }
      if (!this.preset.bloom || G.settings.bloom === false || !ADDONS.EffectComposer) return;
      const r = this.renderer;
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new ADDONS.EffectComposer(r, rt);
      composer.setPixelRatio(r.getPixelRatio());
      composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new ADDONS.RenderPass(this.scene, this.camera));
      const bloom = new ADDONS.UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.32, 0.45, 0.9);
      composer.addPass(bloom);
      composer.addPass(new ADDONS.OutputPass());
      this.composer = composer;
      this.bloomPass = bloom;
    },

    setShadows(on) {
      on = !!on && !!this.preset.shadows;
      this.renderer.shadowMap.enabled = on;
      this.sun.castShadow = on;
      if (on) this._configureShadow(this.sun);
      this.scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => (x.needsUpdate = true)); } });
    },

    setQuality(q) {
      const name = PRESETS[q] ? q : autoQuality();
      const prevDensity = this.preset.treeDensity;
      this.quality = name;
      this.preset = PRESETS[name];
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio));
      this.setShadows(G.settings.shadows !== false);
      this._setupComposer();
      if (this.flare) this.flare.visible = !!this.preset.flare;
      this.resize();
      G.bus.emit('engine:quality', { quality: name, preset: this.preset, reloadSuggested: prevDensity !== this.preset.treeDensity });
    },

    /** elevation/azimuth in degrees. azimuth 180 = sun in the south (+Z), 90 = east (+X) */
    setSun(elevationDeg, azimuthDeg, opts = {}) {
      this.sunElevation = elevationDeg; this.sunAzimuth = azimuthDeg;
      const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
      const theta = THREE.MathUtils.degToRad(azimuthDeg);
      // spherical: x = sin(phi) sin(theta), y = cos(phi), z = -sin(phi) cos(theta)  (north = -Z)
      this.sunDir.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta)).normalize();
      if (this.sky) this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
      if (this._envSky) this._envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
      if (opts.intensity != null) this.sun.intensity = opts.intensity;
      if (opts.color != null) this.sun.color.set(opts.color);
      this._envDirty = true;
    },

    /** copy sky look (turbidity etc.) to the env-bake sky and re-bake scene.environment */
    updateEnvironment(force) {
      if (!this._pmrem || !this._envSky) return;
      if (!force && !this._envDirty) return;
      const su = this.sky.material.uniforms, eu = this._envSky.material.uniforms;
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = su[k].value;
      eu.sunPosition.value.copy(this.sunDir);
      const rt = this._pmrem.fromScene(this._envScene, 0, 0.1, 1100);
      if (this._envRT) this._envRT.dispose();
      this._envRT = rt;
      this.scene.environment = rt.texture;
      this._envDirty = false;
    },

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
      if (this.bloomPass) this.bloomPass.resolution.set(w / 2, h / 2);
      for (const fn of this._resizeFns) { try { fn(w, h); } catch (e) { G.log.error('ENGINE', e); } }
    },
    onResize(fn) { this._resizeFns.push(fn); },

    update(dt) {
      // shadow camera + sun follow the focus point (player)
      const f = this.focus;
      if (this.sun) {
        this.sun.position.set(f.x + this.sunDir.x * 160, f.y + Math.max(this.sunDir.y, 0.08) * 160, f.z + this.sunDir.z * 160);
        this.sun.target.position.copy(f);
        this.sun.target.updateMatrixWorld();
      }
      if (this.flareAnchor) {
        this.flareAnchor.position.copy(this.camera.position).addScaledVector(this.sunDir, 1500);
        // Lensflare copies the framebuffer, which is not allowed from the multisampled composer target -> only without bloom
        this.flareAnchor.visible = this.sunDir.y > 0.02 && this.flare.visible !== false && !this.composer && !this.flareSuppressed;
      }
      // re-bake environment at most every 2s when sun/sky changed
      this._envTimer -= dt;
      if (this._envDirty && this._envTimer <= 0) { this._envTimer = 2; this.updateEnvironment(); }
      // fps & auto quality
      this._fpsAcc += dt; this._fpsFrames++;
      if (this._fpsAcc >= 0.5) {
        this.fps = this._fpsFrames / this._fpsAcc;
        this._fpsAcc = 0; this._fpsFrames = 0;
        if (G.settings.showFps) {
          const info = this.renderer.info;
          const el = document.getElementById('fps-meter');
          if (el) el.textContent = `FPS ${this.fps.toFixed(0)}  ${this.quality}\ndraw ${info.render.calls}  tri ${(info.render.triangles / 1000).toFixed(0)}k`;
        }
        if ((G.settings.quality || 'auto') === 'auto' && !G.flags.quality && G.ready && !document.hidden) {
          this._lowFpsTime = this.fps < 24 ? this._lowFpsTime + 0.5 : Math.max(0, this._lowFpsTime - 0.5);
          if (this._lowFpsTime > 6 && this.quality !== 'low') {
            const next = this.quality === 'high' ? 'medium' : 'low';
            this.setQuality(next);
            this._lowFpsTime = 0;
            G.ui?.toast?.(`프레임 유지를 위해 그래픽 품질을 '${PRESETS[next].label}'(으)로 낮췄습니다.`, { type: 'info' });
          }
        }
      }
    },

    render() {
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    },

    /** raycast from screen coords against objects */
    raycastScreen(clientX, clientY, objects, recursive = true) {
      const r = this._ray || (this._ray = new THREE.Raycaster());
      const v = this._v2 || (this._v2 = new THREE.Vector2());
      v.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      r.setFromCamera(v, this.camera);
      r.far = 400;
      return r.intersectObjects(objects, recursive);
    },
    worldToScreen(p) {
      const v = (this._v3 || (this._v3 = new THREE.Vector3())).copy(p).project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, visible: v.z < 1 && v.z > -1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
    },
    add(o) { this.scene.add(o); return o; },
    remove(o) { this.scene.remove(o); },
    PRESETS,
  };
  G.register(engine);
})();
