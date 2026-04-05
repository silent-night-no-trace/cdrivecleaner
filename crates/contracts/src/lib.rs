use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum CleanupRiskTier {
    SafeDefault,
    SafeButAdmin,
    Advanced,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum WarningSeverity {
    Info,
    Attention,
    Critical,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum WarningCode {
    InaccessibleRoot,
    DirectoryReadFailed,
    DirectoryEntryReadFailed,
    EntryTypeReadFailed,
    FileInfoAccessDenied,
    FileInfoReadFailed,
    PathScanFailed,
    FileDeleteAccessDenied,
    FileDeleteFailed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupWarning {
    pub code: WarningCode,
    pub severity: WarningSeverity,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryMetadata {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub category_group: String,
    pub badge_label: String,
    pub safety_note: String,
    pub risk_tier: CleanupRiskTier,
    pub requires_admin: bool,
    pub included_in_safe_defaults: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupScanResult {
    pub category_id: String,
    pub display_name: String,
    pub estimated_bytes: u64,
    pub candidate_file_count: u32,
    pub requires_admin: bool,
    pub risk_tier: CleanupRiskTier,
    pub warnings: Vec<CleanupWarning>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupScanSummary {
    pub category_count: u32,
    pub total_estimated_bytes: u64,
    pub total_candidate_files: u32,
    pub total_warnings: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    pub summary: CleanupScanSummary,
    pub categories: Vec<CleanupScanResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "report", rename_all = "camelCase")]
pub enum ScanExportPayload {
    CategoryScan(ScanResponse),
    FullScan(FullScanTreeResponse),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtifact {
    pub file_path: String,
    pub file_name: String,
    pub format: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledScanMode {
    SafeDefaults,
    PreparedPreset,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledScanPlanDraft {
    pub mode: ScheduledScanMode,
    pub scheduled_time: String,
    pub enabled: bool,
    pub captured_category_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledScanPlan {
    pub id: String,
    pub mode: ScheduledScanMode,
    pub scheduled_time: String,
    pub enabled: bool,
    pub captured_category_ids: Vec<String>,
    pub requires_admin: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_category_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_estimated_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_warnings: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FullScanTreeNode {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
    pub size_bytes: u64,
    pub has_children: bool,
    pub children_loaded: bool,
    pub warnings: Vec<CleanupWarning>,
    pub children: Vec<FullScanTreeNode>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FullScanTreeResponse {
    pub root_path: String,
    pub summary: CleanupScanSummary,
    pub tree: FullScanTreeNode,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum FullScanProgressPhase {
    Starting,
    Scanning,
    Finalizing,
    Complete,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FullScanProgress {
    pub phase: FullScanProgressPhase,
    pub current_path: String,
    pub directories_scanned: u32,
    pub files_scanned: u32,
    pub warnings_count: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupExecutionResult {
    pub category_id: String,
    pub display_name: String,
    pub freed_bytes: u64,
    pub deleted_file_count: u32,
    pub success: bool,
    pub warnings: Vec<CleanupWarning>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupExecutionSummary {
    pub category_count: u32,
    pub successful_categories: u32,
    pub failed_categories: u32,
    pub total_freed_bytes: u64,
    pub total_deleted_files: u32,
    pub total_warnings: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanResponse {
    pub summary: CleanupExecutionSummary,
    pub categories: Vec<CleanupExecutionResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathCleanupResult {
    pub path: String,
    pub is_directory: bool,
    pub estimated_bytes: u64,
    pub deleted_file_count: u32,
    pub success: bool,
    pub warnings: Vec<CleanupWarning>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathCleanupSummary {
    pub selected_count: u32,
    pub successful_paths: u32,
    pub failed_paths: u32,
    pub total_estimated_bytes: u64,
    pub total_deleted_files: u32,
    pub total_warnings: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletePathsResponse {
    pub summary: PathCleanupSummary,
    pub paths: Vec<PathCleanupResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ElevationRequirement {
    pub is_process_elevated: bool,
    pub requires_elevation: bool,
    pub admin_category_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HistoryOrigin {
    Manual,
    Scheduled,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub timestamp: String,
    pub kind: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<HistoryOrigin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_estimated_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_candidate_files: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_warnings: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub successful_categories: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_categories: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_freed_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_deleted_files: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResponse {
    pub entries: Vec<HistoryEntry>,
}

fn fixture_path(base: &Path, name: &str) -> PathBuf {
    base.join(name)
}

fn load_fixture<T: DeserializeOwned>(base: &Path, name: &str) -> Result<T, String> {
    let path = fixture_path(base, name);
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

pub fn verify_contract_fixtures(base: &Path) -> Result<(), String> {
    let _: Vec<CategoryMetadata> = load_fixture(base, "categories.json")?;
    let _: ScanResponse = load_fixture(base, "scan-safe-default.json")?;
    let _: CleanResponse = load_fixture(base, "clean-safe-default.json")?;
    let _: ElevationRequirement = load_fixture(base, "elevation.json")?;
    let _: HistoryResponse = load_fixture(base, "history.json")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contracts_fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../contracts/fixtures")
    }

    fn round_trip<T>(value: &T) -> T
    where
        T: Serialize + DeserializeOwned,
    {
        let json = serde_json::to_string_pretty(value).expect("fixture should serialize");
        serde_json::from_str(&json).expect("fixture should deserialize after round-trip")
    }

    #[test]
    fn verifies_all_contract_fixtures() {
        verify_contract_fixtures(&contracts_fixture_dir())
            .expect("fixtures should deserialize into contract types");
    }

    #[test]
    fn category_fixture_round_trips() {
        let categories: Vec<CategoryMetadata> =
            load_fixture(&contracts_fixture_dir(), "categories.json")
                .expect("category fixture should load");
        assert_eq!(categories, round_trip(&categories));
        assert_eq!(13, categories.len());
    }

    #[test]
    fn scan_fixture_round_trips() {
        let scan: ScanResponse = load_fixture(&contracts_fixture_dir(), "scan-safe-default.json")
            .expect("scan fixture should load");
        assert_eq!(scan, round_trip(&scan));
        assert_eq!(3, scan.summary.category_count);
    }

    #[test]
    fn full_scan_tree_contract_round_trips() {
        let tree = FullScanTreeResponse {
            root_path: String::from("C:\\Fixture"),
            summary: CleanupScanSummary {
                category_count: 1,
                total_estimated_bytes: 1536,
                total_candidate_files: 2,
                total_warnings: 1,
            },
            tree: FullScanTreeNode {
                path: String::from("C:\\Fixture"),
                name: String::from("Fixture"),
                is_directory: true,
                size_bytes: 1536,
                has_children: true,
                children_loaded: true,
                warnings: vec![CleanupWarning {
                    code: WarningCode::FileInfoAccessDenied,
                    severity: WarningSeverity::Info,
                    message: String::from("Skipped file info for 'C:\\Fixture\\locked.bin': Access is denied."),
                }],
                children: vec![
                    FullScanTreeNode {
                        path: String::from("C:\\Fixture\\nested"),
                        name: String::from("nested"),
                        is_directory: true,
                        size_bytes: 1024,
                        has_children: true,
                        children_loaded: true,
                        warnings: Vec::new(),
                        children: vec![FullScanTreeNode {
                            path: String::from("C:\\Fixture\\nested\\a.bin"),
                            name: String::from("a.bin"),
                            is_directory: false,
                            size_bytes: 1024,
                            has_children: false,
                            children_loaded: true,
                            warnings: Vec::new(),
                            children: Vec::new(),
                        }],
                    },
                    FullScanTreeNode {
                        path: String::from("C:\\Fixture\\b.bin"),
                        name: String::from("b.bin"),
                        is_directory: false,
                        size_bytes: 512,
                        has_children: false,
                        children_loaded: true,
                        warnings: Vec::new(),
                        children: Vec::new(),
                    },
                ],
            },
        };

        assert_eq!(tree, round_trip(&tree));
        assert_eq!(1536, tree.tree.size_bytes);
    }

    #[test]
    fn scan_export_payload_round_trips() {
        let payload = ScanExportPayload::CategoryScan(ScanResponse {
            summary: CleanupScanSummary {
                category_count: 1,
                total_estimated_bytes: 1024,
                total_candidate_files: 2,
                total_warnings: 0,
            },
            categories: vec![CleanupScanResult {
                category_id: String::from("user-temp"),
                display_name: String::from("User Temp Files"),
                estimated_bytes: 1024,
                candidate_file_count: 2,
                requires_admin: false,
                risk_tier: CleanupRiskTier::SafeDefault,
                warnings: Vec::new(),
            }],
        });

        assert_eq!(payload, round_trip(&payload));
    }

    #[test]
    fn export_artifact_round_trips() {
        let artifact = ExportArtifact {
            file_path: String::from(r"C:\Exports\scan-report-20260330-120000.json"),
            file_name: String::from("scan-report-20260330-120000.json"),
            format: String::from("json"),
        };

        assert_eq!(artifact, round_trip(&artifact));
    }

    #[test]
    fn scheduled_scan_plan_round_trips() {
        let plan = ScheduledScanPlan {
            id: String::from("daily-safe-scan"),
            mode: ScheduledScanMode::SafeDefaults,
            scheduled_time: String::from("08:30"),
            enabled: true,
            captured_category_ids: Vec::new(),
            requires_admin: false,
            next_run_at: Some(String::from("2026-03-31T08:30:00Z")),
            last_run_at: Some(String::from("2026-03-30T08:30:00Z")),
            last_run_summary: Some(String::from("Scheduled scan complete.")),
            last_run_category_count: Some(3),
            last_run_estimated_bytes: Some(1024),
            last_run_warnings: Some(1),
        };

        assert_eq!(plan, round_trip(&plan));
    }

    #[test]
    fn scheduled_scan_plan_draft_round_trips() {
        let draft = ScheduledScanPlanDraft {
            mode: ScheduledScanMode::PreparedPreset,
            scheduled_time: String::from("21:15"),
            enabled: false,
            captured_category_ids: vec![String::from("user-temp"), String::from("shader-cache")],
        };

        assert_eq!(draft, round_trip(&draft));
    }

    #[test]
    fn history_origin_round_trips() {
        let entry = HistoryEntry {
            timestamp: String::from("2026-03-31T08:30:00Z"),
            kind: String::from("scan"),
            summary: String::from("Scheduled scan complete."),
            origin: Some(HistoryOrigin::Scheduled),
            origin_label: Some(String::from("Safe defaults")),
            category_count: Some(3),
            total_estimated_bytes: Some(1024),
            total_candidate_files: Some(2),
            total_warnings: Some(1),
            successful_categories: None,
            failed_categories: None,
            total_freed_bytes: None,
            total_deleted_files: None,
        };

        assert_eq!(entry, round_trip(&entry));
    }

    #[test]
    fn clean_fixture_round_trips() {
        let clean: CleanResponse =
            load_fixture(&contracts_fixture_dir(), "clean-safe-default.json")
                .expect("clean fixture should load");
        assert_eq!(clean, round_trip(&clean));
        assert_eq!(1, clean.summary.failed_categories);
    }

    #[test]
    fn full_scan_progress_round_trips() {
        let progress = FullScanProgress {
            phase: FullScanProgressPhase::Scanning,
            current_path: String::from(r"C:\Fixture\PerfLogs"),
            directories_scanned: 12,
            files_scanned: 180,
            warnings_count: 2,
        };

        assert_eq!(progress, round_trip(&progress));
    }

    #[test]
    fn delete_paths_round_trips() {
        let response = DeletePathsResponse {
            summary: PathCleanupSummary {
                selected_count: 2,
                successful_paths: 1,
                failed_paths: 1,
                total_estimated_bytes: 4096,
                total_deleted_files: 1,
                total_warnings: 1,
            },
            paths: vec![PathCleanupResult {
                path: String::from(r"C:\Fixture\cache.bin"),
                is_directory: false,
                estimated_bytes: 4096,
                deleted_file_count: 1,
                success: true,
                warnings: Vec::new(),
            }],
        };

        assert_eq!(response, round_trip(&response));
    }

    #[test]
    fn elevation_fixture_round_trips() {
        let elevation: ElevationRequirement =
            load_fixture(&contracts_fixture_dir(), "elevation.json")
                .expect("elevation fixture should load");
        assert_eq!(elevation, round_trip(&elevation));
        assert!(elevation.requires_elevation);
    }

    #[test]
    fn history_fixture_round_trips() {
        let history: HistoryResponse = load_fixture(&contracts_fixture_dir(), "history.json")
            .expect("history fixture should load");
        assert_eq!(history, round_trip(&history));
        assert_eq!(2, history.entries.len());
    }
}
