mod ai;
mod commands;
mod files;
mod menu;
mod profiles;
mod providers;
mod state;
mod types;
mod validation;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| menu::build(app))
        .on_menu_event(|app, event| menu::handle_event(app, event.id().as_ref()))
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::db_connect,
            commands::db_disconnect,
            commands::db_list_objects,
            commands::db_list_object_columns,
            commands::db_run_query,
            commands::db_run_query_filtered,
            commands::db_get_transaction_state,
            commands::db_begin_transaction,
            commands::db_commit_transaction,
            commands::db_rollback_transaction,
            commands::db_search_schema_text,
            commands::db_get_object_ddl,
            commands::db_update_object_ddl,
            commands::db_list_connection_profiles,
            commands::db_save_connection_profile,
            commands::db_delete_connection_profile,
            commands::db_get_connection_profile_secret,
            commands::db_has_ai_api_key,
            commands::db_set_ai_api_key,
            commands::db_clear_ai_api_key,
            commands::db_ai_suggest_query,
            commands::db_pick_directory,
            commands::db_save_query_sheet,
            commands::db_save_query_sheets,
            commands::db_export_schema
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
