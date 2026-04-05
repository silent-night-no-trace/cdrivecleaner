import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AuthorizationCallout } from "../components/AuthorizationCallout";
import { FileTreeView } from "../components/FileTreeView";
import { TreemapView } from "../components/TreemapView";
import { WarningGroups } from "../components/WarningGroups";
import { WarningSummary } from "../components/WarningSummary";
import type {
  CategoryMetadata,
  CleanResponse,
  CleanupScanResult,
  DeletePathsResponse,
  ExportArtifact,
  FullScanProgress,
  FullScanTreeNode,
  FullScanTreeResponse,
  ScanResponse,
} from "../lib/contracts";
import { formatBytes } from "../lib/formatBytes";
import { filterLoadedTreeWithCount } from "../lib/filterTree";
import { buildFullScanTreeIndex, buildNodeTrail, estimateDeleteSelection, getLoadedTreePreview, getTreemapBlocks, getTreeSummary, type FullScanTreeIndex, type TreeSummary } from "../lib/fullScanTree";
import type { Locale } from "../lib/i18n";
import type { ListResultsSort } from "../state/appState";
import {
  formatConfirmSummary,
  formatDeleteSelectionSummary,
  formatPreparedConfirmSummary,
  formatRiskTier,
  formatScanHero,
  formatScanMeta,
  t,
  translateCategoryFromMetadata,
  translateCategoryFromScan,
} from "../lib/i18n";

const EMPTY_TREE_SUMMARY: TreeSummary = {
  loadedDescendants: 0,
  loadedFiles: 0,
  loadedDirectories: 0,
  loadedWarnings: 0,
  largestChildren: [],
  totalNodes: 1,
};

const SEARCH_INPUT_DEBOUNCE_MS = 150;

interface ResultsPageProps {
  locale: Locale;
  isProcessElevated: boolean;
  mode: "safe" | "prepared" | "full";
  categories: CategoryMetadata[];
  preparedCategoryIds: string[];
  scanResponse: ScanResponse | null;
  fullScanResponse: FullScanTreeResponse | null;
  fullScanIndex?: FullScanTreeIndex | null;
  fullScanProgress: FullScanProgress | null;
  fullScanStatus: "idle" | "loading" | "ready" | "error";
  fullScanError: string | null;
  cleanResponse: CleanResponse | null;
  latestDeletePathsResult: DeletePathsResponse | null;
  deletePreviewResult: DeletePathsResponse | null;
  selectedCategoryId: string | null;
  selectedFullScanNodePath: string | null;
  selectedDeletePaths: string[];
  deleteConfirmationVisible: boolean;
  deleteStatus: "idle" | "loading" | "ready" | "error";
  deleteError: string | null;
  onToggleDeletePath: (path: string) => void;
  onRequestDeleteSelection: () => void;
  onConfirmDeleteSelection: () => void;
  onCancelDeleteSelection: () => void;
  onRestartAsAdministrator: () => void;
  onSelectCategory: (categoryId: string) => void;
  onSelectFullScanNode: (nodePath: string) => void;
  onRequestCleanConfirmation: () => void;
  onConfirmClean: () => void;
  onCancelClean: () => void;
  onSwitchToListResults: () => void;
  onSwitchToFullResults: () => void;
  onRunFullScan: () => void;
  onExpandFullScanNode: (nodePath: string) => Promise<void>;
  fullScanQuery: string;
  onFullScanQueryChange: (query: string) => void;
  cleanConfirmationVisible: boolean;
  cleanStatus: "idle" | "loading" | "ready" | "error";
  cleanError: string | null;
  actionsDisabled: boolean;
  authorizationStatus: "idle" | "loading" | "error";
  listResultsSort: ListResultsSort;
  onListResultsSortChange: (sort: ListResultsSort) => void;
  onExportScan: () => void;
  scanExportStatus: "idle" | "loading" | "ready" | "error";
  scanExportArtifact: ExportArtifact | null;
  scanExportError: string | null;
}

interface ModeSwitcherProps {
  locale: Locale;
  mode: "safe" | "prepared" | "full";
  onSwitchToListResults: () => void;
  onSwitchToFullResults: () => void;
  disabled: boolean;
}

function findSelectedCategory(scanResponse: ScanResponse, selectedCategoryId: string | null): CleanupScanResult {
  return scanResponse.categories.find((category) => category.categoryId === selectedCategoryId) ?? scanResponse.categories[0]!;
}

function nodeShare(node: FullScanTreeNode, totalBytes: number): string {
  if (totalBytes === 0) {
    return "0%";
  }
  return `${Math.round((node.sizeBytes / totalBytes) * 100)}%`;
}

function nodeLabel(node: FullScanTreeNode): string {
  if (node.path === node.name) {
    return node.name;
  }
  return node.isDirectory ? `${node.name}/` : node.name;
}

const warningSeverityRank = {
  Critical: 3,
  Attention: 2,
  Info: 1,
} as const;

const riskTierRank = {
  Advanced: 3,
  SafeButAdmin: 2,
  SafeDefault: 1,
} as const;

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

function highestWarningSeverity(category: CleanupScanResult): number {
  return category.warnings.reduce((highest, warning) => Math.max(highest, warningSeverityRank[warning.severity]), 0);
}

function compareCategories(left: CleanupScanResult, right: CleanupScanResult, sort: ListResultsSort): number {
  if (sort === "files") {
    return right.candidateFileCount - left.candidateFileCount
      || right.estimatedBytes - left.estimatedBytes
      || right.warnings.length - left.warnings.length
      || compareText(left.displayName, right.displayName);
  }

  if (sort === "risk") {
    return highestWarningSeverity(right) - highestWarningSeverity(left)
      || right.warnings.length - left.warnings.length
      || riskTierRank[right.riskTier] - riskTierRank[left.riskTier]
      || right.estimatedBytes - left.estimatedBytes
      || compareText(left.displayName, right.displayName);
  }

  return right.estimatedBytes - left.estimatedBytes
    || right.candidateFileCount - left.candidateFileCount
    || right.warnings.length - left.warnings.length
    || compareText(left.displayName, right.displayName);
}

function ModeSwitcher({ locale, mode, onSwitchToListResults, onSwitchToFullResults, disabled }: ModeSwitcherProps): JSX.Element {
  const listModeActive = mode !== "full";
  return (
    <div className="result-mode-switch" role="tablist" aria-label={t(locale, "resultWorkspaceTitle")}>
      <button
        className={listModeActive ? "result-mode-button result-mode-button-active" : "result-mode-button"}
        disabled={disabled}
        onClick={onSwitchToListResults}
        role="tab"
        aria-selected={listModeActive}
        type="button"
      >
        {t(locale, "resultModeList")}
      </button>
      <button
        className={!listModeActive ? "result-mode-button result-mode-button-active" : "result-mode-button"}
        disabled={disabled}
        onClick={onSwitchToFullResults}
        role="tab"
        aria-selected={!listModeActive}
        type="button"
      >
        {t(locale, "resultModeFull")}
      </button>
    </div>
  );
}

export function ResultsPage({ locale, isProcessElevated, mode, categories, preparedCategoryIds, scanResponse, fullScanResponse, fullScanIndex, fullScanProgress, fullScanStatus, fullScanError, cleanResponse, latestDeletePathsResult, deletePreviewResult, selectedCategoryId, selectedFullScanNodePath, selectedDeletePaths, deleteConfirmationVisible, deleteStatus, deleteError, onToggleDeletePath, onRequestDeleteSelection, onConfirmDeleteSelection, onCancelDeleteSelection, onRestartAsAdministrator, onSelectCategory, onSelectFullScanNode, onRequestCleanConfirmation, onConfirmClean, onCancelClean, onSwitchToListResults, onSwitchToFullResults, onRunFullScan, onExpandFullScanNode, listResultsSort, onListResultsSortChange, onExportScan, scanExportStatus, scanExportArtifact, scanExportError, fullScanQuery, onFullScanQueryChange, cleanConfirmationVisible, cleanStatus, cleanError, actionsDisabled, authorizationStatus }: ResultsPageProps): JSX.Element {
  const scanExportActionLabel = mode === "full" ? t(locale, "exportFullScanAction") : t(locale, "exportScanAction");
  const scanExportHint = mode === "full" ? t(locale, "exportFullScanHint") : t(locale, "exportScanHint");
  const [loadingSelectedNodePath, setLoadingSelectedNodePath] = useState<string | null>(null);
  const [searchInputValue, setSearchInputValue] = useState(fullScanQuery);
  useEffect(() => {
    setSearchInputValue(fullScanQuery);
  }, [fullScanQuery]);
  useEffect(() => {
    if (searchInputValue === fullScanQuery) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      onFullScanQueryChange(searchInputValue);
    }, SEARCH_INPUT_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [fullScanQuery, onFullScanQueryChange, searchInputValue]);
  const deferredFullScanQuery = useDeferredValue(fullScanQuery);
  const fullScanTree = fullScanResponse?.tree ?? null;
  const effectiveFullScanIndex = useMemo(
    () => (fullScanIndex ?? (fullScanTree ? buildFullScanTreeIndex(fullScanTree) : null)),
    [fullScanIndex, fullScanTree],
  );
  const filteredTreeResult = useMemo(() => {
    if (!fullScanTree) {
      return { tree: null, visibleNodeCount: 0 };
    }
    if (!deferredFullScanQuery.trim()) {
      return {
        tree: fullScanTree,
        visibleNodeCount: effectiveFullScanIndex?.totalNodeCount ?? 0,
      };
    }
    return filterLoadedTreeWithCount(fullScanTree, deferredFullScanQuery, effectiveFullScanIndex?.searchTextByPath);
  }, [deferredFullScanQuery, effectiveFullScanIndex, fullScanTree]);
  const filteredTree = filteredTreeResult.tree;
  const selectedNode = useMemo(() => {
    if (!fullScanTree || !effectiveFullScanIndex) {
      return null;
    }
    return effectiveFullScanIndex.nodeByPath.get(selectedFullScanNodePath ?? "") ?? fullScanTree;
  }, [effectiveFullScanIndex, fullScanTree, selectedFullScanNodePath]);
  const selectedTrail = useMemo(() => {
    if (!effectiveFullScanIndex || !selectedNode) {
      return [];
    }
    return buildNodeTrail(effectiveFullScanIndex, selectedNode.path);
  }, [effectiveFullScanIndex, selectedNode]);
  const selectedTrailPathSet = useMemo(() => new Set(selectedTrail.map((node) => node.path)), [selectedTrail]);
  const selectedDeletePathSet = useMemo(() => new Set(selectedDeletePaths), [selectedDeletePaths]);
  const selectedSummary = useMemo<TreeSummary | null>(
    () => (effectiveFullScanIndex && selectedNode ? getTreeSummary(effectiveFullScanIndex, selectedNode.path) : null),
    [effectiveFullScanIndex, selectedNode],
  );
  const deleteEstimate = useMemo(
    () => (fullScanTree && effectiveFullScanIndex ? estimateDeleteSelection(fullScanTree, selectedDeletePathSet, effectiveFullScanIndex.summaryByPath) : { bytes: 0, files: 0 }),
    [effectiveFullScanIndex, fullScanTree, selectedDeletePathSet],
  );
  const loadedPreview = useMemo(
    () => (selectedNode ? getLoadedTreePreview(selectedNode, 6) : { topFiles: [], topPaths: [] }),
    [selectedNode],
  );
  const treemapBlocks = useMemo(
    () => (selectedNode ? getTreemapBlocks(selectedNode) : []),
    [selectedNode],
  );
  const loadedTreeWarnings = effectiveFullScanIndex?.allWarnings ?? [];
  const visibleNodeCount = filteredTreeResult.visibleNodeCount;
  const sortedCategories = useMemo(
    () => (scanResponse ? [...scanResponse.categories].sort((left, right) => compareCategories(left, right, listResultsSort)) : []),
    [listResultsSort, scanResponse],
  );

  if (mode === "full") {
    if (!fullScanResponse) {
      return (
        <section className="page-shell">
          <div className="hero-card">
            <p className="eyebrow">{t(locale, "latestFullScan")}</p>
            <h1>{fullScanStatus === "loading" ? t(locale, "fullScanProgressTitle") : t(locale, "fullScanEmpty")}</h1>
            <ModeSwitcher locale={locale} mode={mode} onSwitchToListResults={onSwitchToListResults} onSwitchToFullResults={onSwitchToFullResults} disabled={actionsDisabled} />
            {fullScanProgress ? (
              <>
                <div className="progress-heading">
                  <h2>{t(locale, "fullScanProgressTitle")}</h2>
                  <span className="progress-badge">
                    <span className="progress-badge-dot" aria-hidden="true" />
                    {t(locale, "fullScanning")}
                  </span>
                </div>
                <div className="progress-shell" aria-label={t(locale, "fullScanProgressTitle")}>
                  <div className="progress-bar progress-bar-indeterminate" />
                </div>
                <div className="tree-summary-grid">
                  <div className="summary-card">
                    <span>{t(locale, "directoriesScannedLabel")}</span>
                    <strong>{fullScanProgress.directoriesScanned}</strong>
                  </div>
                  <div className="summary-card">
                    <span>{t(locale, "filesScannedLabel")}</span>
                    <strong>{fullScanProgress.filesScanned}</strong>
                  </div>
                  <div className="summary-card">
                    <span>{t(locale, "warningsCount")}</span>
                    <strong>{fullScanProgress.warningsCount}</strong>
                  </div>
                </div>
                <p className="body-copy progress-current-path"><strong>{t(locale, "currentPathLabel")}:</strong> {fullScanProgress.currentPath}</p>
                <p className="category-hint progress-footnote">{t(locale, "suppressedWarningsHint")}</p>
                <AuthorizationCallout actionsDisabled={actionsDisabled} authorizationStatus={authorizationStatus} compact isProcessElevated={isProcessElevated} locale={locale} onRestartAsAdministrator={onRestartAsAdministrator} />
              </>
            ) : fullScanStatus === "loading" ? (
              <>
                <div className="progress-heading">
                  <h2>{t(locale, "fullScanProgressTitle")}</h2>
                  <span className="progress-badge">
                    <span className="progress-badge-dot" aria-hidden="true" />
                    {t(locale, "fullScanning")}
                  </span>
                </div>
                <div className="progress-shell" aria-label={t(locale, "fullScanProgressTitle")}>
                  <div className="progress-bar progress-bar-indeterminate" />
                </div>
                <p className="category-hint progress-footnote">{t(locale, "suppressedWarningsHint")}</p>
                <AuthorizationCallout actionsDisabled={actionsDisabled} authorizationStatus={authorizationStatus} compact isProcessElevated={isProcessElevated} locale={locale} onRestartAsAdministrator={onRestartAsAdministrator} />
              </>
            ) : (
              <>
                <p>{t(locale, "fullScanEmpty")}</p>
                <button className="primary-button" disabled={actionsDisabled} onClick={onRunFullScan} type="button">
                  {t(locale, "fullScan")}
                </button>
                <AuthorizationCallout actionsDisabled={actionsDisabled} authorizationStatus={authorizationStatus} compact isProcessElevated={isProcessElevated} locale={locale} onRestartAsAdministrator={onRestartAsAdministrator} />
              </>
            )}
          </div>
          {fullScanError ? <p className="error-copy">{fullScanError}</p> : null}
          {deleteError ? <p className="error-copy">{deleteError}</p> : null}
        </section>
      );
    }

    const effectiveSelectedNode = selectedNode ?? fullScanResponse.tree;
    const effectiveSelectedTrail = selectedTrail.length > 0 ? selectedTrail : [effectiveSelectedNode];
    const effectiveSelectedTrailPathSet = selectedTrail.length > 0 ? selectedTrailPathSet : new Set([effectiveSelectedNode.path]);
    const summary = selectedSummary ?? EMPTY_TREE_SUMMARY;
    const isSelectedForDelete = selectedDeletePathSet.has(effectiveSelectedNode.path);
    const canLoadSelectedNodeChildren = effectiveSelectedNode.isDirectory && effectiveSelectedNode.hasChildren && !effectiveSelectedNode.childrenLoaded;
    const isLoadingSelectedNodeChildren = loadingSelectedNodePath === effectiveSelectedNode.path;

    const handleLoadSelectedNodeChildren = async () => {
      if (!canLoadSelectedNodeChildren || actionsDisabled) {
        return;
      }

      setLoadingSelectedNodePath(effectiveSelectedNode.path);
      try {
        await onExpandFullScanNode(effectiveSelectedNode.path);
      } catch {
        // App-level error state already captures the failure message.
      } finally {
        setLoadingSelectedNodePath((current) => (current === effectiveSelectedNode.path ? null : current));
      }
    };

    return (
      <section className="page-shell">
        <div className="hero-card">
          <p className="eyebrow">{t(locale, "latestFullScan")}</p>
          <h1>{formatBytes(fullScanResponse.summary.totalEstimatedBytes, locale)} {t(locale, "reclaimable")}</h1>
          <ModeSwitcher locale={locale} mode={mode} onSwitchToListResults={onSwitchToListResults} onSwitchToFullResults={onSwitchToFullResults} disabled={actionsDisabled} />
          <p className="body-copy">
            {t(locale, "rootPath")}: {fullScanResponse.rootPath} · {fullScanResponse.summary.totalCandidateFiles} {t(locale, "filesCount")} · {fullScanResponse.summary.totalWarnings} {t(locale, "warningsCount")}
          </p>
          <div className="results-toolbar-actions">
            <button className="secondary-button" disabled={actionsDisabled || scanExportStatus === "loading"} onClick={onExportScan} type="button">
              {scanExportStatus === "loading" ? t(locale, "exporting") : scanExportActionLabel}
            </button>
          </div>
          <p className="category-hint">{scanExportHint}</p>
          {scanExportArtifact ? <p className="category-hint">{t(locale, "exportSavedTo").replace("{path}", scanExportArtifact.filePath)}</p> : null}
          {scanExportError ? <p className="error-copy">{scanExportError}</p> : null}
          {latestDeletePathsResult ? (
            <p className="category-hint">
              {t(locale, "latestDeleteSummary")}: {t(locale, "deletedPathsLabel")} {latestDeletePathsResult.summary.successfulPaths} · {t(locale, "failedPathsLabel")} {latestDeletePathsResult.summary.failedPaths}
            </p>
          ) : null}
          <AuthorizationCallout actionsDisabled={actionsDisabled} authorizationStatus={authorizationStatus} compact isProcessElevated={isProcessElevated} locale={locale} onRestartAsAdministrator={onRestartAsAdministrator} />
        </div>
        {fullScanError ? <p className="error-copy">{fullScanError}</p> : null}
        <div className="split-layout">
          <div className="panel">
            <div className="results-toolbar">
              <h2>{t(locale, "treeTitle")}</h2>
              <div className="results-toolbar-actions">
                <input
                  className="tree-search-input"
                  disabled={actionsDisabled}
                  onChange={(event) => setSearchInputValue(event.target.value)}
                  placeholder={t(locale, "searchLoadedTree")}
                  type="search"
                  value={searchInputValue}
                />
                <button className="secondary-button" disabled={actionsDisabled || selectedDeletePaths.length === 0 || deleteStatus === "loading"} onClick={onRequestDeleteSelection} type="button">
                  {deleteStatus === "loading" ? t(locale, "deleting") : t(locale, "reviewDeleteSelection")}
                </button>
              </div>
            </div>
            <p className="body-copy tree-search-hint">{t(locale, "loadedOnlyHint")}</p>
            <div className="tree-context-card">
              <p className="warning-summary-label">{t(locale, "focusedNodeLabel")}</p>
              <p className="tree-breadcrumbs tree-breadcrumbs-inline">
                {effectiveSelectedTrail.map((node, index) => (
                  <span key={node.path}>
                    {index > 0 ? " / " : null}
                    <button className="tree-breadcrumb-button" disabled={actionsDisabled} onClick={() => onSelectFullScanNode(node.path)} type="button">{nodeLabel(node)}</button>
                  </span>
                ))}
              </p>
            </div>
            <WarningSummary compact label={t(locale, "loadedTreeWarningsTitle")} locale={locale} warnings={loadedTreeWarnings} />
            <p className="category-hint">{t(locale, "selectedDeleteCountLabel")}: {selectedDeletePaths.length}</p>
            {filteredTree ? (
              <>
                <p className="tree-stats">{visibleNodeCount} {t(locale, "visibleNodes")}</p>
                <FileTreeView locale={locale} root={filteredTree} onExpandNode={onExpandFullScanNode} onSelectNode={onSelectFullScanNode} onToggleDeletePath={onToggleDeletePath} selectedPath={effectiveSelectedNode.path} selectedNodeChildrenLoaded={effectiveSelectedNode.childrenLoaded} selectedDeletePathSet={selectedDeletePathSet} selectedTrailPathSet={effectiveSelectedTrailPathSet} interactionDisabled={actionsDisabled} forceExpandAll={deferredFullScanQuery.trim().length > 0} rootPath={fullScanResponse.rootPath} />
              </>
            ) : (
              <p>{t(locale, "noTreeMatches")}</p>
            )}
          </div>
          <div className="panel">
            <h2>{t(locale, "selectedNodeTitle")}</h2>
            <p className="tree-breadcrumbs">
              {effectiveSelectedTrail.map((node, index) => (
                <span key={node.path}>
                  {index > 0 ? " / " : null}
                  <button className="tree-breadcrumb-button" disabled={actionsDisabled} onClick={() => onSelectFullScanNode(node.path)} type="button">{nodeLabel(node)}</button>
                </span>
              ))}
            </p>
            <p>{t(locale, "fullPathLabel")}: {effectiveSelectedNode.path}</p>
            <p>{t(locale, "nodeTypeLabel")}: {effectiveSelectedNode.isDirectory ? t(locale, "directoryType") : t(locale, "fileType")}</p>

            <div className="tree-summary-grid">
              <div className="summary-card">
                <span>{t(locale, "selectedNodeShareLabel")}</span>
                <strong>{nodeShare(effectiveSelectedNode, fullScanResponse.summary.totalEstimatedBytes)}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "loadedChildrenLabel")}</span>
                <strong>{effectiveSelectedNode.children.length}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "remainingChildrenLabel")}</span>
                <strong>{effectiveSelectedNode.hasChildren && !effectiveSelectedNode.childrenLoaded ? "1+" : "0"}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "loadedDescendantsLabel")}</span>
                <strong>{summary.loadedDescendants}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "loadedFilesLabel")}</span>
                <strong>{summary.loadedFiles}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "loadedDirectoriesLabel")}</span>
                <strong>{summary.loadedDirectories}</strong>
              </div>
              <div className="summary-card">
                <span>{t(locale, "loadedWarningsLabel")}</span>
                <strong>{summary.loadedWarnings}</strong>
              </div>
            </div>

            <div className="analysis-section">
              <div className="results-toolbar">
                <h3>{t(locale, "analysisTitle")}</h3>
                <span className="warning-summary-label">{t(locale, "analysisContextLabel")}: {nodeLabel(effectiveSelectedNode)}</span>
              </div>
              <p className="category-hint tree-preview-hint">{t(locale, "treemapHint")}</p>
              <h4>{t(locale, "treemapTitle")}</h4>
              <TreemapView actionsDisabled={actionsDisabled} blocks={treemapBlocks} locale={locale} onSelectNode={onSelectFullScanNode} />
              <div className="tree-preview-grid">
                <div>
                  <h4>{t(locale, "largeFilesTitle")}</h4>
                  {loadedPreview.topFiles.length === 0 ? (
                    <p className="tree-largest-empty">{t(locale, "topLoadedFilesEmpty")}</p>
                  ) : (
                    <div className="tree-largest-list">
                      {loadedPreview.topFiles.map((node) => (
                        <button key={node.path} className="tree-largest-button" disabled={actionsDisabled} onClick={() => onSelectFullScanNode(node.path)} type="button">
                          <span className="tree-preview-copy">
                            <strong>{nodeLabel(node)}</strong>
                            <span className="tree-preview-path">{node.path}</span>
                          </span>
                          <strong>{formatBytes(node.sizeBytes, locale)}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h4>{t(locale, "largePathsTitle")}</h4>
                  {loadedPreview.topPaths.length === 0 ? (
                    <p className="tree-largest-empty">{t(locale, "topLoadedPathsEmpty")}</p>
                  ) : (
                    <div className="tree-largest-list">
                      {loadedPreview.topPaths.map((node) => (
                        <button key={node.path} className="tree-largest-button" disabled={actionsDisabled} onClick={() => onSelectFullScanNode(node.path)} type="button">
                          <span className="tree-preview-copy">
                            <strong>{nodeLabel(node)}</strong>
                            <span className="tree-preview-path">{node.path}</span>
                          </span>
                          <strong>{formatBytes(node.sizeBytes, locale)}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="category-card-actions">
              <button className="chip-button" disabled={actionsDisabled || effectiveSelectedNode.path === fullScanResponse.rootPath} onClick={() => onToggleDeletePath(effectiveSelectedNode.path)} type="button">
                {isSelectedForDelete ? `${t(locale, "categoriesSelectionRemove")}` : `${t(locale, "categoriesSelectionAdd")}`}
              </button>
              <span className={isSelectedForDelete ? "chip-label" : "chip-label chip-label-inactive"}>{isSelectedForDelete ? t(locale, "deleteSelectedBadge") : t(locale, "deleteNotSelectedBadge")}</span>
              {canLoadSelectedNodeChildren ? (
                <button className="chip-button" disabled={actionsDisabled || isLoadingSelectedNodeChildren} onClick={() => void handleLoadSelectedNodeChildren()} type="button">
                  {isLoadingSelectedNodeChildren ? t(locale, "selectedNodeLoadingChildren") : t(locale, "selectedNodeLoadChildren")}
                </button>
              ) : null}
            </div>
            {canLoadSelectedNodeChildren ? <p className="category-hint">{t(locale, "selectedNodeLoadHint")}</p> : null}

            {deleteConfirmationVisible ? (
              <div className="confirm-card">
                <p className="eyebrow">{t(locale, "confirmDeleteSelection")}</p>
                <h3>{t(locale, "selectedDeleteCountLabel")}: {selectedDeletePaths.length}</h3>
                <p>{deletePreviewResult ? formatDeleteSelectionSummary(locale, deletePreviewResult) : t(locale, "deleteSelectionSummary").replace("{paths}", String(selectedDeletePaths.length)).replace("{files}", String(deleteEstimate.files)).replace("{bytes}", formatBytes(deleteEstimate.bytes, locale))}</p>
                <div className="button-row">
                  <button className="primary-button" disabled={actionsDisabled || deleteStatus === "loading"} onClick={onConfirmDeleteSelection} type="button">
                    {deleteStatus === "loading" ? t(locale, "deleting") : t(locale, "confirmDelete")}
                  </button>
                  <button className="secondary-button" disabled={actionsDisabled || deleteStatus === "loading"} onClick={onCancelDeleteSelection} type="button">
                    {t(locale, "cancel")}
                  </button>
                </div>
              </div>
            ) : null}

            <h3>{t(locale, "largestChildrenLabel")}</h3>
            {summary.largestChildren.length === 0 ? (
              <p className="tree-largest-empty">{t(locale, "largestChildrenEmpty")}</p>
            ) : (
              <div className="tree-largest-list">
                {summary.largestChildren.map((child) => (
                  <button key={child.path} className="tree-largest-button" disabled={actionsDisabled} onClick={() => onSelectFullScanNode(child.path)} type="button">
                    <span>{nodeLabel(child)}</span>
                    <strong>{formatBytes(child.sizeBytes, locale)}</strong>
                  </button>
                ))}
              </div>
            )}

            <WarningSummary compact label={t(locale, "warningSummaryTitle")} locale={locale} warnings={effectiveSelectedNode.warnings} />
            <WarningGroups locale={locale} warnings={effectiveSelectedNode.warnings} emptyLabel={t(locale, "selectedNodeNoWarnings")} />
            {deleteError ? <p className="error-copy">{deleteError}</p> : null}
          </div>
        </div>
      </section>
    );
  }

  if (!scanResponse) {
    return (
      <section className="page-shell">
        <div className="panel">
          <h2>{t(locale, "resultsTitle")}</h2>
          <p>{t(locale, "detailsEmpty")}</p>
        </div>
      </section>
    );
  }

  const selectedCategory = findSelectedCategory(scanResponse, selectedCategoryId);
  const selectedCategoryMetadata = categories.find((category) => category.id === selectedCategory.categoryId) ?? null;
  const selectedCleanResult = cleanResponse?.categories.find((category) => category.categoryId === selectedCategory.categoryId) ?? null;
  const isPreparedMode = mode === "prepared";
  const visiblePreparedIds = isPreparedMode ? scanResponse.categories.map((category) => category.categoryId) : preparedCategoryIds;

  return (
    <section className="page-shell">
      <div className="hero-card">
          <p className="eyebrow">{isPreparedMode ? t(locale, "latestPreparedScan") : t(locale, "latestSafeScan")}</p>
          <h1>{formatScanHero(locale, scanResponse)}</h1>
          <ModeSwitcher locale={locale} mode={mode} onSwitchToListResults={onSwitchToListResults} onSwitchToFullResults={onSwitchToFullResults} disabled={actionsDisabled} />
        <p className="body-copy">{formatScanMeta(locale, scanResponse)}</p>
        {isPreparedMode ? <p className="category-hint">{t(locale, "preparedResultsHint")}</p> : null}
        <AuthorizationCallout actionsDisabled={actionsDisabled} authorizationStatus={authorizationStatus} compact isProcessElevated={isProcessElevated} locale={locale} onRestartAsAdministrator={onRestartAsAdministrator} />
      </div>
      <div className="split-layout">
        <div className="panel">
          <div className="results-toolbar">
            <h2>{t(locale, "resultsTitle")}</h2>
            <div className="results-toolbar-actions">
              <div className="results-sorter" aria-label={t(locale, "sortResultsLabel")}>
                <span className="warning-summary-label">{t(locale, "sortResultsLabel")}</span>
                <div className="results-sorter-buttons">
                  <button className={listResultsSort === "reclaimable" ? "sort-button sort-button-active" : "sort-button"} disabled={actionsDisabled} onClick={() => onListResultsSortChange("reclaimable")} type="button">{t(locale, "sortByReclaimable")}</button>
                  <button className={listResultsSort === "files" ? "sort-button sort-button-active" : "sort-button"} disabled={actionsDisabled} onClick={() => onListResultsSortChange("files")} type="button">{t(locale, "sortByFiles")}</button>
                  <button className={listResultsSort === "risk" ? "sort-button sort-button-active" : "sort-button"} disabled={actionsDisabled} onClick={() => onListResultsSortChange("risk")} type="button">{t(locale, "sortByRisk")}</button>
                </div>
              </div>
              <button className="primary-button" onClick={onRequestCleanConfirmation} disabled={actionsDisabled || cleanStatus === "loading"} type="button">
                {cleanStatus === "loading" ? t(locale, "cleaning") : t(locale, "reviewClean")}
              </button>
              <button className="secondary-button" disabled={actionsDisabled || scanExportStatus === "loading"} onClick={onExportScan} type="button">
                {scanExportStatus === "loading" ? t(locale, "exporting") : scanExportActionLabel}
              </button>
            </div>
          </div>
          <p className="category-hint">{scanExportHint}</p>
          {scanExportArtifact ? <p className="category-hint">{t(locale, "exportSavedTo").replace("{path}", scanExportArtifact.filePath)}</p> : null}
          {scanExportError ? <p className="error-copy">{scanExportError}</p> : null}
          <ul className="result-list">
            {sortedCategories.map((category) => {
              const metadata = categories.find((item) => item.id === category.categoryId) ?? null;
              const isPrepared = visiblePreparedIds.includes(category.categoryId);
              return (
                <li key={category.categoryId} className={category.categoryId === selectedCategory.categoryId ? "result-item result-item-active" : "result-item"}>
                  <button className="result-select-button" disabled={actionsDisabled} onClick={() => onSelectCategory(category.categoryId)} type="button">
                    <strong>{translateCategoryFromScan(locale, category)}</strong>
                    <span>{formatBytes(category.estimatedBytes, locale)}</span>
                    <span>{category.candidateFileCount} {t(locale, "filesCount")}</span>
                    <span>{category.warnings.length} {t(locale, "warningsCount")}</span>
                    {metadata ? <span>{metadata.categoryGroup} · {metadata.badgeLabel}</span> : null}
                    <WarningSummary compact locale={locale} warnings={category.warnings} />
                    <span className={isPrepared ? "chip-label" : "chip-label chip-label-inactive"}>{isPrepared ? t(locale, "categoriesPreparedBadge") : t(locale, "categoriesNotPreparedBadge")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="panel">
          <h2>{t(locale, "detailsTitle")}</h2>
          {cleanConfirmationVisible ? (
            <div className="confirm-card">
              <p className="eyebrow">{isPreparedMode ? t(locale, "confirmPreparedClean") : t(locale, "confirmSafeClean")}</p>
              <h3>{formatScanHero(locale, scanResponse)}</h3>
              <p>{isPreparedMode ? formatPreparedConfirmSummary(locale, scanResponse) : formatConfirmSummary(locale, scanResponse)}</p>
              <div className="button-row">
                <button className="primary-button" disabled={actionsDisabled || cleanStatus === "loading"} onClick={onConfirmClean} type="button">
                  {cleanStatus === "loading" ? t(locale, "cleaning") : t(locale, "confirmClean")}
                </button>
                <button className="secondary-button" disabled={actionsDisabled || cleanStatus === "loading"} onClick={onCancelClean} type="button">
                  {t(locale, "cancel")}
                </button>
              </div>
            </div>
          ) : null}
          <h3>{selectedCategoryMetadata ? translateCategoryFromMetadata(locale, selectedCategoryMetadata) : translateCategoryFromScan(locale, selectedCategory)}</h3>
          <p>
            {formatBytes(selectedCategory.estimatedBytes, locale)} · {selectedCategory.candidateFileCount} {t(locale, "filesCount")} · {selectedCategory.requiresAdmin ? t(locale, "adminRequired") : t(locale, "noAdminRequired")}
          </p>
          {selectedCategoryMetadata ? (
            <div className="metadata-block">
              <p><strong>{t(locale, "groupLabel")}:</strong> {selectedCategoryMetadata.categoryGroup}</p>
              <p><strong>{t(locale, "badgeLabelText")}:</strong> {selectedCategoryMetadata.badgeLabel}</p>
              <p><strong>{t(locale, "riskTierLabel")}:</strong> {formatRiskTier(locale, selectedCategoryMetadata.riskTier)}</p>
              <p><strong>{t(locale, "descriptionLabel")}:</strong> {selectedCategoryMetadata.description}</p>
              <p><strong>{t(locale, "safetyNoteLabel")}:</strong> {selectedCategoryMetadata.safetyNote}</p>
              <p><strong>{t(locale, "includedInSafeDefaultsLabel")}:</strong> {selectedCategoryMetadata.includedInSafeDefaults ? t(locale, "yes") : t(locale, "no")}</p>
              <p><strong>{t(locale, "presetStatusLabel")}:</strong> <span className={visiblePreparedIds.includes(selectedCategory.categoryId) ? "chip-label" : "chip-label chip-label-inactive"}>{visiblePreparedIds.includes(selectedCategory.categoryId) ? t(locale, "categoriesPreparedBadge") : t(locale, "categoriesNotPreparedBadge")}</span></p>
            </div>
          ) : null}
          <WarningSummary compact label={t(locale, "warningSummaryTitle")} locale={locale} warnings={selectedCategory.warnings} />
          <WarningGroups locale={locale} warnings={selectedCategory.warnings} />

          {cleanResponse ? (
            <div className="clean-summary-block">
              <h3>{t(locale, "latestClean")}</h3>
              <p>
                {t(locale, "freed")} {formatBytes(cleanResponse.summary.totalFreedBytes, locale)} · {t(locale, "deleted")} {cleanResponse.summary.totalDeletedFiles} {t(locale, "filesCount")} · {t(locale, "failed")} {cleanResponse.summary.failedCategories}
              </p>
              {selectedCleanResult ? (
                <div>
                  <p>
                    {translateCategoryFromScan(locale, selectedCleanResult)}: {formatBytes(selectedCleanResult.freedBytes, locale)} {t(locale, "freed").toLowerCase()} · {selectedCleanResult.deletedFileCount} {t(locale, "filesCount")} {t(locale, "deleted").toLowerCase()} · {selectedCleanResult.success ? t(locale, "success") : t(locale, "needsAttention")}
                  </p>
                  <WarningSummary compact locale={locale} warnings={selectedCleanResult.warnings} />
                  <WarningGroups compact locale={locale} warnings={selectedCleanResult.warnings} />
                </div>
              ) : null}
            </div>
          ) : null}

          {cleanError ? <p className="error-copy">{cleanError}</p> : null}
        </div>
      </div>
    </section>
  );
}
