use cdrivecleaner_contracts::{
    CategoryMetadata, CleanResponse, DeletePathsResponse, ElevationRequirement,
    ExportArtifact, FullScanTreeNode, FullScanTreeResponse, HistoryResponse,
    ScanExportPayload, ScanResponse, ScheduledScanPlan, ScheduledScanPlanDraft,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsMetadata {
    app_version: String,
    log_directory: String,
}

#[derive(Default)]
struct LoadedFullScanRegistry {
    roots: Mutex<HashMap<String, HashSet<String>>>,
}

fn normalize_registry_path(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\").to_ascii_lowercase()
    } else {
        path.to_string()
    }
}

fn collect_loaded_node_paths(node: &FullScanTreeNode, target: &mut HashSet<String>) {
    target.insert(normalize_registry_path(&node.path));
    for child in &node.children {
        collect_loaded_node_paths(child, target);
    }
}

impl LoadedFullScanRegistry {
    fn replace_root(&self, root_path: &str, tree: &FullScanTreeNode) -> Result<(), String> {
        let mut loaded_paths = HashSet::new();
        collect_loaded_node_paths(tree, &mut loaded_paths);
        self.roots
            .lock()
            .map_err(|_| String::from("full scan registry lock poisoned"))?
            .insert(normalize_registry_path(root_path), loaded_paths);
        Ok(())
    }

    fn extend_root(&self, root_path: &str, tree: &FullScanTreeNode) -> Result<(), String> {
        let mut loaded_paths = HashSet::new();
        collect_loaded_node_paths(tree, &mut loaded_paths);
        let mut roots = self
            .roots
            .lock()
            .map_err(|_| String::from("full scan registry lock poisoned"))?;
        roots.entry(normalize_registry_path(root_path))
            .or_default()
            .extend(loaded_paths);
        Ok(())
    }

    fn ensure_loaded_path(&self, root_path: &str, path: &str) -> Result<(), String> {
        let roots = self
            .roots
            .lock()
            .map_err(|_| String::from("full scan registry lock poisoned"))?;
        let normalized_root = normalize_registry_path(root_path);
        let normalized_path = normalize_registry_path(path);
        let Some(loaded_paths) = roots.get(&normalized_root) else {
            return Err(String::from(
                "selected-path actions require a fresh full scan before preview or delete",
            ));
        };
        if loaded_paths.contains(&normalized_path) {
            return Ok(());
        }
        Err(format!(
            "selected path is not part of the currently loaded full scan: {path}"
        ))
    }

    fn ensure_loaded_paths(&self, root_path: &str, paths: &[String]) -> Result<(), String> {
        for path in paths {
            self.ensure_loaded_path(root_path, path)?;
        }
        Ok(())
    }

    fn clear_root(&self, root_path: &str) -> Result<(), String> {
        self.roots
            .lock()
            .map_err(|_| String::from("full scan registry lock poisoned"))?
            .remove(&normalize_registry_path(root_path));
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn is_process_elevated() -> bool {
    use std::mem::size_of;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token_handle = null_mut();
    let opened = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token_handle) };
    if opened == 0 {
        return false;
    }

    let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
    let mut returned_size = 0;
    let ok = unsafe {
        GetTokenInformation(
            token_handle,
            TokenElevation,
            &mut elevation as *mut TOKEN_ELEVATION as *mut _,
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned_size,
        )
    };
    unsafe {
        CloseHandle(token_handle);
    }

    ok != 0 && elevation.TokenIsElevated != 0
}

#[cfg(not(target_os = "windows"))]
fn is_process_elevated() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn restart_as_administrator_impl() -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if is_process_elevated() {
        return Ok(());
    }

    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let working_directory = executable.parent().unwrap_or_else(|| std::path::Path::new("."));

    let verb = OsStr::new("runas").encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let file = executable.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let directory = working_directory.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();

    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            null(),
            directory.as_ptr(),
            SW_SHOWNORMAL,
        )
    } as isize;

    if result <= 32 {
        return Err(format!("failed to relaunch as administrator (ShellExecuteW={result})"));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn restart_as_administrator_impl() -> Result<(), String> {
    Err(String::from(
        "authorization mode is only available on Windows desktop builds",
    ))
}

#[cfg(target_os = "windows")]
fn scheduled_task_name(plan_id: &str) -> String {
    format!("CDriveCleaner Scheduled Scan - {plan_id}")
}

#[cfg(target_os = "windows")]
fn build_schtasks_create_args(executable: &std::path::Path, plan: &ScheduledScanPlan) -> Vec<String> {
    let mut args = vec![
        String::from("/Create"),
        String::from("/F"),
        String::from("/SC"),
        String::from("DAILY"),
        String::from("/TN"),
        scheduled_task_name(&plan.id),
        String::from("/ST"),
        plan.scheduled_time.clone(),
        String::from("/TR"),
        format!(
            "\"{}\" --scheduled-safe-scan --plan-id {}",
            executable.display(),
            plan.id
        ),
    ];

    if plan.requires_admin {
        args.push(String::from("/RL"));
        args.push(String::from("HIGHEST"));
    }

    args
}

#[cfg(target_os = "windows")]
fn build_schtasks_enable_args(plan_id: &str, enabled: bool) -> Vec<String> {
    vec![
        String::from("/Change"),
        String::from("/TN"),
        scheduled_task_name(plan_id),
        if enabled { String::from("/ENABLE") } else { String::from("/DISABLE") },
    ]
}

#[cfg(target_os = "windows")]
fn build_schtasks_delete_args(plan_id: &str) -> Vec<String> {
    vec![
        String::from("/Delete"),
        String::from("/F"),
        String::from("/TN"),
        scheduled_task_name(plan_id),
    ]
}

#[cfg(target_os = "windows")]
fn run_schtasks(args: &[String]) -> Result<(), String> {
    let output = std::process::Command::new("schtasks")
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if !stderr.is_empty() { stderr } else { stdout })
}

#[cfg(target_os = "windows")]
fn scheduled_scan_task_exists(plan_id: &str) -> Result<bool, String> {
    let output = std::process::Command::new("schtasks")
        .args(["/Query", "/TN", &scheduled_task_name(plan_id)])
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(true);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
    if stderr.contains("cannot find") || stdout.contains("cannot find") {
        return Ok(false);
    }

    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

#[cfg(not(target_os = "windows"))]
fn scheduled_scan_task_exists(_plan_id: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "windows")]
fn register_scheduled_scan_task(plan: &ScheduledScanPlan) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    run_schtasks(&build_schtasks_create_args(&executable, plan))?;
    if !plan.enabled {
        if let Err(error) = run_schtasks(&build_schtasks_enable_args(&plan.id, false)) {
            let _ = delete_scheduled_scan_task(&plan.id);
            return Err(error);
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_scheduled_scan_task_enabled(plan_id: &str, enabled: bool) -> Result<(), String> {
    run_schtasks(&build_schtasks_enable_args(plan_id, enabled))
}

#[cfg(target_os = "windows")]
fn delete_scheduled_scan_task(plan_id: &str) -> Result<(), String> {
    run_schtasks(&build_schtasks_delete_args(plan_id))
}

#[cfg(not(target_os = "windows"))]
fn register_scheduled_scan_task(_plan: &ScheduledScanPlan) -> Result<(), String> {
    Err(String::from("scheduled scan is only available on Windows desktop builds"))
}

#[cfg(not(target_os = "windows"))]
fn set_scheduled_scan_task_enabled(_plan_id: &str, _enabled: bool) -> Result<(), String> {
    Err(String::from("scheduled scan is only available on Windows desktop builds"))
}

#[cfg(not(target_os = "windows"))]
fn delete_scheduled_scan_task(_plan_id: &str) -> Result<(), String> {
    Err(String::from("scheduled scan is only available on Windows desktop builds"))
}

fn scheduled_scan_plan_id_from_args() -> Option<String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    for window in args.windows(3) {
        if window[0] == "--scheduled-safe-scan" && window[1] == "--plan-id" {
            return Some(window[2].clone());
        }
    }
    None
}

fn run_scheduled_scan_from_args(plan_id: &str) -> Result<(), String> {
    cdrivecleaner_core::execute_scheduled_scan_plan(plan_id)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_categories() -> Vec<CategoryMetadata> {
    cdrivecleaner_core::list_categories()
}

#[tauri::command]
fn get_history() -> HistoryResponse {
    cdrivecleaner_core::current_history()
}

#[tauri::command]
fn get_settings_metadata(app: AppHandle) -> SettingsMetadata {
    SettingsMetadata {
        app_version: app.package_info().version.to_string(),
        log_directory: cdrivecleaner_core::current_history_store_dir()
            .display()
            .to_string(),
    }
}

#[tauri::command]
fn get_scheduled_scan_plan() -> Result<Option<ScheduledScanPlan>, String> {
    let plan = cdrivecleaner_core::current_scheduled_scan_plan().map_err(|error| error.to_string())?;
    match plan {
        Some(mut plan) if !scheduled_scan_task_exists(&plan.id)? => {
            plan.enabled = false;
            plan.next_run_at = None;
            Ok(Some(plan))
        }
        other => Ok(other),
    }
}

#[tauri::command]
fn save_scheduled_scan_plan(draft: ScheduledScanPlanDraft) -> Result<ScheduledScanPlan, String> {
    let previous = cdrivecleaner_core::current_scheduled_scan_plan().map_err(|error| error.to_string())?;
    let plan = cdrivecleaner_core::save_scheduled_scan_plan(&draft).map_err(|error| error.to_string())?;
    if let Err(error) = register_scheduled_scan_task(&plan) {
        cdrivecleaner_core::restore_scheduled_scan_plan(previous.as_ref()).map_err(|restore_error| restore_error.to_string())?;
        match previous {
            Some(previous) => {
                let _ = register_scheduled_scan_task(&previous);
            }
            None => {
                let _ = delete_scheduled_scan_task(&plan.id);
            }
        }
        return Err(error);
    }
    Ok(plan)
}

#[tauri::command]
fn set_scheduled_scan_plan_enabled(enabled: bool) -> Result<ScheduledScanPlan, String> {
    let previous = cdrivecleaner_core::current_scheduled_scan_plan().map_err(|error| error.to_string())?;
    let plan = cdrivecleaner_core::set_scheduled_scan_plan_enabled(enabled).map_err(|error| error.to_string())?;
    if let Err(error) = set_scheduled_scan_task_enabled(&plan.id, enabled) {
        cdrivecleaner_core::restore_scheduled_scan_plan(previous.as_ref()).map_err(|restore_error| restore_error.to_string())?;
        if let Some(previous) = previous {
            let _ = set_scheduled_scan_task_enabled(&previous.id, previous.enabled);
        }
        return Err(error);
    }
    Ok(plan)
}

#[tauri::command]
fn delete_scheduled_scan_plan() -> Result<(), String> {
    if let Some(plan) = cdrivecleaner_core::current_scheduled_scan_plan().map_err(|error| error.to_string())? {
        if scheduled_scan_task_exists(&plan.id)? {
            delete_scheduled_scan_task(&plan.id)?;
        }
    }
    cdrivecleaner_core::delete_scheduled_scan_plan().map_err(|error| error.to_string())
}

#[tauri::command]
fn export_scan_report(payload: ScanExportPayload) -> Result<ExportArtifact, String> {
    cdrivecleaner_core::export_scan_report(&payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_history(history: HistoryResponse) -> Result<ExportArtifact, String> {
    cdrivecleaner_core::export_history(&history).map_err(|error| error.to_string())
}

#[tauri::command]
fn analyze_elevation(category_ids: Vec<String>) -> ElevationRequirement {
    let mut requirement = cdrivecleaner_core::analyze_elevation(&category_ids);
    requirement.is_process_elevated = is_process_elevated();
    requirement.requires_elevation = !requirement.is_process_elevated && !requirement.admin_category_ids.is_empty();
    requirement
}

#[tauri::command]
fn restart_as_administrator(app: AppHandle) -> Result<(), String> {
    restart_as_administrator_impl()?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn scan_safe_defaults() -> Result<ScanResponse, String> {
    cdrivecleaner_core::scan_safe_defaults_for_current_machine().map_err(|error| error.to_string())
}

#[tauri::command]
fn scan_categories(category_ids: Vec<String>) -> Result<ScanResponse, String> {
    cdrivecleaner_core::scan_categories_for_current_machine(&category_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clean_safe_defaults() -> Result<CleanResponse, String> {
    cdrivecleaner_core::clean_safe_defaults_for_current_machine().map_err(|error| error.to_string())
}

#[tauri::command]
fn clean_categories(category_ids: Vec<String>) -> Result<CleanResponse, String> {
    cdrivecleaner_core::clean_categories_for_current_machine(&category_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn preview_selected_paths(
    registry: State<'_, LoadedFullScanRegistry>,
    root_path: String,
    paths: Vec<String>,
) -> Result<DeletePathsResponse, String> {
    registry.ensure_loaded_paths(&root_path, &paths)?;
    cdrivecleaner_core::preview_selected_paths(std::path::Path::new(&root_path), &paths)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_selected_paths(
    registry: State<'_, LoadedFullScanRegistry>,
    root_path: String,
    paths: Vec<String>,
) -> Result<DeletePathsResponse, String> {
    registry.ensure_loaded_paths(&root_path, &paths)?;
    let response = cdrivecleaner_core::delete_selected_paths(std::path::Path::new(&root_path), &paths)
        .map_err(|error| error.to_string())?;
    registry.clear_root(&root_path)?;
    Ok(response)
}

#[tauri::command]
async fn scan_full_tree(
    app: AppHandle,
    registry: State<'_, LoadedFullScanRegistry>,
    root_path: Option<String>,
) -> Result<FullScanTreeResponse, String> {
    let response = tauri::async_runtime::spawn_blocking(move || {
        let mut emit_progress = |progress| {
            let _ = app.emit("full-scan-progress", progress);
        };

        match root_path {
            Some(root_path) => cdrivecleaner_core::scan_full_tree_with_progress(
                std::path::Path::new(&root_path),
                &mut emit_progress,
            ),
            None => cdrivecleaner_core::scan_full_tree_for_current_machine_with_progress(&mut emit_progress),
        }
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    registry.replace_root(&response.root_path, &response.tree)?;
    Ok(response)
}

#[tauri::command]
async fn expand_full_scan_node(
    registry: State<'_, LoadedFullScanRegistry>,
    root_path: String,
    node_path: String,
) -> Result<FullScanTreeNode, String> {
    registry.ensure_loaded_path(&root_path, &node_path)?;
    let registry_root_path = root_path.clone();
    let node = tauri::async_runtime::spawn_blocking(move || {
        cdrivecleaner_core::expand_full_scan_node(
            std::path::Path::new(&root_path),
            std::path::Path::new(&node_path),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    registry.extend_root(&registry_root_path, &node)?;
    Ok(node)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> i32 {
    if let Some(plan_id) = scheduled_scan_plan_id_from_args() {
        if let Err(error) = run_scheduled_scan_from_args(&plan_id) {
            eprintln!("{error}");
            return 1;
        }
        return 0;
    }

    tauri::Builder::default()
        .manage(LoadedFullScanRegistry::default())
        .invoke_handler(tauri::generate_handler![
            list_categories,
            get_history,
            get_settings_metadata,
            get_scheduled_scan_plan,
            save_scheduled_scan_plan,
            set_scheduled_scan_plan_enabled,
            delete_scheduled_scan_plan,
            export_scan_report,
            export_history,
            analyze_elevation,
            restart_as_administrator,
            scan_safe_defaults,
            scan_categories,
            clean_safe_defaults,
            clean_categories,
            preview_selected_paths,
            delete_selected_paths,
            scan_full_tree,
            expand_full_scan_node
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use cdrivecleaner_contracts::{ScheduledScanMode, ScheduledScanPlan};

    fn sample_full_scan_tree() -> FullScanTreeNode {
        FullScanTreeNode {
            path: String::from(r"C:\"),
            name: String::from(r"C:\"),
            is_directory: true,
            size_bytes: 0,
            has_children: true,
            children_loaded: true,
            warnings: Vec::new(),
            children: vec![FullScanTreeNode {
                path: String::from(r"C:\Temp"),
                name: String::from("Temp"),
                is_directory: true,
                size_bytes: 0,
                has_children: true,
                children_loaded: false,
                warnings: Vec::new(),
                children: Vec::new(),
            }],
        }
    }

    fn sample_plan() -> ScheduledScanPlan {
        ScheduledScanPlan {
            id: String::from("daily-safe-scan"),
            mode: ScheduledScanMode::SafeDefaults,
            scheduled_time: String::from("08:30"),
            enabled: true,
            captured_category_ids: Vec::new(),
            requires_admin: false,
            next_run_at: None,
            last_run_at: None,
            last_run_summary: None,
            last_run_category_count: None,
            last_run_estimated_bytes: None,
            last_run_warnings: None,
        }
    }

    #[test]
    fn scheduled_scan_arg_parser_extracts_plan_id() {
        let args = vec![
            String::from("cdrivecleaner"),
            String::from("--scheduled-safe-scan"),
            String::from("--plan-id"),
            String::from("daily-safe-scan"),
        ];
        let parsed = args.into_iter().skip(1).collect::<Vec<_>>();
        let mut result = None;
        for window in parsed.windows(3) {
            if window[0] == "--scheduled-safe-scan" && window[1] == "--plan-id" {
                result = Some(window[2].clone());
            }
        }
        assert_eq!(Some(String::from("daily-safe-scan")), result);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn create_task_args_use_daily_schedule_and_desktop_executable() {
        let args = build_schtasks_create_args(std::path::Path::new(r"C:\Program Files\CDriveCleaner\CDriveCleaner.exe"), &sample_plan());
        assert!(args.contains(&String::from("/Create")));
        assert!(args.contains(&String::from("DAILY")));
        assert!(args.iter().any(|arg| arg.contains("--scheduled-safe-scan --plan-id daily-safe-scan")));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn enable_task_args_toggle_scheduler_state() {
        assert!(build_schtasks_enable_args("daily-safe-scan", true).contains(&String::from("/ENABLE")));
        assert!(build_schtasks_enable_args("daily-safe-scan", false).contains(&String::from("/DISABLE")));
    }

    #[test]
    fn loaded_full_scan_registry_only_accepts_loaded_nodes() {
        let registry = LoadedFullScanRegistry::default();
        let root = sample_full_scan_tree();

        registry
            .replace_root(r"C:\", &root)
            .expect("registry should store root");

        registry
            .ensure_loaded_paths(r"C:\", &[String::from(r"C:\Temp")])
            .expect("loaded child should be allowed");

        let error = registry
            .ensure_loaded_paths(r"C:\", &[String::from(r"C:\Windows")])
            .expect_err("unloaded path should be rejected");
        assert!(error.contains("not part of the currently loaded full scan"));
    }

    #[test]
    fn loaded_full_scan_registry_accepts_expanded_nodes_and_clears_after_delete() {
        let registry = LoadedFullScanRegistry::default();
        let root = sample_full_scan_tree();

        registry
            .replace_root(r"C:\", &root)
            .expect("registry should store root");

        let expanded = FullScanTreeNode {
            path: String::from(r"C:\Temp"),
            name: String::from("Temp"),
            is_directory: true,
            size_bytes: 0,
            has_children: true,
            children_loaded: true,
            warnings: Vec::new(),
            children: vec![FullScanTreeNode {
                path: String::from(r"C:\Temp\cache.bin"),
                name: String::from("cache.bin"),
                is_directory: false,
                size_bytes: 1024,
                has_children: false,
                children_loaded: false,
                warnings: Vec::new(),
                children: Vec::new(),
            }],
        };

        registry
            .extend_root(r"C:\", &expanded)
            .expect("expanded subtree should register");
        registry
            .ensure_loaded_path(r"C:\", r"C:\Temp\cache.bin")
            .expect("expanded descendant should be allowed");

        registry
            .clear_root(r"C:\")
            .expect("registry clear should succeed");
        let error = registry
            .ensure_loaded_path(r"C:\", r"C:\Temp")
            .expect_err("cleared registry should require a fresh scan");
        assert!(error.contains("require a fresh full scan"));
    }
}
