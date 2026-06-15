/*
 * ESP32 Glove — Raw ADC Test
 *
 * Reads raw 16-bit ADC counts from both ADS1115 chips and prints them
 * over Serial at 50 Hz.  No Ohm calculation, no WiFi, no BNO055.
 * Use this to verify each flex sensor channel is alive and responding.
 *
 * Hardware (same as esp32-new):
 *   ADS0 @ 0x48 : ch0=thumb  ch1=pinky  ch2=ring  ch3=index
 *   ADS1 @ 0x49 : ch0=middle
 *   MOSFETs     : GPIO 4,5,6,7,3  (always-on, 100% duty)
 *   I2C         : SDA=9, SCL=10
 *
 * Output (Serial 115200):
 *   "T=<thumb>  I=<index>  M=<middle>  R=<ring>  P=<pinky>\n"
 *
 * Expected behaviour:
 *   • Value DECREASES when you bend a finger (lower voltage → lower count)
 *   • Value INCREASES when you straighten (higher voltage → higher count)
 *   • A completely disconnected channel reads near 0 or rail (32767)
 *   • Noisy / non-changing channel → wiring or MOSFET issue
 */

#include <Arduino.h>
#include <Wire.h>
#include "ADS1X15.h"

// ── I2C ──────────────────────────────────────────────────────────────────────
#define I2C_SDA  9
#define I2C_SCL 10

ADS1115 ads0(0x48);   // thumb, index, ring, pinky
ADS1115 ads1(0x49);   // middle

bool ads0Ready = false;
bool ads1Ready = false;

// ── MOSFET excitation ─────────────────────────────────────────────────────────
// Same pins as esp32-new.  Run at 100% duty so the divider is always complete.
static const uint8_t MOSFET_PINS[5] = {4, 5, 6, 7, 3};
static const uint8_t LEDC_CH[5]     = {0, 1, 2, 3, 4};
#define PWM_FREQ_HZ  20000
#define PWM_RES_BITS 8
#define PWM_MAX      ((1 << PWM_RES_BITS) - 1)

// ── setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("[ADC-TEST] Starting...");

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  // ADS1115 init
  ads0Ready = ads0.begin();
  if (ads0Ready) {
    ads0.setGain(2);      // GAIN_TWO  ±2.048V — same as main firmware
    ads0.setDataRate(7);  // 860 SPS
    Serial.println("[ADC-TEST] ADS0 @ 0x48 ready");
  } else {
    Serial.println("[ADC-TEST] ADS0 @ 0x48 NOT FOUND");
  }

  ads1Ready = ads1.begin();
  if (ads1Ready) {
    ads1.setGain(2);
    ads1.setDataRate(7);
    Serial.println("[ADC-TEST] ADS1 @ 0x49 ready");
  } else {
    Serial.println("[ADC-TEST] ADS1 @ 0x49 NOT FOUND");
  }

  // MOSFETs — 100% duty so dividers are always powered
  for (int i = 0; i < 5; i++) {
    ledcSetup(LEDC_CH[i], PWM_FREQ_HZ, PWM_RES_BITS);
    ledcAttachPin(MOSFET_PINS[i], LEDC_CH[i]);
    ledcWrite(LEDC_CH[i], PWM_MAX);
  }
  Serial.println("[ADC-TEST] MOSFETs ON (100% duty)");
  Serial.println("[ADC-TEST] Streaming — bend each finger to see values change:");
  Serial.println("[ADC-TEST]  T=thumb  I=index  M=middle  R=ring  P=pinky");
  Serial.println("[ADC-TEST]  Higher ADC count = more straight (higher voltage)");
  Serial.println("[ADC-TEST]  Lower  ADC count = more bent   (lower  voltage)");
  Serial.println();
  delay(500);
}

// ── loop ──────────────────────────────────────────────────────────────────────
void loop() {
  int16_t thumb  = ads0Ready ? ads0.readADC(0) : -1;  // ADS0 ch0
  int16_t index  = ads0Ready ? ads0.readADC(3) : -1;  // ADS0 ch3
  int16_t middle = ads1Ready ? ads1.readADC(0) : -1;  // ADS1 ch0
  int16_t ring   = ads0Ready ? ads0.readADC(2) : -1;  // ADS0 ch2
  int16_t pinky  = ads0Ready ? ads0.readADC(1) : -1;  // ADS0 ch1

  // Pretty-printed columns for easy reading in Serial Monitor / Plotter
  Serial.print("T="); Serial.print(thumb);
  Serial.print("\tI="); Serial.print(index);
  Serial.print("\tM="); Serial.print(middle);
  Serial.print("\tR="); Serial.print(ring);
  Serial.print("\tP="); Serial.println(pinky);

  delay(20);  // 50 Hz
}
