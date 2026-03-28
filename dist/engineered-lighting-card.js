/**
 * Engineered Lighting Card v5
 * V-JEPA 2 World Model Dashboard
 *
 * Design: Apple — Clarity · Deference · Depth
 * Calm, minimal, effortless. Every element earns its place.
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
        { name: 'driveway', entity: 'camera.driveway', label: 'Driveway' },
      ],
      frigate_url: c.frigate_url || 'http://192.168.175.114:5000',
      ...c,
    };
  }

  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() {
    return { cameras: [
      { name: 'living_room', entity: 'camera.living_room', label: 'Living Room' },
      { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room' },
      { name: 'kitchen', entity: 'camera.kitchen', label: 'Kitchen' },
      { name: 'back_door', entity: 'camera.back_door', label: 'Back Door' },
      { name: 'driveway', entity: 'camera.driveway', label: 'Driveway' },
    ]};
  }

  getCardSize() { return 24; }

  disconnectedCallback() {
    this._timers.forEach(t => clearInterval(t));
    this._timers = [];
  }

  // ── Snapshot URLs ──
  // No bbox=1 — Frigate bounding boxes cause flicker. Object detection rendered as HTML pills.

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

  // ── Frigate Data Helpers ──

  _getDetectedObjects(camName) {
    const objects = [
      'person','dog','cat','bottle','cup','bowl','chair','couch',
      'dining_table','cell_phone','laptop','tv','book','remote',
      'potted_plant','oven','backpack','handbag','suitcase','clock',
      'car','truck','bicycle','motorcycle'
    ];
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
    const m = {
      person:'Person', dog:'Dog', cat:'Cat', bottle:'Bottle', cup:'Cup', bowl:'Bowl',
      chair:'Chair', couch:'Couch', dining_table:'Table', cell_phone:'Phone', laptop:'Laptop',
      tv:'TV', book:'Book', remote:'Remote', potted_plant:'Plant', oven:'Oven',
      backpack:'Backpack', handbag:'Bag', suitcase:'Suitcase', clock:'Clock',
      car:'Car', truck:'Truck', bicycle:'Bike', motorcycle:'Moto'
    };
    return m[obj] || obj.replace(/_/g, ' ');
  }

  _getSoundLabel(snd) {
    return snd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  _isMotionDetected(camName) {
    const s = this._hass?.states[`binary_sensor.${camName}_motion`];
    return s && s.state === 'on';
  }

  _getSwitch(camName, type) {
    const s = this._hass?.states[`switch.${camName}_${type}`];
    return s ? s.state === 'on' : false;
  }

  // ── Activity (V-JEPA 2) ──

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
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    return `${Math.floor(diff / 3600)}h`;
  }

  _tempClass(t) {
    return t > 80 ? 'temp-hot' : t > 60 ? 'temp-warm' : 'temp-cool';
  }

  // ── Render ──

  _render() {
    const cams = this._config.cameras;
    // Fix: living_room camera feed actually shows driveway, and vice versa
    const labelOverrides = { 'living_room': 'Driveway', 'driveway': 'Living Room' };

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <div class="root">

        <!-- Header -->
        <header class="hdr">
          <div class="hdr-left">
            <div class="hdr-title">Engineered Lighting</div>
            <div class="hdr-sub">V-JEPA 2 · Perception Pipeline</div>
          </div>
          <div class="hdr-right">
            <div class="hdr-stat">
              <span class="hdr-stat-val" id="hdr-total-objects">0</span>
              <span class="hdr-stat-label">Objects</span>
            </div>
            <div class="hdr-stat">
              <span class="hdr-stat-val">5</span>
              <span class="hdr-stat-label">Cameras</span>
            </div>
            <div class="pill-status" id="pill-status">
              <span class="dot-pulse"></span>Active
            </div>
          </div>
        </header>

        <!-- Camera Grid: 3 primary (top) + 2 secondary (bottom, smaller) -->
        <div class="cam-grid">
          ${cams.map((cam, i) => {
            const displayLabel = labelOverrides[cam.name] || cam.label;
            const sizeClass = i < 3 ? 'cam-primary' : 'cam-secondary';
            return `
          <div class="cam-cell ${sizeClass}" id="cell-${cam.name}">
            <div class="cam-viewport">
              <img class="cam-img" id="img-${cam.name}" alt="${displayLabel}" />

              <!-- Top: label + status -->
              <div class="ov-top">
                <span class="ov-label">${displayLabel}</span>
                <span class="ov-status" id="status-${cam.name}">Idle</span>
              </div>

              <!-- Detection pills (HTML, no flicker) -->
              <div class="ov-detect" id="detect-${cam.name}"></div>

              <!-- V-JEPA 2 activity overlay -->
              <div class="ov-bottom" id="bottom-${cam.name}">
                <div class="vj-main">
                  <span class="vj-activity" id="vj-act-${cam.name}"></span>
                  <span class="vj-conf" id="vj-conf-${cam.name}"></span>
                  <span class="vj-time" id="vj-ts-${cam.name}"></span>
                </div>
                <div class="vj-data" id="vj-data-${cam.name}">
                  <span class="vj-metric"><span class="vj-ml">Embed</span> <span class="vj-mv" id="vj-embed-${cam.name}">—</span></span>
                  <span class="vj-metric"><span class="vj-ml">Motion</span> <span class="vj-mv" id="vj-motion-${cam.name}">—</span></span>
                  <span class="vj-metric"><span class="vj-ml">Trend</span> <span class="vj-mv" id="vj-trend-${cam.name}">—</span></span>
                </div>
                <div class="vj-frigate" id="vj-fri-${cam.name}"></div>
              </div>
            </div>
          </div>`;
          }).join('')}
        </div>

        <!-- System Metrics -->
        <div class="metrics">

          <!-- Frigate NVR -->
          <div class="m-card">
            <div class="m-hdr">
              <div class="m-dot m-dot-blue"></div>
              <span class="m-title">Frigate NVR</span>
              <span class="m-badge" id="m-fri-badge">—</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">CPU</span><div class="m-bar"><div class="m-bar-fill bar-blue" id="m-fri-cpu-bar"></div></div><span class="m-val" id="m-fri-cpu">—</span></div>
              <div class="m-row"><span class="m-label">Memory</span><div class="m-bar"><div class="m-bar-fill bar-blue" id="m-fri-mem-bar"></div></div><span class="m-val" id="m-fri-mem">—</span></div>
              <div class="m-row"><span class="m-label">Uptime</span><span class="m-val" id="m-fri-uptime">—</span></div>
              <div class="m-row"><span class="m-label">Detect</span><span class="m-val" id="m-fri-detect">—</span></div>
              <div class="m-row"><span class="m-label">Motion</span><span class="m-val" id="m-fri-motion">—</span></div>
            </div>
          </div>

          <!-- Coral TPU -->
          <div class="m-card">
            <div class="m-hdr">
              <div class="m-dot m-dot-pink"></div>
              <span class="m-title">Coral TPU</span>
              <span class="m-badge" id="m-coral-badge">—</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">Inference</span><span class="m-val" id="m-coral-speed">—</span></div>
              <div class="m-row"><span class="m-label">Temp</span><span class="m-val temp" id="m-coral-temp">—</span></div>
              <div class="m-row"><span class="m-label">PID</span><span class="m-val" id="m-coral-pid">—</span></div>
            </div>
          </div>

          <!-- Jetson Orin Nano -->
          <div class="m-card">
            <div class="m-hdr">
              <div class="m-dot m-dot-green"></div>
              <span class="m-title">Jetson Orin Nano</span>
              <span class="m-badge" id="m-jet-badge">—</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">CPU</span><div class="m-bar"><div class="m-bar-fill bar-green" id="m-jet-cpu-bar"></div></div><span class="m-val" id="m-jet-cpu">—</span></div>
              <div class="m-row"><span class="m-label">GPU</span><div class="m-bar"><div class="m-bar-fill bar-purple" id="m-jet-gpu-bar"></div></div><span class="m-val" id="m-jet-gpu">—</span></div>
              <div class="m-row"><span class="m-label">RAM</span><div class="m-bar"><div class="m-bar-fill bar-teal" id="m-jet-ram-bar"></div></div><span class="m-val" id="m-jet-ram">—</span></div>
              <div class="m-row"><span class="m-label">CPU Temp</span><span class="m-val temp" id="m-jet-ct">—</span></div>
              <div class="m-row"><span class="m-label">GPU Temp</span><span class="m-val temp" id="m-jet-gt">—</span></div>
            </div>
          </div>

          <!-- V-JEPA 2 -->
          <div class="m-card m-card-accent">
            <div class="m-hdr">
              <div class="m-dot m-dot-teal"></div>
              <span class="m-title">V-JEPA 2</span>
              <span class="m-badge" id="m-vj-badge">—</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">Status</span><span class="m-val" id="m-vj-status">—</span></div>
              <div class="m-row"><span class="m-label">FPS</span><span class="m-val" id="m-vj-fps">—</span></div>
              <div class="m-row"><span class="m-label">Latency</span><span class="m-val" id="m-vj-latency">—</span></div>
              <div class="m-row"><span class="m-label">Frames</span><span class="m-val" id="m-vj-frames">—</span></div>
              <div class="m-row"><span class="m-label">Active</span><span class="m-val" id="m-vj-cams">—</span></div>
              <div class="m-row"><span class="m-label">Inferring</span><span class="m-val" id="m-vj-inferring">—</span></div>
              <div class="m-row m-row-model"><span class="m-model" id="m-vj-model">V-JEPA 2 ViT-L · FP16 · CUDA</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
    this._setupImageHandlers();
  }

  _setupImageHandlers() {
    this._config.cameras.forEach(cam => {
      const img = this.shadowRoot.getElementById(`img-${cam.name}`);
      if (img) {
        img.onerror = () => {
          if (!this._failedCams.has(cam.name)) {
            this._failedCams.add(cam.name);
            img.src = this._snapUrlHA(cam);
          }
        };
      }
    });
  }

  // ── Polling ──

  _poll() {
    // Refresh snapshots every 2s with pre-load to avoid flicker
    const t1 = setInterval(() => {
      this._config.cameras.forEach(cam => {
        const img = this.shadowRoot.getElementById(`img-${cam.name}`);
        if (!img) return;
        const url = this._snapUrl(cam);
        const tmp = new Image();
        tmp.onload = () => { img.src = url; };
        tmp.onerror = () => {
          if (!this._failedCams.has(cam.name)) {
            this._failedCams.add(cam.name);
            img.src = this._snapUrlHA(cam);
          }
        };
        tmp.src = url;
      });
    }, 2000);
    // Fetch Frigate stats every 5s
    const t2 = setInterval(() => this._fetchFrigate(), 5000);
    this._timers.push(t1, t2);
    // Initial load
    this._config.cameras.forEach(cam => {
      const img = this.shadowRoot.getElementById(`img-${cam.name}`);
      if (img) img.src = this._snapUrl(cam);
    });
    this._fetchFrigate();
  }

  async _fetchFrigate() {
    try {
      const r = await fetch(this._config.frigate_url + '/api/stats');
      if (r.ok) { this._frigateStats = await r.json(); this._update(); }
    } catch(e) {}
  }

  // ── Update ──

  _update() {
    if (!this._hass) return;
    let totalObjects = 0;
    this._config.cameras.forEach(cam => {
      totalObjects += this._updateCamera(cam);
    });
    this._updateMetrics();
    const te = this.shadowRoot.getElementById('hdr-total-objects');
    if (te) te.textContent = totalObjects;

    // Header status pill
    const vst = this._hass.states['sensor.v_jepa_2_status'];
    const pill = this.shadowRoot.getElementById('pill-status');
    if (pill) {
      const on = vst?.state === 'running';
      pill.innerHTML = `<span class="dot-pulse${on ? '' : ' off'}"></span>${on ? 'Active' : 'Offline'}`;
      pill.className = 'pill-status' + (on ? '' : ' pill-off');
    }
  }

  _updateCamera(cam) {
    const $ = id => this.shadowRoot.getElementById(id);
    const fStats = this._frigateStats?.cameras?.[cam.name];
    const act = this._getActivity(cam.name);

    // Status badge (top-right)
    const statusEl = $(`status-${cam.name}`);
    if (statusEl) {
      if (act && act.person_detected) {
        statusEl.textContent = 'Person';
        statusEl.className = 'ov-status ov-status-person';
      } else if (this._isMotionDetected(cam.name)) {
        statusEl.textContent = 'Motion';
        statusEl.className = 'ov-status ov-status-motion';
      } else {
        statusEl.textContent = 'Idle';
        statusEl.className = 'ov-status';
      }
    }

    // Activity label
    const actEl = $(`vj-act-${cam.name}`);
    if (actEl) {
      const label = act ? this._activityLabel(act.activity) : null;
      if (label && act.person_detected) {
        actEl.textContent = label;
        actEl.className = 'vj-activity vj-activity-on';
      } else {
        actEl.textContent = act?.person_detected ? 'Detected' : '';
        actEl.className = 'vj-activity';
      }
    }

    // Confidence
    const confEl = $(`vj-conf-${cam.name}`);
    if (confEl) {
      if (act && act.confidence !== null && act.person_detected) {
        const pct = typeof act.confidence === 'number'
          ? (act.confidence > 1 ? act.confidence : act.confidence * 100) : 0;
        confEl.textContent = `${pct.toFixed(0)}%`;
        confEl.className = 'vj-conf' + (pct > 80 ? ' conf-hi' : pct > 50 ? ' conf-md' : ' conf-lo');
      } else {
        confEl.textContent = '';
      }
    }

    // Timestamp
    const tsEl = $(`vj-ts-${cam.name}`);
    if (tsEl) tsEl.textContent = act ? this._formatTime(act.timestamp) : '';

    // Embed / Motion / Trend
    const embedEl = $(`vj-embed-${cam.name}`);
    if (embedEl) {
      if (act && act.embed_change !== null) {
        embedEl.textContent = act.embed_change.toFixed(4);
        embedEl.className = 'vj-mv' + (act.embed_change > 0.01 ? ' val-hi' : '');
      } else { embedEl.textContent = '—'; embedEl.className = 'vj-mv'; }
    }
    const motionEl = $(`vj-motion-${cam.name}`);
    if (motionEl) {
      if (act && act.motion_level !== null) {
        motionEl.textContent = act.motion_level.toFixed(4);
        motionEl.className = 'vj-mv' + (act.motion_level > 0.03 ? ' val-warn' : act.motion_level > 0.01 ? ' val-hi' : '');
      } else { motionEl.textContent = '—'; motionEl.className = 'vj-mv'; }
    }
    const trendEl = $(`vj-trend-${cam.name}`);
    if (trendEl) {
      if (act && act.trend !== null) {
        const arrow = act.trend > 0.001 ? ' ↑' : act.trend < -0.001 ? ' ↓' : ' →';
        trendEl.textContent = act.trend.toFixed(4) + arrow;
      } else { trendEl.textContent = '—'; }
    }

    // Fade data row when idle
    const dataRow = $(`vj-data-${cam.name}`);
    if (dataRow) dataRow.style.opacity = (act && act.person_detected) ? '1' : '0.35';

    // Frigate per-cam stats
    const friEl = $(`vj-fri-${cam.name}`);
    if (friEl && fStats) {
      const dfps = fStats.detection_fps || 0;
      const cfps = fStats.camera_fps || 0;
      friEl.textContent = dfps > 0 ? `${cfps.toFixed(0)} fps · ${dfps.toFixed(1)} det/s` : `${cfps.toFixed(0)} fps`;
      friEl.className = 'vj-frigate' + (dfps > 0 ? ' vj-fri-active' : '');
    }

    // ── Detection pills (stable HTML, no flicker) ──
    const objects = this._getDetectedObjects(cam.name);
    const sounds = this._getDetectedSounds(cam.name);
    const detectEl = $(`detect-${cam.name}`);
    if (detectEl) {
      let html = '';
      objects.forEach(obj => {
        const cls = obj === 'person' ? 'det-person' : (obj === 'dog' || obj === 'cat') ? 'det-animal' : 'det-object';
        html += `<span class="det-pill ${cls}">${this._getObjectLabel(obj)}</span>`;
      });
      sounds.forEach(snd => {
        html += `<span class="det-pill det-sound">${this._getSoundLabel(snd)}</span>`;
      });
      detectEl.innerHTML = html;
    }

    return objects.length;
  }

  _updateMetrics() {
    const h = this._hass;
    if (!h) return;
    const $ = id => this.shadowRoot.getElementById(id);
    const bar = (id, pct) => { const b = $(id); if (b) b.style.width = Math.min(100, pct || 0) + '%'; };
    const setVal = (id, v) => { const e = $(id); if (e) e.textContent = v; };

    // ── Frigate ──
    const st = this._frigateStats;
    if (st.service) {
      const up = st.service.uptime || 0;
      const hrs = Math.floor(up / 3600);
      const min = Math.floor((up % 3600) / 60);
      setVal('m-fri-uptime', hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
      const be = $('m-fri-badge');
      if (be) { be.textContent = 'Online'; be.className = 'm-badge badge-on'; }
    }
    if (st.cpu_usages) {
      const fs = st.cpu_usages['frigate.full_system'];
      if (fs) {
        setVal('m-fri-cpu', (fs.cpu || 0) + '%');
        bar('m-fri-cpu-bar', fs.cpu);
        setVal('m-fri-mem', (fs.mem || 0) + '%');
        bar('m-fri-mem-bar', fs.mem);
      }
    }
    let detectCount = 0, motionCount = 0;
    this._config.cameras.forEach(cam => {
      if (this._getSwitch(cam.name, 'detect')) detectCount++;
      if (this._getSwitch(cam.name, 'motion')) motionCount++;
    });
    setVal('m-fri-detect', `${detectCount}/5 cams`);
    setVal('m-fri-motion', `${motionCount}/5 cams`);

    // ── Coral TPU ──
    if (st.detectors) {
      const det = Object.values(st.detectors)[0];
      if (det) {
        setVal('m-coral-speed', (det.inference_speed || 0).toFixed(1) + ' ms');
        setVal('m-coral-pid', det.pid || '—');
        const be = $('m-coral-badge');
        if (be) { be.textContent = 'Online'; be.className = 'm-badge badge-on'; }
      }
    }
    if (st.temperatures) {
      const temp = st.temperatures.apex_0 || Object.values(st.temperatures)[0];
      if (temp) {
        const te = $('m-coral-temp');
        if (te) { te.textContent = temp.toFixed(1) + '°C'; te.className = 'm-val temp ' + this._tempClass(temp); }
      }
    }

    // ── Jetson ──
    const jSensors = {
      'sensor.jetson_cpu_usage': ['m-jet-cpu', 'm-jet-cpu-bar'],
      'sensor.jetson_gpu_usage': ['m-jet-gpu', 'm-jet-gpu-bar'],
    };
    let jetsonOnline = false;
    for (const [sid, [valId, barId]] of Object.entries(jSensors)) {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        jetsonOnline = true;
        const v = parseFloat(s.state) || 0;
        setVal(valId, v.toFixed(1) + '%');
        bar(barId, v);
      }
    }
    const jRam = h.states['sensor.jetson_ram_usage'];
    if (jRam && jRam.state !== 'unavailable' && jRam.state !== 'unknown') {
      jetsonOnline = true;
      const pct = parseFloat(jRam.state) || 0;
      const a = jRam.attributes || {};
      const used = a.ram_used_mb ? (a.ram_used_mb / 1024).toFixed(1) : '?';
      const tot = a.ram_total_mb ? (a.ram_total_mb / 1024).toFixed(1) : '?';
      setVal('m-jet-ram', `${used}/${tot} GB`);
      bar('m-jet-ram-bar', pct);
    }
    ['sensor.jetson_cpu_temp', 'sensor.jetson_gpu_temp'].forEach((sid, i) => {
      const s = h.states[sid];
      const eid = i === 0 ? 'm-jet-ct' : 'm-jet-gt';
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        jetsonOnline = true;
        const e = $(eid);
        if (e) { e.textContent = s.state + '°C'; e.className = 'm-val temp ' + this._tempClass(parseFloat(s.state)); }
      } else { setVal(eid, '—'); }
    });
    if (jetsonOnline) {
      const be = $('m-jet-badge');
      if (be) { be.textContent = 'Online'; be.className = 'm-badge badge-on'; }
    }

    // ── V-JEPA 2 Global ──
    const vMap = {
      'sensor.v_jepa_2_status': 'm-vj-status',
      'sensor.v_jepa_2_fps': 'm-vj-fps',
      'sensor.v_jepa_2_inference_latency': 'm-vj-latency',
      'sensor.v_jepa_2_frames_processed': 'm-vj-frames',
      'sensor.v_jepa_2_active_cameras': 'm-vj-cams',
    };
    let vjepaOnline = false;
    for (const [sid, eid] of Object.entries(vMap)) {
      const s = h.states[sid];
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        vjepaOnline = true;
        let v = s.state;
        if (sid.includes('fps')) v = parseFloat(v).toFixed(1) + ' fps';
        else if (sid.includes('latency')) v = parseFloat(v).toFixed(0) + ' ms';
        else if (sid.includes('frames')) v = parseInt(v).toLocaleString();
        else if (sid.includes('active')) v = v + '/5 cams';
        setVal(eid, v);
      }
    }
    let inferCount = 0;
    this._config.cameras.forEach(cam => { if (this._isVjepaInferring(cam.name)) inferCount++; });
    setVal('m-vj-inferring', `${inferCount}/5 cams`);

    if (vjepaOnline) {
      const be = $('m-vj-badge');
      if (be) { be.textContent = 'Online'; be.className = 'm-badge badge-on'; }
    }

    const vStatus = h.states['sensor.v_jepa_2_status'];
    const modelEl = $('m-vj-model');
    if (modelEl && vStatus?.attributes) {
      modelEl.textContent = `${vStatus.attributes.model || 'V-JEPA 2 ViT-L'} · ${vStatus.attributes.precision || 'FP16'} · CUDA`;
    }
  }

  // ── CSS ──

  _css() {
    return `
    :host {
      --bg: #000;
      --surface: #0c0c0e;
      --surface-2: #161618;
      --border: rgba(255,255,255,0.06);
      --border-hover: rgba(255,255,255,0.10);

      --text: #f5f5f7;
      --text-2: rgba(255,255,255,0.65);
      --text-3: rgba(255,255,255,0.40);
      --text-4: rgba(255,255,255,0.22);

      --blue: #0a84ff;
      --teal: #30d5c8;
      --green: #30d158;
      --amber: #ffd60a;
      --orange: #ff9f0a;
      --red: #ff453a;
      --purple: #bf5af2;
      --pink: #ff375f;

      --r: 12px;
      --r-sm: 8px;
      --ease: cubic-bezier(.25,.1,.25,1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      background: var(--bg);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', system-ui, sans-serif;
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      padding: 12px;
      display: flex; flex-direction: column; gap: 10px;
    }

    /* ── Header ── */
    .hdr {
      display: flex; justify-content: space-between; align-items: center;
      padding: 14px 18px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r);
    }
    .hdr-left { display: flex; flex-direction: column; gap: 2px; }
    .hdr-right { display: flex; align-items: center; gap: 20px; }
    .hdr-title { font-size: 17px; font-weight: 700; letter-spacing: -0.03em; }
    .hdr-sub { font-size: 11px; color: var(--text-4); letter-spacing: -0.01em; }
    .hdr-stat { display: flex; flex-direction: column; align-items: center; }
    .hdr-stat-val { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .hdr-stat-label { font-size: 9px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.6px; }

    .pill-status {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 14px; border-radius: 100px;
      background: rgba(48,209,88,0.08); border: 1px solid rgba(48,209,88,0.12);
      font-size: 11px; font-weight: 600; color: var(--green);
      transition: all 0.3s var(--ease);
    }
    .pill-status.pill-off { background: rgba(255,255,255,0.03); border-color: var(--border); color: var(--text-4); }
    .dot-pulse {
      width: 6px; height: 6px; border-radius: 50%; background: var(--green);
      animation: pulse 2s ease-in-out infinite;
    }
    .dot-pulse.off { background: var(--text-4); animation: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

    /* ── Camera Grid ── */
    .cam-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    @media (min-width: 900px) {
      .cam-grid { grid-template-columns: repeat(6, 1fr); }
      .cam-cell.cam-primary { grid-column: span 2; }
      .cam-cell.cam-secondary:nth-child(4) { grid-column: 2 / 4; }
      .cam-cell.cam-secondary:nth-child(5) { grid-column: 4 / 6; }
    }

    .cam-viewport {
      position: relative; background: var(--surface);
      border-radius: var(--r); overflow: hidden;
      aspect-ratio: 16/9;
      border: 1px solid var(--border);
      transition: border-color 0.3s var(--ease);
    }
    .cam-viewport:hover { border-color: var(--border-hover); }
    .cam-img { width: 100%; height: 100%; object-fit: cover; display: block; }

    /* Camera overlays */
    .ov-top {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      background: linear-gradient(180deg, rgba(0,0,0,0.65) 0%, transparent 100%);
      z-index: 3;
    }
    .ov-label {
      font-size: 13px; font-weight: 650; letter-spacing: -0.01em;
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    }
    .ov-status {
      margin-left: auto;
      font-size: 10px; font-weight: 600;
      padding: 2px 10px; border-radius: 100px;
      background: rgba(255,255,255,0.08);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      color: var(--text-3);
      transition: all 0.3s var(--ease);
    }
    .ov-status-person { background: rgba(48,209,88,0.18); color: var(--green); }
    .ov-status-motion { background: rgba(48,213,200,0.15); color: var(--teal); }

    /* Detection pills */
    .ov-detect {
      position: absolute; top: 36px; left: 0; right: 0;
      z-index: 2; pointer-events: none;
      display: flex; flex-wrap: wrap; gap: 4px;
      padding: 4px 10px;
    }
    .det-pill {
      display: inline-flex; align-items: center;
      padding: 3px 9px; border-radius: 100px;
      font-size: 10px; font-weight: 600;
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      transition: opacity 0.3s var(--ease);
    }
    .det-person { background: rgba(48,209,88,0.18); border: 1px solid rgba(48,209,88,0.25); color: var(--green); }
    .det-animal { background: rgba(255,159,10,0.18); border: 1px solid rgba(255,159,10,0.25); color: var(--orange); }
    .det-object { background: rgba(10,132,255,0.18); border: 1px solid rgba(10,132,255,0.25); color: var(--blue); }
    .det-sound { background: rgba(191,90,242,0.18); border: 1px solid rgba(191,90,242,0.25); color: var(--purple); }

    /* V-JEPA bottom overlay */
    .ov-bottom {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 16px 12px 8px;
      background: linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 65%, transparent 100%);
      z-index: 3;
      display: flex; flex-direction: column; gap: 4px;
    }
    .vj-main { display: flex; align-items: baseline; gap: 8px; }
    .vj-activity {
      font-size: 13px; font-weight: 600; color: var(--text-3);
      transition: all 0.3s var(--ease);
    }
    .vj-activity-on { color: var(--text); }
    .vj-conf { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .conf-hi { color: var(--green); }
    .conf-md { color: var(--amber); }
    .conf-lo { color: var(--red); }
    .vj-time { font-size: 9px; color: var(--text-4); margin-left: auto; font-variant-numeric: tabular-nums; }

    .vj-data {
      display: flex; gap: 14px;
      transition: opacity 0.4s var(--ease);
    }
    .vj-metric { display: flex; align-items: center; gap: 4px; }
    .vj-ml { font-size: 9px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.3px; }
    .vj-mv {
      font-size: 10px; font-weight: 600;
      font-family: 'SF Mono', 'Menlo', 'Cascadia Code', monospace;
      color: var(--text-3); font-variant-numeric: tabular-nums;
      transition: color 0.3s var(--ease);
    }
    .vj-mv.val-hi { color: var(--teal); }
    .vj-mv.val-warn { color: var(--amber); }

    .vj-frigate { font-size: 9px; font-weight: 600; color: var(--text-4); font-variant-numeric: tabular-nums; }
    .vj-fri-active { color: var(--text-3); }

    /* ── Metrics ── */
    .metrics {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    }
    .m-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r);
      padding: 14px 16px;
      transition: border-color 0.3s var(--ease);
    }
    .m-card:hover { border-color: var(--border-hover); }
    .m-card-accent { border-color: rgba(48,213,200,0.12); }
    .m-card-accent:hover { border-color: rgba(48,213,200,0.2); }

    .m-hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .m-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .m-dot-blue { background: var(--blue); }
    .m-dot-pink { background: var(--pink); }
    .m-dot-green { background: var(--green); }
    .m-dot-teal { background: var(--teal); }
    .m-title { font-size: 12px; font-weight: 700; flex: 1; letter-spacing: -0.01em; }
    .m-badge {
      font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 100px;
      background: rgba(255,255,255,0.04); color: var(--text-4);
    }
    .m-badge.badge-on { background: rgba(48,209,88,0.1); color: var(--green); }

    .m-body { display: flex; flex-direction: column; gap: 7px; }
    .m-row { display: flex; align-items: center; gap: 8px; }
    .m-row-model { margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border); }
    .m-label { font-size: 10px; color: var(--text-4); width: 56px; flex-shrink: 0; font-weight: 500; }
    .m-bar { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.04); overflow: hidden; }
    .m-bar-fill { height: 100%; border-radius: 2px; transition: width 0.6s var(--ease); width: 0%; }
    .bar-blue { background: var(--blue); }
    .bar-teal { background: var(--teal); }
    .bar-green { background: var(--green); }
    .bar-purple { background: var(--purple); }
    .m-val {
      font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
      color: var(--text-2); min-width: 54px; text-align: right;
    }
    .m-val.temp.temp-cool { color: var(--green); }
    .m-val.temp.temp-warm { color: var(--amber); }
    .m-val.temp.temp-hot { color: var(--red); }
    .m-model { font-size: 9px; color: var(--text-4); font-family: 'SF Mono', 'Menlo', monospace; letter-spacing: 0.2px; }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .cam-grid { grid-template-columns: repeat(2, 1fr); }
      .cam-cell.cam-primary:first-child { grid-column: 1 / -1; }
      .metrics { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 600px) {
      .cam-grid { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
      .root { padding: 8px; gap: 6px; }
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
  description: 'V-JEPA 2 World Model Dashboard v5'
});
