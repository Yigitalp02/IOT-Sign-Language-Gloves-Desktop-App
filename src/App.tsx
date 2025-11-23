import { useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import "./App.css";

function App() {
  const [text, setText] = useState(
    "Hello professor, text-to-speech demo is ready."
  );
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const handleSpeak = async (language: "tr-TR" | "en-US") => {
    if (!text.trim()) {
      setStatusMessage("Error: Please enter some text to speak.");
      return;
    }

    setIsLoading(true);
    setStatusMessage(`Speaking in ${language === "tr-TR" ? "Turkish" : "English"}...`);

    try {
      await invoke("tts_say", { text: text.trim(), lang: language });
      setStatusMessage(`Successfully spoke in ${language === "tr-TR" ? "Turkish" : "English"}`);
    } catch (error) {
      console.error("TTS Error:", error);
      setStatusMessage(`Error: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>IoT Sign Language</h1>
        <p className="subtitle">Text-to-Speech Demo</p>
      </div>

      <div className="content">
        <div className="text-input-section">
          <label htmlFor="text-input" className="label">
            Enter text to speak:
          </label>
          <textarea
            id="text-input"
            className="text-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type something to be spoken..."
            rows={6}
            disabled={isLoading}
          />
        </div>

        <div className="button-group">
          <button
            className="btn btn-primary"
            onClick={() => handleSpeak("tr-TR")}
            disabled={isLoading}
          >
            Speak (Turkish)
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleSpeak("en-US")}
            disabled={isLoading}
          >
            Speak (English)
          </button>
        </div>

        {statusMessage && (
          <div className={`status-message ${isLoading ? "loading" : ""}`}>
            {statusMessage}
          </div>
        )}
      </div>

      <div className="footer">
        <p className="info-text">
          This demo uses your operating system's native text-to-speech engine.
          No internet connection required.
        </p>
        <p className="version">Version 0.1.0 | Computer Science Graduation Project</p>
      </div>
    </div>
  );
}

export default App;

