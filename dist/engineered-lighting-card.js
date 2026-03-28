/**
 * Engineered Lighting Card v8
 * V-JEPA 2 World Model Dashboard
 *
 * Design: Liquid glass · Monochrome · Apple clarity
 * Light typography, calm ambient data, zero flicker.
 * Person-gated V-JEPA: only indoor cameras with person detected.
 * Frigate stats via Supervisor ingress. No bounding boxes.
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
    return act.person_detected || (act.motion_level !== null && act.motion_level > 0.01);
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
          <div class="ov-top">
            <span class="ov-label">${cam.label}</span>
            ${cam.vjepa ? `<span class="ov-pipe" id="pipe-${cam.name}"><span class="pipe-dot"></span>V-JEPA</span>` : ''}
            <span class="ov-status" id="status-${cam.name}">Idle</span>
          </div>
          <div class="ov-detect" id="detect-${cam.name}"></div>
          ${cam.vjepa ? `
          <div class="ov-activity" id="act-${cam.name}">
            <div class="act-scrim"></div>
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
            <span class="od"><span class="od-l">Embed</span><span class="od-v" id="od-embed-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Motion</span><span class="od-v" id="od-motion-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Trend</span><span class="od-v" id="od-trend-${cam.name}">—</span></span>
            <span class="od-sep"></span>
            <span class="od"><span class="od-l">FPS</span><span class="od-v" id="od-fps-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Det/s</span><span class="od-v" id="od-dps-${cam.name}">—</span></span>
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
            <div class="mc">
              <div class="mc-hdr"><span class="mc-t">Frigate NVR</span><span class="mc-badge" id="mc-fri-b">—</span></div>
              <div class="mc-body">
                <div class="mc-r"><span class="mc-l">CPU</span><div class="mc-bar"><div class="mc-fill" id="mc-fri-cpu-bar"></div></div><span class="mc-v" id="mc-fri-cpu">—</span></div>
                <div class="mc-r"><span class="mc-l">Memory</span><div class="mc-bar"><div class="mc-fill" id="mc-fri-mem-bar"></div></div><span class="mc-v" id="mc-fri-mem">—</span></div>
                <div class="mc-r"><span class="mc-l">Uptime</span><span class="mc-v" id="mc-fri-up">—</span></div>
                <div class="mc-r"><span class="mc-l">Detect</span><span class="mc-v" id="mc-fri-det">—</span></div>
                <div class="mc-r"><span class="mc-l">Motion</span><span class="mc-v" id="mc-fri-mot">—</span></div>
              </div>
            </div>
            <div class="mc">
              <div class="mc-hdr"><span class="mc-t">Coral TPU</span><span class="mc-badge" id="mc-coral-b">—</span></div>
              <div class="mc-body">
                <div class="mc-r"><span class="mc-l">Inference</span><span class="mc-v" id="mc-coral-spd">—</span></div>
                <div class="mc-r"><span class="mc-l">Temp</span><span class="mc-v" id="mc-coral-tmp">—</span></div>
                <div class="mc-r"><span class="mc-l">PID</span><span class="mc-v" id="mc-coral-pid">—</span></div>
              </div>
            </div>
            <div class="mc">
              <div class="mc-hdr"><span class="mc-t">Jetson Orin Nano</span><span class="mc-badge" id="mc-jet-b">—</span></div>
              <div class="mc-body">
                <div class="mc-r"><span class="mc-l">CPU</span><div class="mc-bar"><div class="mc-fill" id="mc-jet-cpu-bar"></div></div><span class="mc-v" id="mc-jet-cpu">—</span></div>
                <div class="mc-r"><span class="mc-l">GPU</span><div class="mc-bar"><div class="mc-fill" id="mc-jet-gpu-bar"></div></div><span class="mc-v" id="mc-jet-gpu">—</span></div>
                <div class="mc-r"><span class="mc-l">RAM</span><div class="mc-bar"><div class="mc-fill" id="mc-jet-ram-bar"></div></div><span class="mc-v" id="mc-jet-ram">—</span></div>
                <div class="mc-r"><span class="mc-l">CPU Temp</span><span class="mc-v" id="mc-jet-ct">—</span></div>
                <div class="mc-r"><span class="mc-l">GPU Temp</span><span class="mc-v" id="mc-jet-gt">—</span></div>
              </div>
            </div>
            <div class="mc mc-accent">
              <div class="mc-hdr"><span class="mc-t">V-JEPA 2</span><span class="mc-badge" id="mc-vj-b">—</span></div>
              <div class="mc-body">
                <div class="mc-r"><span class="mc-l">Status</span><span class="mc-v" id="mc-vj-st">—</span></div>
                <div class="mc-r"><span class="mc-l">FPS</span><span class="mc-v" id="mc-vj-fps">—</span></div>
                <div class="mc-r"><span class="mc-l">Latency</span><span class="mc-v" id="mc-vj-lat">—</span></div>
                <div class="mc-r"><span class="mc-l">Frames</span><span class="mc-v" id="mc-vj-frm">—</span></div>
                <div class="mc-r"><span class="mc-l">Active</span><span class="mc-v" id="mc-vj-cam">—</span></div>
                <div class="mc-r"><span class="mc-l">Inferring</span><span class="mc-v" id="mc-vj-inf">—</span></div>
                <div class="mc-r mc-r-mdl"><span class="mc-mdl" id="mc-vj-mdl">ViT-L · FP16 · CUDA</span></div>
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

    // Pipeline indicator (only for vjepa-enabled cameras)
    const pipe = $(`pipe-${cam.name}`);
    if (pipe) this._sc(pipe, inferring ? 'ov-pipe pipe-on' : 'ov-pipe');

    // Status badge
    const stEl = $(`status-${cam.name}`);
    if (stEl) {
      // Check person detection from Frigate (works for all cameras)
      const hasPerson = this._getDetectedObjects(cam.name).includes('person');
      if (hasPerson) { this._st(stEl, 'Person'); this._sc(stEl, 'ov-status ov-s-person'); }
      else if (this._isMotionDetected(cam.name)) { this._st(stEl, 'Motion'); this._sc(stEl, 'ov-status ov-s-motion'); }
      else { this._st(stEl, 'Idle'); this._sc(stEl, 'ov-status'); }
    }

    // V-JEPA 2 activity (only for vjepa-enabled cameras with person detected)
    if (cam.vjepa) {
      const ap = $(`act-${cam.name}`);
      const an = $(`act-name-${cam.name}`);
      const ac = $(`act-conf-${cam.name}`);
      const as = $(`act-sec-${cam.name}`);
      const asc = $(`act-scores-${cam.name}`);

      if (personDetected) {
        if (ap && !ap.classList.contains('act-on')) ap.classList.add('act-on');
        const lbl = this._activityLabel(act.activity) || 'Detected';
        if (an) { this._st(an, lbl); this._sc(an, 'act-name act-name-on'); }
        if (ac) {
          const pct = typeof act.confidence === 'number' ? (act.confidence > 1 ? act.confidence : act.confidence * 100) : 0;
          this._st(ac, pct.toFixed(0) + '%');
        }
        if (as) {
          const sec = act.secondary ? this._activityLabel(act.secondary) : null;
          this._st(as, sec ? `${sec} ${(act.secondaryConf * 100).toFixed(0)}%` : '');
        }
        if (asc && act.activityScores) {
          const key = JSON.stringify(act.activityScores);
          if (this._prevScoresKey[cam.name] !== key) {
            this._prevScoresKey[cam.name] = key;
            const sorted = Object.entries(act.activityScores).sort((a, b) => b[1] - a[1]).slice(0, 5);
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
        if (as) this._st(as, '');
        if (asc && asc.innerHTML) asc.innerHTML = '';
      }
    }

    // Bottom data strip
    if (act) {
      this._st($(`od-embed-${cam.name}`), act.embed_change !== null ? act.embed_change.toFixed(4) : '—');
      this._st($(`od-motion-${cam.name}`), act.motion_level !== null ? act.motion_level.toFixed(4) : '—');
      const te = $(`od-trend-${cam.name}`);
      if (te && act.trend !== null) { const a = act.trend > 0.001 ? '↑' : act.trend < -0.001 ? '↓' : '→'; this._st(te, act.trend.toFixed(4)+a); }
      this._st($(`od-ts-${cam.name}`), this._fmtTime(act.timestamp));
    }
    if (fSt) {
      this._st($(`od-fps-${cam.name}`), (fSt.camera_fps || 0).toFixed(0));
      this._st($(`od-dps-${cam.name}`), (fSt.detection_fps || 0).toFixed(1));
    }
    const db = $(`data-${cam.name}`);
    if (db) db.style.opacity = personDetected || inferring ? '1' : '0.35';

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

    // Frigate
    const st = this._frigateStats;
    const hasFri = st && (st.service || st.cpu_usages);
    if (st?.cpu_usages?.['frigate.full_system']) {
      const fs = st.cpu_usages['frigate.full_system'];
      const cpu = parseFloat(fs.cpu)||0, mem = parseFloat(fs.mem)||0;
      sv('mc-fri-cpu', cpu.toFixed(1)+'%'); bar('mc-fri-cpu-bar', cpu);
      sv('mc-fri-mem', mem.toFixed(1)+'%'); bar('mc-fri-mem-bar', mem);
    }
    if (st?.service?.uptime) {
      const u = st.service.uptime, hrs = Math.floor(u/3600), min = Math.floor((u%3600)/60);
      sv('mc-fri-up', hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
    }
    let dc=0, mc=0;
    this._config.cameras.forEach(c => { if (this._getSwitch(c.name,'detect')) dc++; if (this._getSwitch(c.name,'motion')) mc++; });
    sv('mc-fri-det', `${dc}/5`); sv('mc-fri-mot', `${mc}/5`);
    const fb = $('mc-fri-b');
    if (fb) { fb.textContent = hasFri ? 'Online' : '—'; fb.className = hasFri ? 'mc-badge badge-on' : 'mc-badge'; }

    // Coral
    if (st?.detectors) {
      const det = Object.values(st.detectors)[0];
      if (det) {
        sv('mc-coral-spd', (det.inference_speed||0).toFixed(1)+' ms');
        sv('mc-coral-pid', String(det.pid||'—'));
        const cb = $('mc-coral-b'); if (cb) { cb.textContent = 'Online'; cb.className = 'mc-badge badge-on'; }
      }
    }
    const temps = st?.service?.temperatures || st?.temperatures;
    if (temps) {
      const t = temps.apex_0 !== undefined ? temps.apex_0 : Object.values(temps)[0];
      if (t !== undefined) sv('mc-coral-tmp', t.toFixed(1)+'°C');
    }

    // Jetson
    let jOn = false;
    [['sensor.jetson_cpu_usage','mc-jet-cpu','mc-jet-cpu-bar'],['sensor.jetson_gpu_usage','mc-jet-gpu','mc-jet-gpu-bar']].forEach(([sid,vid,bid]) => {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') { jOn=true; const v=parseFloat(s.state)||0; sv(vid, v.toFixed(1)+'%'); bar(bid, v); }
    });
    const jr = h.states['sensor.jetson_ram_usage'];
    if (jr && jr.state !== 'unavailable' && jr.state !== 'unknown') {
      jOn=true; const a=jr.attributes||{};
      sv('mc-jet-ram', `${a.ram_used_mb?(a.ram_used_mb/1024).toFixed(1):'?'}/${a.ram_total_mb?(a.ram_total_mb/1024).toFixed(1):'?'} GB`);
      bar('mc-jet-ram-bar', parseFloat(jr.state)||0);
    }
    [['sensor.jetson_cpu_temp','mc-jet-ct'],['sensor.jetson_gpu_temp','mc-jet-gt']].forEach(([sid,eid]) => {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') { jOn=true; sv(eid, s.state+'°C'); }
      else sv(eid, '—');
    });
    const jb = $('mc-jet-b');
    if (jb) {
      // V-JEPA runs on Jetson, so if V-JEPA is online but Jetson sensors are unknown, the publisher is down
      const vjOnline = h.states['sensor.v_jepa_2_status']?.state === 'running';
      if (jOn) { jb.textContent = 'Online'; jb.className = 'mc-badge badge-on'; }
      else if (vjOnline) { jb.textContent = 'No Metrics'; jb.className = 'mc-badge badge-warn'; }
      else { jb.textContent = 'Offline'; jb.className = 'mc-badge'; }
    }

    // V-JEPA 2
    const vMap = { 'sensor.v_jepa_2_status':'mc-vj-st','sensor.v_jepa_2_fps':'mc-vj-fps','sensor.v_jepa_2_inference_latency':'mc-vj-lat','sensor.v_jepa_2_frames_processed':'mc-vj-frm','sensor.v_jepa_2_active_cameras':'mc-vj-cam' };
    let vjOn = false;
    for (const [sid, eid] of Object.entries(vMap)) {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        vjOn=true; let v = s.state;
        if (sid.includes('fps')) v = parseFloat(v).toFixed(1)+' fps';
        else if (sid.includes('latency')) v = parseFloat(v).toFixed(0)+' ms';
        else if (sid.includes('frames')) v = parseInt(v).toLocaleString();
        else if (sid.includes('active')) v += '/5';
        sv(eid, v);
      }
    }
    let ic=0; this._config.cameras.forEach(c => { if (c.vjepa && this._isVjepaInferring(c.name)) ic++; });
    sv('mc-vj-inf', `${ic}/3`);
    const vjb = $('mc-vj-b');
    if (vjb) { vjb.textContent = vjOn ? 'Online' : 'Offline'; vjb.className = vjOn ? 'mc-badge badge-on' : 'mc-badge'; }
    const vStatus = h.states['sensor.v_jepa_2_status'];
    if (vStatus?.attributes) sv('mc-vj-mdl', `${vStatus.attributes.model||'ViT-L'} · ${vStatus.attributes.precision||'FP16'} · CUDA`);
  }

  // ── CSS ──
  _css() {
    return `
    :host {
      --bg: #000;
      --g1: rgba(255,255,255,0.035);
      --g2: rgba(255,255,255,0.06);
      --g3: rgba(255,255,255,0.09);
      --t1: rgba(255,255,255,0.88);
      --t2: rgba(255,255,255,0.50);
      --t3: rgba(255,255,255,0.30);
      --t4: rgba(255,255,255,0.16);
      --r: 12px; --rs: 8px;
      --ease: cubic-bezier(.25,.1,.25,1);
      --blur: blur(24px); --blurs: blur(16px);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .el-root {
      background: var(--bg);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif;
      color: var(--t1); -webkit-font-smoothing: antialiased;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }

    /* Header */
    .hdr {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px; background: var(--g1);
      border-bottom: 1px solid var(--g2); flex-shrink: 0; z-index: 10;
    }
    .hdr-l { display: flex; flex-direction: column; gap: 2px; }
    .hdr-r { display: flex; align-items: center; gap: 20px; }
    .hdr-title { font-size: 15px; font-weight: 600; letter-spacing: -0.02em; }
    .hdr-sub { font-size: 9px; color: var(--t4); font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; }
    .hdr-stat { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .hdr-sv { font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
    .hdr-sl { font-size: 8px; font-weight: 500; color: var(--t4); text-transform: uppercase; letter-spacing: 0.8px; }
    .pill {
      display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 100px;
      background: var(--g1); border: 1px solid var(--g2);
      font-size: 10px; font-weight: 500; color: var(--t2);
    }
    .pill.pill-off { color: var(--t4); }
    .pill-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--t3); animation: pulse 2.5s ease-in-out infinite; }
    .pill-dot.off { background: var(--t4); animation: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.2} }

    /* Scroll */
    .scroll-area {
      flex: 1; overflow-y: auto; overflow-x: hidden;
      padding: 8px 10px 210px;
      -webkit-overflow-scrolling: touch;
    }
    .scroll-area::-webkit-scrollbar { width: 2px; }
    .scroll-area::-webkit-scrollbar-track { background: transparent; }
    .scroll-area::-webkit-scrollbar-thumb { background: var(--g2); border-radius: 2px; }

    /* Grids */
    .grid-primary { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px; }
    .grid-secondary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }

    .cam-vp {
      position: relative; background: #080808; border-radius: var(--r); overflow: hidden;
      aspect-ratio: 16/9; border: 1px solid var(--g2);
    }
    .cam-img { width: 100%; height: 100%; object-fit: cover; display: block; }

    /* Overlays */
    .ov-top {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px; z-index: 5;
      background: linear-gradient(180deg, rgba(0,0,0,0.50) 0%, transparent 100%);
    }
    .ov-label {
      font-size: 11px; font-weight: 500; letter-spacing: -0.005em;
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    }
    .ov-pipe {
      display: flex; align-items: center; gap: 3px;
      font-size: 7px; font-weight: 600; color: var(--t4);
      text-transform: uppercase; letter-spacing: 0.5px;
      opacity: 0; transition: opacity 0.5s var(--ease);
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    }
    .ov-pipe.pipe-on { opacity: 1; color: var(--t3); }
    .pipe-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--t3); animation: pulse 1.2s ease-in-out infinite; }
    .ov-status {
      margin-left: auto; font-size: 9px; font-weight: 500;
      padding: 2px 8px; border-radius: 100px;
      background: rgba(255,255,255,0.05); color: var(--t4);
      backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
    }
    .ov-s-person { background: rgba(255,255,255,0.10); color: var(--t2); }
    .ov-s-motion { background: rgba(255,255,255,0.07); color: var(--t3); }

    /* Detection pills */
    .ov-detect {
      position: absolute; top: 30px; left: 0; right: 0; z-index: 4; pointer-events: none;
      display: flex; flex-wrap: wrap; gap: 3px; padding: 2px 8px;
    }
    .dp {
      padding: 2px 7px; border-radius: 100px; font-size: 9px; font-weight: 500;
      background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.10); color: var(--t2);
      backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
    }
    .dp-snd { font-style: italic; color: var(--t3); }

    /* V-JEPA Activity overlay with subtle scrim */
    .ov-activity {
      position: absolute; bottom: 22px; left: 0; right: 0; z-index: 5;
      opacity: 0.2; transition: opacity 0.5s var(--ease);
    }
    .ov-activity.act-on { opacity: 1; }
    .act-scrim {
      position: absolute; inset: -8px -4px -4px -4px;
      background: linear-gradient(0deg, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.25) 60%, transparent 100%);
      border-radius: 8px;
      pointer-events: none;
    }
    .act-content { position: relative; z-index: 1; padding: 6px 10px; }
    .act-main { display: flex; align-items: baseline; gap: 8px; }
    .act-name {
      font-size: 17px; font-weight: 500; color: var(--t4);
      letter-spacing: -0.02em;
      text-shadow: 0 1px 8px rgba(0,0,0,0.9);
      transition: color 0.4s var(--ease);
    }
    .act-name-on { color: var(--t1); }
    .act-conf {
      font-size: 13px; font-weight: 400; color: var(--t3); font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 4px rgba(0,0,0,0.8);
    }
    .act-sec {
      font-size: 10px; color: var(--t3); font-weight: 400; min-height: 13px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      margin-top: 1px;
    }
    .act-scores { display: flex; flex-direction: column; gap: 2px; padding: 3px 0 0; }
    .sr { display: flex; align-items: center; gap: 4px; }
    .sr-n { font-size: 8px; font-weight: 400; color: var(--t4); width: 42px; flex-shrink: 0; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,0.7); }
    .sr-bar { flex: 1; height: 1.5px; border-radius: 1px; background: rgba(255,255,255,0.06); overflow: hidden; }
    .sr-fill { height: 100%; border-radius: 1px; background: rgba(255,255,255,0.30); transition: width 0.4s var(--ease); }
    .sr-v { font-size: 8px; font-weight: 500; color: var(--t4); font-variant-numeric: tabular-nums; width: 22px; text-align: right; flex-shrink: 0; text-shadow: 0 1px 2px rgba(0,0,0,0.7); }

    /* Bottom data strip */
    .ov-data {
      position: absolute; bottom: 0; left: 0; right: 0; z-index: 5;
      display: flex; align-items: center; gap: 8px; padding: 4px 10px;
      background: rgba(0,0,0,0.45);
      backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
      transition: opacity 0.5s var(--ease);
    }
    .od { display: flex; align-items: center; gap: 2px; }
    .od-l { font-size: 7px; font-weight: 500; color: var(--t4); text-transform: uppercase; letter-spacing: 0.3px; }
    .od-v { font-size: 8px; font-weight: 500; font-family: 'SF Mono','Menlo',monospace; color: var(--t3); font-variant-numeric: tabular-nums; }
    .od-sep { width: 1px; height: 8px; background: var(--g2); margin: 0 2px; }
    .od-ts { font-size: 7px; color: var(--t4); margin-left: auto; font-variant-numeric: tabular-nums; }

    /* Fixed metrics pane — no dark bg, no border */
    .metrics-pane {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
      padding: 8px 10px 10px;
    }
    .metrics-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
      max-width: 1600px; margin: 0 auto;
    }
    .mc {
      background: rgba(10,10,12,0.88); border: 1px solid var(--g2); border-radius: var(--r);
      padding: 12px 14px;
      backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur);
    }
    .mc:hover { border-color: var(--g3); }
    .mc-accent { border-color: rgba(255,255,255,0.08); }

    .mc-hdr { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .mc-t { font-size: 10px; font-weight: 600; flex: 1; color: var(--t3); letter-spacing: -0.01em; }
    .mc-badge { font-size: 8px; font-weight: 600; padding: 2px 7px; border-radius: 100px; background: var(--g1); color: var(--t4); }
    .mc-badge.badge-on { background: rgba(255,255,255,0.06); color: var(--t2); }
    .mc-badge.badge-warn { background: rgba(255,255,255,0.04); color: var(--t3); }

    .mc-body { display: flex; flex-direction: column; gap: 5px; }
    .mc-r { display: flex; align-items: center; gap: 8px; }
    .mc-r-mdl { margin-top: 3px; padding-top: 5px; border-top: 1px solid var(--g2); }
    .mc-l { font-size: 9px; color: var(--t4); width: 52px; flex-shrink: 0; font-weight: 400; }
    .mc-bar { flex: 1; height: 2px; border-radius: 1px; background: rgba(255,255,255,0.04); overflow: hidden; }
    .mc-fill { height: 100%; border-radius: 1px; transition: width 0.6s var(--ease); width: 0%; background: rgba(255,255,255,0.25); }
    .mc-v { font-size: 9px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--t2); min-width: 52px; text-align: right; }
    .mc-mdl { font-size: 8px; color: var(--t4); font-family: 'SF Mono','Menlo',monospace; letter-spacing: 0.2px; font-weight: 400; }

    @media (max-width: 1000px) {
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
      .grid-secondary { grid-template-columns: repeat(2, 1fr); }
      .scroll-area { padding-bottom: 340px; }
    }
    @media (max-width: 600px) {
      .grid-primary { grid-template-columns: 1fr; }
      .grid-secondary { grid-template-columns: 1fr; }
      .metrics-grid { grid-template-columns: 1fr 1fr; }
      .scroll-area { padding-bottom: 400px; }
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
  description: 'V-JEPA 2 World Model Dashboard v8'
});
