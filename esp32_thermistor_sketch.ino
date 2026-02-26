/*
 * ESP32 Thermistor Glove — Dual Mode (USB Serial + BLE UART)
 *
 * Sends 5-finger thermistor data at 50 Hz in CSV format simultaneously on:
 *   1. USB Serial    → desktop app (115200 baud)
 *   2. BLE UART/NUS  → mobile app (Nordic UART Service)
 *
 * BLE device name : ESP32-GloveASL
 * Service UUID    : 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 * TX char UUID    : 6E400003-B5A3-F393-E0A9-E50E24DCCA9E  (ESP32 → phone)
 * RX char UUID    : 6E400002-B5A3-F393-E0A9-E50E24DCCA9E  (phone → ESP32, reserved)
 *
 * Hardware : ESP32 + 5 thermistors on ADC pins 32, 35, 34, 39, 36
 *            (thumb, index, middle, ring, pinky)
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── BLE UUIDs (Nordic UART Service) ──────────────────────────────────────────
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_CHAR_TX_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // notify
#define NUS_CHAR_RX_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // write

// ── Sensor pins ───────────────────────────────────────────────────────────────
#define NUM_FINGERS 5
const int THERM_PINS[NUM_FINGERS] = {32, 35, 34, 39, 36};  // thumb→pinky

// ── BLE state ─────────────────────────────────────────────────────────────────
BLEServer         *pServer           = nullptr;
BLECharacteristic *pTxCharacteristic = nullptr;
volatile bool      bleConnected      = false;
volatile bool      bleWasConnected   = false;

class GloveServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    bleConnected = true;
    BLEDevice::stopAdvertising();   // save power while connected
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer *) override {
    bleConnected    = false;
    bleWasConnected = true;         // triggers advertising restart in loop()
    Serial.println("[BLE] Client disconnected");
  }
};

// ── setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  // Configure ADC pins
  for (int i = 0; i < NUM_FINGERS; i++) {
    pinMode(THERM_PINS[i], INPUT);
  }

  // ── BLE initialisation ────────────────────────────────────────────────────
  BLEDevice::init("ESP32-GloveASL");
  BLEDevice::setMTU(64);  // 64 bytes is plenty for "4095,4095,4095,4095,4095\n"

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new GloveServerCallbacks());

  // Create NUS service
  BLEService *pService = pServer->createService(NUS_SERVICE_UUID);

  // TX: notify  (ESP32 → phone)
  pTxCharacteristic = pService->createCharacteristic(
    NUS_CHAR_TX_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pTxCharacteristic->addDescriptor(new BLE2902());

  // RX: write   (phone → ESP32 — reserved for future commands)
  pService->createCharacteristic(
    NUS_CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );

  pService->start();

  // Advertise NUS UUID so the mobile app can filter by service
  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(NUS_SERVICE_UUID);
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);  // iOS connection interval hint
  pAdv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[READY] ESP32 Thermistor Glove — USB Serial + BLE advertising");
}

// ── loop ──────────────────────────────────────────────────────────────────────
void loop() {
  // Restart advertising after a client disconnects so it can reconnect
  if (bleWasConnected && !bleConnected) {
    bleWasConnected = false;
    delay(100);
    BLEDevice::startAdvertising();
    Serial.println("[BLE] Restarted advertising");
  }

  // ── Read all 5 sensors ────────────────────────────────────────────────────
  int v[NUM_FINGERS];
  for (int i = 0; i < NUM_FINGERS; i++) {
    v[i] = analogRead(THERM_PINS[i]);
  }

  // Build CSV line once; share between both outputs
  char csv[32];
  snprintf(csv, sizeof(csv), "%d,%d,%d,%d,%d\n",
           v[0], v[1], v[2], v[3], v[4]);

  // ── USB Serial → desktop app ──────────────────────────────────────────────
  Serial.print(csv);

  // ── BLE notify → mobile app ───────────────────────────────────────────────
  if (bleConnected) {
    pTxCharacteristic->setValue(reinterpret_cast<uint8_t *>(csv), strlen(csv));
    pTxCharacteristic->notify();
  }

  delay(20);  // 50 Hz
}
