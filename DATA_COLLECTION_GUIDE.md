# 📊 Data Collection Guide for ASL Glove Training

## Overview

To train a highly accurate ASL recognition model, you need high-quality, diverse training data. This guide explains the best practices for collecting data with your smart glove.

---

## 🎯 Recording Goals

### Target Dataset
- **15 ASL letters**: A, B, C, D, E, F, I, K, O, S, T, V, W, X, Y
- **10-15 samples per letter** (minimum)
- **150 samples per recording** (3 seconds at 50Hz)
- **Total: ~2,250 samples** for a basic model

### Why These Numbers?
- **10-15 samples**: Captures natural variation in hand position
- **150 samples/recording**: Ensures stable sign representation
- **Multiple sessions**: Reduces model bias to specific conditions

---

## 📝 Recording Pattern (CRITICAL!)

### ✅ **BEST PRACTICE: Multiple Sessions with Variation**

#### Session 1: Baseline (Day 1)
Record each letter 3-5 times:
- Relaxed, natural hand position
- Consistent wrist angle
- Standard finger tightness

#### Session 2: Position Variations (Day 1 or 2)
Record each letter 3-5 times with slight changes:
- **Hand angle**: Rotate wrist 10-15° left/right
- **Palm orientation**: Slight forward/backward tilt
- **Finger tightness**: Slightly looser or tighter fist

#### Session 3: Context Variations (Day 2 or 3)
Record each letter 2-3 times:
- Different times of day (muscle tension varies)
- After wearing glove for 10+ minutes (sensor settling)
- Different arm positions (raised, lowered, extended)

#### Session 4: Edge Cases (Optional, Day 3+)
Record challenging letters 2-3 extra times:
- Letters that confuse the model (e.g., T vs X)
- Fast transitions between similar signs
- Held for longer durations

---

## 🖐️ Recording Procedure

### Before You Start
1. **Calibrate sensors**: Wear glove for 2-3 minutes
2. **Test connection**: Verify real-time sensor display is working
3. **Check sensor ranges**: Make a fist and open hand - all sensors should change
4. **Sit comfortably**: Consistent posture helps quality

### For Each Letter
1. **Select letter** in Data Recorder
2. **Make the ASL sign**
3. **Hold steady** for 3 seconds
4. **Click "Start Recording"** or let it auto-start
5. **Stay still** until recording completes
6. **Relax** for 2 seconds before next recording

### Quality Checks
- ✅ All 5 sensors showing different values
- ✅ Values stable during recording (±10 units variation OK)
- ✅ No sensor stuck at 0 or 1023
- ✅ Real-time 3D hand visualization looks correct

---

## 🚫 Common Mistakes to Avoid

### ❌ DON'T:
1. **Record all samples in one session**
   - Model will overfit to that specific hand state
   
2. **Rush through recordings**
   - Need stable 3-second holds for quality data
   
3. **Record with loose connections**
   - Check sensor wires are secure
   
4. **Use identical hand positions**
   - Model needs variation to generalize
   
5. **Record letters you're unsure about**
   - Use ASL reference images/videos
   
6. **Mix up similar letters**
   - T and X are very different! Double-check ASL alphabet

---

## 📂 Data Format

### CSV Structure
```csv
label,ch0,ch1,ch2,ch3,ch4
A,444,804,829,742,711
A,437,809,834,748,715
...
```

- **label**: ASL letter (A-Y)
- **ch0-ch4**: Sensor values (0-1023) for thumb, index, middle, ring, pinky

### File Organization
```
recordings/
├── glove_data_2026-02-19.csv  # Today's session
├── glove_data_2026-02-20.csv  # Tomorrow's session
└── ...
```

The app auto-names files by date. **Combine them later for training!**

---

## 🎓 Advanced: Data Augmentation Tips

Once you have baseline data, you can enhance it:

### Physical Variation
- **Hand size simulation**: Adjust finger bend ranges in code
- **Speed variation**: Record some letters faster/slower
- **Transition data**: Record letter-to-letter changes

### Software Augmentation (Post-Collection)
The training script can add:
- **Noise injection**: ±5-10 units random variation
- **Scaling**: Simulate slightly different sensor ranges
- **Time warping**: Stretch/compress 3-second recordings

---

## 📊 How Much Data Do You Need?

| Model Quality | Samples per Letter | Total Samples | Sessions |
|--------------|-------------------|---------------|----------|
| **Basic** | 10 | 1,500 | 1-2 |
| **Good** | 15 | 2,250 | 2-3 |
| **Excellent** | 20-25 | 3,000-3,750 | 3-5 |
| **Production** | 30+ | 4,500+ | 5-10 |

### Your Current Target: **Good** (15 samples/letter)
- Realistic for thesis/demo
- Sufficient accuracy for most use cases
- Can be collected in 2-3 short sessions

---

## 🔄 Workflow Summary

```
Day 1:
├── Session 1 (Morning): Baseline recordings (5 samples/letter) [~20 min]
└── Session 2 (Afternoon): Position variations (5 samples/letter) [~20 min]

Day 2:
├── Session 3 (Any time): Context variations (5 samples/letter) [~20 min]
└── Combine CSVs → Train model → Test accuracy

Day 3+ (If needed):
└── Add more samples for low-accuracy letters
```

**Total time investment**: ~1-1.5 hours for a good model

---

## 🧪 After Data Collection

1. **Combine CSV files**:
   ```bash
   cat recordings/*.csv > combined_data.csv
   # Remove duplicate headers
   ```

2. **Validate data**:
   ```bash
   python iot-sign-glove/scripts/validate_data.py combined_data.csv
   ```

3. **Train model**:
   ```bash
   python iot-sign-glove/scripts/train_model.py --input combined_data.csv --output models/my_glove_model.pkl
   ```

4. **Test accuracy**:
   - Deploy model to API server
   - Test with desktop app in real-time
   - Record accuracy metrics

---

## 💡 Pro Tips

1. **Label your recordings**: Keep notes on which session/variation each file represents
2. **Record similar letters back-to-back**: Helps you remember the differences
3. **Use ASL reference images**: Print or display on second screen
4. **Take breaks**: Hand fatigue affects sensor readings
5. **Consistency is key**: Same glove fit, same sensor positions
6. **Review your data**: Check CSV files for anomalies before training

---

## 🐛 Troubleshooting

### Problem: Low accuracy after training
**Solutions**:
- Collect more diverse samples
- Check for mislabeled data
- Verify sensor connections during recording

### Problem: Specific letters always wrong
**Solutions**:
- Record 5-10 extra samples of those letters
- Verify your ASL sign matches reference images
- Check if sensors are working for those finger positions

### Problem: Model works for you but not others
**Solutions**:
- Your data is too specific to your hand
- Need more variation in recordings
- Consider collecting data from multiple users

---

## 📚 References

- **ASL Alphabet**: https://www.lifeprint.com/asl101/images-layout/ABC.png
- **Flex Sensor Guide**: Check `iot-sign-glove/ARDUINO_NANO_GUIDE.md`
- **Training Script**: `iot-sign-glove/scripts/train_model.py`

---

## ✅ Checklist

Before starting data collection:
- [ ] Glove is properly fitted and sensors are secure
- [ ] Desktop app connects successfully to glove
- [ ] Real-time sensor display shows varying values
- [ ] 3D hand visualization matches your hand position
- [ ] You have ASL reference images ready
- [ ] You understand the recording pattern (multiple sessions with variation)

Ready to collect? **Good luck! 🚀**

