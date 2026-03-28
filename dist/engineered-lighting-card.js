/**
 * Engineered Lighting Card v6
 * V-JEPA 2 World Model Dashboard
 *
 * Design: Liquid glass · Monochrome · Clarity
 * Fixed bottom metrics pane. Camera feeds scroll behind it.
 * Zero-flicker: diff-based DOM updates, pre-loaded snapshots.
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
    // Flicker prevention: cache previous detection HTML per camera
    this._prevDetectHTML = {};
    this._prevActivityState = {};
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
      // Camera order: indoor primary above fold, outdoor below fold
      cameras: c.cameras || [
        { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room', indoor: true },
        { name: 'kitchen', entity: 'camera.kitchen', label: 'Kitchen', indoor: true },
        { name: 'living_room', entity: 'camera.living_room', label: 'Living Room', indoor: true },
        { name: 'back_door', entity: 'camera.back_door', label: 'Back Door', indoor: false },
        { name: 'driveway', entity: 'camera.driveway', label: 'Driveway', indoor: false },
      ],
      frigate_url: c.frigate_url || 'http://192.168.175.114:5000',
      ...c,
    };
  }

  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() {
    return { cameras: [
      { name: 'dining_room', entity: 'camera.dining_room', label: 'Dining Room', indoor: true },
      { name: 'kitchen', entity: 'camera.kitchen', label: 'Kitchen', indoor: true },
      { name: 'living_room', entity: 'camera.living_room', label: 'Living Room', indoor: true },
      { name: 'back_door', entity: 'camera.back_door', label: 'Back Door', indoor: false },
      { name: 'driveway', entity: 'camera.driveway', label: 'Driveway', indoor: false },
    ]};
  }

  getCardSize() { return 24; }

  disconnectedCallback() {
    this._timers.forEach(t => clearInterval(t));
    this._timers = [];
  }

  // ── Snapshot URLs ──
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

    const indoorCams = cams.filter(c => c.indoor !== false);
    const outdoorCams = cams.filter(c => c.indoor === false);

    const renderCam = (cam, sizeClass) => {
      const displayLabel = labelOverrides[cam.name] || cam.label;
      return `
        <div class="cam-cell ${sizeClass}" id="cell-${cam.name}">
          <div class="cam-viewport">
            <img class="cam-img" id="img-${cam.name}" alt="${displayLabel}" />

            <!-- Top: label + status -->
            <div class="ov-top">
              <span class="ov-label">${displayLabel}</span>
              <span class="ov-status" id="status-${cam.name}">Idle</span>
            </div>

            <!-- Detection pills -->
            <div class="ov-detect" id="detect-${cam.name}"></div>

            <!-- V-JEPA 2 activity overlay: liquid glass -->
            <div class="ov-activity" id="act-panel-${cam.name}">
              <div class="act-row-main">
                <span class="act-label" id="act-label-${cam.name}"></span>
                <span class="act-conf" id="act-conf-${cam.name}"></span>
                <span class="act-time" id="act-ts-${cam.name}"></span>
              </div>
              <div class="act-row-secondary" id="act-secondary-${cam.name}"></div>
              <div class="act-scores" id="act-scores-${cam.name}"></div>
              <div class="act-metrics" id="act-metrics-${cam.name}">
                <span class="act-m"><span class="act-ml">Embed</span><span class="act-mv" id="act-embed-${cam.name}">—</span></span>
                <span class="act-m"><span class="act-ml">Motion</span><span class="act-mv" id="act-motion-${cam.name}">—</span></span>
                <span class="act-m"><span class="act-ml">Trend</span><span class="act-mv" id="act-trend-${cam.name}">—</span></span>
              </div>
            </div>
          </div>
        </div>`;
    };

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <div class="el-root">

        <!-- Header: liquid glass -->
        <header class="hdr">
          <div class="hdr-left">
            <div class="hdr-title">Engineered Lighting</div>
            <div class="hdr-sub">V-JEPA 2 · World Model</div>
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

        <!-- Scrollable camera area -->
        <div class="cam-scroll">

          <!-- Indoor cameras: above the fold -->
          <div class="cam-section-label">Indoor</div>
          <div class="cam-grid cam-grid-primary">
            ${indoorCams.map(cam => renderCam(cam, 'cam-primary')).join('')}
          </div>

          <!-- Outdoor cameras: below the fold -->
          <div class="cam-section-label">Outdoor</div>
          <div class="cam-grid cam-grid-secondary">
            ${outdoorCams.map(cam => renderCam(cam, 'cam-secondary')).join('')}
          </div>
        </div>

        <!-- Fixed bottom metrics pane: liquid glass -->
        <div class="metrics-pane">
          <div class="metrics-inner">

            <!-- Frigate NVR -->
            <div class="mp-card">
              <div class="mp-hdr">
                <span class="mp-title">Frigate NVR</span>
                <span class="mp-badge" id="mp-fri-badge">—</span>
              </div>
              <div class="mp-body">
                <div class="mp-row"><span class="mp-label">CPU</span><div class="mp-bar"><div class="mp-bar-fill" id="mp-fri-cpu-bar"></div></div><span class="mp-val" id="mp-fri-cpu">—</span></div>
                <div class="mp-row"><span class="mp-label">Mem</span><div class="mp-bar"><div class="mp-bar-fill" id="mp-fri-mem-bar"></div></div><span class="mp-val" id="mp-fri-mem">—</span></div>
                <div class="mp-row"><span class="mp-label">Uptime</span><span class="mp-val" id="mp-fri-uptime">—</span></div>
                <div class="mp-row"><span class="mp-label">Detect</span><span class="mp-val" id="mp-fri-detect">—</span></div>
              </div>
            </div>

            <!-- Coral TPU -->
            <div class="mp-card">
              <div class="mp-hdr">
                <span class="mp-title">Coral TPU</span>
                <span class="mp-badge" id="mp-coral-badge">—</span>
              </div>
              <div class="mp-body">
                <div class="mp-row"><span class="mp-label">Inference</span><span class="mp-val" id="mp-coral-speed">—</span></div>
                <div class="mp-row"><span class="mp-label">Temp</span><span class="mp-val" id="mp-coral-temp">—</span></div>
                <div class="mp-row"><span class="mp-label">PID</span><span class="mp-val" id="mp-coral-pid">—</span></div>
              </div>
            </div>

            <!-- Jetson Orin Nano -->
            <div class="mp-card">
              <div class="mp-hdr">
                <span class="mp-title">Jetson Orin</span>
                <span class="mp-badge" id="mp-jet-badge">—</span>
              </div>
              <div class="mp-body">
                <div class="mp-row"><span class="mp-label">CPU</span><div class="mp-bar"><div class="mp-bar-fill" id="mp-jet-cpu-bar"></div></div><span class="mp-val" id="mp-jet-cpu">—</span></div>
                <div class="mp-row"><span class="mp-label">GPU</span><div class="mp-bar"><div class="mp-bar-fill" id="mp-jet-gpu-bar"></div></div><span class="mp-val" id="mp-jet-gpu">—</span></div>
                <div class="mp-row"><span class="mp-label">RAM</span><div class="mp-bar"><div class="mp-bar-fill" id="mp-jet-ram-bar"></div></div><span class="mp-val" id="mp-jet-ram">—</span></div>
                <div class="mp-row"><span class="mp-label">CPU °C</span><span class="mp-val" id="mp-jet-ct">—</span></div>
                <div class="mp-row"><span class="mp-label">GPU °C</span><span class="mp-val" id="mp-jet-gt">—</span></div>
              </div>
            </div>

            <!-- V-JEPA 2 -->
            <div class="mp-card mp-card-accent">
              <div class="mp-hdr">
                <span class="mp-title">V-JEPA 2</span>
                <span class="mp-badge" id="mp-vj-badge">—</span>
              </div>
              <div class="mp-body">
                <div class="mp-row"><span class="mp-label">Status</span><span class="mp-val" id="mp-vj-status">—</span></div>
                <div class="mp-row"><span class="mp-label">FPS</span><span class="mp-val" id="mp-vj-fps">—</span></div>
                <div class="mp-row"><span class="mp-label">Latency</span><span class="mp-val" id="mp-vj-latency">—</span></div>
                <div class="mp-row"><span class="mp-label">Frames</span><span class="mp-val" id="mp-vj-frames">—</span></div>
                <div class="mp-row"><span class="mp-label">Active</span><span class="mp-val" id="mp-vj-cams">—</span></div>
                <div class="mp-row"><span class="mp-label">Infer</span><span class="mp-val" id="mp-vj-inferring">—</span></div>
                <div class="mp-row mp-row-model"><span class="mp-model" id="mp-vj-model">ViT-L · FP16 · CUDA</span></div>
              </div>
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
    // Refresh snapshots every 2s with pre-load to prevent flicker
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

    // Fetch Frigate stats every 5s — use HA proxy to avoid CORS
    const t2 = setInterval(() => this._fetchFrigate(), 5000);
    this._timers.push(t1, t2);

    // Initial snapshot load
    this._config.cameras.forEach(cam => {
      const img = this.shadowRoot.getElementById(`img-${cam.name}`);
      if (img) img.src = this._snapUrl(cam);
    });
    this._fetchFrigate();
  }

  async _fetchFrigate() {
    // Try HA proxy first (same origin, no CORS), fall back to direct
    const urls = [
      '/api/frigate/stats',
      this._config.frigate_url + '/api/stats',
    ];
    for (const url of urls) {
      try {
        const opts = url.startsWith('/') && this._hass?.auth?.data?.access_token
          ? { headers: { 'Authorization': 'Bearer ' + this._hass.auth.data.access_token } }
          : {};
        const r = await fetch(url, opts);
        if (r.ok) {
          this._frigateStats = await r.json();
          this._update();
          return;
        }
      } catch(e) { /* try next */ }
    }
    // If both fail, try hass.callApi (websocket-proxied)
    try {
      if (this._hass?.callApi) {
        this._frigateStats = await this._hass.callApi('GET', 'frigate/stats');
        this._update();
      }
    } catch(e) { /* silent */ }
  }

  // ── Update (zero-flicker: targeted DOM updates only) ──
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
      const newHTML = `<span class="dot-pulse${on ? '' : ' off'}"></span>${on ? 'Active' : 'Offline'}`;
      if (pill.innerHTML !== newHTML) {
        pill.innerHTML = newHTML;
        pill.className = 'pill-status' + (on ? '' : ' pill-off');
      }
    }
  }

  _updateCamera(cam) {
    const $ = id => this.shadowRoot.getElementById(id);
    const fStats = this._frigateStats?.cameras?.[cam.name];
    const act = this._getActivity(cam.name);

    // Status badge (top-right) — textContent only, no innerHTML
    const statusEl = $(`status-${cam.name}`);
    if (statusEl) {
      let txt, cls;
      if (act && act.person_detected) { txt = 'Person'; cls = 'ov-status ov-status-person'; }
      else if (this._isMotionDetected(cam.name)) { txt = 'Motion'; cls = 'ov-status ov-status-motion'; }
      else { txt = 'Idle'; cls = 'ov-status'; }
      if (statusEl.textContent !== txt) statusEl.textContent = txt;
      if (statusEl.className !== cls) statusEl.className = cls;
    }

    // ── V-JEPA 2 Activity Context (rendered directly) ──
    const actPanel = $(`act-panel-${cam.name}`);
    const actLabel = $(`act-label-${cam.name}`);
    const actConf = $(`act-conf-${cam.name}`);
    const actTs = $(`act-ts-${cam.name}`);
    const actSecondary = $(`act-secondary-${cam.name}`);
    const actScores = $(`act-scores-${cam.name}`);
    const actMetrics = $(`act-metrics-${cam.name}`);

    if (act && act.person_detected) {
      // Show the activity panel
      if (actPanel) actPanel.classList.add('act-visible');

      // Primary activity label
      const label = this._activityLabel(act.activity) || 'Detected';
      if (actLabel && actLabel.textContent !== label) {
        actLabel.textContent = label;
        actLabel.className = 'act-label act-label-on';
      }

      // Confidence
      if (actConf) {
        const pct = typeof act.confidence === 'number'
          ? (act.confidence > 1 ? act.confidence : act.confidence * 100) : 0;
        const confText = `${pct.toFixed(0)}%`;
        if (actConf.textContent !== confText) actConf.textContent = confText;
      }

      // Timestamp
      if (actTs) {
        const ts = this._formatTime(act.timestamp);
        if (actTs.textContent !== ts) actTs.textContent = ts;
      }

      // Secondary activity
      if (actSecondary) {
        const secLabel = act.secondary ? this._activityLabel(act.secondary) : null;
        const secConf = act.secondaryConf ? (act.secondaryConf * 100).toFixed(0) : 0;
        const secText = secLabel ? `${secLabel} ${secConf}%` : '';
        if (actSecondary.textContent !== secText) actSecondary.textContent = secText;
      }

      // Activity scores — rendered as mini bars (diff-based)
      if (actScores && act.activityScores) {
        const scoreKey = JSON.stringify(act.activityScores);
        if (this._prevActivityState[cam.name + '_scores'] !== scoreKey) {
          this._prevActivityState[cam.name + '_scores'] = scoreKey;
          const sorted = Object.entries(act.activityScores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
          const maxScore = sorted[0]?.[1] || 1;
          let html = '';
          sorted.forEach(([name, score]) => {
            const pct = Math.min(100, (score / maxScore) * 100);
            const label = name.replace(/_/g, ' ');
            html += `<div class="score-row"><span class="score-name">${label}</span><div class="score-bar"><div class="score-fill" style="width:${pct}%"></div></div><span class="score-val">${(score * 100).toFixed(0)}%</span></div>`;
          });
          actScores.innerHTML = html;
        }
      } else if (actScores) {
        if (actScores.innerHTML !== '') actScores.innerHTML = '';
      }

      // Embed / Motion / Trend
      if (actMetrics) actMetrics.style.opacity = '1';
      this._setMetricVal($(`act-embed-${cam.name}`), act.embed_change, 4, 0.01, null);
      this._setMetricVal($(`act-motion-${cam.name}`), act.motion_level, 4, 0.01, 0.03);
      const trendEl = $(`act-trend-${cam.name}`);
      if (trendEl && act.trend !== null) {
        const arrow = act.trend > 0.001 ? ' ↑' : act.trend < -0.001 ? ' ↓' : ' →';
        const tv = act.trend.toFixed(4) + arrow;
        if (trendEl.textContent !== tv) trendEl.textContent = tv;
      }

    } else {
      // No person: dim/hide activity panel
      if (actPanel) actPanel.classList.remove('act-visible');
      if (actLabel) { actLabel.textContent = ''; actLabel.className = 'act-label'; }
      if (actConf) actConf.textContent = '';
      if (actTs) actTs.textContent = '';
      if (actSecondary) actSecondary.textContent = '';
      if (actScores && actScores.innerHTML !== '') actScores.innerHTML = '';
      if (actMetrics) actMetrics.style.opacity = '0.3';
    }

    // ── Detection pills (diff-based — only update if changed) ──
    const objects = this._getDetectedObjects(cam.name);
    const sounds = this._getDetectedSounds(cam.name);
    const detectEl = $(`detect-${cam.name}`);
    if (detectEl) {
      const key = objects.join(',') + '|' + sounds.join(',');
      if (this._prevDetectHTML[cam.name] !== key) {
        this._prevDetectHTML[cam.name] = key;
        let html = '';
        objects.forEach(obj => {
          html += `<span class="det-pill">${this._getObjectLabel(obj)}</span>`;
        });
        sounds.forEach(snd => {
          html += `<span class="det-pill det-sound">${this._getSoundLabel(snd)}</span>`;
        });
        detectEl.innerHTML = html;
      }
    }

    return objects.length;
  }

  _setMetricVal(el, val, decimals, hiThresh, warnThresh) {
    if (!el) return;
    if (val !== null && val !== undefined) {
      const tv = val.toFixed(decimals);
      if (el.textContent !== tv) el.textContent = tv;
      const cls = 'act-mv' + (warnThresh && val > warnThresh ? ' val-warn' : val > hiThresh ? ' val-hi' : '');
      if (el.className !== cls) el.className = cls;
    } else {
      if (el.textContent !== '—') el.textContent = '—';
    }
  }

  _updateMetrics() {
    const h = this._hass;
    if (!h) return;
    const $ = id => this.shadowRoot.getElementById(id);
    const bar = (id, pct) => { const b = $(id); if (b) b.style.width = Math.min(100, pct || 0) + '%'; };
    const setVal = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };

    // ── Frigate ──
    const st = this._frigateStats;
    if (st.service) {
      const up = st.service.uptime || 0;
      const hrs = Math.floor(up / 3600);
      const min = Math.floor((up % 3600) / 60);
      setVal('mp-fri-uptime', hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
      const be = $('mp-fri-badge');
      if (be) { be.textContent = 'Online'; be.className = 'mp-badge badge-on'; }
    }
    if (st.cpu_usages) {
      const fs = st.cpu_usages['frigate.full_system'];
      if (fs) {
        setVal('mp-fri-cpu', (fs.cpu || 0) + '%');
        bar('mp-fri-cpu-bar', fs.cpu);
        setVal('mp-fri-mem', (fs.mem || 0) + '%');
        bar('mp-fri-mem-bar', fs.mem);
      }
    }
    let detectCount = 0;
    this._config.cameras.forEach(cam => {
      if (this._getSwitch(cam.name, 'detect')) detectCount++;
    });
    setVal('mp-fri-detect', `${detectCount}/5 cams`);

    // ── Coral TPU ──
    if (st.detectors) {
      const det = Object.values(st.detectors)[0];
      if (det) {
        setVal('mp-coral-speed', (det.inference_speed || 0).toFixed(1) + ' ms');
        setVal('mp-coral-pid', String(det.pid || '—'));
        const be = $('mp-coral-badge');
        if (be) { be.textContent = 'Online'; be.className = 'mp-badge badge-on'; }
      }
    }
    if (st.temperatures) {
      const temp = st.temperatures.apex_0 || Object.values(st.temperatures)[0];
      if (temp !== undefined) {
        const te = $('mp-coral-temp');
        if (te) { te.textContent = temp.toFixed(1) + '°C'; te.className = 'mp-val ' + this._tempClass(temp); }
      }
    }

    // ── Jetson ──
    const jSensors = {
      'sensor.jetson_cpu_usage': ['mp-jet-cpu', 'mp-jet-cpu-bar'],
      'sensor.jetson_gpu_usage': ['mp-jet-gpu', 'mp-jet-gpu-bar'],
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
      setVal('mp-jet-ram', `${used}/${tot} GB`);
      bar('mp-jet-ram-bar', pct);
    }
    ['sensor.jetson_cpu_temp', 'sensor.jetson_gpu_temp'].forEach((sid, i) => {
      const s = h.states[sid];
      const eid = i === 0 ? 'mp-jet-ct' : 'mp-jet-gt';
      if (s && s.state !== 'unavailable' && s.state !== 'unknown') {
        jetsonOnline = true;
        const e = $(eid);
        if (e) { e.textContent = s.state + '°C'; e.className = 'mp-val ' + this._tempClass(parseFloat(s.state)); }
      } else { setVal(eid, '—'); }
    });
    const jBadge = $('mp-jet-badge');
    if (jBadge) {
      if (jetsonOnline) { jBadge.textContent = 'Online'; jBadge.className = 'mp-badge badge-on'; }
      else { jBadge.textContent = '—'; jBadge.className = 'mp-badge'; }
    }

    // ── V-JEPA 2 Global ──
    const vMap = {
      'sensor.v_jepa_2_status': 'mp-vj-status',
      'sensor.v_jepa_2_fps': 'mp-vj-fps',
      'sensor.v_jepa_2_inference_latency': 'mp-vj-latency',
      'sensor.v_jepa_2_frames_processed': 'mp-vj-frames',
      'sensor.v_jepa_2_active_cameras': 'mp-vj-cams',
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
        else if (sid.includes('active')) v = v + '/5';
        setVal(eid, v);
      }
    }
    let inferCount = 0;
    this._config.cameras.forEach(cam => { if (this._isVjepaInferring(cam.name)) inferCount++; });
    setVal('mp-vj-inferring', `${inferCount}/5`);

    const vjBadge = $('mp-vj-badge');
    if (vjBadge) {
      if (vjepaOnline) { vjBadge.textContent = 'Online'; vjBadge.className = 'mp-badge badge-on'; }
      else { vjBadge.textContent = '—'; vjBadge.className = 'mp-badge'; }
    }

    const vStatus = h.states['sensor.v_jepa_2_status'];
    const modelEl = $('mp-vj-model');
    if (modelEl && vStatus?.attributes) {
      const txt = `${vStatus.attributes.model || 'ViT-L'} · ${vStatus.attributes.precision || 'FP16'} · CUDA`;
      if (modelEl.textContent !== txt) modelEl.textContent = txt;
    }
  }

  // ── CSS: Liquid Glass · Monochrome ──
  _css() {
    return `
    :host {
      --bg: #000;
      --glass: rgba(255,255,255,0.04);
      --glass-border: rgba(255,255,255,0.07);
      --glass-hover: rgba(255,255,255,0.06);
      --glass-strong: rgba(255,255,255,0.08);

      --text: rgba(255,255,255,0.92);
      --text-2: rgba(255,255,255,0.55);
      --text-3: rgba(255,255,255,0.32);
      --text-4: rgba(255,255,255,0.18);

      /* Monochrome accent — only one subtle color */
      --accent: rgba(255,255,255,0.70);
      --accent-dim: rgba(255,255,255,0.12);

      --r: 14px;
      --r-sm: 10px;
      --ease: cubic-bezier(.25,.1,.25,1);
      --blur: blur(24px);
      --blur-sm: blur(16px);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    .el-root {
      background: var(--bg);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', system-ui, sans-serif;
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header: liquid glass ── */
    .hdr {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 18px;
      background: var(--glass);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
      border-bottom: 1px solid var(--glass-border);
      flex-shrink: 0;
      z-index: 10;
    }
    .hdr-left { display: flex; flex-direction: column; gap: 1px; }
    .hdr-right { display: flex; align-items: center; gap: 20px; }
    .hdr-title { font-size: 16px; font-weight: 700; letter-spacing: -0.03em; color: var(--text); }
    .hdr-sub { font-size: 10px; color: var(--text-4); letter-spacing: 0.02em; text-transform: uppercase; }
    .hdr-stat { display: flex; flex-direction: column; align-items: center; }
    .hdr-stat-val { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
    .hdr-stat-label { font-size: 8px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.8px; }

    .pill-status {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 100px;
      background: var(--glass);
      border: 1px solid var(--glass-border);
      font-size: 10px; font-weight: 600; color: var(--text-2);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
    }
    .pill-status.pill-off { color: var(--text-4); }
    .dot-pulse {
      width: 5px; height: 5px; border-radius: 50%; background: var(--text-2);
      animation: pulse 2.5s ease-in-out infinite;
    }
    .dot-pulse.off { background: var(--text-4); animation: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.25} }

    /* ── Scrollable Camera Area ── */
    .cam-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 10px 12px;
      padding-bottom: 200px; /* space for fixed bottom pane */
      -webkit-overflow-scrolling: touch;
    }
    .cam-scroll::-webkit-scrollbar { width: 4px; }
    .cam-scroll::-webkit-scrollbar-track { background: transparent; }
    .cam-scroll::-webkit-scrollbar-thumb { background: var(--glass-border); border-radius: 4px; }

    .cam-section-label {
      font-size: 9px; font-weight: 700; color: var(--text-4);
      text-transform: uppercase; letter-spacing: 1.2px;
      padding: 8px 4px 6px;
    }

    /* ── Camera Grid ── */
    .cam-grid { display: grid; gap: 6px; }
    .cam-grid-primary { grid-template-columns: repeat(3, 1fr); margin-bottom: 4px; }
    .cam-grid-secondary { grid-template-columns: repeat(2, 1fr); }

    @media (max-width: 900px) {
      .cam-grid-primary { grid-template-columns: repeat(2, 1fr); }
      .cam-grid-primary .cam-cell:first-child { grid-column: 1 / -1; }
      .cam-grid-secondary { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 600px) {
      .cam-grid-primary, .cam-grid-secondary { grid-template-columns: 1fr; }
    }

    .cam-viewport {
      position: relative;
      background: var(--glass);
      border-radius: var(--r);
      overflow: hidden;
      aspect-ratio: 16/9;
      border: 1px solid var(--glass-border);
      transition: border-color 0.3s var(--ease);
    }
    .cam-viewport:hover { border-color: var(--glass-hover); }
    .cam-img { width: 100%; height: 100%; object-fit: cover; display: block; }

    /* Camera overlays */
    .ov-top {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 100%);
      z-index: 3;
    }
    .ov-label {
      font-size: 11px; font-weight: 650; letter-spacing: -0.01em;
      color: var(--text);
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    }
    .ov-status {
      margin-left: auto;
      font-size: 9px; font-weight: 600;
      padding: 2px 8px; border-radius: 100px;
      background: rgba(255,255,255,0.06);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
      color: var(--text-4);
      transition: all 0.3s var(--ease);
    }
    .ov-status-person { background: rgba(255,255,255,0.12); color: var(--text); }
    .ov-status-motion { background: rgba(255,255,255,0.08); color: var(--text-2); }

    /* Detection pills: monochrome */
    .ov-detect {
      position: absolute; top: 30px; left: 0; right: 0;
      z-index: 2; pointer-events: none;
      display: flex; flex-wrap: wrap; gap: 3px;
      padding: 4px 8px;
    }
    .det-pill {
      display: inline-flex; align-items: center;
      padding: 2px 7px; border-radius: 100px;
      font-size: 9px; font-weight: 600;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.10);
      color: var(--text-2);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
    }
    .det-sound { font-style: italic; }

    /* ── V-JEPA 2 Activity Overlay: liquid glass ── */
    .ov-activity {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 14px 10px 8px;
      background: linear-gradient(0deg, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.35) 70%, transparent 100%);
      z-index: 3;
      display: flex; flex-direction: column; gap: 3px;
      opacity: 0.4;
      transition: opacity 0.4s var(--ease);
    }
    .ov-activity.act-visible { opacity: 1; }

    .act-row-main { display: flex; align-items: baseline; gap: 6px; }
    .act-label {
      font-size: 12px; font-weight: 600; color: var(--text-3);
      transition: color 0.3s var(--ease);
    }
    .act-label-on { color: var(--text); }
    .act-conf {
      font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums;
      color: var(--text-2);
    }
    .act-time { font-size: 8px; color: var(--text-4); margin-left: auto; font-variant-numeric: tabular-nums; }

    .act-row-secondary {
      font-size: 9px; color: var(--text-3); font-weight: 500;
      min-height: 12px;
    }

    /* Activity scores: mini horizontal bars */
    .act-scores {
      display: flex; flex-direction: column; gap: 2px;
      padding: 2px 0;
    }
    .score-row {
      display: flex; align-items: center; gap: 4px;
    }
    .score-name {
      font-size: 8px; font-weight: 500; color: var(--text-4);
      width: 44px; flex-shrink: 0;
      text-transform: capitalize;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .score-bar {
      flex: 1; height: 2px; border-radius: 1px;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
    }
    .score-fill {
      height: 100%; border-radius: 1px;
      background: rgba(255,255,255,0.35);
      transition: width 0.4s var(--ease);
    }
    .score-val {
      font-size: 8px; font-weight: 600; color: var(--text-3);
      font-variant-numeric: tabular-nums;
      width: 24px; text-align: right; flex-shrink: 0;
    }

    .act-metrics {
      display: flex; gap: 10px;
      transition: opacity 0.4s var(--ease);
      padding-top: 2px;
    }
    .act-m { display: flex; align-items: center; gap: 3px; }
    .act-ml { font-size: 8px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.3px; }
    .act-mv {
      font-size: 9px; font-weight: 600;
      font-family: 'SF Mono', 'Menlo', 'Cascadia Code', monospace;
      color: var(--text-3); font-variant-numeric: tabular-nums;
      transition: color 0.3s var(--ease);
    }
    .act-mv.val-hi { color: var(--text-2); }
    .act-mv.val-warn { color: var(--text); }

    /* ── Fixed Bottom Metrics Pane: liquid glass ── */
    .metrics-pane {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 20;
      background: rgba(0,0,0,0.65);
      backdrop-filter: var(--blur);
      -webkit-backdrop-filter: var(--blur);
      border-top: 1px solid var(--glass-border);
      padding: 10px 12px 12px;
    }

    .metrics-inner {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
      max-width: 1600px; margin: 0 auto;
    }

    .mp-card {
      background: var(--glass);
      border: 1px solid var(--glass-border);
      border-radius: var(--r-sm);
      padding: 10px 12px;
      transition: border-color 0.3s var(--ease);
    }
    .mp-card:hover { border-color: var(--glass-hover); }
    .mp-card-accent { border-color: rgba(255,255,255,0.10); }

    .mp-hdr { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .mp-title { font-size: 10px; font-weight: 700; flex: 1; letter-spacing: -0.01em; color: var(--text-2); }
    .mp-badge {
      font-size: 8px; font-weight: 700; padding: 1px 6px; border-radius: 100px;
      background: var(--glass); color: var(--text-4);
    }
    .mp-badge.badge-on { background: rgba(255,255,255,0.08); color: var(--text-2); }

    .mp-body { display: flex; flex-direction: column; gap: 5px; }
    .mp-row { display: flex; align-items: center; gap: 6px; }
    .mp-row-model { margin-top: 3px; padding-top: 6px; border-top: 1px solid var(--glass-border); }
    .mp-label { font-size: 9px; color: var(--text-4); width: 48px; flex-shrink: 0; font-weight: 500; }
    .mp-bar { flex: 1; height: 2px; border-radius: 1px; background: rgba(255,255,255,0.04); overflow: hidden; }
    .mp-bar-fill { height: 100%; border-radius: 1px; transition: width 0.6s var(--ease); width: 0%; background: rgba(255,255,255,0.30); }
    .mp-val {
      font-size: 9px; font-weight: 600; font-variant-numeric: tabular-nums;
      color: var(--text-2); min-width: 48px; text-align: right;
    }
    .mp-val.temp-cool { color: var(--text-2); }
    .mp-val.temp-warm { color: var(--text); }
    .mp-val.temp-hot { color: var(--text); font-weight: 800; }
    .mp-model { font-size: 8px; color: var(--text-4); font-family: 'SF Mono', 'Menlo', monospace; letter-spacing: 0.2px; }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .metrics-inner { grid-template-columns: repeat(2, 1fr); }
      .cam-scroll { padding-bottom: 320px; }
    }
    @media (max-width: 600px) {
      .metrics-inner { grid-template-columns: 1fr 1fr; }
      .cam-scroll { padding-bottom: 400px; }
      .cam-grid-primary, .cam-grid-secondary { gap: 4px; }
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
  description: 'V-JEPA 2 World Model Dashboard v6'
});
