// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use serialport::{available_ports, SerialPortType};
use tauri::{Manager, State};
use serde::{Deserialize, Serialize};

// Global state for serial connection
struct SerialState {
    port: Arc<Mutex<Option<Box<dyn serialport::SerialPort>>>>,
    is_connected: Arc<Mutex<bool>>,
}

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
        }}
        
        $synth.Speak('{}')
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
        return Err(format!("PowerShell TTS failed: {}", stderr));
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

/// List all available serial ports
#[tauri::command]
fn list_ports() -> Result<Vec<String>, String> {
    let ports = available_ports()
        .map_err(|e| format!("Failed to list ports: {}", e))?;
    
    Ok(ports.iter()
        .map(|p| {
            match &p.port_type {
                SerialPortType::UsbPort(info) => {
                    format!("{} (USB: {})", p.port_name, 
                        info.product.as_ref().unwrap_or(&"Unknown".to_string()))
                },
                _ => p.port_name.clone(),
            }
        })
        .collect())
}

/// Connect to a serial port and start reading data
#[tauri::command]
async fn connect_serial(
    port_name: String,
    baud_rate: u32,
    state: State<'_, SerialState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Check if already connected
    let is_connected = state.is_connected.lock().unwrap();
    if *is_connected {
        return Err("Already connected to a port".to_string());
    }
    drop(is_connected);

    // Open the serial port
    let port = serialport::new(&port_name, baud_rate)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Failed to open port {}: {}", port_name, e))?;

    // Store the port in state
    let mut port_lock = state.port.lock().unwrap();
    *port_lock = Some(port);
    drop(port_lock);

    // Mark as connected
    let mut is_connected = state.is_connected.lock().unwrap();
    *is_connected = true;
    drop(is_connected);

    // Spawn a task to read from the serial port
    let port_arc = state.port.clone();
    let is_connected_arc = state.is_connected.clone();
    
    tokio::spawn(async move {
        let mut buffer = String::new();
        
        loop {
            // Check if still connected
            {
                let is_connected = is_connected_arc.lock().unwrap();
                if !*is_connected {
                    break;
                }
            }

            // Read from serial port
            {
                let mut port_lock = port_arc.lock().unwrap();
                if let Some(port) = port_lock.as_mut() {
                    let mut serial_buf: Vec<u8> = vec![0; 1024];
                    match port.read(&mut serial_buf) {
                        Ok(bytes_read) => {
                            if bytes_read > 0 {
                                let data = String::from_utf8_lossy(&serial_buf[..bytes_read]);
                                buffer.push_str(&data);
                                
                                // Process complete lines
                                while let Some(newline_pos) = buffer.find('\n') {
                                    let line = buffer[..newline_pos].trim().to_string();
                                    buffer = buffer[newline_pos + 1..].to_string();
                                    
                                    if !line.is_empty() {
                                        // Parse CSV line: timestamp,ch0,ch1,ch2,ch3,ch4
                                        let parts: Vec<&str> = line.split(',').collect();
                                        if parts.len() == 6 {
                                            // Emit event to frontend
                                            let _ = app_handle.emit_all("sensor-data", line);
                                        }
                                    }
                                }
                            }
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                            // Timeout is normal, continue
                        }
                        Err(e) => {
                            eprintln!("Error reading from serial port: {}", e);
                            let _ = app_handle.emit_all("serial-error", format!("Read error: {}", e));
                            break;
                        }
                    }
                }
            } // Drop port_lock here, before await

            // Small delay to prevent busy-waiting
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    });

    Ok(())
}

/// Disconnect from the serial port
#[tauri::command]
fn disconnect_serial(state: State<'_, SerialState>) -> Result<(), String> {
    let mut is_connected = state.is_connected.lock().unwrap();
    *is_connected = false;
    drop(is_connected);

    let mut port_lock = state.port.lock().unwrap();
    *port_lock = None;
    drop(port_lock);

    Ok(())
}

/// Check if currently connected
#[tauri::command]
fn is_serial_connected(state: State<'_, SerialState>) -> Result<bool, String> {
    let is_connected = state.is_connected.lock().unwrap();
    Ok(*is_connected)
}

#[derive(Deserialize)]
struct SensorSample {
    timestamp: i64,
    ch0: i32,
    ch1: i32,
    ch2: i32,
    ch3: i32,
    ch4: i32,
}

#[derive(Deserialize)]
struct CalibrationData {
    baseline: Vec<i32>,
    maxbend: Vec<i32>,
}

/// Save recorded sensor data to CSV
#[tauri::command]
fn save_recording(
    samples: Vec<SensorSample>,
    gesture: String,
    user_id: String,
    session_id: String,
    calibration: CalibrationData,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Create data directory in app data folder
    let app_dir = app_handle.path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data directory")?;
    
    let data_dir = app_dir.join("recordings");
    create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    // Generate filename with timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let filename = format!("{}_{}_{}_{}.csv", user_id, session_id, gesture, timestamp);
    let filepath = data_dir.join(&filename);

    // Open file for writing
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&filepath)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    // Write CSV header
    writeln!(file, "timestamp_ms,user_id,session_id,class_label,ch0_raw,ch1_raw,ch2_raw,ch3_raw,ch4_raw,ch0_norm,ch1_norm,ch2_norm,ch3_norm,ch4_norm,baseline_ch0,baseline_ch1,baseline_ch2,baseline_ch3,baseline_ch4,maxbend_ch0,maxbend_ch1,maxbend_ch2,maxbend_ch3,maxbend_ch4,glove_fit,sensor_map_ref,notes")
        .map_err(|e| format!("Failed to write header: {}", e))?;

    // Write data rows
    for sample in samples {
        // Calculate normalized values: (raw - baseline) / (maxbend - baseline)
        let mut norm = vec![0.0; 5];
        let raw = vec![sample.ch0, sample.ch1, sample.ch2, sample.ch3, sample.ch4];
        
        for i in 0..5 {
            let baseline = calibration.baseline[i] as f64;
            let maxbend = calibration.maxbend[i] as f64;
            let range = maxbend - baseline;
            if range > 0.0 {
                norm[i] = (raw[i] as f64 - baseline) / range;
                norm[i] = norm[i].max(0.0).min(1.0); // Clamp to 0-1
            }
        }

        writeln!(
            file,
            "{},{},{},{},{},{},{},{},{},{:.3},{:.3},{:.3},{:.3},{:.3},{},{},{},{},{},{},{},{},{},{},normal-fit,CH0=thumb|CH1=index|CH2=middle|CH3=ring|CH4=pinky,",
            sample.timestamp,
            user_id,
            session_id,
            gesture,
            sample.ch0, sample.ch1, sample.ch2, sample.ch3, sample.ch4,
            norm[0], norm[1], norm[2], norm[3], norm[4],
            calibration.baseline[0], calibration.baseline[1], calibration.baseline[2], calibration.baseline[3], calibration.baseline[4],
            calibration.maxbend[0], calibration.maxbend[1], calibration.maxbend[2], calibration.maxbend[3], calibration.maxbend[4]
        ).map_err(|e| format!("Failed to write data: {}", e))?;
    }

    Ok(filepath.to_string_lossy().to_string())
}


fn main() {
    tauri::Builder::default()
        .manage(SerialState {
            port: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            tts_say,
            list_ports,
            connect_serial,
            disconnect_serial,
            is_serial_connected,
            save_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
