/*
 * AutoDash demo — ESP32 live board
 *
 * Modes:
 *   1) SoftAP  "AutoDashDemo" / pass "autodash1"
 *      Phone joins Wi‑Fi → open http://192.168.4.1/  (serves tiny redirect note)
 *      Or point the cloud/desktop UI WebSocket at: ws://192.168.4.1/ws
 *   2) SIM mode streams fake RPM/CTS/… (no CAN hardware needed)
 *   3) Optional TWAI CAN RX → Racepak-ish raw frames as {"t":"frame",...}
 *
 * Arduino IDE:
 *   Board: ESP32 Dev Module
 *   Library: WebSockets by Markus Sattler (Links2004)
 *
 * PlatformIO: see platformio.ini beside this sketch folder.
 */

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ESPmDNS.h>

// -------- config --------
static const char *AP_SSID = "AutoDashDemo";
static const char *AP_PASS = "autodash1";

// Set USE_STA 1 and fill credentials to join your home Wi‑Fi instead of SoftAP
#define USE_STA 0
static const char *STA_SSID = "YOUR_WIFI";
static const char *STA_PASS = "YOUR_PASSWORD";

// 1 = fake telemetry (easiest). 0 = expect TWAI CAN frames
#define USE_SIM 1

#if !USE_SIM
  #include "driver/twai.h"
  // Common ESP32 CAN transceiver pins (change for your board)
  static const gpio_num_t TWAI_TX = GPIO_NUM_5;
  static const gpio_num_t TWAI_RX = GPIO_NUM_4;
#endif

WebSocketsServer webSocket = WebSocketsServer(81);
unsigned long lastSendMs = 0;
unsigned long tick = 0;

void broadcastJson(const String &json) {
  webSocket.broadcastTXT(json);
}

void sendHello() {
  broadcastJson("{\"t\":\"hello\",\"board\":\"esp32\",\"mode\":\"" +
                String(USE_SIM ? "sim" : "twai") + "\",\"proto\":1}");
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  if (type == WStype_CONNECTED) {
    sendHello();
  }
  (void)num;
  (void)payload;
  (void)length;
}

#if USE_SIM
void sendSimSignals() {
  tick++;
  float s = sinf(tick / 8.0f);
  int rpm = 800 + (int)((s + 1.0f) * 1500.0f);
  float cts = 180.0f + sinf(tick / 20.0f) * 8.0f;
  float batt = 13.2f + sinf(tick / 15.0f) * 0.4f;
  int mapkpa = 35 + (int)(sinf(tick / 6.0f) * 10.0f);
  int oil = 40 + (int)(sinf(tick / 10.0f) * 5.0f);

  String json = "{";
  json += "\"t\":\"signals\",\"board\":\"esp32\",";
  json += "\"values\":{";
  json += "\"RPM\":" + String(rpm) + ",";
  json += "\"CTS\":" + String(cts, 1) + ",";
  json += "\"BATT_VOLTAGE\":" + String(batt, 2) + ",";
  json += "\"MAP\":" + String(mapkpa) + ",";
  json += "\"OIL_PRESSURE\":" + String(oil) + ",";
  json += "\"TARGET_AFR\":14.1,";
  json += "\"AFR_AVERAGE\":" + String(14.0f + sinf(tick / 12.0f) * 0.3f, 2) + ",";
  json += "\"IGNITION_TIMING\":" + String(22.0f + sinf(tick / 9.0f) * 3.0f, 1) + ",";
  json += "\"PEDAL_POSITION\":" + String(max(0.0f, sinf(tick / 7.0f) * 40.0f), 1) + ",";
  json += "\"FUEL_FLOW\":" + String(12.0f + sinf(tick / 11.0f) * 4.0f, 1) + ",";
  json += "\"MAT\":95,";
  json += "\"BAR_PRESSURE\":100";
  json += "}}";
  broadcastJson(json);
}
#else
String hexByte(uint8_t b) {
  const char *h = "0123456789ABCDEF";
  String s;
  s += h[b >> 4];
  s += h[b & 0x0f];
  return s;
}

void pollTwai() {
  twai_message_t msg;
  while (twai_receive(&msg, 0) == ESP_OK) {
    String id = String(msg.identifier, HEX);
    id.toUpperCase();
    String data;
    for (int i = 0; i < msg.data_length_code; i++) data += hexByte(msg.data[i]);
    String json = "{\"t\":\"frame\",\"id\":\"" + id + "\",\"data\":\"" + data + "\"}";
    broadcastJson(json);
  }
}
#endif

void setup() {
  Serial.begin(115200);
  delay(200);

#if USE_STA
  WiFi.mode(WIFI_STA);
  WiFi.begin(STA_SSID, STA_PASS);
  Serial.print("WiFi STA");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP ");
  Serial.println(WiFi.localIP());
#else
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("AP ");
  Serial.println(AP_SSID);
  Serial.print("IP ");
  Serial.println(WiFi.softAPIP());
#endif

  if (MDNS.begin("autodash")) {
    Serial.println("mDNS http://autodash.local");
  }

  webSocket.begin();
  webSocket.onEvent(onWsEvent);
  Serial.println("WS ws://<ip>:81/");

#if !USE_SIM
  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(TWAI_TX, TWAI_RX, TWAI_MODE_LISTEN_ONLY);
  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  if (twai_driver_install(&g_config, &t_config, &f_config) == ESP_OK &&
      twai_start() == ESP_OK) {
    Serial.println("TWAI started (listen-only)");
  } else {
    Serial.println("TWAI failed — check transceiver wiring");
  }
#endif
}

void loop() {
  webSocket.loop();
#if USE_SIM
  if (millis() - lastSendMs > 200) {
    lastSendMs = millis();
    if (webSocket.connectedClients() > 0) sendSimSignals();
  }
#else
  pollTwai();
#endif
}
