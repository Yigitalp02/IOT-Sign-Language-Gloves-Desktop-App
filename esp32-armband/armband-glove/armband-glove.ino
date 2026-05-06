#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include "BluetoothSerial.h"
#include <esp_now.h>
#include <WiFi.h>

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth is not enabled!
#endif

BluetoothSerial SerialBT;

// --- BNO055 CONFIG ---
#define I2C_SDA 21
#define I2C_SCL 22
#define BNO_RST 23  

Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x29, &Wire);

// --- FINGER SENSOR CONFIG ---
#define NUM_FINGERS 5
const int thermPins[NUM_FINGERS] = {36, 39, 34, 35, 32};
const int mosfetPins[NUM_FINGERS] = {18, 5, 17, 16, 4};

// PWM Settings
const int pwmFreq = 5000;
const int pwmResolution = 8; 
int mosfetPWM[NUM_FINGERS] = {0, 0, 0, 0, 0};

// --- ESP-NOW CONFIG ---
typedef struct struct_message {
  int id;
  float w;
  float x;
  float y;
  float z;
} struct_message;

struct_message incomingData;

// Arrays to hold the latest data from the S3s
float s3_1_quat[4] = {1.0, 0.0, 0.0, 0.0};
float s3_2_quat[4] = {1.0, 0.0, 0.0, 0.0};

// Callback function that will be executed when data is received
// Updated callback function for ESP32 Core v3.x+
void OnDataRecv(const esp_now_recv_info *info, const uint8_t *incomingDataPtr, int len) {
  memcpy(&incomingData, incomingDataPtr, sizeof(incomingData));
  
  // Debug print
  //Serial.printf("Received %d bytes from ID: %d\n", len, incomingData.id);

  if (incomingData.id == 1) {
    s3_1_quat[0] = incomingData.w;
    s3_1_quat[1] = incomingData.x;
    s3_1_quat[2] = incomingData.y;
    s3_1_quat[3] = incomingData.z;
  } else if (incomingData.id == 2) {
    s3_2_quat[0] = incomingData.w;
    s3_2_quat[1] = incomingData.x;
    s3_2_quat[2] = incomingData.y;
    s3_2_quat[3] = incomingData.z;
  }
}

void setup() {
  Serial.begin(115200);
  
  // Set WiFi to Station mode before initializing ESP-NOW
  WiFi.mode(WIFI_STA);

  // Start Bluetooth
  SerialBT.begin("ESP32_Glove_AHY"); 
  Serial.println("Bluetooth Started!");

  // Initialize ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Error initializing ESP-NOW");
    return;
  }
  esp_now_register_recv_cb(OnDataRecv);

  // 1. Setup BNO055
  pinMode(BNO_RST, OUTPUT);
  digitalWrite(BNO_RST, LOW); delay(20);
  digitalWrite(BNO_RST, HIGH); delay(100);

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000); 
  Wire.setTimeOut(100); 

  if (!bno.begin()) {
    Serial.println("Error: WROOM BNO055 not detected!");
  } else {
    bno.setExtCrystalUse(true);
  }

  // 2. Setup MOSFETs
  for (int i = 0; i < NUM_FINGERS; i++) {
    pinMode(mosfetPins[i], OUTPUT);
    ledcAttach(mosfetPins[i], pwmFreq, pwmResolution);
    ledcWrite(mosfetPins[i], 0); 
  }
}

void loop() {
  // ==========================================
  // 1. READ SENSORS AND COMPILE PACKET
  // ==========================================
  imu::Quaternion quat = bno.getQuat();

  // Construct string. Q0 is WROOM, Q1 is S3 #1, Q2 is S3 #2
  String dataPacket = "Q0W:" + String(quat.w(), 4) + 
                     ",Q0X:" + String(quat.x(), 4) + 
                     ",Q0Y:" + String(quat.y(), 4) + 
                     ",Q0Z:" + String(quat.z(), 4);

  dataPacket += ",Q1W:" + String(s3_1_quat[0], 4) + 
               ",Q1X:" + String(s3_1_quat[1], 4) + 
               ",Q1Y:" + String(s3_1_quat[2], 4) + 
               ",Q1Z:" + String(s3_1_quat[3], 4);

  dataPacket += ",Q2W:" + String(s3_2_quat[0], 4) + 
               ",Q2X:" + String(s3_2_quat[1], 4) + 
               ",Q2Y:" + String(s3_2_quat[2], 4) + 
               ",Q2Z:" + String(s3_2_quat[3], 4);

  for (int i = 0; i < NUM_FINGERS; i++) {
    int raw = analogRead(thermPins[i]);
    dataPacket += ",F" + String(i) + ":" + String(raw);
  }

  // Send over Bluetooth and Serial monitor
  SerialBT.println(dataPacket);
  Serial.println(dataPacket);

  // ==========================================
  // 2. CHECK FOR INCOMING INSTRUCTIONS
  // ==========================================
  if (SerialBT.available() || Serial.available()) {
    String incoming = "";
    if(SerialBT.available()) incoming = SerialBT.readStringUntil('\n');
    else incoming = Serial.readStringUntil('\n');
    
    incoming.trim(); 

    int lastIndex = 0;
    for(int i = 0; i < NUM_FINGERS; i++) {
      int commaIndex = incoming.indexOf(',', lastIndex);
      if(commaIndex != -1 || i == NUM_FINGERS - 1) { 
        String valString = incoming.substring(lastIndex, commaIndex == -1 ? incoming.length() : commaIndex);
        mosfetPWM[i] = valString.toInt();
        lastIndex = commaIndex + 1;
        
        mosfetPWM[i] = constrain(mosfetPWM[i], 0, 255);
        ledcWrite(mosfetPins[i], mosfetPWM[i]);
      }
    }
  }

  delay(50); 
}