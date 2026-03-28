/**
 * Engineered Lighting Card v3
 * V-JEPA 2 World Model Dashboard
 *
 * Design philosophy: Every pixel earns its place.
 * Five large camera feeds. Context overlaid where it matters.
 * The pipeline is the product.
 */

class EngineeredLightingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._timers = [];
    this._frigateStats = {};
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this.shadowRoot.querySelector('.root')) this._render();
    this._update();
    if (first) this._poll();
  }

  setConfig(c) {
    this._config = {
      cameras: c.cameras || [
        { name: 'living_room', entity: 'camera.living_room', label: 'Living Room' },
        { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room' },
        { name: 'kitchen', entity: 'camera.kitchen', label: 'Kitchen' },
        { name: 'back_door', entity: 'camera.back_door', label: 'Back Door' },
        { name: 'driveway', entity: 'camera.driveway', label: 'Driveway' }
      ],
      frigate_url: c.frigate_url || 'http://192.168.175.114:5000',
      ...c
    };
  }

  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() {
    return { cameras: [
      { name: 'living_room', entity: 'camera.living_room', label: 'Living Room' },
      { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room' },
      { name: 'kitchen', entity: 'camera.kitchen', label: 'Kitchen' },
      { name: 'back_door', entity: 'camera.back_door', label: 'Back Door' },
      { name: 'driveway', entity: 'camera.driveway', label: 'Driveway' }
    ]};
  }
  getCardSize() { return 20; }

  disconnectedCallback() {
    this._timers.forEach(t => clearInterval(t));
    this._timers = [];
  }

  // ── Camera URL (authenticated via HA access_token) ──

  _snapUrl(entity) {
    if (!this._hass) return '';
    const s = this._hass.states[entity];
    if (!s) return '';
    return `/api/camera_proxy/${entity}?token=${s.attributes.access_token}&ts=${Date.now()}`;
  }

  // ── Render ──

  _render() {
    const cams = this._config.cameras;
    this.shadowRoot.innerHTML = `
<style>${this._css()}</style>
<div class="root">
  <!-- Header -->
  <header class="hdr">
    <div class="hdr-left">
      <div class="logo">EL</div>
      <div><div class="hdr-title">Engineered Lighting</div><div class="hdr-sub">V-JEPA 2 World Model</div></div>
    </div>
    <div class="hdr-right">
      <div class="pill-status" id="pill-status"><span class="dot-pulse"></span>Active</div>
    </div>
  </header>

  <!-- Camera Grid: 3 top + 2 bottom -->
  <div class="cam-grid">
    ${cams.map((cam, i) => `
    <div class="cam-cell" id="cell-${cam.name}">
      <div class="cam-viewport">
        <img class="cam-img" id="img-${cam.name}" alt="${cam.label}" />

        <!-- Top overlay: camera name + live badge -->
        <div class="ov-top">
          <span class="ov-label">${cam.label}</span>
          <span class="ov-live"><span class="ov-live-dot"></span>LIVE</span>
          <span class="ov-fps" id="fps-${cam.name}"></span>
        </div>

        <!-- Frigate detection overlay (bounding box + label) -->
        <div class="ov-detect" id="detect-${cam.name}"></div>

        <!-- Bottom overlay: V-JEPA 2 context -->
        <div class="ov-bottom">
          <div class="ov-ctx" id="ctx-${cam.name}">
            <div class="ctx-vjepa">
              <span class="ctx-icon" id="vjepa-icon-${cam.name}">○</span>
              <span class="ctx-tag vjepa-tag">V-JEPA 2</span>
              <span class="ctx-val" id="activity-${cam.name}">—</span>
              <span class="ctx-conf" id="conf-${cam.name}"></span>
            </div>
            <div class="ctx-frigate">
              <span class="ctx-tag frigate-tag">Frigate</span>
              <span class="ctx-val" id="frigate-${cam.name}">—</span>
            </div>
          </div>
          <div class="ov-motion">
            <div class="motion-fill" id="motion-${cam.name}"></div>
          </div>
        </div>
      </div>

      <!-- Pipeline indicator bar (below video) -->
      <div class="pipeline-bar" id="pipe-${cam.name}">
        <div class="pipe-stage">
          <span class="pipe-dot cam-dot on"></span>
          <span class="pipe-label">Camera</span>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-stage">
          <span class="pipe-dot go2rtc-dot on"></span>
          <span class="pipe-label">go2rtc</span>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-stage">
          <span class="pipe-dot frigate-dot" id="pipe-frigate-${cam.name}"></span>
          <span class="pipe-label">Frigate</span>
          <span class="pipe-detail" id="pipe-frigate-detail-${cam.name}"></span>
        </div>
        <div class="pipe-arrow" id="pipe-arrow-vjepa-${cam.name}">→</div>
        <div class="pipe-stage">
          <span class="pipe-dot vjepa-dot" id="pipe-vjepa-${cam.name}"></span>
          <span class="pipe-label">V-JEPA 2</span>
          <span class="pipe-detail" id="pipe-vjepa-detail-${cam.name}"></span>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-stage">
          <span class="pipe-dot mqtt-dot" id="pipe-mqtt-${cam.name}"></span>
          <span class="pipe-label">MQTT</span>
        </div>
        <div class="pipe-arrow">→</div>
        <div class="pipe-stage">
          <span class="pipe-dot ha-dot on"></span>
          <span class="pipe-label">HA</span>
        </div>
      </div>
    </div>
    `).join('')}
  </div>

  <!-- System Metrics -->
  <div class="metrics-section">
    <div class="metrics-row">
      <!-- Frigate / LattePanda -->
      <div class="m-card">
        <div class="m-hdr"><span class="m-icon frigate-icon">◈</span><span class="m-title">Frigate NVR</span><span class="m-badge" id="m-frigate-badge">—</span></div>
        <div class="m-grid">
          <div class="m-item"><span class="m-label">CPU</span><div class="m-bar"><div class="m-bar-fill cpu-fill" id="m-f-cpu-bar"></div></div><span class="m-val" id="m-f-cpu">—</span></div>
          <div class="m-item"><span class="m-label">Memory</span><div class="m-bar"><div class="m-bar-fill mem-fill" id="m-f-mem-bar"></div></div><span class="m-val" id="m-f-mem">—</span></div>
          <div class="m-item"><span class="m-label">Uptime</span><span class="m-val" id="m-f-uptime">—</span></div>
        </div>
      </div>

      <!-- Coral TPU -->
      <div class="m-card">
        <div class="m-hdr"><span class="m-icon coral-icon">▲</span><span class="m-title">Coral TPU</span><span class="m-badge" id="m-coral-badge">—</span></div>
        <div class="m-grid">
          <div class="m-item"><span class="m-label">Inference</span><span class="m-val" id="m-c-speed">—</span></div>
          <div class="m-item"><span class="m-label">Temperature</span><span class="m-val temp" id="m-c-temp">—</span></div>
          <div class="m-item"><span class="m-label">Detection</span><span class="m-val" id="m-c-detect">—</span></div>
        </div>
      </div>

      <!-- Jetson Orin Nano -->
      <div class="m-card">
        <div class="m-hdr"><span class="m-icon jetson-icon">⬡</span><span class="m-title">Jetson Orin Nano Super</span><span class="m-badge" id="m-jetson-badge">Offline</span></div>
        <div class="m-grid">
          <div class="m-item"><span class="m-label">CPU</span><div class="m-bar"><div class="m-bar-fill cpu-fill" id="m-j-cpu-bar"></div></div><span class="m-val" id="m-j-cpu">—</span></div>
          <div class="m-item"><span class="m-label">GPU</span><div class="m-bar"><div class="m-bar-fill gpu-fill" id="m-j-gpu-bar"></div></div><span class="m-val" id="m-j-gpu">—</span></div>
          <div class="m-item"><span class="m-label">RAM</span><div class="m-bar"><div class="m-bar-fill mem-fill" id="m-j-ram-bar"></div></div><span class="m-val" id="m-j-ram">—</span></div>
          <div class="m-item"><span class="m-label">CPU Temp</span><span class="m-val temp" id="m-j-ctemp">—</span></div>
          <div class="m-item"><span class="m-label">GPU Temp</span><span class="m-val temp" id="m-j-gtemp">—</span></div>
        </div>
      </div>

      <!-- V-JEPA 2 Inference -->
      <div class="m-card">
        <div class="m-hdr"><span class="m-icon vjepa-icon">◉</span><span class="m-title">V-JEPA 2</span><span class="m-badge" id="m-vjepa-badge">Offline</span></div>
        <div class="m-grid">
          <div class="m-item"><span class="m-label">FPS</span><span class="m-val" id="m-v-fps">—</span></div>
          <div class="m-item"><span class="m-label">Latency</span><span class="m-val" id="m-v-latency">—</span></div>
          <div class="m-item"><span class="m-label">Frames</span><span class="m-val" id="m-v-frames">—</span></div>
          <div class="m-item"><span class="m-label">Active Cams</span><span class="m-val" id="m-v-cams">—</span></div>
        </div>
      </div>
    </div>
  </div>
</div>`;

    // Start snapshot refresh
    this._loadAllSnapshots();
  }

  // ── Polling ──

  _poll() {
    const t1 = setInterval(() => this._loadAllSnapshots(), 2000);
    const t2 = setInterval(() => this._fetchFrigate(), 5000);
    this._timers.push(t1, t2);
    this._fetchFrigate();
  }

  _loadAllSnapshots() {
    if (!this._hass) return;
    this._config.cameras.forEach(cam => {
      const img = this.shadowRoot.getElementById(`img-${cam.name}`);
      if (img) img.src = this._snapUrl(cam.entity);
    });
  }

  async _fetchFrigate() {
    try {
      const r = await fetch(this._config.frigate_url + '/api/stats');
      if (r.ok) { this._frigateStats = await r.json(); this._update(); }
    } catch(e) {}
  }

  // ── Update all overlays ──

  _update() {
    if (!this._hass) return;
    this._config.cameras.forEach(cam => this._updateCamera(cam));
    this._updateMetrics();
  }

  _updateCamera(cam) {
    const h = this._hass;
    const $ = id => this.shadowRoot.getElementById(id);

    // ── V-JEPA 2 activity overlay ──
    const actState = h.states[`sensor.${cam.name}_activity`];
    const actEl = $(`activity-${cam.name}`);
    const confEl = $(`conf-${cam.name}`);
    const motionEl = $(`motion-${cam.name}`);
    const vjepaIcon = $(`vjepa-icon-${cam.name}`);

    let personDetected = false;
    let vjepaActive = false;

    if (actState && actState.state !== 'unknown' && actState.state !== 'unavailable') {
      const act = actState.state;
      const a = actState.attributes || {};
      vjepaActive = true;
      personDetected = !!a.person_detected;

      if (actEl) {
        actEl.textContent = this._fmt(act);
        actEl.className = 'ctx-val ' + this._actCls(act);
      }
      if (confEl && a.confidence) {
        const c = parseFloat(a.confidence);
        confEl.textContent = c > 0 ? `${(c*100).toFixed(0)}%` : '';
        confEl.className = 'ctx-conf ' + (c > .8 ? 'conf-hi' : c > .5 ? 'conf-md' : 'conf-lo');
      }
      if (motionEl && a.motion_level !== undefined) {
        const ml = parseFloat(a.motion_level);
        motionEl.style.width = (ml * 100) + '%';
        motionEl.className = 'motion-fill' + (ml > .1 ? ' motion-hi' : ml > .03 ? ' motion-md' : '');
      }
    } else {
      if (actEl) { actEl.textContent = '—'; actEl.className = 'ctx-val'; }
      if (confEl) confEl.textContent = '';
      if (motionEl) { motionEl.style.width = '0%'; motionEl.className = 'motion-fill'; }
    }

    // V-JEPA icon state
    if (vjepaIcon) {
      vjepaIcon.textContent = vjepaActive ? '●' : '○';
      vjepaIcon.className = 'ctx-icon' + (vjepaActive ? ' ctx-icon-active' : '');
    }

    // ── Frigate overlay ──
    const fStats = this._frigateStats.cameras && this._frigateStats.cameras[cam.name];
    const frigEl = $(`frigate-${cam.name}`);
    const fpsEl = $(`fps-${cam.name}`);
    const detectEl = $(`detect-${cam.name}`);

    if (fStats) {
      const fps = fStats.camera_fps || 0;
      const dfps = fStats.detection_fps || 0;

      if (fpsEl) fpsEl.textContent = fps > 0 ? `${fps.toFixed(0)} fps` : '';
      if (frigEl) {
        if (dfps > 0) {
          frigEl.textContent = `${dfps.toFixed(1)} det/s`;
          frigEl.className = 'ctx-val ctx-active';
        } else {
          frigEl.textContent = fStats.detection_enabled ? 'Monitoring' : 'Off';
          frigEl.className = 'ctx-val';
        }
      }

      // Bounding box overlay — show detected objects
      if (detectEl) {
        // Frigate doesn't give us live bounding box coords via stats API,
        // but we can show detected object counts + person indicator
        const pCount = fStats.person || 0;
        const dEnabled = fStats.detection_enabled;
        let html = '';

        if (personDetected || pCount > 0) {
          html += '<div class="detect-box person-box"><span class="detect-label">👤 Person</span></div>';
        }
        // Audio detection
        if (fStats.audio_dBFS !== undefined && fStats.audio_dBFS > -100) {
          html += `<div class="detect-chip audio-chip">🔊 ${fStats.audio_dBFS.toFixed(0)} dBFS</div>`;
        }
        detectEl.innerHTML = html;
      }
    }

    // ── Pipeline indicator ──
    const pipeFrigate = $(`pipe-frigate-${cam.name}`);
    const pipeFrigateDetail = $(`pipe-frigate-detail-${cam.name}`);
    const pipeVjepa = $(`pipe-vjepa-${cam.name}`);
    const pipeVjepaDetail = $(`pipe-vjepa-detail-${cam.name}`);
    const pipeArrowVjepa = $(`pipe-arrow-vjepa-${cam.name}`);
    const pipeMqtt = $(`pipe-mqtt-${cam.name}`);

    const frigateOn = fStats && fStats.detection_enabled;
    if (pipeFrigate) pipeFrigate.className = 'pipe-dot frigate-dot' + (frigateOn ? ' on' : '');
    if (pipeFrigateDetail) {
      const dfps = fStats ? (fStats.detection_fps || 0) : 0;
      pipeFrigateDetail.textContent = frigateOn ? (dfps > 0 ? `${dfps.toFixed(1)} d/s` : 'idle') : '';
    }

    // V-JEPA 2 only fires when person detected
    if (pipeVjepa) pipeVjepa.className = 'pipe-dot vjepa-dot' + (vjepaActive ? ' on pulse' : '');
    if (pipeVjepaDetail) pipeVjepaDetail.textContent = vjepaActive ? 'inferring' : '';
    if (pipeArrowVjepa) pipeArrowVjepa.className = 'pipe-arrow' + (personDetected ? ' arrow-active' : '');
    if (pipeMqtt) pipeMqtt.className = 'pipe-dot mqtt-dot' + (vjepaActive ? ' on' : '');
  }

  _updateMetrics() {
    const h = this._hass;
    const $ = id => this.shadowRoot.getElementById(id);
    const bar = (id, pct) => { const b = $(id); if (b) b.style.width = Math.min(100, pct || 0) + '%'; };

    // ── Frigate ──
    const st = this._frigateStats;
    if (st.service) {
      const up = st.service.uptime || 0;
      const hrs = Math.floor(up / 3600);
      const min = Math.floor((up % 3600) / 60);
      const ue = $('m-f-uptime'); if (ue) ue.textContent = hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
      const be = $('m-frigate-badge'); if (be) { be.textContent = 'Online'; be.className = 'm-badge badge-on'; }
    }
    if (st.cpu_usages) {
      const fs = st.cpu_usages['frigate.full_system'];
      if (fs) {
        const ce = $('m-f-cpu'); if (ce) ce.textContent = (fs.cpu || 0) + '%'; bar('m-f-cpu-bar', fs.cpu);
        const me = $('m-f-mem'); if (me) me.textContent = (fs.mem || 0) + '%'; bar('m-f-mem-bar', fs.mem);
      }
    }

    // ── Coral TPU ──
    if (st.detectors) {
      const det = Object.values(st.detectors)[0];
      if (det) {
        const se = $('m-c-speed'); if (se) se.textContent = (det.inference_speed || 0).toFixed(1) + ' ms';
        const de = $('m-c-detect'); if (de) de.textContent = det.detection_start ? det.detection_start.toFixed(1) + ' ms' : 'Idle';
        const be = $('m-coral-badge'); if (be) { be.textContent = 'Online'; be.className = 'm-badge badge-on'; }
      }
    }
    if (st.temperatures) {
      const temp = st.temperatures.apex_0 || Object.values(st.temperatures)[0];
      if (temp) {
        const te = $('m-c-temp');
        if (te) { te.textContent = temp.toFixed(1) + '°C'; te.className = 'm-val temp ' + this._tmpCls(temp); }
      }
    }

    // ── Jetson ──
    const jMap = {
      'sensor.jetson_cpu_usage': ['m-j-cpu', 'm-j-cpu-bar'],
      'sensor.jetson_gpu_usage': ['m-j-gpu', 'm-j-gpu-bar'],
    };
    for (const [sid, [valId, barId]] of Object.entries(jMap)) {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        const v = parseFloat(s.state) || 0;
        const e = $(valId); if (e) e.textContent = v + '%';
        bar(barId, v);
      }
    }
    const jRam = h.states['sensor.jetson_ram_usage'];
    if (jRam && jRam.state !== 'unavailable') {
      const pct = parseFloat(jRam.state) || 0;
      const a = jRam.attributes || {};
      const used = a.ram_used_mb ? (a.ram_used_mb / 1024).toFixed(1) : '?';
      const tot = a.ram_total_mb ? (a.ram_total_mb / 1024).toFixed(1) : '?';
      const e = $('m-j-ram'); if (e) e.textContent = `${used}/${tot} GB`;
      bar('m-j-ram-bar', pct);
    }
    const jCt = h.states['sensor.jetson_cpu_temp'];
    if (jCt && jCt.state !== 'unavailable') {
      const e = $('m-j-ctemp'); if (e) { e.textContent = jCt.state + '°C'; e.className = 'm-val temp ' + this._tmpCls(parseFloat(jCt.state)); }
    }
    const jGt = h.states['sensor.jetson_gpu_temp'];
    if (jGt && jGt.state !== 'unavailable') {
      const e = $('m-j-gtemp'); if (e) { e.textContent = jGt.state + '°C'; e.className = 'm-val temp ' + this._tmpCls(parseFloat(jGt.state)); }
    }
    const jSt = h.states['sensor.jetson_status'];
    if (jSt && jSt.state !== 'unavailable' && jSt.state !== 'unknown') {
      const e = $('m-jetson-badge'); if (e) { e.textContent = 'Online'; e.className = 'm-badge badge-on'; }
    }

    // ── V-JEPA 2 ──
    const vMap = { 'sensor.v_jepa_2_fps': 'm-v-fps', 'sensor.v_jepa_2_inference_latency': 'm-v-latency', 'sensor.v_jepa_2_frames_processed': 'm-v-frames', 'sensor.v_jepa_2_active_cameras': 'm-v-cams' };
    for (const [sid, eid] of Object.entries(vMap)) {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        const e = $(eid);
        if (e) {
          let v = s.state;
          if (sid.includes('fps')) v += ' fps';
          else if (sid.includes('latency')) v += ' ms';
          else if (sid.includes('frames')) v = parseInt(v).toLocaleString();
          e.textContent = v;
        }
      }
    }
    const vSt = h.states['sensor.v_jepa_2_status'];
    if (vSt && vSt.state !== 'unavailable' && vSt.state !== 'unknown') {
      const e = $('m-vjepa-badge'); if (e) { e.textContent = vSt.state; e.className = 'm-badge badge-on'; }
    }
  }

  // ── Helpers ──

  _fmt(a) { return a ? a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'; }
  _actCls(a) {
    const m = { high_activity: 'act-high', moderate_activity: 'act-mod', low_activity: 'act-low', idle: 'act-idle', empty: 'act-empty' };
    return m[a] || '';
  }
  _tmpCls(t) { return t > 80 ? 'temp-hot' : t > 60 ? 'temp-warm' : 'temp-cool'; }

  // ── CSS ──

  _css() { return `
:host {
  --bg: #000000;
  --bg2: #0d1117;
  --bg3: #161b22;
  --bg4: #1c2333;
  --text: #e6edf3;
  --dim: #8b949e;
  --muted: #484f58;
  --green: #3fb950;
  --teal: #39d2c0;
  --blue: #58a6ff;
  --purple: #bc8cff;
  --amber: #d29922;
  --red: #f85149;
  --pink: #f778ba;
  --border: rgba(240,246,252,0.06);
  --r: 12px;
  --rs: 8px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
.root { background: var(--bg); font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif; color: var(--text); min-height: 100vh; }

/* ── Header ── */
.hdr { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.hdr-left { display: flex; align-items: center; gap: 10px; }
.logo { width: 28px; height: 28px; border-radius: 7px; background: linear-gradient(135deg, var(--teal), var(--blue)); display: flex; align-items: center; justify-content: center; font: 800 11px/1 system-ui; color: #fff; letter-spacing: -.5px; }
.hdr-title { font-size: 15px; font-weight: 700; letter-spacing: -.02em; }
.hdr-sub { font-size: 10px; color: var(--teal); opacity: .7; margin-top: 1px; }
.pill-status { display: flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; background: rgba(63,185,80,.1); border: 1px solid rgba(63,185,80,.15); font-size: 11px; font-weight: 600; color: var(--green); }
.dot-pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

/* ── Camera Grid ── */
.cam-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; padding: 3px; }
.cam-cell:nth-child(4), .cam-cell:nth-child(5) { /* last row: 2 cameras spanning */ }
@media (min-width: 800px) {
  .cam-grid { grid-template-columns: repeat(3, 1fr); }
  .cam-cell:nth-child(4) { grid-column: 1 / 2; }
  .cam-cell:nth-child(5) { grid-column: 2 / 4; }
}

.cam-viewport { position: relative; background: #080a0f; border-radius: var(--rs); overflow: hidden; aspect-ratio: 16/9; }
.cam-img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* ── Overlays ── */
.ov-top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: linear-gradient(to bottom, rgba(0,0,0,.7) 0%, transparent 100%); z-index: 2; }
.ov-label { font-size: 12px; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.ov-live { display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 700; letter-spacing: .5px; padding: 1px 6px; border-radius: 3px; background: rgba(248,81,73,.85); }
.ov-live-dot { width: 5px; height: 5px; border-radius: 50%; background: #fff; animation: pulse 1.2s infinite; }
.ov-fps { margin-left: auto; font-size: 10px; color: var(--dim); font-variant-numeric: tabular-nums; }

.ov-bottom { position: absolute; bottom: 0; left: 0; right: 0; padding: 6px 8px 5px; background: linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.4) 60%, transparent 100%); z-index: 2; }
.ov-ctx { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.ctx-vjepa, .ctx-frigate { display: flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 6px; font-size: 10px; backdrop-filter: blur(8px); }
.ctx-vjepa { background: rgba(57,210,192,.12); border: 1px solid rgba(57,210,192,.2); }
.ctx-frigate { background: rgba(88,166,255,.12); border: 1px solid rgba(88,166,255,.2); }
.ctx-icon { font-size: 8px; color: var(--muted); transition: color .3s; }
.ctx-icon-active { color: var(--teal); text-shadow: 0 0 6px var(--teal); }
.ctx-tag { font-weight: 700; color: var(--dim); font-size: 9px; text-transform: uppercase; letter-spacing: .3px; }
.vjepa-tag { color: rgba(57,210,192,.8); }
.frigate-tag { color: rgba(88,166,255,.8); }
.ctx-val { font-weight: 600; color: var(--text); }
.ctx-val.ctx-active { color: var(--green); }
.ctx-val.act-high { color: var(--red); }
.ctx-val.act-mod { color: var(--amber); }
.ctx-val.act-low { color: var(--blue); }
.ctx-val.act-idle { color: var(--dim); }
.ctx-val.act-empty { color: var(--muted); }
.ctx-conf { font-size: 9px; font-weight: 500; }
.conf-hi { color: var(--green); }
.conf-md { color: var(--amber); }
.conf-lo { color: var(--red); }

.ov-motion { height: 2px; background: rgba(255,255,255,.06); border-radius: 1px; overflow: hidden; }
.motion-fill { height: 100%; border-radius: 1px; background: var(--teal); transition: width .6s ease; }
.motion-fill.motion-md { background: var(--amber); }
.motion-fill.motion-hi { background: var(--red); }

/* Frigate detection overlay (bounding box zone) */
.ov-detect { position: absolute; top: 30px; left: 0; right: 0; bottom: 30px; z-index: 1; pointer-events: none; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px; padding: 4px 8px; }
.detect-box { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; backdrop-filter: blur(6px); }
.person-box { background: rgba(63,185,80,.2); border: 1px solid rgba(63,185,80,.4); color: var(--green); }
.detect-chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 4px; font-size: 10px; background: rgba(255,255,255,.1); backdrop-filter: blur(6px); color: var(--dim); }
.audio-chip { background: rgba(188,140,255,.15); border: 1px solid rgba(188,140,255,.25); color: var(--purple); }

/* ── Pipeline Bar ── */
.pipeline-bar { display: flex; align-items: center; gap: 3px; padding: 5px 10px; background: var(--bg2); border-radius: 0 0 var(--rs) var(--rs); margin-top: -1px; }
.pipe-stage { display: flex; align-items: center; gap: 3px; }
.pipe-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); transition: all .3s; flex-shrink: 0; }
.pipe-dot.on { background: var(--green); box-shadow: 0 0 4px rgba(63,185,80,.4); }
.pipe-dot.pulse { animation: dotpulse 1.5s infinite; }
@keyframes dotpulse { 0%,100%{ box-shadow: 0 0 4px rgba(57,210,192,.4); } 50%{ box-shadow: 0 0 10px rgba(57,210,192,.8); } }
.pipe-dot.frigate-dot.on { background: var(--blue); box-shadow: 0 0 4px rgba(88,166,255,.4); }
.pipe-dot.vjepa-dot.on { background: var(--teal); box-shadow: 0 0 4px rgba(57,210,192,.4); }
.pipe-dot.mqtt-dot.on { background: var(--purple); box-shadow: 0 0 4px rgba(188,140,255,.4); }
.pipe-label { font-size: 9px; color: var(--muted); font-weight: 600; }
.pipe-detail { font-size: 8px; color: var(--dim); font-variant-numeric: tabular-nums; }
.pipe-arrow { font-size: 9px; color: var(--muted); margin: 0 1px; transition: color .3s; }
.pipe-arrow.arrow-active { color: var(--teal); }

/* ── Metrics ── */
.metrics-section { padding: 3px; }
.metrics-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.m-card { background: var(--bg2); border-radius: var(--rs); padding: 10px 12px; border: 1px solid var(--border); }
.m-hdr { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.m-icon { width: 20px; height: 20px; border-radius: 5px; display: flex; align-items: center; justify-content: center; font-size: 11px; }
.frigate-icon { background: rgba(88,166,255,.12); color: var(--blue); }
.coral-icon { background: rgba(247,120,186,.12); color: var(--pink); }
.jetson-icon { background: rgba(63,185,80,.12); color: var(--green); }
.vjepa-icon { background: rgba(57,210,192,.12); color: var(--teal); }
.m-title { font-size: 11px; font-weight: 700; flex: 1; }
.m-badge { font-size: 9px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: rgba(139,148,158,.1); color: var(--muted); }
.m-badge.badge-on { background: rgba(63,185,80,.12); color: var(--green); }
.m-grid { display: flex; flex-direction: column; gap: 5px; }
.m-item { display: flex; align-items: center; gap: 6px; }
.m-label { font-size: 10px; color: var(--muted); width: 55px; flex-shrink: 0; }
.m-bar { flex: 1; height: 3px; background: rgba(255,255,255,.04); border-radius: 2px; overflow: hidden; }
.m-bar-fill { height: 100%; border-radius: 2px; transition: width .6s ease; }
.cpu-fill { background: var(--blue); }
.gpu-fill { background: var(--purple); }
.mem-fill { background: var(--teal); }
.m-val { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text); min-width: 42px; text-align: right; }
.m-val.temp.temp-cool { color: var(--green); }
.m-val.temp.temp-warm { color: var(--amber); }
.m-val.temp.temp-hot { color: var(--red); }

/* ── Responsive ── */
@media (max-width: 900px) {
  .cam-grid { grid-template-columns: 1fr 1fr; }
  .cam-cell:nth-child(5) { grid-column: 1 / -1; }
  .metrics-row { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .cam-grid { grid-template-columns: 1fr; }
  .metrics-row { grid-template-columns: 1fr; }
}
`; }
}

if (!customElements.get('engineered-lighting-card')) {
  customElements.define('engineered-lighting-card', EngineeredLightingCard);
}
window.customCards = window.customCards || [];
window.customCards.push({ type: 'engineered-lighting-card', name: 'Engineered Lighting', description: 'V-JEPA 2 World Model Dashboard' });
