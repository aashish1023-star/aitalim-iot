/*
  ============================================================================
  ☀️ swachhyabasti — Smart Hybrid Solar Dryer Controller (Robust SSL Version)
  Platform      : ESP32 DevKit V1 (ESP-WROOM-32)
  Sensors       : DHT22 (temp/humidity, GPIO 27)
  Actuator      : Relay-controlled ventilation fan (GPIO 26, Active LOW)
  Connectivity  : Wi-Fi -> AITALIM IoT Dashboard (HTTPS POST/GET, JSON)
  ============================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ── WiFi & Server Configuration ──
#define WIFI_SSID       "YOUR_WIFI_SSID"      // Replace with your WiFi SSID
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"  // Replace with your WiFi Password
#define SERVER_URL      "https://aitalim-iot.aashish1023.workers.dev" // Your live server domain
#define DEVICE_ID       "dryer_node_01"        // Replace with your registered Device ID

#define SEND_INTERVAL   5000     // Pushes sensor readings every 5 seconds
#define CONFIG_INTERVAL 5000     // Polls configuration settings every 5 seconds

// ── GPIO Pin Mapping ──
#define DHT_PIN    27
#define DHT_TYPE   DHT22
#define RELAY_PIN  26

DHT dht(DHT_PIN, DHT_TYPE);

// ── System States & Thresholds ──
unsigned long lastSend = 0;
unsigned long lastConfig = 0;
unsigned long lastWiFiReconnectAttempt = 0;
const unsigned long WIFI_RECONNECT_INTERVAL = 30000; // Retry connection every 30s (non-blocking)

bool fanState = false;
float tempLimit = 30.0;
float humLimit = 40.0;
String cfgMode = "auto";

// ── Non-Blocking WiFi Reconnection ──
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  unsigned long now = millis();
  if (now - lastWiFiReconnectAttempt < WIFI_RECONNECT_INTERVAL && lastWiFiReconnectAttempt != 0) {
    return; // Don't block the loop spamming connection requests
  }
  
  lastWiFiReconnectAttempt = now;
  Serial.printf("\n[WiFi] Connecting to SSID: %s...\n", WIFI_SSID);
  
  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  // Wait up to 5 seconds to connect
  int t = 0;
  while (WiFi.status() != WL_CONNECTED && t < 10) { 
    delay(500); 
    Serial.print("."); 
    t++; 
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected successfully! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Connection failed. Will operate offline & retry later.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.printf("=== Smart Hybrid Solar Dryer [%s] ===\n", DEVICE_ID);
  
  dht.begin();
  pinMode(RELAY_PIN, OUTPUT);
  
  // Keep fan OFF initially (Active LOW relay -> HIGH = OFF)
  digitalWrite(RELAY_PIN, HIGH);
  
  connectWiFi();
}

void loop() {
  // Ensure we attempt reconnection if WiFi goes down, without blocking local controls
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  unsigned long now = millis();

  // ── 1. Sensor Reading, Local Control and Cloud Push ──
  if (now - lastSend >= SEND_INTERVAL) {
    lastSend = now;

    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    bool dhtOK = !isnan(temp) && !isnan(hum);

    if (!dhtOK) {
      Serial.println("[DHT] Sensor read failed! Check wiring.");
    }

    // ── Threshold-driven Fan Control ──
    if (cfgMode == "auto") {
      // Fan ON if temperature exceeds limit OR humidity exceeds limit
      if (dhtOK && (temp >= tempLimit || hum >= humLimit)) {
        fanState = true;
      } else {
        fanState = false;
      }
    } else {
      // Manual mode override from dashboard
      fanState = (cfgMode == "on");
    }

    // Write state to relay (Active LOW)
    digitalWrite(RELAY_PIN, fanState ? LOW : HIGH);
    Serial.printf("[Sensors] Temp: %.1f C | Hum: %.1f %% | Fan: %s\n", 
                  temp, hum, fanState ? "ON" : "OFF");

    // Only attempt HTTP push if WiFi is fully connected
    if (WiFi.status() == WL_CONNECTED) {
      JsonDocument doc;
      doc["temperature"] = dhtOK ? temp : -1.0;
      doc["humidity"] = dhtOK ? hum : -1.0;
      doc["fan_state"] = fanState ? "on" : "off";

      String payload;
      serializeJson(doc, payload);

      WiFiClientSecure client;
      client.setInsecure(); // Bypass SSL verification for HTTPS requests

      HTTPClient http;
      http.begin(client, String(SERVER_URL) + "/api/data.php?device_id=" + DEVICE_ID);
      http.setTimeout(5000);
      http.addHeader("Content-Type", "application/json");
      
      int code = http.POST(payload);
      Serial.printf("[HTTP Data Push] Response: %d\n", code);
      http.end();
    }
  }

  // ── 2. Cloud Configuration Sync ──
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
          // Sync threshold settings and mode from Dashboard
          cfgMode = String(desired["pump"] | "auto"); // mapped to pump internally
          tempLimit = desired["temp_limit"] | 30.0;
          humLimit = desired["hum_limit"] | 40.0;
          Serial.printf("[Cloud Config Sync] Fan Mode: %s | Temp Limit: %.1f | Hum Limit: %.1f\n",
                        cfgMode.c_str(), tempLimit, humLimit);
          
          // Report current config back to server as acknowledgment
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
    } else {
      Serial.printf("[HTTP Config Poll] Error: %d\n", code);
    }
    http.end();
  }
}
