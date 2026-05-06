#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <esp_now.h>
#include <WiFi.h>

// ESP32-C3 Glove MAC Address
uint8_t broadcastAddress[] = {0xD8, 0x3B, 0xDA, 0x11, 0x79, 0x70};

// WiFi credentials — must match the glove so both are on the same channel.
// ESP-NOW only works between devices on the same WiFi channel.
#define WIFI_SSID "SoftSensorsLab"
#define WIFI_PASS "SoftSensors1324?"

#define I2C_SDA 8  
#define I2C_SCL 9  

uint16_t BNO055_SAMPLERATE_DELAY_MS = 100;

Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x29, &Wire);

typedef struct struct_message {
  int id; 
  float w;
  float x;
  float y;
  float z;
} struct_message;

struct_message myData;
esp_now_peer_info_t peerInfo;

// --- FAULT TOLERANCE VARIABLES ---
int errorCount = 0;
const int ERROR_THRESHOLD = 3; // Trigger re-init after 3 consecutive bad reads

void setup(void) {
  Serial.begin(115200);
  // Wait up to 3 s for the USB-CDC host to open the port.
  // Times out automatically so the board works standalone (without a PC).
  { unsigned long t = millis(); while (!Serial && millis() - t < 3000) delay(10); }

  // --- 1. I2C STABILITY FIXES ---
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000); // Fix for BNO055 clock stretching
  Wire.setTimeOut(100);  // Prevent bus lockups during Wi-Fi interrupts
  
  Serial.println("Sensor + ESP-NOW + Brownout Fix + Self-Healing"); 

  // --- 2. INITIALIZE SENSOR ---
  if (!bno.begin()) {
    Serial.println("Ooops, no BNO055 detected ... Check your wiring or I2C ADDR!");
  } else {
    delay(1000); // Critical 1-second boot delay for fusion engine
  }

  // --- 3. INITIALIZE ESP-NOW WITH REDUCED TX POWER ---
  WiFi.mode(WIFI_STA);

  // Set reduced TX power BEFORE connecting so the initial scan/association
  // burst is also power-limited. This prevents the 3.3V rail from sagging
  // below the BNO055's minimum supply voltage during WiFi startup when
  // running on battery (LiPo has less headroom than USB 5V).
  WiFi.setTxPower(WIFI_POWER_8_5dBm);

  // Connect to the same WiFi AP as the glove so both end up on the same
  // radio channel. ESP-NOW packets are silently dropped when sender and
  // receiver are on different channels.
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");
  unsigned long wt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wt < 10000) {
    delay(300);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\nWiFi connected, channel: %d\n", WiFi.channel());
  } else {
    Serial.println("\nWiFi failed — ESP-NOW may not work (channel mismatch).");
  }

  // Re-initialize BNO055 after WiFi connects — the radio burst can disturb
  // the I2C bus on boards with tight 3.3V regulation (battery powered).
  delay(150);
  if (!bno.begin()) {
    Serial.println("[BNO055] Post-WiFi re-init failed — will retry in loop.");
  } else {
    delay(500);
    Serial.println("[BNO055] Post-WiFi re-init OK.");
  }

  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }

  memcpy(peerInfo.peer_addr, broadcastAddress, 6);
  peerInfo.channel = 0;  
  peerInfo.encrypt = false;
  
  if (esp_now_add_peer(&peerInfo) != ESP_OK){
    Serial.println("Failed to add peer");
    return;
  }

  // IMPORTANT: Set to 1 for the first S3 (Triceps), and 2 for the second S3 (Forearm)
  myData.id = 1; 
}

void loop(void) {
  // Grab quaternion
  imu::Quaternion quat = bno.getQuat();
  
  // --- FAULT DETECTION LOGIC ---
  if (quat.w() == 0.0 && quat.x() == 0.0 && quat.y() == 0.0 && quat.z() == 0.0) {
    errorCount++;
    Serial.print("Warning: Sensor read 0.0 (Glitch count: ");
    Serial.print(errorCount);
    Serial.println(")");

    if (errorCount >= ERROR_THRESHOLD) {
      Serial.println("\n[!] BNO055 CONNECTION LOST! Attempting recovery...");
      
      // Attempt to re-initialize the sensor on the fly
      if (bno.begin()) {
        Serial.println("[+] BNO055 reconnected! Allowing fusion engine to boot...");
        delay(1000);    // The critical boot delay
        errorCount = 0; // Reset the fault counter
        Serial.println("[+] Recovery successful. Resuming telemetry.\n");
      } else {
        Serial.println("[-] Recovery failed. Waiting to try again...");
        delay(500); // Don't spam the I2C bus too fast while it's broken
      }
    }
    
    // Skip the rest of the loop so we don't broadcast bad data to the PC
    delay(BNO055_SAMPLERATE_DELAY_MS);
    return; 
  }

  // If we made it here, the data is good. Reset the error counter.
  errorCount = 0;

  // --- NORMAL OPERATION ---
  myData.w = quat.w();
  myData.x = quat.x();
  myData.y = quat.y();
  myData.z = quat.z();

  // Print quaternion to Serial Monitor for local debugging
  Serial.print("Quat: W="); Serial.print(myData.w, 4);
  Serial.print(" X="); Serial.print(myData.x, 4);
  Serial.print(" Y="); Serial.print(myData.y, 4);
  Serial.print(" Z="); Serial.println(myData.z, 4);

  // Transmit via ESP-NOW
  esp_now_send(broadcastAddress, (uint8_t *) &myData, sizeof(myData));

  delay(BNO055_SAMPLERATE_DELAY_MS);
}