import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";

interface SensorSample {
    timestamp: number;
    ch0: number;
    ch1: number;
    ch2: number;
    ch3: number;
    ch4: number;
}

interface CalibrationData {
    baseline: number[];
    maxbend: number[];
}

export default function DataRecorder() {
    const { t } = useTranslation();
    const [isRecording, setIsRecording] = useState(false);
    const [isCalibrating, setIsCalibrating] = useState<'baseline' | 'maxbend' | null>(null);
    const [selectedGesture, setSelectedGesture] = useState("A");
    const [userId, setUserId] = useState("U001");
    const [sessionId, setSessionId] = useState("S1");
    const [recordedSamples, setRecordedSamples] = useState(0);
    const [calibration, setCalibration] = useState<CalibrationData | null>(null);
    
    const samplesBuffer = useRef<SensorSample[]>([]);
    const calibrationBuffer = useRef<SensorSample[]>([]);

    useEffect(() => {
        const unlisten = listen<string>("sensor-data", (event) => {
            // Parse CSV: timestamp,ch0,ch1,ch2,ch3,ch4
            const parts = event.payload.split(',');
            if (parts.length === 6) {
                const sample: SensorSample = {
                    timestamp: parseInt(parts[0]),
                    ch0: parseInt(parts[1]),
                    ch1: parseInt(parts[2]),
                    ch2: parseInt(parts[3]),
                    ch3: parseInt(parts[4]),
                    ch4: parseInt(parts[5]),
                };

                // Add to recording buffer if recording
                if (isRecording) {
                    samplesBuffer.current.push(sample);
                    setRecordedSamples(samplesBuffer.current.length);
                }

                // Add to calibration buffer if calibrating
                if (isCalibrating) {
                    calibrationBuffer.current.push(sample);
                }
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, [isRecording, isCalibrating]);

    const startRecording = () => {
        samplesBuffer.current = [];
        setRecordedSamples(0);
        setIsRecording(true);
    };

    const stopRecording = async () => {
        setIsRecording(false);
        
        if (samplesBuffer.current.length === 0) {
            alert("No samples recorded!");
            return;
        }

        // Save to CSV
        try {
            await invoke("save_recording", {
                samples: samplesBuffer.current,
                gesture: selectedGesture,
                userId,
                sessionId,
                calibration: calibration || { baseline: [500, 520, 510, 505, 515], maxbend: [850, 870, 860, 855, 865] }
            });
            
            alert(`✓ Saved ${samplesBuffer.current.length} samples for gesture "${selectedGesture}"`);
            samplesBuffer.current = [];
            setRecordedSamples(0);
        } catch (error) {
            alert(`Error saving: ${error}`);
        }
    };

    const startCalibration = (type: 'baseline' | 'maxbend') => {
        calibrationBuffer.current = [];
        setIsCalibrating(type);
        
        // Auto-stop after 2 seconds
        setTimeout(() => {
            finishCalibration(type);
        }, 2000);
    };

    const finishCalibration = (type: 'baseline' | 'maxbend') => {
        setIsCalibrating(null);

        if (calibrationBuffer.current.length === 0) {
            alert("No calibration data collected!");
            return;
        }

        // Calculate average for each channel
        const numSamples = calibrationBuffer.current.length;
        const avg = [0, 0, 0, 0, 0];
        
        calibrationBuffer.current.forEach(sample => {
            avg[0] += sample.ch0;
            avg[1] += sample.ch1;
            avg[2] += sample.ch2;
            avg[3] += sample.ch3;
            avg[4] += sample.ch4;
        });

        const result = avg.map(sum => Math.round(sum / numSamples));

        if (type === 'baseline') {
            setCalibration({
                baseline: result,
                maxbend: calibration?.maxbend || [850, 870, 860, 855, 865]
            });
        } else {
            setCalibration({
                baseline: calibration?.baseline || [500, 520, 510, 505, 515],
                maxbend: result
            });
        }

        alert(`✓ ${type} calibrated: [${result.join(', ')}]`);
    };

    const gestures = ["REST", "A", "B", "C", "D", "E", "F", "G", "H"];

    return (
        <div style={{
            background: "var(--bg-card)",
            padding: "1.5rem",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            marginBottom: "1.5rem"
        }}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)" }}>
                Data Recorder
            </h3>

            {/* User & Session Info */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
                <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
                        User ID
                    </label>
                    <input
                        type="text"
                        value={userId}
                        onChange={(e) => setUserId(e.target.value)}
                        disabled={isRecording}
                        style={{
                            width: "100%",
                            padding: "0.5rem",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                            background: "var(--input-bg)",
                            color: "var(--text-primary)"
                        }}
                    />
                </div>
                <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
                        Session ID
                    </label>
                    <input
                        type="text"
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        disabled={isRecording}
                        style={{
                            width: "100%",
                            padding: "0.5rem",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                            background: "var(--input-bg)",
                            color: "var(--text-primary)"
                        }}
                    />
                </div>
            </div>

            {/* Calibration */}
            <div style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--bg-secondary)", borderRadius: "8px" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                    Calibration {calibration ? "✓" : "(Not calibrated)"}
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                        onClick={() => startCalibration('baseline')}
                        disabled={isRecording || isCalibrating !== null}
                        style={{
                            flex: 1,
                            padding: "0.5rem",
                            borderRadius: "8px",
                            background: isCalibrating === 'baseline' ? "#3b82f6" : "var(--accent-primary)",
                            color: "white",
                            border: "none",
                            fontWeight: 600,
                            cursor: isRecording || isCalibrating !== null ? "not-allowed" : "pointer",
                            fontSize: "0.85rem"
                        }}
                    >
                        {isCalibrating === 'baseline' ? "Calibrating..." : "Baseline (straight)"}
                    </button>
                    <button
                        onClick={() => startCalibration('maxbend')}
                        disabled={isRecording || isCalibrating !== null}
                        style={{
                            flex: 1,
                            padding: "0.5rem",
                            borderRadius: "8px",
                            background: isCalibrating === 'maxbend' ? "#3b82f6" : "var(--accent-secondary)",
                            color: "white",
                            border: "none",
                            fontWeight: 600,
                            cursor: isRecording || isCalibrating !== null ? "not-allowed" : "pointer",
                            fontSize: "0.85rem"
                        }}
                    >
                        {isCalibrating === 'maxbend' ? "Calibrating..." : "Max Bend (fist)"}
                    </button>
                </div>
                {calibration && (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                        Baseline: [{calibration.baseline.join(', ')}]<br/>
                        Max Bend: [{calibration.maxbend.join(', ')}]
                    </div>
                )}
            </div>

            {/* Gesture Selection & Recording */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
                <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
                        Gesture to Record
                    </label>
                    <select
                        value={selectedGesture}
                        onChange={(e) => setSelectedGesture(e.target.value)}
                        disabled={isRecording}
                        style={{
                            width: "100%",
                            padding: "0.5rem",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                            background: "var(--input-bg)",
                            color: "var(--text-primary)"
                        }}
                    >
                        {gestures.map(g => (
                            <option key={g} value={g}>{g}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.25rem" }}>
                        Samples
                    </label>
                    <div style={{
                        padding: "0.5rem",
                        borderRadius: "8px",
                        background: "var(--input-bg)",
                        border: "1px solid var(--border-color)",
                        textAlign: "center",
                        fontWeight: 600,
                        color: "var(--text-primary)"
                    }}>
                        {recordedSamples}
                    </div>
                </div>
            </div>

            {/* Record Button */}
            <button
                onClick={isRecording ? stopRecording : startRecording}
                style={{
                    width: "100%",
                    padding: "0.75rem",
                    borderRadius: "8px",
                    background: isRecording
                        ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
                        : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                    color: "white",
                    border: "none",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: "1rem"
                }}
            >
                {isRecording ? "⏹ Stop Recording" : "⏺ Start Recording"}
            </button>

            <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--text-secondary)", textAlign: "center" }}>
                {isRecording ? "Recording... Perform the gesture now!" : "Tip: Hold gesture steady for 2-3 seconds while recording"}
            </div>
        </div>
    );
}



