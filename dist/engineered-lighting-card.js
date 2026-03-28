/**
 * Engineered Lighting Card — V-JEPA 2 World Model Dashboard
 * Video-first layout with context overlays from V-JEPA 2 + Frigate
 */

class EngineeredLightingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = {};
    this._refreshTimers = [];
    this._selectedCamera = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot.querySelector('.el-root')) {
      this._render();
    }
    this._updateData();
  }

  setConfig(config) {
    this._config = {
      frigate_url: config.frigate_url || '/api/frigate',
      frigate_direct_url: config.frigate_direct_url || 'http://192.168.175.114:5000',
      cameras: config.cameras || [
        { name: 'living_room', label: 'Living Room' },
        { name: 'dining_room', label: 'Dining Room' },
        { name: 'kitchen', label: 'Kitchen' },
        { name: 'back_door', label: 'Back Door' },
        { name: 'driveway', label: 'Driveway' }
      ],
      refresh_interval: config.refresh_interval || 1000,
      ...config
    };
  }

  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() {
    return {
      frigate_direct_url: 'http://192.168.175.114:5000',
      cameras: [
        { name: 'living_room', label: 'Living Room' },
        { name: 'dining_room', label: 'Dining Room' },
        { name: 'kitchen', label: 'Kitchen' },
        { name: 'back_door', label: 'Back Door' },
        { name: 'driveway', label: 'Driveway' }
      ]
    };
  }

  getCardSize() { return 12; }

  disconnectedCallback() {
    this._refreshTimers.forEach(t => clearInterval(t));
    this._refreshTimers = [];
  }

  _render() {
    const cameras = this._config.cameras;
    const cameraCards = cameras.map((cam, i) => `
      <div class="camera-card" data-camera="${cam.name}" id="cam-${cam.name}">
        <div class="camera-feed">
          <img class="camera-img" id="img-${cam.name}"
               src="${this._config.frigate_direct_url}/api/${cam.name}/latest.jpg?h=720&ts=${Date.now()}"
               alt="${cam.label}" />
          <div class="camera-overlay">
            <div class="overlay-top">
              <span class="camera-label">${cam.label}</span>
              <span class="camera-status" id="status-${cam.name}">
                <span class="status-dot"></span> LIVE
              </span>
            </div>
            <div class="overlay-context" id="context-${cam.name}">
              <div class="vjepa-context" id="vjepa-${cam.name}">
                <span class="context-badge vjepa-badge">V-JEPA 2</span>
                <span class="context-label" id="vjepa-label-${cam.name}">Waiting for inference...</span>
                <span class="context-conf" id="vjepa-conf-${cam.name}"></span>
              </div>
              <div class="frigate-context" id="frigate-${cam.name}">
                <span class="context-badge frigate-badge">Frigate</span>
                <span class="context-label" id="frigate-label-${cam.name}">—</span>
              </div>
            </div>
            <div class="overlay-bottom">
              <div class="detection-chips" id="chips-${cam.name}"></div>
              <button class="expand-btn" data-camera="${cam.name}" title="Expand">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    this.shadowRoot.innerHTML = `
      <style>${this._getStyles()}</style>
      <div class="el-root">
        <header class="el-header">
          <div class="header-left">
            <h1 class="title">Engineered Lighting</h1>
            <span class="subtitle">V-JEPA 2 World Model</span>
          </div>
          <div class="header-right">
            <div class="system-indicator" id="system-status">
              <span class="indicator-dot active"></span>
              <span>Active</span>
            </div>
          </div>
        </header>

        <div class="camera-grid" id="camera-grid">
          ${cameraCards}
        </div>

        <div class="expanded-view" id="expanded-view" style="display:none;">
          <div class="expanded-feed">
            <img class="expanded-img" id="expanded-img" />
            <div class="camera-overlay expanded-overlay">
              <div class="overlay-top">
                <span class="camera-label" id="expanded-label"></span>
                <button class="close-btn" id="close-expanded" title="Close">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
              <div class="overlay-context expanded-context" id="expanded-context">
                <div class="vjepa-context">
                  <span class="context-badge vjepa-badge">V-JEPA 2</span>
                  <span class="context-label" id="expanded-vjepa-label">—</span>
                  <span class="context-conf" id="expanded-vjepa-conf"></span>
                </div>
                <div class="frigate-context">
                  <span class="context-badge frigate-badge">Frigate</span>
                  <span class="context-label" id="expanded-frigate-label">—</span>
                </div>
              </div>
              <div class="overlay-bottom">
                <div class="detection-chips" id="expanded-chips"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="metrics-bar" id="metrics-bar">
          <button class="metrics-toggle" id="metrics-toggle">
            <span>System Metrics</span>
            <svg class="toggle-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <div class="metrics-panel" id="metrics-panel" style="display:none;">
            <div class="metrics-grid">
              <div class="metric-group">
                <h3 class="metric-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ecdc4" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                  Coral TPU
                </h3>
                <div class="metric-row">
                  <span class="metric-name">Inference Speed</span>
                  <span class="metric-value" id="m-coral-speed">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Temperature</span>
                  <span class="metric-value" id="m-coral-temp">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Detection Start</span>
                  <span class="metric-value" id="m-coral-detect">—</span>
                </div>
              </div>
              <div class="metric-group">
                <h3 class="metric-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffd93d" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                  GPU (Intel VAAPI)
                </h3>
                <div class="metric-row">
                  <span class="metric-name">GPU Usage</span>
                  <span class="metric-value" id="m-gpu-usage">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">GPU Memory</span>
                  <span class="metric-value" id="m-gpu-mem">—</span>
                </div>
              </div>
              <div class="metric-group">
                <h3 class="metric-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                  Frigate System
                </h3>
                <div class="metric-row">
                  <span class="metric-name">CPU Usage</span>
                  <span class="metric-value" id="m-frigate-cpu">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Memory</span>
                  <span class="metric-value" id="m-frigate-mem">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Uptime</span>
                  <span class="metric-value" id="m-frigate-uptime">—</span>
                </div>
              </div>
              <div class="metric-group">
                <h3 class="metric-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                  Processes
                </h3>
                <div class="metric-row">
                  <span class="metric-name">go2rtc</span>
                  <span class="metric-value" id="m-proc-go2rtc">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Recording</span>
                  <span class="metric-value" id="m-proc-recording">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Embeddings</span>
                  <span class="metric-value" id="m-proc-embeddings">—</span>
                </div>
              </div>
              <div class="metric-group">
                <h3 class="metric-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/></svg>
                  Storage
                </h3>
                <div class="metric-row">
                  <span class="metric-name">Recordings</span>
                  <span class="metric-value" id="m-stor-recordings">—</span>
                </div>
                <div class="metric-row">
                 <span class="metric-name">SHM</span>
                  <span class="metric-value" id="m-stor-shm">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Cache</span>
                  <span class="metric-value" id="m-stor-cache">—</span>
                </div>
              </div>
              <div class="metric-group" id="jetson-metrics">
                <h3 class="metric-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>
                  Jetson Orin Nano
                </h3>
                <div class="metric-row">
                  <span class="metric-name">CPU</span>
                  <span class="metric-value" id="m-jetson-cpu">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">GPU</span>
                  <span class="metric-value" id="m-jetson-gpu">—</span>
                </div>
                <div class="metric-row">
                  <span class="metric-name">Temperature</span>
                  <span class="metric-value" id="m-jetson-temp">—</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
    this._startRefresh();
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll('.expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._expandCamera(btn.dataset.camera);
      });
    });

    const closeBtn = this.shadowRoot.getElementById('close-expanded');
    if (closeBtn) closeBtn.addEventListener('click', () => this._collapseCamera());

    const toggle = this.shadowRoot.getElementById('metrics-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const panel = this.shadowRoot.getElementById('metrics-panel');
        const arrow = toggle.querySelector('.toggle-arrow');
        if (panel.style.display === 'none') {
          panel.style.display = 'block';
          arrow.style.transform = 'rotate(180deg)';
        } else {
          panel.style.display = 'none';
          arrow.style.transform = '';
        }
      });
    }

    this.shadowRoot.querySelectorAll('.camera-card').forEach(card => {
      card.addEventListener('click', () => {
        this._expandCamera(card.dataset.camera);
      });
    });
  }

  _expandCamera(name) {
    this._selectedCamera = name;
    const cam = this._config.cameras.find(c => c.name === name);
    const grid = this.shadowRoot.getElementById('camera-grid');
    const expanded = this.shadowRoot.getElementById('expanded-view');
    const img = this.shadowRoot.getElementById('expanded-img');
    const label = this.shadowRoot.getElementById('expanded-label');

    grid.style.display = 'none';
    expanded.style.display = 'block';
    label.textContent = cam ? cam.label : name;
    img.src = `${this._config.frigate_direct_url}/api/${name}/latest.jpg?h=1080&ts=${Date.now()}`;
  }

  _collapseCamera() {
    this._selectedCamera = null;
    const grid = this.shadowRoot.getElementById('camera-grid');
    const expanded = this.shadowRoot.getElementById('expanded-view');
    grid.style.display = '';
    expanded.style.display = 'none';
  }

  _startRefresh() {
    const timer = setInterval(() => {
      const ts = Date.now();
      this._config.cameras.forEach(cam => {
        const img = this.shadowRoot.getElementById(`img-${cam.name}`);
        if (img) img.src = `${this._config.frigate_direct_url}/api/${cam.name}/latest.jpg?h=720&ts=${ts}`;
      });
      if (this._selectedCamera) {
        const eimg = this.shadowRoot.getElementById('expanded-img');
        if (eimg) eimg.src = `${this._config.frigate_direct_url}/api/${this._selectedCamera}/latest.jpg?h=1080&ts=${ts}`;
      }
    }, this._config.refresh_interval);
    this._refreshTimers.push(timer);

    const statsTimer = setInterval(() => this._fetchFrigateStats(), 5000);
    this._refreshTimers.push(statsTimer);
    this._fetchFrigateStats();
  }

  async _fetchFrigateStats() {
    try {
      const resp = await fetch(`${this._config.frigate_direct_url}/api/stats`);
      if (!resp.ok) return;
      const stats = await resp.json();
      this._updateFrigateMetrics(stats);
      this._updateCameraDetections(stats);
    } catch (e) { /* silent */ }
  }

  _updateFrigateMetrics(stats) {
    const el = (id) => this.shadowRoot.getElementById(id);

    // Detector (Coral TPU)
    const detectors = stats.detectors || {};
    const detName = Object.keys(detectors)[0];
    if (detName) {
      const det = detectors[detName];
      const speedEl = el('m-coral-speed');
      if (speedEl) speedEl.textContent = det.inference_speed ? det.inference_speed.toFixed(1) + ' ms' : '—';
      const detectEl = el('m-coral-detect');
      if (detectEl) detectEl.textContent = det.detection_start ? det.detection_start.toFixed(1) + ' ms' : 'Idle';
    }

    // Coral temperature
    const temps = stats.temperatures || {};
    const tempVal = temps.apex_0 || temps[Object.keys(temps)[0]];
    const tempEl = el('m-coral-temp');
    if (tempEl) tempEl.textContent = tempVal ? tempVal.toFixed(1) + '\u00B0C' : '—';
    if (tempEl && tempVal > 70) tempEl.classList.add('warn');
    else if (tempEl) tempEl.classList.remove('warn');

    // GPU
    const gpus = stats.gpu_usages || {};
    const gpuName = Object.keys(gpus)[0];
    if (gpuName) {
      const gpu = gpus[gpuName];
      const gpuEl = el('m-gpu-usage');
      if (gpuEl) gpuEl.textContent = gpu.gpu ? gpu.gpu + '%' : '—';
      const gmemEl = el('m-gpu-mem');
      if (gmemEl) gmemEl.textContent = gpu.mem ? gpu.mem + '%' : '—';
    }

    // Frigate system
    const cu = stats.cpu_usages || {};
    const fs = cu['frigate.full_system'];
    if (fs) {
      const cpuEl = el('m-frigate-cpu');
      if (cpuEl) cpuEl.textContent = fs.cpu ? fs.cpu + '%' : '—';
      const memEl = el('m-frigate-mem');
      if (memEl) memEl.textContent = fs.mem ? fs.mem + '%' : '—';
    }
    const svc = stats.service || {};
    const uptimeEl = el('m-frigate-uptime');
    if (uptimeEl && svc.uptime) {
      const h = Math.floor(svc.uptime / 3600);
      const m = Math.floor((svc.uptime % 3600) / 60);
      uptimeEl.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    // Processes
    const procs = stats.processes || {};
    for (const [proc, info] of Object.entries(procs)) {
      const pid = info.pid;
      const procData = cu[String(pid)];
      const procEl = el(`m-proc-${proc}`);
      if (procEl && procData) {
        procEl.textContent = `${procData.cpu || 0}% / ${procData.mem || 0}%`;
      }
    }

    // Storage
    const stor = svc.storage || {};
    const recStor = stor['/media/frigate/recordings'];
    if (recStor) {
      const recEl = el('m-stor-recordings');
      if (recEl) recEl.textContent = `${(recStor.used / 1024).toFixed(1)} / ${(recStor.total / 1024).toFixed(0)} GB`;
    }
    const shmStor = stor['/dev/shm'];
    if (shmStor) {
      const shmEl = el('m-stor-shm');
      if (shmEl) shmEl.textContent = `${shmStor.used.toFixed(0)} / ${(shmStor.total / 1024).toFixed(1)} GB`;
    }
    const cacheStor = stor['/tmp/cache'];
    if (cacheStor) {
      const cacheEl = el('m-stor-cache');
      if (cacheEl) cacheEl.textContent = `${cacheStor.used.toFixed(0)} / ${(ccacheStor.total / 1024).toFixed(1)} GB`;
    }
  }

  _updateCameraDetections(stats) {
    const cameras = stats.cameras || {};
    for (const [name, cam] of Object.entries(cameras)) {
      const fps = cam.camera_fps || 0;
      const dfps = cam.detection_fps || 0;
      const chipsEl = this.shadowRoot.getElementById(`chips-${name}`);
      if (chipsEl) {
        chipsEl.innerHTML = `
          <span class="chip">${fps.toFixed(0)} FPS</span>
          <span class="chip detect-chip">${dfps.toFixed(1)} det/s</span>
          ${cam.audio_dBFS !== undefined && cam.audio_dBFS > -100 ? `<span class="chip audio-chip">${cam.audio_dBFS.toFixed(0)} dBFS</span>` : ''}
        `;
      }

      const frigLabel = this.shadowRoot.getElementById(`frigate-label-${name}`);
      if (frigLabel) {
        if (dfps > 0 && cam.detection_enabled) {
          frigLabel.textContent = `Detecting @ ${dfps.toFixed(1)} fps`;
          frigLabel.classList.add('active');
        } else {
          frigLabel.textContent = cam.detection_enabled ? 'Monitoring' : 'Detection off';
          frigLabel.classList.remove('active');
        }
      }

      if (this._selectedCamera === name) {
        const echips = this.shadowRoot.getElementById('expanded-chips');
        if (echips) echips.innerHTML = chipsEl ? chipsEl.innerHTML : '';
        const efrig = this.shadowRoot.getElementById('expanded-frigate-label');
        if (efrig && frigLabel) efrig.textContent = frigLabel.textContent;
      }
    }
  }

  _updateData() {
    if (!this._hass) return;
    const cameras = this._config.cameras;

    cameras.forEach(cam => {
      const sensorId = `sensor.${cam.name}_activity`;
      const state = this._hass.states[sensorId];
      const labelEl = this.shadowRoot.getElementById(`vjepa-label-${cam.name}`);
      const confEl = this.shadowRoot.getElementById(`vjepa-conf-${cam.name}`);

      if (state && labelEl) {
        const activity = state.state || 'unknown';
        labelEl.textContent = activity === 'unknown' ? 'Waiting for inference...' : activity;

        const attrs = state.attributes || {};
        if (confEl && attrs.confidence) {
          const conf = parseFloat(attrs.confidence);
          confEl.textContent = conf > 0 ? `${(conf * 100).toFixed(0)}%` : '';
          confEl.className = 'context-conf' + (conf > 0.8 ? ' high' : conf > 0.5 ? ' medium' : ' low');
        }

        if (activity !== 'unknown' && activity !== 'IDLE') {
          labelEl.classList.add('active');
        } else {
          labelEl.classList.remove('active');
        }
      }

      if (this._selectedCamera === cam.name) {
        const exLabel = this.shadowRoot.getElementById('expanded-vjepa-label');
        const exConf = this.shadowRoot.getElementById('expanded-vjepa-conf');
        if (exLabel && labelEl) exLabel.textContent = labelEl.textContent;
        if (exConf && confEl) {
          exConf.textContent = confEl.textContent;
          exConf.className = confEl.className;
        }
      }
    });

    // Jetson metrics
    const jetsonSensors = {
      'm-jetson-cpu': 'sensor.jetson_cpu_usage',
      'm-jetson-gpu': 'sensor.jetson_gpu_usage',
      'm-jetson-temp': 'sensor.jetson_cpu_temp'
    };
    for (const [elId, sensorId] of Object.entries(jetsonSensors)) {
      const state = this._hass.states[sensorId];
      const valEl = this.shadowRoot.getElementById(elId);
      if (valEl && state) {
        const val = state.state;
        const unit = state.attributes && state.attributes.unit_of_measurement ? state.attributes.unit_of_measurement : '';
        valEl.textContent = val !== 'unavailable' ? `${val}${unit}` : '—';
      }
    }
  }

  _getStyles() {
    return `
      :host {
        --bg-primary: #0a0e17;
        --bg-card: #111827;
        --bg-overlay: rgba(0,0,0,0.65);
        --bg-glass: rgba(17,24,39,0.85);
        --text-primary: #f1f5f9;
        --text-secondary: #94a3b8;
        --text-muted: #64748b;
        --accent-green: #4ecdc4;
        --accent-blue: #60a5fa;
        --accent-purple: #a78bfa;
        --accent-yellow: #ffd93d;
        --accent-red: #ff6b6b;
        --accent-pink: #f472b6;
        --border-subtle: rgba(255,255,255,0.06);
        --radius: 12px;
        --radius-sm: 8px;
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      .el-root {
        background: var(--bg-primary);
        min-height: 100vh;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        color: var(--text-primary);
      }

      .el-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        border-bottom: 1px solid var(--border-subtle);
      }
      .title { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
      .subtitle {
        font-size: 12px; color: var(--text-muted); margin-left: 12px;
        padding: 2px 8px; background: rgba(78,205,196,0.1);
        border: 1px solid rgba(78,205,196,0.2); border-radius: 4px;
      }
      .header-left { display: flex; align-items: center; }
      .system-indicator {
        display: flex; align-items: center; gap: 6px;
        font-size: 12px; color: var(--accent-green);
      }
      .indicator-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--accent-green); animation: pulse 2s infinite;
      }
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

      .camera-grid {
        display: grid; grid-template-columns: repeat(2, 1fr);
        gap: 4px; padding: 4px;
      }
      .camera-card:first-child { grid-column: 1 / -1; }
      .camera-card {
        position: relative; border-radius: var(--radius-sm);
        overflow: hidden; cursor: pointer; transition: transform 0.15s ease;
      }
      .camera-card:hover { transform: scale(1.005); }
      .camera-card:hover .camera-overlay { background: rgba(0,0,0,0.45); }

      .camera-feed {
        position: relative; width: 100%;
        aspect-ratio: 16/9; background: #000; overflow: hidden;
      }
      .camera-card:first-child .camera-feed { aspect-ratio: 21/9; }
      .camera-img { width: 100%; height: 100%; object-fit: cover; display: block; }

      .camera-overlay {
        position: absolute; inset: 0; display: flex;
        flex-direction: column; justify-content: space-between;
        background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 30%, transparent 60%, rgba(0,0,0,0.7) 100%);
        padding: 12px 16px; transition: background 0.2s;
      }
      .expanded-overlay { padding: 20px 28px; }
      .overlay-top { display: flex; justify-content: space-between; align-items: center; }
      .camera-label { font-size: 14px; font-weight: 600; text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
      .camera-card:first-child .camera-label { font-size: 18px; }
      .expanded-overlay .camera-label { font-size: 22px; }
      .camera-status {
        display: flex; align-items: center; gap: 4px;
        font-size: 10px; font-weight: 600; color: var(--accent-green);
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .status-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--accent-green); animation: pulse 2s infinite;
      }

      .overlay-context { display: flex; flex-direction: column; gap: 6px; align-self: flex-start; }
      .vjepa-context, .frigate-context {
        display: flex; align-items: center; gap: 8px;
        background: rgba(0,0,0,0.5); backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        padding: 6px 12px; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .expanded-overlay .vjepa-context,
      .expanded-overlay .frigate-context { padding: 10px 16px; }
      .context-badge {
        font-size: 9px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.1em; padding: 2px 6px; border-radius: 3px; white-space: nowrap;
      }
      .vjepa-badge {
        background: rgba(78,205,196,0.2); color: var(--accent-green);
        border: 1px solid rgba(78,205,196,0.3);
      }
      .frigate-badge {
        background: rgba(96,165,250,0.2); color: var(--accent-blue);
        border: 1px solid rgba(96,165,250,0.3);
      }
      .context-label { font-size: 12px; color: var(--text-secondary); }
      .context-label.active { color: var(--text-primary); font-weight: 500; }
      .expanded-overlay .context-label { font-size: 16px; }
      .context-conf {
        font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 3px;
      }
      .context-conf.high { color: var(--accent-green); background: rgba(78,205,196,0.15); }
      .context-conf.medium { color: var(--accent-yellow); background: rgba(255,217,61,0.15); }
      .context-conf.low { color: var(--accent-red); background: rgba(255,107,107,0.15); }

      .overlay-bottom { display: flex; justify-content: space-between; align-items: flex-end; }
      .detection-chips { display: flex; gap: 4px; flex-wrap: wrap; }
      .chip {
        font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
        background: rgba(255,255,255,0.1); color: var(--text-secondary);
        backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.06);
      }
      .detect-chip { color: var(--accent-green); background: rgba(78,205,196,0.12); }
      .audio-chip { color: var(--accent-purple); background: rgba(167,139,250,0.12); }

      .expand-btn, .close-btn {
        background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px; color: var(--text-primary); cursor: pointer;
        padding: 6px; display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(8px); transition: background 0.15s;
      }
      .expand-btn:hover, .close-btn:hover { background: rgba(255,255,255,0.2); }

      .expanded-view { padding: 4px; }
      .expanded-feed {
        position: relative; width: 100%; border-radius: var(--radius);
        overflow: hidden; background: #000;
      }
      .expanded-img { width: 100%; display: block; }
      .expanded-context { gap: 10px; }

      .metrics-bar { border-top: 1px solid var(--border-subtle); margin-top: 4px; }
      .metrics-toggle {
        width: 100%; display: flex; justify-content: center;
        align-items: center; gap: 8px; padding: 10px;
        background: transparent; border: none; color: var(--text-muted);
        font-size: 12px; font-weight: 500; cursor: pointer; transition: color 0.15s;
      }
      .metrics-toggle:hover { color: var(--text-secondary); }
      .toggle-arrow { transition: transform 0.2s; }

      .metrics-panel { padding: 0 16px 16px; }
      .metrics-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;
      }
      .metric-group {
        background: var(--bg-card); border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm); padding: 14px;
      }
      .metric-title {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--text-secondary); margin-bottom: 10px;
      }
      .metric-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 4px 0; border-bottom: 1px solid var(--border-subtle);
      }
      .metric-row:last-child { border-bottom: none; }
      .metric-name { font-size: 12px; color: var(--text-muted); }
      .metric-value {
        font-size: 12px; font-weight: 600; color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
      .metric-value.warn { color: var(--accent-red); }
    `;
  }
}

customElements.define('engineered-lighting-card', EngineeredLightingCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'custom:engineered-lighting-card',
  name: 'Engineered Lighting Card',
  description: 'V-JEPA 2 World Model dashboard with video feeds, context overlays, and system metrics',
  preview: true
});
