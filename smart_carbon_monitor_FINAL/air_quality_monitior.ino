/*
  ============================================================================
  Office Air Quality — Smart Air Quality & Carbon Monitor (CALIBRATED)
  Platform      : ESP32 DevKit V1 (ESP-WROOM-32)
  Sensors       : SPS30 (PM1.0/2.5/4.0/10, UART2), CO2-C8 NDIR (CO2, UART1),
                  DHT22 (Temperature & Humidity, Digital GPIO)
  Connectivity  : Wi-Fi -> AITALIM IoT Dashboard (HTTP POST, JSON)
  Device ID     : air_quality_node_01

  Calibration Notes (from datasheets):
  ─────────────────────────────────────
  SPS30 (Sensirion Datasheet v2.0):
    • Mass concentration range: 0–1000 µg/m³
    • PM1.0/PM2.5 accuracy: ±(5 µg/m³ + 5% of m.v.) for 0–100 µg/m³
                             ±10% of m.v. for 100–1000 µg/m³
    • PM4.0/PM10 accuracy:   ±25 µg/m³ for 0–100 µg/m³
                             ±25% of m.v. for 100–1000 µg/m³
    • Warm-up time: 30 seconds minimum before reliable readings
    • Fan cleaning: Accelerated cleaning cycle recommended every 7 days
    • Humidity: No built-in compensation; readings inflate above 75% RH
      → We apply the Hänel hygroscopic growth correction factor

  CO2-C8 NDIR (Model C8):
    • Range: 400–5000 ppm
    • Accuracy: ±50 ppm ± 3% of reading
    • Resolution: 1 ppm
    • Baseline: Atmospheric CO2 ~420 ppm; readings below 400 are invalid
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
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"
#define SERVER_URL      "https://aitalim-iot.aashish1023.workers.dev"
#define DEVICE_ID       "air_quality_node_01"
#define SEND_INTERVAL   5000UL
#define WIFI_RECONNECT_INTERVAL 30000UL

// ── GPIO ──
#define DHT_PIN        4
#define DHT_TYPE       DHT22
#define UART2_RX_PIN   16   // SPS30 TX -> ESP32 RX
#define UART2_TX_PIN   17   // SPS30 RX <- ESP32 TX
#define UART1_RX_PIN   26   // CO2-C8 TX -> ESP32 RX
#define UART1_TX_PIN   27   // CO2-C8 RX <- ESP32 TX

// ── Calibration Constants (from datasheets) ──
#define SPS30_WARMUP_MS       30000   // 30 seconds per Sensirion spec
#define SPS30_MAX_RANGE       1000.0  // µg/m³ maximum measurable
#define SPS30_OUTLIER_THRESH  999.0   // Flag readings at sensor saturation
#define CO2_MIN_VALID         400.0   // Atmospheric baseline (C8 range floor)
#define CO2_MAX_VALID         5000.0  // C8 sensor maximum range
#define HUMIDITY_COMP_THRESH  75.0    // % RH above which to apply correction
#define DHT_READ_RETRIES      3      // Number of retry attempts for DHT22

DHT dht(DHT_PIN, DHT_TYPE);
HardwareSerial CO2Serial(1);
HardwareSerial SPS30Serial(2);
SensirionUartSps30 sps30;
static char sps30ErrorMessage[64];

unsigned long lastTransmitTime = 0;
unsigned long lastWiFiReconnectAttempt = 0;
unsigned long sps30StartTime = 0;
bool sps30WarmedUp = false;

// ── Sensor Data Structure ──
struct SensorData {
  float pm1_0, pm2_5, pm4_0, pm10;
  float co2_ppm;
  float temperature, humidity;
  bool pmValid, co2Valid, dhtValid;
};

// ──────────────────────────────────────────────────────────
// Exponential Moving Average (EMA) Filter
// Alpha = 0.3 gives ~70% weight to history, smoothing noise
// while still responding to real changes within 5-7 samples.
// ──────────────────────────────────────────────────────────
struct EMAFilter {
  float value;
  bool initialized;
  float alpha;

  EMAFilter(float a = 0.3) : value(0), initialized(false), alpha(a) {}

  float update(float raw) {
    if (!initialized) {
      value = raw;
      initialized = true;
    } else {
      value = (raw * alpha) + (value * (1.0 - alpha));
    }
    return value;
  }

  void reset() {
    initialized = false;
    value = 0;
  }
};

EMAFilter pm1_filter(0.3);
EMAFilter pm25_filter(0.3);
EMAFilter pm4_filter(0.3);
EMAFilter pm10_filter(0.3);
EMAFilter co2_filter(0.4);  // Slightly more responsive for CO2

// ── CO2-C8 NDIR Protocol ──
const uint8_t CO2_QUERY_CMD[] = {0x64, 0x69, 0x03, 0x5E, 0x4E};
const uint8_t CO2_FRAME_LEN = 14;

uint16_t computeCRC16(const uint8_t* data, uint8_t length) {
  uint16_t crc = 0xFFFF;
  for (uint8_t pos = 0; pos < length; pos++) {
    crc ^= data[pos];
    for (uint8_t i = 8; i; i--) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

bool readCO2(float &co2ppm) {
  // Flush stale bytes from buffer
  while (CO2Serial.available()) CO2Serial.read();
  CO2Serial.write(CO2_QUERY_CMD, sizeof(CO2_QUERY_CMD));

  unsigned long start = millis();
  while (CO2Serial.available() < CO2_FRAME_LEN) {
    if (millis() - start > 500) {
      Serial.println("[CO2-C8] Timeout waiting for response");
      return false;
    }
  }

  uint8_t resp[CO2_FRAME_LEN];
  CO2Serial.readBytes(resp, CO2_FRAME_LEN);

  // Validate CRC (sensor may send LSB-first or MSB-first)
  uint16_t calculated = computeCRC16(resp, 12);
  uint16_t lowByteFirst = (resp[13] << 8) | resp[12];
  uint16_t highByteFirst = (resp[12] << 8) | resp[13];
  if (calculated != lowByteFirst && calculated != highByteFirst) {
    Serial.println("[CO2-C8] CRC mismatch — corrupt frame");
    return false;
  }

  float rawPPM = (float)((resp[5] << 8) | resp[4]);

  // ── CO2 Calibration per C8 datasheet ──
  // Range: 400–5000 ppm. Values below 400 are physically impossible
  // (atmospheric baseline is ~420 ppm). Values above 5000 exceed range.
  if (rawPPM < CO2_MIN_VALID) {
    Serial.printf("[CO2-C8] Below baseline (%.0f ppm < 400), clamping\n", rawPPM);
    rawPPM = CO2_MIN_VALID;
  }
  if (rawPPM > CO2_MAX_VALID) {
    Serial.printf("[CO2-C8] Above max range (%.0f ppm > 5000), clamping\n", rawPPM);
    rawPPM = CO2_MAX_VALID;
  }

  // Apply EMA smoothing (CO2 changes slowly, so smoothing is safe)
  co2ppm = co2_filter.update(rawPPM);
  return true;
}

// ──────────────────────────────────────────────────────────
// Hänel Hygroscopic Growth Correction for PM readings
// When RH > 75%, water vapor condenses on particles, causing
// them to swell and the optical sensor to over-report mass.
// Formula: corrected = raw / (1 + κ * (RH / (100 - RH)))
// κ = 0.24 is a standard hygroscopic growth factor for
// mixed urban aerosols (Hänel, 1976).
// ──────────────────────────────────────────────────────────
float humidityCorrection(float rawPM, float rh) {
  if (rh <= HUMIDITY_COMP_THRESH || rh >= 99.0) return rawPM;
  const float kappa = 0.24;  // Hygroscopic growth factor
  float correction = 1.0 + kappa * (rh / (100.0 - rh));
  return rawPM / correction;
}

bool readSPS30(SensorData &d, float currentHumidity) {
  float mc1 = 0, mc25 = 0, mc4 = 0, mc10 = 0;
  float nc05 = 0, nc1 = 0, nc2 = 0, nc4 = 0, nc10 = 0, typicalSize = 0;

  int16_t err = sps30.readMeasurementValuesFloat(mc1, mc25, mc4, mc10,
      nc05, nc1, nc2, nc4, nc10, typicalSize);
  if (err != NO_ERROR) {
    errorToString(err, sps30ErrorMessage, sizeof(sps30ErrorMessage));
    Serial.printf("[SPS30] Read error: %s\n", sps30ErrorMessage);
    return false;
  }

  // ── Warm-up check (Sensirion spec: 30 seconds) ──
  if (!sps30WarmedUp) {
    if (millis() - sps30StartTime < SPS30_WARMUP_MS) {
      Serial.printf("[SPS30] Warming up... %lu/%lu ms\n",
                    millis() - sps30StartTime, (unsigned long)SPS30_WARMUP_MS);
      return false;  // Discard readings during warm-up
    }
    sps30WarmedUp = true;
    Serial.println("[SPS30] Warm-up complete — readings are now reliable");
    // Reset EMA filters so they don't carry warm-up garbage
    pm1_filter.reset();
    pm25_filter.reset();
    pm4_filter.reset();
    pm10_filter.reset();
  }

  // ── Saturation check ──
  // If all PM bins read near 1000 µg/m³, the sensor is saturated.
  // This happens with condensation, contaminated optics, or fan failure.
  if (mc25 >= SPS30_OUTLIER_THRESH && mc4 >= SPS30_OUTLIER_THRESH && mc10 >= SPS30_OUTLIER_THRESH) {
    Serial.println("[SPS30] WARNING: Readings at saturation limit (~1000 µg/m³)");
    Serial.println("[SPS30] Possible causes: condensation, dirty optics, or fan blockage");
    // Still report but flag it — don't silently send bad data
  }

  // ── Range clamping (0–1000 µg/m³ per datasheet) ──
  mc1  = constrain(mc1,  0.0f, SPS30_MAX_RANGE);
  mc25 = constrain(mc25, 0.0f, SPS30_MAX_RANGE);
  mc4  = constrain(mc4,  0.0f, SPS30_MAX_RANGE);
  mc10 = constrain(mc10, 0.0f, SPS30_MAX_RANGE);

  // ── Physical constraint: PM10 >= PM4 >= PM2.5 >= PM1.0 ──
  // These are cumulative mass concentrations. If the sensor returns
  // a smaller bin with a HIGHER value, it's a measurement artifact.
  if (mc25 < mc1)  mc25 = mc1;
  if (mc4  < mc25) mc4  = mc25;
  if (mc10 < mc4)  mc10 = mc4;

  // ── Humidity compensation (Hänel correction) ──
  // Only apply if we have a valid humidity reading
  if (!isnan(currentHumidity) && currentHumidity > 0) {
    mc1  = humidityCorrection(mc1,  currentHumidity);
    mc25 = humidityCorrection(mc25, currentHumidity);
    mc4  = humidityCorrection(mc4,  currentHumidity);
    mc10 = humidityCorrection(mc10, currentHumidity);
  }

  // ── EMA smoothing ──
  d.pm1_0 = pm1_filter.update(mc1);
  d.pm2_5 = pm25_filter.update(mc25);
  d.pm4_0 = pm4_filter.update(mc4);
  d.pm10  = pm10_filter.update(mc10);

  return true;
}

// ── DHT22 with retry logic ──
// The DHT22 is notoriously flaky on ESP32 due to timing-sensitive
// one-wire protocol. Retrying with a delay fixes most read failures.
bool readDHT22(SensorData &d) {
  for (int attempt = 0; attempt < DHT_READ_RETRIES; attempt++) {
    d.humidity = dht.readHumidity();
    d.temperature = dht.readTemperature();
    if (!isnan(d.humidity) && !isnan(d.temperature)) {
      // Sanity check per DHT22 spec: -40–80°C, 0–100% RH
      if (d.temperature >= -40.0 && d.temperature <= 80.0 &&
          d.humidity >= 0.0 && d.humidity <= 100.0) {
        return true;
      }
    }
    delay(100);  // DHT22 needs minimum 2s between reads, but short retry helps
  }
  Serial.println("[DHT22] All read attempts failed — check wiring on GPIO 4");
  return false;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  unsigned long now = millis();
  if (lastWiFiReconnectAttempt && now - lastWiFiReconnectAttempt < WIFI_RECONNECT_INTERVAL) return;
  lastWiFiReconnectAttempt = now;
  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (uint8_t attempt = 0; WiFi.status() != WL_CONNECTED && attempt < 20; attempt++) delay(500);
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("[WiFi] Connected: %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("[WiFi] Connection failed; retrying later.");
}

void transmitData(const SensorData &d) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Wi-Fi unavailable; data not sent.");
    return;
  }

  JsonDocument doc;
  doc["pm1_0"]       = d.pmValid  ? round(d.pm1_0 * 100.0) / 100.0 : -1;
  doc["pm2_5"]       = d.pmValid  ? round(d.pm2_5 * 100.0) / 100.0 : -1;
  doc["pm4_0"]       = d.pmValid  ? round(d.pm4_0 * 100.0) / 100.0 : -1;
  doc["pm10"]        = d.pmValid  ? round(d.pm10  * 100.0) / 100.0 : -1;
  doc["co2_ppm"]     = d.co2Valid ? round(d.co2_ppm) : -1;
  doc["temperature"] = d.dhtValid ? round(d.temperature * 10.0) / 10.0 : -1;
  doc["humidity"]    = d.dhtValid ? round(d.humidity * 10.0) / 10.0 : -1;

  String payload;
  serializeJson(doc, payload);

  // Log calibrated values to Serial for debugging
  Serial.printf("[DATA] PM1.0=%.2f PM2.5=%.2f PM4.0=%.2f PM10=%.2f CO2=%.0f T=%.1f H=%.1f\n",
    d.pmValid ? d.pm1_0 : -1, d.pmValid ? d.pm2_5 : -1,
    d.pmValid ? d.pm4_0 : -1, d.pmValid ? d.pm10  : -1,
    d.co2Valid ? d.co2_ppm : -1,
    d.dhtValid ? d.temperature : -1, d.dhtValid ? d.humidity : -1);

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, String(SERVER_URL) + "/api/data.php?device_id=" + DEVICE_ID);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);
  Serial.printf("[HTTP] %d\n", code);
  if (code <= 0) Serial.printf("[HTTP] Error: %s\n", http.errorToString(code).c_str());
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.printf("=== Smart Air Quality Monitor [%s] ===\n", DEVICE_ID);
  Serial.println("Firmware: CALIBRATED v2.0 (SPS30 + CO2-C8 + DHT22)");

  // Initialize DHT22 FIRST (we need humidity for SPS30 compensation)
  dht.begin();
  Serial.println("[DHT22] Initialized on GPIO 4");

  // Initialize CO2-C8 NDIR (9600 baud per C8 protocol)
  CO2Serial.begin(9600, SERIAL_8N1, UART1_RX_PIN, UART1_TX_PIN);
  Serial.println("[CO2-C8] UART1 initialized (9600 baud)");

  // Initialize SPS30 (115200 baud per Sensirion spec)
  SPS30Serial.begin(115200, SERIAL_8N1, UART2_RX_PIN, UART2_TX_PIN);
  sps30.begin(SPS30Serial);

  // Run fan cleaning cycle on startup (clears condensation/dust from optics)
  Serial.println("[SPS30] Running fan cleaning cycle...");
  sps30.stopMeasurement();
  delay(500);
  int16_t cleanErr = sps30.startFanCleaning();
  if (cleanErr != NO_ERROR) {
    errorToString(cleanErr, sps30ErrorMessage, sizeof(sps30ErrorMessage));
    Serial.printf("[SPS30] Fan clean warning: %s (non-critical)\n", sps30ErrorMessage);
  } else {
    Serial.println("[SPS30] Fan cleaning started (10 seconds)");
    delay(10000);  // Fan cleaning takes ~10 seconds
  }

  // Start measurement
  int16_t err = sps30.startMeasurement(SPS30_OUTPUT_FORMAT_OUTPUT_FORMAT_FLOAT);
  if (err != NO_ERROR) {
    errorToString(err, sps30ErrorMessage, sizeof(sps30ErrorMessage));
    Serial.printf("[SPS30] Start failed: %s\n", sps30ErrorMessage);
  } else {
    sps30StartTime = millis();
    Serial.printf("[SPS30] Measurement started — warming up for %d seconds...\n", SPS30_WARMUP_MS / 1000);
  }

  connectWiFi();
  Serial.println("=== Initialization Complete ===\n");
}

void loop() {
  connectWiFi();
  if (millis() - lastTransmitTime < SEND_INTERVAL) return;
  lastTransmitTime = millis();

  SensorData data = {};

  // Read DHT22 FIRST (humidity is needed for SPS30 compensation)
  data.dhtValid = readDHT22(data);

  // Read SPS30 with humidity compensation
  float currentHumidity = data.dhtValid ? data.humidity : NAN;
  data.pmValid = readSPS30(data, currentHumidity);

  // Read CO2-C8
  data.co2Valid = readCO2(data.co2_ppm);

  // Diagnostic output for failed sensors
  if (!data.pmValid)  Serial.println("[SPS30]  No valid data this cycle");
  if (!data.co2Valid) Serial.println("[CO2-C8] No valid data this cycle");
  if (!data.dhtValid) Serial.println("[DHT22]  No valid data — check wiring (GPIO 4, 3.3V, GND, 10kΩ pull-up)");

  transmitData(data);
}
