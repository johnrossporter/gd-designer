mod mcp;

use std::fs;
use std::path::PathBuf;

/// Reads a GDDesigner document (or any UTF-8 text file) from disk.
#[tauri::command]
fn read_document(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes text to disk atomically: the contents go to a sibling `.tmp` file
/// first and are then renamed over the target, so a crash mid-write never
/// leaves a half-written document behind.
#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
        }
    }
    let tmp = PathBuf::from(format!("{path}.tmp"));
    fs::write(&tmp, contents).map_err(|e| format!("Could not write {path}: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not replace {path}: {e}")
    })
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    PathBuf::from(path).is_file()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(mcp::McpState::default())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            file_exists,
            mcp::mcp_start,
            mcp::mcp_stop,
            mcp::mcp_respond
        ])
        .run(tauri::generate_context!())
        .expect("error while running GDDesigner");
}
