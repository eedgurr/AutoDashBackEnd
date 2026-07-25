/*
 * AutoDash demo — STM32 (Arduino framework / STM32duino) serial sim
 *
 * Same JSON line protocol as the AVR Arduino sketch.
 * Flash with STM32duino or PlatformIO (ststm32 + framework-arduino).
 * Bridge with boards/pi/serial_to_ws.py
 *
 * Later: replace sim with bxCAN / FDCAN RX → {"t":"frame",...}
 */

#ifndef LED_BUILTIN
#define LED_BUILTIN PC13
#endif

unsigned long lastMs = 0;
unsigned long tick = 0;

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
  delay(300);
  Serial.println("{\"t\":\"hello\",\"board\":\"stm32\",\"mode\":\"sim\",\"proto\":1}");
}

void loop() {
  if (millis() - lastMs < 200) return;
  lastMs = millis();
  tick++;
  digitalWrite(LED_BUILTIN, tick & 1);

  float s = sin(tick / 8.0);
  int rpm = 800 + (int)((s + 1.0) * 1500.0);

  Serial.print("{\"t\":\"signals\",\"board\":\"stm32\",\"values\":{");
  Serial.print("\"RPM\":"); Serial.print(rpm); Serial.print(",");
  Serial.print("\"CTS\":"); Serial.print(180.0 + sin(tick / 20.0) * 8.0, 1); Serial.print(",");
  Serial.print("\"BATT_VOLTAGE\":"); Serial.print(13.2 + sin(tick / 15.0) * 0.4, 2); Serial.print(",");
  Serial.print("\"MAP\":40,\"OIL_PRESSURE\":45,\"TARGET_AFR\":14.1,");
  Serial.print("\"AFR_AVERAGE\":14.0,\"IGNITION_TIMING\":22,\"PEDAL_POSITION\":0,");
  Serial.print("\"FUEL_FLOW\":12,\"MAT\":95,\"BAR_PRESSURE\":100");
  Serial.println("}}");
}
