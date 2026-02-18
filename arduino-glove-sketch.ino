/*
 * ASL Glove - Arduino Nano Sketch
 * 
 * This sketch reads 5 flex sensors and sends the data over serial
 * Format: "value1,value2,value3,value4,value5\n"
 * 
 * Pin connections:
 * - A0: Thumb flex sensor (CH0)
 * - A1: Index flex sensor (CH1)
 * - A2: Middle flex sensor (CH2)
 * - A3: Ring flex sensor (CH3)
 * - A4: Pinky flex sensor (CH4)
 * 
 * Flex sensors should be connected with a voltage divider:
 * 5V -- [Flex Sensor] -- [Analog Pin] -- [10kΩ Resistor] -- GND
 */

const int FLEX_PINS[5] = {A0, A1, A2, A3, A4};  // Analog pins for flex sensors
const int SAMPLE_RATE = 20;  // Milliseconds between readings (50Hz)

void setup() {
  // Initialize serial communication at 115200 baud
  Serial.begin(115200);
  
  // Wait for serial port to connect
  while (!Serial) {
    delay(10);
  }
  
  Serial.println("ASL Glove initialized - sending data at 50Hz");
}

void loop() {
  // Read all 5 flex sensors
  int sensorValues[5];
  for (int i = 0; i < 5; i++) {
    sensorValues[i] = analogRead(FLEX_PINS[i]);
  }
  
  // Send as comma-separated values
  Serial.print(sensorValues[0]);
  for (int i = 1; i < 5; i++) {
    Serial.print(",");
    Serial.print(sensorValues[i]);
  }
  Serial.println();  // End with newline
  
  // Wait before next reading (50Hz = 20ms)
  delay(SAMPLE_RATE);
}

