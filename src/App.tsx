import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import ConnectionManager from "./components/ConnectionManager";
import { useTheme } from "./context/ThemeContext";
import "./App.css";

function App() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [text, setText] = useState(
    "Hello professor, text-to-speech demo is ready."
  );
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);
      console.log("Loaded voices:", availableVoices.map(v => v.name));
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const handleSpeak = async (language: "tr-TR" | "en-US") => {
    if (!text.trim()) {
      setStatusMessage(t("status.error_empty"));
      return;
    }

    setIsLoading(true);
    setStatusMessage(language === "tr-TR" ? t("status.speaking_tr") : t("status.speaking_en"));

    try {
      const utterance = new SpeechSynthesisUtterance(text.trim());

      // Find appropriate voice from state
      const voice = voices.find(v => v.lang === language || v.lang.replace('_', '-') === language);

      if (voice) {
        utterance.voice = voice;
      } else {
        console.warn(`Voice for ${language} not found, using default.`);
        // Try to find any voice starting with the language code (e.g. "tr")
        const fallbackVoice = voices.find(v => v.lang.startsWith(language.split('-')[0]));
        if (fallbackVoice) {
          utterance.voice = fallbackVoice;
        }
      }

      utterance.onend = () => {
        setIsLoading(false);
        setStatusMessage(language === "tr-TR" ? t("status.success_tr") : t("status.success_en"));
      };

      utterance.onerror = (e) => {
        console.error("TTS Error:", e);
        setIsLoading(false);
        setStatusMessage(`Error: ${e.error}`);
      };

      window.speechSynthesis.speak(utterance);

    } catch (error) {
      console.error("TTS Error:", error);
      setStatusMessage(`Error: ${error}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>{t("app.title")}</h1>
        <p className="subtitle">{t("app.subtitle")}</p>

        <div style={{ display: "flex", justifyContent: "center", gap: "1rem", marginTop: "1rem" }}>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            style={{
              padding: "0.5rem",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              background: "var(--input-bg)",
              color: "var(--text-primary)"
            }}
          >
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>

          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
            style={{
              padding: "0.5rem",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              background: "var(--input-bg)",
              color: "var(--text-primary)"
            }}
          >
            <option value="light">{t("settings.light")}</option>
            <option value="dark">{t("settings.dark")}</option>
            <option value="system">{t("settings.system")}</option>
          </select>
        </div>
      </div>

      <div className="content">
        <ConnectionManager />

        <div className="text-input-section">
          <label htmlFor="text-input" className="label">
            {t("input.label")}
          </label>
          <textarea
            id="text-input"
            className="text-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("input.placeholder")}
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
            {t("buttons.speak_tr")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleSpeak("en-US")}
            disabled={isLoading}
          >
            {t("buttons.speak_en")}
          </button>
        </div>

        {statusMessage && (
          <div className={`status-message ${isLoading ? "loading" : ""} ${statusMessage.startsWith("Error") ? "error" : ""}`}>
            {statusMessage}
          </div>
        )}
      </div>

      <div className="footer">
        <p className="info-text">
          {t("app.footer")}
        </p>
        <p className="version">{t("app.version")}</p>
      </div>
    </div>
  );
}

export default App;
