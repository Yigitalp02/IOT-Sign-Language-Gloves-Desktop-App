import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useTranslation } from "react-i18next";

interface SimulatorControlProps {
    sensorBuffer: Array<{
        timestamp: number;
        ch0: number;
        ch1: number;
        ch2: number;
        ch3: number;
        ch4: number;
    }>;
    onClearBuffer?: () => void;
}

interface PredictionResult {
    letter: string;
    confidence: number;
    pattern: string;
    debug_log: string;
}

export default function SimulatorControl({ sensorBuffer, onClearBuffer }: SimulatorControlProps) {
    const { t } = useTranslation();
    const [isSimulatorRunning, setIsSimulatorRunning] = useState(false);
    const [currentGesture, setCurrentGesture] = useState<string | null>(null);
    const [prediction, setPrediction] = useState<PredictionResult | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [showDebugLog, setShowDebugLog] = useState(false);
    const [autoStopEnabled, setAutoStopEnabled] = useState(true);

    const aslLetters = ["A", "B", "C", "D", "E", "F", "I", "K", "O", "S", "T", "V", "W", "X", "Y"];

    // Auto-stop simulator when buffer is full (if enabled)
    useEffect(() => {
        const BUFFER_TARGET = 200;
        
        if (autoStopEnabled && isSimulatorRunning && sensorBuffer.length >= BUFFER_TARGET) {
            // Buffer is full, auto-stop simulator (but keep buffer data for prediction!)
            console.log(`Buffer full (${sensorBuffer.length}/${BUFFER_TARGET}), auto-stopping simulator...`);
            stopSimulator(false); // false = don't clear buffer
        }
    }, [sensorBuffer.length, isSimulatorRunning, autoStopEnabled]);

    const startSimulator = async (gesture: string) => {
        setErrorMessage("");
        setIsLoading(true);
        
        try {
            // IMPORTANT: Clear prediction display immediately when starting new gesture
            setPrediction(null);
            
            // Stop any existing simulator first
            if (isSimulatorRunning) {
                await invoke("stop_simulator");
                // Brief wait for serial port to close cleanly
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            // ALWAYS clear buffer when starting new gesture
            console.log(`Clearing buffer before starting '${gesture}' (buffer had ${sensorBuffer.length} samples)`);
            if (onClearBuffer) {
                onClearBuffer();
            }
            
            await invoke("start_simulator", { gesture });
            setIsSimulatorRunning(true);
            setCurrentGesture(gesture);
        } catch (error) {
            console.error("Failed to start simulator:", error);
            setErrorMessage(`Failed to start simulator: ${error}`);
        } finally {
            setIsLoading(false);
        }
    };

    const stopSimulator = async (clearBuffer: boolean = true) => {
        setErrorMessage("");
        setIsLoading(true);
        
        try {
            await invoke("stop_simulator");
            setIsSimulatorRunning(false);
            setCurrentGesture(null);
            
            // Only clear buffer if explicitly requested (not on auto-stop)
            if (clearBuffer && onClearBuffer) {
                onClearBuffer();
            }
        } catch (error) {
            console.error("Failed to stop simulator:", error);
            setErrorMessage(`Failed to stop simulator: ${error}`);
        } finally {
            setIsLoading(false);
        }
    };

    const runPrediction = async () => {
        if (sensorBuffer.length === 0) {
            setErrorMessage("No sensor data available. Connect to the simulator first!");
            return;
        }

        if (sensorBuffer.length < 100) {
            setErrorMessage(`Need at least 100 samples for prediction. Current: ${sensorBuffer.length}`);
            return;
        }

        setErrorMessage("");
        setIsLoading(true);

        try {
            // Use the last 200 samples (or all if less than 200)
            const samples = sensorBuffer.slice(-200);
            
            const result = await invoke<PredictionResult>("predict_gesture", { samples });
            setPrediction(result);
        } catch (error) {
            console.error("Failed to predict gesture:", error);
            setErrorMessage(`Prediction failed: ${error}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            background: "var(--bg-card)",
            padding: "1.5rem",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            marginBottom: "1.5rem"
        }}>
            <h3 style={{
                margin: "0 0 1rem 0",
                fontSize: "1.1rem",
                fontWeight: 600,
                color: "var(--text-primary)"
            }}>
                {t("simulator.title")}
            </h3>

            {/* Auto-Stop Toggle */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.75rem",
                borderRadius: "8px",
                background: "var(--bg-secondary)",
                marginBottom: "0.75rem",
                border: "1px solid var(--border-color)"
            }}>
                <div style={{ flex: 1 }}>
                    <div style={{
                        fontSize: "0.9rem",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        marginBottom: "0.25rem"
                    }}>
                        {t("simulator.auto_stop")}
                    </div>
                    <div style={{
                        fontSize: "0.75rem",
                        color: "var(--text-secondary)"
                    }}>
                        {autoStopEnabled 
                            ? t("simulator.auto_stop_on")
                            : t("simulator.auto_stop_off")}
                    </div>
                </div>
                <label style={{
                    position: "relative",
                    display: "inline-block",
                    width: "50px",
                    height: "24px",
                    cursor: "pointer"
                }}>
                    <input
                        type="checkbox"
                        checked={autoStopEnabled}
                        onChange={(e) => setAutoStopEnabled(e.target.checked)}
                        style={{
                            opacity: 0,
                            width: 0,
                            height: 0
                        }}
                    />
                    <span style={{
                        position: "absolute",
                        cursor: "pointer",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: autoStopEnabled ? "#10b981" : "#cbd5e1",
                        transition: "0.3s",
                        borderRadius: "24px"
                    }}>
                        <span style={{
                            position: "absolute",
                            content: "",
                            height: "18px",
                            width: "18px",
                            left: autoStopEnabled ? "28px" : "3px",
                            bottom: "3px",
                            backgroundColor: "white",
                            transition: "0.3s",
                            borderRadius: "50%"
                        }} />
                    </span>
                </label>
            </div>

            {/* Simulator Status */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem",
                borderRadius: "8px",
                background: "var(--bg-secondary)",
                marginBottom: "1rem"
            }}>
                <div style={{ flex: 1 }}>
                    <div style={{
                        fontSize: "0.85rem",
                        color: "var(--text-secondary)",
                        marginBottom: "0.25rem"
                    }}>
                        {t("simulator.status")}
                    </div>
                    <div style={{
                        fontWeight: 600,
                        color: isSimulatorRunning ? "#34d399" : "var(--text-secondary)"
                    }}>
                        {isSimulatorRunning 
                            ? `${t("simulator.running")} "${currentGesture}"` 
                            : t("simulator.stopped")}
                    </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem" }}>
                    {isSimulatorRunning && (
                        <button
                            onClick={() => stopSimulator()}
                            disabled={isLoading}
                            style={{
                                padding: "0.5rem 1rem",
                                borderRadius: "8px",
                                background: "rgba(239, 68, 68, 0.1)",
                                color: "#ef4444",
                                fontWeight: 600,
                                border: "1px solid #ef4444",
                                cursor: isLoading ? "not-allowed" : "pointer",
                                fontSize: "0.85rem"
                            }}
                        >
                            {t("buttons.stop")}
                        </button>
                    )}
                    
                    <button
                        onClick={async () => {
                            try {
                                await invoke<string>("kill_all_simulators");
                                setErrorMessage("Killed all Python simulators. Reconnect if needed.");
                                setIsSimulatorRunning(false);
                                setCurrentGesture(null);
                                if (onClearBuffer) onClearBuffer();
                            } catch (error) {
                                setErrorMessage(`Failed to kill simulators: ${error}`);
                            }
                        }}
                        disabled={isLoading}
                        title="Force kill all Python simulator processes"
                        style={{
                            padding: "0.5rem",
                            borderRadius: "8px",
                            background: "rgba(239, 68, 68, 0.2)",
                            color: "#ef4444",
                            fontWeight: 600,
                            border: "1px solid #ef4444",
                            cursor: isLoading ? "not-allowed" : "pointer",
                            fontSize: "0.75rem",
                            whiteSpace: "nowrap"
                        }}
                    >
                        {t("buttons.kill_all")}
                    </button>
                </div>
            </div>

            {/* ASL Letter Buttons */}
            <div style={{ marginBottom: "1rem" }}>
                <div style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: "0.5rem"
                }}>
                    {t("simulator.select_letter")}
                </div>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(60px, 1fr))",
                    gap: "0.5rem"
                }}>
                    {aslLetters.map((letter) => (
                        <button
                            key={letter}
                            onClick={() => startSimulator(letter)}
                            disabled={isSimulatorRunning || isLoading}
                            style={{
                                padding: "0.75rem",
                                borderRadius: "8px",
                                background: currentGesture === letter 
                                    ? "linear-gradient(135deg, #34d399 0%, #10b981 100%)"
                                    : "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)",
                                color: "white",
                                fontWeight: 700,
                                fontSize: "1.2rem",
                                border: "none",
                                cursor: (isSimulatorRunning || isLoading) ? "not-allowed" : "pointer",
                                opacity: (isSimulatorRunning && currentGesture !== letter) ? 0.5 : 1,
                                transition: "all 0.2s"
                            }}
                        >
                            {letter}
                        </button>
                    ))}
                </div>
            </div>

            {/* Predict Button */}
            <div style={{ marginBottom: "1rem" }}>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                        onClick={runPrediction}
                        disabled={isLoading || sensorBuffer.length < 100}
                        style={{
                            flex: 1,
                            padding: "0.75rem",
                            borderRadius: "8px",
                            background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
                            color: "white",
                            fontWeight: 600,
                            fontSize: "1rem",
                            border: "none",
                            cursor: (isLoading || sensorBuffer.length < 100) ? "not-allowed" : "pointer",
                            opacity: (isLoading || sensorBuffer.length < 100) ? 0.6 : 1
                        }}
                    >
                        {isLoading ? t("buttons.analyzing") : t("buttons.predict")}
                    </button>
                    <button
                        onClick={() => {
                            if (onClearBuffer) {
                                onClearBuffer();
                                setPrediction(null);
                                setErrorMessage("Buffer cleared! Start a new gesture.");
                            }
                        }}
                        disabled={isLoading || sensorBuffer.length === 0}
                        style={{
                            padding: "0.75rem",
                            borderRadius: "8px",
                            background: "rgba(239, 68, 68, 0.1)",
                            color: "#ef4444",
                            fontWeight: 600,
                            fontSize: "0.9rem",
                            border: "1px solid #ef4444",
                            cursor: (isLoading || sensorBuffer.length === 0) ? "not-allowed" : "pointer",
                            opacity: (isLoading || sensorBuffer.length === 0) ? 0.6 : 1,
                            whiteSpace: "nowrap"
                        }}
                        title="Clear buffer and start fresh"
                    >
                        {t("buttons.clear")}
                    </button>
                    
                    <button
                        onClick={async () => {
                            if (sensorBuffer.length === 0) {
                                setErrorMessage("No data to analyze!");
                                return;
                            }
                            setIsLoading(true);
                            try {
                                const result = await invoke<string>("debug_buffer", { samples: sensorBuffer });
                                setErrorMessage(result);  // Show analysis in error box
                            } catch (error) {
                                setErrorMessage(`Debug failed: ${error}`);
                            } finally {
                                setIsLoading(false);
                            }
                        }}
                        disabled={isLoading || sensorBuffer.length === 0}
                        style={{
                            padding: "0.75rem",
                            borderRadius: "8px",
                            background: "rgba(59, 130, 246, 0.1)",
                            color: "#3b82f6",
                            fontWeight: 600,
                            fontSize: "0.9rem",
                            border: "1px solid #3b82f6",
                            cursor: (isLoading || sensorBuffer.length === 0) ? "not-allowed" : "pointer",
                            opacity: (isLoading || sensorBuffer.length === 0) ? 0.6 : 1,
                            whiteSpace: "nowrap"
                        }}
                        title="Analyze buffer contents"
                    >
                        {t("buttons.debug")}
                    </button>
                </div>
                <div style={{
                    fontSize: "0.75rem",
                    color: sensorBuffer.length >= 100 ? "#34d399" : 
                           sensorBuffer.length >= 50 ? "#fbbf24" : "var(--text-secondary)",
                    marginTop: "0.5rem",
                    textAlign: "center",
                    fontWeight: sensorBuffer.length >= 100 ? 600 : 400
                }}>
                    {t("simulator.buffer")}: {sensorBuffer.length}{autoStopEnabled ? "/200" : ""} {t("simulator.samples")} 
                    {autoStopEnabled ? (
                        sensorBuffer.length < 100 ? ` (${t("simulator.need_more")}: ${100 - sensorBuffer.length})` : 
                        sensorBuffer.length < 200 ? ` (${t("simulator.collecting")})` : ` (${t("simulator.full")})`
                    ) : (
                        ` (${t("simulator.continuous")})`
                    )}
                </div>
                
                {/* Buffer Preview */}
                {sensorBuffer.length > 0 && (
                    <div style={{
                        marginTop: "0.5rem",
                        padding: "0.5rem",
                        borderRadius: "6px",
                        background: "var(--bg-secondary)",
                        fontSize: "0.65rem",
                        fontFamily: "monospace"
                    }}>
                        <div style={{ color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                            {t("simulator.latest_sample")} {sensorBuffer.length}):
                        </div>
                        <div style={{ color: "var(--text-primary)" }}>
                            {sensorBuffer.length > 0 && (() => {
                                const latest = sensorBuffer[sensorBuffer.length - 1];
                                return `CH0:${latest.ch0} CH1:${latest.ch1} CH2:${latest.ch2} CH3:${latest.ch3} CH4:${latest.ch4}`;
                            })()}
                        </div>
                    </div>
                )}
            </div>

            {/* Prediction Result */}
            {prediction && (
                <div style={{
                    padding: "1rem",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(124, 58, 237, 0.1) 100%)",
                    border: "2px solid #8b5cf6",
                    marginBottom: "0.5rem"
                }}>
                    <div style={{
                        fontSize: "0.85rem",
                        color: "var(--text-secondary)",
                        marginBottom: "0.5rem"
                    }}>
                        {t("simulator.prediction_result")}
                    </div>
                    <div style={{
                        fontSize: "2rem",
                        fontWeight: 700,
                        color: "#8b5cf6",
                        marginBottom: "0.5rem"
                    }}>
                        {t("simulator.asl_letter")} {prediction.letter}
                    </div>
                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.85rem"
                    }}>
                        <span style={{ color: "var(--text-secondary)" }}>
                            {t("simulator.confidence")}
                        </span>
                        <span style={{
                            fontWeight: 600,
                            color: prediction.confidence > 0.8 ? "#34d399" : "#fbbf24"
                        }}>
                            {(prediction.confidence * 100).toFixed(1)}%
                        </span>
                    </div>
                    <div style={{
                        fontSize: "0.75rem",
                        color: "var(--text-secondary)",
                        marginTop: "0.5rem"
                    }}>
                        {prediction.pattern}
                    </div>
                    
                    {/* Debug Log Toggle */}
                    <button
                        onClick={() => setShowDebugLog(!showDebugLog)}
                        style={{
                            marginTop: "0.75rem",
                            padding: "0.5rem",
                            width: "100%",
                            borderRadius: "6px",
                            background: "var(--bg-secondary)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-secondary)",
                            fontSize: "0.75rem",
                            cursor: "pointer"
                        }}
                    >
                        {showDebugLog ? "▼ Hide Debug Log" : "▶ Show Debug Log"}
                    </button>
                    
                    {/* Debug Log Content */}
                    {showDebugLog && (
                        <div style={{
                            marginTop: "0.5rem",
                            padding: "0.75rem",
                            borderRadius: "6px",
                            background: "#1a1a1a",
                            border: "1px solid #333",
                            fontSize: "0.7rem",
                            fontFamily: "monospace",
                            color: "#00ff00",
                            maxHeight: "300px",
                            overflowY: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all"
                        }}>
                            {prediction.debug_log}
                        </div>
                    )}
                </div>
            )}

            {/* Error Message */}
            {errorMessage && (
                <div style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                    fontSize: "0.85rem",
                    marginTop: "1rem"
                }}>
                    {errorMessage}
                </div>
            )}

        </div>
    );
}

