/*
 * AutoDash demo — Arduino (AVR / SAMD / etc.) serial bridge
 *
 * No Wi‑Fi: prints one JSON line per 200ms on Serial 115200.
 * Pair with boards/pi/serial_to_ws.py on a Pi/PC to feed the web UI.
 *
 * With MCP2515 CAN later: replace sendSim() with CAN read → {"t":"frame",...}
 */

unsigned long lastMs = 0;
unsigned long tick = 0;

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2000) {}
  Serial.println(F("{\"t\":\"hello\",\"board\":\"arduino\",\"mode\":\"sim\",\"proto\":1}"));
}

void loop() {
  if (millis() - lastMs < 200) return;
  lastMs = millis();
  tick++;

  float s = sin(tick / 8.0);
  int rpm = 800 + (int)((s + 1.0) * 1500.0);
  float cts = 180.0 + sin(tick / 20.0) * 8.0;
  float batt = 13.2 + sin(tick / 15.0) * 0.4;

  Serial.print(F("{\"t\":\"signals\",\"board\":\"arduino\",\"values\":{"));
  Serial.print(F("\"RPM\":")); Serial.print(rpm); Serial.print(',');
  Serial.print(F("\"CTS\":")); Serial.print(cts, 1); Serial.print(',');
  Serial.print(F("\"BATT_VOLTAGE\":")); Serial.print(batt, 2); Serial.print(',');
  Serial.print(F("\"MAP\":")); Serial.print(35 + (int)(sin(tick / 6.0) * 10)); Serial.print(',');
  Serial.print(F("\"OIL_PRESSURE\":")); Serial.print(40 + (int)(sin(tick / 10.0) * 5)); Serial.print(',');
  Serial.print(F("\"TARGET_AFR\":14.1,"));
  Serial.print(F("\"AFR_AVERAGE\":14.0,"));
  Serial.print(F("\"IGNITION_TIMING\":22,"));
  Serial.print(F("\"PEDAL_POSITION\":0,"));
  Serial.print(F("\"FUEL_FLOW\":12,"));
  Serial.print(F("\"MAT\":95,"));
  Serial.print(F("\"BAR_PRESSURE\":100"));
  Serial.println(F("}}"));
}
