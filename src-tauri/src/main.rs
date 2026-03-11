// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use std::thread;
use std::net::TcpStream;
use std::io::{BufRead, BufReader};
use serialport::SerialPort;

// ── Unity Named Pipe ──────────────────────────────────────────────────────────
// Sends 8 f32 values (32 bytes, little-endian) per frame to Unity:
//   [0..4]  5 flex sensors, already normalized 0-1
//   [5..7]  IMU as Euler angles in degrees (pitch, yaw, roll)

#[cfg(target_os = "windows")]
use winapi::{
    um::{
        fileapi::WriteFile,
        handleapi::CloseHandle,
        namedpipeapi::{ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe},
        winbase::{
            PIPE_ACCESS_OUTBOUND, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
        },
    },
    shared::{
        minwindef::DWORD,
        ntdef::HANDLE,
        winerror::ERROR_PIPE_CONNECTED,
    },
};
#[cfg(target_os = "windows")]
use winapi::um::errhandlingapi::GetLastError;
#[cfg(target_os = "windows")]
const INVALID_HANDLE_VALUE: HANDLE = !0usize as HANDLE;

struct UnityPipeState {
    sender:       Option<std::sync::mpsc::SyncSender<[f32; 8]>>,
    is_connected: bool,
    is_running:   bool,
}

impl UnityPipeState {
    fn new() -> Self {
        Self { sender: None, is_connected: false, is_running: false }
    }
}

type UnityPipeShared = Arc<Mutex<UnityPipeState>>;

#[cfg(target_os = "windows")]
fn run_pipe_thread(
    pipe_name:  String,
    receiver:   std::sync::mpsc::Receiver<[f32; 8]>,
    shared:     UnityPipeShared,
) {
    use std::sync::mpsc::RecvTimeoutError;

    loop {
        // Exit if stopped
        { let s = shared.lock().unwrap(); if !s.is_running { break; } }

        // Create the server-end of the named pipe (outbound, 1 instance)
        let wide: Vec<u16> = format!("\\\\.\\pipe\\{}\0", pipe_name).encode_utf16().collect();

        let handle: HANDLE = unsafe {
            CreateNamedPipeW(
                wide.as_ptr(),
                PIPE_ACCESS_OUTBOUND,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                256 as DWORD,
                0   as DWORD,
                0   as DWORD,
                core::ptr::null_mut(),
            )
        };

        if handle == INVALID_HANDLE_VALUE {
            eprintln!("[pipe] CreateNamedPipeW failed");
            thread::sleep(Duration::from_secs(1));
            continue;
        }

        println!("[pipe] Waiting for Unity to connect to \"{}\"…", pipe_name);

        // Blocking wait for Unity client
        let ok = unsafe { ConnectNamedPipe(handle, std::ptr::null_mut()) };
        if ok == 0 {
            let err = unsafe { GetLastError() };
            if err != ERROR_PIPE_CONNECTED {
                unsafe { CloseHandle(handle); }
                thread::sleep(Duration::from_millis(500));
                continue;
            }
        }

        println!("[pipe] Unity connected!");
        { let mut s = shared.lock().unwrap(); s.is_connected = true; }

        // Write loop — drain the channel and forward to Unity
        loop {
            { let s = shared.lock().unwrap(); if !s.is_running { unsafe { DisconnectNamedPipe(handle); CloseHandle(handle); } return; } }

            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(data) => {
                    let bytes: Vec<u8> = data.iter().flat_map(|f| f.to_le_bytes()).collect();
                    let mut written: u32 = 0;
                    let result = unsafe {
                        WriteFile(handle, bytes.as_ptr() as *const _, bytes.len() as u32, &mut written, std::ptr::null_mut())
                    };
                    if result == 0 { break; }   // Unity disconnected
                }
                Err(RecvTimeoutError::Timeout)      => continue,
                Err(RecvTimeoutError::Disconnected) => { break; }
            }
        }

        println!("[pipe] Unity disconnected — waiting for reconnect…");
        unsafe { DisconnectNamedPipe(handle); CloseHandle(handle); }
        { let mut s = shared.lock().unwrap(); s.is_connected = false; if !s.is_running { break; } }
        thread::sleep(Duration::from_millis(300));
    }

    println!("[pipe] Server stopped.");
}

#[tauri::command]
fn unity_pipe_start(
    pipe_name: Option<String>,
    state: tauri::State<UnityPipeShared>,
) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    if s.is_running { return Ok("already running".to_string()); }

    let name = pipe_name.unwrap_or_else(|| "glove_pipe".to_string());
    let (tx, rx) = std::sync::mpsc::sync_channel::<[f32; 8]>(4);
    s.sender     = Some(tx);
    s.is_running = true;
    drop(s);

    let shared_clone = state.inner().clone();
    #[cfg(target_os = "windows")]
    thread::spawn(move || run_pipe_thread(name, rx, shared_clone));

    #[cfg(not(target_os = "windows"))]
    drop((rx, shared_clone));

    Ok("pipe server started".to_string())
}

#[tauri::command]
fn unity_pipe_stop(state: tauri::State<UnityPipeShared>) -> Result<String, String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.sender     = None;    // drops channel → thread exits write loop
    s.is_running = false;
    s.is_connected = false;
    Ok("pipe server stopped".to_string())
}

#[tauri::command]
fn unity_pipe_send(
    data: Vec<f32>,
    state: tauri::State<UnityPipeShared>,
) -> Result<(), String> {
    if data.len() < 8 { return Err("need 8 floats".to_string()); }
    let arr: [f32; 8] = data[..8].try_into().map_err(|e: std::array::TryFromSliceError| e.to_string())?;
    let s = state.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = &s.sender {
        let _ = tx.try_send(arr); // non-blocking; drop frame if channel full
    }
    Ok(())
}

#[tauri::command]
fn unity_pipe_status(state: tauri::State<UnityPipeShared>) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::json!({ "running": s.is_running, "connected": s.is_connected })
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
    drop(port_lock);
    
    // Wait for any previous reading threads to fully stop
    thread::sleep(Duration::from_millis(200));
    
    // Reacquire lock and open the serial port
    let mut port_lock = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    
    // Open the serial port with minimal timeout for fast reads
    let mut port = serialport::new(&port_name, 115200)
        .timeout(Duration::from_millis(10)) // Short timeout for responsive reads
        .open()
        .map_err(|e| format!("Failed to open port {}: {}", port_name, e))?;
    
    // Clear OS-level buffers (just like Arduino IDE does)
    let _ = port.clear(serialport::ClearBuffer::All);
    
    // Small delay for hardware to stabilize
    thread::sleep(Duration::from_millis(50));
    
    *port_lock = Some(port);
    
    Ok(format!("Connected to {}", port_name))
}

#[tauri::command]
fn disconnect_serial(
    state: tauri::State<SerialPortState>,
    reading_state: tauri::State<ReadingActiveState>,
) -> Result<String, String> {
    // First stop reading
    let mut reading_lock = reading_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *reading_lock = false; // Stop reading
    drop(reading_lock); // Release lock
    
    // Give the reading thread time to stop
    thread::sleep(Duration::from_millis(100));
    
    // Now close the port
    let mut port_lock = state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *port_lock = None;
    drop(port_lock);
    
    // Additional delay to ensure thread cleanup
    thread::sleep(Duration::from_millis(50));
    
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
        let mut first_line_skipped = false; // Skip first line (might be partial after reconnect)
        
        loop {
            let is_reading = {
                match reading_state_clone.lock() {
                    Ok(lock) => *lock,
                    Err(_) => break,
                }
            };
            
            if !is_reading {
                buffer.clear();
                first_line_skipped = false; // Reset on pause
                thread::sleep(Duration::from_millis(100));
                continue;
            }
            
            let mut port_lock = match state_clone.lock() {
                Ok(lock) => lock,
                Err(_) => break,
            };
            
            if port_lock.is_none() {
                buffer.clear();
                first_line_skipped = false; // Reset on disconnect
                break;
            }
            
            // Read bytes from serial port continuously (no sleep!)
            let mut serial_buf: Vec<u8> = vec![0; 256]; // Larger buffer
            match port_lock.as_mut().unwrap().read(&mut serial_buf) {
                Ok(bytes_read) => {
                    if bytes_read > 0 {
                        let data = String::from_utf8_lossy(&serial_buf[0..bytes_read]);
                        buffer.push_str(&data);
                        
                        // Process complete lines (ending with \n)
                        while let Some(newline_pos) = buffer.find('\n') {
                            let line = buffer[..newline_pos].trim().to_string();
                            buffer = buffer[newline_pos + 1..].to_string();
                            
                            // Skip first line (might be partial/corrupted from reconnect)
                            if !first_line_skipped {
                                first_line_skipped = true;
                                continue;
                            }
                            
                            // Skip empty lines
                            if line.is_empty() {
                                continue;
                            }
                            
                            // Parse: "2880,1910,2127,2295,2335" (5 values, no IMU)
                            //     or "2880,1910,2127,2295,2335,1.0000,0.0000,0.0000,0.0000" (9 values, with IMU)
                            let values: Vec<&str> = line.split(',').collect();
                            
                            if values.len() == 9 {
                                // New format: 5 thermistors + 4 quaternion floats (w, x, y, z)
                                let thermistors: Vec<i32> = values[..5]
                                    .iter()
                                    .filter_map(|s| s.trim().parse::<i32>().ok())
                                    .collect();
                                let quats: Vec<f32> = values[5..]
                                    .iter()
                                    .filter_map(|s| s.trim().parse::<f32>().ok())
                                    .collect();
                                
                                if thermistors.len() == 5 && quats.len() == 4 {
                                    // Emit thermistor data (same event as before for backward compat)
                                    let _ = window.emit("serial-data", &thermistors);
                                    // Emit IMU quaternion as a separate event
                                    let imu_payload = serde_json::json!({
                                        "w": quats[0],
                                        "x": quats[1],
                                        "y": quats[2],
                                        "z": quats[3]
                                    });
                                    let _ = window.emit("serial-imu", imu_payload);
                                }
                            } else if values.len() == 5 {
                                // Legacy format: 5 thermistor values only
                                let parsed: Vec<i32> = values
                                    .iter()
                                    .filter_map(|s| s.trim().parse::<i32>().ok())
                                    .collect();
                                
                                // Only emit if we successfully parsed all 5 values
                                if parsed.len() == 5 {
                                    let _ = window.emit("serial-data", parsed);
                                }
                            }
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // Timeout is fine - just loop again immediately
                }
                Err(_) => break,
            }
            
            drop(port_lock);
            // NO SLEEP - read continuously like Arduino does!
        }
    });
    
    Ok(())
}

/// Launch the Unity digital-twin executable.
/// `exe_path` should be the absolute path to the built .exe, e.g.
///   "C:\\Users\\Yigit\\Desktop\\iot-sign-language-desktop\\unity-handvis\\Build\\unity-handvis.exe"
/// If the path is empty or omitted, we try the default location next to this app.
#[tauri::command]
fn launch_unity(exe_path: Option<String>) -> Result<(), String> {
    let path = exe_path.unwrap_or_else(|| {
        // Default: Build/ folder sitting beside the project
        let mut p = std::env::current_exe()
            .unwrap_or_default()
            .parent()
            .unwrap_or(std::path::Path::new("."))
            .to_path_buf();
        p.push("unity-handvis.exe");
        p.to_string_lossy().to_string()
    });

    Command::new(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch Unity viewer: {e}  (path: {path})"))
}

// ── WebGL HTTP file-server ─────────────────────────────────────────────────────
// Serves the Unity WebGL build directory over HTTP so that the Tauri WebView
// can embed it in an <iframe>.  The iframe receives sensor data via postMessage.

struct WebGLServerState {
    stop_flag: Option<Arc<AtomicBool>>,
    port: u16,
}
impl WebGLServerState {
    fn new() -> Self { Self { stop_flag: None, port: 8787 } }
}
type WebGLServerShared = Arc<Mutex<WebGLServerState>>;

/// Return the Content-Type for a file, stripping any trailing .br/.gz extension first.
fn mime_for(path: &std::path::Path) -> &'static str {
    // Peel off .br / .gz to get the real extension
    let effective = match path.extension().and_then(|e| e.to_str()) {
        Some("br") | Some("gz") => std::path::Path::new(path.file_stem().unwrap_or_default()),
        _ => path,
    };
    match effective.extension().and_then(|e| e.to_str()) {
        Some("html")         => "text/html; charset=utf-8",
        Some("js")           => "application/javascript",
        Some("wasm")         => "application/wasm",
        Some("data")         => "application/octet-stream",
        Some("json")         => "application/json",
        Some("css")          => "text/css",
        Some("png")          => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("svg")          => "image/svg+xml",
        Some("ico")          => "image/x-icon",
        _                    => "application/octet-stream",
    }
}

fn handle_webgl_request(request: tiny_http::Request, dir: &std::path::Path) {
    let raw_url = request.url().to_string();
    // Strip query string, map "/" → "index.html"
    let path_part = raw_url.split('?').next().unwrap_or("/");
    let path_part = if path_part == "/" { "index.html" } else { path_part.trim_start_matches('/') };

    let file_path = dir.join(path_part);

    // Unity WebGL builds may request .br / .gz files directly OR expect the server
    // to transparently serve compressed variants of uncompressed URLs.
    // Strategy:
    //   1. If the requested file exists on disk → serve it as-is.
    //   2. Otherwise try adding .br / .gz suffixes.
    // In all cases, detect encoding from the final file's extension so the browser
    // can decompress it correctly.
    let serve_path = if file_path.exists() {
        file_path.clone()
    } else {
        let br_path = dir.join(format!("{}.br", path_part));
        let gz_path = dir.join(format!("{}.gz", path_part));
        if br_path.exists()      { br_path }
        else if gz_path.exists() { gz_path }
        else                     { file_path.clone() } // will 404 below
    };

    // Derive Content-Encoding from whatever file we ended up selecting
    let encoding: Option<&str> = match serve_path.extension().and_then(|e| e.to_str()) {
        Some("br") => Some("br"),
        Some("gz") => Some("gzip"),
        _          => None,
    };

    let mime = mime_for(&serve_path); // strips .br/.gz internally to get the real type
    let cors = tiny_http::Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap();
    let ct   = tiny_http::Header::from_bytes("Content-Type", mime).unwrap();

    match std::fs::read(&serve_path) {
        Ok(data) => {
            let mut resp = tiny_http::Response::from_data(data)
                .with_header(ct)
                .with_header(cors);
            if let Some(enc) = encoding {
                resp = resp.with_header(
                    tiny_http::Header::from_bytes("Content-Encoding", enc).unwrap()
                );
            }
            let _ = request.respond(resp);
        }
        Err(_) => {
            let resp = tiny_http::Response::from_string("404 Not Found")
                .with_status_code(tiny_http::StatusCode(404));
            let _ = request.respond(resp);
        }
    }
}

/// Start a local HTTP server that serves the Unity WebGL build directory.
/// `dir`  – absolute path to the WebGL build folder (contains index.html)
/// `port` – local port, default 8787
/// Returns the actual port used so the frontend can build the iframe URL.
#[tauri::command]
fn start_webgl_server(
    dir: String,
    port: u16,
    state: tauri::State<WebGLServerShared>,
) -> Result<u16, String> {
    let mut s = state.lock().unwrap();

    // Tear down any existing server
    if let Some(flag) = s.stop_flag.take() {
        flag.store(true, Ordering::Relaxed);
    }

    let server = tiny_http::Server::http(format!("0.0.0.0:{}", port))
        .map_err(|e| format!("Cannot bind WebGL HTTP server on port {port}: {e}"))?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    s.stop_flag = Some(stop_flag.clone());
    s.port = port;

    let dir_path = std::path::PathBuf::from(dir);
    thread::spawn(move || {
        loop {
            if stop_flag.load(Ordering::Relaxed) { break; }
            match server.recv_timeout(Duration::from_millis(300)) {
                Ok(Some(req)) => handle_webgl_request(req, &dir_path),
                Ok(None)      => {}   // timeout – loop and check stop flag
                Err(_)        => break,
            }
        }
    });

    Ok(port)
}

/// Stop the WebGL HTTP server.
#[tauri::command]
fn stop_webgl_server(state: tauri::State<WebGLServerShared>) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    if let Some(flag) = s.stop_flag.take() {
        flag.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err("WebGL server is not running".to_string())
    }
}

// ── WiFi TCP client ───────────────────────────────────────────────────────────
// Connects to the ESP32's TCP server and reads the same CSV lines as USB serial,
// emitting identical "serial-data" / "serial-imu" events.
// Supports both IP addresses (192.168.x.x) and mDNS hostnames (glove.local).

type WifiStopFlag  = Arc<AtomicBool>;
type WifiStateShared = Arc<Mutex<Option<WifiStopFlag>>>;

#[tauri::command]
fn connect_wifi(
    host: String,
    port: u16,
    window: tauri::Window,
    wifi_state: tauri::State<WifiStateShared>,
) -> Result<String, String> {
    // Stop any existing WiFi connection first
    {
        let mut s = wifi_state.lock().unwrap();
        if let Some(flag) = s.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }
    thread::sleep(Duration::from_millis(150));

    let addr = format!("{}:{}", host, port);

    // Resolve hostname (handles both IPs and mDNS names like glove.local)
    use std::net::ToSocketAddrs;
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("Cannot resolve \"{}\": {}", addr, e))?
        .next()
        .ok_or_else(|| format!("No address found for \"{}\"", addr))?;

    let stream = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(5))
        .map_err(|e| format!("Cannot connect to {}: {}", addr, e))?;

    stream.set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|e| format!("set_read_timeout: {}", e))?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut s = wifi_state.lock().unwrap();
        *s = Some(stop_flag.clone());
    }

    let stop_clone = stop_flag.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut line   = String::new();
        let mut first_line_skipped = false;

        loop {
            if stop_clone.load(Ordering::Relaxed) { break; }
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => { break; }   // connection closed by ESP32
                Ok(_) => {
                    let trimmed = line.trim().to_string();
                    if trimmed.is_empty() { continue; }

                    // Skip first line — may be partial after connect
                    if !first_line_skipped {
                        first_line_skipped = true;
                        continue;
                    }

                    // Same parsing as the serial thread so the same React callbacks fire
                    let values: Vec<&str> = trimmed.split(',').collect();
                    if values.len() == 9 {
                        let thermistors: Vec<i32> = values[..5]
                            .iter().filter_map(|s| s.trim().parse::<i32>().ok()).collect();
                        let quats: Vec<f32> = values[5..]
                            .iter().filter_map(|s| s.trim().parse::<f32>().ok()).collect();
                        if thermistors.len() == 5 && quats.len() == 4 {
                            let _ = window.emit("serial-data", &thermistors);
                            let imu_payload = serde_json::json!({
                                "w": quats[0], "x": quats[1],
                                "y": quats[2], "z": quats[3]
                            });
                            let _ = window.emit("serial-imu", imu_payload);
                        }
                    } else if values.len() == 5 {
                        let parsed: Vec<i32> = values
                            .iter().filter_map(|s| s.trim().parse::<i32>().ok()).collect();
                        if parsed.len() == 5 {
                            let _ = window.emit("serial-data", parsed);
                        }
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut
                           || e.kind() == std::io::ErrorKind::WouldBlock => {
                    // no data this tick — keep looping
                }
                Err(_) => { break; }
            }
        }
    });

    Ok(format!("Connected to {} via WiFi", addr))
}

#[tauri::command]
fn disconnect_wifi(wifi_state: tauri::State<WifiStateShared>) -> Result<String, String> {
    let mut s = wifi_state.lock().unwrap();
    if let Some(flag) = s.take() {
        flag.store(true, Ordering::Relaxed);
        Ok("WiFi disconnected".to_string())
    } else {
        Ok("No WiFi connection active".to_string())
    }
}

fn main() {
    let serial_state: SerialPortState = Arc::new(Mutex::new(None));
    let reading_active: ReadingActiveState = Arc::new(Mutex::new(false));
    let unity_pipe: UnityPipeShared = Arc::new(Mutex::new(UnityPipeState::new()));
    let webgl_server: WebGLServerShared = Arc::new(Mutex::new(WebGLServerState::new()));
    let wifi_state: WifiStateShared = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .manage(serial_state)
        .manage(reading_active)
        .manage(unity_pipe)
        .manage(webgl_server)
        .manage(wifi_state)
        .invoke_handler(tauri::generate_handler![
            tts_say,
            list_ports,
            connect_serial,
            disconnect_serial,
            start_reading_serial,
            stop_reading_serial,
            resume_reading_serial,
            unity_pipe_start,
            unity_pipe_stop,
            unity_pipe_send,
            unity_pipe_status,
            launch_unity,
            start_webgl_server,
            stop_webgl_server,
            connect_wifi,
            disconnect_wifi,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

