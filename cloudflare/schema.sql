CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  device_type TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  config_reported TEXT NOT NULL DEFAULT '{}',
  config_version INTEGER NOT NULL DEFAULT 1,
  config_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_device_time ON readings(device_id, recorded_at DESC);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  message TEXT,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_device_time ON notifications(device_id, sent_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
