# Index Finger Diagnostic Guide

## Data Flow for Index Finger (Position 1, Array Index 1)

### 1. ESP32 Arduino Code
```cpp
const int thermPins[NUM_FINGERS] = {32, 35, 34, 39, 36};
// Index: 0=Thumb, 1=Index, 2=Middle, 3=Ring, 4=Pinky

// Reading Index finger (position 1):
values[1] = analogRead(thermPins[1]);  // Reading from pin 35
```

**Output format**: `value0,value1,value2,value3,value4`  
**Index finger is**: `value1` (second value in CSV)

---

### 2. Rust Serial Parser (`main.rs`)
```rust
let values: Vec<&str> = line.split(',').collect();  // Split by comma
let parsed: Vec<i32> = values
    .iter()
    .filter_map(|s| s.trim().parse::<i32>().ok())
    .collect();

// Index finger is: parsed[1]
```

**Check**: `parsed.len()` should equal 5  
**Index finger**: `parsed[1]` (second element)

---

### 3. Frontend Reception (`App.tsx`)
```typescript
// Data arrives from Tauri event
listen('serial-data', (event) => {
  const data = event.payload as number[];
  // data = [thumb, index, middle, ring, pinky]
  // Index finger: data[1]
});
```

---

### 4. Calibration Defaults
```typescript
const DEFAULT_BASELINES = [2871, 1949, 2135, 2303, 2348];
const DEFAULT_MAXBENDS  = [2832, 1922, 2105, 2279, 2323];

// Index finger (position 1):
// Baseline: 1949 (straight)
// Maxbend:  1922 (bent)
```

---

### 5. Conversion for ML Model
```typescript
// Thermistor → Flex Sensor conversion
const MODEL_BASELINES = [440, 612, 618, 548, 528];
const MODEL_MAXBENDS  = [650, 900, 900, 850, 800];

// Index finger conversion (position 1):
// Input range:  1949 (straight) → 1922 (bent)
// Output range: 612 (straight) → 900 (bent)
```

---

## Common Issues & Solutions

### Issue 1: Index Finger Always Shows Same Value
**Symptom**: Index finger value doesn't change when moving  
**Possible Causes**:
- Pin 35 hardware issue (loose connection)
- Thermistor not working on that pin
- ESP32 ADC problem on pin 35

**Test**:
```cpp
// In ESP32 Arduino IDE Serial Monitor, check if values[1] changes
void loop() {
  Serial.print("Index finger (pin 35): ");
  Serial.println(analogRead(35));
  delay(500);
}
```

---

### Issue 2: Index Finger Value Out of Range
**Symptom**: Index shows values like 4095, 0, or way outside 1900-1950 range  
**Possible Causes**:
- Disconnected thermistor
- Incorrect wiring on pin 35
- Damaged sensor

**Test**:
1. Disconnect glove
2. Connect multimeter to pin 35
3. Check resistance changes when bending

---

### Issue 3: Index Finger Swapped with Another
**Symptom**: Moving index changes a different finger visualization  
**Possible Causes**:
- Wrong pin order in `thermPins` array
- Physical wiring mismatch

**Fix**:
```cpp
// Try swapping positions to find correct mapping
const int thermPins[NUM_FINGERS] = {32, 34, 35, 39, 36};  // Swap 34 & 35
//                                      ↑   ↑   ↑
//                                   thumb index middle
```

---

### Issue 4: Index Finger Inverted (Straight=Bent, Bent=Straight)
**Symptom**: Index visualization bends when you straighten  
**Possible Causes**:
- Baseline/Maxbend values swapped

**Fix**:
```typescript
// Check if baseline > maxbend (should be for thermistors)
// Index: baseline=1949, maxbend=1922
// If reversed, recalibrate just index finger
```

---

### Issue 5: Index Finger Conversion Wrong
**Symptom**: Predictions wrong only when index finger involved  
**Possible Causes**:
- Wrong MODEL_BASELINES or MODEL_MAXBENDS for index

**Debug**:
```typescript
// Add logging in makePrediction:
console.log('Index finger raw (thermistor):', samples[0][1]);
console.log('Index finger converted (flex):', convertedSamples[0][1]);
// Should be: ~1949 → ~612 (straight) or ~1922 → ~900 (bent)
```

---

## Diagnostic Steps

### Step 1: Check Raw Serial Data
1. Open Arduino IDE Serial Monitor
2. Connect ESP32 at 115200 baud
3. Watch the CSV output
4. Move ONLY index finger
5. **Verify**: Second value (position 1) changes

**Example good output**:
```
2890,1945,2137,2303,2351  ← Index straight (1945)
2890,1925,2137,2303,2351  ← Index bent (1925)
```

---

### Step 2: Check Desktop App Reception
1. Open browser DevTools Console (F12)
2. Connect to glove
3. Look for `[Serial] Data:` logs
4. Move ONLY index finger
5. **Verify**: `data[1]` changes in console

**Example**:
```
[Serial] Data: [2890, 1945, 2137, 2303, 2351]
[Serial] Data: [2890, 1925, 2137, 2303, 2351]
                     ↑ Index changing
```

---

### Step 3: Check Calibration
1. Open Per-Finger Calibrator
2. Click "Index ☝️"
3. Straighten index → Record → Note value (should be ~1949)
4. Bend index → Record → Note value (should be ~1922)
5. **Verify**: Straight > Bent (thermistor behavior)

---

### Step 4: Check Visualization
1. After calibration, watch "Real-Time Sensor Values"
2. Move ONLY index finger
3. **Verify**: 
   - Bar width changes
   - Color changes (green → yellow → red)
   - Value updates

---

### Step 5: Check 3D Hand
1. Watch 3D hand visualization
2. Move ONLY index finger
3. **Verify**: 3D index finger bends/straightens correctly

---

### Step 6: Check Prediction
1. Make ASL "D" sign (index straight, others bent)
2. Record 200 samples
3. Get prediction
4. **Verify**: Model sees index as ~612 (straight in flex sensor range)

---

## Quick Test Values

### Known Good Values for Index Finger:

| State | Thermistor Raw | After Conversion (Flex) |
|-------|----------------|-------------------------|
| **Straight** | ~1949 | ~612 |
| **Partially Bent** | ~1935 | ~750 |
| **Fully Bent** | ~1922 | ~900 |

### Test in Console:
```javascript
// Paste this in browser console:
const testIndex = (thermValue) => {
  const baseline = 1949;
  const maxbend = 1922;
  const normalized = (baseline - thermValue) / (baseline - maxbend);
  const flexValue = 612 + normalized * (900 - 612);
  console.log(`Thermistor ${thermValue} → Flex ${flexValue.toFixed(0)}`);
};

testIndex(1949); // Should output ~612 (straight)
testIndex(1935); // Should output ~750 (partial)
testIndex(1922); // Should output ~900 (bent)
```

---

## Hardware Check

### Physical Inspection:
1. **Pin 35 on ESP32** - Is wire connected?
2. **Index finger thermistor** - Is it attached to glove?
3. **Wire continuity** - Use multimeter to check connection
4. **Solder joints** - Are they solid?

### Resistance Test:
1. Disconnect ESP32
2. Measure resistance between pin 35 and GND
3. **Straight finger**: Should be ~10kΩ (depends on thermistor)
4. **Bent finger**: Should change (increase or decrease)

---

## What's Your Specific Problem?

Please describe:
1. **What value do you see** for index finger in console?
2. **Does it change** when you move index finger?
3. **Where does it fail**: 
   - Raw serial data?
   - Desktop app reception?
   - Visualization?
   - Prediction accuracy?

Once I know the specific symptom, I can help pinpoint the exact issue!
