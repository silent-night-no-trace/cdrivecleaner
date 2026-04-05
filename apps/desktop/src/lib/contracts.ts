export type CleanupRiskTier = "SafeDefault" | "SafeButAdmin" | "Advanced";

export type WarningSeverity = "Info" | "Attention" | "Critical";

export type WarningCode =
  | "InaccessibleRoot"
  | "DirectoryReadFailed"
  | "DirectoryEntryReadFailed"
  | "EntryTypeReadFailed"
  | "FileInfoAccessDenied"
  | "FileInfoReadFailed"
  | "PathScanFailed"
  | "FileDeleteAccessDenied"
  | "FileDeleteFailed";

export interface CleanupWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
}

export interface CategoryMetadata {
  id: string;
  displayName: string;
  description: string;
  categoryGroup: string;
  badgeLabel: string;
  safetyNote: string;
  riskTier: CleanupRiskTier;
  requiresAdmin: boolean;
  includedInSafeDefaults: boolean;
}

export interface CleanupScanResult {
  categoryId: string;
  displayName: string;
  estimatedBytes: number;
  candidateFileCount: number;
  requiresAdmin: boolean;
  riskTier: CleanupRiskTier;
  warnings: CleanupWarning[];
}

export interface CleanupScanSummary {
  categoryCount: number;
  totalEstimatedBytes: number;
  totalCandidateFiles: number;
  totalWarnings: number;
}

export interface ScanResponse {
  summary: CleanupScanSummary;
  categories: CleanupScanResult[];
}

export type ScanExportPayload =
  | { kind: "categoryScan"; report: ScanResponse }
  | { kind: "fullScan"; report: FullScanTreeResponse };

export interface ExportArtifact {
  filePath: string;
  fileName: string;
  format: string;
}

export type ScheduledScanMode = "safeDefaults" | "preparedPreset";

export interface ScheduledScanPlanDraft {
  mode: ScheduledScanMode;
  scheduledTime: string;
  enabled: boolean;
  capturedCategoryIds: string[];
}

export interface ScheduledScanPlan {
  id: string;
  mode: ScheduledScanMode;
  scheduledTime: string;
  enabled: boolean;
  capturedCategoryIds: string[];
  requiresAdmin: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  lastRunCategoryCount: number | null;
  lastRunEstimatedBytes: number | null;
  lastRunWarnings: number | null;
}

export interface FullScanTreeNode {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  hasChildren: boolean;
  childrenLoaded: boolean;
  warnings: CleanupWarning[];
  children: FullScanTreeNode[];
}

export interface FullScanTreeResponse {
  rootPath: string;
  summary: CleanupScanSummary;
  tree: FullScanTreeNode;
}

export type FullScanProgressPhase = "Starting" | "Scanning" | "Finalizing" | "Complete";

export interface FullScanProgress {
  phase: FullScanProgressPhase;
  currentPath: string;
  directoriesScanned: number;
  filesScanned: number;
  warningsCount: number;
}

export interface CleanupExecutionResult {
  categoryId: string;
  displayName: string;
  freedBytes: number;
  deletedFileCount: number;
  success: boolean;
  warnings: CleanupWarning[];
}

export interface CleanupExecutionSummary {
  categoryCount: number;
  successfulCategories: number;
  failedCategories: number;
  totalFreedBytes: number;
  totalDeletedFiles: number;
  totalWarnings: number;
}

export interface CleanResponse {
  summary: CleanupExecutionSummary;
  categories: CleanupExecutionResult[];
}

export interface PathCleanupResult {
  path: string;
  isDirectory: boolean;
  estimatedBytes: number;
  deletedFileCount: number;
  success: boolean;
  warnings: CleanupWarning[];
}

export interface PathCleanupSummary {
  selectedCount: number;
  successfulPaths: number;
  failedPaths: number;
  totalEstimatedBytes: number;
  totalDeletedFiles: number;
  totalWarnings: number;
}

export interface DeletePathsResponse {
  summary: PathCleanupSummary;
  paths: PathCleanupResult[];
}

export interface ElevationRequirement {
  isProcessElevated: boolean;
  requiresElevation: boolean;
  adminCategoryIds: string[];
}

export type HistoryOrigin = "manual" | "scheduled";

export interface HistoryEntry {
  timestamp: string;
  kind: "scan" | "clean";
  summary: string;
  origin?: HistoryOrigin;
  originLabel?: string;
  categoryCount?: number;
  totalEstimatedBytes?: number;
  totalCandidateFiles?: number;
  totalWarnings?: number;
  successfulCategories?: number;
  failedCategories?: number;
  totalFreedBytes?: number;
  totalDeletedFiles?: number;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
}

export interface SettingsMetadata {
  appVersion: string;
  logDirectory: string;
}
