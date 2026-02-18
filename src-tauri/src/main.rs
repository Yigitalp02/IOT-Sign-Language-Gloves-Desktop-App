// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::thread;
use serialport::SerialPort;

/// Text-to-Speech command that uses OS-native TTS engines
/// 
/// # Arguments
/// * `text` - The text to be spoken
/// * `lang` - Optional language code (e.g., "tr-TR", "en-US")
/// 
/// # Platform-specific implementations
/// - Windows: PowerShell + SAPI (System.Speech.Synthesis)
/// - macOS: `say` command with voice selection
/// - Linux: `spd-say` (Speech Dispatcher)
#[tauri::command]
fn tts_say(text: String, lang: Option<String>) -> Result<(), String> {
    // Validate input
    if text.trim().is_empty() {
        return Err("Text cannot be empty".to_string());
    }

    // Sanitize text to prevent command injection
    let sanitized_text = text.replace("\"", "\\\"").replace("`", "");

    let lang_code = lang.unwrap_or_else(|| "en-US".to_string());

    #[cfg(target_os = "windows")]
    {
        tts_say_windows(&sanitized_text, &lang_code)
    }

    #[cfg(target_os = "macos")]
    {
        tts_say_macos(&sanitized_text, &lang_code)
    }

    #[cfg(target_os = "linux")]
    {
        tts_say_linux(&sanitized_text, &lang_code)
    }
}

#[cfg(target_os = "windows")]
fn tts_say_windows(text: &str, lang: &str) -> Result<(), String> {
    println!("Attempting TTS for lang: {}", lang);
    // Try SAPI first (older, standard voices)
    match tts_say_windows_sapi(text, lang) {
        Ok(_) => {
            println!("SAPI TTS succeeded");
            Ok(())
        },
        Err(e) => {
            // If SAPI fails (likely voice not found), try OneCore (modern voices)
            println!("SAPI failed: {}. Trying OneCore...", e);
            match tts_say_windows_onecore(text, lang) {
                Ok(_) => {
                    println!("OneCore TTS succeeded");
                    Ok(())
                },
                Err(e) => {
                    println!("OneCore TTS failed: {}", e);
                    Err(e)
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn tts_say_windows_sapi(text: &str, lang: &str) -> Result<(), String> {
    // Map language codes to Windows SAPI culture codes
    let culture_code = match lang {
        "tr-TR" | "tr" => "tr-TR",
        "en-US" | "en" => "en-US",
        "en-GB" => "en-GB",
        _ => "en-US", // Default fallback
    };

    // PowerShell script to use SAPI for TTS
    let ps_script = format!(
        r#"
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        
        # Try to select a voice for the specified culture
        $voice = $synth.GetInstalledVoices() | Where-Object {{
            $_.VoiceInfo.Culture.Name -eq '{}'
        }} | Select-Object -First 1
        
        if ($voice) {{
            $synth.SelectVoice($voice.VoiceInfo.Name)
            $synth.Speak('{}')
        }} else {{
            Write-Error "Voice not found"
            exit 1
        }}
        $synth.Dispose()
        "#,
        culture_code,
        text.replace("'", "''") // Escape single quotes for PowerShell
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to execute PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SAPI TTS failed: {}", stderr));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn tts_say_windows_onecore(text: &str, lang: &str) -> Result<(), String> {
    // Map language codes to Windows OneCore language codes
    let lang_code = match lang {
        "tr-TR" | "tr" => "tr-TR",
        "en-US" | "en" => "en-US",
        "en-GB" => "en-GB",
        _ => "en-US", // Default fallback
    };

    // PowerShell script to use WinRT (OneCore) for TTS
    // Note: This requires Windows 10/11
    let ps_script = format!(
        r#"
        $text = '{}'
        $lang = '{}'

        try {{
            # Load WinRT types
            [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime] > $null
            
            $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer

            # Find voice
            $voice = $synth.AllVoices | Where-Object {{ $_.Language -eq $lang }} | Select-Object -First 1
            if ($null -eq $voice) {{
                Write-Error "Voice for language '$lang' not found in OneCore voices."
                exit 1
            }}
            $synth.Voice = $voice

            # Synthesize
            $stream = $synth.SynthesizeTextToStreamAsync($text).GetAwaiter().GetResult()

            # Save to temp file
            $tempFile = [System.IO.Path]::GetTempFileName() + ".wav"
            $fileStream = [System.IO.File]::Create($tempFile)
            $dataReader = [Windows.Storage.Streams.DataReader]::FromBuffer($stream.GetInputStreamAt(0).ReadAsync($stream.Size).GetAwaiter().GetResult())
            $bytes = New-Object byte[] $stream.Size
            $dataReader.ReadBytes($bytes)
            $fileStream.Write($bytes, 0, $bytes.Length)
            $fileStream.Close()

            # Play
            $player = New-Object System.Media.SoundPlayer($tempFile)
            $player.PlaySync()
            $player.Dispose()

            # Cleanup
            Remove-Item $tempFile
        }} catch {{
            Write-Error $_.Exception.Message
            exit 1
        }}
        "#,
        text.replace("'", "''"), // Escape single quotes for PowerShell
        lang_code
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("Failed to execute PowerShell: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("OneCore TTS failed: {}", stderr));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn tts_say_macos(text: &str, lang: &str) -> Result<(), String> {
    // Map language codes to macOS voice names
    let voice = match lang {
        "tr-TR" | "tr" => "Yelda", // Turkish voice (if installed)
        "en-US" | "en" => "Samantha", // US English voice
        "en-GB" => "Daniel", // British English voice
        _ => "Samantha", // Default fallback
    };

    let output = Command::new("say")
        .args(["-v", voice, text])
        .output()
        .map_err(|e| format!("Failed to execute 'say' command: {}", e))?;

    if !output.status.success() {
        // If the specified voice doesn't exist, try without voice parameter
        let fallback_output = Command::new("say")
            .arg(text)
            .output()
            .map_err(|e| format!("Failed to execute 'say' command (fallback): {}", e))?;

        if !fallback_output.status.success() {
            let stderr = String::from_utf8_lossy(&fallback_output.stderr);
            return Err(format!("macOS TTS failed: {}", stderr));
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn tts_say_linux(text: &str, lang: &str) -> Result<(), String> {
    // Map language codes to Speech Dispatcher language codes
    let lang_code = match lang {
        "tr-TR" | "tr" => "tr",
        "en-US" | "en" | "en-GB" => "en",
        _ => "en", // Default fallback
    };

    let output = Command::new("spd-say")
        .args(["-l", lang_code, text])
        .output()
        .map_err(|e| format!("Failed to execute 'spd-say': {}. Make sure speech-dispatcher is installed.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Linux TTS failed: {}", stderr));
    }

    Ok(())
}



#[tauri::command]
fn list_ports() -> Result<Vec<String>, String> {
    match serialport::available_ports() {
        Ok(ports) => {
            Ok(ports.into_iter().map(|p| p.port_name).collect())
        }
        Err(e) => Err(format!("Failed to list ports: {}", e)),
    }
}

// Global state for serial port connection
type SerialPortState = Arc<Mutex<Option<Box<dyn SerialPort>>>>;
type ReadingActiveState = Arc<Mutex<bool>>;

#[tauri::command]
fn connect_serial(
    port_name: String,
    state: tauri::State<SerialPortState>,
) -> Result<String, String> {
    let mut port_lock = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    
    // Close existing connection if any
    *port_lock = None;
    
    // Open the serial port
    let port = serialport::new(&port_name, 115200)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Failed to open port {}: {}", port_name, e))?;
    
    *port_lock = Some(port);
    
    Ok(format!("Connected to {}", port_name))
}

#[tauri::command]
fn disconnect_serial(
    state: tauri::State<SerialPortState>,
    reading_state: tauri::State<ReadingActiveState>,
) -> Result<String, String> {
    let mut reading_lock = reading_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *reading_lock = false; // Stop reading
    
    let mut port_lock = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *port_lock = None;
    Ok("Disconnected".to_string())
}

#[tauri::command]
fn stop_reading_serial(reading_state: tauri::State<ReadingActiveState>) -> Result<String, String> {
    let mut reading_lock = reading_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *reading_lock = false;
    Ok("Reading stopped".to_string())
}

#[tauri::command]
fn resume_reading_serial(reading_state: tauri::State<ReadingActiveState>) -> Result<String, String> {
    let mut reading_lock = reading_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *reading_lock = true;
    Ok("Reading resumed".to_string())
}

#[tauri::command]
fn start_reading_serial(
    window: tauri::Window,
    state: tauri::State<SerialPortState>,
    reading_state: tauri::State<ReadingActiveState>,
) -> Result<(), String> {
    let port_lock = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    
    if port_lock.is_none() {
        return Err("No serial port connected".to_string());
    }
    
    // Set reading to active
    {
        let mut reading_lock = reading_state.lock().map_err(|e| format!("Lock error: {}", e))?;
        *reading_lock = true;
    }
    
    drop(port_lock); // Release lock before spawning thread
    
    let state_clone = state.inner().clone();
    let reading_state_clone = reading_state.inner().clone();
    
    thread::spawn(move || {
        let mut buffer = String::new();
        
        loop {
            // Check if reading is active
            let is_reading = {
                match reading_state_clone.lock() {
                    Ok(lock) => *lock,
                    Err(_) => break,
                }
            };
            
            if !is_reading {
                thread::sleep(Duration::from_millis(100)); // Wait while paused
                continue;
            }
            
            // Try to get the port
            let mut port_lock = match state_clone.lock() {
                Ok(lock) => lock,
                Err(_) => break,
            };
            
            if port_lock.is_none() {
                break; // Connection closed
            }
            
            // Read from serial port
            let mut serial_buf: Vec<u8> = vec![0; 128];
            match port_lock.as_mut().unwrap().read(&mut serial_buf) {
                Ok(bytes_read) => {
                    if bytes_read > 0 {
                        let data = String::from_utf8_lossy(&serial_buf[0..bytes_read]);
                        buffer.push_str(&data);
                        
                        // Process complete lines (ending with \n)
                        while let Some(newline_pos) = buffer.find('\n') {
                            let line = buffer[..newline_pos].trim().to_string();
                            buffer = buffer[newline_pos + 1..].to_string();
                            
                            // Parse the line as sensor data
                            // Expected format: "440,612,618,548,528" (5 comma-separated values)
                            let values: Vec<&str> = line.split(',').collect();
                            if values.len() == 5 {
                                let parsed: Vec<i32> = values
                                    .iter()
                                    .filter_map(|s| s.trim().parse::<i32>().ok())
                                    .collect();
                                
                                if parsed.len() == 5 {
                                    // Send to frontend
                                    let _ = window.emit("serial-data", parsed);
                                }
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // Timeout is normal, continue reading
                }
                Err(e) => {
                    eprintln!("Serial read error: {}", e);
                    break;
                }
            }
            
            drop(port_lock); // Release lock
            thread::sleep(Duration::from_millis(10)); // Small delay
        }
        
        println!("Serial reading thread stopped");
    });
    
    Ok(())
}

fn main() {
    let serial_state: SerialPortState = Arc::new(Mutex::new(None));
    let reading_active: ReadingActiveState = Arc::new(Mutex::new(false));
    
    tauri::Builder::default()
        .manage(serial_state)
        .manage(reading_active)
        .invoke_handler(tauri::generate_handler![
            tts_say,
            list_ports,
            connect_serial,
            disconnect_serial,
            start_reading_serial,
            stop_reading_serial,
            resume_reading_serial
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

