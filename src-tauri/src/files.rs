use crate::menu::EVENT_SCHEMA_EXPORT_PROGRESS;
use crate::providers::{AppSession, ProviderRegistry};
use crate::types::{
    DbExportSchemaRequest, DbObjectRef, DbSaveQuerySheetRequest, DbSaveQuerySheetsRequest,
    DbSaveQuerySheetsResult, DbSchemaExportProgress, DbSchemaExportResult,
};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub(crate) fn pick_directory() -> Result<Option<String>, String> {
    pick_directory_os()
}

pub(crate) fn save_query_sheet(request: DbSaveQuerySheetRequest) -> Result<Option<String>, String> {
    let suggested_name = normalize_suggested_file_name(request.suggested_file_name.as_str());
    let default_file_name = if suggested_name.to_lowercase().ends_with(".sql") {
        suggested_name
    } else {
        format!("{suggested_name}.sql")
    };

    let selected_path = pick_save_file_os(default_file_name.as_str())?;
    let Some(path_string) = selected_path else {
        return Ok(None);
    };

    let path = PathBuf::from(path_string.as_str());
    write_query_sheet_file(path.as_path(), request.sql.as_str())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

pub(crate) fn save_query_sheets(
    request: DbSaveQuerySheetsRequest,
) -> Result<Option<DbSaveQuerySheetsResult>, String> {
    if request.sheets.is_empty() {
        return Err("No query sheets were provided.".to_string());
    }

    let selected_directory = pick_directory_os()?;
    let Some(directory) = selected_directory else {
        return Ok(None);
    };

    let destination = PathBuf::from(directory.as_str());
    fs::create_dir_all(&destination)
        .map_err(|error| format!("Failed to create destination directory: {error}"))?;

    let mut file_count = 0usize;
    for (index, sheet) in request.sheets.iter().enumerate() {
        let fallback_title = format!("query_{}", index + 1);
        let normalized_title = if sheet.title.trim().is_empty() {
            fallback_title
        } else {
            sheet.title.trim().to_string()
        };
        let file_stem = sanitize_export_file_stem(normalized_title.as_str());
        let base_path = destination.join(format!("{file_stem}.sql"));
        let file_path = unique_export_file_path(base_path);
        write_query_sheet_file(file_path.as_path(), sheet.sql.as_str())?;
        file_count += 1;
    }

    Ok(Some(DbSaveQuerySheetsResult {
        directory,
        file_count,
    }))
}

pub(crate) async fn export_schema(
    request: DbExportSchemaRequest,
    sessions: Arc<Mutex<HashMap<u64, AppSession>>>,
    app: AppHandle,
) -> Result<DbSchemaExportResult, String> {
    tauri::async_runtime::spawn_blocking(move || export_schema_blocking(request, sessions, app))
        .await
        .map_err(|error| format!("Schema export task failed: {error}"))?
}

fn export_schema_blocking(
    request: DbExportSchemaRequest,
    sessions: Arc<Mutex<HashMap<u64, AppSession>>>,
    app: AppHandle,
) -> Result<DbSchemaExportResult, String> {
    let destination_directory = request.destination_directory.trim();
    if destination_directory.is_empty() {
        return Err("Destination directory is required".to_string());
    }

    let destination_path = PathBuf::from(destination_directory);
    fs::create_dir_all(&destination_path)
        .map_err(|error| format!("Failed to create export directory: {error}"))?;

    let sessions = sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    let objects = ProviderRegistry::list_objects(session)?;
    let object_count = objects.len();
    let mut file_count = 0usize;
    let mut processed_objects = 0usize;
    let mut warnings: Vec<String> = Vec::new();
    let _ = app.emit(
        EVENT_SCHEMA_EXPORT_PROGRESS,
        DbSchemaExportProgress {
            processed_objects,
            total_objects: object_count,
            exported_files: file_count,
            skipped_count: 0,
            current_object: String::new(),
        },
    );

    for object in &objects {
        let object_label = format!(
            "{} {}.{}",
            object.object_type, object.schema, object.object_name
        );
        let object_ref = DbObjectRef {
            session_id: request.session_id,
            schema: object.schema.clone(),
            object_type: object.object_type.clone(),
            object_name: object.object_name.clone(),
        };
        let ddl = match ProviderRegistry::get_object_ddl(session, &object_ref) {
            Ok(ddl) => ddl,
            Err(error) => {
                warnings.push(format!("{}: {}", object_label, error));
                processed_objects += 1;
                emit_export_progress(
                    &app,
                    processed_objects,
                    object_count,
                    file_count,
                    &object_label,
                );
                continue;
            }
        };

        let object_type_dir = destination_path.join(normalize_export_object_type_dir_name(
            object.object_type.as_str(),
        ));
        if let Err(error) = fs::create_dir_all(&object_type_dir) {
            warnings.push(format!(
                "{} {}.{}: Failed to create directory '{}': {}",
                object.object_type,
                object.schema,
                object.object_name,
                object_type_dir.to_string_lossy(),
                error
            ));
            processed_objects += 1;
            emit_export_progress(
                &app,
                processed_objects,
                object_count,
                file_count,
                &object_label,
            );
            continue;
        }

        let file_stem = sanitize_export_file_stem(object.object_name.as_str());
        let file_path = unique_export_file_path(object_type_dir.join(format!("{file_stem}.sql")));
        if let Err(error) = fs::write(&file_path, normalize_export_file_content(ddl.as_str())) {
            warnings.push(format!(
                "{} {}.{}: Failed to write '{}': {}",
                object.object_type,
                object.schema,
                object.object_name,
                file_path.to_string_lossy(),
                error
            ));
            processed_objects += 1;
            emit_export_progress(
                &app,
                processed_objects,
                object_count,
                file_count,
                &object_label,
            );
            continue;
        }

        file_count += 1;
        processed_objects += 1;
        emit_export_progress(
            &app,
            processed_objects,
            object_count,
            file_count,
            &object_label,
        );
    }

    let skipped_count = object_count.saturating_sub(file_count);
    let warning_report_path = if warnings.is_empty() {
        None
    } else {
        let report_path = unique_export_file_path(destination_path.join("export_warnings.log"));
        let report_header = format!(
            "Schema export warnings\nDestination: {}\nTotal objects: {}\nExported files: {}\nSkipped: {}\n\n",
            destination_path.to_string_lossy(),
            object_count,
            file_count,
            skipped_count
        );
        let report_body = warnings
            .iter()
            .enumerate()
            .map(|(index, warning)| format!("{}. {}", index + 1, warning))
            .collect::<Vec<_>>()
            .join("\n");
        let report_content = format!("{report_header}{report_body}\n");

        match fs::write(&report_path, report_content) {
            Ok(_) => Some(report_path),
            Err(_) => None,
        }
    };

    let message = if object_count == 0 {
        format!(
            "No schema objects found to export. Destination: {}",
            destination_path.to_string_lossy()
        )
    } else if skipped_count == 0 {
        format!(
            "Schema export complete. Wrote {} file(s) for {} object(s) to {}.",
            file_count,
            object_count,
            destination_path.to_string_lossy()
        )
    } else {
        let mut summary = format!(
            "Schema export completed with warnings. Wrote {} file(s), skipped {} object(s), out of {} object(s). Destination: {}.",
            file_count,
            skipped_count,
            object_count,
            destination_path.to_string_lossy()
        );
        if let Some(path) = warning_report_path {
            summary.push_str(&format!(" See warning log: {}", path.to_string_lossy()));
        }
        summary
    };

    Ok(DbSchemaExportResult {
        destination_directory: destination_path.to_string_lossy().to_string(),
        object_count,
        file_count,
        skipped_count,
        message,
    })
}

fn emit_export_progress(
    app: &AppHandle,
    processed_objects: usize,
    total_objects: usize,
    exported_files: usize,
    current_object: &str,
) {
    let skipped_count = processed_objects.saturating_sub(exported_files);
    let _ = app.emit(
        EVENT_SCHEMA_EXPORT_PROGRESS,
        DbSchemaExportProgress {
            processed_objects,
            total_objects,
            exported_files,
            skipped_count,
            current_object: current_object.to_string(),
        },
    );
}

fn normalize_export_object_type_dir_name(object_type: &str) -> String {
    let normalized = object_type.trim().to_ascii_lowercase();
    let mapped = normalized
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();

    let collapsed = mapped
        .split('_')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("_");

    if collapsed.is_empty() {
        "objects".to_string()
    } else {
        collapsed
    }
}

fn sanitize_export_file_stem(name: &str) -> String {
    let sanitized = name
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '$' || ch == '#' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "object".to_string()
    } else {
        sanitized
    }
}

fn unique_export_file_path(base_path: PathBuf) -> PathBuf {
    if !base_path.exists() {
        return base_path;
    }

    let parent = base_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(PathBuf::new);
    let stem = base_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("object");
    let extension = base_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("sql");

    for index in 2..=10_000 {
        let candidate = parent.join(format!("{stem}_{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!("{stem}_overflow.{extension}"))
}

fn normalize_export_file_content(ddl: &str) -> String {
    let trimmed_end = ddl.trim_end();
    if trimmed_end.is_empty() {
        String::new()
    } else {
        format!("{trimmed_end}\n")
    }
}

fn write_query_sheet_file(path: &Path, sql: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Failed to create directory '{}': {error}", parent.display())
        })?;
    }

    fs::write(path, normalize_export_file_content(sql))
        .map_err(|error| format!("Failed to write query sheet '{}': {error}", path.display()))
}

fn parse_directory_picker_output(
    output: std::process::Output,
    cancel_exit_codes: &[i32],
    fallback_error: &str,
) -> Result<Option<String>, String> {
    if !output.status.success() {
        if let Some(code) = output.status.code() {
            if cancel_exit_codes.contains(&code) {
                return Ok(None);
            }
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            fallback_error.to_string()
        } else {
            format!("{fallback_error}: {stderr}")
        });
    }

    let selected_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected_path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected_path))
    }
}

fn normalize_suggested_file_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "query.sql".to_string();
    }

    let sanitized = trimmed
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();
    let collapsed = sanitized.trim().trim_matches('.');
    if collapsed.is_empty() {
        "query.sql".to_string()
    } else {
        collapsed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_export_file_content, normalize_export_object_type_dir_name,
        normalize_suggested_file_name, parse_directory_picker_output, sanitize_export_file_stem,
        unique_export_file_path, write_query_sheet_file,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::process::{ExitStatus, Output};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    fn exit_status(code: i32) -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(code << 8)
    }

    #[cfg(windows)]
    fn exit_status(code: i32) -> ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        ExitStatus::from_raw(code as u32)
    }

    struct TempTestDir {
        path: PathBuf,
    }

    impl TempTestDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "clarity_files_tests_{name}_{}_{}",
                std::process::id(),
                unique
            ));
            fs::create_dir_all(&path).expect("failed to create temp test directory");
            Self { path }
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn normalizes_object_type_and_file_stems() {
        assert_eq!(
            normalize_export_object_type_dir_name(" Package Body "),
            "package_body"
        );
        assert_eq!(normalize_export_object_type_dir_name("___"), "objects");
        assert_eq!(sanitize_export_file_stem("Orders/2026*?"), "Orders_2026__");
        assert_eq!(sanitize_export_file_stem("   "), "object");
    }

    #[test]
    fn normalizes_suggested_file_name_for_save_dialog() {
        assert_eq!(normalize_suggested_file_name(""), "query.sql");
        assert_eq!(
            normalize_suggested_file_name(r#" report:orders?.sql "#),
            "report_orders_.sql"
        );
        assert_eq!(normalize_suggested_file_name("..."), "query.sql");
    }

    #[test]
    fn picks_unique_export_file_path_when_target_exists() {
        let temp_dir = TempTestDir::new("unique_path");
        let base_path = temp_dir.path.join("schema.sql");
        fs::write(base_path.as_path(), "select 1;").expect("failed to seed base file");

        let next_path = unique_export_file_path(base_path.clone());
        assert_eq!(
            next_path.file_name().and_then(|value| value.to_str()),
            Some("schema_2.sql")
        );

        fs::write(next_path.as_path(), "select 2;").expect("failed to seed second file");
        let third_path = unique_export_file_path(base_path);
        assert_eq!(
            third_path.file_name().and_then(|value| value.to_str()),
            Some("schema_3.sql")
        );
    }

    #[test]
    fn writes_query_sheet_file_with_parent_directories_and_normalized_newline() {
        let temp_dir = TempTestDir::new("write_file");
        let nested_path = temp_dir.path.join("nested/query/test.sql");

        write_query_sheet_file(nested_path.as_path(), "select 1;\n\n")
            .expect("write query sheet should succeed");
        let content =
            fs::read_to_string(nested_path.as_path()).expect("failed to read written sql file");
        assert_eq!(content, "select 1;\n");

        write_query_sheet_file(nested_path.as_path(), "   ")
            .expect("write blank query sheet should succeed");
        let blank_content =
            fs::read_to_string(nested_path.as_path()).expect("failed to read blank sql file");
        assert_eq!(blank_content, "");
    }

    #[test]
    fn normalizes_export_file_content_trailing_whitespace() {
        assert_eq!(
            normalize_export_file_content("create table t;\n\n"),
            "create table t;\n"
        );
        assert_eq!(normalize_export_file_content("   "), "");
    }

    #[test]
    fn parses_directory_picker_output_success_and_cancel_cases() {
        let success = Output {
            status: exit_status(0),
            stdout: b"/tmp/export".to_vec(),
            stderr: Vec::new(),
        };
        let selected = parse_directory_picker_output(success, &[1], "Picker failed")
            .expect("success should parse");
        assert_eq!(selected.as_deref(), Some("/tmp/export"));

        let cancel = Output {
            status: exit_status(1),
            stdout: Vec::new(),
            stderr: b"cancel".to_vec(),
        };
        let canceled = parse_directory_picker_output(cancel, &[1], "Picker failed")
            .expect("cancel should not error");
        assert!(canceled.is_none());

        let failure = Output {
            status: exit_status(2),
            stdout: Vec::new(),
            stderr: b"boom".to_vec(),
        };
        let error = parse_directory_picker_output(failure, &[1], "Picker failed")
            .expect_err("non-cancel failure should error");
        assert_eq!(error, "Picker failed: boom");
    }
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn pick_directory_os() -> Result<Option<String>, String> {
    let script = r#"try
POSIX path of (choose folder with prompt "Select Export Directory")
on error number -128
return ""
end try"#;

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to open directory picker: {error}"))?;

    parse_directory_picker_output(
        output,
        &[],
        "Directory picker returned a non-zero exit code.",
    )
}

#[cfg(target_os = "windows")]
fn pick_directory_os() -> Result<Option<String>, String> {
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select Export Directory"
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
} elseif ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
  [Console]::Out.Write("")
} else {
  [Console]::Error.Write("Directory picker returned unexpected result: $result")
  exit 1
}
"#;

    let output = std::process::Command::new("powershell")
        .arg("-NoProfile")
        .arg("-STA")
        .arg("-Command")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to open directory picker: {error}"))?;

    parse_directory_picker_output(
        output,
        &[],
        "Directory picker returned a non-zero exit code.",
    )
}

#[cfg(target_os = "linux")]
fn pick_directory_os() -> Result<Option<String>, String> {
    match std::process::Command::new("zenity")
        .arg("--file-selection")
        .arg("--directory")
        .arg("--title=Select Export Directory")
        .output()
    {
        Ok(output) => {
            return parse_directory_picker_output(output, &[1], "Directory picker failed")
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to open directory picker: {error}")),
    }

    match std::process::Command::new("kdialog")
        .arg("--getexistingdirectory")
        .arg(".")
        .arg("Select Export Directory")
        .output()
    {
        Ok(output) => parse_directory_picker_output(output, &[1], "Directory picker failed"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(
            "Failed to open directory picker: neither 'zenity' nor 'kdialog' is installed."
                .to_string(),
        ),
        Err(error) => Err(format!("Failed to open directory picker: {error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn pick_directory_os() -> Result<Option<String>, String> {
    Err("Directory picker is not currently supported on this operating system.".to_string())
}

#[cfg(target_os = "macos")]
fn pick_save_file_os(suggested_file_name: &str) -> Result<Option<String>, String> {
    let suggested =
        escape_applescript_string(normalize_suggested_file_name(suggested_file_name).as_str());
    let script = format!(
        r#"try
POSIX path of (choose file name with prompt "Save Query Sheet As" default name "{suggested}")
on error number -128
return ""
end try"#
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to open save dialog: {error}"))?;

    parse_directory_picker_output(output, &[], "Save dialog returned a non-zero exit code.")
}

#[cfg(target_os = "windows")]
fn pick_save_file_os(suggested_file_name: &str) -> Result<Option<String>, String> {
    let suggested = normalize_suggested_file_name(suggested_file_name);
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = "Save Query Sheet"
$dialog.Filter = "SQL files (*.sql)|*.sql|All files (*.*)|*.*"
$dialog.FileName = $env:CLARITY_SUGGESTED_FILE_NAME
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.FileName)
} elseif ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
  [Console]::Out.Write("")
} else {
  [Console]::Error.Write("Save dialog returned unexpected result: $result")
  exit 1
}
"#;

    let output = std::process::Command::new("powershell")
        .arg("-NoProfile")
        .arg("-STA")
        .arg("-Command")
        .arg(script)
        .env("CLARITY_SUGGESTED_FILE_NAME", suggested)
        .output()
        .map_err(|error| format!("Failed to open save dialog: {error}"))?;

    parse_directory_picker_output(output, &[], "Save dialog returned a non-zero exit code.")
}

#[cfg(target_os = "linux")]
fn pick_save_file_os(suggested_file_name: &str) -> Result<Option<String>, String> {
    let suggested = normalize_suggested_file_name(suggested_file_name);
    let zenity_default = format!("./{suggested}");
    match std::process::Command::new("zenity")
        .arg("--file-selection")
        .arg("--save")
        .arg("--confirm-overwrite")
        .arg("--title=Save Query Sheet")
        .arg("--filename")
        .arg(zenity_default.as_str())
        .output()
    {
        Ok(output) => return parse_directory_picker_output(output, &[1], "Save dialog failed"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to open save dialog: {error}")),
    }

    let kdialog_default = format!("./{suggested}");
    match std::process::Command::new("kdialog")
        .arg("--getsavefilename")
        .arg(kdialog_default.as_str())
        .arg("*.sql | SQL files")
        .arg("--title")
        .arg("Save Query Sheet")
        .output()
    {
        Ok(output) => parse_directory_picker_output(output, &[1], "Save dialog failed"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(
            "Failed to open save dialog: neither 'zenity' nor 'kdialog' is installed.".to_string(),
        ),
        Err(error) => Err(format!("Failed to open save dialog: {error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn pick_save_file_os(_suggested_file_name: &str) -> Result<Option<String>, String> {
    Err("Save dialog is not currently supported on this operating system.".to_string())
}
