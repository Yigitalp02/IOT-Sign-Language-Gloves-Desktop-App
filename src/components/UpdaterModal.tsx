import { useEffect, useState } from "react";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";
import "./UpdaterModal.css";

interface UpdateInfo {
  version: string;
  body: string | null | undefined;
}

export default function UpdaterModal() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    // Only check in production (skip in tauri dev where pubkey is placeholder)
    if (!window.__TAURI__) return;

    const run = async () => {
      try {
        const result = await checkUpdate();
        if (result.shouldUpdate && result.manifest) {
          setUpdate({
            version: result.manifest.version,
            body: result.manifest.body,
          });
        }
      } catch {
        // Silently ignore — updater unavailable in dev or no network
      }
    };

    // Delay slightly so the main UI loads first
    const t = setTimeout(run, 3000);
    return () => clearTimeout(t);
  }, []);

  if (!update) return null;

  const handleInstall = async () => {
    setPhase("downloading");
    try {
      await installUpdate();
      setPhase("done");
      // Give the user a moment to see the "done" state, then relaunch
      setTimeout(() => relaunch(), 1500);
    } catch (e: unknown) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDismiss = () => setUpdate(null);

  return (
    <div className="updater-backdrop">
      <div className="updater-modal">
        <div className="updater-icon">⬆️</div>
        <h2 className="updater-title">Update Available</h2>
        <p className="updater-version">
          Version <strong>{update.version}</strong> is ready to install.
        </p>

        {update.body && (
          <div className="updater-notes">
            <p className="updater-notes-label">Release notes</p>
            <pre className="updater-notes-body">{update.body}</pre>
          </div>
        )}

        {phase === "idle" && (
          <div className="updater-actions">
            <button className="updater-btn updater-btn-primary" onClick={handleInstall}>
              Update Now
            </button>
            <button className="updater-btn updater-btn-secondary" onClick={handleDismiss}>
              Later
            </button>
          </div>
        )}

        {phase === "downloading" && (
          <div className="updater-progress">
            <div className="updater-spinner" />
            <span>Downloading update…</span>
          </div>
        )}

        {phase === "done" && (
          <div className="updater-progress">
            <span className="updater-done-icon">✓</span>
            <span>Installed — relaunching…</span>
          </div>
        )}

        {phase === "error" && (
          <div className="updater-error">
            <p>Update failed: {errorMsg}</p>
            <button className="updater-btn updater-btn-secondary" onClick={handleDismiss}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
