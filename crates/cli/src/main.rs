use clap::{Parser, Subcommand};
use cdrivecleaner_contracts::{
    CleanResponse, CleanupWarning, FullScanTreeNode, FullScanTreeResponse, ScanResponse,
    WarningSeverity,
};
use std::path::PathBuf;

#[derive(Debug)]
enum CliError {
    InvalidUsage(String),
    Core(String),
    Serialize(String),
}

impl CliError {
    fn exit_code(&self) -> i32 {
        match self {
            CliError::InvalidUsage(_) => 2,
            CliError::Core(_) | CliError::Serialize(_) => 1,
        }
    }

    fn message(&self) -> &str {
        match self {
            CliError::InvalidUsage(message) => message,
            CliError::Core(message) => message,
            CliError::Serialize(message) => message,
        }
    }
}

#[derive(Debug, Parser)]
#[command(name = "cdrivecleaner")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    List,
    Scan {
        #[arg(long)]
        all_safe: bool,
        #[arg(long)]
        json: bool,
    },
    FullScan {
        #[arg(long)]
        json: bool,
        #[arg(long)]
        root: Option<PathBuf>,
    },
    Clean {
        #[arg(long)]
        all_safe: bool,
        #[arg(long)]
        json: bool,
    },
}

fn main() {
    let cli = Cli::parse();

    match execute(cli.command) {
        Ok(output) => {
            println!("{output}");
        }
        Err(error) => {
            eprintln!("{}", error.message());
            std::process::exit(error.exit_code());
        }
    }
}

fn execute(command: Command) -> Result<String, CliError> {
    match command {
        Command::List => render_json(&cdrivecleaner_core::list_categories()),
        Command::Scan { all_safe, json } => execute_scan(all_safe, json),
        Command::FullScan { json, root } => execute_full_scan(json, root),
        Command::Clean { all_safe, json } => execute_clean(all_safe, json),
    }
}

fn execute_scan(all_safe: bool, json: bool) -> Result<String, CliError> {
    if !all_safe {
        return Err(CliError::InvalidUsage(
            String::from("scan MVP currently requires --all-safe"),
        ));
    }

    let response = cdrivecleaner_core::scan_safe_defaults_for_current_machine()
        .map_err(|error| CliError::Core(error.to_string()))?;

    if json {
        return render_json(&response);
    }

    Ok(render_scan_text(&response))
}

fn execute_clean(all_safe: bool, json: bool) -> Result<String, CliError> {
    if !all_safe {
        return Err(CliError::InvalidUsage(
            String::from("clean MVP currently requires --all-safe"),
        ));
    }

    let response = cdrivecleaner_core::clean_safe_defaults_for_current_machine()
        .map_err(|error| CliError::Core(error.to_string()))?;

    if json {
        return render_json(&response);
    }

    Ok(render_clean_text(&response))
}

fn execute_full_scan(json: bool, root: Option<PathBuf>) -> Result<String, CliError> {
    let response = match root {
        Some(path) => cdrivecleaner_core::scan_full_tree(&path),
        None => cdrivecleaner_core::scan_full_tree_for_current_machine(),
    }
    .map_err(|error| CliError::Core(error.to_string()))?;

    if json {
        return render_json(&response);
    }

    Ok(render_full_scan_text(&response))
}

fn render_json<T: serde::Serialize>(value: &T) -> Result<String, CliError> {
    serde_json::to_string_pretty(value).map_err(|error| CliError::Serialize(error.to_string()))
}

fn render_scan_text(response: &ScanResponse) -> String {
    let mut lines = vec![format!(
        "Scanned {} safe-default categories. Estimated reclaim: {} bytes. Warnings: {}.",
        response.summary.category_count, response.summary.total_estimated_bytes, response.summary.total_warnings
    )];

    for category in &response.categories {
        lines.push(format!(
            "- {} ({}) => {} bytes, {} files, warnings={}.",
            category.display_name,
            category.category_id,
            category.estimated_bytes,
            category.candidate_file_count,
            category.warnings.len()
        ));
    }

    lines.join("\n")
}

fn render_full_scan_text(response: &FullScanTreeResponse) -> String {
    let mut lines = vec![format!(
        "Full scan at {} => {} bytes across {} files with {} warnings.",
        response.root_path,
        response.summary.total_estimated_bytes,
        response.summary.total_candidate_files,
        response.summary.total_warnings,
    )];
    render_full_scan_node(&response.tree, 0, &mut lines);
    lines.join("\n")
}

fn render_full_scan_node(node: &FullScanTreeNode, depth: usize, lines: &mut Vec<String>) {
    let indent = "  ".repeat(depth);
    let kind = if node.is_directory { "dir" } else { "file" };
    lines.push(format!("{}{} [{}] {} bytes", indent, node.name, kind, node.size_bytes));
    for warning in &node.warnings {
        lines.push(format!(
            "{}  ! [{}] {}",
            indent,
            warning_severity_label(&warning.severity),
            warning.message
        ));
    }
    for child in &node.children {
        render_full_scan_node(child, depth + 1, lines);
    }
}

fn warning_severity_label(severity: &WarningSeverity) -> &'static str {
    match severity {
        WarningSeverity::Info => "info",
        WarningSeverity::Attention => "attention",
        WarningSeverity::Critical => "critical",
    }
}

fn render_clean_text(response: &CleanResponse) -> String {
    let mut lines = vec![format!(
        "Cleaned {} safe-default categories. Freed {} bytes. Success={}, Failed={}, Warnings={}",
        response.summary.category_count,
        response.summary.total_freed_bytes,
        response.summary.successful_categories,
        response.summary.failed_categories,
        response.summary.total_warnings,
    )];

    for category in &response.categories {
        lines.push(format!(
            "- {} ({}) => {} bytes freed, {} files deleted, success={}, warnings={}",
            category.display_name,
            category.category_id,
            category.freed_bytes,
            category.deleted_file_count,
            category.success,
            category.warnings.len()
        ));
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use cdrivecleaner_contracts::CategoryMetadata;

    fn sample_categories() -> Vec<CategoryMetadata> {
        vec![CategoryMetadata {
            id: String::from("user-temp"),
            display_name: String::from("User Temp Files"),
            description: String::from("Cleans the current user's temporary folder."),
            category_group: String::from("System"),
            badge_label: String::from("Recommended"),
            safety_note: String::from("Low risk."),
            risk_tier: cdrivecleaner_contracts::CleanupRiskTier::SafeDefault,
            requires_admin: false,
            included_in_safe_defaults: true,
        }]
    }

    fn sample_scan_response() -> ScanResponse {
        ScanResponse {
            summary: cdrivecleaner_contracts::CleanupScanSummary {
                category_count: 1,
                total_estimated_bytes: 1024,
                total_candidate_files: 4,
                total_warnings: 0,
            },
            categories: vec![cdrivecleaner_contracts::CleanupScanResult {
                category_id: String::from("user-temp"),
                display_name: String::from("User Temp Files"),
                estimated_bytes: 1024,
                candidate_file_count: 4,
                requires_admin: false,
                risk_tier: cdrivecleaner_contracts::CleanupRiskTier::SafeDefault,
                warnings: Vec::new(),
            }],
        }
    }

    fn sample_clean_response() -> CleanResponse {
        CleanResponse {
            summary: cdrivecleaner_contracts::CleanupExecutionSummary {
                category_count: 1,
                successful_categories: 1,
                failed_categories: 0,
                total_freed_bytes: 1024,
                total_deleted_files: 4,
                total_warnings: 0,
            },
            categories: vec![cdrivecleaner_contracts::CleanupExecutionResult {
                category_id: String::from("user-temp"),
                display_name: String::from("User Temp Files"),
                freed_bytes: 1024,
                deleted_file_count: 4,
                success: true,
                warnings: Vec::new(),
            }],
        }
    }

    fn sample_full_scan_response() -> FullScanTreeResponse {
        FullScanTreeResponse {
            root_path: String::from("C:\\Fixture"),
            summary: cdrivecleaner_contracts::CleanupScanSummary {
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
                    code: cdrivecleaner_contracts::WarningCode::FileInfoAccessDenied,
                    severity: WarningSeverity::Info,
                    message: String::from("Skipped file info for 'C:\\Fixture\\locked.bin': Access is denied."),
                }],
                children: vec![FullScanTreeNode {
                    path: String::from("C:\\Fixture\\a.bin"),
                    name: String::from("a.bin"),
                    is_directory: false,
                    size_bytes: 1536,
                    has_children: false,
                    children_loaded: true,
                    warnings: Vec::new(),
                    children: Vec::new(),
                }],
            },
        }
    }

    #[test]
    fn render_json_serializes_list_output() {
        let json = render_json(&sample_categories()).expect("list output should serialize");
        let parsed: Vec<CategoryMetadata> = serde_json::from_str(&json).expect("serialized list should parse");
        assert_eq!(1, parsed.len());
    }

    #[test]
    fn render_scan_text_includes_summary_and_category_lines() {
        let output = render_scan_text(&sample_scan_response());
        assert!(output.contains("Scanned 1 safe-default categories"));
        assert!(output.contains("User Temp Files (user-temp)"));
    }

    #[test]
    fn scan_requires_all_safe_flag_in_mvp() {
        let error = execute_scan(false, true).expect_err("scan without --all-safe should fail");
        assert_eq!(2, error.exit_code());
        assert!(error.message().contains("requires --all-safe"));
    }

    #[test]
    fn render_clean_text_includes_summary_and_category_lines() {
        let output = render_clean_text(&sample_clean_response());
        assert!(output.contains("Freed 1024 bytes"));
        assert!(output.contains("User Temp Files (user-temp)"));
    }

    #[test]
    fn clean_requires_all_safe_flag_in_mvp() {
        let error = execute_clean(false, true).expect_err("clean without --all-safe should fail");
        assert_eq!(2, error.exit_code());
        assert!(error.message().contains("requires --all-safe"));
    }

    #[test]
    fn render_full_scan_text_includes_root_and_warning_lines() {
        let output = render_full_scan_text(&sample_full_scan_response());
        assert!(output.contains("Full scan at C:\\Fixture"));
        assert!(output.contains("Fixture [dir] 1536 bytes"));
        assert!(output.contains("locked.bin"));
    }
}
