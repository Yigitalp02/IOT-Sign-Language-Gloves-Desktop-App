/*
 * ESP32 Glove v4
 *
 * Flex sensing: TexsorvaV3 (unchanged)
 *   - ADS1115 GAIN_TWOTHIRDS (±6.144 V) — safe for full 3.3 V sensor range
 *   - Direct channel mapping: ADS0 ch0=thumb, ch1=index, ch2=middle, ch3=ring; ADS1 ch0=pinky
 *   - EMA filter + proportional MOSFET excitation (proven to work)
 *   - Output: positive Ohm values — higher = more bent
 *
 * IMU + comms: esp32-new
 *   - BNO055 quaternion, linear accel, gyroscope
 *   - WiFi TCP server on port 3333  (mDNS: glove.local)
 *   - ESP-NOW armband receiver (id=1 upper arm, id=2 forearm)
 *
 * Output — 23-column CSV at 50 Hz (Serial + TCP):
 *   "F0,F1,F2,F3,F4,qw,qx,qy,qz,lx,ly,lz,gx,gy,gz,q1w,q1x,q1y,q1z,q2w,q2x,q2y,q2z\n"
 *   F0-F4 : positive Ohm values (increases when finger bends)
 *
 * After flashing, open Serial Monitor → note this board's MAC address,
 * paste it into broadcastAddress[] in both armband .ino files,
 * set id=1 for upper-arm band and id=2 for forearm band, then re-flash armbands.
 */

#include <Arduino.h>
#include <Wire.h>
#include "ADS1X15.h"
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <esp_now.h>

// ── WiFi / TCP ────────────────────────────────────────────────────────────────
#define WIFI_SSID  "SoftSensorsLab"
#define WIFI_PASS  "SoftSensors1324?"
#define TCP_PORT   3333
#define MDNS_NAME  "glove"

// ── I2C ───────────────────────────────────────────────────────────────────────
#define I2C_SDA  9
#define I2C_SCL 10

// ── BNO055 ────────────────────────────────────────────────────────────────────
// ADR pin → 3.3V = 0x29   (use 0x28 if ADR pin is GND)
#define BNO_ADDR 0x29
Adafruit_BNO055 bno = Adafruit_BNO055(55, BNO_ADDR, &Wire);
bool imuReady = false;

// ── ADS1115 ───────────────────────────────────────────────────────────────────
ADS1115 ads0(0x48);   // ch0=thumb  ch1=index  ch2=middle  ch3=ring
ADS1115 ads1(0x49);   // ch0=pinky
bool ads0Ready = false;
bool ads1Ready = false;

// ── MOSFET excitation PWM ─────────────────────────────────────────────────────
// Proportional control from TexsorvaV3 — duty ∝ measured voltage.
// Works reliably with GAIN_TWOTHIRDS; avoids runaway-to-zero seen with GAIN_TWO.
static const uint8_t MOSFET_PINS[5] = {4, 5, 6, 7, 3};
static const uint8_t LEDC_CH[5]     = {0, 1, 2, 3, 4};
#define PWM_FREQ_HZ   1000          // 1 kHz (TexsorvaV3 value)
#define PWM_RES_BITS     8
#define PWM_MAX       ((1 << PWM_RES_BITS) - 1)
#define V_SUPPLY       3.3f
#define R_REF_OHM    330.0f
#define EMA_ALPHA      0.25f        // flex EMA smoothing

float ema_volts[5]    = {0};
bool  ema_initialized = false;

// ── WiFi TCP ──────────────────────────────────────────────────────────────────
WiFiServer tcpServer(TCP_PORT);
WiFiClient tcpClient;

// ── ESP-NOW — armband quaternions ─────────────────────────────────────────────
typedef struct {
  int   id;
  float w, x, y, z;
} ArmPacket;

volatile float q1w=1, q1x=0, q1y=0, q1z=0;  // upper-arm armband
volatile float q2w=1, q2x=0, q2y=0, q2z=0;  // forearm armband

void IRAM_ATTR onArmData(const uint8_t *mac, const uint8_t *data, int len) {
  if (len != sizeof(ArmPacket)) return;
  ArmPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));
  if      (pkt.id == 1) { q1w=pkt.w; q1x=pkt.x; q1y=pkt.y; q1z=pkt.z; }
  else if (pkt.id == 2) { q2w=pkt.w; q2x=pkt.x; q2y=pkt.y; q2z=pkt.z; }
}

// ── Flex helpers (TexsorvaV3 — unchanged) ─────────────────────────────────────
float readChannelVolts(ADS1115 &ads, uint8_t channel) {
  return ads.toVoltage(ads.readADC(channel));
}

void readFlexVolts(float volts[5]) {
  // Direct mapping confirmed by TexsorvaV3:
  //   ADS0 ch0 = thumb   ch1 = index   ch2 = middle   ch3 = ring
  //   ADS1 ch0 = pinky
  volts[0] = ads0Ready ? readChannelVolts(ads0, 0) : 0;
  volts[1] = ads0Ready ? readChannelVolts(ads0, 1) : 0;
  volts[2] = ads0Ready ? readChannelVolts(ads0, 2) : 0;
  volts[3] = ads0Ready ? readChannelVolts(ads0, 3) : 0;
  volts[4] = ads1Ready ? readChannelVolts(ads1, 0) : 0;
}

void emaFilter(const float raw[5], float filtered[5]) {
  for (int i = 0; i < 5; i++) {
    filtered[i] = ema_initialized
      ? EMA_ALPHA * raw[i] + (1.0f - EMA_ALPHA) * ema_volts[i]
      : raw[i];
    ema_volts[i] = filtered[i];
  }
  ema_initialized = true;
}

float voltsToOhms(float v) {
  if (v <= 0.002f)            return -1.0f;   // open circuit
  if (v >= V_SUPPLY - 0.002f) return  0.0f;   // short circuit
  return R_REF_OHM * (V_SUPPLY / v - 1.0f);
}

void updateMosfets(const float filtered[5]) {
  for (int i = 0; i < 5; i++) {
    float ratio = filtered[i] / V_SUPPLY;
    if (ratio < 0.0f) ratio = 0.0f;
    if (ratio > 1.0f) ratio = 1.0f;
    ledcWrite(LEDC_CH[i], (uint32_t)(PWM_MAX * ratio));
  }
}

// ── setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);
  Wire.setTimeOut(100);

  // ── I2C scan ──────────────────────────────────────────────────────────────
  Serial.println("[I2C] Scanning...");
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0)
      Serial.printf("[I2C] Found 0x%02X\n", addr);
  }

  // ── BNO055 ────────────────────────────────────────────────────────────────
  if (bno.begin()) {
    bno.setExtCrystalUse(true);
    imuReady = true;
    Serial.println("[IMU] BNO055 ready");
  } else {
    Serial.println("[IMU] BNO055 NOT FOUND — sending identity quaternion");
  }

  // ── ADS1115 ───────────────────────────────────────────────────────────────
  ads0Ready = ads0.begin();
  if (ads0Ready) {
    ads0.setGain(0);      // GAIN_TWOTHIRDS ±6.144 V — handles full 3.3 V range
    ads0.setDataRate(7);  // 860 SPS
    Serial.println("[ADC] ADS0 @ 0x48 ready");
  } else {
    Serial.println("[ADC] ADS0 @ 0x48 NOT FOUND");
  }

  ads1Ready = ads1.begin();
  if (ads1Ready) {
    ads1.setGain(0);
    ads1.setDataRate(7);
    Serial.println("[ADC] ADS1 @ 0x49 ready");
  } else {
    Serial.println("[ADC] ADS1 @ 0x49 NOT FOUND");
  }

  // ── MOSFETs ───────────────────────────────────────────────────────────────
  for (int i = 0; i < 5; i++) {
    ledcSetup(LEDC_CH[i], PWM_FREQ_HZ, PWM_RES_BITS);
    ledcAttachPin(MOSFET_PINS[i], LEDC_CH[i]);
    ledcWrite(LEDC_CH[i], 0);
  }

  // ── WiFi ──────────────────────────────────────────────────────────────────
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[WiFi] Connecting to " WIFI_SSID);
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    if (MDNS.begin(MDNS_NAME)) {
      MDNS.addService("tcp", "tcp", TCP_PORT);
      Serial.println("[mDNS] Hostname: " MDNS_NAME ".local");
    }
    tcpServer.begin();
    Serial.printf("[TCP]  Listening on port %d\n", TCP_PORT);
  } else {
    Serial.println("\n[WiFi] FAILED — Serial-only mode");
  }

  // ── ESP-NOW ───────────────────────────────────────────────────────────────
  Serial.printf("[ESP-NOW] Board MAC: %s\n", WiFi.macAddress().c_str());
  Serial.println("[ESP-NOW] Paste the MAC above into broadcastAddress[] in both armband .ino files.");
  if (esp_now_init() == ESP_OK) {
    esp_now_register_recv_cb(onArmData);
    Serial.println("[ESP-NOW] Ready — waiting for armband packets (id=1 upper, id=2 forearm).");
  } else {
    Serial.println("[ESP-NOW] Init FAILED — Q1/Q2 will stay at identity (1,0,0,0).");
  }

  Serial.println("[READY]");
  Serial.println("F0(thumb),F1(index),F2(middle),F3(ring),F4(pinky),"
                 "qw,qx,qy,qz,lx,ly,lz,gx,gy,gz,"
                 "q1w,q1x,q1y,q1z,q2w,q2x,q2y,q2z");
}

// ── loop ──────────────────────────────────────────────────────────────────────
void loop() {
  // Accept new TCP client
  if (!tcpClient || !tcpClient.connected()) {
    WiFiClient nc = tcpServer.available();
    if (nc) {
      tcpClient = nc;
      tcpClient.setNoDelay(true);
      Serial.printf("[WiFi] Client connected from %s\n",
                    tcpClient.remoteIP().toString().c_str());
    }
  }

  // ── Flex (TexsorvaV3 pipeline) ────────────────────────────────────────────
  float volts_raw[5], volts_filtered[5];
  readFlexVolts(volts_raw);
  emaFilter(volts_raw, volts_filtered);
  updateMosfets(volts_filtered);

  float ohms[5];
  for (int i = 0; i < 5; i++) ohms[i] = voltsToOhms(volts_filtered[i]);

  // ── IMU ───────────────────────────────────────────────────────────────────
  float qw=1,qx=0,qy=0,qz=0, lx=0,ly=0,lz=0, gx=0,gy=0,gz=0;
  if (imuReady) {
    imu::Quaternion   q   = bno.getQuat();
    imu::Vector<3>    la  = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
    imu::Vector<3>    gy3 = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
    qw=q.w(); qx=q.x(); qy=q.y(); qz=q.z();
    lx=la.x(); ly=la.y(); lz=la.z();
    gx=gy3.x(); gy=gy3.y(); gz=gy3.z();
  }

  // Snapshot armband quaternions (volatile → local)
  float a1w=q1w, a1x=q1x, a1y=q1y, a1z=q1z;
  float a2w=q2w, a2x=q2x, a2y=q2y, a2z=q2z;

  // ── 23-column CSV ─────────────────────────────────────────────────────────
  char csv[256];
  snprintf(csv, sizeof(csv),
    "%.1f,%.1f,%.1f,%.1f,%.1f,"
    "%.4f,%.4f,%.4f,%.4f,"
    "%.3f,%.3f,%.3f,"
    "%.2f,%.2f,%.2f,"
    "%.4f,%.4f,%.4f,%.4f,"
    "%.4f,%.4f,%.4f,%.4f\n",
    ohms[0], ohms[1], ohms[2], ohms[3], ohms[4],
    qw, qx, qy, qz,
    lx, ly, lz,
    gx, gy, gz,
    a1w, a1x, a1y, a1z,
    a2w, a2x, a2y, a2z);

  Serial.print(csv);
  if (tcpClient && tcpClient.connected()) tcpClient.print(csv);

  delay(20);  // 50 Hz
}
