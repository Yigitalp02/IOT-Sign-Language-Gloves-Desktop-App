import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";

export interface ImuData {
    w: number;
    x: number;
    y: number;
    z: number;
}

interface ConnectionManagerProps {
    onSensorData?: (data: number[]) => void;
    onImuData?: (data: ImuData) => void;
    onConnectionChange?: (connected: boolean) => void;
}

const WIFI_HOST = "192.168.4.1";
const WIFI_PORT = 3333;

export default function ConnectionManager({ onSensorData, onImuData, onConnectionChange }: ConnectionManagerProps) {
    const { t } = useTranslation();
    const [ports, setPorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState<string>("");
    const [isConnected, setIsConnected] = useState(false);
    const [isReading, setIsReading] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState<string>("");
    const [mode, setMode] = useState<"serial" | "wifi">("serial");
    const [isWifiConnected, setIsWifiConnected] = useState(false);
    const [isWifiConnecting, setIsWifiConnecting] = useState(false);
    
    // Use refs to avoid re-registering event listeners on every render
    const onSensorDataRef = useRef(onSensorData);
    const onImuDataRef = useRef(onImuData);
    useEffect(() => {
        onSensorDataRef.current = onSensorData;
    }, [onSensorData]);
    useEffect(() => {
        onImuDataRef.current = onImuData;
    }, [onImuData]);

    const scanPorts = async () => {
        setIsScanning(true);
        setError("");
        try {
            const availablePorts = await invoke<string[]>("list_ports");
            setPorts(availablePorts);
            if (availablePorts.length > 0 && !selectedPort) {
                setSelectedPort(availablePorts[0]);
            }
        } catch (error) {
            console.error("Failed to list ports:", error);
            setError("Failed to scan ports");
        } finally {
            setIsScanning(false);
        }
    };

    useEffect(() => {
        scanPorts();
        
        // Listen for thermistor data events
        const unlistenSensor = listen<number[]>("serial-data", (event) => {
            if (onSensorDataRef.current) {
                onSensorDataRef.current(event.payload);
            }
        });

        // Listen for IMU quaternion events (only emitted when BNO055 is present)
        const unlistenImu = listen<ImuData>("serial-imu", (event) => {
            if (onImuDataRef.current) {
                onImuDataRef.current(event.payload);
            }
        });
        
        return () => {
            unlistenSensor.then(f => f());
            unlistenImu.then(f => f());
        };
    }, []); // Empty deps - only register once

    const handleConnect = async () => {
        if (!selectedPort) return;
        
        setError("");
        
        if (isConnected) {
            // Disconnect
            try {
                await invoke("disconnect_serial");
                setIsConnected(false);
                setIsReading(false);
                if (onConnectionChange) {
                    onConnectionChange(false);
                }
            } catch (error) {
                console.error("Failed to disconnect:", error);
                setError(`Disconnect failed: ${error}`);
            }
        } else {
            // Connect
            try {
                await invoke("connect_serial", { portName: selectedPort });
                await invoke("start_reading_serial");
                setIsConnected(true);
                setIsReading(true);
                if (onConnectionChange) {
                    onConnectionChange(true);
                }
            } catch (error) {
                console.error("Failed to connect:", error);
                setError(`Connection failed: ${error}`);
            }
        }
    };

    const handleToggleReading = async () => {
        setError("");
        
        try {
            if (isReading) {
                await invoke("stop_reading_serial");
                setIsReading(false);
            } else {
                await invoke("resume_reading_serial");
                setIsReading(true);
            }
        } catch (error) {
            console.error("Failed to toggle reading:", error);
            setError(`Toggle failed: ${error}`);
        }
    };

    const handleWifiConnect = async () => {
        setError("");
        if (isWifiConnected) {
            try {
                await invoke("disconnect_wifi");
                setIsWifiConnected(false);
                if (onConnectionChange) onConnectionChange(false);
            } catch (err) {
                setError(`WiFi disconnect failed: ${err}`);
            }
        } else {
            setIsWifiConnecting(true);
            try {
                await invoke("connect_wifi", { host: WIFI_HOST, port: WIFI_PORT });
                setIsWifiConnected(true);
                if (onConnectionChange) onConnectionChange(true);
            } catch (err) {
                setError(`WiFi connect failed: ${err}`);
            } finally {
                setIsWifiConnecting(false);
            }
        }
    };

    const anyConnected = isConnected || isWifiConnected;

    return (
        <div className="connection-manager" style={{
            background: "var(--bg-card)",
            padding: "1rem",
            borderRadius: "12px",
            border: "1px solid var(--border-color)",
            marginBottom: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem"
        }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    {t("connection.title")}
                </h3>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.85rem",
                    color: anyConnected ? "#34d399" : "var(--text-secondary)"
                }}>
                    <div style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: anyConnected ? "#34d399" : "var(--text-secondary)",
                        boxShadow: anyConnected ? "0 0 8px #34d399" : "none"
                    }} />
                    {anyConnected ? t("connection.connected") : t("connection.disconnected")}
                </div>
            </div>

            {/* Mode tabs */}
            <div style={{ display: "flex", gap: "0.25rem", background: "var(--bg-secondary)", borderRadius: "8px", padding: "3px" }}>
                {(["serial", "wifi"] as const).map(m => (
                    <button
                        key={m}
                        onClick={() => setMode(m)}
                        disabled={anyConnected}
                        style={{
                            flex: 1,
                            padding: "0.35rem 0",
                            borderRadius: "6px",
                            border: "none",
                            fontWeight: 600,
                            fontSize: "0.8rem",
                            cursor: anyConnected ? "not-allowed" : "pointer",
                            background: mode === m ? "var(--bg-card)" : "transparent",
                            color: mode === m ? "var(--text-primary)" : "var(--text-secondary)",
                            boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                            transition: "all 0.15s"
                        }}
                    >
                        {m === "serial" ? "USB Serial" : "WiFi (AP)"}
                    </button>
                ))}
            </div>

            {error && (
                <div style={{
                    padding: "0.5rem",
                    borderRadius: "6px",
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                    fontSize: "0.85rem"
                }}>
                    {error}
                </div>
            )}

            {/* Serial panel */}
            {mode === "serial" && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                    <select
                        value={selectedPort}
                        onChange={(e) => setSelectedPort(e.target.value)}
                        disabled={isConnected || isScanning}
                        style={{
                            flex: 1,
                            padding: "0.5rem",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                            background: "var(--input-bg)",
                            color: "var(--text-primary)",
                            outline: "none"
                        }}
                    >
                        {ports.length === 0 ? (
                            <option value="">{t("connection.no_ports")}</option>
                        ) : (
                            ports.map(port => (
                                <option key={port} value={port}>{port}</option>
                            ))
                        )}
                    </select>

                    <button
                        onClick={scanPorts}
                        disabled={isConnected || isScanning}
                        style={{
                            padding: "0.5rem",
                            borderRadius: "8px",
                            border: "1px solid var(--border-color)",
                            background: "var(--bg-secondary)",
                            color: "var(--text-primary)",
                            cursor: isConnected || isScanning ? "not-allowed" : "pointer"
                        }}
                        title={t("buttons.scan")}
                    >
                        ↻
                    </button>

                    {isConnected && (
                        <button
                            onClick={handleToggleReading}
                            style={{
                                padding: "0.5rem 1rem",
                                borderRadius: "8px",
                                background: isReading ? "rgba(251, 146, 60, 0.1)" : "rgba(16, 185, 129, 0.1)",
                                color: isReading ? "#fb923c" : "#10b981",
                                fontWeight: 600,
                                cursor: "pointer",
                                border: isReading ? "1px solid #fb923c" : "1px solid #10b981"
                            }}
                        >
                            {isReading ? "⏸ Pause" : "▶ Resume"}
                        </button>
                    )}

                    <button
                        onClick={handleConnect}
                        disabled={!selectedPort}
                        style={{
                            padding: "0.5rem 1rem",
                            borderRadius: "8px",
                            background: isConnected
                                ? "rgba(239, 68, 68, 0.1)"
                                : "linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)",
                            color: isConnected ? "#ef4444" : "var(--accent-text)",
                            fontWeight: 600,
                            cursor: !selectedPort ? "not-allowed" : "pointer",
                            border: isConnected ? "1px solid #ef4444" : "none"
                        }}
                    >
                        {isConnected ? t("buttons.disconnect") : t("buttons.connect")}
                    </button>
                </div>
            )}

            {/* WiFi panel */}
            {mode === "wifi" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    <div style={{
                        padding: "0.6rem 0.75rem",
                        borderRadius: "8px",
                        background: "rgba(59, 130, 246, 0.08)",
                        border: "1px solid rgba(59, 130, 246, 0.3)",
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.5
                    }}>
                        <strong style={{ color: "var(--text-primary)" }}>How to use WiFi:</strong><br />
                        1. Flash the new sketch to the ESP32<br />
                        2. On your laptop, connect to Wi-Fi network <code style={{ background: "rgba(255,255,255,0.1)", padding: "0 4px", borderRadius: 3 }}>GloveASL-WiFi</code> (password: <code style={{ background: "rgba(255,255,255,0.1)", padding: "0 4px", borderRadius: 3 }}>glove1234</code>)<br />
                        3. Click Connect below — the app will reach ESP32 at <code style={{ background: "rgba(255,255,255,0.1)", padding: "0 4px", borderRadius: 3 }}>192.168.4.1:3333</code>
                    </div>
                    <button
                        onClick={handleWifiConnect}
                        disabled={isWifiConnecting}
                        style={{
                            padding: "0.6rem 1rem",
                            borderRadius: "8px",
                            background: isWifiConnected
                                ? "rgba(239, 68, 68, 0.1)"
                                : "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
                            color: isWifiConnected ? "#ef4444" : "#fff",
                            fontWeight: 600,
                            cursor: isWifiConnecting ? "wait" : "pointer",
                            border: isWifiConnected ? "1px solid #ef4444" : "none",
                            opacity: isWifiConnecting ? 0.7 : 1
                        }}
                    >
                        {isWifiConnecting ? "Connecting…" : isWifiConnected ? "Disconnect WiFi" : "Connect via WiFi"}
                    </button>
                </div>
            )}
        </div>
    );
}
