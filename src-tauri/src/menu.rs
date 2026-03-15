use serde::Serialize;
use tauri::{Emitter, Runtime};

const MENU_ID_TOOLS_SETTINGS: &str = "tools.settings";
const MENU_ID_HELP_CHECK_FOR_UPDATES: &str = "help.check_for_updates";
const MENU_ID_TOOLS_FIND_IN_SCHEMA: &str = "tools.find_in_schema";
const MENU_ID_TOOLS_EXPORT_DATABASE: &str = "tools.export_database";
const MENU_ID_TOOLS_SAVE_ACTIVE_QUERY_SHEET: &str = "tools.save_active_query_sheet";
const MENU_ID_TOOLS_SAVE_ALL_QUERY_SHEETS: &str = "tools.save_all_query_sheets";
const MENU_ID_TOOLS_NAVIGATE_SCRIPT_LINE_BACK: &str = "tools.navigate_script_line_back";
const MENU_ID_TOOLS_NAVIGATE_SCRIPT_LINE_FORWARD: &str = "tools.navigate_script_line_forward";
const MENU_ID_TOOLS_CREATE_OBJECT_TABLE: &str = "tools.create_object.table";
const MENU_ID_TOOLS_CREATE_OBJECT_VIEW: &str = "tools.create_object.view";
const MENU_ID_TOOLS_CREATE_OBJECT_PROCEDURE: &str = "tools.create_object.procedure";
const MENU_ID_TOOLS_CREATE_OBJECT_FUNCTION: &str = "tools.create_object.function";
const MENU_ID_TOOLS_CREATE_OBJECT_PACKAGE: &str = "tools.create_object.package";
const MENU_ID_TOOLS_CREATE_OBJECT_PACKAGE_BODY: &str = "tools.create_object.package_body";
const MENU_ID_TOOLS_CREATE_OBJECT_TRIGGER: &str = "tools.create_object.trigger";
const MENU_ID_TOOLS_CREATE_OBJECT_SEQUENCE: &str = "tools.create_object.sequence";
const MENU_ID_TOOLS_CREATE_OBJECT_TYPE: &str = "tools.create_object.type";
const MENU_ID_TOOLS_CREATE_OBJECT_SYNONYM: &str = "tools.create_object.synonym";
const EVENT_OPEN_SETTINGS_DIALOG: &str = "clarity://open-settings-dialog";
const EVENT_CHECK_FOR_UPDATES: &str = "clarity://check-for-updates";
const EVENT_OPEN_SCHEMA_SEARCH: &str = "clarity://open-schema-search";
const EVENT_OPEN_EXPORT_DATABASE_DIALOG: &str = "clarity://open-export-database-dialog";
const EVENT_OPEN_CREATE_OBJECT_TEMPLATE: &str = "clarity://open-create-object-template";
const EVENT_SAVE_ACTIVE_QUERY_SHEET: &str = "clarity://save-active-query-sheet";
const EVENT_SAVE_ALL_QUERY_SHEETS: &str = "clarity://save-all-query-sheets";
const EVENT_NAVIGATE_SCRIPT_LINE_BACK: &str = "clarity://navigate-script-line-back";
const EVENT_NAVIGATE_SCRIPT_LINE_FORWARD: &str = "clarity://navigate-script-line-forward";
pub(crate) const EVENT_SCHEMA_EXPORT_PROGRESS: &str = "clarity://schema-export-progress";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateObjectTemplateEventPayload {
    object_type: String,
}

pub(crate) fn build<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let save_active_query_sheet = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_SAVE_ACTIVE_QUERY_SHEET,
        "Save active query sheet...",
        true,
        Some("CmdOrCtrl+S"),
    )?;
    let save_all_query_sheets = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_SAVE_ALL_QUERY_SHEETS,
        "Save all query sheets...",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let navigate_script_line_back = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_NAVIGATE_SCRIPT_LINE_BACK,
        "Navigate Back to Script Line",
        true,
        Some("CmdOrCtrl+Alt+Left"),
    )?;
    let navigate_script_line_forward = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_NAVIGATE_SCRIPT_LINE_FORWARD,
        "Navigate Forward to Script Line",
        true,
        Some("CmdOrCtrl+Alt+Right"),
    )?;
    let create_table = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_TABLE,
        "Table",
        true,
        None::<&str>,
    )?;
    let create_view = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_VIEW,
        "View",
        true,
        None::<&str>,
    )?;
    let create_procedure = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_PROCEDURE,
        "Procedure",
        true,
        None::<&str>,
    )?;
    let create_function = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_FUNCTION,
        "Function",
        true,
        None::<&str>,
    )?;
    let create_package = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_PACKAGE,
        "Package",
        true,
        None::<&str>,
    )?;
    let create_package_body = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_PACKAGE_BODY,
        "Package Body",
        true,
        None::<&str>,
    )?;
    let create_trigger = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_TRIGGER,
        "Trigger",
        true,
        None::<&str>,
    )?;
    let create_sequence = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_SEQUENCE,
        "Sequence",
        true,
        None::<&str>,
    )?;
    let create_type = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_TYPE,
        "Type",
        true,
        None::<&str>,
    )?;
    let create_synonym = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_CREATE_OBJECT_SYNONYM,
        "Synonym",
        true,
        None::<&str>,
    )?;
    let create_object_menu = tauri::menu::Submenu::with_items(
        app,
        "Create Object",
        true,
        &[
            &create_table,
            &create_view,
            &create_procedure,
            &create_function,
            &create_package,
            &create_package_body,
            &create_trigger,
            &create_sequence,
            &create_type,
            &create_synonym,
        ],
    )?;
    let settings = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_SETTINGS,
        "Settings...",
        true,
        None::<&str>,
    )?;
    let check_for_updates = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_HELP_CHECK_FOR_UPDATES,
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    let find_in_schema = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_FIND_IN_SCHEMA,
        "Find in Schema...",
        true,
        Some("CmdOrCtrl+Shift+F"),
    )?;
    let export_database = tauri::menu::MenuItem::with_id(
        app,
        MENU_ID_TOOLS_EXPORT_DATABASE,
        "Export database...",
        true,
        None::<&str>,
    )?;
    let query_menu = tauri::menu::Submenu::with_items(
        app,
        "Query",
        true,
        &[
            &save_active_query_sheet,
            &save_all_query_sheets,
            &navigate_script_line_back,
            &navigate_script_line_forward,
        ],
    )?;
    let database_menu = tauri::menu::Submenu::with_items(
        app,
        "Database",
        true,
        &[&create_object_menu, &find_in_schema, &export_database],
    )?;
    let menu = tauri::menu::Menu::default(app)?;
    let existing_items = menu.items()?;
    let help_position = existing_items
        .iter()
        .position(|item| item.id() == tauri::menu::HELP_SUBMENU_ID)
        .unwrap_or(existing_items.len());
    let help_menu = existing_items
        .iter()
        .find(|item| item.id() == tauri::menu::HELP_SUBMENU_ID)
        .and_then(|item| item.as_submenu());
    #[cfg(target_os = "macos")]
    let app_menu = existing_items.iter().find_map(|item| {
        let submenu = item.as_submenu()?;
        let text = submenu.text().ok()?;
        if text == app.package_info().name {
            Some(submenu.clone())
        } else {
            None
        }
    });

    menu.insert(&query_menu, help_position)?;
    menu.insert(&database_menu, help_position + 1)?;

    #[cfg(target_os = "macos")]
    if let Some(app_menu) = app_menu {
        app_menu.insert(&settings, 1)?;
    } else {
        menu.insert(&settings, help_position + 2)?;
    }

    #[cfg(not(target_os = "macos"))]
    menu.insert(&settings, help_position + 2)?;

    if let Some(help_menu) = help_menu {
        help_menu.insert(&check_for_updates, 0)?;
    } else {
        menu.insert(&check_for_updates, help_position + 3)?;
    }

    Ok(menu)
}

pub(crate) fn handle_event<R: Runtime>(app: &tauri::AppHandle<R>, event_id: &str) {
    let create_object_type = if event_id == MENU_ID_TOOLS_CREATE_OBJECT_TABLE {
        Some("TABLE")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_VIEW {
        Some("VIEW")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_PROCEDURE {
        Some("PROCEDURE")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_FUNCTION {
        Some("FUNCTION")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_PACKAGE {
        Some("PACKAGE")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_PACKAGE_BODY {
        Some("PACKAGE BODY")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_TRIGGER {
        Some("TRIGGER")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_SEQUENCE {
        Some("SEQUENCE")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_TYPE {
        Some("TYPE")
    } else if event_id == MENU_ID_TOOLS_CREATE_OBJECT_SYNONYM {
        Some("SYNONYM")
    } else {
        None
    };

    if let Some(object_type) = create_object_type {
        if let Err(error) = app.emit(
            EVENT_OPEN_CREATE_OBJECT_TEMPLATE,
            CreateObjectTemplateEventPayload {
                object_type: object_type.to_string(),
            },
        ) {
            eprintln!("failed to emit create object template event: {error}");
        }
    } else if event_id == MENU_ID_TOOLS_SETTINGS {
        emit_unit_event(app, EVENT_OPEN_SETTINGS_DIALOG, "open settings");
    } else if event_id == MENU_ID_HELP_CHECK_FOR_UPDATES {
        emit_unit_event(app, EVENT_CHECK_FOR_UPDATES, "check for updates");
    } else if event_id == MENU_ID_TOOLS_SAVE_ACTIVE_QUERY_SHEET {
        emit_unit_event(
            app,
            EVENT_SAVE_ACTIVE_QUERY_SHEET,
            "save active query sheet",
        );
    } else if event_id == MENU_ID_TOOLS_SAVE_ALL_QUERY_SHEETS {
        emit_unit_event(app, EVENT_SAVE_ALL_QUERY_SHEETS, "save all query sheets");
    } else if event_id == MENU_ID_TOOLS_NAVIGATE_SCRIPT_LINE_BACK {
        emit_unit_event(
            app,
            EVENT_NAVIGATE_SCRIPT_LINE_BACK,
            "navigate back script line",
        );
    } else if event_id == MENU_ID_TOOLS_NAVIGATE_SCRIPT_LINE_FORWARD {
        emit_unit_event(
            app,
            EVENT_NAVIGATE_SCRIPT_LINE_FORWARD,
            "navigate forward script line",
        );
    } else if event_id == MENU_ID_TOOLS_FIND_IN_SCHEMA {
        emit_unit_event(app, EVENT_OPEN_SCHEMA_SEARCH, "open schema search");
    } else if event_id == MENU_ID_TOOLS_EXPORT_DATABASE {
        emit_unit_event(app, EVENT_OPEN_EXPORT_DATABASE_DIALOG, "export database");
    }
}

fn emit_unit_event<R: Runtime>(app: &tauri::AppHandle<R>, event_name: &str, label: &str) {
    if let Err(error) = app.emit(event_name, ()) {
        eprintln!("failed to emit {label} event: {error}");
    }
}
