use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Second launch attempt — focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                window.set_focus().ok();
            }
            // On Linux, deep links arrive as CLI args to the blocked second instance.
            // Forward any z:// URL so the existing instance's event listener picks it up.
            for arg in &args {
                if arg.starts_with("z://") {
                    app.emit("z-auth-callback", arg.clone()).ok();
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register("z")?;

                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle.emit("z-auth-callback", url.to_string()).ok();
                    }
                });
            }

            #[cfg(all(debug_assertions, desktop))]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
