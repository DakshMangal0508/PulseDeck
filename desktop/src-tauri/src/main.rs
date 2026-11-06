#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};

struct Backend(Mutex<Option<Child>>);

fn backend_is_ready() -> bool {
    let address: SocketAddr = "127.0.0.1:8000".parse().expect("valid local address");
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn backend_paths(app: &tauri::App) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        Ok((
            repo.join(".venv/Scripts/python.exe"),
            repo.join("backend/Server.py"),
        ))
    } else {
        let executable = app.path().resource_dir()?.join("backend/PulseDeckHost.exe");
        let working_dir = executable
            .parent()
            .ok_or("backend executable has no parent directory")?
            .to_path_buf();
        Ok((executable, working_dir))
    }
}

fn start_backend(app: &tauri::App) -> Result<Option<Child>, Box<dyn std::error::Error>> {
    if backend_is_ready() {
        return Ok(None);
    }

    let (executable, server_or_dir) = backend_paths(app)?;
    let mut command = Command::new(executable);
    if cfg!(debug_assertions) {
        command.arg(server_or_dir).current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../backend"));
    } else {
        command.current_dir(server_or_dir);
        let user_data_dir = app.path().app_local_data_dir()?.join("PulseDeck");
        command.env("PULSEDECK_DATA_DIR", &user_data_dir);
        command.env("PULSEDECK_CONFIG_DIR", user_data_dir);
        command.env("PULSEDECK_FRONTEND_DIR", app.path().resource_dir()?.join("frontend/dist"));
        command.env("PULSEDECK_ALLOWED_ORIGINS", "http://tauri.localhost");
    }

    let mut child = command
        .env("PORT", "8000")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        if backend_is_ready() {
            return Ok(Some(child));
        }
        if let Some(status) = child.try_wait()? {
            return Err(format!("PulseDeck backend exited during startup with {status}").into());
        }
        thread::sleep(Duration::from_millis(250));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err("PulseDeck backend did not start within 45 seconds".into())
}

#[cfg(windows)]
fn enable_start_on_login() {
    use std::os::windows::process::CommandExt;

    let Ok(executable) = std::env::current_exe() else { return; };
    let command = format!("\"{}\" --background", executable.display());
    let status = Command::new("reg.exe")
        .arg("add")
        .arg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .arg("/v")
        .arg("PulseDeck")
        .arg("/t")
        .arg("REG_SZ")
        .arg("/d")
        .arg(&command)
        .arg("/f")
        .creation_flags(0x08000000)
        .status();
    let _ = status;
}

#[cfg(not(windows))]
fn enable_start_on_login() {}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            enable_start_on_login();
            if std::env::args().any(|argument| argument == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            let child = start_backend(app)?;
            app.manage(Backend(Mutex::new(child)));

            let open = MenuItem::with_id(app, "open", "Open PulseDeck", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit PulseDeck", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let icon = app.default_window_icon().cloned().ok_or("PulseDeck tray icon is missing")?;
            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("PulseDeck")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building PulseDeck");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(backend) = handle.try_state::<Backend>() {
                if let Ok(mut child) = backend.0.lock() {
                    if let Some(mut process) = child.take() {
                        let _ = process.kill();
                        let _ = process.wait();
                    }
                }
            }
        }
    });
}
