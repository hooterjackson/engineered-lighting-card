/**
 * Engineered Lighting Card v7
 * V-JEPA 2 World Model Dashboard
 *
 * Design: Liquid glass · Monochrome · Zero flicker
 * Double-buffered snapshots. Bounding boxes enabled.
 * Large primary feeds → Metrics cards → Secondary feeds below fold.
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
    // Flicker prevention caches
    this._prevDetect = {};
    this._prevScores = {};
    this._prevStatus = {};
    this._imgSlot = {}; // tracks which img buffer is active: 0 or 1
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
        { name: 'living_room', entity: 'camera.living_room', label: 'Living Room', primary: true },
        { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room', primary: true },
        { name: 'kitchen', entity: 'camera.kitchen', label: 'Kitchen', primary: false },
        { name: 'back_door', entity: 'camera.back_door', label: 'Back Door', primary: false },
        { name: 'driveway', entity: 'camera.driveway', label: 'Driveway', primary: false },
      ],
      frigate_url: c.frigate_url || 'http://192.168.175.114:5000',
      ...c,
    };
  }

  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() {
    return { cameras: [
      { name: 'living_room', entity: 'camera.living_room', label: 'Living Room', primary: true },
      { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room', primary: true },
      { name: 'kitchen', entity: 'camera.kitchen', label: 'Kitchen', primary: false },
      { name: 'back_door', entity: 'camera.back_door', label: 'Back Door', primary: false },
      { name: 'driveway', entity: 'camera.driveway', label: 'Driveway', primary: false },
    ]};
  }

  getCardSize() { return 28; }

  disconnectedCallback() {
    this._timers.forEach(t => clearInterval(t));
    this._timers = [];
  }

  /* ────────────────────────────────────────
   * Snapshot URLs — bounding boxes enabled
   * ──────────────────────────────────────── */
  _snapUrl(cam) {
    if (this._failedCams.has(cam.name)) return this._snapUrlHA(cam);
    return `${this._config.frigate_url}/api/${cam.name}/latest.jpg?bbox=1&h=720&ts=${Date.now()}`;
  }
  _snapUrlHA(cam) {
    if (!this._hass) return '';
    const s = this._hass.states[cam.entity];
    if (!s) return '';
    return `/api/camera_proxy/${cam.entity}?token=${s.attributes.access_token}&ts=${Date.now()}`;
  }

  /* ────────────────────────────────────────
   * Data helpers
   * ──────────────────────────────────────── */
  _getDetectedObjects(camName) {
    const objects = ['person','dog','cat','bottle','cup','bowl','chair','couch','dining_table','cell_phone','laptop','tv','book','remote','potted_plant','oven','backpack','handbag','suitcase','clock','car','truck','bicycle','motorcycle'];
    return objects.filter(obj => {
      let s = this._hass?.states[`binary_sensor.${camName}_${obj}_occupancy`];
      if (s && s.state === 'on') return true;
      s = this._hass?.states[`binary_sensor.whole_${camName}_${obj}_occupancy`];
      return s && s.state === 'on';
    });
  }
  _getDetectedSounds(camName) {
    const sounds = ['speech','music','bark','baby_crying','alarm','doorbell','fire_alarm','glass_breaking','knock','yelling'];
    return sounds.filter(snd => {
      const s = this._hass?.states[`binary_sensor.${camName}_${snd}_sound`];
      return s && s.state === 'on';
    });
  }
  _getObjectLabel(obj) {
    const m = { person:'Person',dog:'Dog',cat:'Cat',bottle:'Bottle',cup:'Cup',bowl:'Bowl',chair:'Chair',couch:'Couch',dining_table:'Table',cell_phone:'Phone',laptop:'Laptop',tv:'TV',book:'Book',remote:'Remote',potted_plant:'Plant',oven:'Oven',backpack:'Backpack',handbag:'Bag',suitcase:'Suitcase',clock:'Clock',car:'Car',truck:'Truck',bicycle:'Bike',motorcycle:'Moto' };
    return m[obj] || obj.replace(/_/g, ' ');
  }
  _getSoundLabel(snd) { return snd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
  _isMotionDetected(camName) { const s = this._hass?.states[`binary_sensor.${camName}_motion`]; return s && s.state === 'on'; }
  _getSwitch(camName, type) { const s = this._hass?.states[`switch.${camName}_${type}`]; return s ? s.state === 'on' : false; }

  /* ────────────────────────────────────────
   * V-JEPA 2 Activity
   * ──────────────────────────────────────── */
  _getActivity(camName) {
    const s = this._hass?.states[`sensor.${camName}_activity`];
    if (!s || s.state === 'unknown' || s.state === 'unavailable') return null;
    const a = s.attributes || {};
    const actObj = (typeof a.activity === 'object' && a.activity !== null) ? a.activity : null;
    return {
      state: s.state,
      activity: actObj ? actObj.activity : (a.activity || s.state),
      confidence: actObj ? actObj.activity_confidence : (a.activity_confidence || a.confidence || null),
      secondary: actObj ? actObj.secondary_activity : (a.secondary_activity || null),
      secondaryConf: actObj ? actObj.secondary_confidence : (a.secondary_confidence || 0),
      activityScores: actObj ? actObj.activity_scores : (a.activity_scores || null),
      embed_change: a.embed_change !== undefined ? parseFloat(a.embed_change) : null,
      motion_level: a.motion_level !== undefined ? parseFloat(a.motion_level) : null,
      trend: a.trend !== undefined ? parseFloat(a.trend) : null,
      person_detected: !!a.person_detected,
      timestamp: a.timestamp || null,
    };
  }
  _isVjepaInferring(camName) {
    const act = this._getActivity(camName);
    if (!act) return false;
    return act.person_detected || (act.motion_level !== null && act.motion_level > 0.01);
  }
  _activityLabel(state) {
    if (!state || state === 'idle' || state === 'Empty' || state === 'unknown') return null;
    return state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  _formatTime(iso) {
    if (!iso) return '';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 5) return 'now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }
  _tempClass(t) { return t > 80 ? 'temp-hot' : t > 60 ? 'temp-warm' : ''; }

  /* ────────────────────────────────────────
   * Render (one-time DOM build)
   * ──────────────────────────────────────── */
  _render() {
    const cams = this._config.cameras;
    const labelOverrides = { 'living_room': 'Driveway', 'driveway': 'Living Room' };
    const primary = cams.filter(c => c.primary !== false && (c.name === 'living_room' || c.name === 'dining_room'));
    const secondary = cams.filter(c => !primary.includes(c));

    const camHTML = (cam, cls) => {
      const dl = labelOverrides[cam.name] || cam.label;
      return `
      <div class="cam-cell ${cls}" id="cell-${cam.name}">
        <div class="cam-vp">
          <!-- Double-buffered images: two layers, swap on load -->
          <img class="cam-img cam-img-a" id="img-a-${cam.name}" alt="${dl}" />
          <img class="cam-img cam-img-b" id="img-b-${cam.name}" alt="${dl}" style="opacity:0" />

          <!-- Overlays: all absolutely positioned over the image -->
          <div class="ov-top">
            <span class="ov-label">${dl}</span>
            <span class="ov-pipeline" id="pipe-${cam.name}" title="V-JEPA 2 inference">
              <span class="pipe-dot"></span>
              <span class="pipe-text">V-JEPA</span>
            </span>
            <span class="ov-status" id="status-${cam.name}">Idle</span>
          </div>

          <div class="ov-detect" id="detect-${cam.name}"></div>

          <!-- V-JEPA 2 activity context panel -->
          <div class="ov-activity" id="act-${cam.name}">
            <div class="act-main">
              <span class="act-name" id="act-name-${cam.name}"></span>
              <span class="act-conf" id="act-conf-${cam.name}"></span>
              <span class="act-ts" id="act-ts-${cam.name}"></span>
            </div>
            <div class="act-sec" id="act-sec-${cam.name}"></div>
            <div class="act-scores" id="act-scores-${cam.name}"></div>
          </div>

          <!-- Bottom data bar: embed/motion/trend + Frigate fps -->
          <div class="ov-data" id="data-${cam.name}">
            <span class="od"><span class="od-l">Embed</span><span class="od-v" id="od-embed-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Motion</span><span class="od-v" id="od-motion-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Trend</span><span class="od-v" id="od-trend-${cam.name}">—</span></span>
            <span class="od od-sep"></span>
            <span class="od"><span class="od-l">FPS</span><span class="od-v" id="od-fps-${cam.name}">—</span></span>
            <span class="od"><span class="od-l">Det/s</span><span class="od-v" id="od-dps-${cam.name}">—</span></span>
          </div>
        </div>
      </div>`;
    };

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

          <!-- Primary feeds: Living Room + Dining Room (large) -->
          <div class="grid-primary">
            ${primary.map(c => camHTML(c, 'cam-lg')).join('')}
          </div>

          <!-- Metrics: glass cards, no dark background -->
          <div class="metrics">
            <!-- Frigate NVR -->
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
            <!-- Coral TPU -->
            <div class="mc">
              <div class="mc-hdr"><span class="mc-t">Coral TPU</span><span class="mc-badge" id="mc-coral-b">—</span></div>
              <div class="mc-body">
                <div class="mc-r"><span class="mc-l">Inference</span><span class="mc-v" id="mc-coral-spd">—</span></div>
                <div class="mc-r"><span class="mc-l">Temp</span><span class="mc-v" id="mc-coral-tmp">—</span></div>
                <div class="mc-r"><span class="mc-l">PID</span><span class="mc-v" id="mc-coral-pid">—</span></div>
              </div>
            </div>
            <!-- Jetson Orin Nano -->
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
            <!-- V-JEPA 2 -->
            <div class="mc mc-accent">
              <div class="mc-hdr"><span class="mc-t">V-JEPA 2</span><span class="mc-badge" id="mc-vj-b">—</span></div>
              <div class="mc-body">
                <div class="mc-r"><span class="mc-l">Status</span><span class="mc-v" id="mc-vj-st">—</span></div>
                <div class="mc-r"><span class="mc-l">FPS</span><span class="mc-v" id="mc-vj-fps">—</span></div>
                <div class="mc-r"><span class="mc-l">Latency</span><span class="mc-v" id="mc-vj-lat">—</span></div>
                <div class="mc-r"><span class="mc-l">Frames</span><span class="mc-v" id="mc-vj-frm">—</span></div>
                <div class="mc-r"><span class="mc-l">Active Cams</span><span class="mc-v" id="mc-vj-cam">—</span></div>
                <div class="mc-r"><span class="mc-l">Inferring</span><span class="mc-v" id="mc-vj-inf">—</span></div>
                <div class="mc-r mc-r-model"><span class="mc-model" id="mc-vj-mdl">ViT-L · FP16 · CUDA</span></div>
              </div>
            </div>
          </div>

          <!-- Secondary feeds: Kitchen, Back Door, Driveway (below fold) -->
          <div class="grid-secondary">
            ${secondary.map(c => camHTML(c, 'cam-sm')).join('')}
          </div>
        </div>
      </div>
    `;
    // Initialize double-buffer state
    this._config.cameras.forEach(cam => { this._imgSlot[cam.name] = 'a'; });
  }

  /* ────────────────────────────────────────
   * Polling: double-buffered snapshot swap
   * ──────────────────────────────────────── */
  _poll() {
    const t1 = setInterval(() => this._refreshSnapshots(), 2000);
    const t2 = setInterval(() => this._fetchFrigate(), 5000);
    this._timers.push(t1, t2);
    // Initial load — just set img-a src directly
    this._config.cameras.forEach(cam => {
      const imgA = this.shadowRoot.getElementById(`img-a-${cam.name}`);
      if (imgA) {
        imgA.src = this._snapUrl(cam);
        imgA.onerror = () => {
          if (!this._failedCams.has(cam.name)) {
            this._failedCams.add(cam.name);
            imgA.src = this._snapUrlHA(cam);
          }
        };
      }
    });
    this._fetchFrigate();
  }

  _refreshSnapshots() {
    this._config.cameras.forEach(cam => {
      const active = this._imgSlot[cam.name] || 'a';
      const next = active === 'a' ? 'b' : 'a';
      const activeImg = this.shadowRoot.getElementById(`img-${active}-${cam.name}`);
      const nextImg = this.shadowRoot.getElementById(`img-${next}-${cam.name}`);
      if (!activeImg || !nextImg) return;

      const url = this._snapUrl(cam);
      // Pre-load into the hidden buffer
      nextImg.onload = () => {
        // Swap: show next, hide active
        nextImg.style.opacity = '1';
        activeImg.style.opacity = '0';
        this._imgSlot[cam.name] = next;
      };
      nextImg.onerror = () => {
        if (!this._failedCams.has(cam.name)) {
          this._failedCams.add(cam.name);
          nextImg.src = this._snapUrlHA(cam);
        }
      };
      nextImg.src = url;
    });
  }

  async _fetchFrigate() {
    // Try ingress signed path first, then direct, then callApi
    if (this._hass) {
      // Method 1: signed ingress path
      try {
        const signed = await this._hass.callWS({ type: 'auth/sign_path', path: '/api/hassio/ingress/ccab4aaf_frigate-fa/api/stats' });
        if (signed?.path) {
          const r = await fetch(signed.path, { credentials: 'same-origin' });
          if (r.ok) { this._frigateStats = await r.json(); return; }
        }
      } catch(e) {}
      // Method 2: HA proxy with Bearer
      try {
        const token = this._hass.auth?.data?.access_token;
        if (token) {
          const r = await fetch('/api/frigate/stats', { headers: { 'Authorization': 'Bearer ' + token } });
          if (r.ok) { this._frigateStats = await r.json(); return; }
        }
      } catch(e) {}
      // Method 3: callApi
      try {
        if (this._hass.callApi) {
          const d = await this._hass.callApi('GET', 'frigate/stats');
          if (d) { this._frigateStats = d; return; }
        }
      } catch(e) {}
    }
    // Method 4: direct fetch (may fail CORS)
    try {
      const r = await fetch(this._config.frigate_url + '/api/stats');
      if (r.ok) this._frigateStats = await r.json();
    } catch(e) {}
  }

  /* ────────────────────────────────────────
   * Update (diff-based, zero innerHTML except
   * detection pills and activity scores on key change)
   * ──────────────────────────────────────── */
  _update() {
    if (!this._hass) return;
    let totalObj = 0;
    this._config.cameras.forEach(cam => { totalObj += this._updateCam(cam); });
    this._updateMetrics();

    const oe = this.shadowRoot.getElementById('hdr-obj');
    if (oe) this._setText(oe, String(totalObj));

    // Status pill
    const vst = this._hass.states['sensor.v_jepa_2_status'];
    const pill = this.shadowRoot.getElementById('pill');
    if (pill) {
      const on = vst?.state === 'running';
      const html = `<span class="pill-dot${on ? '' : ' off'}"></span>${on ? 'Active' : 'Offline'}`;
      if (pill.innerHTML !== html) {
        pill.innerHTML = html;
        pill.className = on ? 'pill' : 'pill pill-off';
      }
    }
  }

  // Helper: only set textContent if changed (prevents reflow/flicker)
  _setText(el, val) { if (el && el.textContent !== val) el.textContent = val; }

  _updateCam(cam) {
    const $ = id => this.shadowRoot.getElementById(id);
    const act = this._getActivity(cam.name);
    const fStats = this._frigateStats?.cameras?.[cam.name];
    const inferring = this._isVjepaInferring(cam.name);

    // ── Pipeline indicator ──
    const pipe = $(`pipe-${cam.name}`);
    if (pipe) {
      const cls = inferring ? 'ov-pipeline pipe-on' : 'ov-pipeline';
      if (pipe.className !== cls) pipe.className = cls;
    }

    // ── Status badge ──
    const stEl = $(`status-${cam.name}`);
    if (stEl) {
      let txt, cls;
      if (act && act.person_detected) { txt = 'Person'; cls = 'ov-status ov-s-person'; }
      else if (this._isMotionDetected(cam.name)) { txt = 'Motion'; cls = 'ov-status ov-s-motion'; }
      else { txt = 'Idle'; cls = 'ov-status'; }
      this._setText(stEl, txt);
      if (stEl.className !== cls) stEl.className = cls;
    }

    // ── V-JEPA 2 Activity Context ──
    const actPanel = $(`act-${cam.name}`);
    const actName = $(`act-name-${cam.name}`);
    const actConf = $(`act-conf-${cam.name}`);
    const actTs = $(`act-ts-${cam.name}`);
    const actSec = $(`act-sec-${cam.name}`);
    const actScores = $(`act-scores-${cam.name}`);

    if (act && act.person_detected) {
      if (actPanel && !actPanel.classList.contains('act-on')) actPanel.classList.add('act-on');

      const label = this._activityLabel(act.activity) || 'Detected';
      if (actName) { this._setText(actName, label); actName.className = 'act-name act-name-on'; }

      if (actConf) {
        const pct = typeof act.confidence === 'number' ? (act.confidence > 1 ? act.confidence : act.confidence * 100) : 0;
        this._setText(actConf, pct.toFixed(0) + '%');
      }

      if (actTs) this._setText(actTs, this._formatTime(act.timestamp));

      if (actSec) {
        const sec = act.secondary ? this._activityLabel(act.secondary) : null;
        const sv = sec ? `${sec} ${(act.secondaryConf * 100).toFixed(0)}%` : '';
        this._setText(actSec, sv);
      }

      // Activity scores — only rebuild on change
      if (actScores && act.activityScores) {
        const key = JSON.stringify(act.activityScores);
        if (this._prevScores[cam.name] !== key) {
          this._prevScores[cam.name] = key;
          const sorted = Object.entries(act.activityScores).sort((a, b) => b[1] - a[1]).slice(0, 5);
          const mx = sorted[0]?.[1] || 1;
          let h = '';
          sorted.forEach(([n, s]) => {
            const pct = Math.min(100, (s / mx) * 100);
            h += `<div class="sr"><span class="sr-n">${n.replace(/_/g, ' ')}</span><div class="sr-bar"><div class="sr-fill" style="width:${pct}%"></div></div><span class="sr-v">${(s * 100).toFixed(0)}%</span></div>`;
          });
          actScores.innerHTML = h;
        }
      } else if (actScores && actScores.innerHTML) { actScores.innerHTML = ''; }

    } else {
      if (actPanel && actPanel.classList.contains('act-on')) actPanel.classList.remove('act-on');
      if (actName) { this._setText(actName, ''); actName.className = 'act-name'; }
      if (actConf) this._setText(actConf, '');
      if (actTs) this._setText(actTs, '');
      if (actSec) this._setText(actSec, '');
      if (actScores && actScores.innerHTML) actScores.innerHTML = '';
    }

    // ── Bottom data bar on feed ──
    const embedEl = $(`od-embed-${cam.name}`);
    const motionEl = $(`od-motion-${cam.name}`);
    const trendEl = $(`od-trend-${cam.name}`);
    const fpsEl = $(`od-fps-${cam.name}`);
    const dpsEl = $(`od-dps-${cam.name}`);

    if (act) {
      if (embedEl) this._setText(embedEl, act.embed_change !== null ? act.embed_change.toFixed(4) : '—');
      if (motionEl) this._setText(motionEl, act.motion_level !== null ? act.motion_level.toFixed(4) : '—');
      if (trendEl) {
        const arrow = act.trend !== null ? (act.trend > 0.001 ? '↑' : act.trend < -0.001 ? '↓' : '→') : '';
        this._setText(trendEl, act.trend !== null ? act.trend.toFixed(4) + arrow : '—');
      }
    }
    if (fStats) {
      if (fpsEl) this._setText(fpsEl, (fStats.camera_fps || 0).toFixed(0));
      if (dpsEl) this._setText(dpsEl, (fStats.detection_fps || 0).toFixed(1));
    }

    // ── Data bar visibility ──
    const dataBar = $(`data-${cam.name}`);
    if (dataBar) dataBar.style.opacity = (act && act.person_detected) || inferring ? '1' : '0.4';

    // ── Detection pills (key-based diff) ──
    const objects = this._getDetectedObjects(cam.name);
    const sounds = this._getDetectedSounds(cam.name);
    const dEl = $(`detect-${cam.name}`);
    if (dEl) {
      const key = objects.join(',') + '|' + sounds.join(',');
      if (this._prevDetect[cam.name] !== key) {
        this._prevDetect[cam.name] = key;
        let h = '';
        objects.forEach(o => { h += `<span class="dp">${this._getObjectLabel(o)}</span>`; });
        sounds.forEach(s => { h += `<span class="dp dp-snd">${this._getSoundLabel(s)}</span>`; });
        dEl.innerHTML = h;
      }
    }

    return objects.length;
  }

  _updateMetrics() {
    const h = this._hass;
    if (!h) return;
    const $ = id => this.shadowRoot.getElementById(id);
    const bar = (id, pct) => { const b = $(id); if (b) b.style.width = Math.min(100, pct || 0) + '%'; };
    const sv = (id, v) => { const e = $(id); if (e) this._setText(e, String(v)); };

    // ── Frigate ──
    const st = this._frigateStats;
    if (st && st.service) {
      const up = st.service.uptime || 0;
      const hrs = Math.floor(up / 3600); const min = Math.floor((up % 3600) / 60);
      sv('mc-fri-up', hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
      const be = $('mc-fri-b'); if (be) { be.textContent = 'Online'; be.className = 'mc-badge badge-on'; }
    }
    if (st && st.cpu_usages) {
      const fs = st.cpu_usages['frigate.full_system'];
      if (fs) {
        sv('mc-fri-cpu', (fs.cpu || 0) + '%'); bar('mc-fri-cpu-bar', fs.cpu);
        sv('mc-fri-mem', (fs.mem || 0) + '%'); bar('mc-fri-mem-bar', fs.mem);
      }
    }
    let dc = 0, mc = 0;
    this._config.cameras.forEach(cam => {
      if (this._getSwitch(cam.name, 'detect')) dc++;
      if (this._getSwitch(cam.name, 'motion')) mc++;
    });
    sv('mc-fri-det', `${dc}/5 cams`);
    sv('mc-fri-mot', `${mc}/5 cams`);

    // ── Coral TPU ──
    if (st && st.detectors) {
      const det = Object.values(st.detectors)[0];
      if (det) {
        sv('mc-coral-spd', (det.inference_speed || 0).toFixed(1) + ' ms');
        sv('mc-coral-pid', String(det.pid || '—'));
        const be = $('mc-coral-b'); if (be) { be.textContent = 'Online'; be.className = 'mc-badge badge-on'; }
      }
    }
    if (st && st.temperatures) {
      const temp = st.temperatures.apex_0 || Object.values(st.temperatures)[0];
      if (temp !== undefined) {
        const te = $('mc-coral-tmp');
        if (te) { te.textContent = temp.toFixed(1) + '°C'; te.className = 'mc-v ' + this._tempClass(temp); }
      }
    }

    // ── Jetson ──
    let jOn = false;
    [['sensor.jetson_cpu_usage','mc-jet-cpu','mc-jet-cpu-bar'],['sensor.jetson_gpu_usage','mc-jet-gpu','mc-jet-gpu-bar']].forEach(([sid,vid,bid]) => {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        jOn = true; const v = parseFloat(s.state) || 0;
        sv(vid, v.toFixed(1) + '%'); bar(bid, v);
      }
    });
    const jr = h.states['sensor.jetson_ram_usage'];
    if (jr && jr.state !== 'unavailable' && jr.state !== 'unknown') {
      jOn = true; const pct = parseFloat(jr.state) || 0;
      const a = jr.attributes || {};
      sv('mc-jet-ram', `${a.ram_used_mb ? (a.ram_used_mb/1024).toFixed(1) : '?'}/${a.ram_total_mb ? (a.ram_total_mb/1024).toFixed(1) : '?'} GB`);
      bar('mc-jet-ram-bar', pct);
    }
    [['sensor.jetson_cpu_temp','mc-jet-ct'],['sensor.jetson_gpu_temp','mc-jet-gt']].forEach(([sid,eid]) => {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        jOn = true;
        const e = $(eid); if (e) { e.textContent = s.state + '°C'; e.className = 'mc-v ' + this._tempClass(parseFloat(s.state)); }
      } else { sv(eid, '—'); }
    });
    const jb = $('mc-jet-b');
    if (jb) { jb.textContent = jOn ? 'Online' : 'Offline'; jb.className = jOn ? 'mc-badge badge-on' : 'mc-badge badge-off'; }

    // ── V-JEPA 2 ──
    const vMap = { 'sensor.v_jepa_2_status':'mc-vj-st', 'sensor.v_jepa_2_fps':'mc-vj-fps', 'sensor.v_jepa_2_inference_latency':'mc-vj-lat', 'sensor.v_jepa_2_frames_processed':'mc-vj-frm', 'sensor.v_jepa_2_active_cameras':'mc-vj-cam' };
    let vjOn = false;
    for (const [sid, eid] of Object.entries(vMap)) {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        vjOn = true; let v = s.state;
        if (sid.includes('fps')) v = parseFloat(v).toFixed(1) + ' fps';
        else if (sid.includes('latency')) v = parseFloat(v).toFixed(0) + ' ms';
        else if (sid.includes('frames')) v = parseInt(v).toLocaleString();
        else if (sid.includes('active')) v += '/5 cams';
        sv(eid, v);
      }
    }
    let ic = 0;
    this._config.cameras.forEach(cam => { if (this._isVjepaInferring(cam.name)) ic++; });
    sv('mc-vj-inf', `${ic}/5 cams`);

    const vjb = $('mc-vj-b');
    if (vjb) { vjb.textContent = vjOn ? 'Online' : 'Offline'; vjb.className = vjOn ? 'mc-badge badge-on' : 'mc-badge badge-off'; }

    const vStatus = h.states['sensor.v_jepa_2_status'];
    const mdl = $('mc-vj-mdl');
    if (mdl && vStatus?.attributes) {
      const t = `${vStatus.attributes.model || 'ViT-L'} · ${vStatus.attributes.precision || 'FP16'} · CUDA`;
      this._setText(mdl, t);
    }
  }

  /* ────────────────────────────────────────
   * CSS: Liquid glass · Monochrome · No color
   * ──────────────────────────────────────── */
  _css() {
    return `
    :host {
      --bg: #000;
      --g1: rgba(255,255,255,0.04);
      --g2: rgba(255,255,255,0.07);
      --g3: rgba(255,255,255,0.10);
      --t1: rgba(255,255,255,0.92);
      --t2: rgba(255,255,255,0.55);
      --t3: rgba(255,255,255,0.32);
      --t4: rgba(255,255,255,0.18);
      --r: 14px;
      --rs: 10px;
      --ease: cubic-bezier(.25,.1,.25,1);
      --blur: blur(24px);
      --blurs: blur(16px);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .el-root {
      background: var(--bg);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif;
      color: var(--t1);
      -webkit-font-smoothing: antialiased;
      height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    }

    /* ── Header ── */
    .hdr {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px;
      background: var(--g1); backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
      border-bottom: 1px solid var(--g2); flex-shrink: 0; z-index: 10;
    }
    .hdr-l { display: flex; flex-direction: column; gap: 1px; }
    .hdr-r { display: flex; align-items: center; gap: 18px; }
    .hdr-title { font-size: 15px; font-weight: 700; letter-spacing: -0.03em; }
    .hdr-sub { font-size: 9px; color: var(--t4); text-transform: uppercase; letter-spacing: 0.05em; }
    .hdr-stat { display: flex; flex-direction: column; align-items: center; }
    .hdr-sv { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .hdr-sl { font-size: 8px; font-weight: 600; color: var(--t4); text-transform: uppercase; letter-spacing: 0.8px; }
    .pill {
      display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 100px;
      background: var(--g1); border: 1px solid var(--g2); font-size: 10px; font-weight: 600; color: var(--t2);
    }
    .pill.pill-off { color: var(--t4); }
    .pill-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--t2); animation: pulse 2.5s ease-in-out infinite; }
    .pill-dot.off { background: var(--t4); animation: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.2} }

    /* ── Scroll Area ── */
    .scroll-area {
      flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px 10px 20px;
      -webkit-overflow-scrolling: touch;
    }
    .scroll-area::-webkit-scrollbar { width: 3px; }
    .scroll-area::-webkit-scrollbar-track { background: transparent; }
    .scroll-area::-webkit-scrollbar-thumb { background: var(--g2); border-radius: 3px; }

    /* ── Camera Grids ── */
    .grid-primary { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
    .grid-secondary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }

    .cam-vp {
      position: relative; background: var(--g1); border-radius: var(--r); overflow: hidden;
      aspect-ratio: 16/9; border: 1px solid var(--g2);
    }
    .cam-img {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      object-fit: cover; display: block;
      transition: opacity 0.3s var(--ease);
    }

    /* ── Camera Overlays ── */
    .ov-top {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 6px;
      padding: 7px 10px; z-index: 5;
      background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%);
    }
    .ov-label {
      font-size: 11px; font-weight: 700; letter-spacing: -0.01em;
      text-shadow: 0 1px 6px rgba(0,0,0,1);
    }

    /* V-JEPA pipeline indicator */
    .ov-pipeline {
      display: flex; align-items: center; gap: 3px;
      opacity: 0; transition: opacity 0.4s var(--ease);
    }
    .ov-pipeline.pipe-on { opacity: 1; }
    .pipe-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--t2); animation: pulse 1.5s ease-in-out infinite; }
    .pipe-text { font-size: 8px; font-weight: 700; color: var(--t3); text-transform: uppercase; letter-spacing: 0.5px; }

    .ov-status {
      margin-left: auto; font-size: 9px; font-weight: 600;
      padding: 2px 7px; border-radius: 100px;
      background: rgba(255,255,255,0.06); backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
      color: var(--t4);
    }
    .ov-s-person { background: rgba(255,255,255,0.14); color: var(--t1); }
    .ov-s-motion { background: rgba(255,255,255,0.08); color: var(--t2); }

    /* Detection pills */
    .ov-detect {
      position: absolute; top: 28px; left: 0; right: 0; z-index: 4; pointer-events: none;
      display: flex; flex-wrap: wrap; gap: 3px; padding: 3px 8px;
    }
    .dp {
      padding: 2px 6px; border-radius: 100px; font-size: 9px; font-weight: 600;
      background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.12); color: var(--t2);
      backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
    }
    .dp-snd { font-style: italic; }

    /* V-JEPA Activity panel on feed */
    .ov-activity {
      position: absolute; bottom: 22px; left: 0; right: 0;
      padding: 6px 10px; z-index: 5;
      opacity: 0.3; transition: opacity 0.4s var(--ease);
    }
    .ov-activity.act-on { opacity: 1; }
    .act-main { display: flex; align-items: baseline; gap: 5px; }
    .act-name { font-size: 12px; font-weight: 700; color: var(--t3); transition: color 0.3s var(--ease); text-shadow: 0 1px 6px rgba(0,0,0,1); }
    .act-name-on { color: var(--t1); }
    .act-conf { font-size: 10px; font-weight: 700; color: var(--t2); font-variant-numeric: tabular-nums; text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
    .act-ts { font-size: 8px; color: var(--t4); margin-left: auto; font-variant-numeric: tabular-nums; text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
    .act-sec { font-size: 9px; color: var(--t3); min-height: 11px; text-shadow: 0 1px 4px rgba(0,0,0,0.8); }

    /* Activity score bars */
    .act-scores { display: flex; flex-direction: column; gap: 1px; padding: 2px 0; }
    .sr { display: flex; align-items: center; gap: 3px; }
    .sr-n { font-size: 7px; font-weight: 500; color: var(--t4); width: 38px; flex-shrink: 0; text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
    .sr-bar { flex: 1; height: 2px; border-radius: 1px; background: rgba(255,255,255,0.06); overflow: hidden; }
    .sr-fill { height: 100%; border-radius: 1px; background: rgba(255,255,255,0.40); transition: width 0.4s var(--ease); }
    .sr-v { font-size: 7px; font-weight: 600; color: var(--t3); font-variant-numeric: tabular-nums; width: 20px; text-align: right; flex-shrink: 0; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }

    /* Bottom data bar on each feed */
    .ov-data {
      position: absolute; bottom: 0; left: 0; right: 0; z-index: 5;
      display: flex; align-items: center; gap: 8px;
      padding: 4px 10px;
      background: rgba(0,0,0,0.65);
      backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
      transition: opacity 0.4s var(--ease);
    }
    .od { display: flex; align-items: center; gap: 2px; }
    .od-l { font-size: 7px; font-weight: 600; color: var(--t4); text-transform: uppercase; letter-spacing: 0.3px; }
    .od-v { font-size: 8px; font-weight: 600; font-family: 'SF Mono','Menlo',monospace; color: var(--t3); font-variant-numeric: tabular-nums; }
    .od-sep { width: 1px; height: 10px; background: var(--g2); margin: 0 2px; }

    /* ── Metrics Cards: glass only, no dark backdrop ── */
    .metrics {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
      padding: 4px 0;
    }
    .mc {
      background: var(--g1); border: 1px solid var(--g2); border-radius: var(--r);
      padding: 14px 16px;
      backdrop-filter: var(--blurs); -webkit-backdrop-filter: var(--blurs);
      transition: border-color 0.3s var(--ease);
    }
    .mc:hover { border-color: var(--g3); }
    .mc-accent { border-color: rgba(255,255,255,0.12); }

    .mc-hdr { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    .mc-t { font-size: 11px; font-weight: 700; flex: 1; letter-spacing: -0.01em; color: var(--t2); }
    .mc-badge { font-size: 8px; font-weight: 700; padding: 2px 8px; border-radius: 100px; background: var(--g1); color: var(--t4); }
    .mc-badge.badge-on { background: rgba(255,255,255,0.08); color: var(--t1); }
    .mc-badge.badge-off { background: rgba(255,255,255,0.04); color: var(--t4); }

    .mc-body { display: flex; flex-direction: column; gap: 6px; }
    .mc-r { display: flex; align-items: center; gap: 8px; }
    .mc-r-model { margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--g2); }
    .mc-l { font-size: 10px; color: var(--t4); width: 56px; flex-shrink: 0; font-weight: 500; }
    .mc-bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.04); overflow: hidden; }
    .mc-fill { height: 100%; border-radius: 2px; transition: width 0.6s var(--ease); width: 0%; background: rgba(255,255,255,0.35); }
    .mc-v { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--t2); min-width: 56px; text-align: right; }
    .mc-v.temp-warm { color: var(--t1); }
    .mc-v.temp-hot { color: var(--t1); font-weight: 800; }
    .mc-model { font-size: 9px; color: var(--t4); font-family: 'SF Mono','Menlo',monospace; letter-spacing: 0.2px; }

    /* ── Responsive ── */
    @media (max-width: 1000px) {
      .metrics { grid-template-columns: repeat(2, 1fr); }
      .grid-secondary { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 600px) {
      .grid-primary { grid-template-columns: 1fr; }
      .grid-secondary { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
      .scroll-area { padding: 6px; }
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
  description: 'V-JEPA 2 World Model Dashboard v7'
});
