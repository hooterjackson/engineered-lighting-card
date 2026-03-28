/**
 * Engineered Lighting Card v4
 * V-JEPA 2 World Model Dashboard
 *
 * Design: Apple Liquid Glass — every data point earns its place.
 * All V-JEPA 2 inference data surfaced. Frigate bounding boxes + audio.
 * Pipeline reflects real-time state. Uniform camera grid.
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

  _snapUrl(cam) {
    // Try Frigate first (with bounding boxes), fall back to HA proxy
    if (this._failedCams.has(cam.name)) {
      return this._snapUrlHA(cam);
    }
    return `${this._config.frigate_url}/api/${cam.name}/latest.jpg?bbox=1&h=720&ts=${Date.now()}`;
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
      'potted_plant','oven','backpack','handbag','suitcase','clock'
    ];
    return objects.filter(obj => {
      const s = this._hass?.states[`binary_sensor.${camName}_${obj}_occupancy`];
      return s && s.state === 'on';
    });
  }

  _getDetectedSounds(camName) {
    const sounds = [
      'speech','music','bark','baby_crying','alarm',
      'doorbell','fire_alarm','glass_breaking','knock','yelling'
    ];
    return sounds.filter(snd => {
      const s = this._hass?.states[`binary_sensor.${camName}_${snd}_sound`];
      return s && s.state === 'on';
    });
  }

  _getObjectIcon(obj) {
    const icons = {
      person:'👤', dog:'🐕', cat:'🐈', bottle:'🍼', cup:'☕', bowl:'🥣',
      chair:'🪑', couch:'🛋', dining_table:'🍽', cell_phone:'📱', laptop:'💻',
      tv:'📺', book:'📖', remote:'🎮', potted_plant:'🌿', oven:'♨️',
      backpack:'🎒', handbag:'👜', suitcase:'🧳', clock:'🕐'
    };
    return icons[obj] || '•';
  }

  _getObjectLabel(obj) {
    return obj.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  _getSoundIcon(snd) {
    const icons = {
      speech:'🗣', music:'🎵', bark:'🐕', baby_crying:'👶', alarm:'🚨',
      doorbell:'🔔', fire_alarm:'🔥', glass_breaking:'💥', knock:'🚪', yelling:'📢'
    };
    return icons[snd] || '🔊';
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

  // ── Activity (V-JEPA 2) Helpers ──

  _getActivity(camName) {
    const s = this._hass?.states[`sensor.${camName}_activity`];
    if (!s || s.state === 'unknown' || s.state === 'unavailable') return null;
    const a = s.attributes || {};
    return {
      state: s.state,
      activity: a.activity || s.state,
      confidence: a.confidence !== undefined ? parseFloat(a.confidence) : null,
      embed_change: a.embed_change !== undefined ? parseFloat(a.embed_change) : null,
      motion_level: a.motion_level !== undefined ? parseFloat(a.motion_level) : null,
      trend: a.trend !== undefined ? parseFloat(a.trend) : null,
      person_detected: !!a.person_detected,
      timestamp: a.timestamp || null,
    };
  }

  _isVjepaInferring(camName) {
    // Only "inferring" when V-JEPA is actively processing — person detected or meaningful motion
    const act = this._getActivity(camName);
    if (!act) return false;
    return act.person_detected || (act.motion_level !== null && act.motion_level > 0.01);
  }

  _activityColor(state) {
    const m = {
      high_activity: '#ff453a', moderate_activity: '#ff9f0a',
      low_activity: '#0a84ff', idle: '#8b949e', empty: '#484f58'
    };
    return m[state] || '#8b949e';
  }

  _activityLabel(state) {
    return state ? state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';
  }

  _formatTime(iso) {
    if (!iso) return '—';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  _trendArrow(trend) {
    if (trend === null || trend === undefined) return '→';
    if (trend > 0.001) return '↑';
    if (trend < -0.001) return '↓';
    return '→';
  }

  _tempClass(t) {
    return t > 80 ? 'temp-hot' : t > 60 ? 'temp-warm' : 'temp-cool';
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
            <div>
              <div class="hdr-title">Engineered Lighting</div>
              <div class="hdr-sub">V-JEPA 2 World Model · Perception Pipeline</div>
            </div>
          </div>
          <div class="hdr-right">
            <div class="hdr-stat" id="hdr-cams">
              <span class="hdr-stat-val" id="hdr-total-objects">0</span>
              <span class="hdr-stat-label">Objects</span>
            </div>
            <div class="hdr-stat" id="hdr-detect">
              <span class="hdr-stat-val" id="hdr-total-cams">5</span>
              <span class="hdr-stat-label">Cameras</span>
            </div>
            <div class="pill-status" id="pill-status">
              <span class="dot-pulse"></span>Active
            </div>
          </div>
        </header>

        <!-- Camera Grid: uniform 5-up -->
        <div class="cam-grid">
          ${cams.map((cam) => `
          <div class="cam-cell" id="cell-${cam.name}">
            <div class="cam-viewport">
              <img class="cam-img" id="img-${cam.name}" alt="${cam.label}" />

              <!-- Top bar: label + live + FPS -->
              <div class="ov-top">
                <span class="ov-label">${cam.label}</span>
                <span class="ov-live"><span class="ov-live-dot"></span>LIVE</span>
                <span class="ov-fps" id="fps-${cam.name}"></span>
              </div>

              <!-- Detection overlay: objects + sounds -->
              <div class="ov-detect" id="detect-${cam.name}"></div>

              <!-- V-JEPA 2 full data overlay (bottom gradient) -->
              <div class="ov-bottom" id="bottom-${cam.name}">
                <!-- Row 1: Activity state + confidence -->
                <div class="vj-row vj-row-primary">
                  <span class="vj-activity-badge" id="vj-badge-${cam.name}">—</span>
                  <span class="vj-conf" id="vj-conf-${cam.name}"></span>
                  <span class="vj-person" id="vj-person-${cam.name}"></span>
                  <span class="vj-timestamp" id="vj-ts-${cam.name}"></span>
                </div>

                <!-- Row 2: V-JEPA 2 inference metrics -->
                <div class="vj-row vj-row-data">
                  <div class="vj-metric">
                    <span class="vj-metric-label">Embed Δ</span>
                    <span class="vj-metric-val mono" id="vj-embed-${cam.name}">0.0000</span>
                  </div>
                  <div class="vj-metric">
                    <span class="vj-metric-label">Motion</span>
                    <span class="vj-metric-val mono" id="vj-motion-val-${cam.name}">0.0000</span>
                  </div>
                  <div class="vj-metric">
                    <span class="vj-metric-label">Trend</span>
                    <span class="vj-metric-val mono" id="vj-trend-${cam.name}">0.0000 →</span>
                  </div>
                </div>

                <!-- Row 3: Frigate detection summary -->
                <div class="vj-row vj-row-frigate">
                  <span class="frigate-tag-label">FRIGATE</span>
                  <span class="frigate-detect-summary" id="vj-frigate-${cam.name}">—</span>
                  <span class="frigate-audio-summary" id="vj-audio-${cam.name}"></span>
                </div>

                <!-- Motion bar -->
                <div class="motion-bar">
                  <div class="motion-fill" id="motion-${cam.name}"></div>
                </div>
              </div>
            </div>

            <!-- Pipeline indicator -->
            <div class="pipeline-bar" id="pipe-${cam.name}">
              <div class="pipe-stage">
                <span class="pipe-dot on"></span>
                <span class="pipe-lbl">Camera</span>
              </div>
              <span class="pipe-arrow">→</span>
              <div class="pipe-stage">
                <span class="pipe-dot on"></span>
                <span class="pipe-lbl">go2rtc</span>
              </div>
              <span class="pipe-arrow">→</span>
              <div class="pipe-stage">
                <span class="pipe-dot" id="pipe-fri-${cam.name}"></span>
                <span class="pipe-lbl">Frigate</span>
                <span class="pipe-detail" id="pipe-fri-d-${cam.name}"></span>
              </div>
              <span class="pipe-arrow" id="pipe-arr-vj-${cam.name}">→</span>
              <div class="pipe-stage">
                <span class="pipe-dot" id="pipe-vj-${cam.name}"></span>
                <span class="pipe-lbl" id="pipe-vj-lbl-${cam.name}">V-JEPA 2</span>
                <span class="pipe-detail" id="pipe-vj-d-${cam.name}"></span>
              </div>
              <span class="pipe-arrow">→</span>
              <div class="pipe-stage">
                <span class="pipe-dot" id="pipe-mqtt-${cam.name}"></span>
                <span class="pipe-lbl">MQTT</span>
              </div>
              <span class="pipe-arrow">→</span>
              <div class="pipe-stage">
                <span class="pipe-dot on"></span>
                <span class="pipe-lbl">HA</span>
              </div>
            </div>
          </div>
          `).join('')}
        </div>

        <!-- System Metrics -->
        <div class="metrics-grid">
          <!-- Frigate NVR -->
          <div class="m-card">
            <div class="m-hdr">
              <span class="m-icon m-icon-frigate">◈</span>
              <span class="m-title">Frigate NVR</span>
              <span class="m-badge" id="m-fri-badge">—</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">CPU</span><div class="m-bar"><div class="m-bar-fill bar-blue" id="m-fri-cpu-bar"></div></div><span class="m-val" id="m-fri-cpu">—</span></div>
              <div class="m-row"><span class="m-label">Memory</span><div class="m-bar"><div class="m-bar-fill bar-teal" id="m-fri-mem-bar"></div></div><span class="m-val" id="m-fri-mem">—</span></div>
              <div class="m-row"><span class="m-label">Uptime</span><span class="m-val" id="m-fri-uptime">—</span></div>
              <div class="m-row"><span class="m-label">Detect</span><span class="m-val" id="m-fri-detect">—</span></div>
              <div class="m-row"><span class="m-label">Motion</span><span class="m-val" id="m-fri-motion">—</span></div>
              <div class="m-row"><span class="m-label">Audio</span><span class="m-val" id="m-fri-audio">—</span></div>
            </div>
          </div>

          <!-- Coral TPU -->
          <div class="m-card">
            <div class="m-hdr">
              <span class="m-icon m-icon-coral">▲</span>
              <span class="m-title">Coral TPU</span>
              <span class="m-badge" id="m-coral-badge">—</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">Inference</span><span class="m-val" id="m-coral-speed">—</span></div>
              <div class="m-row"><span class="m-label">Temp</span><span class="m-val temp" id="m-coral-temp">—</span></div>
              <div class="m-row"><span class="m-label">Detection</span><span class="m-val" id="m-coral-detect">—</span></div>
              <div class="m-row"><span class="m-label">PID</span><span class="m-val" id="m-coral-pid">—</span></div>
            </div>
          </div>

          <!-- Jetson Orin Nano -->
          <div class="m-card">
            <div class="m-hdr">
              <span class="m-icon m-icon-jetson">⬡</span>
              <span class="m-title">Jetson Orin Nano</span>
              <span class="m-badge" id="m-jet-badge">Offline</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">CPU</span><div class="m-bar"><div class="m-bar-fill bar-blue" id="m-jet-cpu-bar"></div></div><span class="m-val" id="m-jet-cpu">—</span></div>
              <div class="m-row"><span class="m-label">GPU</span><div class="m-bar"><div class="m-bar-fill bar-purple" id="m-jet-gpu-bar"></div></div><span class="m-val" id="m-jet-gpu">—</span></div>
              <div class="m-row"><span class="m-label">RAM</span><div class="m-bar"><div class="m-bar-fill bar-teal" id="m-jet-ram-bar"></div></div><span class="m-val" id="m-jet-ram">—</span></div>
              <div class="m-row"><span class="m-label">CPU Temp</span><span class="m-val temp" id="m-jet-ct">—</span></div>
              <div class="m-row"><span class="m-label">GPU Temp</span><span class="m-val temp" id="m-jet-gt">—</span></div>
            </div>
          </div>

          <!-- V-JEPA 2 Global -->
          <div class="m-card">
            <div class="m-hdr">
              <span class="m-icon m-icon-vjepa">◉</span>
              <span class="m-title">V-JEPA 2</span>
              <span class="m-badge" id="m-vj-badge">Offline</span>
            </div>
            <div class="m-body">
              <div class="m-row"><span class="m-label">Status</span><span class="m-val" id="m-vj-status">—</span></div>
              <div class="m-row"><span class="m-label">FPS</span><span class="m-val" id="m-vj-fps">—</span></div>
              <div class="m-row"><span class="m-label">Latency</span><span class="m-val" id="m-vj-latency">—</span></div>
              <div class="m-row"><span class="m-label">Frames</span><span class="m-val" id="m-vj-frames">—</span></div>
              <div class="m-row"><span class="m-label">Active</span><span class="m-val" id="m-vj-cams">—</span></div>
              <div class="m-row"><span class="m-label">Inferring</span><span class="m-val" id="m-vj-inferring">—</span></div>
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
    // Refresh snapshots every 2s
    const t1 = setInterval(() => {
      this._config.cameras.forEach(cam => {
        const img = this.shadowRoot.getElementById(`img-${cam.name}`);
        if (img) img.src = this._snapUrl(cam);
      });
    }, 2000);
    // Fetch Frigate stats every 5s
    const t2 = setInterval(() => this._fetchFrigate(), 5000);
    this._timers.push(t1, t2);
    // Initial loads
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
    let inferringCount = 0;
    this._config.cameras.forEach(cam => {
      totalObjects += this._updateCamera(cam);
      if (this._isVjepaInferring(cam.name)) inferringCount++;
    });
    this._updateMetrics();

    // Header stats
    const te = this.shadowRoot.getElementById('hdr-total-objects');
    if (te) te.textContent = totalObjects;
  }

  _updateCamera(cam) {
    const $ = id => this.shadowRoot.getElementById(id);
    const h = this._hass;
    const fStats = this._frigateStats?.cameras?.[cam.name];

    // ── V-JEPA 2 activity data ──
    const act = this._getActivity(cam.name);
    const inferring = this._isVjepaInferring(cam.name);

    // Activity badge
    const badge = $(`vj-badge-${cam.name}`);
    if (badge && act) {
      badge.textContent = this._activityLabel(act.state);
      badge.style.backgroundColor = this._activityColor(act.state);
      badge.style.color = '#fff';
    } else if (badge) {
      badge.textContent = '—';
      badge.style.backgroundColor = 'rgba(255,255,255,0.06)';
      badge.style.color = '#8b949e';
    }

    // Confidence
    const confEl = $(`vj-conf-${cam.name}`);
    if (confEl && act && act.confidence !== null) {
      const pct = (act.confidence * 100).toFixed(0);
      confEl.textContent = `${pct}%`;
      confEl.className = 'vj-conf ' + (act.confidence > 0.8 ? 'conf-hi' : act.confidence > 0.5 ? 'conf-md' : 'conf-lo');
    } else if (confEl) {
      confEl.textContent = '';
    }

    // Person detected
    const personEl = $(`vj-person-${cam.name}`);
    if (personEl) {
      if (act && act.person_detected) {
        personEl.textContent = '👤 Detected';
        personEl.className = 'vj-person active';
      } else {
        personEl.textContent = '';
        personEl.className = 'vj-person';
      }
    }

    // Timestamp
    const tsEl = $(`vj-ts-${cam.name}`);
    if (tsEl && act) {
      tsEl.textContent = this._formatTime(act.timestamp);
    }

    // Embed change
    const embedEl = $(`vj-embed-${cam.name}`);
    if (embedEl && act && act.embed_change !== null) {
      embedEl.textContent = act.embed_change.toFixed(4);
      embedEl.className = 'vj-metric-val mono' + (act.embed_change > 0.01 ? ' val-active' : '');
    }

    // Motion level
    const motionValEl = $(`vj-motion-val-${cam.name}`);
    if (motionValEl && act && act.motion_level !== null) {
      motionValEl.textContent = act.motion_level.toFixed(4);
      motionValEl.className = 'vj-metric-val mono' + (act.motion_level > 0.03 ? ' val-warn' : act.motion_level > 0.01 ? ' val-active' : '');
    }

    // Trend
    const trendEl = $(`vj-trend-${cam.name}`);
    if (trendEl && act && act.trend !== null) {
      trendEl.textContent = `${act.trend.toFixed(4)} ${this._trendArrow(act.trend)}`;
    }

    // Motion bar
    const motionBar = $(`motion-${cam.name}`);
    if (motionBar && act && act.motion_level !== null) {
      const pct = Math.min(100, act.motion_level * 100);
      motionBar.style.width = pct + '%';
      motionBar.className = 'motion-fill' + (pct > 30 ? ' motion-hi' : pct > 10 ? ' motion-md' : '');
    }

    // ── Frigate detection overlay ──
    const objects = this._getDetectedObjects(cam.name);
    const sounds = this._getDetectedSounds(cam.name);
    const detectEl = $(`detect-${cam.name}`);
    let objectCount = objects.length;

    if (detectEl) {
      let html = '';
      objects.forEach(obj => {
        const cls = obj === 'person' ? 'det-person' : (obj === 'dog' || obj === 'cat') ? 'det-animal' : 'det-object';
        html += `<span class="det-pill ${cls}">${this._getObjectIcon(obj)} ${this._getObjectLabel(obj)}</span>`;
      });
      sounds.forEach(snd => {
        html += `<span class="det-pill det-sound">${this._getSoundIcon(snd)} ${this._getSoundLabel(snd)}</span>`;
      });
      // Motion indicator
      if (this._isMotionDetected(cam.name)) {
        html += `<span class="det-pill det-motion">◎ Motion</span>`;
      }
      detectEl.innerHTML = html;
    }

    // Frigate summary in bottom overlay
    const frigSummary = $(`vj-frigate-${cam.name}`);
    if (frigSummary && fStats) {
      const dfps = fStats.detection_fps || 0;
      const cfps = fStats.camera_fps || 0;
      if (dfps > 0) {
        frigSummary.textContent = `${dfps.toFixed(1)} det/s · ${cfps.toFixed(0)} fps`;
        frigSummary.className = 'frigate-detect-summary active';
      } else {
        frigSummary.textContent = fStats.detection_enabled ? `Monitoring · ${cfps.toFixed(0)} fps` : 'Off';
        frigSummary.className = 'frigate-detect-summary';
      }
    } else if (frigSummary) {
      frigSummary.textContent = '—';
    }

    // Audio summary
    const audioSummary = $(`vj-audio-${cam.name}`);
    if (audioSummary) {
      if (sounds.length > 0) {
        audioSummary.textContent = `🔊 ${sounds.map(s => this._getSoundLabel(s)).join(', ')}`;
        audioSummary.className = 'frigate-audio-summary active';
      } else if (fStats && fStats.audio_dBFS !== undefined && fStats.audio_dBFS > -100) {
        audioSummary.textContent = `${fStats.audio_dBFS.toFixed(0)} dBFS`;
        audioSummary.className = 'frigate-audio-summary';
      } else {
        audioSummary.textContent = '';
      }
    }

    // FPS in top bar
    const fpsEl = $(`fps-${cam.name}`);
    if (fpsEl && fStats) {
      const fps = fStats.camera_fps || 0;
      fpsEl.textContent = fps > 0 ? `${fps.toFixed(0)} fps` : '';
    }

    // ── Pipeline ──
    const frigateOn = this._getSwitch(cam.name, 'detect');
    const pipeFri = $(`pipe-fri-${cam.name}`);
    const pipeFriD = $(`pipe-fri-d-${cam.name}`);
    const pipeVj = $(`pipe-vj-${cam.name}`);
    const pipeVjD = $(`pipe-vj-d-${cam.name}`);
    const pipeVjLbl = $(`pipe-vj-lbl-${cam.name}`);
    const pipeArrVj = $(`pipe-arr-vj-${cam.name}`);
    const pipeMqtt = $(`pipe-mqtt-${cam.name}`);

    if (pipeFri) pipeFri.className = 'pipe-dot' + (frigateOn ? ' on fri-on' : '');
    if (pipeFriD) {
      const dfps = fStats ? (fStats.detection_fps || 0) : 0;
      pipeFriD.textContent = frigateOn ? (dfps > 0 ? `${dfps.toFixed(1)} d/s` : 'idle') : '';
    }

    // V-JEPA pipeline: only "inferring" when actually active
    if (pipeVj) pipeVj.className = 'pipe-dot' + (inferring ? ' on vj-on pulse' : act ? ' on vj-idle' : '');
    if (pipeVjD) pipeVjD.textContent = inferring ? 'inferring' : (act ? 'idle' : '');
    if (pipeVjLbl) pipeVjLbl.textContent = 'V-JEPA 2';
    if (pipeArrVj) pipeArrVj.className = 'pipe-arrow' + (inferring ? ' arrow-active' : '');
    if (pipeMqtt) pipeMqtt.className = 'pipe-dot' + (act ? ' on mqtt-on' : '');

    return objectCount;
  }

  _updateMetrics() {
    const h = this._hass;
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

    // Frigate per-camera summary
    let detectCount = 0, motionCount = 0, audioCount = 0;
    this._config.cameras.forEach(cam => {
      if (this._getSwitch(cam.name, 'detect')) detectCount++;
      if (this._getSwitch(cam.name, 'motion')) motionCount++;
      if (this._getSwitch(cam.name, 'audio_detection')) audioCount++;
    });
    setVal('m-fri-detect', `${detectCount}/5 cams`);
    setVal('m-fri-motion', `${motionCount}/5 cams`);
    setVal('m-fri-audio', `${audioCount}/5 cams`);

    // ── Coral TPU ──
    if (st.detectors) {
      const det = Object.values(st.detectors)[0];
      if (det) {
        setVal('m-coral-speed', (det.inference_speed || 0).toFixed(1) + ' ms');
        setVal('m-coral-detect', det.detection_start ? det.detection_start.toFixed(1) + ' ms' : 'Idle');
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
      } else {
        setVal(eid, '—');
      }
    });
    const jStatus = h.states['sensor.jetson_status'];
    if ((jStatus && jStatus.state !== 'unavailable' && jStatus.state !== 'unknown') || jetsonOnline) {
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
        if (sid.includes('fps')) v += ' fps';
        else if (sid.includes('latency')) v += ' ms';
        else if (sid.includes('frames')) v = parseInt(v).toLocaleString();
        setVal(eid, v);
      }
    }

    // Count cameras currently inferring
    let inferCount = 0;
    this._config.cameras.forEach(cam => { if (this._isVjepaInferring(cam.name)) inferCount++; });
    setVal('m-vj-inferring', `${inferCount}/5 cams`);

    if (vjepaOnline) {
      const be = $('m-vj-badge');
      if (be) { be.textContent = 'Online'; be.className = 'm-badge badge-on'; }
    }
  }

  // ── CSS ──

  _css() {
    return `
    :host {
      /* Apple Liquid Glass palette */
      --bg: #000000;
      --surface: #0c0c0e;
      --surface-2: #141416;
      --surface-3: #1c1c1e;
      --glass: rgba(255,255,255,0.03);
      --glass-border: rgba(255,255,255,0.06);
      --glass-hover: rgba(255,255,255,0.05);

      --text: #f5f5f7;
      --text-2: rgba(255,255,255,0.7);
      --text-3: rgba(255,255,255,0.45);
      --text-4: rgba(255,255,255,0.25);

      --teal: #30d5c8;
      --blue: #0a84ff;
      --green: #30d158;
      --amber: #ffd60a;
      --red: #ff453a;
      --orange: #ff9f0a;
      --purple: #bf5af2;
      --pink: #ff375f;

      --r: 10px;
      --r-sm: 6px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      background: var(--bg);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', system-ui, sans-serif;
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
    }

    /* ── Header ── */
    .hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--glass-border);
    }
    .hdr-left { display: flex; align-items: center; gap: 12px; }
    .hdr-right { display: flex; align-items: center; gap: 16px; }
    .logo {
      width: 32px; height: 32px; border-radius: 8px;
      background: linear-gradient(135deg, var(--teal) 0%, var(--blue) 100%);
      display: flex; align-items: center; justify-content: center;
      font: 800 12px/1 system-ui; color: #fff; letter-spacing: -0.5px;
    }
    .hdr-title { font-size: 16px; font-weight: 700; letter-spacing: -0.02em; }
    .hdr-sub { font-size: 11px; color: var(--text-3); margin-top: 1px; letter-spacing: -0.01em; }

    .hdr-stat { display: flex; flex-direction: column; align-items: center; }
    .hdr-stat-val { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
    .hdr-stat-label { font-size: 9px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.5px; }

    .pill-status {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 100px;
      background: rgba(48,209,88,0.08); border: 1px solid rgba(48,209,88,0.12);
      font-size: 11px; font-weight: 600; color: var(--green);
    }
    .dot-pulse {
      width: 6px; height: 6px; border-radius: 50%; background: var(--green);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.25} }

    /* ── Camera Grid: all 5 uniform ── */
    .cam-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      padding: 2px;
    }
    .cam-cell:nth-child(4),
    .cam-cell:nth-child(5) {
      grid-column: span 1;
    }
    @media (min-width: 900px) {
      .cam-grid {
        grid-template-columns: repeat(6, 1fr);
      }
      .cam-cell:nth-child(1),
      .cam-cell:nth-child(2),
      .cam-cell:nth-child(3) { grid-column: span 2; }
      .cam-cell:nth-child(4) { grid-column: 1 / 4; }
      .cam-cell:nth-child(5) { grid-column: 4 / 7; }
    }

    .cam-viewport {
      position: relative;
      background: var(--surface);
      border-radius: var(--r);
      overflow: hidden;
      aspect-ratio: 16/9;
    }
    .cam-img {
      width: 100%; height: 100%;
      object-fit: cover; display: block;
    }

    /* ── Top overlay ── */
    .ov-top {
      position: absolute; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      background: linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%);
      z-index: 3;
    }
    .ov-label { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; text-shadow: 0 1px 4px rgba(0,0,0,0.9); }
    .ov-live {
      display: flex; align-items: center; gap: 4px;
      font-size: 9px; font-weight: 800; letter-spacing: 0.5px;
      padding: 2px 7px; border-radius: 4px;
      background: rgba(255,55,95,0.85);
    }
    .ov-live-dot { width: 5px; height: 5px; border-radius: 50%; background: #fff; animation: pulse 1.2s infinite; }
    .ov-fps { margin-left: auto; font-size: 10px; color: var(--text-3); font-variant-numeric: tabular-nums; }

    /* ── Detection overlay (mid-frame) ── */
    .ov-detect {
      position: absolute; top: 34px; left: 0; right: 0;
      z-index: 2; pointer-events: none;
      display: flex; flex-wrap: wrap; gap: 4px;
      padding: 4px 8px;
    }
    .det-pill {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 2px 8px; border-radius: 100px;
      font-size: 10px; font-weight: 600;
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    }
    .det-person {
      background: rgba(48,209,88,0.2); border: 1px solid rgba(48,209,88,0.35);
      color: var(--green);
    }
    .det-animal {
      background: rgba(255,159,10,0.2); border: 1px solid rgba(255,159,10,0.35);
      color: var(--orange);
    }
    .det-object {
      background: rgba(10,132,255,0.2); border: 1px solid rgba(10,132,255,0.35);
      color: var(--blue);
    }
    .det-sound {
      background: rgba(191,90,242,0.2); border: 1px solid rgba(191,90,242,0.35);
      color: var(--purple);
    }
    .det-motion {
      background: rgba(48,213,200,0.15); border: 1px solid rgba(48,213,200,0.3);
      color: var(--teal);
    }

    /* ── Bottom overlay: V-JEPA 2 data ── */
    .ov-bottom {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 10px 10px 6px;
      background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 60%, transparent 100%);
      z-index: 3;
      display: flex; flex-direction: column; gap: 4px;
    }

    .vj-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

    .vj-row-primary { gap: 8px; }
    .vj-activity-badge {
      padding: 2px 10px; border-radius: 100px;
      font-size: 10px; font-weight: 700;
      background: rgba(255,255,255,0.06); color: var(--text-3);
      transition: all 0.3s ease;
    }
    .vj-conf { font-size: 10px; font-weight: 700; }
    .conf-hi { color: var(--green); }
    .conf-md { color: var(--amber); }
    .conf-lo { color: var(--red); }
    .vj-person { font-size: 10px; font-weight: 700; color: var(--text-4); }
    .vj-person.active { color: var(--green); text-shadow: 0 0 8px rgba(48,209,88,0.4); }
    .vj-timestamp { font-size: 9px; color: var(--text-4); margin-left: auto; font-variant-numeric: tabular-nums; }

    .vj-row-data { gap: 12px; }
    .vj-metric { display: flex; align-items: center; gap: 4px; }
    .vj-metric-label { font-size: 9px; font-weight: 600; color: var(--text-4); text-transform: uppercase; letter-spacing: 0.3px; }
    .vj-metric-val { font-size: 10px; font-weight: 600; color: var(--text-3); }
    .vj-metric-val.val-active { color: var(--teal); }
    .vj-metric-val.val-warn { color: var(--amber); }
    .mono { font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace; font-size: 10px; }

    .vj-row-frigate { gap: 6px; }
    .frigate-tag-label {
      font-size: 8px; font-weight: 800; letter-spacing: 0.5px;
      color: rgba(10,132,255,0.6);
    }
    .frigate-detect-summary { font-size: 10px; font-weight: 600; color: var(--text-4); }
    .frigate-detect-summary.active { color: var(--blue); }
    .frigate-audio-summary { font-size: 10px; font-weight: 600; color: var(--text-4); margin-left: auto; }
    .frigate-audio-summary.active { color: var(--purple); }

    .motion-bar {
      height: 2px; background: rgba(255,255,255,0.04); border-radius: 1px;
      overflow: hidden; margin-top: 2px;
    }
    .motion-fill {
      height: 100%; border-radius: 1px;
      background: var(--teal); transition: width 0.6s ease;
      width: 0%;
    }
    .motion-fill.motion-md { background: var(--amber); }
    .motion-fill.motion-hi { background: var(--red); }

    /* ── Pipeline Bar ── */
    .pipeline-bar {
      display: flex; align-items: center; gap: 3px;
      padding: 5px 10px;
      background: var(--surface);
      border-radius: 0 0 var(--r) var(--r);
      border-top: 1px solid var(--glass-border);
      margin-top: -1px;
    }
    .pipe-stage { display: flex; align-items: center; gap: 3px; }
    .pipe-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--text-4); transition: all 0.3s;
      flex-shrink: 0;
    }
    .pipe-dot.on { background: var(--green); box-shadow: 0 0 4px rgba(48,209,88,0.3); }
    .pipe-dot.fri-on { background: var(--blue); box-shadow: 0 0 4px rgba(10,132,255,0.3); }
    .pipe-dot.vj-on { background: var(--teal); box-shadow: 0 0 6px rgba(48,213,200,0.4); }
    .pipe-dot.vj-idle { background: var(--text-4); box-shadow: none; }
    .pipe-dot.mqtt-on { background: var(--purple); box-shadow: 0 0 4px rgba(191,90,242,0.3); }
    .pipe-dot.pulse { animation: dotpulse 1.5s infinite; }
    @keyframes dotpulse { 0%,100%{box-shadow:0 0 4px rgba(48,213,200,.3)} 50%{box-shadow:0 0 12px rgba(48,213,200,.7)} }
    .pipe-lbl { font-size: 9px; color: var(--text-4); font-weight: 600; }
    .pipe-detail { font-size: 8px; color: var(--text-3); font-variant-numeric: tabular-nums; }
    .pipe-arrow { font-size: 9px; color: var(--text-4); margin: 0 1px; transition: color 0.3s; }
    .pipe-arrow.arrow-active { color: var(--teal); }

    /* ── Metrics Grid ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2px;
      padding: 2px;
      margin-top: 2px;
    }
    .m-card {
      background: var(--surface);
      border-radius: var(--r);
      padding: 12px 14px;
      border: 1px solid var(--glass-border);
    }
    .m-hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .m-icon {
      width: 22px; height: 22px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px;
    }
    .m-icon-frigate { background: rgba(10,132,255,0.1); color: var(--blue); }
    .m-icon-coral { background: rgba(255,55,95,0.1); color: var(--pink); }
    .m-icon-jetson { background: rgba(48,209,88,0.1); color: var(--green); }
    .m-icon-vjepa { background: rgba(48,213,200,0.1); color: var(--teal); }
    .m-title { font-size: 12px; font-weight: 700; flex: 1; letter-spacing: -0.01em; }
    .m-badge {
      font-size: 9px; font-weight: 700; padding: 2px 8px;
      border-radius: 100px;
      background: rgba(255,255,255,0.04); color: var(--text-4);
    }
    .m-badge.badge-on { background: rgba(48,209,88,0.1); color: var(--green); }
    .m-body { display: flex; flex-direction: column; gap: 6px; }
    .m-row { display: flex; align-items: center; gap: 8px; }
    .m-label { font-size: 10px; color: var(--text-4); width: 60px; flex-shrink: 0; font-weight: 500; }
    .m-bar { flex: 1; height: 3px; background: rgba(255,255,255,0.04); border-radius: 2px; overflow: hidden; }
    .m-bar-fill { height: 100%; border-radius: 2px; transition: width 0.6s ease; width: 0%; }
    .bar-blue { background: var(--blue); }
    .bar-teal { background: var(--teal); }
    .bar-purple { background: var(--purple); }
    .bar-green { background: var(--green); }
    .m-val {
      font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
      color: var(--text-2); min-width: 50px; text-align: right;
    }
    .m-val.temp.temp-cool { color: var(--green); }
    .m-val.temp.temp-warm { color: var(--amber); }
    .m-val.temp.temp-hot { color: var(--red); }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .cam-grid { grid-template-columns: repeat(2, 1fr); }
      .cam-cell:nth-child(5) { grid-column: 1 / -1; }
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 600px) {
      .cam-grid { grid-template-columns: 1fr; }
      .metrics-grid { grid-template-columns: 1fr; }
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
  description: 'V-JEPA 2 World Model Dashboard v4'
});
