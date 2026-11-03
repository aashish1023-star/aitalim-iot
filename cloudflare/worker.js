const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' },
});
const fail = (error, status = 400) => json({ error }, status);
const id = value => String(value || '').replace(/[^A-Za-z0-9_]/g, '');
const decode = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const defaults = { air_quality: { send_interval: 2, led: 'off' }, gps_tracker: { send_interval: 5, sim_check_interval: 15 }, moss_water_tank: { send_interval: 5, pump: 'auto', temp_limit: 30, hum_limit: 40, low_level: 20, full_level: 5 } };

function cookie(request, name) {
  return (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
}
async function token(secret) {
  const bytes = new TextEncoder().encode(`aitalim:${secret}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/[+/=]/g, '');
}
async function admin(request, env) { return cookie(request, 'aitalim_auth') === await token(env.ADMIN_PASSWORD || 'change-me'); }
function setAuth(response, value) {
  const headers = new Headers(response.headers);
  headers.append('set-cookie', `aitalim_auth=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`);
  return new Response(response.body, { status: response.status, headers });
}
function rowDevice(row) { return { ...row, config: decode(row.config), config_reported: decode(row.config_reported) }; }
async function body(request) { try { return await request.json(); } catch { return {}; } }

async function auth(request, env) {
  if (request.method === 'GET') return json({ logged_in: await admin(request, env), role: await admin(request, env) ? 'admin' : null });
  if (request.method === 'DELETE') return setAuth(json({ status: 'ok', message: 'Logged out' }), 'deleted; Max-Age=0');
  if (request.method !== 'POST') return fail('Method not allowed', 405);
  const input = await body(request);
  if (input.username === (env.ADMIN_USER || 'admin') && input.password === env.ADMIN_PASSWORD) return setAuth(json({ status: 'ok', message: 'Login successful' }), await token(env.ADMIN_PASSWORD));
  return fail('Invalid username or password', 401);
}

async function devices(request, env, url) {
  if (request.method === 'GET') {
    const deviceId = id(url.searchParams.get('device_id'));
    const q = deviceId ? env.DB.prepare('SELECT * FROM devices WHERE device_id = ?').bind(deviceId) : env.DB.prepare('SELECT * FROM devices ORDER BY created_at DESC');
    const { results } = await q.all(); return json(results.map(rowDevice));
  }
  if (!await admin(request, env)) return fail('Authentication required', 401);
  if (request.method === 'DELETE') {
    const deviceId = id(url.searchParams.get('device_id')); if (!deviceId) return fail('Missing device_id');
    await env.DB.batch([env.DB.prepare('DELETE FROM readings WHERE device_id = ?').bind(deviceId), env.DB.prepare('DELETE FROM devices WHERE device_id = ?').bind(deviceId)]);
    return json({ status: 'ok', message: `Device deleted: ${deviceId}` });
  }
  if (request.method !== 'POST') return fail('Method not allowed', 405);
  const input = await body(request), deviceId = id(input.device_id);
  if (!deviceId || !input.name) return fail('Missing required field: device_id, name');
  const exists = await env.DB.prepare('SELECT device_id FROM devices WHERE device_id = ?').bind(deviceId).first(); if (exists) return fail(`Device ID already exists: ${deviceId}`);
  const type = input.device_type || 'air_quality', config = { ...(defaults[type] || {}), ...(type === 'gps_tracker' ? { vehicle_category: input.vehicle_category || '4-wheeler', vehicle_type: input.vehicle_type || 'car', fuel_type: input.fuel_type || 'petrol', service_date: input.service_date || '', service_mileage: Number(input.service_mileage || 0) } : {}) };
  await env.DB.prepare('INSERT INTO devices (device_id,device_type,name,location,config,config_reported) VALUES (?,?,?,?,?,?)').bind(deviceId, type, input.name, input.location || '', JSON.stringify(config), JSON.stringify(config)).run();
  return json({ status: 'ok', device_id: deviceId, config, message: 'Device registered successfully' }, 201);
}

async function data(request, env, url) {
  const deviceId = id(url.searchParams.get('device_id') || (url.pathname.startsWith('/data/') ? url.pathname.split('/').pop() : '')); if (!deviceId) return fail('Missing device_id');
  if (request.method === 'POST') {
    const input = await body(request); if (!Object.keys(input).length) return fail('Empty data payload');
    let device = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?').bind(deviceId).first();
    if (!device) { const config = JSON.stringify(defaults.moss_water_tank); await env.DB.prepare('INSERT INTO devices (device_id,device_type,name,location,config,config_reported) VALUES (?,?,?,?,?,?)').bind(deviceId, 'moss_water_tank', deviceId, 'Auto-Registered', config, config).run(); device = { device_type: 'moss_water_tank', config }; }
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const saved = await env.DB.prepare('INSERT INTO readings (device_id,data) VALUES (?,?)').bind(deviceId, JSON.stringify(input)).run();
    await env.DB.prepare('UPDATE devices SET last_seen=CURRENT_TIMESTAMP,ip_address=? WHERE device_id=?').bind(ip, deviceId).run();
    const threshold = Number(decode(device.config).low_level || 20);
    if (device.device_type === 'moss_water_tank' && Number(input.water_level) >= threshold) await env.DB.prepare("INSERT INTO notifications (device_id,alert_type,message) VALUES (?,'low_water',?)").bind(deviceId, `Low water level: ${input.water_level} cm (threshold ${threshold} cm)`).run();
    return json({ status: 'ok', id: saved.meta.last_row_id });
  }
  if (request.method !== 'GET') return fail('Method not allowed', 405);
  const perPage = Math.min(Number(url.searchParams.get('per_page') || 50), 1000), page = Math.max(Number(url.searchParams.get('page') || 1), 1), offset = (page - 1) * perPage;
  let where = 'device_id = ?', params = [deviceId];
  if (url.searchParams.get('start')) { where += ' AND date(recorded_at) >= date(?)'; params.push(url.searchParams.get('start')); }
  if (url.searchParams.get('end')) { where += ' AND date(recorded_at) <= date(?)'; params.push(url.searchParams.get('end')); }
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS count FROM readings WHERE ${where}`).bind(...params).first()).count;
  const { results } = await env.DB.prepare(`SELECT id,recorded_at,data FROM readings WHERE ${where} ORDER BY recorded_at DESC LIMIT ? OFFSET ?`).bind(...params, perPage, offset).all();
  return json({ data: results.map(r => ({ ...r, data: decode(r.data) })), meta: { total, page, per_page: perPage, last_page: Math.ceil(total / perPage) } });
}

async function config(request, env, url) {
  const deviceId = id(url.searchParams.get('device_id') || (url.pathname.startsWith('/config/') ? url.pathname.split('/').pop() : '')); if (!deviceId) return fail('Missing device_id');
  const device = await env.DB.prepare('SELECT * FROM devices WHERE device_id=?').bind(deviceId).first(); if (!device) return fail(`Device not found: ${deviceId}`, 404);
  if (request.method === 'GET') { await env.DB.prepare('UPDATE devices SET last_seen=CURRENT_TIMESTAMP,ip_address=? WHERE device_id=?').bind(request.headers.get('CF-Connecting-IP') || '', deviceId).run(); return json({ desired: decode(device.config), reported: decode(device.config_reported), version: device.config_version, updated_at: device.config_updated_at }); }
  if (request.method !== 'POST') return fail('Method not allowed', 405);
  const input = await body(request); if (!Object.keys(input).length) return fail('Empty config payload');
  const isDevice = url.searchParams.get('role') === 'device', field = isDevice ? 'config_reported' : 'config', merged = { ...decode(device[field]), ...input };
  await env.DB.prepare(`UPDATE devices SET ${field}=?, config_version=config_version + ?, config_updated_at=CURRENT_TIMESTAMP WHERE device_id=?`).bind(JSON.stringify(merged), isDevice ? 0 : 1, deviceId).run();
  return json(isDevice ? { status: 'ok', role: 'device', reported: merged } : { status: 'ok', role: 'user', desired: merged, version: device.config_version + 1 });
}

async function notifications(request, env, url) { if (request.method !== 'GET') return fail('Method not allowed', 405); const limit = Math.min(Number(url.searchParams.get('limit') || 20), 100), deviceId = id(url.searchParams.get('device_id')); const q = deviceId ? env.DB.prepare('SELECT * FROM notifications WHERE device_id=? ORDER BY sent_at DESC LIMIT ?').bind(deviceId, limit) : env.DB.prepare('SELECT * FROM notifications ORDER BY sent_at DESC LIMIT ?').bind(limit); return json((await q.all()).results); }

async function adminApi(request, env, url) {
  if (!await admin(request, env)) return fail('Authentication required', 401);
  let action = url.searchParams.get('action') || '', input = {};
  if (request.method === 'POST') { input = await body(request); action ||= input.action === 'reset_database' ? 'reset_db' : ''; }
  if (request.method === 'GET' && action === 'get_settings') {
    const { results } = await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('notification_email','wifi_ssid','wifi_pass')").all();
    return json(Object.fromEntries(results.map(row => [row.key, row.value])));
  }
  if (request.method === 'POST' && action === 'update_settings') {
    const changes = ['notification_email', 'wifi_ssid', 'wifi_pass'].filter(key => key in input).map(key => env.DB.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, String(input[key])));
    if (changes.length) await env.DB.batch(changes); return json({ status: 'ok' });
  }
  if (request.method === 'DELETE' && action === 'delete_device') { return devices(request, env, url); }
  if (request.method === 'POST' && action === 'reset_db') { await env.DB.batch([env.DB.prepare('DELETE FROM readings'), env.DB.prepare('DELETE FROM notifications'), env.DB.prepare('DELETE FROM devices')]); return json({ status: 'ok', message: 'Database reset complete.' }); }
  return fail('Invalid action or method', 400);
}

export default { async fetch(request, env) {
  if (request.method === 'OPTIONS') return json({}); const url = new URL(request.url), path = url.pathname;
  if (path === '/api/auth.php') return auth(request, env);
  if (path === '/api/devices.php') return devices(request, env, url);
  if (path === '/api/data.php' || path.startsWith('/data/')) return data(request, env, url);
  if (path === '/api/device-config.php' || path.startsWith('/config/')) return config(request, env, url);
  if (path === '/api/notifications.php') return notifications(request, env, url);
  if (path === '/api/admin.php') return adminApi(request, env, url);
  // The repository retains the original PHP source for reference. Never expose
  // source/configuration/deployment files through the static-asset binding.
  if (/^\/(?:api\/|scratch\/|shivram\/)|^\/(?:config\.php|db\.php|schema\.sql|deploy\.ps1|iot_config(?:\.example)?\.json|\.ftpquota|\.htaccess)$/.test(path)) return new Response('Not found', { status: 404 });
  return env.ASSETS.fetch(request);
} };
