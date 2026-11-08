#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

//! Desktop entry point: registers the Tauri commands, builds the main window
//! from the launch options, and wires startup recovery and the Go sidecar.
//!
//! Kept intentionally thin; each host capability lives in its own module.

mod app;
mod assets;
mod chart;
mod diagnostics;
mod documents;
mod io;
mod network;
mod services;
mod storage;
mod update;
use documents::{
    begin_recovery, begin_save_document, cancel_recovery, cancel_save_document, close_document,
    delete_recovery, document_disk_snapshot, finish_recovery, finish_save_document,
    import_library_project, inspect_library, list_recovery, media_response, open_asset_external,
    open_document, read_asset, read_dropped_asset_files, read_picked_file, read_recovery,
    startup_files, write_export_text, write_recovery, write_recovery_asset, write_recovery_chart,
    write_save_asset, write_save_chart, DocumentHost,
};
use tauri::Manager;

/// WebView2 takes both its user data folder and its remote-debugging port as
/// environment/window settings, so the two have to agree before the window —
/// and therefore the WebView2 environment — is created.
struct LaunchOptions {
    user_data_dir: Option<String>,
    remote_debugging_port: Option<u16>,
}

/// Read the two supported product-level launch options once.
///
/// The command-line forms are intentionally narrow: smoke/debug tooling may
/// provide `--user-data-dir=...` and `--remote-debugging-port=...`; normal
/// launches need neither.
fn launch_options() -> LaunchOptions {
    let mut options = LaunchOptions {
        user_data_dir: None,
        remote_debugging_port: None,
    };
    for arg in std::env::args().skip(1) {
        if let Some(value) = arg.strip_prefix("--user-data-dir=") {
            options.user_data_dir = Some(value.to_owned());
        } else if let Some(value) = arg.strip_prefix("--remote-debugging-port=") {
            options.remote_debugging_port = value.parse().ok();
        }
    }
    options
}

/// Desktop entry point: takes launch options, builds the Tauri application, and
/// owns the process-level exit handling.
fn main() {
    if update::local_update_worker::run_helper_if_requested() {
        return;
    }
    let options = launch_options();
    if let Some(profile) = options.user_data_dir.as_deref() {
        std::env::set_var("REDUX_PROFILE_DIR", profile);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", profile);
    }
    // The complete `window.redux` facade is a test/automation surface. A
    // packaged release keeps it out of the page so Extension code cannot bypass
    // its capability-gated context; a debug build or an explicitly attached CDP
    // session still needs it for the smoke suite.
    if cfg!(debug_assertions) || options.remote_debugging_port.is_some() {
        std::env::set_var("REDUX_TEST_API", "1");
    }
    app::startup::configure_user_data();
    let mut context = tauri::generate_context!();
    if std::env::args().any(|arg| arg == "--verify-embedded-entry") {
        let entry = tauri::utils::assets::AssetKey::from("index.html");
        std::process::exit(if context.assets().get(&entry).is_some() {
            0
        } else {
            1
        });
    }
    // Keep normal and CDP launches on the same explicit WebView2 argument
    // path. Wry's implicit defaults have caused environment creation failures
    // on some Windows WebView2 runtime updates.
    let additional_browser_args = options.remote_debugging_port.map_or_else(
        || "--autoplay-policy=no-user-gesture-required".to_owned(),
        |port| {
            format!(
                "--remote-debugging-port={} --autoplay-policy=no-user-gesture-required",
                port
            )
        },
    );
    // The setup hook creates windows so a WebView2 failure can be handled as a
    // startup error.
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window.additional_browser_args = Some(additional_browser_args.clone());
    }

    // Every custom command invoked from the main webview must carry the host
    // token; the performance HUD is a separate trusted native window.
    let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            services::server::start_backend,
            services::server::backend_instance_id,
            services::server::read_runtime_ports,
            services::server::write_runtime_port,
            services::tunnel::start_collab_tunnel,
            services::tunnel::stop_collab_tunnel,
            services::lan::start_lan_bridge,
            services::lan::stop_lan_bridge,
            services::session::claim_collab_session,
            services::session::release_collab_session,
            app::deep_link::take_collab_invite,
            diagnostics::developer::developer_mode,
            diagnostics::developer::developer_toggle_devtools,
            diagnostics::developer::host_platform,
            network::network_connection_status,
            diagnostics::performance_hud::open_performance_hud_window,
            diagnostics::performance_hud::close_performance_hud_window,
            diagnostics::performance_hud::performance_hud_window_state,
            io::recording::recording_begin,
            io::recording::recording_audio,
            io::recording::recording_start,
            io::recording::recording_frame,
            io::recording::recording_finish,
            io::recording::recording_cancel,
            chart::rpe::scan_rpe_root,
            io::external::scan_external_chart,
            open_document,
            open_asset_external,
            read_asset,
            read_dropped_asset_files,
            read_picked_file,
            write_export_text,
            document_disk_snapshot,
            begin_save_document,
            write_save_chart,
            write_save_asset,
            finish_save_document,
            cancel_save_document,
            begin_recovery,
            write_recovery_chart,
            write_recovery_asset,
            finish_recovery,
            cancel_recovery,
            close_document,
            write_recovery,
            list_recovery,
            read_recovery,
            delete_recovery,
            storage::backup::export_app_backup,
            storage::backup::import_app_backup,
            inspect_library,
            import_library_project,
            startup_files,
            assets::extensions::list_extensions,
            assets::extensions::read_extension_entry,
            assets::extensions::install_extension,
            assets::extensions::remove_extension,
            assets::extensions::extension_watchdog_heartbeat,
            assets::extensions::extension_safe_mode,
            assets::themes::list_theme_packages,
            assets::themes::install_theme_package,
            assets::themes::remove_theme_package,
            assets::skins::list_note_skins,
            assets::skins::read_note_skin,
            storage::open_app_data_folder,
            storage::write_diagnostic_log,
            storage::open_diagnostic_logs,
            storage::save_custom_background,
            storage::delete_custom_background,
            storage::cleanup_custom_backgrounds,
            storage::read_custom_background,
            update::local_update::verify_local_update,
            update::local_update_worker::local_update_failure,
            update::updater::update_prepare,
            update::updater::update_download,
            update::updater::update_load_local,
            update::updater::update_discard,
            update::updater::update_install,
            update::updater::update_result,
            update::updater::install_kind
        ]);
    let host_token = app::ipc_guard::HostToken::new();
    let gate_token = host_token.clone();
    let app = tauri::Builder::default()
        .manage(host_token)
        .manage(DocumentHost::default())
        .manage(services::server::ServerProcess::default())
        .manage(assets::extensions::ExtensionWatchdog::default())
        .manage(io::recording::RecordingHost::default())
        .manage(update::updater::UpdateHost::default())
        .manage(services::tunnel::TunnelProcess::default())
        .manage(services::lan::LanBridge::default())
        .manage(services::session::CollabSession::default())
        .manage(app::deep_link::PendingInvite::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Start silently before the frontend; start_backend reports readiness
        // or a retryable failure to the loading screen.
        .setup(|app| {
            // Run data-format and post-update migrations before the sidecar opens
            // the database; a staged import must land after those checks.
            update::local_update_worker::cleanup_finished_helper(app.handle());
            app::migration::run(app.handle());
            update::updater::refresh_installed_version(app.handle());
            if let Err(error) = storage::backup::promote_pending_import(app.handle()) {
                eprintln!("{error}");
            }
            if let Err(error) = documents::migrate_recovery(app.handle()) {
                eprintln!("Could not migrate recovery drafts: {error}");
            }
            app::deep_link::register();
            if let Some(invite) = app::deep_link::invite_from_args(std::env::args()) {
                if let Some(state) = app.try_state::<app::deep_link::PendingInvite>() {
                    if let Ok(mut pending) = state.0.lock() {
                        *pending = Some(invite);
                    }
                }
            }
            if let Err(error) = app::startup::create_windows(app.handle()) {
                app::startup::report_failure(app.handle(), &error);
                return Ok(());
            }
            if let Some(window) = app.get_webview_window("main") {
                app::window_state::restore(&window);
            }
            if let Err(error) = services::server::start(app.handle()) {
                eprintln!("{error}");
            }
            assets::extensions::start_watchdog(app.handle().clone());
            Ok(())
        })
        .register_uri_scheme_protocol("redux", |context, request| {
            media_response(context.app_handle(), request)
        })
        .invoke_handler(move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
            // The extension sandbox shares the `main` webview label with the
            // trusted document, so the label alone is not an authorization
            // boundary; the injected token is.
            let main_webview = invoke.message.webview().label() == "main";
            if main_webview && gate_token.require(invoke.message.headers()).is_err() {
                invoke.resolver.reject(app::ipc_guard::INVALID_TOKEN);
                return true;
            }
            handler(invoke)
        })
        .build(context)
        .expect("RPE Redux desktop startup failed");

    app.run(|handle, event| match event {
        tauri::RunEvent::WindowEvent { label, event, .. }
            if label == "main"
                && matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                ) =>
        {
            if let Some(window) = handle.get_webview_window("main") {
                app::window_state::save(handle, &window);
            }
            diagnostics::performance_hud::close_companion(handle);
        }
        tauri::RunEvent::Exit => {
            diagnostics::performance_hud::close_companion(handle);
            services::tunnel::stop_collab_tunnel(handle.clone());
            services::lan::stop_lan_bridge(handle.clone());
            services::session::release_collab_session(handle.clone());
            services::server::stop(handle);
        }
        _ => {}
    });
}
