class EngineeredLightingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._config = null;
    this._cameraRefreshIntervals = {};
    this._animationFrameIds = [];
  }

  setConfig(config) {
    this._config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    this._setupStyles();
    this._render();
  }

  disconnectedCallback() {
    // Cleanup intervals and animation frames
    Object.values(this._cameraRefreshIntervals).forEach(intervalId => {
      clearInterval(intervalId);
    });
    this._animationFrameIds.forEach(frameId => {
      cancelAnimationFrame(frameId);
    });
  }

  _setupStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        --glass-bg: rgba(15, 15, 23, 0.7);
        --glass-border: rgba(255, 255, 255, 0.1);
        --accent-blue: #0a84ff;
        --accent-green: #30d158;
        --accent-orange: #ff9f0a;
        --accent-red: #ff453a;
        --text-primary: #ffffff;
        --text-secondary: #a1a1a6;
        --dark-bg: #0a0a0f;
      }

      * {
        box-sizing: border-box;
      }

      .container {
        background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
        min-height: 100vh;
        padding: 32px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
        color: var(--text-primary);
        overflow-y: auto;
      }

      /* Header */
      .header {
        margin-bottom: 40px;
        position: relative;
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }

      .branding {
        flex: 1;
      }

      .logo-text {
        font-size: 36px;
        font-weight: 700;
        letter-spacing: -1px;
        background: linear-gradient(135deg, #ffffff 0%, #a1a1a6 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-shadow: 0 0 30px rgba(10, 132, 255, 0.3);
        margin: 0 0 8px 0;
        filter: drop-shadow(0 0 20px rgba(10, 132, 255, 0.2));
      }

      .subtitle {
        font-size: 14px;
        color: var(--text-secondary);
        font-weight: 500;
        letter-spacing: 0.5px;
      }

      .status-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--glass-bg);
        backdrop-filter: blur(40px) saturate(180%);
        border: 1px solid var(--glass-border);
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 13px;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent-green);
        box-shadow: 0 0 8px var(--accent-green);
        animation: pulse 2s ease-in-out infinite;
      }

      .status-dot.offline {
        background: var(--accent-red);
        box-shadow: 0 0 8px var(--accent-red);
        animation: none;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      /* Camera Grid */
      .camera-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 20px;
        margin-bottom: 40px;
      }

      .camera-card {
        position: relative;
        border-radius: 24px;
        overflow: hidden;
        background: var(--glass-bg);
        backdrop-filter: blur(40px) saturate(180%);
        border: 1px solid var(--glass-border);
        aspect-ratio: 4/3;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1);
        transition: all 0.3s ease;
        animation: shimmer-border 3s ease-in-out infinite;
      }

      .camera-card:hover {
        box-shadow: 0 25px 70px rgba(10, 132, 255, 0.15),
                    inset 0 1px 0 rgba(255, 255, 255, 0.15);
        border-color: rgba(10, 132, 255, 0.3);
      }

      @keyframes shimmer-border {
        0%, 100% {
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3),
                      inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        50% {
          box-shadow: 0 20px 60px rgba(10, 132, 255, 0.1),
                      inset 0 1px 0 rgba(255, 255, 255, 0.15);
        }
      }

      .camera-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .camera-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
        padding: 20px;
        backdrop-filter: blur(10px);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .camera-name {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
        text-transform: capitalize;
        letter-spacing: 0.3px;
      }

      .camera-info {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
        font-size: 12px;
      }

      .activity-badge {
        background: rgba(255, 255, 255, 0.15);
        padding: 2px 8px;
        border-radius: 12px;
        font-weight: 500;
        white-space: nowrap;
        transition: all 0.3s ease;
      }

      .activity-badge.active {
        background: rgba(48, 209, 88, 0.3);
        color: var(--accent-green);
      }

      .activity-badge.idle {
        background: rgba(161, 161, 166, 0.2);
        color: var(--text-secondary);
      }

      .person-indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent-green);
        box-shadow: 0 0 6px var(--accent-green);
        animation: pulse 1.5s ease-in-out infinite;
      }

      .person-indicator.hidden {
        opacity: 0;
        display: none;
      }

      .confidence-text {
        color: var(--text-secondary);
        font-size: 11px;
      }

      .motion-bar-container {
        width: 100%;
        height: 2px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 1px;
        overflow: hidden;
        margin-top: 8px;
      }

      .motion-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-blue), var(--accent-green));
        border-radius: 1px;
        transition: width 0.3s ease;
        box-shadow: 0 0 8px var(--accent-blue);
      }

      /* Offline State */
      .camera-card.offline .camera-image {
        filter: grayscale(100%) brightness(0.3);
      }

      .offline-badge {
        position: absolute;
        top: 12px;
        right: 12px;
        background: var(--accent-red);
        color: white;
        padding: 4px 8px;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 600;
        backdrop-filter: blur(10px);
      }

      /* System Metrics Section */
      .metrics-section {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
        gap: 20px;
      }

      .metrics-panel {
        background: var(--glass-bg);
        backdrop-filter: blur(40px) saturate(180%);
        border: 1px solid var(--glass-border);
        border-radius: 24px;
        padding: 24px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1);
        transition: all 0.3s ease;
      }

      .metrics-panel:hover {
        box-shadow: 0 25px 70px rgba(10, 132, 255, 0.1),
                    inset 0 1px 0 rgba(255, 255, 255, 0.15);
        border-color: rgba(10, 132, 255, 0.2);
      }

      .panel-title {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 20px;
        letter-spacing: 0.5px;
      }

      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 20px;
        margin-bottom: 20px;
      }

      .metric-item {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .gauge-container {
        width: 100px;
        height: 100px;
        margin-bottom: 12px;
        position: relative;
      }

      .gauge-svg {
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }

      .gauge-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .metric-label {
        font-size: 12px;
        color: var(--text-secondary);
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 8px;
      }

      .metric-value {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        text-align: center;
        margin-top: 4px;
      }

      .bar-container {
        width: 100%;
        margin-bottom: 8px;
      }

      .bar-label {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        margin-bottom: 4px;
        color: var(--text-secondary);
      }

      .bar-track {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-blue), var(--accent-green));
        border-radius: 3px;
        transition: width 0.3s ease;
        box-shadow: 0 0 8px var(--accent-blue);
      }

      .temp-value {
        font-size: 13px;
        font-weight: 500;
        margin-top: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.05);
        transition: all 0.3s ease;
      }

      .temp-value.cool {
        color: var(--accent-green);
        background: rgba(48, 209, 88, 0.1);
      }

      .temp-value.warm {
        color: var(--accent-orange);
        background: rgba(255, 159, 10, 0.1);
      }

      .temp-value.hot {
        color: var(--accent-red);
        background: rgba(255, 69, 58, 0.1);
      }

      .status-display {
        font-size: 12px;
        padding: 8px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
      }

      .status-display .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent-green);
      }

      .status-display.offline .dot {
        background: var(--accent-red);
      }

      /* Responsive */
      @media (max-width: 1024px) {
        .camera-grid {
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        }

        .metrics-grid {
          grid-template-columns: 1fr;
        }

        .container {
          padding: 24px;
        }
      }

      @media (max-width: 640px) {
        .container {
          padding: 16px;
        }

        .logo-text {
          font-size: 28px;
        }

        .header-content {
          flex-direction: column;
          gap: 16px;
        }

        .camera-grid {
          grid-template-columns: 1fr;
        }

        .metrics-section {
          grid-template-columns: 1fr;
        }

        .metrics-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      /* Placeholder state */
      .placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
        color: var(--text-secondary);
        font-size: 14px;
        text-align: center;
        padding: 20px;
      }

      .error-message {
        color: var(--accent-red);
        font-size: 12px;
        margin-top: 8px;
        padding: 8px;
        background: rgba(255, 69, 58, 0.1);
        border-radius: 8px;
      }
    `;
    this.shadowRoot.appendChild(style);
  }

  _render() {
    if (!this._hass) {
      return;
    }

    const container = document.createElement('div');
    container.className = 'container';

    // Header
    container.appendChild(this._createHeader());

    // Camera Grid
    container.appendChild(this._createCameraGrid());

    // Metrics Section
    container.appendChild(this._createMetricsSection());

    // Clear and append
    this.shadowRoot.innerHTML = '';
    this._setupStyles();
    this.shadowRoot.appendChild(container);

    // Start camera refresh intervals
    this._startCameraRefresh();
  }

  _createHeader() {
    const header = document.createElement('div');
    header.className = 'header';

    const headerContent = document.createElement('div');
    headerContent.className = 'header-content';

    const branding = document.createElement('div');
    branding.className = 'branding';

    const logo = document.createElement('div');
    logo.className = 'logo-text';
    logo.textContent = 'Engineered Lighting';

    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'V-JEPA 2 World Model';

    branding.appendChild(logo);
    branding.appendChild(subtitle);

    const statusIndicator = this._createStatusIndicator();

    headerContent.appendChild(branding);
    headerContent.appendChild(statusIndicator);
    header.appendChild(headerContent);

    return header;
  }

  _createStatusIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'status-indicator';

    const dot = document.createElement('div');
    dot.className = 'status-dot';

    const text = document.createElement('span');
    text.textContent = 'Active';

    const jetsonStatus = this._hass.states['sensor.jetson_status'];
    if (jetsonStatus && jetsonStatus.state === 'offline') {
      dot.classList.add('offline');
      text.textContent = 'Offline';
    }

    indicator.appendChild(dot);
    indicator.appendChild(text);

    return indicator;
  }

  _createCameraGrid() {
    const grid = document.createElement('div');
    grid.className = 'camera-grid';

    const cameras = [
      'camera.living_room',
      'camera.dining_room',
      'camera.kitchen',
      'camera.back_door',
      'camera.driveway'
    ];

    cameras.forEach(cameraEntity => {
      grid.appendChild(this._createCameraCard(cameraEntity));
    });

    return grid;
  }

  _createCameraCard(cameraEntity) {
    const card = document.createElement('div');
    card.className = 'camera-card';
    card.id = `camera-${cameraEntity}`;

    const cameraState = this._hass.states[cameraEntity];
    const sensorEntity = cameraEntity.replace('camera.', 'sensor.') + '_activity';
    const sensorState = this._hass.states[sensorEntity];

    // Image
    const image = document.createElement('img');
    image.className = 'camera-image';

    if (cameraState && cameraState.attributes && cameraState.attributes.entity_picture) {
      image.src = `/api/camera_proxy/${cameraEntity}`;
      image.onerror = () => {
        image.style.display = 'none';
        const placeholder = card.querySelector('.placeholder');
        if (!placeholder) {
          const ph = document.createElement('div');
          ph.className = 'placeholder';
          ph.textContent = 'Camera unavailable';
          card.appendChild(ph);
        }
      };
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      placeholder.textContent = cameraState ? 'No image' : 'Offline';
      card.appendChild(placeholder);
    }

    card.appendChild(image);

    // Offline badge
    if (!cameraState || cameraState.state === 'unavailable') {
      card.classList.add('offline');
      const offlineBadge = document.createElement('div');
      offlineBadge.className = 'offline-badge';
      offlineBadge.textContent = 'OFFLINE';
      card.appendChild(offlineBadge);
    }

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'camera-overlay';

    const name = document.createElement('div');
    name.className = 'camera-name';
    name.textContent = cameraEntity.replace('camera.', '').replace(/_/g, ' ');

    overlay.appendChild(name);

    if (sensorState && sensorState.attributes) {
      const attrs = sensorState.attributes;
      const info = document.createElement('div');
      info.className = 'camera-info';

      // Activity badge
      const activity = attrs.activity || 'unknown';
      const isActive = activity === 'active' || activity === 'motion_detected';
      const badge = document.createElement('div');
      badge.className = `activity-badge ${isActive ? 'active' : 'idle'}`;
      badge.textContent = activity.replace(/_/g, ' ').toUpperCase();

      // Person indicator
      if (attrs.person_detected) {
        const person = document.createElement('div');
        person.className = 'person-indicator';
        info.appendChild(person);
      }

      // Confidence
      const confidence = document.createElement('div');
      confidence.className = 'confidence-text';
      confidence.textContent = `${Math.round((attrs.confidence || 0) * 100)}%`;

      info.appendChild(badge);
      info.appendChild(confidence);
      overlay.appendChild(info);

      // Motion bar
      const motionLevel = attrs.motion_level || 0;
      const motionContainer = document.createElement('div');
      motionContainer.className = 'motion-bar-container';
      const motionBar = document.createElement('div');
      motionBar.className = 'motion-bar';
      motionBar.style.width = `${Math.min(motionLevel * 100, 100)}%`;
      motionContainer.appendChild(motionBar);
      overlay.appendChild(motionContainer);
    }

    card.appendChild(overlay);

    return card;
  }

  _createMetricsSection() {
    const section = document.createElement('div');
    section.className = 'metrics-section';

    section.appendChild(this._createJetsonPanel());
    section.appendChild(this._createLattePandaPanel());

    return section;
  }

  _createJetsonPanel() {
    const panel = document.createElement('div');
    panel.className = 'metrics-panel';
    panel.id = 'jetson-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'Jetson Orin Nano Super';

    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'metrics-grid';

    // CPU Gauge
    const cpuItem = this._createMetricItem(
      'CPU',
      'sensor.jetson_cpu_usage',
      'gauge'
    );
    grid.appendChild(cpuItem);

    // GPU Gauge
    const gpuItem = this._createMetricItem(
      'GPU',
      'sensor.jetson_gpu_usage',
      'gauge'
    );
    grid.appendChild(gpuItem);

    panel.appendChild(grid);

    // RAM Bar
    const ramContainer = document.createElement('div');
    ramContainer.className = 'bar-container';
    const ramLabel = document.createElement('div');
    ramLabel.className = 'bar-label';
    ramLabel.innerHTML = '<span>RAM Usage</span><span id="jetson-ram-label">0 GB</span>';
    const ramTrack = document.createElement('div');
    ramTrack.className = 'bar-track';
    const ramFill = document.createElement('div');
    ramFill.className = 'bar-fill';
    ramFill.style.width = '0%';
    ramTrack.appendChild(ramFill);
    ramContainer.appendChild(ramLabel);
    ramContainer.appendChild(ramTrack);
    panel.appendChild(ramContainer);

    // CPU Temp
    const cpuTempContainer = document.createElement('div');
    cpuTempContainer.style.marginTop = '12px';
    const cpuTempLabel = document.createElement('div');
    cpuTempLabel.className = 'bar-label';
    cpuTempLabel.textContent = 'CPU Temperature';
    const cpuTempValue = document.createElement('div');
    cpuTempValue.className = 'temp-value cool';
    cpuTempValue.textContent = '--°C';
    cpuTempValue.id = 'jetson-cpu-temp';
    cpuTempContainer.appendChild(cpuTempLabel);
    cpuTempContainer.appendChild(cpuTempValue);
    panel.appendChild(cpuTempContainer);

    // GPU Temp
    const gpuTempContainer = document.createElement('div');
    gpuTempContainer.style.marginTop = '12px';
    const gpuTempLabel = document.createElement('div');
    gpuTempLabel.className = 'bar-label';
    gpuTempLabel.textContent = 'GPU Temperature';
    const gpuTempValue = document.createElement('div');
    gpuTempValue.className = 'temp-value cool';
    gpuTempValue.textContent = '--°C';
    gpuTempValue.id = 'jetson-gpu-temp';
    gpuTempContainer.appendChild(gpuTempLabel);
    gpuTempContainer.appendChild(gpuTempValue);
    panel.appendChild(gpuTempContainer);

    // Status
    const status = document.createElement('div');
    status.className = 'status-display';
    status.id = 'jetson-status';
    const statusDot = document.createElement('div');
    statusDot.className = 'dot';
    const statusText = document.createElement('span');
    statusText.textContent = 'Online';
    status.appendChild(statusDot);
    status.appendChild(statusText);
    panel.appendChild(status);

    // Update values
    this._updateJetsonMetrics(panel);

    return panel;
  }

  _createLattePandaPanel() {
    const panel = document.createElement('div');
    panel.className = 'metrics-panel';
    panel.id = 'lattepanda-panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'LattePanda Sigma';

    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'metrics-grid';

    // CPU Gauge
    const cpuItem = this._createMetricItem(
      'CPU',
      'sensor.lattepanda_cpu_usage',
      'gauge'
    );
    grid.appendChild(cpuItem);

    panel.appendChild(grid);

    // RAM Bar
    const ramContainer = document.createElement('div');
    ramContainer.className = 'bar-container';
    const ramLabel = document.createElement('div');
    ramLabel.className = 'bar-label';
    ramLabel.innerHTML = '<span>RAM Usage</span><span id="lattepanda-ram-label">0 GB</span>';
    const ramTrack = document.createElement('div');
    ramTrack.className = 'bar-track';
    const ramFill = document.createElement('div');
    ramFill.className = 'bar-fill';
    ramFill.style.width = '0%';
    ramTrack.appendChild(ramFill);
    ramContainer.appendChild(ramLabel);
    ramContainer.appendChild(ramTrack);
    panel.appendChild(ramContainer);

    // CPU Temp
    const cpuTempContainer = document.createElement('div');
    cpuTempContainer.style.marginTop = '12px';
    const cpuTempLabel = document.createElement('div');
    cpuTempLabel.className = 'bar-label';
    cpuTempLabel.textContent = 'CPU Temperature';
    const cpuTempValue = document.createElement('div');
    cpuTempValue.className = 'temp-value cool';
    cpuTempValue.textContent = '--°C';
    cpuTempValue.id = 'lattepanda-cpu-temp';
    cpuTempContainer.appendChild(cpuTempLabel);
    cpuTempContainer.appendChild(cpuTempValue);
    panel.appendChild(cpuTempContainer);

    // Disk Bar
    const diskContainer = document.createElement('div');
    diskContainer.className = 'bar-container';
    diskContainer.style.marginTop = '12px';
    const diskLabel = document.createElement('div');
    diskLabel.className = 'bar-label';
    diskLabel.innerHTML = '<span>Disk Usage</span><span id="lattepanda-disk-label">0%</span>';
    const diskTrack = document.createElement('div');
    diskTrack.className = 'bar-track';
    const diskFill = document.createElement('div');
    diskFill.className = 'bar-fill';
    diskFill.style.width = '0%';
    diskTrack.appendChild(diskFill);
    diskContainer.appendChild(diskLabel);
    diskContainer.appendChild(diskTrack);
    panel.appendChild(diskContainer);

    // Status
    const status = document.createElement('div');
    status.className = 'status-display';
    status.id = 'lattepanda-status';
    const statusDot = document.createElement('div');
    statusDot.className = 'dot';
    const statusText = document.createElement('span');
    statusText.textContent = 'Online';
    status.appendChild(statusDot);
    status.appendChild(statusText);
    panel.appendChild(status);

    // Update values
    this._updateLattePandaMetrics(panel);

    return panel;
  }

  _createMetricItem(label, entityId, type) {
    const item = document.createElement('div');
    item.className = 'metric-item';

    if (type === 'gauge') {
      const container = document.createElement('div');
      container.className = 'gauge-container';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'gauge-svg');
      svg.setAttribute('viewBox', '0 0 100 100');

      // Background circle
      const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bgCircle.setAttribute('cx', '50');
      bgCircle.setAttribute('cy', '50');
      bgCircle.setAttribute('r', '45');
      bgCircle.setAttribute('fill', 'none');
      bgCircle.setAttribute('stroke', 'rgba(255, 255, 255, 0.1)');
      bgCircle.setAttribute('stroke-width', '6');

      // Progress circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '50');
      circle.setAttribute('cy', '50');
      circle.setAttribute('r', '45');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', 'url(#gaugeGradient)');
      circle.setAttribute('stroke-width', '6');
      circle.setAttribute('stroke-linecap', 'round');
      circle.setAttribute('stroke-dasharray', '282.74');
      circle.setAttribute('stroke-dashoffset', '282.74');
      circle.setAttribute('data-entity', entityId);
      circle.style.transition = 'stroke-dashoffset 0.5s ease';

      // Gradient
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      gradient.setAttribute('id', 'gaugeGradient');
      gradient.setAttribute('x1', '0%');
      gradient.setAttribute('y1', '0%');
      gradient.setAttribute('x2', '100%');
      gradient.setAttribute('y2', '0%');

      const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', '#0a84ff');

      const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', '#30d158');

      gradient.appendChild(stop1);
      gradient.appendChild(stop2);
      defs.appendChild(gradient);

      svg.appendChild(defs);
      svg.appendChild(bgCircle);
      svg.appendChild(circle);

      const text = document.createElement('div');
      text.className = 'gauge-text';
      text.textContent = '0%';
      text.setAttribute('data-entity', entityId);

      container.appendChild(svg);
      container.appendChild(text);
      item.appendChild(container);
    }

    const itemLabel = document.createElement('div');
    itemLabel.className = 'metric-label';
    itemLabel.textContent = label;

    item.appendChild(itemLabel);

    return item;
  }

  _updateJetsonMetrics(panel) {
    // CPU Usage
    const cpuState = this._hass.states['sensor.jetson_cpu_usage'];
    if (cpuState && cpuState.state !== 'unknown' && cpuState.state !== 'unavailable') {
      const cpuValue = parseFloat(cpuState.state);
      this._updateGauge(panel, 'sensor.jetson_cpu_usage', cpuValue);
    }

    // GPU Usage
    const gpuState = this._hass.states['sensor.jetson_gpu_usage'];
    if (gpuState && gpuState.state !== 'unknown' && gpuState.state !== 'unavailable') {
      const gpuValue = parseFloat(gpuState.state);
      this._updateGauge(panel, 'sensor.jetson_gpu_usage', gpuValue);
    }

    // RAM
    const ramUsed = this._hass.states['sensor.jetson_ram_used'];
    const ramTotal = this._hass.states['sensor.jetson_ram_total'];
    if (ramUsed && ramTotal && ramUsed.state !== 'unknown' && ramTotal.state !== 'unknown') {
      const used = parseFloat(ramUsed.state);
      const total = parseFloat(ramTotal.state);
      const percent = total > 0 ? (used / total) * 100 : 0;
      const ramLabel = panel.querySelector('#jetson-ram-label');
      if (ramLabel) ramLabel.textContent = `${used.toFixed(1)} GB / ${total.toFixed(1)} GB`;
      const ramFill = panel.querySelector('.metrics-grid').nextElementSibling.querySelector('.bar-fill');
      if (ramFill) ramFill.style.width = `${percent}%`;
    }

    // CPU Temp
    const cpuTemp = this._hass.states['sensor.jetson_cpu_temp'];
    if (cpuTemp && cpuTemp.state !== 'unknown' && cpuTemp.state !== 'unavailable') {
      const tempValue = parseFloat(cpuTemp.state);
      const tempDisplay = panel.querySelector('#jetson-cpu-temp');
      if (tempDisplay) {
        tempDisplay.textContent = `${tempValue.toFixed(1)}°C`;
        tempDisplay.className = 'temp-value';
        if (tempValue < 50) tempDisplay.classList.add('cool');
        else if (tempValue < 70) tempDisplay.classList.add('warm');
        else tempDisplay.classList.add('hot');
      }
    }

    // GPU Temp
    const gpuTemp = this._hass.states['sensor.jetson_gpu_temp'];
    if (gpuTemp && gpuTemp.state !== 'unknown' && gpuTemp.state !== 'unavailable') {
      const tempValue = parseFloat(gpuTemp.state);
      const tempDisplay = panel.querySelector('#jetson-gpu-temp');
      if (tempDisplay) {
        tempDisplay.textContent = `${tempValue.toFixed(1)}°C`;
        tempDisplay.className = 'temp-value';
        if (tempValue < 50) tempDisplay.classList.add('cool');
        else if (tempValue < 70) tempDisplay.classList.add('warm');
        else tempDisplay.classList.add('hot');
      }
    }

    // Status
    const status = this._hass.states['sensor.jetson_status'];
    const statusDisplay = panel.querySelector('#jetson-status');
    if (statusDisplay) {
      if (status && status.state !== 'unknown' && status.state === 'online') {
        statusDisplay.classList.remove('offline');
        statusDisplay.querySelector('span').textContent = 'Online';
      } else {
        statusDisplay.classList.add('offline');
        statusDisplay.querySelector('span').textContent = 'Offline';
      }
    }
  }

  _updateLattePandaMetrics(panel) {
    // CPU Usage
    const cpuState = this._hass.states['sensor.lattepanda_cpu_usage'];
    if (cpuState && cpuState.state !== 'unknown' && cpuState.state !== 'unavailable') {
      const cpuValue = parseFloat(cpuState.state);
      this._updateGauge(panel, 'sensor.lattepanda_cpu_usage', cpuValue);
    }

    // RAM
    const ramUsed = this._hass.states['sensor.lattepanda_ram_used'];
    const ramTotal = this._hass.states['sensor.lattepanda_ram_total'];
    if (ramUsed && ramTotal && ramUsed.state !== 'unknown' && ramTotal.state !== 'unknown') {
      const used = parseFloat(ramUsed.state);
      const total = parseFloat(ramTotal.state);
      const percent = total > 0 ? (used / total) * 100 : 0;
      const ramLabel = panel.querySelector('#lattepanda-ram-label');
      if (ramLabel) ramLabel.textContent = `${used.toFixed(1)} GB / ${total.toFixed(1)} GB`;
      const ramContainer = Array.from(panel.querySelectorAll('.bar-container'))[0];
      if (ramContainer) {
        const ramFill = ramContainer.querySelector('.bar-fill');
        if (ramFill) ramFill.style.width = `${percent}%`;
      }
    }

    // CPU Temp
    const cpuTemp = this._hass.states['sensor.lattepanda_cpu_temp'];
    if (cpuTemp && cpuTemp.state !== 'unknown' && cpuTemp.state !== 'unavailable') {
      const tempValue = parseFloat(cpuTemp.state);
      const tempDisplay = panel.querySelector('#lattepanda-cpu-temp');
      if (tempDisplay) {
        tempDisplay.textContent = `${tempValue.toFixed(1)}°C`;
        tempDisplay.className = 'temp-value';
        if (tempValue < 50) tempDisplay.classList.add('cool');
        else if (tempValue < 70) tempDisplay.classList.add('warm');
        else tempDisplay.classList.add('hot');
      }
    }

    // Disk Usage
    const diskState = this._hass.states['sensor.lattepanda_disk_usage'];
    if (diskState && diskState.state !== 'unknown' && diskState.state !== 'unavailable') {
      const diskValue = parseFloat(diskState.state);
      const diskLabel = panel.querySelector('#lattepanda-disk-label');
      if (diskLabel) diskLabel.textContent = `${diskValue.toFixed(1)}%`;
      const diskContainers = panel.querySelectorAll('.bar-container');
      if (diskContainers.length > 1) {
        const diskFill = diskContainers[1].querySelector('.bar-fill');
        if (diskFill) diskFill.style.width = `${diskValue}%`;
      }
    }

    // Status
    const status = this._hass.states['sensor.lattepanda_status'];
    const statusDisplay = panel.querySelector('#lattepanda-status');
    if (statusDisplay) {
      if (status && status.state !== 'unknown' && status.state === 'online') {
        statusDisplay.classList.remove('offline');
        statusDisplay.querySelector('span').textContent = 'Online';
      } else {
        statusDisplay.classList.add('offline');
        statusDisplay.querySelector('span').textContent = 'Offline';
      }
    }
  }

  _updateGauge(panel, entityId, value) {
    const gauges = panel.querySelectorAll('[data-entity]');
    gauges.forEach(gauge => {
      if (gauge.getAttribute('data-entity') === entityId) {
        if (gauge.tagName === 'circle') {
          // SVG circle gauge
          const percent = Math.min(Math.max(value, 0), 100);
          const circumference = 282.74;
          const offset = circumference - (percent / 100) * circumference;
          gauge.setAttribute('stroke-dashoffset', offset.toString());
        } else if (gauge.classList.contains('gauge-text')) {
          // Text display
          gauge.textContent = `${Math.round(value)}%`;
        }
      }
    });
  }

  _startCameraRefresh() {
    const cameras = [
      'camera.living_room',
      'camera.dining_room',
      'camera.kitchen',
      'camera.back_door',
      'camera.driveway'
    ];

    cameras.forEach(cameraEntity => {
      // Clear existing interval if any
      if (this._cameraRefreshIntervals[cameraEntity]) {
        clearInterval(this._cameraRefreshIntervals[cameraEntity]);
      }

      // Set initial image
      this._refreshCameraImage(cameraEntity);

      // Refresh every 10 seconds
      this._cameraRefreshIntervals[cameraEntity] = setInterval(() => {
        this._refreshCameraImage(cameraEntity);
      }, 10000);
    });
  }

  _refreshCameraImage(cameraEntity) {
    const card = this.shadowRoot.querySelector(`#camera-${cameraEntity}`);
    if (!card) return;

    const img = card.querySelector('img.camera-image');
    if (!img) return;

    const cameraState = this._hass.states[cameraEntity];
    if (cameraState && cameraState.attributes && cameraState.attributes.entity_picture) {
      // Add timestamp to force refresh
      const timestamp = Date.now();
      img.src = `/api/camera_proxy/${cameraEntity}?t=${timestamp}`;
    }
  }

  getCardSize() {
    return 10;
  }
}

// Register the custom element
customElements.define('engineered-lighting-card', EngineeredLightingCard);
