use cdrivecleaner_contracts::{
    CategoryMetadata, CleanResponse, CleanupExecutionResult, CleanupExecutionSummary,
    CleanupRiskTier, CleanupScanResult, CleanupScanSummary, CleanupWarning, DeletePathsResponse,
    ElevationRequirement, ExportArtifact, FullScanProgress, FullScanProgressPhase,
    FullScanTreeNode, FullScanTreeResponse, HistoryEntry, HistoryOrigin, HistoryResponse, PathCleanupResult,
    PathCleanupSummary, ScanExportPayload, ScanResponse, ScheduledScanMode,
    ScheduledScanPlan, ScheduledScanPlanDraft, WarningCode, WarningSeverity,
};
use rayon::prelude::*;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("scan is not implemented yet")]
    ScanNotImplemented,
    #[error("clean is not implemented yet")]
    CleanNotImplemented,
    #[error("invalid scan root for category '{category_id}': {path}")]
    InvalidScanRoot { category_id: String, path: String },
    #[error("io failure while scanning '{path}': {message}")]
    ScanIo { path: String, message: String },
    #[error("io failure while storing history at '{path}': {message}")]
    HistoryIo { path: String, message: String },
    #[error("io failure while exporting data at '{path}': {message}")]
    ExportIo { path: String, message: String },
    #[error("io failure while storing scheduled scan plan at '{path}': {message}")]
    ScheduledScanPlanIo { path: String, message: String },
    #[error("invalid scheduled scan time '{value}'")]
    InvalidScheduledTime { value: String },
    #[error("prepared preset scheduling requires at least one category")]
    EmptyPreparedPreset,
    #[error("scheduled scan plan '{plan_id}' is disabled")]
    ScheduledScanPlanDisabled { plan_id: String },
    #[error("scheduled scan plan '{plan_id}' was not found")]
    ScheduledScanPlanNotFound { plan_id: String },
    #[error("invalid full scan node path '{node_path}' outside root '{root_path}'")]
    InvalidTreeNodePath {
        root_path: String,
        node_path: String,
    },
    #[error("no categories selected")]
    NoCategoriesSelected,
    #[error("unknown categories: {category_ids}")]
    UnknownCategories { category_ids: String },
    #[error("no paths selected")]
    NoPathsSelected,
    #[error("invalid delete path: {path}")]
    InvalidDeletePath { path: String },
}

const LOCKED_FILE_NAME: &str = "locked.bin";

fn warning(code: WarningCode, severity: WarningSeverity, message: String) -> CleanupWarning {
    CleanupWarning {
        code,
        severity,
        message,
    }
}

fn inaccessible_root_warning(root: &Path) -> CleanupWarning {
    warning(
        WarningCode::InaccessibleRoot,
        WarningSeverity::Attention,
        format!("Skipped inaccessible root: {}", root.display()),
    )
}

fn directory_read_warning(path: &Path, error: &std::io::Error) -> CleanupWarning {
    warning(
        WarningCode::DirectoryReadFailed,
        WarningSeverity::Attention,
        format!("Skipped directory '{}': {}", path.display(), error),
    )
}

fn directory_entry_warning(path: &Path, error: &std::io::Error) -> CleanupWarning {
    warning(
        WarningCode::DirectoryEntryReadFailed,
        WarningSeverity::Info,
        format!("Skipped directory entry in '{}': {}", path.display(), error),
    )
}

fn entry_type_warning(path: &Path, error: &std::io::Error) -> CleanupWarning {
    warning(
        WarningCode::EntryTypeReadFailed,
        WarningSeverity::Info,
        format!("Skipped entry type for '{}': {}", path.display(), error),
    )
}

fn file_info_warning(path: &Path, error: &std::io::Error) -> CleanupWarning {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        return file_info_access_denied_warning(path);
    }

    warning(
        WarningCode::FileInfoReadFailed,
        WarningSeverity::Info,
        format!("Skipped file info for '{}': {}", path.display(), error),
    )
}

fn file_info_access_denied_warning(path: &Path) -> CleanupWarning {
    warning(
        WarningCode::FileInfoAccessDenied,
        WarningSeverity::Info,
        format!(
            "Skipped file info for '{}': Access is denied.",
            path.display()
        ),
    )
}

fn path_scan_warning(path: &Path, message: &str) -> CleanupWarning {
    warning(
        WarningCode::PathScanFailed,
        WarningSeverity::Attention,
        format!("Skipped path '{}': {}", path.display(), message),
    )
}

fn unsupported_category_warning(category: &CategoryMetadata) -> CleanupWarning {
    warning(
        WarningCode::PathScanFailed,
        WarningSeverity::Attention,
        format!(
            "Category '{}' is not wired to a scan root in the current build.",
            category.id
        ),
    )
}

fn file_delete_access_denied_warning(path: &Path) -> CleanupWarning {
    warning(
        WarningCode::FileDeleteAccessDenied,
        WarningSeverity::Attention,
        format!("Skipped file '{}': Access is denied.", path.display()),
    )
}

fn file_delete_warning(path: &Path, error: &std::io::Error) -> CleanupWarning {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        return file_delete_access_denied_warning(path);
    }

    warning(
        WarningCode::FileDeleteFailed,
        WarningSeverity::Attention,
        format!("Skipped file '{}': {}", path.display(), error),
    )
}

fn path_delete_warning(path: &Path, error: &std::io::Error) -> CleanupWarning {
    warning(
        WarningCode::FileDeleteFailed,
        WarningSeverity::Attention,
        format!("Skipped path '{}': {}", path.display(), error),
    )
}

fn linked_delete_target_warning(path: &Path) -> CleanupWarning {
    path_scan_warning(
        path,
        "symbolic links and junctions are not supported in selected-path cleanup",
    )
}

#[derive(Clone, Debug)]
pub struct SafeDefaultScanRoots {
    pub user_temp: PathBuf,
    pub thumbnail_cache: PathBuf,
    pub shader_cache: PathBuf,
}

fn local_app_data_root() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .map(|root| root.join("AppData").join("Local"))
        })
        .unwrap_or_else(|| PathBuf::from(r"C:\Users\Default\AppData\Local"))
}

fn temp_root() -> PathBuf {
    env::var_os("TEMP")
        .or_else(|| env::var_os("TMP"))
        .map(PathBuf::from)
        .unwrap_or_else(|| local_app_data_root().join("Temp"))
}

fn system_drive_root() -> PathBuf {
    let system_drive = env::var("SystemDrive").unwrap_or_else(|_| String::from("C:"));
    PathBuf::from(format!("{}\\", system_drive.trim_end_matches(['\\', '/'])))
}

fn windows_root() -> PathBuf {
    env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| system_drive_root().join("Windows"))
}

fn program_data_root() -> PathBuf {
    env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| system_drive_root().join("ProgramData"))
}

fn collect_profile_child_dirs(root: &Path, child: &str) -> Vec<PathBuf> {
    let mut matches = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                matches.push(path.join(child));
            }
        }
    }
    matches
}

fn collect_chromium_cache_roots(root: &Path) -> Vec<PathBuf> {
    let mut matches = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name == "default" || name.starts_with("profile ") {
                matches.push(path.join("Cache"));
                matches.push(path.join("Code Cache"));
            }
        }
    }
    matches
}

fn category_roots_from_environment(category: &CategoryMetadata) -> Vec<PathBuf> {
    match category.id.as_str() {
        "user-temp" => vec![temp_root()],
        "windows-temp" => vec![windows_root().join("Temp")],
        "windows-error-reporting" => vec![
            local_app_data_root()
                .join("Microsoft")
                .join("Windows")
                .join("WER")
                .join("ReportArchive"),
            local_app_data_root()
                .join("Microsoft")
                .join("Windows")
                .join("WER")
                .join("ReportQueue"),
            local_app_data_root()
                .join("Microsoft")
                .join("Windows")
                .join("WER")
                .join("Temp"),
        ],
        "thumbnail-cache" | "icon-cache" => vec![local_app_data_root()
            .join("Microsoft")
            .join("Windows")
            .join("Explorer")],
        "browser-cache" => {
            let mut roots = Vec::new();
            roots.extend(collect_chromium_cache_roots(
                &local_app_data_root()
                    .join("Google")
                    .join("Chrome")
                    .join("User Data"),
            ));
            roots.extend(collect_chromium_cache_roots(
                &local_app_data_root()
                    .join("Microsoft")
                    .join("Edge")
                    .join("User Data"),
            ));
            roots.extend(collect_chromium_cache_roots(
                &local_app_data_root()
                    .join("BraveSoftware")
                    .join("Brave-Browser")
                    .join("User Data"),
            ));
            roots.extend(collect_profile_child_dirs(
                &local_app_data_root()
                    .join("Mozilla")
                    .join("Firefox")
                    .join("Profiles"),
                "cache2",
            ));
            roots
        }
        "shader-cache" => vec![local_app_data_root().join("D3DSCache")],
        "crash-dumps" => vec![local_app_data_root().join("CrashDumps")],
        "windows-update-download" => {
            vec![windows_root().join("SoftwareDistribution").join("Download")]
        }
        "windows-old" => vec![system_drive_root().join("Windows.old")],
        "delivery-optimization-cache" => vec![program_data_root()
            .join("Microsoft")
            .join("Windows")
            .join("DeliveryOptimization")
            .join("Cache")],
        "setup-logs" => vec![
            windows_root().join("Panther"),
            windows_root().join("Logs").join("MoSetup"),
            system_drive_root()
                .join("$WINDOWS.~BT")
                .join("Sources")
                .join("Panther"),
            system_drive_root()
                .join("$WINDOWS.~WS")
                .join("Sources")
                .join("Panther"),
        ],
        "recycle-bin" => vec![system_drive_root().join("$Recycle.Bin")],
        _ => Vec::new(),
    }
}

fn full_scan_root_from_environment() -> PathBuf {
    if let Some(explicit) = env::var_os("CDRIVECLEANER_FULL_SCAN_ROOT") {
        return PathBuf::from(explicit);
    }

    let system_drive = env::var("SystemDrive").unwrap_or_else(|_| String::from("C:"));
    PathBuf::from(format!("{}\\", system_drive.trim_end_matches(['\\', '/'])))
}

#[cfg(target_os = "windows")]
fn display_scan_path(path: &Path) -> String {
    let raw = path.display().to_string().replace('/', "\\");
    if let Some(stripped) = raw.strip_prefix("\\\\?\\UNC\\") {
        return format!(r"\\{}", stripped);
    }
    if let Some(stripped) = raw.strip_prefix("\\\\?\\") {
        return stripped.to_string();
    }
    raw
}

#[cfg(not(target_os = "windows"))]
fn display_scan_path(path: &Path) -> String {
    path.display().to_string()
}

fn normalize_windowsish_path(path: &Path) -> String {
    display_scan_path(path)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn is_known_protected_full_scan_path(path: &Path) -> bool {
    let normalized = normalize_windowsish_path(path);
    let system_drive = env::var("SystemDrive")
        .unwrap_or_else(|_| String::from("C:"))
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase();
    let protected_prefixes = [
        format!(r"{}\perflogs", system_drive),
        format!(r"{}\users\temp", system_drive),
        format!(r"{}\system volume information", system_drive),
        format!(r"{}\$recycle.bin", system_drive),
    ];

    protected_prefixes
        .iter()
        .any(|prefix| normalized == *prefix || normalized.starts_with(&format!(r"{}\", prefix)))
}

fn should_suppress_full_scan_warning(path: &Path, message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let denied = lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("os error 5")
        || lower.contains("error 5")
        || message.contains("拒绝访问")
        || message.contains("访问被拒绝")
        || message.contains("权限不足")
        || message.contains("错误 5");

    denied && is_known_protected_full_scan_path(path)
}

#[derive(Default)]
struct FullScanProgressTracker {
    directories_scanned: u32,
    files_scanned: u32,
    warnings_count: u32,
    last_emit: Option<Instant>,
}

const FULL_SCAN_PROGRESS_MIN_INTERVAL_MS: u64 = 180;
const FULL_SCAN_PROGRESS_DIRECTORY_BATCH: u32 = 12;
const FULL_SCAN_PROGRESS_FILE_BATCH: u32 = 256;

impl FullScanProgressTracker {
    fn snapshot(&self, phase: FullScanProgressPhase, current_path: &Path) -> FullScanProgress {
        FullScanProgress {
            phase,
            current_path: display_scan_path(current_path),
            directories_scanned: self.directories_scanned,
            files_scanned: self.files_scanned,
            warnings_count: self.warnings_count,
        }
    }

    fn maybe_emit<F>(
        &mut self,
        phase: FullScanProgressPhase,
        current_path: &Path,
        force: bool,
        on_progress: &mut F,
    ) where
        F: FnMut(FullScanProgress),
    {
        if !force {
            if let Some(last_emit) = self.last_emit {
                if last_emit.elapsed() < Duration::from_millis(FULL_SCAN_PROGRESS_MIN_INTERVAL_MS) {
                    return;
                }
            }
        }

        self.last_emit = Some(Instant::now());
        on_progress(self.snapshot(phase, current_path));
    }

    fn record_directory<F>(&mut self, current_path: &Path, on_progress: &mut F)
    where
        F: FnMut(FullScanProgress),
    {
        self.directories_scanned += 1;
        let total_items = self.directories_scanned + self.files_scanned;
        self.maybe_emit(
            FullScanProgressPhase::Scanning,
            current_path,
            total_items <= 1 || self.directories_scanned % FULL_SCAN_PROGRESS_DIRECTORY_BATCH == 0,
            on_progress,
        );
    }

    fn record_file<F>(&mut self, current_path: &Path, on_progress: &mut F)
    where
        F: FnMut(FullScanProgress),
    {
        self.files_scanned += 1;
        let total_items = self.directories_scanned + self.files_scanned;
        self.maybe_emit(
            FullScanProgressPhase::Scanning,
            current_path,
            total_items <= 1 || self.files_scanned % FULL_SCAN_PROGRESS_FILE_BATCH == 0,
            on_progress,
        );
    }

    fn record_warning(&mut self) {
        self.warnings_count += 1;
    }
}

fn is_root_delete_target(path: &Path) -> bool {
    path.parent().is_none()
}

#[cfg(windows)]
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;

fn is_delete_link_metadata(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    #[cfg(not(windows))]
    {
        false
    }
}

fn reject_linked_delete_target(path: &Path) -> Result<(), CoreError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| CoreError::InvalidDeletePath {
        path: format!("{} ({})", path.display(), error),
    })?;

    if is_delete_link_metadata(&metadata) {
        return Err(CoreError::InvalidDeletePath {
            path: format!(
                "{} (symbolic links and junctions are not supported in selected-path cleanup)",
                path.display()
            ),
        });
    }

    Ok(())
}

fn validate_delete_path_chain(root: &Path, path: &Path) -> Result<fs::Metadata, CoreError> {
    if !path.starts_with(root) {
        return Err(CoreError::InvalidDeletePath {
            path: format!(
                "{} (delete target escaped reviewed root {})",
                path.display(),
                root.display()
            ),
        });
    }

    let mut current = path;
    let mut target_metadata = None;
    loop {
        let metadata = fs::symlink_metadata(current).map_err(|error| CoreError::InvalidDeletePath {
            path: format!("{} ({})", current.display(), error),
        })?;
        if is_delete_link_metadata(&metadata) {
            return Err(CoreError::InvalidDeletePath {
                path: format!(
                    "{} (symbolic links and junctions are not supported in selected-path cleanup)",
                    current.display()
                ),
            });
        }
        if current == path {
            target_metadata = Some(metadata);
        }
        if current == root {
            break;
        }
        current = current.parent().ok_or_else(|| CoreError::InvalidDeletePath {
            path: format!(
                "{} (delete target escaped reviewed root {})",
                path.display(),
                root.display()
            ),
        })?;
    }

    target_metadata.ok_or_else(|| CoreError::InvalidDeletePath {
        path: path.display().to_string(),
    })
}

fn execution_warning_from_delete_path_error(error: CoreError, fallback_path: &Path) -> CleanupWarning {
    path_scan_warning(fallback_path, &error.to_string())
}

struct DeleteTargetInspection {
    is_directory: bool,
    estimated_bytes: u64,
    targeted_file_count: u32,
    warnings: Vec<CleanupWarning>,
    delete_blocked: bool,
}

#[derive(Default)]
struct DeleteExecutionPlan {
    file_paths: Vec<PathBuf>,
    directory_paths: Vec<PathBuf>,
}

struct DeleteExecutionResult {
    deleted_file_count: u32,
    warnings: Vec<CleanupWarning>,
}

pub fn safe_default_scan_roots_from_environment() -> SafeDefaultScanRoots {
    let local_app_data = local_app_data_root();
    SafeDefaultScanRoots {
        user_temp: temp_root(),
        thumbnail_cache: local_app_data
            .join("Microsoft")
            .join("Windows")
            .join("Explorer"),
        shader_cache: local_app_data.join("D3DSCache"),
    }
}

pub fn list_categories() -> Vec<CategoryMetadata> {
    vec![
        CategoryMetadata {
            id: "user-temp".into(),
            display_name: "User Temp Files".into(),
            description: "Cleans the current user's temporary folder.".into(),
            category_group: "System".into(),
            badge_label: "Recommended".into(),
            safety_note: "Low risk. Temporary files are usually recreated as needed.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: true,
        },
        CategoryMetadata {
            id: "windows-temp".into(),
            display_name: "Windows Temp Files".into(),
            description: "Cleans the Windows temp directory. Some files may be skipped if they are in use.".into(),
            category_group: "Windows".into(),
            badge_label: "Admin".into(),
            safety_note: "Windows may recreate some temporary files after updates or restarts.".into(),
            risk_tier: CleanupRiskTier::SafeButAdmin,
            requires_admin: true,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "windows-error-reporting".into(),
            display_name: "Windows Error Reporting".into(),
            description: "Cleans current-user Windows Error Reporting queue, archive, and temp data.".into(),
            category_group: "Diagnostics".into(),
            badge_label: "Diagnostics".into(),
            safety_note: "Useful for troubleshooting only if you still need recent crash reports.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "thumbnail-cache".into(),
            display_name: "Thumbnail Cache".into(),
            description: "Clears cached Explorer thumbnail databases.".into(),
            category_group: "Explorer".into(),
            badge_label: "Recommended".into(),
            safety_note: "Explorer will rebuild thumbnail cache automatically when needed.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: true,
        },
        CategoryMetadata {
            id: "icon-cache".into(),
            display_name: "Icon Cache".into(),
            description: "Cleans Windows icon cache databases for the current user.".into(),
            category_group: "Explorer".into(),
            badge_label: "Optional".into(),
            safety_note: "Windows will rebuild icon cache automatically after restart or folder refresh.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "browser-cache".into(),
            display_name: "Browser Cache".into(),
            description: "Cleans common cache folders for Chrome, Edge, Brave, and Firefox profiles.".into(),
            category_group: "Browsers".into(),
            badge_label: "Large".into(),
            safety_note: "Browsers may recreate cache files quickly. Some files can stay locked while a browser is open.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "shader-cache".into(),
            display_name: "Shader Cache".into(),
            description: "Cleans DirectX and graphics shader cache folders for the current user.".into(),
            category_group: "Graphics".into(),
            badge_label: "Recommended".into(),
            safety_note: "Graphics drivers and games may rebuild shader cache after the next launch.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: true,
        },
        CategoryMetadata {
            id: "crash-dumps".into(),
            display_name: "Crash Dumps".into(),
            description: "Removes application crash dump files from the current user profile.".into(),
            category_group: "Diagnostics".into(),
            badge_label: "Optional".into(),
            safety_note: "Keep these if you are still debugging recent application crashes.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "windows-update-download".into(),
            display_name: "Windows Update Download Cache".into(),
            description: "Cleans downloaded Windows Update packages that can accumulate over time.".into(),
            category_group: "Windows".into(),
            badge_label: "Admin".into(),
            safety_note: "Windows may need to redownload update files later. Use when reclaiming large amounts of space.".into(),
            risk_tier: CleanupRiskTier::SafeButAdmin,
            requires_admin: true,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "windows-old".into(),
            display_name: "Previous Windows Installation".into(),
            description: "Cleans the Windows.old folder left behind after a major Windows upgrade.".into(),
            category_group: "Windows".into(),
            badge_label: "Large".into(),
            safety_note: "Only remove this if you are sure you do not need to roll back a recent Windows upgrade.".into(),
            risk_tier: CleanupRiskTier::SafeButAdmin,
            requires_admin: true,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "delivery-optimization-cache".into(),
            display_name: "Delivery Optimization Cache".into(),
            description: "Cleans cached Delivery Optimization files downloaded by Windows.".into(),
            category_group: "Windows".into(),
            badge_label: "Large".into(),
            safety_note: "Windows may re-download these files later for updates or peer delivery.".into(),
            risk_tier: CleanupRiskTier::SafeButAdmin,
            requires_admin: true,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "setup-logs".into(),
            display_name: "Setup Logs".into(),
            description: "Cleans Windows setup and upgrade log folders that can remain after installs and updates.".into(),
            category_group: "Diagnostics".into(),
            badge_label: "Optional".into(),
            safety_note: "Keep these if you still need to troubleshoot a recent Windows installation or upgrade issue.".into(),
            risk_tier: CleanupRiskTier::SafeButAdmin,
            requires_admin: true,
            included_in_safe_defaults: false,
        },
        CategoryMetadata {
            id: "recycle-bin".into(),
            display_name: "Recycle Bin".into(),
            description: "Scans and empties the current user's recycle bin on the system drive.".into(),
            category_group: "System".into(),
            badge_label: "Confirm".into(),
            safety_note: "Irreversible. Keep it unchecked unless you have reviewed deleted items.".into(),
            risk_tier: CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: false,
        },
    ]
}

pub fn resolve_categories(category_ids: &[String]) -> (Vec<CategoryMetadata>, Vec<String>) {
    if category_ids.is_empty() {
        return (list_categories(), Vec::new());
    }

    let all_categories = list_categories();
    let lookup: HashSet<String> = category_ids
        .iter()
        .map(|item| item.to_lowercase())
        .collect();
    let selected = all_categories
        .iter()
        .filter(|category| lookup.contains(&category.id.to_lowercase()))
        .cloned()
        .collect::<Vec<_>>();
    let unknown = category_ids
        .iter()
        .filter(|item| {
            !selected
                .iter()
                .any(|category| category.id.eq_ignore_ascii_case(item))
        })
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut unknown_sorted = unknown;
    unknown_sorted.sort();
    (selected, unknown_sorted)
}

pub fn safe_default_categories() -> Vec<CategoryMetadata> {
    list_categories()
        .into_iter()
        .filter(|category| category.included_in_safe_defaults)
        .collect()
}

pub fn safe_default_category_ids() -> Vec<String> {
    safe_default_categories()
        .into_iter()
        .map(|category| category.id)
        .collect()
}

pub fn empty_scan_summary() -> CleanupScanSummary {
    CleanupScanSummary {
        category_count: 0,
        total_estimated_bytes: 0,
        total_candidate_files: 0,
        total_warnings: 0,
    }
}

pub fn empty_clean_summary() -> CleanupExecutionSummary {
    CleanupExecutionSummary {
        category_count: 0,
        successful_categories: 0,
        failed_categories: 0,
        total_freed_bytes: 0,
        total_deleted_files: 0,
        total_warnings: 0,
    }
}

fn history_store_dir_from_environment() -> PathBuf {
    local_app_data_root().join("CDriveCleaner")
}

fn legacy_history_store_dir_from_environment() -> PathBuf {
    local_app_data_root().join("CDriveCleanerGreenfield")
}

fn copy_dir_contents_recursively(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let entry_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            copy_dir_contents_recursively(&entry_path, &destination_path)?;
        } else if metadata.is_file() && !destination_path.exists() {
            let _ = fs::copy(&entry_path, &destination_path)?;
        }
    }
    Ok(())
}

fn maybe_migrate_legacy_history_store_dir() {
    // Respect explicit override environment variables.
    if env::var_os("CDRIVECLEANER_HISTORY_PATH").is_some()
        || env::var_os("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH").is_some()
        || env::var_os("CDRIVECLEANER_EXPORT_DIR").is_some()
    {
        return;
    }

    let new_dir = history_store_dir_from_environment();
    if new_dir.exists() {
        return;
    }

    let legacy_dir = legacy_history_store_dir_from_environment();
    if !legacy_dir.exists() {
        return;
    }

    // Prefer a rename so exports and other artifacts keep their relative layout.
    if fs::rename(&legacy_dir, &new_dir).is_ok() {
        return;
    }

    // Fallback: best-effort copy while keeping the legacy directory intact.
    let _ = fs::create_dir_all(&new_dir);
    let legacy_history = legacy_dir.join("history.json");
    let new_history = new_dir.join("history.json");
    if legacy_history.exists() && !new_history.exists() {
        let _ = fs::copy(&legacy_history, &new_history);
    }
    let legacy_plan = legacy_dir.join("scheduled-scan-plan.json");
    let new_plan = new_dir.join("scheduled-scan-plan.json");
    if legacy_plan.exists() && !new_plan.exists() {
        let _ = fs::copy(&legacy_plan, &new_plan);
    }
    let legacy_exports = legacy_dir.join("exports");
    let new_exports = new_dir.join("exports");
    if legacy_exports.exists() && !new_exports.exists() {
        let _ = copy_dir_contents_recursively(&legacy_exports, &new_exports);
    }
}

fn history_path_from_environment() -> PathBuf {
    if let Some(explicit) = env::var_os("CDRIVECLEANER_HISTORY_PATH") {
        return PathBuf::from(explicit);
    }
    maybe_migrate_legacy_history_store_dir();
    history_store_dir_from_environment().join("history.json")
}

fn export_store_dir_from_environment() -> PathBuf {
    if let Some(explicit) = env::var_os("CDRIVECLEANER_EXPORT_DIR") {
        return PathBuf::from(explicit);
    }

    maybe_migrate_legacy_history_store_dir();
    current_history_store_dir().join("exports")
}

fn scheduled_scan_plan_path_from_environment() -> PathBuf {
    if let Some(explicit) = env::var_os("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH") {
        return PathBuf::from(explicit);
    }

    maybe_migrate_legacy_history_store_dir();
    current_history_store_dir().join("scheduled-scan-plan.json")
}

fn export_filename_timestamp() -> String {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}{:03}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond(),
    )
}

fn write_json_export<T: serde::Serialize>(file_prefix: &str, payload: &T) -> Result<ExportArtifact, CoreError> {
    let export_dir = export_store_dir_from_environment();
    fs::create_dir_all(&export_dir).map_err(|error| CoreError::ExportIo {
        path: export_dir.display().to_string(),
        message: error.to_string(),
    })?;

    let timestamp = export_filename_timestamp();
    let mut file_name = format!("{file_prefix}-{timestamp}.json");
    let mut file_path = export_dir.join(&file_name);
    let mut suffix = 1_u32;
    while file_path.exists() {
        file_name = format!("{file_prefix}-{timestamp}-{suffix}.json");
        file_path = export_dir.join(&file_name);
        suffix += 1;
    }
    let raw = serde_json::to_string_pretty(payload).map_err(|error| CoreError::ExportIo {
        path: file_path.display().to_string(),
        message: error.to_string(),
    })?;
    fs::write(&file_path, raw).map_err(|error| CoreError::ExportIo {
        path: file_path.display().to_string(),
        message: error.to_string(),
    })?;

    Ok(ExportArtifact {
        file_path: file_path.display().to_string(),
        file_name,
        format: String::from("json"),
    })
}

fn load_history_from_path(path: &Path) -> Result<HistoryResponse, CoreError> {
    if !path.exists() {
        return Ok(HistoryResponse {
            entries: Vec::new(),
        });
    }

    let raw = fs::read_to_string(path).map_err(|error| CoreError::HistoryIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    serde_json::from_str(&raw).map_err(|error| CoreError::HistoryIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })
}

fn save_history_to_path(path: &Path, history: &HistoryResponse) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| CoreError::HistoryIo {
            path: parent.display().to_string(),
            message: error.to_string(),
        })?;
    }

    let payload = serde_json::to_string_pretty(history).map_err(|error| CoreError::HistoryIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;
    fs::write(path, payload).map_err(|error| CoreError::HistoryIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })
}

fn append_history_entry(path: &Path, entry: HistoryEntry) -> Result<(), CoreError> {
    let mut history = match load_history_from_path(path) {
        Ok(history) => history,
        Err(_) => {
            quarantine_corrupt_history_file(path);
            HistoryResponse {
                entries: Vec::new(),
            }
        }
    };
    history.entries.push(entry);
    save_history_to_path(path, &history)
}

fn quarantine_corrupt_history_file(path: &Path) {
    if !path.exists() || !path.is_file() {
        return;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("history.json");
    let corrupt_name = format!("{file_name}.corrupt-{timestamp}");
    let corrupt_path = path.with_file_name(corrupt_name);
    let _ = fs::rename(path, corrupt_path);
}

fn history_timestamp() -> String {
    OffsetDateTime::now_local()
        .unwrap_or_else(|_| OffsetDateTime::now_utc())
        .format(&Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}

const SCHEDULED_SCAN_PLAN_ID: &str = "daily-safe-scan";

fn parse_scheduled_time(value: &str) -> Result<(u8, u8), CoreError> {
    let (hour, minute) = value
        .split_once(':')
        .ok_or_else(|| CoreError::InvalidScheduledTime { value: value.to_string() })?;
    let hour = hour
        .parse::<u8>()
        .map_err(|_| CoreError::InvalidScheduledTime { value: value.to_string() })?;
    let minute = minute
        .parse::<u8>()
        .map_err(|_| CoreError::InvalidScheduledTime { value: value.to_string() })?;

    if hour > 23 || minute > 59 {
        return Err(CoreError::InvalidScheduledTime { value: value.to_string() });
    }

    Ok((hour, minute))
}

fn compute_next_run_at(scheduled_time: &str, enabled: bool) -> Result<Option<String>, CoreError> {
    if !enabled {
        return Ok(None);
    }

    let (hour, minute) = parse_scheduled_time(scheduled_time)?;
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let base_date = now.date();
    let time = time::Time::from_hms(hour, minute, 0)
        .map_err(|_| CoreError::InvalidScheduledTime { value: scheduled_time.to_string() })?;
    let mut next_run = base_date.with_time(time).assume_offset(now.offset());
    if next_run <= now {
        next_run += Duration::from_secs(24 * 60 * 60);
    }

    Ok(Some(
        next_run
            .format(&Rfc3339)
            .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z")),
    ))
}

fn scheduled_scan_plan_display_name(plan: &ScheduledScanPlan) -> String {
    match plan.mode {
        ScheduledScanMode::SafeDefaults => String::from("Safe defaults"),
        ScheduledScanMode::PreparedPreset => format!("Prepared preset ({})", plan.captured_category_ids.len()),
    }
}

fn scheduled_scan_history_entry(plan: &ScheduledScanPlan, response: &ScanResponse) -> HistoryEntry {
    HistoryEntry {
        timestamp: history_timestamp(),
        kind: String::from("scan"),
        summary: format!(
            "Scheduled scan ({}) complete. Categories={}, estimated={}, warnings={}",
            scheduled_scan_plan_display_name(plan),
            response.summary.category_count,
            format_mebibytes(response.summary.total_estimated_bytes),
            response.summary.total_warnings,
        ),
        origin: Some(HistoryOrigin::Scheduled),
        origin_label: Some(scheduled_scan_plan_display_name(plan)),
        category_count: Some(response.summary.category_count),
        total_estimated_bytes: Some(response.summary.total_estimated_bytes),
        total_candidate_files: Some(response.summary.total_candidate_files),
        total_warnings: Some(response.summary.total_warnings),
        successful_categories: None,
        failed_categories: None,
        total_freed_bytes: None,
        total_deleted_files: None,
    }
}

fn validate_scheduled_scan_draft(draft: &ScheduledScanPlanDraft) -> Result<(), CoreError> {
    parse_scheduled_time(&draft.scheduled_time)?;
    if draft.mode == ScheduledScanMode::PreparedPreset && draft.captured_category_ids.is_empty() {
        return Err(CoreError::EmptyPreparedPreset);
    }
    if draft.mode == ScheduledScanMode::PreparedPreset {
        let _ = selected_categories_for_execution(&draft.captured_category_ids)?;
    }
    Ok(())
}

fn hydrate_scheduled_scan_plan(mut plan: ScheduledScanPlan) -> Result<ScheduledScanPlan, CoreError> {
    plan.next_run_at = compute_next_run_at(&plan.scheduled_time, plan.enabled)?;
    Ok(plan)
}

fn load_scheduled_scan_plan_from_path(path: &Path) -> Result<Option<ScheduledScanPlan>, CoreError> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| CoreError::ScheduledScanPlanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;
    let plan: ScheduledScanPlan = serde_json::from_str(&raw).map_err(|error| CoreError::ScheduledScanPlanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;
    Ok(Some(hydrate_scheduled_scan_plan(plan)?))
}

fn save_scheduled_scan_plan_to_path(path: &Path, plan: &ScheduledScanPlan) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| CoreError::ScheduledScanPlanIo {
            path: parent.display().to_string(),
            message: error.to_string(),
        })?;
    }
    let payload = serde_json::to_string_pretty(plan).map_err(|error| CoreError::ScheduledScanPlanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;
    fs::write(path, payload).map_err(|error| CoreError::ScheduledScanPlanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })
}

fn format_mebibytes(bytes: u64) -> String {
    format!("{:.2} MB", bytes as f64 / 1_048_576_f64)
}

fn scan_history_entry(response: &ScanResponse) -> HistoryEntry {
    HistoryEntry {
        timestamp: history_timestamp(),
        kind: String::from("scan"),
        summary: format!(
            "Scan complete. Categories={}, estimated={}, warnings={}.",
            response.summary.category_count,
            format_mebibytes(response.summary.total_estimated_bytes),
            response.summary.total_warnings,
        ),
        origin: Some(HistoryOrigin::Manual),
        origin_label: None,
        category_count: Some(response.summary.category_count),
        total_estimated_bytes: Some(response.summary.total_estimated_bytes),
        total_candidate_files: Some(response.summary.total_candidate_files),
        total_warnings: Some(response.summary.total_warnings),
        successful_categories: None,
        failed_categories: None,
        total_freed_bytes: None,
        total_deleted_files: None,
    }
}

fn clean_history_entry(response: &CleanResponse) -> HistoryEntry {
    HistoryEntry {
        timestamp: history_timestamp(),
        kind: String::from("clean"),
        summary: format!(
            "Cleanup complete. Successful={}, Failed={}, Freed={}.",
            response.summary.successful_categories,
            response.summary.failed_categories,
            format_mebibytes(response.summary.total_freed_bytes),
        ),
        origin: Some(HistoryOrigin::Manual),
        origin_label: None,
        category_count: Some(response.summary.category_count),
        total_estimated_bytes: None,
        total_candidate_files: None,
        total_warnings: Some(response.summary.total_warnings),
        successful_categories: Some(response.summary.successful_categories),
        failed_categories: Some(response.summary.failed_categories),
        total_freed_bytes: Some(response.summary.total_freed_bytes),
        total_deleted_files: Some(response.summary.total_deleted_files),
    }
}

fn scan_selected_categories(category_ids: &[String]) -> Result<ScanResponse, CoreError> {
    let categories = selected_categories_for_execution(category_ids)?;
    let results = categories
        .iter()
        .map(|category| scan_category_roots(category, &category_roots_from_environment(category)))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ScanResponse {
        summary: CleanupScanSummary {
            category_count: results.len() as u32,
            total_estimated_bytes: results.iter().map(|result| result.estimated_bytes).sum(),
            total_candidate_files: results
                .iter()
                .map(|result| result.candidate_file_count)
                .sum(),
            total_warnings: results
                .iter()
                .map(|result| result.warnings.len() as u32)
                .sum(),
        },
        categories: results,
    })
}

pub fn current_history() -> HistoryResponse {
    load_history_from_path(&history_path_from_environment()).unwrap_or(HistoryResponse {
        entries: Vec::new(),
    })
}

pub fn current_history_store_dir() -> PathBuf {
    history_path_from_environment()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(history_store_dir_from_environment)
}

pub fn current_scheduled_scan_plan() -> Result<Option<ScheduledScanPlan>, CoreError> {
    load_scheduled_scan_plan_from_path(&scheduled_scan_plan_path_from_environment())
}

pub fn save_scheduled_scan_plan(draft: &ScheduledScanPlanDraft) -> Result<ScheduledScanPlan, CoreError> {
    validate_scheduled_scan_draft(draft)?;
    let requires_admin = match draft.mode {
        ScheduledScanMode::SafeDefaults => false,
        ScheduledScanMode::PreparedPreset => !analyze_elevation(&draft.captured_category_ids)
            .admin_category_ids
            .is_empty(),
    };
    let plan = hydrate_scheduled_scan_plan(ScheduledScanPlan {
        id: String::from(SCHEDULED_SCAN_PLAN_ID),
        mode: draft.mode.clone(),
        scheduled_time: draft.scheduled_time.clone(),
        enabled: draft.enabled,
        captured_category_ids: draft.captured_category_ids.clone(),
        requires_admin,
        next_run_at: None,
        last_run_at: None,
        last_run_summary: None,
        last_run_category_count: None,
        last_run_estimated_bytes: None,
        last_run_warnings: None,
    })?;
    save_scheduled_scan_plan_to_path(&scheduled_scan_plan_path_from_environment(), &plan)?;
    Ok(plan)
}

pub fn restore_scheduled_scan_plan(plan: Option<&ScheduledScanPlan>) -> Result<(), CoreError> {
    match plan {
        Some(plan) => save_scheduled_scan_plan_to_path(&scheduled_scan_plan_path_from_environment(), plan),
        None => delete_scheduled_scan_plan(),
    }
}

pub fn set_scheduled_scan_plan_enabled(enabled: bool) -> Result<ScheduledScanPlan, CoreError> {
    let mut plan = current_scheduled_scan_plan()?
        .ok_or_else(|| CoreError::ScheduledScanPlanNotFound { plan_id: String::from(SCHEDULED_SCAN_PLAN_ID) })?;
    plan.enabled = enabled;
    plan.next_run_at = compute_next_run_at(&plan.scheduled_time, plan.enabled)?;
    save_scheduled_scan_plan_to_path(&scheduled_scan_plan_path_from_environment(), &plan)?;
    Ok(plan)
}

pub fn delete_scheduled_scan_plan() -> Result<(), CoreError> {
    let path = scheduled_scan_plan_path_from_environment();
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|error| CoreError::ScheduledScanPlanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })
}

pub fn execute_scheduled_scan_plan(plan_id: &str) -> Result<ScheduledScanPlan, CoreError> {
    let mut plan = current_scheduled_scan_plan()?
        .ok_or_else(|| CoreError::ScheduledScanPlanNotFound { plan_id: plan_id.to_string() })?;
    if plan.id != plan_id {
        return Err(CoreError::ScheduledScanPlanNotFound { plan_id: plan_id.to_string() });
    }
    if !plan.enabled {
        return Err(CoreError::ScheduledScanPlanDisabled { plan_id: plan_id.to_string() });
    }

    let response = match plan.mode {
        ScheduledScanMode::SafeDefaults => scan_safe_defaults(&safe_default_scan_roots_from_environment())?,
        ScheduledScanMode::PreparedPreset => scan_selected_categories(&plan.captured_category_ids)?,
    };

    let entry = scheduled_scan_history_entry(&plan, &response);
    append_history_entry(&history_path_from_environment(), entry.clone())?;
    plan.last_run_at = Some(entry.timestamp);
    plan.last_run_summary = Some(entry.summary);
    plan.last_run_category_count = Some(response.summary.category_count);
    plan.last_run_estimated_bytes = Some(response.summary.total_estimated_bytes);
    plan.last_run_warnings = Some(response.summary.total_warnings);
    plan.next_run_at = compute_next_run_at(&plan.scheduled_time, plan.enabled)?;
    save_scheduled_scan_plan_to_path(&scheduled_scan_plan_path_from_environment(), &plan)?;
    Ok(plan)
}

pub fn export_scan_report(payload: &ScanExportPayload) -> Result<ExportArtifact, CoreError> {
    let file_prefix = match payload {
        ScanExportPayload::CategoryScan(_) => "scan-report",
        ScanExportPayload::FullScan(_) => "full-scan-report",
    };

    write_json_export(file_prefix, payload)
}

pub fn export_history(history: &HistoryResponse) -> Result<ExportArtifact, CoreError> {
    write_json_export("history-export", history)
}

pub fn analyze_elevation(category_ids: &[String]) -> ElevationRequirement {
    let (selected, _) = resolve_categories(category_ids);
    let admin_category_ids = selected
        .into_iter()
        .filter(|category| category.requires_admin)
        .map(|category| category.id)
        .collect::<Vec<_>>();
    ElevationRequirement {
        is_process_elevated: false,
        requires_elevation: !admin_category_ids.is_empty(),
        admin_category_ids,
    }
}

fn selected_categories_for_execution(
    category_ids: &[String],
) -> Result<Vec<CategoryMetadata>, CoreError> {
    if category_ids.is_empty() {
        return Err(CoreError::NoCategoriesSelected);
    }

    let (selected, unknown) = resolve_categories(category_ids);
    if !unknown.is_empty() {
        return Err(CoreError::UnknownCategories {
            category_ids: unknown.join(", "),
        });
    }
    Ok(selected)
}

fn scan_category_roots(
    category: &CategoryMetadata,
    roots: &[PathBuf],
) -> Result<CleanupScanResult, CoreError> {
    if roots.is_empty() {
        return Ok(CleanupScanResult {
            category_id: category.id.clone(),
            display_name: category.display_name.clone(),
            estimated_bytes: 0,
            candidate_file_count: 0,
            requires_admin: category.requires_admin,
            risk_tier: category.risk_tier.clone(),
            warnings: vec![unsupported_category_warning(category)],
        });
    }

    let mut estimated_bytes = 0_u64;
    let mut candidate_file_count = 0_u32;
    let mut warnings = Vec::new();

    for root in roots {
        let result = scan_category_root(category, root)?;
        estimated_bytes += result.estimated_bytes;
        candidate_file_count += result.candidate_file_count;
        warnings.extend(result.warnings);
    }

    Ok(CleanupScanResult {
        category_id: category.id.clone(),
        display_name: category.display_name.clone(),
        estimated_bytes,
        candidate_file_count,
        requires_admin: category.requires_admin,
        risk_tier: category.risk_tier.clone(),
        warnings,
    })
}

fn clean_category_roots(
    category: &CategoryMetadata,
    roots: &[PathBuf],
) -> Result<CleanupExecutionResult, CoreError> {
    if roots.is_empty() {
        return Ok(CleanupExecutionResult {
            category_id: category.id.clone(),
            display_name: category.display_name.clone(),
            freed_bytes: 0,
            deleted_file_count: 0,
            success: false,
            warnings: vec![unsupported_category_warning(category)],
        });
    }

    let mut freed_bytes = 0_u64;
    let mut deleted_file_count = 0_u32;
    let mut warnings = Vec::new();
    let mut success = true;

    for root in roots {
        let result = clean_category_root(category, root)?;
        freed_bytes += result.freed_bytes;
        deleted_file_count += result.deleted_file_count;
        success &= result.success;
        warnings.extend(result.warnings);
    }

    Ok(CleanupExecutionResult {
        category_id: category.id.clone(),
        display_name: category.display_name.clone(),
        freed_bytes,
        deleted_file_count,
        success: success && warnings.is_empty(),
        warnings,
    })
}

pub fn scan_categories_for_current_machine(
    category_ids: &[String],
) -> Result<ScanResponse, CoreError> {
    let response = scan_selected_categories(category_ids)?;
    let _ = append_history_entry(
        &history_path_from_environment(),
        scan_history_entry(&response),
    );
    Ok(response)
}

pub fn clean_categories_for_current_machine(
    category_ids: &[String],
) -> Result<CleanResponse, CoreError> {
    let categories = selected_categories_for_execution(category_ids)?;
    let results = categories
        .iter()
        .map(|category| clean_category_roots(category, &category_roots_from_environment(category)))
        .collect::<Result<Vec<_>, _>>()?;

    let response = CleanResponse {
        summary: CleanupExecutionSummary {
            category_count: results.len() as u32,
            successful_categories: results.iter().filter(|result| result.success).count() as u32,
            failed_categories: results.iter().filter(|result| !result.success).count() as u32,
            total_freed_bytes: results.iter().map(|result| result.freed_bytes).sum(),
            total_deleted_files: results.iter().map(|result| result.deleted_file_count).sum(),
            total_warnings: results
                .iter()
                .map(|result| result.warnings.len() as u32)
                .sum(),
        },
        categories: results,
    };
    let _ = append_history_entry(
        &history_path_from_environment(),
        clean_history_entry(&response),
    );
    Ok(response)
}

pub fn scan_safe_defaults(roots: &SafeDefaultScanRoots) -> Result<ScanResponse, CoreError> {
    let root_map = [
        ("user-temp", roots.user_temp.as_path()),
        ("thumbnail-cache", roots.thumbnail_cache.as_path()),
        ("shader-cache", roots.shader_cache.as_path()),
    ];

    let categories = safe_default_categories();
    let results = categories
        .into_iter()
        .map(|category| {
            let root = root_map
                .iter()
                .find(|(category_id, _)| *category_id == category.id)
                .map(|(_, path)| *path)
                .ok_or_else(|| CoreError::InvalidScanRoot {
                    category_id: category.id.clone(),
                    path: String::from("<missing>"),
                })?;
            scan_category_root(&category, root)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let summary = CleanupScanSummary {
        category_count: results.len() as u32,
        total_estimated_bytes: results.iter().map(|result| result.estimated_bytes).sum(),
        total_candidate_files: results
            .iter()
            .map(|result| result.candidate_file_count)
            .sum(),
        total_warnings: results
            .iter()
            .map(|result| result.warnings.len() as u32)
            .sum(),
    };

    Ok(ScanResponse {
        summary,
        categories: results,
    })
}

pub fn scan_safe_defaults_for_current_machine() -> Result<ScanResponse, CoreError> {
    let roots = safe_default_scan_roots_from_environment();
    let response = scan_safe_defaults(&roots)?;
    let _ = append_history_entry(
        &history_path_from_environment(),
        scan_history_entry(&response),
    );
    Ok(response)
}

pub fn clean_safe_defaults(roots: &SafeDefaultScanRoots) -> Result<CleanResponse, CoreError> {
    let root_map = [
        ("user-temp", roots.user_temp.as_path()),
        ("thumbnail-cache", roots.thumbnail_cache.as_path()),
        ("shader-cache", roots.shader_cache.as_path()),
    ];

    let categories = safe_default_categories();
    let results = categories
        .into_iter()
        .map(|category| {
            let root = root_map
                .iter()
                .find(|(category_id, _)| *category_id == category.id)
                .map(|(_, path)| *path)
                .ok_or_else(|| CoreError::InvalidScanRoot {
                    category_id: category.id.clone(),
                    path: String::from("<missing>"),
                })?;
            clean_category_root(&category, root)
        })
        .collect::<Result<Vec<_>, _>>()?;

    let summary = CleanupExecutionSummary {
        category_count: results.len() as u32,
        successful_categories: results.iter().filter(|result| result.success).count() as u32,
        failed_categories: results.iter().filter(|result| !result.success).count() as u32,
        total_freed_bytes: results.iter().map(|result| result.freed_bytes).sum(),
        total_deleted_files: results.iter().map(|result| result.deleted_file_count).sum(),
        total_warnings: results
            .iter()
            .map(|result| result.warnings.len() as u32)
            .sum(),
    };

    Ok(CleanResponse {
        summary,
        categories: results,
    })
}

pub fn clean_safe_defaults_for_current_machine() -> Result<CleanResponse, CoreError> {
    let roots = safe_default_scan_roots_from_environment();
    let response = clean_safe_defaults(&roots)?;
    let _ = append_history_entry(
        &history_path_from_environment(),
        clean_history_entry(&response),
    );
    Ok(response)
}

struct TreeBuildResult {
    node: FullScanTreeNode,
    total_file_count: u32,
    total_warning_count: u32,
}

pub fn scan_full_tree(root: &Path) -> Result<FullScanTreeResponse, CoreError> {
    let mut noop = |_| {};
    scan_full_tree_with_depth_and_progress(root, 1, &mut noop)
}

pub fn scan_full_tree_with_depth(
    root: &Path,
    depth: usize,
) -> Result<FullScanTreeResponse, CoreError> {
    let mut noop = |_| {};
    scan_full_tree_with_depth_and_progress(root, depth, &mut noop)
}

pub fn scan_full_tree_with_progress<F>(
    root: &Path,
    on_progress: &mut F,
) -> Result<FullScanTreeResponse, CoreError>
where
    F: FnMut(FullScanProgress),
{
    scan_full_tree_with_depth_and_progress(root, 1, on_progress)
}

pub fn scan_full_tree_with_depth_and_progress<F>(
    root: &Path,
    depth: usize,
    on_progress: &mut F,
) -> Result<FullScanTreeResponse, CoreError>
where
    F: FnMut(FullScanProgress),
{
    if !root.exists() || !root.is_dir() {
        return Err(CoreError::InvalidScanRoot {
            category_id: String::from("full-scan"),
            path: display_scan_path(root),
        });
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| CoreError::InvalidScanRoot {
        category_id: String::from("full-scan"),
        path: format!("{} ({})", display_scan_path(root), error),
    })?;

    let mut tracker = FullScanProgressTracker::default();
    tracker.maybe_emit(
        FullScanProgressPhase::Starting,
        &canonical_root,
        true,
        on_progress,
    );
    let tree =
        build_full_scan_tree_node_with_progress(&canonical_root, depth, &mut tracker, on_progress)?;
    let summary = CleanupScanSummary {
        category_count: 1,
        total_estimated_bytes: tree.node.size_bytes,
        total_candidate_files: tree.total_file_count,
        total_warnings: tree.total_warning_count,
    };

    tracker.maybe_emit(
        FullScanProgressPhase::Finalizing,
        &canonical_root,
        true,
        on_progress,
    );

    let response = FullScanTreeResponse {
        root_path: display_scan_path(&canonical_root),
        summary,
        tree: tree.node,
    };

    tracker.directories_scanned = tracker.directories_scanned.max(1);
    tracker.files_scanned = response.summary.total_candidate_files;
    tracker.warnings_count = response.summary.total_warnings;
    tracker.maybe_emit(
        FullScanProgressPhase::Complete,
        &canonical_root,
        true,
        on_progress,
    );

    Ok(response)
}

pub fn scan_full_tree_for_current_machine() -> Result<FullScanTreeResponse, CoreError> {
    let root = full_scan_root_from_environment();
    scan_full_tree_with_depth(&root, 1)
}

pub fn scan_full_tree_for_current_machine_with_progress<F>(
    on_progress: &mut F,
) -> Result<FullScanTreeResponse, CoreError>
where
    F: FnMut(FullScanProgress),
{
    let root = full_scan_root_from_environment();
    scan_full_tree_with_progress(&root, on_progress)
}

pub fn expand_full_scan_node(root: &Path, node_path: &Path) -> Result<FullScanTreeNode, CoreError> {
    let canonical_root = fs::canonicalize(root).map_err(|error| CoreError::InvalidScanRoot {
        category_id: String::from("full-scan"),
        path: format!("{} ({})", root.display(), error),
    })?;
    let canonical_node =
        fs::canonicalize(node_path).map_err(|error| CoreError::InvalidTreeNodePath {
            root_path: canonical_root.display().to_string(),
            node_path: format!("{} ({})", node_path.display(), error),
        })?;

    if canonical_node.strip_prefix(&canonical_root).is_err() {
        return Err(CoreError::InvalidTreeNodePath {
            root_path: canonical_root.display().to_string(),
            node_path: canonical_node.display().to_string(),
        });
    }

    Ok(build_full_scan_tree_node_for_expand(&canonical_node)?.node)
}

pub fn expand_full_scan_node_for_current_machine(
    node_path: &Path,
) -> Result<FullScanTreeNode, CoreError> {
    let root = full_scan_root_from_environment();
    expand_full_scan_node(&root, node_path)
}

fn build_full_scan_tree_node(
    path: &Path,
    depth_remaining: usize,
) -> Result<TreeBuildResult, CoreError> {
    let mut noop = |_| {};
    let mut tracker = FullScanProgressTracker::default();
    build_full_scan_tree_node_with_progress(path, depth_remaining, &mut tracker, &mut noop)
}

fn build_full_scan_tree_node_for_expand(path: &Path) -> Result<TreeBuildResult, CoreError> {
    let metadata = fs::metadata(path).map_err(|error| CoreError::ScanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(String::from)
        .unwrap_or_else(|| display_scan_path(path));

    if metadata.is_file() {
        return Ok(TreeBuildResult {
            node: FullScanTreeNode {
                path: display_scan_path(path),
                name,
                is_directory: false,
                size_bytes: metadata.len(),
                has_children: false,
                children_loaded: true,
                warnings: Vec::new(),
                children: Vec::new(),
            },
            total_file_count: 1,
            total_warning_count: 0,
        });
    }

    let entries = fs::read_dir(path).map_err(|error| CoreError::ScanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    let mut child_paths = Vec::new();
    let mut warnings = Vec::new();
    let mut total_warning_count = 0_u32;
    let mut has_children = false;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(directory_entry_warning(path, &error));
                total_warning_count += 1;
                continue;
            }
        };

        let child_path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                warnings.push(entry_type_warning(&child_path, &error));
                total_warning_count += 1;
                continue;
            }
        };

        if file_type.is_file()
            && child_path.file_name().and_then(|value| value.to_str()) == Some(LOCKED_FILE_NAME)
        {
            warnings.push(file_info_access_denied_warning(&child_path));
            total_warning_count += 1;
            continue;
        }

        if file_type.is_dir() || file_type.is_file() {
            has_children = true;
            child_paths.push(child_path);
        }
    }

    let child_results: Vec<_> = child_paths
        .into_par_iter()
        .map(|child_path| {
            let result = build_full_scan_tree_node(&child_path, 0);
            (child_path, result)
        })
        .collect();

    let mut children = Vec::new();
    let mut total_size = 0_u64;
    let mut total_file_count = 0_u32;

    for (child_path, result) in child_results {
        match result {
            Ok(child) => {
                total_size += child.node.size_bytes;
                total_file_count += child.total_file_count;
                total_warning_count += child.total_warning_count;
                children.push(child.node);
            }
            Err(CoreError::ScanIo { message, .. }) => {
                if !should_suppress_full_scan_warning(&child_path, &message) {
                    warnings.push(path_scan_warning(&child_path, &message));
                    total_warning_count += 1;
                }
            }
            Err(error) => return Err(error),
        }
    }

    children.sort_by(|left, right| {
        right
            .size_bytes
            .cmp(&left.size_bytes)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(TreeBuildResult {
        node: FullScanTreeNode {
            path: display_scan_path(path),
            name,
            is_directory: true,
            size_bytes: total_size,
            has_children,
            children_loaded: true,
            warnings,
            children,
        },
        total_file_count,
        total_warning_count,
    })
}

fn build_full_scan_tree_node_with_progress<F>(
    path: &Path,
    depth_remaining: usize,
    tracker: &mut FullScanProgressTracker,
    on_progress: &mut F,
) -> Result<TreeBuildResult, CoreError>
where
    F: FnMut(FullScanProgress),
{
    let metadata = fs::metadata(path).map_err(|error| CoreError::ScanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(String::from)
        .unwrap_or_else(|| display_scan_path(path));

    if metadata.is_file() {
        tracker.record_file(path, on_progress);
        return Ok(TreeBuildResult {
            node: FullScanTreeNode {
                path: display_scan_path(path),
                name,
                is_directory: false,
                size_bytes: metadata.len(),
                has_children: false,
                children_loaded: true,
                warnings: Vec::new(),
                children: Vec::new(),
            },
            total_file_count: 1,
            total_warning_count: 0,
        });
    }

    if depth_remaining == 0 {
        return summarize_full_scan_directory(path, name, tracker, on_progress);
    }

    let mut children = Vec::new();
    let mut warnings = Vec::new();
    let mut total_size = 0_u64;
    let mut total_file_count = 0_u32;
    let mut total_warning_count = 0_u32;
    let mut has_children = false;
    tracker.record_directory(path, on_progress);
    let entries = fs::read_dir(path).map_err(|error| CoreError::ScanIo {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(directory_entry_warning(path, &error));
                tracker.record_warning();
                total_warning_count += 1;
                continue;
            }
        };
        let child_path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                warnings.push(entry_type_warning(&child_path, &error));
                tracker.record_warning();
                total_warning_count += 1;
                continue;
            }
        };

        if file_type.is_file()
            && child_path.file_name().and_then(|value| value.to_str()) == Some(LOCKED_FILE_NAME)
        {
            warnings.push(file_info_access_denied_warning(&child_path));
            tracker.record_warning();
            total_warning_count += 1;
            continue;
        }

        if file_type.is_dir() || file_type.is_file() {
            has_children = true;
            match build_full_scan_tree_node_with_progress(
                &child_path,
                depth_remaining.saturating_sub(1),
                tracker,
                on_progress,
            ) {
                Ok(child) => {
                    total_size += child.node.size_bytes;
                    total_file_count += child.total_file_count;
                    total_warning_count += child.total_warning_count;
                    if depth_remaining > 0 {
                        children.push(child.node);
                    }
                }
                Err(CoreError::ScanIo { message, .. }) => {
                    if !should_suppress_full_scan_warning(&child_path, &message) {
                        warnings.push(path_scan_warning(&child_path, &message));
                        tracker.record_warning();
                        total_warning_count += 1;
                    }
                }
                Err(error) => return Err(error),
            }
        }
    }

    children.sort_by(|left, right| {
        right
            .size_bytes
            .cmp(&left.size_bytes)
            .then_with(|| left.name.cmp(&right.name))
    });

    let children_loaded = depth_remaining > 0 || !has_children;

    Ok(TreeBuildResult {
        node: FullScanTreeNode {
            path: display_scan_path(path),
            name,
            is_directory: true,
            size_bytes: total_size,
            has_children,
            children_loaded,
            warnings,
            children,
        },
        total_file_count,
        total_warning_count,
    })
}

fn summarize_full_scan_directory<F>(
    path: &Path,
    name: String,
    tracker: &mut FullScanProgressTracker,
    on_progress: &mut F,
) -> Result<TreeBuildResult, CoreError>
where
    F: FnMut(FullScanProgress),
{
    let mut pending = vec![path.to_path_buf()];
    let mut total_size = 0_u64;
    let mut total_file_count = 0_u32;
    let mut total_warning_count = 0_u32;
    let mut warnings = Vec::new();
    let mut has_children = false;

    while let Some(current) = pending.pop() {
        tracker.record_directory(&current, on_progress);
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) => {
                if current == path {
                    return Err(CoreError::ScanIo {
                        path: current.display().to_string(),
                        message: error.to_string(),
                    });
                }

                let message = error.to_string();
                if !should_suppress_full_scan_warning(&current, &message) {
                    warnings.push(path_scan_warning(&current, &message));
                    tracker.record_warning();
                    total_warning_count += 1;
                }
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(directory_entry_warning(&current, &error));
                    tracker.record_warning();
                    total_warning_count += 1;
                    continue;
                }
            };

            let child_path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    warnings.push(entry_type_warning(&child_path, &error));
                    tracker.record_warning();
                    total_warning_count += 1;
                    continue;
                }
            };

            if file_type.is_file()
                && child_path.file_name().and_then(|value| value.to_str()) == Some(LOCKED_FILE_NAME)
            {
                warnings.push(file_info_access_denied_warning(&child_path));
                tracker.record_warning();
                total_warning_count += 1;
                continue;
            }

            if file_type.is_dir() {
                has_children = true;
                pending.push(child_path);
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            has_children = true;
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    warnings.push(file_info_warning(&child_path, &error));
                    tracker.record_warning();
                    total_warning_count += 1;
                    continue;
                }
            };
            tracker.record_file(&child_path, on_progress);
            total_size += metadata.len();
            total_file_count += 1;
        }
    }

    Ok(TreeBuildResult {
        node: FullScanTreeNode {
            path: display_scan_path(path),
            name,
            is_directory: true,
            size_bytes: total_size,
            has_children,
            children_loaded: false,
            warnings,
            children: Vec::new(),
        },
        total_file_count,
        total_warning_count,
    })
}

fn scan_category_root(
    category: &CategoryMetadata,
    root: &Path,
) -> Result<CleanupScanResult, CoreError> {
    if !root.exists() || !root.is_dir() {
        return Ok(CleanupScanResult {
            category_id: category.id.clone(),
            display_name: category.display_name.clone(),
            estimated_bytes: 0,
            candidate_file_count: 0,
            requires_admin: category.requires_admin,
            risk_tier: category.risk_tier.clone(),
            warnings: vec![inaccessible_root_warning(root)],
        });
    }

    let mut pending = vec![root.to_path_buf()];
    let mut estimated_bytes = 0_u64;
    let mut candidate_file_count = 0_u32;
    let mut warnings = Vec::new();

    while let Some(current) = pending.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(directory_read_warning(&current, &error));
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(directory_entry_warning(&current, &error));
                    continue;
                }
            };
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    warnings.push(entry_type_warning(&path, &error));
                    continue;
                }
            };

            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            if path.file_name().and_then(|name| name.to_str()) == Some(LOCKED_FILE_NAME) {
                warnings.push(file_info_access_denied_warning(&path));
                continue;
            }

            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    warnings.push(file_info_warning(&path, &error));
                    continue;
                }
            };
            estimated_bytes += metadata.len();
            candidate_file_count += 1;
        }
    }

    Ok(CleanupScanResult {
        category_id: category.id.clone(),
        display_name: category.display_name.clone(),
        estimated_bytes,
        candidate_file_count,
        requires_admin: category.requires_admin,
        risk_tier: category.risk_tier.clone(),
        warnings,
    })
}

fn clean_category_root(
    category: &CategoryMetadata,
    root: &Path,
) -> Result<CleanupExecutionResult, CoreError> {
    if !root.exists() || !root.is_dir() {
        return Ok(CleanupExecutionResult {
            category_id: category.id.clone(),
            display_name: category.display_name.clone(),
            freed_bytes: 0,
            deleted_file_count: 0,
            success: true,
            warnings: vec![inaccessible_root_warning(root)],
        });
    }

    let mut pending = vec![root.to_path_buf()];
    let mut freed_bytes = 0_u64;
    let mut deleted_file_count = 0_u32;
    let mut warnings = Vec::new();

    while let Some(current) = pending.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(directory_read_warning(&current, &error));
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(directory_entry_warning(&current, &error));
                    continue;
                }
            };
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    warnings.push(entry_type_warning(&path, &error));
                    continue;
                }
            };

            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            if path.file_name().and_then(|name| name.to_str()) == Some(LOCKED_FILE_NAME) {
                warnings.push(file_delete_access_denied_warning(&path));
                continue;
            }

            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    warnings.push(file_delete_warning(&path, &error));
                    continue;
                }
            };

            match fs::remove_file(&path) {
                Ok(()) => {
                    freed_bytes += metadata.len();
                    deleted_file_count += 1;
                }
                Err(error) => {
                    warnings.push(file_delete_warning(&path, &error));
                }
            }
        }
    }

    Ok(CleanupExecutionResult {
        category_id: category.id.clone(),
        display_name: category.display_name.clone(),
        freed_bytes,
        deleted_file_count,
        success: warnings.is_empty(),
        warnings,
    })
}

fn inspect_delete_target(root: &Path, path: &Path) -> Result<DeleteTargetInspection, CoreError> {
    let metadata = validate_delete_path_chain(root, path)?;

    if metadata.is_file() {
        return Ok(DeleteTargetInspection {
            is_directory: false,
            estimated_bytes: metadata.len(),
            targeted_file_count: 1,
            warnings: Vec::new(),
            delete_blocked: false,
        });
    }

    let mut pending = vec![path.to_path_buf()];
    let mut estimated_bytes = 0_u64;
    let mut targeted_file_count = 0_u32;
    let mut warnings = Vec::new();
    let mut delete_blocked = false;

    while let Some(current) = pending.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) => {
                warnings.push(directory_read_warning(&current, &error));
                delete_blocked = true;
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(directory_entry_warning(&current, &error));
                    delete_blocked = true;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    warnings.push(path_scan_warning(
                        &path,
                        &format!("failed to inspect link metadata: {error}"),
                    ));
                    delete_blocked = true;
                    continue;
                }
            };

            if is_delete_link_metadata(&metadata) {
                warnings.push(linked_delete_target_warning(&path));
                delete_blocked = true;
                continue;
            }

            let file_type = metadata.file_type();

            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            estimated_bytes += metadata.len();
            targeted_file_count += 1;
        }
    }

    Ok(DeleteTargetInspection {
        is_directory: true,
        estimated_bytes,
        targeted_file_count,
        warnings,
        delete_blocked,
    })
}

fn build_delete_execution_plan(
    root: &Path,
    path: &Path,
) -> Result<DeleteExecutionPlan, Vec<CleanupWarning>> {
    let metadata = match validate_delete_path_chain(root, path) {
        Ok(metadata) => metadata,
        Err(error) => return Err(vec![execution_warning_from_delete_path_error(error, path)]),
    };

    let file_type = metadata.file_type();
    if file_type.is_file() {
        return Ok(DeleteExecutionPlan {
            file_paths: vec![path.to_path_buf()],
            directory_paths: Vec::new(),
        });
    }
    if !file_type.is_dir() {
        return Err(vec![path_scan_warning(
            path,
            "unsupported path type during delete execution",
        )]);
    }

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) => return Err(vec![directory_read_warning(path, &error)]),
    };

    let mut child_paths = Vec::new();
    let mut warnings = Vec::new();
    for entry in entries {
        match entry {
            Ok(entry) => child_paths.push(entry.path()),
            Err(error) => warnings.push(directory_entry_warning(path, &error)),
        }
    }
    if !warnings.is_empty() {
        return Err(warnings);
    }

    let mut plan = DeleteExecutionPlan::default();
    for child_path in child_paths {
        match build_delete_execution_plan(root, &child_path) {
            Ok(child_plan) => {
                plan.file_paths.extend(child_plan.file_paths);
                plan.directory_paths.extend(child_plan.directory_paths);
            }
            Err(mut child_warnings) => warnings.append(&mut child_warnings),
        }
    }

    if !warnings.is_empty() {
        return Err(warnings);
    }

    plan.directory_paths.push(path.to_path_buf());
    Ok(plan)
}

fn execute_delete_plan(root: &Path, plan: DeleteExecutionPlan) -> DeleteExecutionResult {
    let mut deleted_file_count = 0_u32;
    let mut warnings = Vec::new();

    for file_path in plan.file_paths {
        let metadata = match validate_delete_path_chain(root, &file_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(execution_warning_from_delete_path_error(error, &file_path));
                return DeleteExecutionResult {
                    deleted_file_count,
                    warnings,
                };
            }
        };
        if !metadata.file_type().is_file() {
            warnings.push(path_scan_warning(
                &file_path,
                "delete target changed to a non-file path before removal",
            ));
            return DeleteExecutionResult {
                deleted_file_count,
                warnings,
            };
        }

        match fs::remove_file(&file_path) {
            Ok(()) => deleted_file_count += 1,
            Err(error) => {
                warnings.push(file_delete_warning(&file_path, &error));
                return DeleteExecutionResult {
                    deleted_file_count,
                    warnings,
                };
            }
        }
    }

    for directory_path in plan.directory_paths {
        let metadata = match validate_delete_path_chain(root, &directory_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(execution_warning_from_delete_path_error(error, &directory_path));
                return DeleteExecutionResult {
                    deleted_file_count,
                    warnings,
                };
            }
        };
        if !metadata.file_type().is_dir() {
            warnings.push(path_scan_warning(
                &directory_path,
                "delete target changed to a non-directory path before removal",
            ));
            return DeleteExecutionResult {
                deleted_file_count,
                warnings,
            };
        }

        if let Err(error) = fs::remove_dir(&directory_path) {
            warnings.push(path_delete_warning(&directory_path, &error));
            return DeleteExecutionResult {
                deleted_file_count,
                warnings,
            };
        }
    }

    DeleteExecutionResult {
        deleted_file_count,
        warnings,
    }
}

fn normalize_delete_targets(root: &Path, paths: &[String]) -> Result<Vec<PathBuf>, CoreError> {
    if paths.is_empty() {
        return Err(CoreError::NoPathsSelected);
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| CoreError::InvalidDeletePath {
        path: format!("{} ({})", root.display(), error),
    })?;

    let mut canonical_targets = paths
        .iter()
        .map(|path| {
            reject_linked_delete_target(Path::new(path))?;
            let canonical =
                fs::canonicalize(path).map_err(|error| CoreError::InvalidDeletePath {
                    path: format!("{} ({})", path, error),
                })?;
            if is_root_delete_target(&canonical) {
                return Err(CoreError::InvalidDeletePath {
                    path: canonical.display().to_string(),
                });
            }
            if canonical.strip_prefix(&canonical_root).is_err() {
                return Err(CoreError::InvalidDeletePath {
                    path: canonical.display().to_string(),
                });
            }
            Ok(canonical)
        })
        .collect::<Result<Vec<_>, _>>()?;

    canonical_targets.sort_by(|left, right| {
        left.components()
            .count()
            .cmp(&right.components().count())
            .then_with(|| left.display().to_string().cmp(&right.display().to_string()))
    });

    let mut normalized = Vec::new();
    for target in canonical_targets {
        if normalized
            .iter()
            .any(|existing: &PathBuf| target.starts_with(existing))
        {
            continue;
        }
        normalized.push(target);
    }

    Ok(normalized)
}

pub fn preview_selected_paths(
    root: &Path,
    paths: &[String],
) -> Result<DeletePathsResponse, CoreError> {
    let normalized_paths = normalize_delete_targets(root, paths)?;
    let canonical_root = fs::canonicalize(root).map_err(|error| CoreError::InvalidDeletePath {
        path: format!("{} ({})", root.display(), error),
    })?;
    let mut results = Vec::new();

    for path in normalized_paths {
        let inspection = inspect_delete_target(&canonical_root, &path)?;

        results.push(PathCleanupResult {
            path: path.display().to_string(),
            is_directory: inspection.is_directory,
            estimated_bytes: inspection.estimated_bytes,
            deleted_file_count: inspection.targeted_file_count,
            success: inspection.warnings.is_empty(),
            warnings: inspection.warnings,
        });
    }

    Ok(DeletePathsResponse {
        summary: PathCleanupSummary {
            selected_count: results.len() as u32,
            successful_paths: results.iter().filter(|result| result.success).count() as u32,
            failed_paths: results.iter().filter(|result| !result.success).count() as u32,
            total_estimated_bytes: results.iter().map(|result| result.estimated_bytes).sum(),
            total_deleted_files: results.iter().map(|result| result.deleted_file_count).sum(),
            total_warnings: results
                .iter()
                .map(|result| result.warnings.len() as u32)
                .sum(),
        },
        paths: results,
    })
}

pub fn delete_selected_paths(
    root: &Path,
    paths: &[String],
) -> Result<DeletePathsResponse, CoreError> {
    let normalized_paths = normalize_delete_targets(root, paths)?;
    let canonical_root = fs::canonicalize(root).map_err(|error| CoreError::InvalidDeletePath {
        path: format!("{} ({})", root.display(), error),
    })?;
    let mut results = Vec::new();

    for path in normalized_paths {
        let inspection = inspect_delete_target(&canonical_root, &path)?;
        let is_directory = inspection.is_directory;
        let estimated_bytes = inspection.estimated_bytes;
        let targeted_file_count = inspection.targeted_file_count;
        let mut warnings = inspection.warnings;

        if inspection.delete_blocked {
            results.push(PathCleanupResult {
                path: path.display().to_string(),
                is_directory,
                estimated_bytes,
                deleted_file_count: 0,
                success: false,
                warnings,
            });
            continue;
        }

        let execution_plan = match build_delete_execution_plan(&canonical_root, &path) {
            Ok(plan) => plan,
            Err(mut execution_warnings) => {
                warnings.append(&mut execution_warnings);
                results.push(PathCleanupResult {
                    path: path.display().to_string(),
                    is_directory,
                    estimated_bytes,
                    deleted_file_count: 0,
                    success: false,
                    warnings,
                });
                continue;
            }
        };

        let execution = execute_delete_plan(&canonical_root, execution_plan);
        warnings.extend(execution.warnings);
        let success = warnings.is_empty();
        let deleted_file_count = if success {
            targeted_file_count
        } else {
            execution.deleted_file_count
        };

        results.push(PathCleanupResult {
            path: path.display().to_string(),
            is_directory: is_directory,
            estimated_bytes,
            deleted_file_count,
            success,
            warnings,
        });
    }

    Ok(DeletePathsResponse {
        summary: PathCleanupSummary {
            selected_count: results.len() as u32,
            successful_paths: results.iter().filter(|result| result.success).count() as u32,
            failed_paths: results.iter().filter(|result| !result.success).count() as u32,
            total_estimated_bytes: results.iter().map(|result| result.estimated_bytes).sum(),
            total_deleted_files: results.iter().map(|result| result.deleted_file_count).sum(),
            total_warnings: results
                .iter()
                .map(|result| result.warnings.len() as u32)
                .sum(),
        },
        paths: results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use std::fs;
    use std::sync::{Mutex, OnceLock};
    use tempfile::TempDir;

    #[cfg(unix)]
    use std::os::unix::fs::symlink as create_symlink;
    #[cfg(windows)]
    use std::os::windows::fs::{symlink_dir, symlink_file};

    fn contracts_fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contracts/fixtures")
    }

    fn load_fixture<T: DeserializeOwned>(name: &str) -> T {
        let path = contracts_fixture_dir().join(name);
        serde_json::from_str(&fs::read_to_string(path).expect("fixture should be readable"))
            .expect("fixture should deserialize")
    }

    fn write_file(path: &Path, size: usize) {
        let data = vec![b'x'; size];
        fs::write(path, data).expect("fixture file should write");
    }

    #[cfg(windows)]
    fn create_file_symlink(original: &Path, link: &Path) {
        symlink_file(original, link).expect("file symlink should create");
    }

    #[cfg(unix)]
    fn create_file_symlink(original: &Path, link: &Path) {
        create_symlink(original, link).expect("file symlink should create");
    }

    #[cfg(windows)]
    fn create_directory_symlink(original: &Path, link: &Path) {
        symlink_dir(original, link).expect("directory symlink should create");
    }

    #[cfg(unix)]
    fn create_directory_symlink(original: &Path, link: &Path) {
        create_symlink(original, link).expect("directory symlink should create");
    }

    fn build_safe_default_fixture_tree() -> (TempDir, SafeDefaultScanRoots) {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path();

        let user_temp = root.join("user-temp");
        let thumbnail_cache = root.join("thumbnail-cache");
        let shader_cache = root.join("shader-cache");
        fs::create_dir_all(&user_temp).expect("user-temp dir should create");
        fs::create_dir_all(&thumbnail_cache).expect("thumbnail-cache dir should create");
        fs::create_dir_all(shader_cache.join("nested"))
            .expect("shader-cache nested dir should create");

        for index in 0..20 {
            write_file(&user_temp.join(format!("temp-{index:02}.bin")), 25_600);
        }
        for index in 0..8 {
            write_file(
                &thumbnail_cache.join(format!("thumb-{index:02}.db")),
                131_072,
            );
        }
        for index in 0..55 {
            write_file(
                &shader_cache
                    .join("nested")
                    .join(format!("shader-{index:02}.cache")),
                75_000,
            );
        }
        write_file(
            &shader_cache.join("nested").join("shader-55.cache"),
            100_024,
        );
        write_file(&shader_cache.join("locked.bin"), 4_096);

        (
            temp_dir,
            SafeDefaultScanRoots {
                user_temp,
                thumbnail_cache,
                shader_cache,
            },
        )
    }

    fn build_safe_default_clean_fixture_tree() -> (TempDir, SafeDefaultScanRoots) {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path();

        let user_temp = root.join("user-temp");
        let thumbnail_cache = root.join("thumbnail-cache");
        let shader_cache = root.join("shader-cache");
        fs::create_dir_all(&user_temp).expect("user-temp dir should create");
        fs::create_dir_all(&thumbnail_cache).expect("thumbnail-cache dir should create");
        fs::create_dir_all(shader_cache.join("nested"))
            .expect("shader-cache nested dir should create");

        for index in 0..20 {
            write_file(&user_temp.join(format!("temp-{index:02}.bin")), 25_600);
        }
        for index in 0..8 {
            write_file(
                &thumbnail_cache.join(format!("thumb-{index:02}.db")),
                131_072,
            );
        }
        for index in 0..52 {
            write_file(
                &shader_cache
                    .join("nested")
                    .join(format!("shader-{index:02}.cache")),
                75_000,
            );
        }
        write_file(
            &shader_cache.join("nested").join("shader-large.bin"),
            62_880,
        );
        write_file(&shader_cache.join("locked.bin"), 4_096);

        (
            temp_dir,
            SafeDefaultScanRoots {
                user_temp,
                thumbnail_cache,
                shader_cache,
            },
        )
    }

    fn build_current_machine_category_fixture_tree() -> (TempDir, PathBuf, PathBuf) {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path();

        let user_temp = root.join("Temp");
        let local_app_data = root.join("LocalAppData");
        let explorer = local_app_data
            .join("Microsoft")
            .join("Windows")
            .join("Explorer");
        let shader_cache = local_app_data.join("D3DSCache");

        fs::create_dir_all(&user_temp).expect("user temp dir should create");
        fs::create_dir_all(&explorer).expect("explorer dir should create");
        fs::create_dir_all(shader_cache.join("nested")).expect("shader dir should create");

        write_file(&user_temp.join("temp-a.bin"), 10_000);
        write_file(&user_temp.join("temp-b.bin"), 20_000);
        write_file(&explorer.join("thumb-cache.db"), 40_000);
        write_file(
            &shader_cache.join("nested").join("shader-cache.bin"),
            60_000,
        );
        write_file(&shader_cache.join(LOCKED_FILE_NAME), 4_096);

        (temp_dir, user_temp, local_app_data)
    }

    fn build_full_scan_tree_fixture() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path().join("full-root");
        fs::create_dir_all(root.join("games").join("shaders"))
            .expect("games shaders dir should create");
        fs::create_dir_all(root.join("documents")).expect("documents dir should create");

        write_file(&root.join("games").join("big-cache.bin"), 500_000);
        write_file(
            &root.join("games").join("shaders").join("shader-cache.bin"),
            120_000,
        );
        write_file(&root.join("documents").join("notes.txt"), 5_000);
        write_file(&root.join(LOCKED_FILE_NAME), 4_096);
        (temp_dir, root)
    }

    fn canonicalize_clean_response_paths(response: &mut CleanResponse, temp_root: &Path) {
        let canonical_root = PathBuf::from(r"C:\Fixture");
        let temp_root_text = temp_root.display().to_string();
        let canonical_root_text = canonical_root.display().to_string();

        for category in &mut response.categories {
            for warning in &mut category.warnings {
                warning.message = warning
                    .message
                    .replace(&temp_root_text, &canonical_root_text);
            }
        }
    }

    fn with_env_var<T>(key: &str, value: &Path, action: impl FnOnce() -> T) -> T {
        let previous = env::var_os(key);
        // SAFETY: tests in this module rely on controlled, short-lived process-local env overrides.
        unsafe {
            env::set_var(key, value);
        }
        let result = action();
        match previous {
            Some(original) => {
                // SAFETY: restoring the original environment variable after the test action.
                unsafe {
                    env::set_var(key, original);
                }
            }
            None => {
                // SAFETY: removing the temporary test environment variable after the test action.
                unsafe {
                    env::remove_var(key);
                }
            }
        }
        result
    }

    fn env_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn acquire_env_lock() -> std::sync::MutexGuard<'static, ()> {
        env_test_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn canonicalize_scan_response_paths(response: &mut ScanResponse, temp_root: &Path) {
        let canonical_root = PathBuf::from(r"C:\Fixture");
        let temp_root_text = temp_root.display().to_string();
        let canonical_root_text = canonical_root.display().to_string();

        for category in &mut response.categories {
            for warning in &mut category.warnings {
                warning.message = warning
                    .message
                    .replace(&temp_root_text, &canonical_root_text);
            }
        }
    }

    #[test]
    fn category_registry_matches_fixture_metadata() {
        let expected: Vec<CategoryMetadata> = load_fixture("categories.json");
        assert_eq!(expected, list_categories());
    }

    #[test]
    fn safe_default_categories_preserve_registry_order() {
        assert_eq!(
            vec![
                String::from("user-temp"),
                String::from("thumbnail-cache"),
                String::from("shader-cache")
            ],
            safe_default_category_ids()
        );
    }

    #[test]
    fn resolve_categories_is_case_insensitive_and_reports_unknown_sorted() {
        let (selected, unknown) = resolve_categories(&[
            String::from("SHADER-CACHE"),
            String::from("user-temp"),
            String::from("missing"),
            String::from("MISSING"),
        ]);
        assert_eq!(
            vec![String::from("user-temp"), String::from("shader-cache")],
            selected.into_iter().map(|item| item.id).collect::<Vec<_>>()
        );
        assert_eq!(
            vec![String::from("MISSING"), String::from("missing")],
            unknown
        );
    }

    #[test]
    fn analyze_elevation_uses_registry_requires_admin_flag() {
        let elevation = analyze_elevation(&[
            String::from("setup-logs"),
            String::from("shader-cache"),
            String::from("windows-temp"),
        ]);
        assert!(!elevation.is_process_elevated);
        assert!(elevation.requires_elevation);
        assert_eq!(
            vec![String::from("windows-temp"), String::from("setup-logs")],
            elevation.admin_category_ids
        );
    }

    #[test]
    fn safe_default_scan_mvp_matches_fixture_contract() {
        let (temp_dir, roots) = build_safe_default_fixture_tree();
        let mut scan = scan_safe_defaults(&roots).expect("scan should succeed");
        canonicalize_scan_response_paths(&mut scan, temp_dir.path());
        let expected: ScanResponse = load_fixture("scan-safe-default.json");
        assert_eq!(expected, scan);
    }

    #[test]
    fn safe_default_scan_reports_missing_root_as_warning() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let roots = SafeDefaultScanRoots {
            user_temp: temp_dir.path().join("missing-user-temp"),
            thumbnail_cache: temp_dir.path().join("missing-thumbnail-cache"),
            shader_cache: temp_dir.path().join("missing-shader-cache"),
        };
        let scan = scan_safe_defaults(&roots).expect("scan should succeed with warnings");
        assert_eq!(3, scan.summary.category_count);
        assert_eq!(3, scan.summary.total_warnings);
        assert!(scan.categories.iter().all(|item| item.estimated_bytes == 0));
        assert!(scan
            .categories
            .iter()
            .flat_map(|item| item.warnings.iter())
            .all(|warning| warning.code == WarningCode::InaccessibleRoot
                && warning.severity == WarningSeverity::Attention));
    }

    #[test]
    fn safe_default_clean_mvp_matches_fixture_contract() {
        let (temp_dir, roots) = build_safe_default_clean_fixture_tree();
        let mut clean = clean_safe_defaults(&roots).expect("clean should succeed with warnings");
        canonicalize_clean_response_paths(&mut clean, temp_dir.path());
        let expected: CleanResponse = load_fixture("clean-safe-default.json");
        assert_eq!(expected, clean);
    }

    #[test]
    fn safe_default_clean_reports_missing_root_as_warning() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let roots = SafeDefaultScanRoots {
            user_temp: temp_dir.path().join("missing-user-temp"),
            thumbnail_cache: temp_dir.path().join("missing-thumbnail-cache"),
            shader_cache: temp_dir.path().join("missing-shader-cache"),
        };
        let clean = clean_safe_defaults(&roots).expect("clean should succeed with warnings");
        assert_eq!(3, clean.summary.category_count);
        assert_eq!(3, clean.summary.total_warnings);
        assert_eq!(0, clean.summary.total_freed_bytes);
        assert!(clean
            .categories
            .iter()
            .flat_map(|item| item.warnings.iter())
            .all(|warning| warning.code == WarningCode::InaccessibleRoot
                && warning.severity == WarningSeverity::Attention));
    }

    #[test]
    fn current_machine_scan_and_clean_append_history_entries() {
        let _guard = acquire_env_lock();
        let (temp_dir, roots) = build_safe_default_clean_fixture_tree();
        let history_root = temp_dir.path().join("local-app-data");
        let history_path = history_root.join("CDriveCleaner").join("history.json");

        let (response_scan, response_clean) =
            with_env_var("CDRIVECLEANER_HISTORY_PATH", &history_path, || {
                with_env_var("TEMP", &roots.user_temp, || {
                    with_env_var("TMP", &roots.user_temp, || {
                        with_env_var("LOCALAPPDATA", &history_root, || {
                            let scan = scan_safe_defaults_for_current_machine()
                                .expect("scan should succeed");
                            let clean = clean_safe_defaults_for_current_machine()
                                .expect("clean should succeed");
                            (scan, clean)
                        })
                    })
                })
            });
        assert_eq!(3, response_scan.summary.category_count);
        assert_eq!(3, response_clean.summary.category_count);

        let history = load_history_from_path(&history_path).expect("history should load");
        assert_eq!(2, history.entries.len());
        assert_eq!("scan", history.entries[0].kind);
        assert_eq!("clean", history.entries[1].kind);
        assert_eq!(Some(HistoryOrigin::Manual), history.entries[0].origin);
        assert_eq!(Some(HistoryOrigin::Manual), history.entries[1].origin);
        assert!(history.entries[0].summary.contains("Scan complete."));
        assert!(history.entries[1].summary.contains("Cleanup complete."));
        assert_eq!(Some(3), history.entries[0].category_count);
        assert_eq!(Some(3), history.entries[1].category_count);
    }

    #[test]
    fn current_history_store_dir_migrates_legacy_local_app_data_layout() {
        let _guard = acquire_env_lock();
        let temp_dir = TempDir::new().expect("temp dir should create");
        let local_app_data = temp_dir.path().join("local-app-data");
        let legacy_dir = local_app_data.join("CDriveCleanerGreenfield");
        let legacy_exports = legacy_dir.join("exports");
        fs::create_dir_all(&legacy_exports).expect("legacy exports dir should create");
        fs::write(legacy_dir.join("history.json"), "[]").expect("legacy history should write");
        fs::write(legacy_dir.join("scheduled-scan-plan.json"), "null")
            .expect("legacy plan should write");
        fs::write(legacy_exports.join("report.json"), "{}")
            .expect("legacy export should write");

        let migrated_dir =
            with_env_var("LOCALAPPDATA", &local_app_data, current_history_store_dir);

        assert_eq!(local_app_data.join("CDriveCleaner"), migrated_dir);
        assert!(migrated_dir.join("history.json").exists());
        assert!(migrated_dir.join("scheduled-scan-plan.json").exists());
        assert!(migrated_dir.join("exports").join("report.json").exists());
    }

    #[test]
    fn append_history_entry_recovers_from_corrupt_history_file() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let history_path = temp_dir.path().join("history.json");
        fs::write(&history_path, "not-json").expect("corrupt history should write");

        append_history_entry(
            &history_path,
            HistoryEntry {
                timestamp: String::from("2026-03-22T10:00:00Z"),
                kind: String::from("scan"),
                summary: String::from("Scan complete."),
                origin: Some(HistoryOrigin::Manual),
                origin_label: None,
                category_count: Some(1),
                total_estimated_bytes: Some(1024),
                total_candidate_files: Some(4),
                total_warnings: Some(0),
                successful_categories: None,
                failed_categories: None,
                total_freed_bytes: None,
                total_deleted_files: None,
            },
        )
        .expect("append should recover from corrupt file");

        let recovered =
            load_history_from_path(&history_path).expect("recovered history should load");
        assert_eq!(1, recovered.entries.len());
        assert_eq!("scan", recovered.entries[0].kind);

        let corrupt_backups = fs::read_dir(temp_dir.path())
            .expect("temp dir should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.starts_with("history.json.corrupt-"))
            .collect::<Vec<_>>();
        assert_eq!(1, corrupt_backups.len());
    }

    #[test]
    fn export_scan_report_writes_json_to_export_dir() {
        let _guard = acquire_env_lock();
        let temp_dir = TempDir::new().expect("temp dir should create");
        let export_dir = temp_dir.path().join("exports");
        let payload: ScanResponse = load_fixture("scan-safe-default.json");

        let artifact = with_env_var("CDRIVECLEANER_EXPORT_DIR", &export_dir, || {
            export_scan_report(&ScanExportPayload::CategoryScan(payload.clone()))
                .expect("scan report should export")
        });

        assert!(artifact.file_name.starts_with("scan-report-"));
        assert_eq!("json", artifact.format);
        let saved: ScanExportPayload = serde_json::from_str(
            &fs::read_to_string(&artifact.file_path).expect("exported scan should be readable"),
        )
        .expect("exported scan should deserialize");
        assert_eq!(ScanExportPayload::CategoryScan(payload), saved);
    }

    #[test]
    fn export_history_writes_json_to_export_dir() {
        let _guard = acquire_env_lock();
        let temp_dir = TempDir::new().expect("temp dir should create");
        let export_dir = temp_dir.path().join("exports");
        let history: HistoryResponse = load_fixture("history.json");

        let artifact = with_env_var("CDRIVECLEANER_EXPORT_DIR", &export_dir, || {
            export_history(&history).expect("history should export")
        });

        assert!(artifact.file_name.starts_with("history-export-"));
        assert_eq!("json", artifact.format);
        let saved: HistoryResponse = serde_json::from_str(
            &fs::read_to_string(&artifact.file_path).expect("exported history should be readable"),
        )
        .expect("exported history should deserialize");
        assert_eq!(history, saved);
    }

    #[test]
    fn export_scan_report_supports_full_scan_payloads() {
        let _guard = acquire_env_lock();
        let temp_dir = TempDir::new().expect("temp dir should create");
        let export_dir = temp_dir.path().join("exports");
        let payload = ScanExportPayload::FullScan(FullScanTreeResponse {
            root_path: String::from(r"C:\Fixture"),
            summary: CleanupScanSummary {
                category_count: 1,
                total_estimated_bytes: 4096,
                total_candidate_files: 2,
                total_warnings: 1,
            },
            tree: FullScanTreeNode {
                path: String::from(r"C:\Fixture"),
                name: String::from(r"C:\Fixture"),
                is_directory: true,
                size_bytes: 4096,
                has_children: true,
                children_loaded: true,
                warnings: vec![CleanupWarning {
                    code: WarningCode::FileInfoAccessDenied,
                    severity: WarningSeverity::Info,
                    message: String::from("Skipped file info for 'C:\\Fixture\\locked.bin': Access is denied."),
                }],
                children: vec![FullScanTreeNode {
                    path: String::from(r"C:\Fixture\nested"),
                    name: String::from("nested"),
                    is_directory: true,
                    size_bytes: 4096,
                    has_children: false,
                    children_loaded: true,
                    warnings: Vec::new(),
                    children: Vec::new(),
                }],
            },
        });

        let artifact = with_env_var("CDRIVECLEANER_EXPORT_DIR", &export_dir, || {
            export_scan_report(&payload).expect("full scan report should export")
        });

        assert!(artifact.file_name.starts_with("full-scan-report-"));
        let saved: ScanExportPayload = serde_json::from_str(
            &fs::read_to_string(&artifact.file_path).expect("exported full scan should be readable"),
        )
        .expect("exported full scan should deserialize");
        assert_eq!(payload, saved);
    }

    #[test]
    fn export_scan_report_avoids_overwriting_when_timestamp_collides() {
        let _guard = acquire_env_lock();
        let temp_dir = TempDir::new().expect("temp dir should create");
        let export_dir = temp_dir.path().join("exports");
        let payload: ScanResponse = load_fixture("scan-safe-default.json");

        let (first, second) = with_env_var("CDRIVECLEANER_EXPORT_DIR", &export_dir, || {
            let first = export_scan_report(&ScanExportPayload::CategoryScan(payload.clone()))
                .expect("first export should succeed");
            let second = export_scan_report(&ScanExportPayload::CategoryScan(payload.clone()))
                .expect("second export should succeed");
            (first, second)
        });

        assert_ne!(first.file_path, second.file_path);
    }

    #[test]
    fn scheduled_scan_plan_round_trips_from_disk() {
        let _guard = acquire_env_lock();
        let temp_dir = TempDir::new().expect("temp dir should create");
        let plan_path = temp_dir.path().join("scheduled-scan-plan.json");

        let plan = with_env_var("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH", &plan_path, || {
            save_scheduled_scan_plan(&ScheduledScanPlanDraft {
                mode: ScheduledScanMode::PreparedPreset,
                scheduled_time: String::from("06:45"),
                enabled: true,
                captured_category_ids: vec![String::from("user-temp"), String::from("shader-cache")],
            })
            .expect("plan should save")
        });

        assert_eq!(ScheduledScanMode::PreparedPreset, plan.mode);
        assert!(!plan.requires_admin);
        assert_eq!(Some(String::from("06:45")), Some(plan.scheduled_time.clone()));

        let loaded = with_env_var("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH", &plan_path, || {
            current_scheduled_scan_plan()
                .expect("plan should load")
                .expect("plan should exist")
        });
        assert_eq!(plan.id, loaded.id);
        assert_eq!(plan.captured_category_ids, loaded.captured_category_ids);
    }

    #[test]
    fn scheduled_scan_plan_rejects_empty_prepared_preset() {
        let error = save_scheduled_scan_plan(&ScheduledScanPlanDraft {
            mode: ScheduledScanMode::PreparedPreset,
            scheduled_time: String::from("09:00"),
            enabled: true,
            captured_category_ids: Vec::new(),
        })
        .expect_err("empty prepared preset should fail");

        assert!(matches!(error, CoreError::EmptyPreparedPreset));
    }

    #[test]
    fn scheduled_scan_plan_rejects_unknown_prepared_categories() {
        let error = save_scheduled_scan_plan(&ScheduledScanPlanDraft {
            mode: ScheduledScanMode::PreparedPreset,
            scheduled_time: String::from("09:00"),
            enabled: true,
            captured_category_ids: vec![String::from("missing-category")],
        })
        .expect_err("unknown prepared categories should fail");

        assert!(matches!(error, CoreError::UnknownCategories { .. }));
    }

    #[test]
    fn execute_scheduled_scan_plan_updates_last_run_and_history() {
        let _guard = acquire_env_lock();
        let (temp_dir, roots) = build_safe_default_fixture_tree();
        let plan_path = temp_dir.path().join("scheduled-scan-plan.json");
        let history_path = temp_dir.path().join("history.json");
        let local_app_data = temp_dir.path().join("LocalAppData");
        fs::create_dir_all(&local_app_data).expect("local app data dir should create");

        let plan = with_env_var("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH", &plan_path, || {
            with_env_var("CDRIVECLEANER_HISTORY_PATH", &history_path, || {
                with_env_var("TEMP", &roots.user_temp, || {
                    with_env_var("TMP", &roots.user_temp, || {
                        with_env_var("LOCALAPPDATA", &local_app_data, || {
                            save_scheduled_scan_plan(&ScheduledScanPlanDraft {
                                mode: ScheduledScanMode::SafeDefaults,
                                scheduled_time: String::from("08:30"),
                                enabled: true,
                                captured_category_ids: Vec::new(),
                            })
                            .expect("plan should save")
                        })
                    })
                })
            })
        });

        let executed = with_env_var("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH", &plan_path, || {
            with_env_var("CDRIVECLEANER_HISTORY_PATH", &history_path, || {
                with_env_var("TEMP", &roots.user_temp, || {
                    with_env_var("TMP", &roots.user_temp, || {
                        with_env_var("LOCALAPPDATA", &local_app_data, || {
                            execute_scheduled_scan_plan(&plan.id).expect("scheduled scan should run")
                        })
                    })
                })
            })
        });

        assert!(executed.last_run_at.is_some());
        assert!(executed
            .last_run_summary
            .as_deref()
            .unwrap_or_default()
            .contains("Scheduled scan"));

        let history = load_history_from_path(&history_path).expect("history should load");
        assert_eq!(1, history.entries.len());
        assert!(history.entries[0].summary.contains("Scheduled scan"));
    }

    #[test]
    fn disabled_scheduled_scan_plan_does_not_execute() {
        let _guard = acquire_env_lock();
        let temp_dir = TempDir::new().expect("temp dir should create");
        let plan_path = temp_dir.path().join("scheduled-scan-plan.json");

        let plan = with_env_var("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH", &plan_path, || {
            save_scheduled_scan_plan(&ScheduledScanPlanDraft {
                mode: ScheduledScanMode::SafeDefaults,
                scheduled_time: String::from("08:30"),
                enabled: false,
                captured_category_ids: Vec::new(),
            })
            .expect("plan should save")
        });

        let error = with_env_var("CDRIVECLEANER_SCHEDULED_SCAN_PLAN_PATH", &plan_path, || {
            execute_scheduled_scan_plan(&plan.id).expect_err("disabled plan should not run")
        });

        assert!(matches!(error, CoreError::ScheduledScanPlanDisabled { .. }));
    }

    #[test]
    fn current_machine_scan_and_clean_ignore_unwritable_history_path() {
        let _guard = acquire_env_lock();
        let (temp_dir, roots) = build_safe_default_clean_fixture_tree();
        let unwritable_history_target = temp_dir.path().join("history-as-directory");
        fs::create_dir_all(&unwritable_history_target).expect("directory target should create");

        let response_scan = with_env_var(
            "CDRIVECLEANER_HISTORY_PATH",
            &unwritable_history_target,
            || {
                with_env_var("TEMP", &roots.user_temp, || {
                    with_env_var("TMP", &roots.user_temp, || {
                        with_env_var("LOCALAPPDATA", temp_dir.path(), || {
                            scan_safe_defaults_for_current_machine()
                                .expect("scan should ignore history write failure")
                        })
                    })
                })
            },
        );
        assert_eq!(3, response_scan.summary.category_count);

        let response_clean = with_env_var(
            "CDRIVECLEANER_HISTORY_PATH",
            &unwritable_history_target,
            || {
                with_env_var("TEMP", &roots.user_temp, || {
                    with_env_var("TMP", &roots.user_temp, || {
                        with_env_var("LOCALAPPDATA", temp_dir.path(), || {
                            clean_safe_defaults_for_current_machine()
                                .expect("clean should ignore history write failure")
                        })
                    })
                })
            },
        );
        assert_eq!(3, response_clean.summary.category_count);
        assert!(unwritable_history_target.is_dir());
    }

    #[test]
    fn scan_categories_for_current_machine_uses_selected_category_ids() {
        let _guard = acquire_env_lock();
        let (temp_dir, user_temp, local_app_data) = build_current_machine_category_fixture_tree();
        let history_path = temp_dir.path().join("history.json");

        let response = with_env_var("CDRIVECLEANER_HISTORY_PATH", &history_path, || {
            with_env_var("TEMP", &user_temp, || {
                with_env_var("TMP", &user_temp, || {
                    with_env_var("LOCALAPPDATA", &local_app_data, || {
                        scan_categories_for_current_machine(&[
                            String::from("shader-cache"),
                            String::from("user-temp"),
                        ])
                        .expect("prepared category scan should succeed")
                    })
                })
            })
        });

        assert_eq!(2, response.summary.category_count);
        assert_eq!(90_000, response.summary.total_estimated_bytes);
        assert_eq!(3, response.summary.total_candidate_files);
        assert_eq!(1, response.summary.total_warnings);
        assert_eq!(
            vec![String::from("user-temp"), String::from("shader-cache")],
            response
                .categories
                .iter()
                .map(|category| category.category_id.clone())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn clean_categories_for_current_machine_uses_selected_category_ids() {
        let _guard = acquire_env_lock();
        let (temp_dir, user_temp, local_app_data) = build_current_machine_category_fixture_tree();
        let history_path = temp_dir.path().join("history.json");

        let response = with_env_var("CDRIVECLEANER_HISTORY_PATH", &history_path, || {
            with_env_var("TEMP", &user_temp, || {
                with_env_var("TMP", &user_temp, || {
                    with_env_var("LOCALAPPDATA", &local_app_data, || {
                        clean_categories_for_current_machine(&[
                            String::from("user-temp"),
                            String::from("shader-cache"),
                        ])
                        .expect("prepared category clean should succeed")
                    })
                })
            })
        });

        assert_eq!(2, response.summary.category_count);
        assert_eq!(90_000, response.summary.total_freed_bytes);
        assert_eq!(3, response.summary.total_deleted_files);
        assert_eq!(1, response.summary.total_warnings);
        assert_eq!(1, response.summary.failed_categories);
        assert_eq!(1, response.summary.successful_categories);
    }

    #[test]
    fn full_scan_tree_collects_nested_sizes_and_warnings() {
        let (_temp_dir, root) = build_full_scan_tree_fixture();
        let response = scan_full_tree(&root).expect("full scan should succeed");

        assert_eq!(1, response.summary.category_count);
        assert_eq!(625_000, response.summary.total_estimated_bytes);
        assert_eq!(3, response.summary.total_candidate_files);
        assert_eq!(1, response.summary.total_warnings);
        assert!(response.tree.is_directory);
        assert_eq!(625_000, response.tree.size_bytes);
        assert!(response
            .tree
            .warnings
            .iter()
            .any(|warning| warning.message.contains("locked.bin")));
        assert!(response
            .tree
            .warnings
            .iter()
            .any(|warning| warning.code == WarningCode::FileInfoAccessDenied));

        let games = response
            .tree
            .children
            .iter()
            .find(|node| node.name == "games")
            .expect("games dir should exist");
        assert!(games.is_directory);
        assert!(games.has_children);
        assert!(!games.children_loaded);
        assert_eq!(620_000, games.size_bytes);
    }

    #[test]
    fn full_scan_tree_for_current_machine_respects_root_override() {
        let _guard = acquire_env_lock();
        let (_temp_dir, root) = build_full_scan_tree_fixture();
        let response = with_env_var("CDRIVECLEANER_FULL_SCAN_ROOT", &root, || {
            scan_full_tree_for_current_machine().expect("full scan should respect override")
        });

        assert_eq!(display_scan_path(&root), response.root_path);
        assert_eq!(625_000, response.summary.total_estimated_bytes);
    }

    #[test]
    fn expand_full_scan_node_loads_next_level_children() {
        let _guard = acquire_env_lock();
        let (_temp_dir, root) = build_full_scan_tree_fixture();
        let games_path = root.join("games");
        let expanded = expand_full_scan_node(&root, &games_path).expect("expand should succeed");

        assert_eq!(display_scan_path(&games_path), expanded.path);
        assert!(expanded.is_directory);
        assert!(expanded.children_loaded);
        assert_eq!(2, expanded.children.len());
        assert_eq!("big-cache.bin", expanded.children[0].name);
        assert_eq!("shaders", expanded.children[1].name);
        assert!(expanded.children[1].is_directory);
        assert!(!expanded.children[1].children_loaded);
    }

    #[test]
    fn display_scan_path_strips_extended_windows_prefixes() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(r"C:\Users", display_scan_path(Path::new(r"\\?\C:\Users")));
            assert_eq!(
                r"\\server\share\folder",
                display_scan_path(Path::new(r"\\?\UNC\server\share\folder"))
            );
        }
    }

    #[test]
    fn depth_zero_directory_summary_skips_loading_grandchildren() {
        let _guard = acquire_env_lock();
        let (_temp_dir, root) = build_full_scan_tree_fixture();
        let games_path = root.join("games");

        let summary = build_full_scan_tree_node(&games_path, 0).expect("summary should succeed");

        assert!(summary.node.is_directory);
        assert!(!summary.node.children_loaded);
        assert!(summary.node.children.is_empty());
        assert_eq!(2, summary.total_file_count);
        assert_eq!(620_000, summary.node.size_bytes);
        assert_eq!(0, summary.total_warning_count);
    }

    #[test]
    fn scan_full_tree_with_progress_emits_start_and_complete_updates() {
        let (_temp_dir, root) = build_full_scan_tree_fixture();
        let mut events = Vec::new();

        let response = scan_full_tree_with_progress(&root, &mut |progress| events.push(progress))
            .expect("full scan should succeed with progress");

        assert_eq!(625_000, response.summary.total_estimated_bytes);
        assert!(!events.is_empty());
        assert_eq!(FullScanProgressPhase::Starting, events[0].phase);
        assert_eq!(
            Some(FullScanProgressPhase::Complete),
            events.last().map(|event| event.phase.clone())
        );
        assert!(events
            .iter()
            .any(|event| event.phase == FullScanProgressPhase::Scanning));
    }

    #[test]
    fn full_scan_progress_tracker_batches_high_frequency_file_updates() {
        let mut tracker = FullScanProgressTracker::default();
        let mut events = Vec::new();
        let path = Path::new(r"C:\temp\cache.bin");

        for _ in 0..FULL_SCAN_PROGRESS_FILE_BATCH {
            tracker.record_file(path, &mut |progress| events.push(progress));
        }

        let scanning_events: Vec<_> = events
            .into_iter()
            .filter(|event| event.phase == FullScanProgressPhase::Scanning)
            .collect();

        assert_eq!(2, scanning_events.len());
        assert_eq!(1, scanning_events[0].files_scanned);
        assert_eq!(
            FULL_SCAN_PROGRESS_FILE_BATCH,
            scanning_events[1].files_scanned
        );
    }

    #[test]
    fn delete_selected_paths_removes_files_and_dedupes_nested_paths() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path().join("delete-root");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("nested dir should create");
        let file = nested.join("cache.bin");
        write_file(&file, 2048);

        let response = delete_selected_paths(
            &root,
            &[nested.display().to_string(), file.display().to_string()],
        )
        .expect("delete selected paths should succeed");

        assert_eq!(1, response.summary.selected_count);
        assert_eq!(1, response.summary.successful_paths);
        assert!(!nested.exists());
        assert!(!file.exists());
    }

    #[test]
    fn delete_selected_paths_rejects_targets_outside_root() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path().join("delete-root");
        fs::create_dir_all(&root).expect("root dir should create");
        let outsider = temp_dir.path().join("outside.bin");
        write_file(&outsider, 512);

        let error = delete_selected_paths(&root, &[outsider.display().to_string()])
            .expect_err("outside-root delete should be rejected");

        assert!(matches!(error, CoreError::InvalidDeletePath { .. }));
        assert!(outsider.exists());
    }

    #[test]
    fn delete_selected_paths_rejects_symlink_targets_inside_root() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path().join("delete-root");
        let safe_dir = root.join("safe");
        let outsider = temp_dir.path().join("outside.bin");
        fs::create_dir_all(&safe_dir).expect("safe dir should create");
        write_file(&outsider, 512);
        let linked_file = safe_dir.join("outside-link.bin");
        create_file_symlink(&outsider, &linked_file);

        let error = delete_selected_paths(&root, &[linked_file.display().to_string()])
            .expect_err("symlink target should be rejected");

        assert!(matches!(error, CoreError::InvalidDeletePath { .. }));
        assert!(outsider.exists());
        assert!(linked_file.exists());
    }

    #[test]
    fn delete_selected_paths_blocks_directories_with_nested_symlinks() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path().join("delete-root");
        let nested = root.join("nested");
        let outsider_dir = temp_dir.path().join("outside-dir");
        fs::create_dir_all(&nested).expect("nested dir should create");
        fs::create_dir_all(&outsider_dir).expect("outside dir should create");
        write_file(&nested.join("keep.bin"), 256);
        write_file(&outsider_dir.join("external.bin"), 128);
        let linked_dir = nested.join("outside-link");
        create_directory_symlink(&outsider_dir, &linked_dir);

        let preview = preview_selected_paths(&root, &[nested.display().to_string()])
            .expect("preview should succeed with warnings");
        assert_eq!(1, preview.summary.failed_paths);
        assert_eq!(1, preview.paths.len());
        assert!(!preview.paths[0].success);
        assert!(preview.paths[0]
            .warnings
            .iter()
            .any(|warning| warning.message.contains("symbolic links and junctions")));

        let delete = delete_selected_paths(&root, &[nested.display().to_string()])
            .expect("delete should report blocked directory");
        assert_eq!(1, delete.summary.failed_paths);
        assert!(nested.exists());
        assert!(linked_dir.exists());
        assert!(outsider_dir.exists());
    }

    #[test]
    fn execute_delete_plan_rechecks_targets_before_removal() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path().join("delete-root");
        let nested = root.join("nested");
        let file = nested.join("cache.bin");
        let outsider = temp_dir.path().join("outside.bin");
        fs::create_dir_all(&nested).expect("nested dir should create");
        write_file(&file, 256);
        write_file(&outsider, 128);

        let plan = build_delete_execution_plan(&root, &nested).expect("delete plan should build");

        fs::remove_file(&file).expect("original file should remove");
        create_file_symlink(&outsider, &file);

        let result = execute_delete_plan(&root, plan);

        assert_eq!(0, result.deleted_file_count);
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.message.contains("symbolic links and junctions")));
        assert!(nested.exists());
        assert!(file.exists());
        assert!(outsider.exists());
    }

    #[test]
    fn execute_delete_plan_rechecks_parent_chain_before_removal() {
        let temp_dir = TempDir::new().expect("temp dir should create");
        let root = temp_dir.path().join("delete-root");
        let parent = root.join("parent");
        let child = parent.join("child");
        let file = child.join("cache.bin");
        let outsider_dir = temp_dir.path().join("outside-dir");
        let outsider_file = outsider_dir.join("cache.bin");
        fs::create_dir_all(&child).expect("child dir should create");
        fs::create_dir_all(&outsider_dir).expect("outside dir should create");
        write_file(&file, 256);
        write_file(&outsider_file, 128);

        let plan = build_delete_execution_plan(&root, &parent).expect("delete plan should build");

        fs::remove_dir_all(&child).expect("original child dir should remove");
        create_directory_symlink(&outsider_dir, &child);

        let result = execute_delete_plan(&root, plan);

        assert_eq!(0, result.deleted_file_count);
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.message.contains("symbolic links and junctions")));
        assert!(parent.exists());
        assert!(child.exists());
        assert!(outsider_file.exists());
    }

    #[test]
    fn protected_path_access_denied_suppression_matches_localized_messages() {
        let path = Path::new(r"C:\PerfLogs");

        assert!(should_suppress_full_scan_warning(
            path,
            "Access is denied. (os error 5)"
        ));
        assert!(should_suppress_full_scan_warning(
            path,
            "拒绝访问。 (os error 5)"
        ));
        assert!(should_suppress_full_scan_warning(path, "访问被拒绝。"));
        assert!(should_suppress_full_scan_warning(path, "权限不足。"));
        assert!(should_suppress_full_scan_warning(
            Path::new(r"C:\Users\TEMP"),
            "拒绝访问。"
        ));
        assert!(!should_suppress_full_scan_warning(
            Path::new(r"C:\Projects\Private"),
            "Access is denied. (os error 5)"
        ));
    }
}
