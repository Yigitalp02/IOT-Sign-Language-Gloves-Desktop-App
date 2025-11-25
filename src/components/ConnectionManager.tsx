import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useTranslation } from "react-i18next";

export default function ConnectionManager() {
    const { t } = useTranslation();
    const [ports, setPorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState<string>("");
    const [isConnected, setIsConnected] = useState(false);
    const [isScanning, setIsScanning] = useState(false);

    const scanPorts = async () => {
        setIsScanning(true);
        try {
            const availablePorts = await invoke<string[]>("list_ports");
            setPorts(availablePorts);
            if (availablePorts.length > 0 && !selectedPort) {
                setSelectedPort(availablePorts[0]);
            }
        } catch (error) {
            console.error("Failed to list ports:", error);
        } finally {
            setIsScanning(false);
        }
    };

    useEffect(() => {
        scanPorts();
    }, []);

    const handleConnect = () => {
        if (!selectedPort) return;
        // Placeholder for actual connection logic
        setIsConnected(!isConnected);
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
                    ↻
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
        </div>
    );
}
