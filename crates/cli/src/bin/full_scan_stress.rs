use cdrivecleaner_contracts::{
    CleanupScanSummary, FullScanProgress, FullScanProgressPhase, FullScanTreeNode,
};
use clap::Parser;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Debug, Parser)]
#[command(name = "full-scan-stress")]
struct Cli {
    #[arg(long)]
    root: PathBuf,
    #[arg(long, default_value_t = 3)]
    expand_limit: usize,
    #[arg(long, default_value_t = 3)]
    repeat_expand: u32,
}

#[derive(Debug, Serialize)]
struct FullScanStressReport {
    root_path: String,
    scan: ScanMetrics,
    expand: Vec<ExpandMetrics>,
}

#[derive(Debug, Serialize)]
struct ScanMetrics {
    elapsed_ms: f64,
    progress_event_count: usize,
    scanning_event_count: usize,
    summary: CleanupScanSummary,
    final_progress: Option<FullScanProgress>,
}

#[derive(Debug, Serialize)]
struct ExpandMetrics {
    path: String,
    name: String,
    size_bytes: u64,
    first_elapsed_ms: f64,
    run_elapsed_ms: Vec<f64>,
    average_elapsed_ms: f64,
    min_elapsed_ms: f64,
    max_elapsed_ms: f64,
    children_loaded: bool,
    loaded_child_count: usize,
    warning_count: usize,
}

fn select_expand_targets(root: &FullScanTreeNode, limit: usize) -> Vec<&FullScanTreeNode> {
    let mut targets: Vec<&FullScanTreeNode> = root
        .children
        .iter()
        .filter(|child| child.is_directory && child.has_children)
        .collect();
    targets.sort_by(|left, right| {
        right
            .size_bytes
            .cmp(&left.size_bytes)
            .then_with(|| left.name.cmp(&right.name))
    });
    targets.truncate(limit);
    targets
}

fn summarize_runs(runs: &[f64]) -> (f64, f64, f64) {
    let total: f64 = runs.iter().sum();
    let average = if runs.is_empty() {
        0.0
    } else {
        total / runs.len() as f64
    };
    let min = runs.iter().copied().fold(f64::INFINITY, f64::min);
    let max = runs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    (
        average,
        if min.is_finite() { min } else { 0.0 },
        if max.is_finite() { max } else { 0.0 },
    )
}

fn measure_expand(
    root: &Path,
    node: &FullScanTreeNode,
    repeat_expand: u32,
) -> Result<ExpandMetrics, String> {
    let mut runs = Vec::with_capacity(repeat_expand as usize);
    let mut last_expansion = None;

    for _ in 0..repeat_expand {
        let started = Instant::now();
        let expanded = cdrivecleaner_core::expand_full_scan_node(root, Path::new(&node.path))
            .map_err(|error| error.to_string())?;
        runs.push(started.elapsed().as_secs_f64() * 1000.0);
        last_expansion = Some(expanded);
    }

    let expanded = last_expansion.expect("expand loop should run at least once");
    let (average_elapsed_ms, min_elapsed_ms, max_elapsed_ms) = summarize_runs(&runs);

    Ok(ExpandMetrics {
        path: expanded.path,
        name: expanded.name,
        size_bytes: expanded.size_bytes,
        first_elapsed_ms: runs.first().copied().unwrap_or_default(),
        run_elapsed_ms: runs,
        average_elapsed_ms,
        min_elapsed_ms,
        max_elapsed_ms,
        children_loaded: expanded.children_loaded,
        loaded_child_count: expanded.children.len(),
        warning_count: expanded.warnings.len(),
    })
}

fn main() {
    let cli = Cli::parse();
    if cli.repeat_expand == 0 {
        eprintln!("repeat_expand must be >= 1");
        std::process::exit(2);
    }

    let mut progress_events = Vec::new();
    let scan_started = Instant::now();
    let response = cdrivecleaner_core::scan_full_tree_with_progress(&cli.root, &mut |progress| {
        progress_events.push(progress);
    })
    .map_err(|error| error.to_string())
    .unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
    let scan_elapsed_ms = scan_started.elapsed().as_secs_f64() * 1000.0;

    let targets = select_expand_targets(&response.tree, cli.expand_limit);
    let expand = targets
        .into_iter()
        .map(|node| measure_expand(&cli.root, node, cli.repeat_expand))
        .collect::<Result<Vec<_>, _>>()
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    let report = FullScanStressReport {
        root_path: cli.root.display().to_string(),
        scan: ScanMetrics {
            elapsed_ms: scan_elapsed_ms,
            progress_event_count: progress_events.len(),
            scanning_event_count: progress_events
                .iter()
                .filter(|event| event.phase == FullScanProgressPhase::Scanning)
                .count(),
            summary: response.summary,
            final_progress: progress_events.last().cloned(),
        },
        expand,
    };

    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("stress report should serialize")
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory(path: &str, name: &str, size_bytes: u64, has_children: bool) -> FullScanTreeNode {
        FullScanTreeNode {
            path: path.into(),
            name: name.into(),
            is_directory: true,
            size_bytes,
            has_children,
            children_loaded: false,
            warnings: Vec::new(),
            children: Vec::new(),
        }
    }

    #[test]
    fn select_expand_targets_prefers_largest_directories() {
        let root = FullScanTreeNode {
            path: String::from(r"C:\"),
            name: String::from(r"C:\"),
            is_directory: true,
            size_bytes: 0,
            has_children: true,
            children_loaded: true,
            warnings: Vec::new(),
            children: vec![
                directory(r"C:\A", "A", 10, true),
                directory(r"C:\B", "B", 30, true),
                directory(r"C:\C", "C", 20, true),
            ],
        };

        let targets = select_expand_targets(&root, 2);
        assert_eq!(
            vec!["B", "C"],
            targets
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>()
        );
    }
}
