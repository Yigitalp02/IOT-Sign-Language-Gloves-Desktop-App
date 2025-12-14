import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";

interface SensorData {
    timestamp: number;
    ch0: number;
    ch1: number;
    ch2: number;
    ch3: number;
    ch4: number;
}

export default function ConnectionManager() {
    const { t } = useTranslation();
    const [ports, setPorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState<string>("");
    const [isConnected, setIsConnected] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [sensorData, setSensorData] = useState<SensorData | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>("");

    const scanPorts = async () => {
        setIsScanning(true);
        setErrorMessage("");
        try {
            const availablePorts = await invoke<string[]>("list_ports");
            setPorts(availablePorts);
            if (availablePorts.length > 0 && !selectedPort) {
                setSelectedPort(availablePorts[0]);
            }
        } catch (error) {
            console.error("Failed to list ports:", error);
            setErrorMessage(`Failed to scan ports: ${error}`);
        } finally {
            setIsScanning(false);
        }
    };

    useEffect(() => {
        scanPorts();

        // Listen for sensor data events from Rust
        const unlisten = listen<string>("sensor-data", (event) => {
            // Parse CSV: timestamp,ch0,ch1,ch2,ch3,ch4
            const parts = event.payload.split(',');
            if (parts.length === 6) {
                setSensorData({
                    timestamp: parseInt(parts[0]),
                    ch0: parseInt(parts[1]),
                    ch1: parseInt(parts[2]),
                    ch2: parseInt(parts[3]),
                    ch3: parseInt(parts[4]),
                    ch4: parseInt(parts[5]),
                });
            }
        });

        // Listen for serial errors
        const unlistenError = listen<string>("serial-error", (event) => {
            setErrorMessage(event.payload);
            setIsConnected(false);
        });

        return () => {
            unlisten.then(fn => fn());
            unlistenError.then(fn => fn());
        };
    }, []);

    const handleConnect = async () => {
        if (!selectedPort) return;

        if (isConnected) {
            // Disconnect
            try {
                await invoke("disconnect_serial");
                setIsConnected(false);
                setSensorData(null);
                setErrorMessage("");
            } catch (error) {
                console.error("Failed to disconnect:", error);
                setErrorMessage(`Failed to disconnect: ${error}`);
            }
        } else {
            // Connect
            try {
                await invoke("connect_serial", {
                    portName: selectedPort,
                    baudRate: 115200
                });
                setIsConnected(true);
                setErrorMessage("");
            } catch (error) {
                console.error("Failed to connect:", error);
                setErrorMessage(`Failed to connect: ${error}`);
                setIsConnected(false);
            }
        }
    };

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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)" }}>{t("connection.title")}</h3>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.85rem",
                    color: isConnected ? "#34d399" : "var(--text-secondary)"
                }}>
                    <div style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: isConnected ? "#34d399" : "var(--text-secondary)",
                        boxShadow: isConnected ? "0 0 8px #34d399" : "none"
                    }} />
                    {isConnected ? t("connection.connected") : t("connection.disconnected")}
                </div>
            </div>

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
                    {isScanning ? "..." : "↻"}
                </button>

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

            {errorMessage && (
                <div style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid #ef4444",
                    color: "#ef4444",
                    fontSize: "0.85rem"
                }}>
                    {errorMessage}
                </div>
            )}

            {isConnected && sensorData && (
                <div style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-color)"
                }}>
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: "0.5rem",
                        fontSize: "0.75rem"
                    }}>
                        {[0, 1, 2, 3, 4].map(i => (
                            <div key={i} style={{ textAlign: "center" }}>
                                <div style={{ color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                                    CH{i}
                                </div>
                                <div style={{
                                    padding: "0.5rem",
                                    borderRadius: "6px",
                                    background: "var(--input-bg)",
                                    color: "var(--text-primary)",
                                    fontWeight: 600,
                                    fontFamily: "monospace"
                                }}>
                                    {sensorData[`ch${i}` as keyof SensorData]}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={{
                        marginTop: "0.5rem",
                        fontSize: "0.7rem",
                        color: "var(--text-secondary)",
                        textAlign: "center"
                    }}>
                        Last update: {sensorData.timestamp}ms
                    </div>
                </div>
            )}
        </div>
    );
}
