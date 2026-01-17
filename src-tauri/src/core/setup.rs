use flate2::read::GzDecoder;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
};
use tar::Archive;
use tauri::{
    App, Emitter, Manager, Runtime, Wry, WindowEvent
};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_store::Store;

use crate::core::mcp::helpers::add_server_config;

use super::{
    extensions::commands::get_jan_extensions_path, mcp::helpers::run_mcp_commands, state::AppState,
};

pub fn install_extensions<R: Runtime>(app: tauri::AppHandle<R>, force: bool) -> Result<(), String> {
    // Skip extension installation on mobile platforms
    // Mobile uses pre-bundled extensions loaded via MobileCoreService in the frontend
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Ok(());
    }

    let extensions_path = get_jan_extensions_path(app.clone());
    let pre_install_path = app
        .path()
        .resource_dir()
        .unwrap()
        .join("resources")
        .join("pre-install");

    let mut clean_up = force;

    // Check IS_CLEAN environment variable to optionally skip extension install
    if std::env::var("IS_CLEAN").is_ok() {
        clean_up = true;
    }

    let replacements_disabled = std::env::var("DISABLE_EXTENSION_REPLACEMENTS").is_ok();
    log::info!(
        "Installing extensions. Clean up: {clean_up}, replacements disabled: {replacements_disabled}"
    );

    // Attempt to create it again
    if !extensions_path.exists() {
        fs::create_dir_all(&extensions_path).map_err(|e| e.to_string())?;
    }

    let extensions_json_path = extensions_path.join("extensions.json");
    let mut extensions_list = if extensions_json_path.exists() {
        let existing_data =
            fs::read_to_string(&extensions_json_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str::<Vec<serde_json::Value>>(&existing_data).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    };

    if clean_up {
        // Attempt to remove extensions folder
        if extensions_path.exists() {
            fs::remove_dir_all(&extensions_path).unwrap_or_else(|_| {
                log::info!("Failed to remove existing extensions folder, it may not exist.");
            });
        }

        if !extensions_path.exists() {
            fs::create_dir_all(&extensions_path).map_err(|e| e.to_string())?;
        }

        extensions_list.clear();
    }

    let mut existing_by_name: HashMap<String, serde_json::Value> = HashMap::new();
    for extension in extensions_list.drain(..) {
        if let Some(name) = extension.get("name").and_then(|value| value.as_str()) {
            existing_by_name.insert(name.to_string(), extension);
        }
    }

    for entry in fs::read_dir(&pre_install_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "tgz") {
            let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
            let gz_decoder = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(gz_decoder);

            let mut extension_name = None;
            let mut extension_manifest = None;
            extract_extension_manifest(&mut archive)
                .map_err(|e| e.to_string())
                .and_then(|manifest| match manifest {
                    Some(manifest) => {
                        extension_name = manifest["name"].as_str().map(|s| s.to_string());
                        extension_manifest = Some(manifest);
                        Ok(())
                    }
                    None => Err("Manifest is None".to_string()),
                })?;

            let extension_name = extension_name.ok_or("package.json not found in archive")?;
            let extension_dir = extensions_path.join(extension_name.clone());
            let installed_version = read_installed_extension_version(&extension_dir)
                .unwrap_or_default();
            let bundled_version = extension_manifest
                .as_ref()
                .and_then(|manifest| manifest["version"].as_str())
                .unwrap_or("");

            let bundled_modified = fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .ok();
            let installed_modified = read_installed_extension_modified(&extension_dir);

            let should_install = !replacements_disabled
                && (clean_up
                    || !extension_dir.exists()
                    || is_newer_version(bundled_version, &installed_version)
                    || bundled_version.is_empty()
                    || is_newer_timestamp(bundled_modified, installed_modified));

            let extension_origin = if should_install {
                if extension_dir.exists() {
                    fs::remove_dir_all(&extension_dir).unwrap_or_else(|_| {
                        log::info!(
                            "Failed to remove existing extension folder for {extension_name}."
                        );
                    });
                }

                fs::create_dir_all(&extension_dir).map_err(|e| e.to_string())?;

                let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
                let gz_decoder = GzDecoder::new(tar_gz);
                let mut archive = Archive::new(gz_decoder);
                for entry in archive.entries().map_err(|e| e.to_string())? {
                    let mut entry = entry.map_err(|e| e.to_string())?;
                    let file_path = entry.path().map_err(|e| e.to_string())?;
                    let components: Vec<_> = file_path.components().collect();
                    if components.len() > 1 {
                        let relative_path: PathBuf = components[1..].iter().collect();
                        let target_path = extension_dir.join(relative_path);
                        if let Some(parent) = target_path.parent() {
                            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                        }
                        let _result = entry.unpack(&target_path).map_err(|e| e.to_string())?;
                    }
                }

                log::info!("Installed extension to {extension_dir:?}");
                extension_dir.to_string_lossy().to_string()
            } else {
                existing_by_name
                    .get(&extension_name)
                    .and_then(|extension| extension.get("origin"))
                    .and_then(|origin| origin.as_str())
                    .map(|origin| origin.to_string())
                    .unwrap_or_else(|| extension_dir.to_string_lossy().to_string())
            };

            let main_entry = extension_manifest
                .as_ref()
                .and_then(|manifest| manifest["main"].as_str())
                .unwrap_or("index.js");
            let url = Path::new(&extension_origin)
                .join(main_entry)
                .to_string_lossy()
                .to_string();

            let new_extension = serde_json::json!({
                "url": url,
                "name": extension_name.clone(),
                "origin": extension_origin,
                "active": true,
                "description": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["description"].as_str())
                    .unwrap_or(""),
                "version": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["version"].as_str())
                    .unwrap_or(""),
                "productName": extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["productName"].as_str())
                    .unwrap_or(""),
            });

            existing_by_name.insert(extension_name.clone(), new_extension);
        }
    }

    let mut merged_extensions: Vec<serde_json::Value> =
        existing_by_name.into_values().collect();
    merged_extensions.sort_by(|a, b| {
        let name_a = a.get("name").and_then(|value| value.as_str()).unwrap_or("");
        let name_b = b.get("name").and_then(|value| value.as_str()).unwrap_or("");
        name_a.cmp(name_b)
    });

    fs::write(
        &extensions_json_path,
        serde_json::to_string_pretty(&merged_extensions).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// Migrate MCP servers configuration
pub fn migrate_mcp_servers(
    app_handle: tauri::AppHandle,
    store: Arc<Store<Wry>>,
) -> Result<(), String> {
    let mcp_version = store
        .get("mcp_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if mcp_version < 1 {
        log::info!("Migrating MCP schema version 1");
        let result = add_server_config(
            app_handle.clone(),
            "exa".to_string(),
            serde_json::json!({
                  "command": "npx",
                  "args": ["-y", "exa-mcp-server"],
                  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" },
                  "active": false
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add server config: {e}");
        }
    }
    if mcp_version < 2 {
        log::info!("Migrating MCP schema version 2: Adding Jan Browser MCP");
        let result = add_server_config(
            app_handle,
            "Jan Browser MCP".to_string(),
            serde_json::json!({
                "command": "npx",
                "args": ["-y", "search-mcp-server@latest"],
                "env": {
                    "BRIDGE_HOST": "127.0.0.1",
                    "BRIDGE_PORT": "17389"
                },
                "active": false,
                "official": true
            }),
        );
        if let Err(e) = result {
            log::error!("Failed to add Jan Browser MCP server config: {e}");
        }
    }
    store.set("mcp_version", 2);
    store.save().expect("Failed to save store");
    Ok(())
}

pub fn extract_extension_manifest<R: Read>(
    archive: &mut Archive<R>,
) -> Result<Option<serde_json::Value>, String> {
    let entry = archive
        .entries()
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()) // Ignore errors in individual entries
        .find(|entry| {
            if let Ok(file_path) = entry.path() {
                let path_str = file_path.to_string_lossy();
                path_str == "package/package.json" || path_str == "package.json"
            } else {
                false
            }
        });

    if let Some(mut entry) = entry {
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;

        let package_json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(Some(package_json));
    }

    Ok(None)
}

fn read_installed_extension_version(extension_dir: &Path) -> Option<String> {
    let manifest_path = extension_dir.join("package.json");
    let contents = fs::read_to_string(manifest_path).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&contents).ok()?;
    manifest
        .get("version")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn is_newer_version(bundled: &str, installed: &str) -> bool {
    let bundled_version = parse_version(bundled);
    let installed_version = parse_version(installed);

    for idx in 0..3 {
        let bundled_part = bundled_version[idx];
        let installed_part = installed_version[idx];
        if bundled_part != installed_part {
            return bundled_part > installed_part;
        }
    }

    false
}

fn parse_version(version: &str) -> [u64; 3] {
    let mut parts = [0_u64; 3];

    for (idx, segment) in version.split('.').take(3).enumerate() {
        let digits: String = segment.chars().take_while(|ch| ch.is_ascii_digit()).collect();
        parts[idx] = digits.parse::<u64>().unwrap_or(0);
    }

    parts
}

fn read_installed_extension_modified(extension_dir: &Path) -> Option<std::time::SystemTime> {
    let extension_root = extension_dir.join("package.json");
    fs::metadata(extension_root).and_then(|metadata| metadata.modified()).ok()
}

fn is_newer_timestamp(
    bundled: Option<std::time::SystemTime>,
    installed: Option<std::time::SystemTime>,
) -> bool {
    match (bundled, installed) {
        (Some(bundled_time), Some(installed_time)) => bundled_time > installed_time,
        (Some(_), None) => true,
        _ => false,
    }
}

pub fn setup_mcp<R: Runtime>(app: &App<R>) {
    let state = app.state::<AppState>();
    let servers = state.mcp_servers.clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use crate::core::mcp::lockfile::cleanup_all_stale_locks;

        if let Err(e) = cleanup_all_stale_locks(&app_handle).await {
            log::debug!("Lock file cleanup error: {}", e);
        }

        if let Err(e) = run_mcp_commands(&app_handle, servers).await {
            log::error!("Failed to run mcp commands: {e}");
        }
        app_handle
            .emit("mcp-update", "MCP servers updated")
            .unwrap();
    });
}

#[cfg(desktop)]
pub fn setup_tray(app: &App) -> tauri::Result<TrayIcon> {
    let show_i = MenuItem::with_id(app.handle(), "open", "Open Jan", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app.handle(), "quit", "Quit", true, None::<&str>)?;
    let separator_i = PredefinedMenuItem::separator(app.handle())?;
    let menu = Menu::with_items(app.handle(), &[&show_i, &separator_i, &quit_i])?;
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                // let's show and focus the main window when the tray is clicked
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {
                log::debug!("unhandled event {event:?}");
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let window = app.get_webview_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            "quit" => {
                app.exit(0);
            }
            other => {
                println!("menu item {other} not handled");
            }
        })
        .build(app)
}

pub fn setup_theme_listener<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // Setup theme listener for main window
    if let Some(window) = app.get_webview_window("main") {
        setup_window_theme_listener(app.handle().clone(), window);
    }

    Ok(())
}

fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let theme_str = match theme {
                tauri::Theme::Light => "light",
                tauri::Theme::Dark => "dark",
                _ => "auto",
            };
            log::info!("System theme changed to: {theme_str} for window: {window_label}");
            let _ = app_handle_clone.emit("theme-changed", theme_str);
        }
    });
}
