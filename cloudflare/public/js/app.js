// ================================================================
// swachhyabasti — Smart Environmental & Carbon Monitoring v2.0
// Complete SPA: Auth, Dashboard, Devices, Map, Carbon Emissions
// ================================================================

const APP = (() => {

// ── Carbon Emission Factors (g CO2/km) — DEFRA/EPA research-based ──
const EMISSION_FACTORS = {
  motorcycle: { petrol: 113, diesel: 101, cng: 78, electric: 0 },
  car:        { petrol: 192, diesel: 171, cng: 137, electric: 0 },
  suv:        { petrol: 248, diesel: 220, cng: 176, electric: 0 },
  bus:        { petrol: 820, diesel: 730, cng: 580, electric: 0 },
  truck:      { petrol: 1050, diesel: 930, cng: 750, electric: 0 }
};

// ── Device Type Definitions ──
const TYPES = {
  air_quality: {
    label: 'Air Quality Monitor',
    icon: '🌬️',
    iconClass: 'air',
    desc: 'SPS30 PM sensor, CO2-C8 NDIR, and DHT22 temperature & humidity.',
    sensors: {
      pm1_0:       { label: 'PM1.0',        unit: 'µg/m³', color: 'default' },
      pm2_5:       { label: 'PM2.5',        unit: 'µg/m³', color: 'amber' },
      pm4_0:       { label: 'PM4.0',        unit: 'µg/m³', color: 'default' },
      pm10:        { label: 'PM10',         unit: 'µg/m³', color: 'amber' },
      co2_ppm:     { label: 'CO₂',          unit: 'ppm',   color: 'green' },
      aqi:         { label: 'AQI (PM / CO₂)', unit: '',     color: 'purple' },
      temperature: { label: 'Temperature',  unit: '°C',    color: 'green' },
      humidity:    { label: 'Humidity',      unit: '%',     color: 'default' }
    },
    controls: [],
    chartKey: 'pm2_5',
    chartLabel: 'PM2.5 (µg/m³)'
  },
  gps_tracker: {
    label: 'GPS Tracker & Carbon Monitor',
    icon: '📍',
    iconClass: 'gps',
    desc: 'TinyGPS++ with SIM800L. Tracks location, speed, distance, and calculates vehicle CO₂ emissions based on fuel/vehicle type.',
    sensors: {
      latitude:      { label: 'Latitude',       unit: '°',      color: 'green' },
      longitude:     { label: 'Longitude',      unit: '°',      color: 'green' },
      speed_kmh:     { label: 'Speed',          unit: 'km/h',   color: 'amber' },
      altitude_m:    { label: 'Altitude',       unit: 'm',      color: 'default' },
      satellites:    { label: 'Satellites',     unit: '',       color: 'purple' },
      hdop:          { label: 'HDOP',           unit: '',       color: 'default' }
    },
    controls: [],
    chartKey: 'speed_kmh',
    chartLabel: 'Speed (km/h)'
  },
  moss_water_tank: {
    label: 'Smart Hybrid Solar Dryer',
    icon: '☀️',
    iconClass: 'moss',
    desc: 'DHT22 temperature & humidity monitoring, threshold-driven dryer fan control.',
    sensors: {
      temperature: { label: 'Temperature',  unit: '°C', color: 'green' },
      humidity:    { label: 'Humidity',      unit: '%',  color: 'default' }
    },
    controls: [
      { key: 'pump', label: 'Dryer Fan', type: 'toggle' }
    ],
    chartKey: 'temperature',
    chartLabel: 'Temperature (°C)'
  }
};

// ── State ──
let devices = [];
let currentDevice = null;
let pollTimer = null;
let trendChart = null;
let leafletMap = null;
let mapMarkers = {};
let isLoggedIn = false;

// ── Initialization ──
function init() {
  // Check if already logged in
  checkAuth().then(auth => {
    if (auth.logged_in) {
      showApp();
    }
  });

  // Enter key on login
  document.getElementById('login-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('login-user').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-pass').focus();
  });

  // Initialize theme toggle state
  updateThemeToggle();

  // Type description on load
  onTypeChange();
}

// ── Auth ──
async function checkAuth() {
  try {
    const r = await fetch('/api/auth.php');
    return await r.json();
  } catch { return { logged_in: false }; }
}

async function doLogin() {
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) {
    errEl.textContent = 'Username and password are required';
    errEl.style.display = 'block';
    return;
  }
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in...';
  try {
    const r = await fetch('/api/auth.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Login failed');
    showApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function logout() {
  try { await fetch('/api/auth.php', { method: 'DELETE' }); } catch {}
  isLoggedIn = false;
  if (pollTimer) clearInterval(pollTimer);
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('top-header').style.display = 'none';
  document.getElementById('bottom-nav').style.display = 'none';
  document.getElementById('main-content').style.display = 'none';
  document.body.classList.add('login-active', 'no-scroll');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

function showApp() {
  isLoggedIn = true;
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('top-header').style.display = 'flex';
  document.getElementById('bottom-nav').style.display = 'flex';
  document.getElementById('main-content').style.display = 'block';
  document.body.classList.remove('login-active', 'no-scroll');
  loadDevices();
  // Start polling
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (currentDevice) fetchData();
  }, 5000);
}

// ── Navigation ──
function navigate(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const section = document.getElementById('page-' + page);
  if (section) section.classList.add('active');
  const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');

  if (page === 'map') initMap();
  if (page === 'devices') renderDeviceList();
  if (page === 'settings') {
    document.getElementById('settings-device-count').textContent = devices.length;
    loadSettings();
  }
}

// ── Theme ──
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  if (current === 'light') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
  }
  updateThemeToggle();
}

function updateThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  toggle.classList.toggle('on', !isLight);
}

async function loadSettings() {
  try {
    const r = await fetch('/api/admin.php?action=get_settings');
    const data = await r.json();
    document.getElementById('settings-email').value = data.notification_email || '';
    document.getElementById('settings-wifi-ssid').value = data.wifi_ssid || '';
    document.getElementById('settings-wifi-pass').value = data.wifi_pass || '';
  } catch (e) {
    toast('Failed to load settings', 'error');
  }
}

async function saveSettings() {
  const email = document.getElementById('settings-email').value.trim();
  const ssid = document.getElementById('settings-wifi-ssid').value.trim();
  const pass = document.getElementById('settings-wifi-pass').value;

  try {
    const r = await fetch('/api/admin.php?action=update_settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification_email: email,
        wifi_ssid: ssid,
        wifi_pass: pass
      })
    });
    const res = await r.json();
    if (res.status === 'ok') {
      toast('Configuration saved successfully!', 'success');
    } else {
      toast(res.error || 'Failed to save configuration', 'error');
    }
  } catch (e) {
    toast('Failed to save settings: ' + e.message, 'error');
  }
}

// ── Toast ──
function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Device CRUD ──
async function loadDevices() {
  try {
    const r = await fetch('/api/devices.php');
    const data = await r.json();
    if (Array.isArray(data)) {
      devices = data;
      refreshDashSelect();
      renderDeviceList();
      refreshMapSelect();
      document.getElementById('device-count').textContent = devices.length;
    }
  } catch {}
}

function refreshDashSelect() {
  const sel = document.getElementById('dash-device-select');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Select a device —</option>';
  devices.forEach(d => {
    const t = TYPES[d.device_type];
    const opt = document.createElement('option');
    opt.value = d.device_id;
    opt.textContent = (t ? t.icon + ' ' : '') + d.name;
    if (prev === d.device_id) opt.selected = true;
    sel.appendChild(opt);
  });
  if (prev && devices.find(d => d.device_id === prev)) {
    switchDevice(prev);
  }
}

function refreshMapSelect() {
  const sel = document.getElementById('map-device-select');
  sel.innerHTML = '<option value="">All GPS Trackers</option>';
  devices.filter(d => d.device_type === 'gps_tracker').forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.device_id;
    opt.textContent = d.name;
    sel.appendChild(opt);
  });
}

function renderDeviceList() {
  const container = document.getElementById('device-list');
  if (devices.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No devices registered yet. Use the form above to add your first device.</p></div>';
    return;
  }
  container.innerHTML = devices.map(d => {
    const t = TYPES[d.device_type] || {};
    return `<div class="device-card" onclick="APP.showDeviceActions('${d.device_id}')">
      <div class="device-icon ${t.iconClass || ''}">${t.icon || '📦'}</div>
      <div class="device-info">
        <div class="device-name">${esc(d.name)}</div>
        <div class="device-meta">${esc(d.device_id)} · ${esc(d.location || 'No location')}</div>
      </div>
      <div class="device-arrow">›</div>
    </div>`;
  }).join('');
}

function showDeviceActions(deviceId) {
  const d = devices.find(x => x.device_id === deviceId);
  if (!d) return;
  const t = TYPES[d.device_type] || {};

  const modal = document.getElementById('code-modal');
  document.getElementById('modal-title').textContent = d.name + ' — Actions';
  document.getElementById('modal-code').textContent = '';

  // Build action buttons
  const sheet = modal.querySelector('.modal-sheet');
  const existing = sheet.querySelector('.device-actions');
  if (existing) existing.remove();

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'device-actions';
  
  const cfg = d.config || {};
  let editFieldsHtml = '';
  
  if (d.device_type === 'gps_tracker') {
    const vc = cfg.vehicle_category || '4-wheeler';
    editFieldsHtml = `
      <div class="card mt-16" style="background:var(--surface2);border-color:var(--border);padding:14px">
        <span class="card-title" style="font-size:10px;margin-bottom:8px;display:block">Edit Vehicle details</span>
        <label>Vehicle Category</label>
        <select id="edit-vehicle-category" onchange="APP.onEditVehicleCategoryChange()">
          <option value="2-wheeler" ${vc === '2-wheeler' ? 'selected' : ''}>🏍️ Two-Wheeler</option>
          <option value="4-wheeler" ${vc !== '2-wheeler' ? 'selected' : ''}>🚗 Four-Wheeler</option>
        </select>
        <label>Vehicle Type</label>
        <select id="edit-vehicle-type">
          ${vc === '2-wheeler' ? 
            `<option value="motorcycle" selected>Motorcycle</option>` : 
            `<option value="car" ${cfg.vehicle_type === 'car' ? 'selected' : ''}>Sedan / Hatchback</option>
             <option value="suv" ${cfg.vehicle_type === 'suv' ? 'selected' : ''}>SUV / Jeep</option>
             <option value="bus" ${cfg.vehicle_type === 'bus' ? 'selected' : ''}>Bus</option>
             <option value="truck" ${cfg.vehicle_type === 'truck' ? 'selected' : ''}>Truck / Heavy Vehicle</option>`
          }
        </select>
        <label>Fuel Type</label>
        <select id="edit-fuel-type">
          <option value="petrol" ${cfg.fuel_type === 'petrol' ? 'selected' : ''}>Petrol (Gasoline)</option>
          <option value="diesel" ${cfg.fuel_type === 'diesel' ? 'selected' : ''}>Diesel</option>
          <option value="cng" ${cfg.fuel_type === 'cng' ? 'selected' : ''}>CNG</option>
          <option value="electric" ${cfg.fuel_type === 'electric' ? 'selected' : ''}>Electric</option>
        </select>
        <label>Last Service Date</label>
        <input type="date" id="edit-service-date" value="${cfg.service_date || ''}">
        <label>Last Service Mileage (km)</label>
        <input type="number" id="edit-service-mileage" value="${cfg.service_mileage || 0}" min="0">
        <button class="btn btn-sm btn-block mt-16 btn-primary" onclick="APP.saveDeviceSettings('${d.device_id}')">💾 Save Vehicle Settings</button>
      </div>
    `;
  } else if (d.device_type === 'moss_water_tank') {
    editFieldsHtml = `
      <div class="card mt-16" style="background:var(--surface2);border-color:var(--border);padding:14px">
        <span class="card-title" style="font-size:10px;margin-bottom:8px;display:block">Edit Dryer Threshold Settings</span>
        <label>Target Temperature Limit (°C)</label>
        <input type="number" id="edit-temp-limit" value="${cfg.temp_limit || 30.0}">
        <label>Target Humidity Limit (%)</label>
        <input type="number" id="edit-hum-limit" value="${cfg.hum_limit || 40.0}">
        <button class="btn btn-sm btn-block mt-16 btn-primary" onclick="APP.saveDeviceSettings('${d.device_id}')">💾 Save Threshold Settings</button>
      </div>
    `;
  }

  actionsDiv.innerHTML = `
    <div class="status-row"><span class="status-label">Device ID</span><span class="status-value">${esc(d.device_id)}</span></div>
    <div class="status-row"><span class="status-label">Type</span><span class="status-value">${esc(t.label || d.device_type)}</span></div>
    <div class="status-row"><span class="status-label">Location</span><span class="status-value">${esc(d.location || '—')}</span></div>
    ${editFieldsHtml}
    <div class="btn-group mt-16">
      <button class="btn btn-primary" onclick="APP.viewOnDash('${d.device_id}')">📊 Dashboard</button>
      <button class="btn" onclick="APP.showCode('${d.device_id}')">⚡ Arduino Code</button>
      <button class="btn btn-danger" onclick="APP.deleteDevice('${d.device_id}')">🗑 Delete</button>
    </div>
  `;

  sheet.querySelector('.code-block').style.display = 'none';
  sheet.querySelector('.btn-group.mt-16').style.display = 'none';
  sheet.appendChild(actionsDiv);
  modal.classList.add('show');
}

async function saveDeviceSettings(deviceId) {
  const d = devices.find(x => x.device_id === deviceId);
  if (!d) return;

  let payload = {};
  if (d.device_type === 'gps_tracker') {
    payload = {
      vehicle_category: document.getElementById('edit-vehicle-category').value,
      vehicle_type: document.getElementById('edit-vehicle-type').value,
      fuel_type: document.getElementById('edit-fuel-type').value,
      service_date: document.getElementById('edit-service-date').value,
      service_mileage: parseInt(document.getElementById('edit-service-mileage').value) || 0
    };
  } else if (d.device_type === 'moss_water_tank') {
    payload = {
      temp_limit: parseFloat(document.getElementById('edit-temp-limit').value) || 30.0,
      hum_limit: parseFloat(document.getElementById('edit-hum-limit').value) || 40.0,
      low_level: 20,
      full_level: 5
    };
  }

  try {
    const r = await fetch(`/api/device-config.php?device_id=${deviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error('Failed to update config settings');
    toast('Device settings saved!', 'success');
    closeModal();
    loadDevices();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function viewOnDash(deviceId) {
  closeModal();
  navigate('dashboard');
  document.getElementById('dash-device-select').value = deviceId;
  switchDevice(deviceId);
}

async function addDevice() {
  const errEl = document.getElementById('add-error');
  errEl.style.display = 'none';
  const type = document.getElementById('add-type').value;
  const body = {
    device_id: document.getElementById('add-id').value.trim(),
    device_type: type,
    name: document.getElementById('add-name').value.trim(),
    location: document.getElementById('add-location').value.trim()
  };
  // Include vehicle / service parameters or moss thresholds
  if (type === 'gps_tracker') {
    body.vehicle_category = document.getElementById('add-vehicle-category').value;
    body.vehicle_type = document.getElementById('add-vehicle-type').value;
    body.fuel_type = document.getElementById('add-fuel-type').value;
    body.service_date = document.getElementById('add-service-date').value;
    body.service_mileage = parseInt(document.getElementById('add-service-mileage').value) || 0;
  } else if (type === 'moss_water_tank') {
    body.temp_limit = parseFloat(document.getElementById('add-temp-limit').value) || 30.0;
    body.hum_limit = parseFloat(document.getElementById('add-hum-limit').value) || 40.0;
    body.low_level = 20;
    body.full_level = 5;
  }

  if (!body.device_id || !body.name) {
    errEl.textContent = 'Device ID and Name are required';
    errEl.style.display = 'block';
    return;
  }
  try {
    const r = await fetch('/api/devices.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    
    // Clear inputs
    document.getElementById('add-id').value = '';
    document.getElementById('add-name').value = '';
    document.getElementById('add-location').value = '';
    if (type === 'gps_tracker') {
      document.getElementById('add-service-date').value = '';
      document.getElementById('add-service-mileage').value = '';
    }
    toast('Device registered!', 'success');
    loadDevices();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

async function deleteDevice(deviceId) {
  if (!confirm('Delete device "' + deviceId + '" and all its data?')) return;
  try {
    const r = await fetch('/api/devices.php?device_id=' + deviceId, { method: 'DELETE' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    if (currentDevice && currentDevice.device_id === deviceId) {
      currentDevice = null;
      document.getElementById('dash-live').classList.add('hidden');
      document.getElementById('dash-empty').style.display = 'block';
    }
    closeModal();
    toast('Device deleted', 'success');
    loadDevices();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function onTypeChange() {
  const typeVal = document.getElementById('add-type').value;
  const t = TYPES[typeVal];
  document.getElementById('type-desc').textContent = t ? t.desc : '';
  
  // Show/hide GPS and Moss extra fields
  const gpsFields = document.getElementById('gps-extra-fields');
  const mossFields = document.getElementById('moss-extra-fields');
  if (gpsFields) gpsFields.style.display = (typeVal === 'gps_tracker') ? 'block' : 'none';
  if (mossFields) mossFields.style.display = (typeVal === 'moss_water_tank') ? 'block' : 'none';
}

function onVehicleCategoryChange() {
  const cat = document.getElementById('add-vehicle-category').value;
  const typeSelect = document.getElementById('add-vehicle-type');
  if (cat === '2-wheeler') {
    typeSelect.innerHTML = '<option value="motorcycle" selected>Motorcycle</option>';
  } else {
    typeSelect.innerHTML = `
      <option value="car" selected>Sedan / Hatchback</option>
      <option value="suv">SUV / Jeep</option>
      <option value="bus">Bus</option>
      <option value="truck">Truck / Heavy Vehicle</option>
    `;
  }
}

function onEditVehicleCategoryChange() {
  const cat = document.getElementById('edit-vehicle-category').value;
  const typeSelect = document.getElementById('edit-vehicle-type');
  if (cat === '2-wheeler') {
    typeSelect.innerHTML = '<option value="motorcycle" selected>Motorcycle</option>';
  } else {
    typeSelect.innerHTML = `
      <option value="car" selected>Sedan / Hatchback</option>
      <option value="suv">SUV / Jeep</option>
      <option value="bus">Bus</option>
      <option value="truck">Truck / Heavy Vehicle</option>
    `;
  }
}

// ── Dashboard ──
function switchDevice(id) {
  currentDevice = devices.find(d => d.device_id === id) || null;
  const dashEmpty = document.getElementById('dash-empty');
  const dashLive = document.getElementById('dash-live');
  if (!currentDevice) {
    dashEmpty.style.display = 'block';
    dashLive.classList.add('hidden');
    document.getElementById('dash-device-type').textContent = '—';
    return;
  }
  dashEmpty.style.display = 'none';
  dashLive.classList.remove('hidden');
  const t = TYPES[currentDevice.device_type] || {};
  document.getElementById('dash-device-type').textContent = t.label || currentDevice.device_type;
  
  // Populate parameters trend selection dropdown
  const paramSel = document.getElementById('trend-param-select');
  if (paramSel) {
    paramSel.innerHTML = '';
    for (const [key, meta] of Object.entries(t.sensors)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = meta.label;
      if (key === t.chartKey) opt.selected = true;
      paramSel.appendChild(opt);
    }
  }

  renderSensorGrid();
  renderControls();
  renderCarbonCard();
  renderAQIBanner();
  
  // Show/hide alerts card based on device type
  const alertsCard = document.getElementById('alerts-card');
  if (alertsCard) {
    if (currentDevice.device_type === 'moss_water_tank') {
      alertsCard.classList.remove('hidden');
    } else {
      alertsCard.classList.add('hidden');
    }
  }
  
  fetchData();
  fetchConfig();
}

function renderAQIBanner() {
  // Remove existing banner if any
  const existing = document.getElementById('aqi-banner-card');
  if (existing) existing.remove();
  
  if (!currentDevice || currentDevice.device_type !== 'air_quality') return;
  
  const banner = document.createElement('div');
  banner.id = 'aqi-banner-card';
  banner.className = 'card aqi-banner aqi-good';
  banner.innerHTML = `
    <div class="aqi-banner-inner">
      <div class="aqi-banner-main">
        <div class="aqi-banner-number" id="aqi-banner-value">—</div>
        <div class="aqi-banner-details">
          <div class="aqi-banner-label" id="aqi-banner-label">Calculating...</div>
          <div class="aqi-banner-advice" id="aqi-banner-advice">Waiting for sensor data</div>
        </div>
      </div>
      <div class="aqi-banner-meta">
        <div class="aqi-scale">
          <span class="aqi-dot aqi-good" title="Good (0-50)"></span>
          <span class="aqi-dot aqi-moderate" title="Moderate (51-100)"></span>
          <span class="aqi-dot aqi-usg" title="USG (101-150)"></span>
          <span class="aqi-dot aqi-unhealthy" title="Unhealthy (151-200)"></span>
          <span class="aqi-dot aqi-vunhealthy" title="Very Unhealthy (201-300)"></span>
          <span class="aqi-dot aqi-hazardous" title="Hazardous (301+)"></span>
        </div>
        <div class="aqi-banner-source">EPA AQI · PM2.5 + PM10 + CO₂</div>
      </div>
    </div>
  `;
  
  // Insert before the sensor grid card
  const dashLive = document.getElementById('dash-live');
  const sensorCard = dashLive.querySelector('.card');
  if (sensorCard) {
    sensorCard.parentNode.insertBefore(banner, sensorCard);
  }
}

function updateAQIBanner(aqiData) {
  const banner = document.getElementById('aqi-banner-card');
  if (!banner) return;
  
  if (!aqiData) {
    banner.className = 'card aqi-banner aqi-good';
    const valEl = document.getElementById('aqi-banner-value');
    const lblEl = document.getElementById('aqi-banner-label');
    const advEl = document.getElementById('aqi-banner-advice');
    if (valEl) valEl.textContent = '—';
    if (lblEl) lblEl.textContent = 'No Data';
    if (advEl) advEl.textContent = 'Waiting for sensor readings...';
    return;
  }
  
  banner.className = 'card aqi-banner ' + aqiData.css;
  const valEl = document.getElementById('aqi-banner-value');
  const lblEl = document.getElementById('aqi-banner-label');
  const advEl = document.getElementById('aqi-banner-advice');
  if (valEl) valEl.textContent = aqiData.value;
  if (lblEl) lblEl.textContent = aqiData.emoji + ' ' + aqiData.label;
  if (advEl) advEl.textContent = aqiData.advice;
}

function updateTrendChartSelection(val) {
  if (currentDevice) {
    fetchData();
  }
}

function renderSensorGrid() {
  if (!currentDevice) return;
  const t = TYPES[currentDevice.device_type];
  if (!t) return;
  const grid = document.getElementById('sensor-grid');
  grid.innerHTML = '';
  for (const [key, meta] of Object.entries(t.sensors)) {
    grid.innerHTML += `<div class="sensor-tile" data-color="${meta.color}">
      <div class="sensor-value" id="sv-${key}">—</div>
      <div class="sensor-label">${meta.label}${meta.unit ? ' <span class="sensor-unit">' + meta.unit + '</span>' : ''}</div>
    </div>`;
  }
  // Table header
  const thead = document.getElementById('table-head');
  thead.innerHTML = '<th>Time</th>';
  for (const [key, meta] of Object.entries(t.sensors)) {
    thead.innerHTML += `<th>${meta.label}</th>`;
  }
}

function renderControls() {
  if (!currentDevice) return;
  const t = TYPES[currentDevice.device_type];
  const card = document.getElementById('controls-card');
  const container = document.getElementById('controls-container');
  if (!t || t.controls.length === 0) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  container.innerHTML = '';
  t.controls.forEach(c => {
    if (c.type === 'toggle') {
      container.innerHTML += `<div class="status-row">
        <span class="status-label">${c.label}</span>
        <div class="toggle" id="ctrl-${c.key}" onclick="APP.toggleControl('${c.key}')"></div>
      </div>`;
    }
  });
}

// EPA AQI breakpoints for SPS30 particulate readings. CO₂ does not have an
// EPA AQI scale, so its ventilation bands are mapped to the same categories;
// the displayed indoor AQI is the most severe valid reading.
function interpolateAQI(value, breakpoints) {
  for (const [low, high, aqiLow, aqiHigh] of breakpoints) {
    if (value >= low && value <= high) return Math.round(((aqiHigh - aqiLow) / (high - low)) * (value - low) + aqiLow);
  }
  const last = breakpoints[breakpoints.length - 1];
  return value > last[1] ? 500 : null;
}

function aqiCategory(aqi) {
  if (aqi <= 50)  return { label: 'Good',                          css: 'aqi-good',      emoji: '😊', advice: 'Air quality is satisfactory. Enjoy outdoor activities!' };
  if (aqi <= 100) return { label: 'Moderate',                      css: 'aqi-moderate',   emoji: '😐', advice: 'Acceptable. Sensitive individuals should limit prolonged outdoor exertion.' };
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', css: 'aqi-usg',        emoji: '😷', advice: 'People with respiratory or heart conditions should reduce outdoor activity.' };
  if (aqi <= 200) return { label: 'Unhealthy',                     css: 'aqi-unhealthy',  emoji: '🤢', advice: 'Everyone may begin to experience health effects. Limit outdoor exertion.' };
  if (aqi <= 300) return { label: 'Very Unhealthy',                css: 'aqi-vunhealthy', emoji: '⚠️', advice: 'Health alert! Everyone should avoid outdoor physical activities.' };
  return               { label: 'Hazardous',                      css: 'aqi-hazardous',  emoji: '☠️', advice: 'EMERGENCY — everyone should avoid all outdoor activity.' };
}

function calculateIndoorAQI(data) {
  const pm25 = Number(data.pm2_5), pm10 = Number(data.pm10), co2 = Number(data.co2_ppm);
  const scores = [];
  if (Number.isFinite(pm25) && pm25 >= 0) scores.push(interpolateAQI(pm25, [[0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 500.4, 301, 500]]));
  if (Number.isFinite(pm10) && pm10 >= 0) scores.push(interpolateAQI(pm10, [[0, 54, 0, 50], [55, 154, 51, 100], [155, 254, 101, 150], [255, 354, 151, 200], [355, 424, 201, 300], [425, 604, 301, 500]]));
  if (Number.isFinite(co2) && co2 >= 0) scores.push(interpolateAQI(co2, [[0, 800, 0, 50], [801, 1000, 51, 100], [1001, 1400, 101, 150], [1401, 2000, 151, 200], [2001, 5000, 201, 300], [5001, 10000, 301, 500]]));
  const valid = scores.filter(Number.isFinite);
  if (!valid.length) return null;
  const aqi = Math.max(...valid);
  const cat = aqiCategory(aqi);
  return { value: aqi, label: cat.label, css: cat.css, emoji: cat.emoji, advice: cat.advice, display: `${aqi} — ${cat.label}` };
}

function addDerivedAirQuality(rows) {
  if (!currentDevice || currentDevice.device_type !== 'air_quality') return rows;
  return rows.map(row => {
    const aqiResult = calculateIndoorAQI(row.data || {});
    return { ...row, data: { ...(row.data || {}), aqi: aqiResult ? aqiResult.value : null, _aqiFull: aqiResult } };
  });
}

// ── Data Fetching ──
async function fetchData() {
  if (!currentDevice) return;
  const t = TYPES[currentDevice.device_type];
  if (!t) return;
  try {
    const r = await fetch(`/api/data.php?device_id=${currentDevice.device_id}&per_page=20`);
    if (!r.ok) return;
    const json = await r.json();
    const rows = addDerivedAirQuality(json.data || json);
    
    if (!Array.isArray(rows) || rows.length === 0) {
      for (const key of Object.keys(t.sensors)) {
        const el = document.getElementById('sv-' + key);
        if (el) el.textContent = '—';
      }
      const tbody = document.getElementById('table-body');
      if (tbody) tbody.innerHTML = '<tr><td colspan="' + (Object.keys(t.sensors).length + 1) + '" style="text-align:center;color:var(--text3)">Waiting for live sensor data from device...</td></tr>';
      updateAQIBanner(null);
      return;
    }

    // Update sensor tiles
    const latest = rows[0].data || {};
    for (const key of Object.keys(t.sensors)) {
      const el = document.getElementById('sv-' + key);
      if (el) {
        const val = latest[key];
        el.textContent = val !== undefined && val !== null ? (typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(2)) : val) : '—';
      }
    }

    // Online status
    updateOnlineStatus();
    
    // Update AQI banner for air quality devices
    if (currentDevice.device_type === 'air_quality') {
      updateAQIBanner(rows[0].data ? rows[0].data._aqiFull : null);
    }

    // Update table
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    rows.slice(0, 15).forEach(row => {
      const d = row.data || {};
      let tr = '<tr><td>' + fmtTime(row.recorded_at) + '</td>';
      for (const key of Object.keys(t.sensors)) {
        const v = d[key];
        tr += '<td>' + (v !== undefined && v !== null ? (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v) : '—') + '</td>';
      }
      tr += '</tr>';
      tbody.innerHTML += tr;
    });

    // Update chart
    updateChart(rows, t);

    // Update map if GPS
    if (currentDevice.device_type === 'gps_tracker' && latest.latitude && latest.longitude) {
      updateMapMarker(currentDevice.device_id, currentDevice.name, latest.latitude, latest.longitude);
      // Update map path with all historical points
      updateMapPath(rows);
    }

    // Update carbon emission stats for GPS devices
    if (currentDevice.device_type === 'gps_tracker') {
      updateCarbonStats(rows);
    }

    // Fetch notification history for moss devices
    if (currentDevice.device_type === 'moss_water_tank') {
      fetchNotifications();
    }
  } catch {}
}

async function fetchNotifications() {
  if (!currentDevice) return;
  const alertsCard = document.getElementById('alerts-card');
  const alertsBody = document.getElementById('alerts-body');
  const alertCount = document.getElementById('alert-count');
  
  if (currentDevice.device_type !== 'moss_water_tank') {
    if (alertsCard) alertsCard.classList.add('hidden');
    return;
  }
  
  if (alertsCard) alertsCard.classList.remove('hidden');
  
  try {
    const r = await fetch(`/api/notifications.php?device_id=${currentDevice.device_id}&limit=10`);
    const notifications = await r.json();
    
    if (!Array.isArray(notifications) || notifications.length === 0) {
      if (alertsBody) alertsBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text3)">No alerts yet</td></tr>';
      if (alertCount) alertCount.textContent = '0';
      return;
    }
    
    if (alertCount) alertCount.textContent = notifications.length;
    if (alertsBody) {
      alertsBody.innerHTML = '';
      notifications.forEach(n => {
        alertsBody.innerHTML += `<tr>
          <td>${fmtTime(n.sent_at)}</td>
          <td style="font-size:11px">${esc(n.message || '—')}</td>
        </tr>`;
      });
    }
  } catch {
    if (alertsBody) alertsBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text3)">Could not load alerts</td></tr>';
  }
}

async function fetchConfig() {
  if (!currentDevice) return;
  const t = TYPES[currentDevice.device_type];
  if (!t || t.controls.length === 0) return;
  try {
    const r = await fetch(`/api/device-config.php?device_id=${currentDevice.device_id}`);
    const json = await r.json();
    const cfg = json.desired || json;
    t.controls.forEach(c => {
      if (c.type === 'toggle') {
        const el = document.getElementById('ctrl-' + c.key);
        if (el) el.classList.toggle('on', cfg[c.key] === 'on');
      }
    });
  } catch {}
}

async function toggleControl(key) {
  if (!currentDevice) return;
  const el = document.getElementById('ctrl-' + key);
  const isOn = el.classList.contains('on');
  const newVal = isOn ? 'off' : 'on';
  el.classList.toggle('on');
  try {
    await fetch(`/api/device-config.php?device_id=${currentDevice.device_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: newVal })
    });
    toast(`${key} → ${newVal.toUpperCase()}`, 'success');
  } catch {
    el.classList.toggle('on'); // revert
    toast('Failed to update', 'error');
  }
}

function updateOnlineStatus() {
  // We don't have last_seen in data response, so just show online during active polling
  const badge = document.getElementById('dash-online-badge');
  badge.className = 'card-badge badge-green';
  badge.innerHTML = '<span class="dot on"></span> Online';
}

// ── Chart ──
function updateChart(rows, type) {
  const ctx = document.getElementById('trend-chart');
  
  // Get active selected parameter from chart dropdown
  const dropdown = document.getElementById('trend-param-select');
  const key = dropdown ? dropdown.value : type.chartKey;
  const sensorMeta = type.sensors[key] || {};
  const label = sensorMeta.label + (sensorMeta.unit ? ' (' + sensorMeta.unit + ')' : '');

  const labels = rows.slice(0, 20).reverse().map(r => fmtTime(r.recorded_at));
  const data = rows.slice(0, 20).reverse().map(r => {
    const v = (r.data || {})[key];
    return v !== undefined ? v : null;
  });

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#6366f1'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: '#5c647a', font: { size: 10 }, maxRotation: 45 },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          ticks: { color: '#5c647a', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

// ── Map ──
function initMap() {
  if (leafletMap) return;
  const container = document.getElementById('map-container');
  if (!container) return;

  const gpsDevices = devices.filter(d => d.device_type === 'gps_tracker');
  if (gpsDevices.length === 0) {
    container.style.display = 'none';
    document.getElementById('map-empty').style.display = 'block';
    return;
  }
  container.style.display = 'block';
  document.getElementById('map-empty').style.display = 'none';

  leafletMap = L.map(container).setView([27.7, 85.3], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(leafletMap);

  // Fetch latest GPS data for all trackers
  gpsDevices.forEach(d => {
    fetchGPSForMap(d.device_id, d.name);
  });

  // Fix map rendering after tab switch
  setTimeout(() => leafletMap.invalidateSize(), 300);
}

async function fetchGPSForMap(deviceId, name) {
  try {
    const r = await fetch(`/data/${deviceId}?per_page=1`);
    const json = await r.json();
    const rows = json.data || json;
    if (Array.isArray(rows) && rows.length > 0) {
      const d = rows[0].data || {};
      if (d.latitude && d.longitude) {
        updateMapMarker(deviceId, name, d.latitude, d.longitude);
      }
    }
  } catch {}
}

function updateMapMarker(deviceId, name, lat, lng) {
  if (!leafletMap) return;
  if (mapMarkers[deviceId]) {
    mapMarkers[deviceId].setLatLng([lat, lng]);
  } else {
    mapMarkers[deviceId] = L.marker([lat, lng])
      .addTo(leafletMap)
      .bindPopup(`<b>${esc(name)}</b><br>Lat: ${lat}<br>Lng: ${lng}<br>Time: ${fmtTime(new Date().toISOString())}`);
  }
  leafletMap.setView([lat, lng], 14);
}

function updateMapPath(rows) {
  if (!leafletMap) return;
  // Draw polyline of GPS trail with timestamps
  const pts = rows.filter(r => (r.data||{}).latitude && (r.data||{}).longitude)
    .map(r => [r.data.latitude, r.data.longitude]).reverse(); // Oldest first
  if (pts.length < 2) return;
  if (mapPath) leafletMap.removeLayer(mapPath);
  mapPath = L.polyline(pts, { color: '#6366f1', weight: 4, opacity: 0.8, dashArray: '6,6' }).addTo(leafletMap);
  
  // Clear old markers along path
  if (window.pathMarkers) {
    window.pathMarkers.forEach(m => leafletMap.removeLayer(m));
  }
  window.pathMarkers = [];

  // Add intermediate timestamp circle markers
  rows.filter(r => (r.data||{}).latitude && (r.data||{}).longitude).forEach(r => {
    const marker = L.circleMarker([r.data.latitude, r.data.longitude], {
      radius: 5, fillColor: '#8b5cf6', fillOpacity: 0.9, color: '#fff', weight: 1.5
    }).addTo(leafletMap).bindPopup(`<b>Time (Nepal): ${fmtTime(r.recorded_at)}</b><br>Speed: ${(r.data.speed_kmh||0).toFixed(1)} km/h`);
    window.pathMarkers.push(marker);
  });
}

function switchMapDevice(id) {
  if (!leafletMap) return;
  if (!id) {
    // Show all
    const bounds = [];
    Object.values(mapMarkers).forEach(m => bounds.push(m.getLatLng()));
    if (bounds.length > 0) leafletMap.fitBounds(bounds);
    return;
  }
  const marker = mapMarkers[id];
  if (marker) {
    leafletMap.setView(marker.getLatLng(), 16);
    marker.openPopup();
  }
}

// ── Carbon Emission Calculation ──
function renderCarbonCard() {
  if (!currentDevice || currentDevice.device_type !== 'gps_tracker') {
    const existing = document.getElementById('carbon-card');
    if (existing) existing.style.display = 'none';
    return;
  }
  let card = document.getElementById('carbon-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'carbon-card';
    card.className = 'card';
    const controlsCard = document.getElementById('controls-card');
    controlsCard.parentNode.insertBefore(card, controlsCard.nextSibling);
  }
  card.style.display = 'block';
  const cfg = currentDevice.config || {};
  const vt = cfg.vehicle_type || 'car';
  const ft = cfg.fuel_type || 'petrol';
  const factor = (EMISSION_FACTORS[vt]||{})[ft] || 192;
  const vtLabel = {motorcycle:'Motorcycle',car:'Sedan/Hatchback',suv:'SUV/Jeep',bus:'Bus',truck:'Truck'};
  const ftLabel = {petrol:'Petrol',diesel:'Diesel',cng:'CNG',electric:'Electric'};

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">🌍 Carbon Emission Tracker</span>
      <span class="card-badge badge-green" id="carbon-badge-factor">${factor} g CO₂/km</span>
    </div>
    <div class="status-row"><span class="status-label">Vehicle Type</span><span class="status-value">${vtLabel[vt]||vt}</span></div>
    <div class="status-row"><span class="status-label">Fuel Source</span><span class="status-value">${ftLabel[ft]||ft}</span></div>
    <div class="status-row"><span class="status-label">Last Serviced</span><span class="status-value">${cfg.service_date || 'N/A'} (at ${cfg.service_mileage || 0} km)</span></div>
    <div class="status-row"><span class="status-label">Status</span><span class="status-value" id="carbon-status">Calculating...</span></div>
    
    <div class="sensor-grid mt-16" style="grid-template-columns:repeat(3,1fr)">
      <div class="sensor-tile" data-color="green">
        <div class="sensor-value" id="carbon-dist">0</div>
        <div class="sensor-label">Distance <span class="sensor-unit">km</span></div>
      </div>
      <div class="sensor-tile" data-color="amber">
        <div class="sensor-value" id="carbon-emit">0</div>
        <div class="sensor-label">CO₂ Emitted <span class="sensor-unit">kg</span></div>
      </div>
      <div class="sensor-tile" data-color="purple">
        <div class="sensor-value" id="carbon-trees">0</div>
        <div class="sensor-label">Offset Trees <span class="sensor-unit">/day</span></div>
      </div>
    </div>
    
    <div class="card mt-16" style="background:var(--surface2);border-color:var(--border);padding:14px;margin-bottom:0">
      <span class="card-title" style="font-size:10px;margin-bottom:8px;display:block">Daily Trip Summary</span>
      <div class="status-row" style="font-size:12px"><span class="status-label">Start Point</span><span class="status-value" id="carbon-start">—</span></div>
      <div class="status-row" style="font-size:12px"><span class="status-label">End Point</span><span class="status-value" id="carbon-end">—</span></div>
    </div>
    
    <p class="text-xs text-muted mt-8">GPS updates are filtered to ignore jitter when stationary. Daily emissions are calculated once travel exceeds the 1500m (1.5 km) minimum threshold to eliminate drift.</p>
  `;
}

function updateCarbonStats(rows) {
  if (!currentDevice || currentDevice.device_type !== 'gps_tracker') return;
  const cfg = currentDevice.config || {};
  const vt = cfg.vehicle_type || 'car';
  const ft = cfg.fuel_type || 'petrol';
  const factor = (EMISSION_FACTORS[vt]||{})[ft] || 192;

  // Calculate total distance from GPS points (ignoring raw GPS jitter < 5 meters)
  let totalDist = 0;
  const pts = rows.filter(r => (r.data||{}).latitude && (r.data||{}).longitude).reverse(); // chronological order
  for (let i = 1; i < pts.length; i++) {
    const dist = haversine(
      pts[i-1].data.latitude, pts[i-1].data.longitude,
      pts[i].data.latitude, pts[i].data.longitude
    );
    if (dist > 0.005) { // 5 meters threshold for GPS jitter
      totalDist += dist;
    }
  }

  // Jitter limit threshold: only calculate emissions if vehicle traveled at least 1500 meters (1.5 km)
  const isMoving = totalDist >= 1.5;
  const emissionKg = isMoving ? ((totalDist * factor) / 1000) : 0;
  const treesNeeded = isMoving ? Math.ceil(emissionKg / (22 / 365)) : 0; // tree offset absorption standard

  const distEl = document.getElementById('carbon-dist');
  const emitEl = document.getElementById('carbon-emit');
  const treesEl = document.getElementById('carbon-trees');
  const statusEl = document.getElementById('carbon-status');
  
  if (distEl) distEl.textContent = totalDist.toFixed(2);
  if (emitEl) emitEl.textContent = emissionKg.toFixed(2);
  if (treesEl) treesEl.textContent = treesNeeded;
  
  if (statusEl) {
    if (isMoving) {
      statusEl.className = 'status-value badge-green';
      statusEl.textContent = 'Active Driving';
    } else {
      statusEl.className = 'status-value badge-amber';
      statusEl.textContent = totalDist > 0 ? 'Jitter Filtered (<1500m)' : 'Stationary';
    }
  }

  // Daily Trip Summary (Start to End points)
  const startEl = document.getElementById('carbon-start');
  const endEl = document.getElementById('carbon-end');
  
  if (pts.length > 0) {
    const startPt = pts[0];
    const endPt = pts[pts.length - 1];
    if (startEl) startEl.textContent = `${startPt.data.latitude.toFixed(4)}, ${startPt.data.longitude.toFixed(4)} (${fmtTime(startPt.recorded_at)})`;
    if (endEl) endEl.textContent = `${endPt.data.latitude.toFixed(4)}, ${endPt.data.longitude.toFixed(4)} (${fmtTime(endPt.recorded_at)})`;
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Code Generator ──
function showCode(deviceId) {
  const d = devices.find(x => x.device_id === deviceId);
  if (!d) return;

  // Clean up modal
  const modal = document.getElementById('code-modal');
  const sheet = modal.querySelector('.modal-sheet');
  const existing = sheet.querySelector('.device-actions');
  if (existing) existing.remove();
  sheet.querySelector('.code-block').style.display = 'block';
  sheet.querySelector('.btn-group.mt-16').style.display = 'flex';

  const code = generateArduinoCode(d);
  document.getElementById('modal-title').textContent = 'Arduino Code — ' + d.name;
  document.getElementById('modal-code').textContent = code;
  modal.classList.add('show');
}

function generateArduinoCode(d) {
  const gen = CODE_GENERATORS[d.device_type];
  if (gen) return gen(d);
  return '// No code template for: ' + d.device_type;
}

const SERVER = window.location.origin;
const WIFI_SSID = 'YOUR_WIFI_SSID';
const WIFI_PASS = 'YOUR_WIFI_PASSWORD';

const CODE_GENERATORS = {

// ═══════════ AIR QUALITY MONITOR ═══════════
air_quality: (d) => `/*
  ============================================================================
  ${d.name} — Smart Air Quality & Carbon Monitor
  Platform      : ESP32 DevKit V1 (ESP-WROOM-32)
  Sensors       : SPS30 (PM1.0/2.5/4.0/10, UART2), CO2-C8 NDIR (CO2, UART1),
                  DHT22 (Temperature & Humidity, Digital GPIO)
  Connectivity  : Wi-Fi -> AITALIM IoT Dashboard (HTTP POST, JSON)
  Device ID     : ${d.device_id}
  ============================================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <DHT.h>
#include <SensirionUartSps30.h>

#ifdef NO_ERROR
#undef NO_ERROR
#endif
#define NO_ERROR 0

// ── Configuration ──
#define WIFI_SSID       "${WIFI_SSID}"
#define WIFI_PASSWORD   "${WIFI_PASS}"
#define SERVER_URL      "${SERVER}"
#define DEVICE_ID       "${d.device_id}"
#define SEND_INTERVAL   5000

// ── GPIO ──
#define DHT_PIN        4
#define DHT_TYPE       DHT22
#define UART2_RX_PIN   16
#define UART2_TX_PIN   17
#define UART1_RX_PIN   26
#define UART1_TX_PIN   27

DHT dht(DHT_PIN, DHT_TYPE);
HardwareSerial CO2Serial(1);
HardwareSerial SPS30Serial(2);
SensirionUartSps30 sps30;
static char sps30Err[64];

// Exponential Moving Average filter for SPS30
struct EMAFilter {
  float value;
  bool initialized;
  float alpha;
  EMAFilter(float a = 0.2) : value(0), initialized(false), alpha(a) {}
  float update(float raw) {
    if (!initialized) { value = raw; initialized = true; }
    else { value = (raw * alpha) + (value * (1.0 - alpha)); }
    return value;
  }
};
EMAFilter pm1_filter(0.2);
EMAFilter pm25_filter(0.2);
EMAFilter pm4_filter(0.2);
EMAFilter pm10_filter(0.2);

unsigned long lastSend = 0;

// CO2-C8 protocol
const uint8_t CO2_CMD[] = {0x64, 0x69, 0x03, 0x5E, 0x4E};

uint16_t crc16(const uint8_t* d, uint8_t len) {
  uint16_t c = 0xFFFF;
  for (uint8_t i = 0; i < len; i++) {
    c ^= d[i];
    for (uint8_t j = 8; j; j--) c = (c & 1) ? (c >> 1) ^ 0xA001 : c >> 1;
  }
  return c;
}

bool readCO2(float &ppm) {
  while (CO2Serial.available()) CO2Serial.read();
  CO2Serial.write(CO2_CMD, sizeof(CO2_CMD));
  unsigned long t = millis();
  while (CO2Serial.available() < 14) { if (millis() - t > 500) return false; }
  uint8_t r[14];
  CO2Serial.readBytes(r, 14);
  uint16_t cc = crc16(r, 12);
  uint16_t s = (r[13] << 8) | r[12];
  uint16_t rv = (r[12] << 8) | r[13];
  if (cc != s && cc != rv) return false;
  ppm = (float)((r[5] << 8) | r[4]);
  return true;
}

void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int t = 0;
  while (WiFi.status() != WL_CONNECTED && t < 20) { delay(500); Serial.print("."); t++; }
  if (WiFi.status() == WL_CONNECTED) Serial.printf("\\n[WiFi] OK IP: %s\\n", WiFi.localIP().toString().c_str());
  else Serial.println("\\n[WiFi] FAIL");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("=== ${d.name} ===");
  dht.begin();
  CO2Serial.begin(9600, SERIAL_8N1, UART1_RX_PIN, UART1_TX_PIN);
  SPS30Serial.begin(115200, SERIAL_8N1, UART2_RX_PIN, UART2_TX_PIN);
  while (!SPS30Serial) delay(100);
  sps30.begin(SPS30Serial);
  sps30.stopMeasurement();
  sps30.startMeasurement(SPS30_OUTPUT_FORMAT_OUTPUT_FORMAT_FLOAT);
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();

    float pm1=0,pm2=0,pm4=0,pm10=0,nc05=0,nc1=0,nc2=0,nc4=0,nc10=0,ts=0;
    bool pmOK = sps30.readMeasurementValuesFloat(pm1,pm2,pm4,pm10,nc05,nc1,nc2,nc4,nc10,ts) == NO_ERROR;

    float co2 = 0;
    bool co2OK = readCO2(co2);

    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    bool dhtOK = !isnan(temp) && !isnan(hum);

    JsonDocument doc;
    doc["pm1_0"] = pmOK ? pm1_filter.update(pm1) : -1;
    doc["pm2_5"] = pmOK ? pm25_filter.update(pm2) : -1;
    doc["pm4_0"] = pmOK ? pm4_filter.update(pm4) : -1;
    doc["pm10"] = pmOK ? pm10_filter.update(pm10) : -1;
    doc["co2_ppm"] = co2OK ? co2 : -1;
    doc["temperature"] = dhtOK ? temp : -1;
    doc["humidity"] = dhtOK ? hum : -1;

    String payload;
    serializeJson(doc, payload);

    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.begin(client, String(SERVER_URL) + "/api/data.php?device_id=" + DEVICE_ID);
    http.setTimeout(5000);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(payload);
    Serial.printf("[HTTP] %d\\n", code);
    http.end();
  }
}`,

// ═══════════ GPS TRACKER ═══════════
gps_tracker: (d) => `/*
  ============================================================================
  ${d.name} — GPS Tracker with SIM800L
  Platform : ESP32 DevKit V1
  Modules  : NEO-6M GPS (UART2), SIM800L (UART1)
  Device ID: ${d.device_id}
  ============================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>

#define WIFI_SSID       "${WIFI_SSID}"
#define WIFI_PASSWORD   "${WIFI_PASS}"
#define SERVER_URL      "${SERVER}"
#define DEVICE_ID       "${d.device_id}"
#define SEND_INTERVAL   5000
#define SIM_INTERVAL    15000

TinyGPSPlus gps;
HardwareSerial GPS_SERIAL(2);
HardwareSerial SIM_SERIAL(1);

unsigned long lastSend = 0;
unsigned long lastSIM = 0;

void sendAT(String cmd) {
  SIM_SERIAL.println(cmd);
  unsigned long t = millis();
  while (millis() - t < 2000) {
    while (SIM_SERIAL.available()) Serial.write(SIM_SERIAL.read());
  }
}

void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int t = 0;
  while (WiFi.status() != WL_CONNECTED && t < 20) { delay(500); Serial.print("."); t++; }
  if (WiFi.status() == WL_CONNECTED) Serial.printf("\\n[WiFi] OK IP: %s\\n", WiFi.localIP().toString().c_str());
  else Serial.println("\\n[WiFi] FAIL");
}

void setup() {
  Serial.begin(115200);
  GPS_SERIAL.begin(9600, SERIAL_8N1, 16, 17);
  SIM_SERIAL.begin(9600, SERIAL_8N1, 26, 27);
  delay(3000);
  Serial.println("=== ${d.name} ===");
  sendAT("AT");
  sendAT("ATE0");
  connectWiFi();
}

void loop() {
  while (GPS_SERIAL.available()) gps.encode(GPS_SERIAL.read());

  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();

    JsonDocument doc;
    if (gps.location.isValid()) {
      doc["latitude"] = gps.location.lat();
      doc["longitude"] = gps.location.lng();
      doc["speed_kmh"] = gps.speed.kmph();
      doc["altitude_m"] = gps.altitude.meters();
      doc["satellites"] = gps.satellites.value();
      doc["hdop"] = gps.hdop.hdop();
    } else {
      doc["latitude"] = 0;
      doc["longitude"] = 0;
      doc["speed_kmh"] = 0;
      doc["altitude_m"] = 0;
      doc["satellites"] = gps.satellites.value();
      doc["hdop"] = 0;
    }

    String payload;
    serializeJson(doc, payload);

    HTTPClient http;
    http.begin(String(SERVER_URL) + "/data/" + DEVICE_ID);
    http.setTimeout(5000);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(payload);
    Serial.printf("[HTTP] %d | Sats: %d\\n", code, gps.satellites.value());
    http.end();
  }

  if (millis() - lastSIM >= SIM_INTERVAL) {
    lastSIM = millis();
    sendAT("AT+CSQ");
    sendAT("AT+CREG?");
  }

  while (Serial.available()) SIM_SERIAL.write(Serial.read());
  while (SIM_SERIAL.available()) Serial.write(SIM_SERIAL.read());
}`,

// ═══════════ MOSS WATER TANK ═══════════
moss_water_tank: (d) => `/*
  ============================================================================
  \${d.name} — Smart Hybrid Solar Dryer
  Platform : ESP32 DevKit V1
  Sensors  : DHT22 (temp/humidity)
  Actuator : Relay-controlled ventilation fan (active LOW)
  Device ID: \${d.device_id}
  ============================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>

#define WIFI_SSID       "${WIFI_SSID}"
#define WIFI_PASSWORD   "${WIFI_PASS}"
#define SERVER_URL      "${SERVER}"
#define DEVICE_ID       "\${d.device_id}"
#define SEND_INTERVAL   5000
#define CONFIG_INTERVAL 5000

#define DHT_PIN    27
#define DHT_TYPE   DHT22
#define RELAY_PIN  26

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSend = 0;
unsigned long lastConfig = 0;
unsigned long lastWiFiReconnectAttempt = 0;
const unsigned long WIFI_RECONNECT_INTERVAL = 30000;

bool fanState = false;
float tempLimit = 30.0;
float humLimit = 40.0;
String cfgMode = "auto";

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  unsigned long now = millis();
  if (now - lastWiFiReconnectAttempt < WIFI_RECONNECT_INTERVAL && lastWiFiReconnectAttempt != 0) {
    return;
  }
  
  lastWiFiReconnectAttempt = now;
  Serial.printf("\\n[WiFi] Reconnecting to %s...\\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int t = 0;
  while (WiFi.status() != WL_CONNECTED && t < 10) { 
    delay(500); 
    Serial.print("."); 
    t++; 
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\\n[WiFi] Connected! IP: %s\\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\\n[WiFi] Connection failed. Will retry later.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("=== \${d.name} ===");
  dht.begin();
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // OFF initially (Active LOW relay)
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  unsigned long now = millis();

  if (now - lastSend >= SEND_INTERVAL) {
    lastSend = now;

    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    bool dhtOK = !isnan(temp) && !isnan(hum);

    if (cfgMode == "auto") {
      if (dhtOK && (temp >= tempLimit || hum >= humLimit)) {
        fanState = true;
      } else {
        fanState = false;
      }
    } else {
      fanState = (cfgMode == "on");
    }

    digitalWrite(RELAY_PIN, fanState ? LOW : HIGH);
    Serial.printf("[Sensors] Temp: %.1f C | Hum: %.1f %% | Fan: %s\\n", 
                  temp, hum, fanState ? "ON" : "OFF");

    if (WiFi.status() == WL_CONNECTED) {
      JsonDocument doc;
      doc["temperature"] = dhtOK ? temp : -1.0;
      doc["humidity"] = dhtOK ? hum : -1.0;
      doc["fan_state"] = fanState ? "on" : "off";

      String payload;
      serializeJson(doc, payload);

      WiFiClientSecure client;
      client.setInsecure();

      HTTPClient http;
      http.begin(client, String(SERVER_URL) + "/api/data.php?device_id=" + DEVICE_ID);
      http.setTimeout(5000);
      http.addHeader("Content-Type", "application/json");
      int code = http.POST(payload);
      Serial.printf("[HTTP Data Push] Response: %d\\n", code);
      http.end();
    }
  }

  if (WiFi.status() == WL_CONNECTED && (now - lastConfig >= CONFIG_INTERVAL)) {
    lastConfig = now;

    WiFiClientSecure client;
    client.setInsecure();

    HTTPClient http;
    http.begin(client, String(SERVER_URL) + "/api/device-config.php?device_id=" + DEVICE_ID);
    http.setTimeout(5000);
    int code = http.GET();
    if (code == 200) {
      String body = http.getString();
      JsonDocument doc;
      if (!deserializeJson(doc, body)) {
        JsonObject desired = doc["desired"];
        if (!desired.isNull()) {
          cfgMode = String(desired["pump"] | "auto");
          tempLimit = desired["temp_limit"] | 30.0;
          humLimit = desired["hum_limit"] | 40.0;
          Serial.printf("[Config Update] Fan Mode: %s | Temp Limit: %.1f | Hum Limit: %.1f\\n", cfgMode.c_str(), tempLimit, humLimit);
          
          // Report back config status
          JsonDocument reportDoc;
          reportDoc["pump"] = cfgMode;
          reportDoc["temp_limit"] = tempLimit;
          reportDoc["hum_limit"] = humLimit;
          
          String reportPayload;
          serializeJson(reportDoc, reportPayload);
          
          WiFiClientSecure reportClient;
          reportClient.setInsecure();

          HTTPClient reportHttp;
          reportHttp.begin(reportClient, String(SERVER_URL) + "/api/device-config.php?device_id=" + DEVICE_ID + "&role=device");
          reportHttp.setTimeout(3000);
          reportHttp.addHeader("Content-Type", "application/json");
          reportHttp.POST(reportPayload);
          reportHttp.end();
        }
      }
    }
    http.end();
  }
}`
};

// ── Code Modal Actions ──
function copyCode() {
  const code = document.getElementById('modal-code').textContent;
  navigator.clipboard.writeText(code).then(() => toast('Code copied!', 'success')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Code copied!', 'success');
  });
}

function downloadCode() {
  const code = document.getElementById('modal-code').textContent;
  const blob = new Blob([code], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentDevice ? currentDevice.device_id : 'device') + '.ino';
  a.click();
}

function closeModal() {
  const modal = document.getElementById('code-modal');
  modal.classList.remove('show');
  // Clean up device actions if any
  const sheet = modal.querySelector('.modal-sheet');
  const existing = sheet.querySelector('.device-actions');
  if (existing) existing.remove();
  sheet.querySelector('.code-block').style.display = 'block';
  sheet.querySelector('.btn-group.mt-16').style.display = 'flex';
}

// ── CSV Export ──
function downloadCSV() {
  if (!currentDevice) return;
  const t = TYPES[currentDevice.device_type];
  if (!t) return;
  const headers = ['Time', ...Object.values(t.sensors).map(s => s.label)];
  const rows = [];
  document.querySelectorAll('#table-body tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('td').forEach(td => cells.push(td.textContent));
    rows.push(cells);
  });
  let csv = headers.join(',') + '\n';
  rows.forEach(r => csv += r.join(',') + '\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = currentDevice.device_id + '_data.csv';
  a.click();
}

// ── Database Reset ──
async function resetDatabase() {
  if (!confirm('⚠ This will DELETE ALL devices and data. Are you sure?')) return;
  if (!confirm('This action CANNOT be undone. Proceed?')) return;
  try {
    const r = await fetch('/api/admin.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_database' })
    });
    const data = await r.json();
    if (data.status === 'ok') {
      toast('Database reset complete', 'success');
      currentDevice = null;
      loadDevices();
    } else {
      toast(data.error || 'Reset failed', 'error');
    }
  } catch (e) {
    toast('Reset failed: ' + e.message, 'error');
  }
}

// ── Helpers ──
// Nepal timezone: UTC+5:45
function fmtTime(dt) {
  if (!dt) return '—';
  try {
    const d = new Date(typeof dt === 'string' ? dt.replace(/-/g, '/') : dt);
    if (isNaN(d.getTime())) return '—';
    // Convert to Nepal Standard Time (UTC+5:45)
    const npt = new Date(d.getTime() + (5*60+45)*60*1000 + d.getTimezoneOffset()*60*1000);
    return npt.getHours().toString().padStart(2,'0') + ':' +
           npt.getMinutes().toString().padStart(2,'0') + ':' +
           npt.getSeconds().toString().padStart(2,'0');
  } catch { return '—'; }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// ── Init ──
init();

// ── Public API ──
return {
  doLogin, logout, navigate, toggleTheme,
  switchDevice, addDevice, deleteDevice, onTypeChange,
  showDeviceActions, viewOnDash, showCode,
  copyCode, downloadCode, closeModal,
  downloadCSV, resetDatabase, toggleControl,
  switchMapDevice, saveDeviceSettings, onVehicleCategoryChange,
  onEditVehicleCategoryChange, updateTrendChartSelection,
  saveSettings, loadSettings
};

})();
