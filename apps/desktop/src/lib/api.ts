import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CategoryMetadata, CleanResponse, DeletePathsResponse, ElevationRequirement, ExportArtifact, FullScanProgress, FullScanTreeNode, FullScanTreeResponse, HistoryResponse, ScanExportPayload, ScanResponse, ScheduledScanPlan, ScheduledScanPlanDraft, SettingsMetadata } from "./contracts";

export function listCategories(): Promise<CategoryMetadata[]> {
  return invoke<CategoryMetadata[]>("list_categories");
}

export function getHistory(): Promise<HistoryResponse> {
  return invoke<HistoryResponse>("get_history");
}

export function getSettingsMetadata(): Promise<SettingsMetadata> {
  return invoke<SettingsMetadata>("get_settings_metadata");
}

export function getScheduledScanPlan(): Promise<ScheduledScanPlan | null> {
  return invoke<ScheduledScanPlan | null>("get_scheduled_scan_plan");
}

export function saveScheduledScanPlan(draft: ScheduledScanPlanDraft): Promise<ScheduledScanPlan> {
  return invoke<ScheduledScanPlan>("save_scheduled_scan_plan", { draft });
}

export function setScheduledScanPlanEnabled(enabled: boolean): Promise<ScheduledScanPlan> {
  return invoke<ScheduledScanPlan>("set_scheduled_scan_plan_enabled", { enabled });
}

export function deleteScheduledScanPlan(): Promise<void> {
  return invoke<void>("delete_scheduled_scan_plan");
}

export function exportScanReport(payload: ScanExportPayload): Promise<ExportArtifact> {
  return invoke<ExportArtifact>("export_scan_report", { payload });
}

export function exportHistory(history: HistoryResponse): Promise<ExportArtifact> {
  return invoke<ExportArtifact>("export_history", { history });
}

export function analyzeElevation(categoryIds: string[]): Promise<ElevationRequirement> {
  return invoke<ElevationRequirement>("analyze_elevation", { categoryIds });
}

export function restartAsAdministrator(): Promise<void> {
  return invoke<void>("restart_as_administrator");
}

export function scanSafeDefaults(): Promise<ScanResponse> {
  return invoke<ScanResponse>("scan_safe_defaults");
}

export function scanCategories(categoryIds: string[]): Promise<ScanResponse> {
  return invoke<ScanResponse>("scan_categories", { categoryIds });
}

export function cleanSafeDefaults(): Promise<CleanResponse> {
  return invoke<CleanResponse>("clean_safe_defaults");
}

export function cleanCategories(categoryIds: string[]): Promise<CleanResponse> {
  return invoke<CleanResponse>("clean_categories", { categoryIds });
}

export function previewSelectedPaths(rootPath: string, paths: string[]): Promise<DeletePathsResponse> {
  return invoke<DeletePathsResponse>("preview_selected_paths", { rootPath, paths });
}

export function deleteSelectedPaths(rootPath: string, paths: string[]): Promise<DeletePathsResponse> {
  return invoke<DeletePathsResponse>("delete_selected_paths", { rootPath, paths });
}

export function scanFullTree(rootPath?: string): Promise<FullScanTreeResponse> {
  return invoke<FullScanTreeResponse>("scan_full_tree", rootPath ? { rootPath } : undefined);
}

export function expandFullScanNode(rootPath: string, nodePath: string): Promise<FullScanTreeNode> {
  return invoke<FullScanTreeNode>("expand_full_scan_node", { rootPath, nodePath });
}

export function listenFullScanProgress(handler: (progress: FullScanProgress) => void): Promise<() => void> {
  return listen<FullScanProgress>("full-scan-progress", (event) => handler(event.payload));
}
