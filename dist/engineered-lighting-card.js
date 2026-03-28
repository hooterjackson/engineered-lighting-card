/**
 * Engineered Lighting Card v11
 * V-JEPA 2 World Model Dashboard
 *
 * Design: Apple-level refinement · Pipeline architecture · Ambient clarity
 * Two-stage pipeline: Detection (Frigate+Coral) → Understanding (Jetson+V-JEPA)
 * Liquid glass panels, strong typography hierarchy, zero noise.
 *
 * v11 changes:
 *  - Removed redundant status pill from video overlays (detection pills suffice)
 *  - Merged 4 bottom cards → 2 pipeline stage cards: Detection + Understanding
 *  - Stronger typography: 32px hero metrics, opacity-based hierarchy (no bold abuse)
 *  - Improved scrim system: consistent top+bottom gradients on all feeds
 *  - Pipeline flow indicator between cards
 *  - Reduced UI noise: hide low-value data, progressive de-emphasis
 *  - Tighter spacing grid: 16px base, 12px internal rhythm
 *  - Refined detection pills: gentler, less border, more integrated
 *  - Activity overlay: cleaner score bars, better breathing room
 *  - Bottom pane: unified system vitals feel, not separate monitoring panels
 */
class EngineeredLightingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._timers = [];
    this._frigateStats = {};
    this._failedCams = new Set();
    this._detectionCache = {};
    this._soundCache = {};
    this._prevDetectKey = {};
    this._prevScoresKey = {};
    this._ingressEntry = null;
    this._ingressSlug = 'ccab4aaf_frigate-fa';
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this.shadowRoot.querySelector('.el-root')) this._render();
    this._update();
    if (first) this._poll();
  }

  setConfig(c) {
    this._config = {
      cameras: c.cameras || [
        { name: 'driveway',   entity: 'camera.driveway',   label: 'Living Room',  primary: true,  vjepa: true  },
        { name: 'dining_room',entity: 'camera.dining_room', label: 'Dining Room', primary: true,  vjepa: true  },
        { name: 'kitchen',    entity: 'camera.kitchen',     label: 'Kitchen',     primary: false, vjepa: true  },
        { name: 'living_room',entity: 'camera.living_room', label: 'Driveway',    primary: false, vjepa: false },
        { name: 'back_door',  entity: 'camera.back_door',   label: 'Back Door',   primary: false, vjepa: false },
      ],
      frigate_url: c.frigate_url || 'http://192.168.175.114:5000',
      frigate_addon_slug: c.frigate_addon_slug || 'ccab4aaf_frigate-fa',
      detection_persist_ms: c.detection_persist_ms || 8000,
      ...c,
    };
    this._ingressSlug = this._config.frigate_addon_slug;
  }

  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() {
    return { cameras: [
      { name: 'driveway',    entity: 'camera.driveway',    label: 'Living Room',  primary: true,  vjepa: true  },
      { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room',  primary: true,  vjepa: true  },
      { name: 'kitchen',     entity: 'camera.kitchen',     label: 'Kitchen',      primary: false, vjepa: true  },
      { name: 'living_room', entity: 'camera.living_room', label: 'Driveway',     primary: false, vjepa: false },
      { name: 'back_door',   entity: 'camera.back_door',   label: 'Back Door',    primary: false, vjepa: false },
    ]};
  }
  getCardSize() { return 28; }

  disconnectedCallback() {
    this._timers.forEach(t => clearInterval(t));
    this._timers = [];
  }

  // ── Snapshots: no bounding boxes ──
  _snapUrl(cam) {
    if (this._failedCams.has(cam.name)) return this._snapUrlHA(cam);
    return `${this._config.frigate_url}/api/${cam.name}/latest.jpg?h=720&ts=${Date.now()}`;
  }
  _snapUrlHA(cam) {
    if (!this._hass) return '';
    const s = this._hass.states[cam.entity];
    if (!s) return '';
    return `/api/camera_proxy/${cam.entity}?token=${s.attributes.access_token}&ts=${Date.now()}`;
  }

  // ── Detections with persistence ──
  _getDetectedObjects(camName) {
    const objects = ['person','dog','cat','bottle','cup','bowl','chair','couch','dining_table','cell_phone','laptop','tv','book','remote','potted_plant','oven','backpack','handbag','suitcase','clock','car','truck','bicycle','motorcycle'];
    const now = Date.now();
    if (!this._detectionCache[camName]) this._detectionCache[camName] = {};
    const cache = this._detectionCache[camName];
    objects.forEach(obj => {
      let on = false;
      const s1 = this._hass?.states[`binary_sensor.${camName}_${obj}_occupancy`];
      if (s1 && s1.state === 'on') on = true;
      if (!on) { const s2 = this._hass?.states[`binary_sensor.whole_${camName}_${obj}_occupancy`]; if (s2 && s2.state === 'on') on = true; }
      if (on) cache[obj] = now;
    });
    const p = this._config.detection_persist_ms;
    return objects.filter(obj => cache[obj] && (now - cache[obj]) < p);
  }
  _getDetectedSounds(camName) {
    const sounds = ['speech','music','bark','baby_crying','alarm','doorbell','fire_alarm','glass_breaking','knock','yelling'];
    const now = Date.now();
    if (!this._soundCache[camName]) this._soundCache[camName] = {};
    const cache = this._soundCache[camName];
    sounds.forEach(snd => { const s = this._hass?.states[`binary_sensor.${camName}_${snd}_sound`]; if (s && s.state === 'on') cache[snd] = now; });
    const p = this._config.detection_persist_ms;
    return sounds.filter(snd => cache[snd] && (now - cache[snd]) < p);
  }
  _getObjectLabel(obj) {
    const m = { person:'Person',dog:'Dog',cat:'Cat',bottle:'Bottle',cup:'Cup',bowl:'Bowl',chair:'Chair',couch:'Couch',dining_table:'Table',cell_phone:'Phone',laptop:'Laptop',tv:'TV',book:'Book',remote:'Remote',potted_plant:'Plant',oven:'Oven',backpack:'Backpack',handbag:'Bag',suitcase:'Suitcase',clock:'Clock',car:'Car',truck:'Truck',bicycle:'Bike',motorcycle:'Moto' };
    return m[obj] || obj.replace(/_/g, ' ');
  }
  _getSoundLabel(snd) { return snd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
  _isMotionDetected(cn) { const s = this._hass?.states[`binary_sensor.${cn}_motion`]; return s && s.state === 'on'; }
  _getSwitch(cn, t) { const s = this._hass?.states[`switch.${cn}_${t}`]; return s ? s.state === 'on' : false; }

  // ── V-JEPA 2 Activity ──
  _getActivity(camName) {
    const s = this._hass?.states[`sensor.${camName}_activity`];
    if (!s || s.state === 'unknown' || s.state === 'unavailable') return null;
    const a = s.attributes || {};
    const o = (typeof a.activity === 'object' && a.activity !== null) ? a.activity : null;
    return {
      activity: o ? o.activity : (a.activity || s.state),
      confidence: o ? o.activity_confidence : (a.activity_confidence || a.confidence || null),
      secondary: o ? o.secondary_activity : (a.secondary_activity || null),
      secondaryConf: o ? o.secondary_confidence : (a.secondary_confidence || 0),
      activityScores: o ? o.activity_scores : (a.activity_scores || null),
      embed_change: a.embed_change !== undefined ? parseFloat(a.embed_change) : null,
      motion_level: a.motion_level !== undefined ? parseFloat(a.motion_level) : null,
      trend: a.trend !== undefined ? parseFloat(a.trend) : null,
      person_detected: !!a.person_detected,
      timestamp: a.timestamp || null,
    };
  }

  _isVjepaInferring(cn) {
    const act = this._getActivity(cn);
    if (!act) return false;
    return act.person_detected;
  }

  _activityLabel(state) {
    if (!state || state === 'idle' || state === 'Empty' || state === 'unknown') return null;
    return state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  _fmtTime(iso) {
    if (!iso) return '';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (d < 5) return 'now'; if (d < 60) return `${d}s`; if (d < 3600) return `${Math.floor(d/60)}m`; return `${Math.floor(d/3600)}h`;
  }

  // ── Render ──
  _render() {
    const cams = this._config.cameras;
    const primary = cams.filter(c => c.primary);
    const secondary = cams.filter(c => !c.primary);

    const camHTML = (cam, cls) => `
      <div class="cam-cell ${cls}" id="cell-${cam.name}">
        <div class="cam-vp">
          <img class="cam-img" id="img-${cam.name}" alt="${cam.label}" />
          <div class="scrim-top"></div>
          <div class="scrim-bot"></div>
          <div class="ov-top">
            <span class="ov-label">${cam.label}</span>
            ${cam.vjepa ? `<span class="ov-pipe" id="pipe-${cam.name}"><span class="pipe-dot"></span>V-JEPA</span>` : ''}
          </div>
          <div class="ov-detect" id="detect-${cam.name}"></div>
          ${cam.vjepa ? `
          <div class="ov-activity" id="act-${cam.name}">
            <div class="act-content">
              <div class="act-main">
                <span class="act-name" id="act-name-${cam.name}"></span>
                <span class="act-conf" id="act-conf-${cam.name}"></span>
              </div>
              <div class="act-sec" id="act-sec-${cam.name}"></div>
              <div class="act-scores" id="act-scores-${cam.name}"></div>
            </div>
          </div>` : ''}
          <div class="ov-data" id="data-${cam.name}">
            <span class="od"><span class="od-l">FPS</span><span class="od-v" id="od-fps-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Det</span><span class="od-v" id="od-dps-${cam.name}">—</span></span>
            ${cam.vjepa ? `
            <span class="od-sep"></span>
            <span class="od"><span class="od-l">Embed</span><span class="od-v" id="od-embed-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Motion</span><span class="od-v" id="od-motion-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Trend</span><span class="od-v" id="od-trend-${cam.name}">—</span></span>` : ''}
            <span class="od-ts" id="od-ts-${cam.name}"></span>
          </div>
        </div>
      </div>`;

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <div class="el-root">
        <header class="hdr">
          <div class="hdr-l">
            <div class="hdr-title">Engineered Lighting</div>
            <div class="hdr-sub">V-JEPA 2 · World Model</div>
          </div>
          <div class="hdr-r">
            <div class="hdr-stat"><span class="hdr-sv" id="hdr-obj">0</span><span class="hdr-sl">Objects</span></div>
            <div class="hdr-stat"><span class="hdr-sv">5</span><span class="hdr-sl">Cameras</span></div>
            <div class="pill" id="pill"><span class="pill-dot"></span>Active</div>
          </div>
        </header>

        <div class="scroll-area">
          <div class="grid-primary">${primary.map(c => camHTML(c, 'cam-lg')).join('')}</div>
          <div class="grid-secondary">${secondary.map(c => camHTML(c, 'cam-sm')).join('')}</div>
        </div>

        <div class="metrics-pane">
          <div class="metrics-grid">

            <!-- Stage 1: Detection Pipeline -->
            <div class="mc">
              <div class="mc-stage">
                <span class="mc-stage-num">01</span>
                <span class="mc-stage-label">Detection</span>
                <span class="mc-stage-sub">Frigate NVR + Coral TPU</span>
                <span class="mc-badge" id="mc-det-b">—</span>
              </div>
              <div class="mc-body">
                <div class="mc-hero-row">
                  <div class="mc-hero">
                    <div class="mc-hv" id="mc-fri-cpu-v">—</div>
                    <div class="mc-hl">CPU</div>
                  </div>
                  <div class="mc-hero">
                    <div class="mc-hv" id="mc-coral-spd-v">—</div>
                    <div class="mc-hl">Inference</div>
                  </div>
                </div>
                <div class="mc-divider"></div>
                <div class="mc-grid">
                  <div class="mc-metric">
                    <span class="mc-ml">Memory</span>
                    <div class="mc-bar-wrap"><div class="mc-bar"><div class="mc-fill" id="mc-fri-mem-bar"></div></div></div>
                    <span class="mc-mv" id="mc-fri-mem">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">Coral Temp</span>
                    <span class="mc-mv" id="mc-coral-tmp">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">Detect</span>
                    <span class="mc-mv" id="mc-fri-det">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">Uptime</span>
                    <span class="mc-mv" id="mc-fri-up">—</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pipeline flow indicator -->
            <div class="mc-flow">
              <div class="mc-flow-line"></div>
              <div class="mc-flow-arrow">→</div>
              <div class="mc-flow-line"></div>
            </div>

            <!-- Stage 2: Scene Understanding -->
            <div class="mc">
              <div class="mc-stage">
                <span class="mc-stage-num">02</span>
                <span class="mc-stage-label">Understanding</span>
                <span class="mc-stage-sub">Jetson Orin + V-JEPA 2</span>
                <span class="mc-badge" id="mc-und-b">—</span>
              </div>
              <div class="mc-body">
                <div class="mc-hero-row">
                  <div class="mc-hero">
                    <div class="mc-hv" id="mc-vj-fps-v">—</div>
                    <div class="mc-hl">V-JEPA FPS</div>
                  </div>
                  <div class="mc-hero">
                    <div class="mc-hv" id="mc-jet-cpu-v">—</div>
                    <div class="mc-hl">Jetson CPU</div>
                  </div>
                </div>
                <div class="mc-divider"></div>
                <div class="mc-grid">
                  <div class="mc-metric">
                    <span class="mc-ml">GPU</span>
                    <div class="mc-bar-wrap"><div class="mc-bar"><div class="mc-fill" id="mc-jet-gpu-bar"></div></div></div>
                    <span class="mc-mv" id="mc-jet-gpu">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">RAM</span>
                    <div class="mc-bar-wrap"><div class="mc-bar"><div class="mc-fill" id="mc-jet-ram-bar"></div></div></div>
                    <span class="mc-mv" id="mc-jet-ram">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">Latency</span>
                    <span class="mc-mv" id="mc-vj-lat">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">Active</span>
                    <span class="mc-mv" id="mc-vj-cam">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">Inferring</span>
                    <span class="mc-mv" id="mc-vj-inf">—</span>
                  </div>
                  <div class="mc-metric">
                    <span class="mc-ml">Temp</span>
                    <span class="mc-mv" id="mc-jet-ct">—</span>
                  </div>
                </div>
                <div class="mc-model" id="mc-vj-mdl">ViT-L · FP16 · CUDA</div>
              </div>
            </div>

          </div>
        </div>
      </div>
    `;
    this._config.cameras.forEach(cam => {
      const img = this.shadowRoot.getElementById(`img-${cam.name}`);
      if (img) img.onerror = () => { if (!this._failedCams.has(cam.name)) { this._failedCams.add(cam.name); img.src = this._snapUrlHA(cam); } };
    });
  }

  // ── Polling ──
  _poll() {
    const t1 = setInterval(() => {
      this._config.cameras.forEach(cam => {
        const img = this.shadowRoot.getElementById(`img-${cam.name}`);
        if (!img) return;
        const url = this._snapUrl(cam);
        const tmp = new Image();
        tmp.onload = () => { img.src = url; };
        tmp.onerror = () => { if (!this._failedCams.has(cam.name)) { this._failedCams.add(cam.name); img.src = this._snapUrlHA(cam); } };
        tmp.src = url;
      });
    }, 2000);
    const t2 = setInterval(() => this._fetchFrigate(), 5000);
    this._timers.push(t1, t2);
    this._config.cameras.forEach(cam => {
      const img = this.shadowRoot.getElementById(`img-${cam.name}`);
      if (img) img.src = this._snapUrl(cam);
    });
    this._fetchFrigate();
  }

  async _fetchFrigate() {
    if (!this._hass) return;
    if (!this._ingressEntry) {
      try {
        const info = await this._hass.callWS({ type: 'supervisor/api', endpoint: `/addons/${this._ingressSlug}/info`, method: 'GET' });
        if (info?.ingress_entry) this._ingressEntry = info.ingress_entry;
      } catch(e) {}
    }
    if (this._ingressEntry) {
      try {
        const r = await fetch(this._ingressEntry + '/api/stats', { credentials: 'same-origin' });
        if (r.ok) { this._frigateStats = await r.json(); return; }
        if (r.status === 401) this._ingressEntry = null;
      } catch(e) {}
    }
    try {
      const st = await this._hass.callWS({ type: 'supervisor/api', endpoint: `/addons/${this._ingressSlug}/stats`, method: 'GET' });
      if (st) {
        if (!this._frigateStats.cpu_usages) this._frigateStats.cpu_usages = {};
        this._frigateStats.cpu_usages['frigate.full_system'] = { cpu: String(st.cpu_percent || 0), mem: String(((st.memory_usage || 0) / (st.memory_limit || 1) * 100).toFixed(1)) };
        if (!this._frigateStats.service) this._frigateStats.service = {};
        this._frigateStats.service._supervisor = true;
      }
    } catch(e) {}
    try { const r = await fetch(this._config.frigate_url + '/api/stats'); if (r.ok) this._frigateStats = await r.json(); } catch(e) {}
  }

  // ── Update ──
  _update() {
    if (!this._hass) return;
    let tot = 0;
    this._config.cameras.forEach(cam => { tot += this._updateCam(cam); });
    this._updateMetrics();
    this._st('hdr-obj', String(tot));
    const vst = this._hass.states['sensor.v_jepa_2_status'];
    const pill = this.shadowRoot.getElementById('pill');
    if (pill) {
      const on = vst?.state === 'running';
      const h = `<span class="pill-dot${on ? '' : ' off'}"></span>${on ? 'Active' : 'Offline'}`;
      if (pill.innerHTML !== h) { pill.innerHTML = h; pill.className = on ? 'pill' : 'pill pill-off'; }
    }
  }

  _st(id, v) { const e = typeof id === 'string' ? this.shadowRoot.getElementById(id) : id; if (e && e.textContent !== v) e.textContent = v; }
  _sc(e, c) { if (e && e.className !== c) e.className = c; }

  _updateCam(cam) {
    const $ = id => this.shadowRoot.getElementById(id);
    const act = cam.vjepa ? this._getActivity(cam.name) : null;
    const fSt = this._frigateStats?.cameras?.[cam.name];
    const inferring = cam.vjepa && this._isVjepaInferring(cam.name);
    const personDetected = act && act.person_detected;

    // Pipeline indicator
    const pipe = $(`pipe-${cam.name}`);
    if (pipe) this._sc(pipe, inferring ? 'ov-pipe pipe-on' : 'ov-pipe');

    // v11: Cell border glow when person detected
    const cell = $(`cell-${cam.name}`);
    if (cell) {
      const vp = cell.querySelector('.cam-vp');
      if (vp) vp.className = personDetected ? 'cam-vp vp-active' : (this._isMotionDetected(cam.name) ? 'cam-vp vp-motion' : 'cam-vp');
    }

    // V-JEPA 2 activity
    if (cam.vjepa) {
      const ap = $(`act-${cam.name}`);
      const an = $(`act-name-${cam.name}`);
      const ac = $(`act-conf-${cam.name}`);
      const as2 = $(`act-sec-${cam.name}`);
      const asc = $(`act-scores-${cam.name}`);

      if (personDetected) {
        if (ap && !ap.classList.contains('act-on')) ap.classList.add('act-on');
        const lbl = this._activityLabel(act.activity) || 'Detected';
        if (an) { this._st(an, lbl); this._sc(an, 'act-name act-name-on'); }
        if (ac) {
          const pct = typeof act.confidence === 'number' ? (act.confidence > 1 ? act.confidence : act.confidence * 100) : 0;
          this._st(ac, pct.toFixed(0) + '%');
        }
        if (as2) {
          const sec = act.secondary ? this._activityLabel(act.secondary) : null;
          this._st(as2, sec ? `${sec} ${(act.secondaryConf * 100).toFixed(0)}%` : '');
        }
        if (asc && act.activityScores) {
          const key = JSON.stringify(act.activityScores);
          if (this._prevScoresKey[cam.name] !== key) {
            this._prevScoresKey[cam.name] = key;
            const sorted = Object.entries(act.activityScores).sort((a, b) => b[1] - a[1]).slice(0, 3);
            const mx = sorted[0]?.[1] || 1;
            let h = '';
            sorted.forEach(([n, s]) => {
              h += `<div class="sr"><span class="sr-n">${n.replace(/_/g,' ')}</span><div class="sr-bar"><div class="sr-fill" style="width:${Math.min(100,(s/mx)*100)}%"></div></div><span class="sr-v">${(s*100).toFixed(0)}%</span></div>`;
            });
            asc.innerHTML = h;
          }
        } else if (asc && asc.innerHTML) { asc.innerHTML = ''; }
      } else {
        if (ap && ap.classList.contains('act-on')) ap.classList.remove('act-on');
        if (an) { this._st(an, ''); this._sc(an, 'act-name'); }
        if (ac) this._st(ac, '');
        if (as2) this._st(as2, '');
        if (asc && asc.innerHTML) asc.innerHTML = '';
      }
    }

    // Bottom data strip
    if (fSt) {
      this._st($(`od-fps-${cam.name}`), (fSt.camera_fps || 0).toFixed(0));
      this._st($(`od-dps-${cam.name}`), (fSt.detection_fps || 0).toFixed(1));
    }
    if (cam.vjepa && act) {
      this._st($(`od-embed-${cam.name}`), act.embed_change !== null ? act.embed_change.toFixed(3) : '—');
      this._st($(`od-motion-${cam.name}`), act.motion_level !== null ? act.motion_level.toFixed(3) : '—');
      const te = $(`od-trend-${cam.name}`);
      if (te && act.trend !== null) {
        const a = act.trend > 0.001 ? '↑' : act.trend < -0.001 ? '↓' : '→';
        this._st(te, act.trend.toFixed(3) + a);
      }
      this._st($(`od-ts-${cam.name}`), this._fmtTime(act.timestamp));
    }
    const db = $(`data-${cam.name}`);
    if (db) db.style.opacity = personDetected ? '1' : '0.45';

    // Detection pills
    const objs = this._getDetectedObjects(cam.name);
    const snds = this._getDetectedSounds(cam.name);
    const dEl = $(`detect-${cam.name}`);
    if (dEl) {
      const key = objs.join(',') + '|' + snds.join(',');
      if (this._prevDetectKey[cam.name] !== key) {
        this._prevDetectKey[cam.name] = key;
        let h = '';
        objs.forEach(o => { h += `<span class="dp">${this._getObjectLabel(o)}</span>`; });
        snds.forEach(s => { h += `<span class="dp dp-snd">${this._getSoundLabel(s)}</span>`; });
        dEl.innerHTML = h;
      }
    }
    return objs.length;
  }

  _updateMetrics() {
    const h = this._hass; if (!h) return;
    const $ = id => this.shadowRoot.getElementById(id);
    const bar = (id, p) => { const b = $(id); if (b) b.style.width = Math.min(100, p||0)+'%'; };
    const sv = (id, v) => this._st(id, String(v));

    // ── Detection Pipeline (Frigate + Coral) ──
    const st = this._frigateStats;
    const hasFri = st && (st.service || st.cpu_usages);
    let hasCoral = false;

    if (st?.cpu_usages?.['frigate.full_system']) {
      const fs = st.cpu_usages['frigate.full_system'];
      const cpu = parseFloat(fs.cpu)||0, mem = parseFloat(fs.mem)||0;
      sv('mc-fri-cpu-v', cpu.toFixed(1)+'%');
      sv('mc-fri-mem', mem.toFixed(0)+'%'); bar('mc-fri-mem-bar', mem);
    }
    if (st?.service?.uptime) {
      const u = st.service.uptime, hrs = Math.floor(u/3600), min = Math.floor((u%3600)/60);
      sv('mc-fri-up', hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
    }
    let dc=0;
    this._config.cameras.forEach(c => { if (this._getSwitch(c.name,'detect')) dc++; });
    sv('mc-fri-det', `${dc}/5`);

    if (st?.detectors) {
      const det = Object.values(st.detectors)[0];
      if (det) {
        hasCoral = true;
        sv('mc-coral-spd-v', (det.inference_speed||0).toFixed(1)+' ms');
      }
    }
    const temps = st?.service?.temperatures || st?.temperatures;
    if (temps) {
      const t = temps.apex_0 !== undefined ? temps.apex_0 : Object.values(temps)[0];
      if (t !== undefined) sv('mc-coral-tmp', t.toFixed(1)+'°C');
    }

    // Detection badge
    const db = $('mc-det-b');
    if (db) {
      const on = hasFri || hasCoral;
      db.textContent = on ? 'Online' : '—';
      db.className = on ? 'mc-badge badge-on' : 'mc-badge';
    }

    // ── Understanding Pipeline (Jetson + V-JEPA) ──
    let jOn = false;
    const jcpu = h.states['sensor.jetson_cpu_usage'];
    if (jcpu && jcpu.state !== 'unavailable' && jcpu.state !== 'unknown') {
      jOn=true; const v=parseFloat(jcpu.state)||0;
      sv('mc-jet-cpu-v', v.toFixed(1)+'%');
    }
    const jgpu = h.states['sensor.jetson_gpu_usage'];
    if (jgpu && jgpu.state !== 'unavailable' && jgpu.state !== 'unknown') {
      jOn=true; const v=parseFloat(jgpu.state)||0;
      sv('mc-jet-gpu', v.toFixed(0)+'%'); bar('mc-jet-gpu-bar', v);
    }
    const jr = h.states['sensor.jetson_ram_usage'];
    if (jr && jr.state !== 'unavailable' && jr.state !== 'unknown') {
      jOn=true; const a=jr.attributes||{};
      sv('mc-jet-ram', `${a.ram_used_mb?(a.ram_used_mb/1024).toFixed(1):'?'}/${a.ram_total_mb?(a.ram_total_mb/1024).toFixed(1):'?'} GB`);
      bar('mc-jet-ram-bar', parseFloat(jr.state)||0);
    }
    const jct = h.states['sensor.jetson_cpu_temp'];
    if (jct && jct.state !== 'unavailable' && jct.state !== 'unknown') {
      jOn=true; sv('mc-jet-ct', jct.state+'°C');
    } else sv('mc-jet-ct', '—');

    // V-JEPA
    const vFps = h.states['sensor.v_jepa_2_fps'];
    if (vFps && vFps.state !== 'unavailable' && vFps.state !== 'unknown') {
      sv('mc-vj-fps-v', parseFloat(vFps.state).toFixed(1)+' fps');
    }
    const vLat = h.states['sensor.v_jepa_2_inference_latency'];
    if (vLat && vLat.state !== 'unavailable' && vLat.state !== 'unknown') {
      sv('mc-vj-lat', parseFloat(vLat.state).toFixed(0)+' ms');
    }
    const vCam = h.states['sensor.v_jepa_2_active_cameras'];
    if (vCam && vCam.state !== 'unavailable' && vCam.state !== 'unknown') {
      sv('mc-vj-cam', vCam.state+'/5');
    }
    let ic=0; this._config.cameras.forEach(c => { if (c.vjepa && this._isVjepaInferring(c.name)) ic++; });
    sv('mc-vj-inf', `${ic}/3`);

    // Understanding badge
    const ub = $('mc-und-b');
    if (ub) {
      const running = h.states['sensor.v_jepa_2_status']?.state === 'running';
      if (jOn && running) { ub.textContent = 'Online'; ub.className = 'mc-badge badge-on'; }
      else if (running) { ub.textContent = 'No Metrics'; ub.className = 'mc-badge badge-warn'; }
      else { ub.textContent = 'Offline'; ub.className = 'mc-badge'; }
    }

    const vStatus = h.states['sensor.v_jepa_2_status'];
    if (vStatus?.attributes) sv('mc-vj-mdl', `${vStatus.attributes.model||'ViT-L'} · ${vStatus.attributes.precision||'FP16'} · CUDA`);
  }

  // ── CSS ──
  _css() {
    return `
    :host {
      --bg: #000;
      --g1: rgba(255,255,255,0.025);
      --g2: rgba(255,255,255,0.055);
      --g3: rgba(255,255,255,0.09);
      --t1: rgba(255,255,255,0.93);
      --t2: rgba(255,255,255,0.58);
      --t3: rgba(255,255,255,0.34);
      --t4: rgba(255,255,255,0.18);
      --r: 14px; --rs: 10px;
      --ease: cubic-bezier(.25,.1,.25,1);
      --blur: blur(40px); --blurs: blur(20px);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .el-root {
      background: var(--bg);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif;
      color: var(--t1); -webkit-font-smoothing: antialiased;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }

    /* ── Header ── */
    .hdr {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 20px; background: var(--g1);
      border-bottom: 1px solid var(--g2); flex-shrink: 0; z-index: 10;
    }
    .hdr-l { display: flex; flex-direction: column; gap: 2px; }
    .hdr-r { display: flex; align-items: center; gap: 24px; }
    .hdr-title { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
    .hdr-sub { font-size: 9px; color: var(--t4); font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; }
    .hdr-stat { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .hdr-sv { font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .hdr-sl { font-size: 8px; font-weight: 400; color: var(--t4); text-transform: uppercase; letter-spacing: 0.8px; }
    .pill {
      display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 100px;
      background: var(--g1); border: 1px solid var(--g2);
      font-size: 10px; font-weight: 500; color: var(--t2);
    }
    .pill.pill-off { color: var(--t4); }
    .pill-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--t3); animation: pulse 2.5s ease-in-out infinite; }
    .pill-dot.off { background: var(--t4); animation: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.15} }

    /* ── Scroll ── */
    .scroll-area {
      flex: 1; overflow-y: auto; overflow-x: hidden;
      padding: 10px 12px 12px;
      -webkit-overflow-scrolling: touch;
    }
    .scroll-area::-webkit-scrollbar { width: 2px; }
    .scroll-area::-webkit-scrollbar-track { background: transparent; }
    .scroll-area::-webkit-scrollbar-thumb { background: var(--g2); border-radius: 2px; }

    /* ── Camera Grids ── */
    .grid-primary { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
    .grid-secondary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }

    .cam-vp {
      position: relative; background: #060608; border-radius: var(--r); overflow: hidden;
      aspect-ratio: 16/9; border: 1px solid rgba(255,255,255,0.05);
      transition: border-color 0.6s var(--ease), box-shadow 0.6s var(--ease);
    }
    .cam-vp.vp-active {
      border-color: rgba(255,255,255,0.14);
      box-shadow: 0 0 20px rgba(255,255,255,0.04);
    }
    .cam-vp.vp-motion {
      border-color: rgba(255,255,255,0.08);
    }
    .cam-img { width: 100%; height: 100%; object-fit: cover; display: block; }

    /* ── v11: Consistent scrim system ── */
    .scrim-top {
      position: absolute; top: 0; left: 0; right: 0; height: 60px; z-index: 3;
      background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 60%, transparent 100%);
      pointer-events: none;
    }
    .scrim-bot {
      position: absolute; bottom: 0; left: 0; right: 0; height: 72px; z-index: 3;
      background: linear-gradient(0deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 55%, transparent 100%);
      pointer-events: none;
    }

    /* ── Top overlay: label + pipeline (no status pill) ── */
    .ov-top {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; z-index: 5;
    }
    .ov-label {
      font-size: 13px; font-weight: 600; letter-spacing: -0.015em;
      color: rgba(255,255,255,0.95);
      text-shadow: 0 1px 8px rgba(0,0,0,1), 0 0 3px rgba(0,0,0,0.9);
    }
    .ov-pipe {
      display: flex; align-items: center; gap: 4px;
      font-size: 8px; font-weight: 500; color: var(--t4);
      text-transform: uppercase; letter-spacing: 0.5px;
      opacity: 0; transition: opacity 0.6s var(--ease);
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    }
    .ov-pipe.pipe-on { opacity: 1; color: rgba(255,255,255,0.65); }
    .pipe-dot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,0.6); animation: pulse 1.2s ease-in-out infinite; }

    /* ── Detection pills v11: softer, more integrated ── */
    .ov-detect {
      position: absolute; top: 32px; left: 0; right: 0; z-index: 5; pointer-events: none;
      display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 12px;
    }
    .dp {
      padding: 2px 8px; border-radius: 100px; font-size: 10px; font-weight: 500;
      background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.10); color: rgba(255,255,255,0.82);
      backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
      text-shadow: 0 1px 3px rgba(0,0,0,0.9);
      letter-spacing: 0.01em;
    }
    .dp-snd { font-style: italic; color: rgba(255,255,255,0.50); font-weight: 400; border-color: rgba(255,255,255,0.06); }

    /* ── V-JEPA Activity overlay v11: cleaner ── */
    .ov-activity {
      position: absolute; bottom: 26px; left: 0; right: 0; z-index: 5;
      opacity: 0; transition: opacity 0.6s var(--ease);
      pointer-events: none;
    }
    .ov-activity.act-on { opacity: 1; }
    .act-content { position: relative; z-index: 1; padding: 8px 14px; }
    .act-main { display: flex; align-items: baseline; gap: 8px; }
    .act-name {
      font-size: 18px; font-weight: 500; color: var(--t4);
      letter-spacing: -0.025em;
      text-shadow: 0 1px 12px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,0.9);
      transition: color 0.5s var(--ease);
    }
    .act-name-on { color: rgba(255,255,255,0.93); }
    .act-conf {
      font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.42); font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 6px rgba(0,0,0,0.9);
    }
    .act-sec {
      font-size: 10px; color: rgba(255,255,255,0.35); font-weight: 400; min-height: 12px;
      text-shadow: 0 1px 4px rgba(0,0,0,0.8);
      margin-top: 2px;
    }
    .act-scores { display: flex; flex-direction: column; gap: 3px; padding: 4px 0 0; }
    .sr { display: flex; align-items: center; gap: 6px; }
    .sr-n { font-size: 9px; font-weight: 400; color: rgba(255,255,255,0.38); width: 44px; flex-shrink: 0; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
    .sr-bar { flex: 1; height: 2px; border-radius: 1px; background: rgba(255,255,255,0.06); overflow: hidden; }
    .sr-fill { height: 100%; border-radius: 1px; background: rgba(255,255,255,0.35); transition: width 0.4s var(--ease); }
    .sr-v { font-size: 9px; font-weight: 400; color: rgba(255,255,255,0.38); font-variant-numeric: tabular-nums; width: 26px; text-align: right; flex-shrink: 0; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }

    /* ── Bottom data strip v11: integrated into scrim ── */
    .ov-data {
      position: absolute; bottom: 0; left: 0; right: 0; z-index: 5;
      display: flex; align-items: center; gap: 10px; padding: 7px 14px;
      transition: opacity 0.5s var(--ease);
    }
    .od { display: flex; align-items: center; gap: 3px; }
    .od-l { font-size: 8px; font-weight: 400; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.4px; }
    .od-v { font-size: 10px; font-weight: 500; font-family: 'SF Mono','Menlo',monospace; color: rgba(255,255,255,0.58); font-variant-numeric: tabular-nums; }
    .od-sep { width: 1px; height: 8px; background: rgba(255,255,255,0.08); margin: 0 2px; }
    .od-ts { font-size: 8px; color: rgba(255,255,255,0.28); margin-left: auto; font-variant-numeric: tabular-nums; }

    /* ── Metrics pane v11: flex child at bottom, never overlaps HA sidebar ── */
    .metrics-pane {
      flex-shrink: 0; z-index: 20;
      padding: 10px 16px 12px;
      background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.9) 12%, #000 100%);
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 0;
      max-width: 1600px; margin: 0 auto;
      align-items: stretch;
    }

    /* ── Pipeline flow arrow ── */
    .mc-flow {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 0 8px; gap: 0;
    }
    .mc-flow-line {
      width: 1px; flex: 1;
      background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.08) 30%, rgba(255,255,255,0.08) 70%, transparent 100%);
    }
    .mc-flow-arrow {
      font-size: 14px; color: var(--t4); font-weight: 300;
      padding: 4px 0;
      animation: flowPulse 3s ease-in-out infinite;
    }
    @keyframes flowPulse { 0%,100%{opacity:.3} 50%{opacity:.7} }

    /* ── v11: Unified liquid glass pipeline card ── */
    .mc {
      background: rgba(14,14,18,0.72);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px;
      padding: 18px 22px;
      backdrop-filter: blur(56px) saturate(1.15);
      -webkit-backdrop-filter: blur(56px) saturate(1.15);
      box-shadow:
        inset 0 0.5px 0 rgba(255,255,255,0.06),
        0 4px 28px rgba(0,0,0,0.35);
      transition: border-color 0.4s var(--ease), box-shadow 0.4s var(--ease);
    }
    .mc:hover {
      border-color: rgba(255,255,255,0.10);
      box-shadow:
        inset 0 0.5px 0 rgba(255,255,255,0.08),
        0 8px 36px rgba(0,0,0,0.45);
    }

    /* ── Stage header ── */
    .mc-stage {
      display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
    }
    .mc-stage-num {
      font-size: 9px; font-weight: 500; color: var(--t4);
      font-variant-numeric: tabular-nums;
      font-family: 'SF Mono','Menlo',monospace;
      letter-spacing: 0.02em;
    }
    .mc-stage-label {
      font-size: 13px; font-weight: 600; color: var(--t1);
      letter-spacing: -0.02em;
    }
    .mc-stage-sub {
      font-size: 9px; font-weight: 400; color: var(--t3);
      letter-spacing: 0.01em;
      flex: 1;
    }
    .mc-badge {
      font-size: 8px; font-weight: 500; padding: 2px 9px; border-radius: 100px;
      background: rgba(255,255,255,0.03); color: var(--t4);
      letter-spacing: 0.02em;
    }
    .mc-badge.badge-on { background: rgba(255,255,255,0.07); color: var(--t2); }
    .mc-badge.badge-warn { background: rgba(255,200,100,0.07); color: rgba(255,200,100,0.50); }

    .mc-body { display: flex; flex-direction: column; }

    /* ── v11: Hero metrics row — two side by side ── */
    .mc-hero-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
      margin-bottom: 14px;
    }
    .mc-hero {}
    .mc-hv {
      font-size: 32px; font-weight: 400; font-variant-numeric: tabular-nums;
      letter-spacing: -0.04em; color: var(--t1); line-height: 1;
    }
    .mc-hl {
      font-size: 9px; font-weight: 400; color: var(--t4);
      text-transform: uppercase; letter-spacing: 0.08em; margin-top: 5px;
    }

    /* ── Divider ── */
    .mc-divider {
      height: 1px; background: rgba(255,255,255,0.04); margin-bottom: 12px;
    }

    /* ── v11: Metric grid — compact 2-col layout ── */
    .mc-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px;
    }
    .mc-metric {
      display: flex; align-items: center; gap: 8px;
    }
    .mc-ml {
      font-size: 10px; color: var(--t3); width: 58px; flex-shrink: 0; font-weight: 400;
    }
    .mc-bar-wrap { flex: 1; display: flex; align-items: center; }
    .mc-bar { flex: 1; height: 2px; border-radius: 1px; background: rgba(255,255,255,0.05); overflow: hidden; }
    .mc-fill { height: 100%; border-radius: 1px; transition: width 0.6s var(--ease); width: 0%; background: rgba(255,255,255,0.22); }
    .mc-mv {
      font-size: 11px; font-weight: 400; font-variant-numeric: tabular-nums;
      color: var(--t2); min-width: 52px; text-align: right;
    }

    /* ── Model tag ── */
    .mc-model {
      margin-top: 10px; padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.035);
      font-size: 9px; color: var(--t3); font-family: 'SF Mono','Menlo',monospace;
      letter-spacing: 0.3px; font-weight: 400;
    }

    @media (max-width: 1000px) {
      .metrics-grid { grid-template-columns: 1fr auto 1fr; }
      .grid-secondary { grid-template-columns: repeat(2, 1fr); }
      .scroll-area { padding-bottom: 12px; }
    }
    @media (max-width: 600px) {
      .grid-primary { grid-template-columns: 1fr; }
      .grid-secondary { grid-template-columns: 1fr; }
      .metrics-grid { grid-template-columns: 1fr; }
      .mc-flow { display: none; }
      .scroll-area { padding-bottom: 12px; }
    }
    `;
  }
}

if (!customElements.get('engineered-lighting-card')) {
  customElements.define('engineered-lighting-card', EngineeredLightingCard);
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'engineered-lighting-card',
  name: 'Engineered Lighting',
  description: 'V-JEPA 2 World Model Dashboard v11'
});
