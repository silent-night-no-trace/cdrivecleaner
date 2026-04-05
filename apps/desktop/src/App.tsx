import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { analyzeElevation, cleanCategories, cleanSafeDefaults, deleteScheduledScanPlan, deleteSelectedPaths, expandFullScanNode, exportHistory, exportScanReport, getHistory, getScheduledScanPlan, getSettingsMetadata, listCategories, listenFullScanProgress, previewSelectedPaths, restartAsAdministrator, saveScheduledScanPlan, scanCategories, scanFullTree, scanSafeDefaults, setScheduledScanPlanEnabled } from "./lib/api";
import type { ExportArtifact, ScanExportPayload, ScheduledScanPlan, ScheduledScanPlanDraft, SettingsMetadata } from "./lib/contracts";
import { navLabel, t } from "./lib/i18n";
import { buildFullScanTreeIndex, mergeExpandedFullScanNode, updateFullScanTreeIndex, type FullScanTreeIndex } from "./lib/fullScanTree";
import type { ThemePreference } from "./state/appState";
import { useAppState } from "./state/appState";
import { CategoriesPage } from "./pages/CategoriesPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { ResultsPage } from "./pages/ResultsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuthorizationOverlay } from "./components/AuthorizationOverlay";

type ResolvedTheme = "light" | "dark";

function getSystemThemePreference(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveThemePreference(themePreference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return themePreference === "system" ? systemTheme : themePreference;
}

export default function App(): JSX.Element {
  const [authorizationStatus, setAuthorizationStatus] = useState<"idle" | "loading" | "error">("idle");
  const [scanExportStatus, setScanExportStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyExportStatus, setHistoryExportStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [scanExportArtifact, setScanExportArtifact] = useState<ExportArtifact | null>(null);
  const [historyExportArtifact, setHistoryExportArtifact] = useState<ExportArtifact | null>(null);
  const [scanExportError, setScanExportError] = useState<string | null>(null);
  const [historyExportError, setHistoryExportError] = useState<string | null>(null);
  const [settingsMetadata, setSettingsMetadata] = useState<SettingsMetadata | null>(null);
  const [settingsMetadataStatus, setSettingsMetadataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [scheduledScanPlan, setScheduledScanPlan] = useState<ScheduledScanPlan | null>(null);
  const [scheduledScanStatus, setScheduledScanStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [scheduledScanError, setScheduledScanError] = useState<string | null>(null);
  const [fullScanIndex, setFullScanIndex] = useState<FullScanTreeIndex | null>(null);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemThemePreference());
  const fullScanSessionRef = useRef(0);
  const expandingFullScanPathsRef = useRef(new Set<string>());
  const activePage = useAppState((state) => state.activePage);
  const isProcessElevated = useAppState((state) => state.isProcessElevated);
  const locale = useAppState((state) => state.locale);
  const themePreference = useAppState((state) => state.themePreference);
  const setActivePage = useAppState((state) => state.setActivePage);
  const setIsProcessElevated = useAppState((state) => state.setIsProcessElevated);
  const setLocale = useAppState((state) => state.setLocale);
  const setThemePreference = useAppState((state) => state.setThemePreference);
  const setCategories = useAppState((state) => state.setCategories);
  const categories = useAppState((state) => state.categories);
  const preparedCategoryIds = useAppState((state) => state.preparedCategoryIds);
  const historyEntries = useAppState((state) => state.historyEntries);
  const setHistoryEntries = useAppState((state) => state.setHistoryEntries);
  const latestScan = useAppState((state) => state.latestScan);
  const latestFullScan = useAppState((state) => state.latestFullScan);
  const latestClean = useAppState((state) => state.latestClean);
  const latestDeletePathsResult = useAppState((state) => state.latestDeletePathsResult);
  const deletePreviewResult = useAppState((state) => state.deletePreviewResult);
  const fullScanProgress = useAppState((state) => state.fullScanProgress);
  const selectedResultCategoryId = useAppState((state) => state.selectedResultCategoryId);
  const selectedFullScanNodePath = useAppState((state) => state.selectedFullScanNodePath);
  const selectedDeletePaths = useAppState((state) => state.selectedDeletePaths);
  const cleanConfirmationVisible = useAppState((state) => state.cleanConfirmationVisible);
  const deleteConfirmationVisible = useAppState((state) => state.deleteConfirmationVisible);
  const resultsMode = useAppState((state) => state.resultsMode);
  const lastListResultsMode = useAppState((state) => state.lastListResultsMode);
  const listResultsSort = useAppState((state) => state.listResultsSort);
  const fullScanQuery = useAppState((state) => state.fullScanQuery);
  const scanStatus = useAppState((state) => state.scanStatus);
  const fullScanStatus = useAppState((state) => state.fullScanStatus);
  const cleanStatus = useAppState((state) => state.cleanStatus);
  const deleteStatus = useAppState((state) => state.deleteStatus);
  const scanError = useAppState((state) => state.scanError);
  const fullScanError = useAppState((state) => state.fullScanError);
  const cleanError = useAppState((state) => state.cleanError);
  const deleteError = useAppState((state) => state.deleteError);
  const setLatestScan = useAppState((state) => state.setLatestScan);
  const setLatestFullScan = useAppState((state) => state.setLatestFullScan);
  const setLatestClean = useAppState((state) => state.setLatestClean);
  const setLatestDeletePathsResult = useAppState((state) => state.setLatestDeletePathsResult);
  const setDeletePreviewResult = useAppState((state) => state.setDeletePreviewResult);
  const setFullScanProgress = useAppState((state) => state.setFullScanProgress);
  const setSelectedResultCategoryId = useAppState((state) => state.setSelectedResultCategoryId);
  const setSelectedFullScanNodePath = useAppState((state) => state.setSelectedFullScanNodePath);
  const setSelectedDeletePaths = useAppState((state) => state.setSelectedDeletePaths);
  const toggleSelectedDeletePath = useAppState((state) => state.toggleSelectedDeletePath);
  const setCleanConfirmationVisible = useAppState((state) => state.setCleanConfirmationVisible);
  const setDeleteConfirmationVisible = useAppState((state) => state.setDeleteConfirmationVisible);
  const setResultsMode = useAppState((state) => state.setResultsMode);
  const setLastListResultsMode = useAppState((state) => state.setLastListResultsMode);
  const setListResultsSort = useAppState((state) => state.setListResultsSort);
  const setFullScanQuery = useAppState((state) => state.setFullScanQuery);
  const setScanStatus = useAppState((state) => state.setScanStatus);
  const setFullScanStatus = useAppState((state) => state.setFullScanStatus);
  const setCleanStatus = useAppState((state) => state.setCleanStatus);
  const setDeleteStatus = useAppState((state) => state.setDeleteStatus);
  const setScanError = useAppState((state) => state.setScanError);
  const setFullScanError = useAppState((state) => state.setFullScanError);
  const setCleanError = useAppState((state) => state.setCleanError);
  const setDeleteError = useAppState((state) => state.setDeleteError);

  const isBusy = authorizationStatus === "loading"
    || scanStatus === "loading"
    || fullScanStatus === "loading"
    || cleanStatus === "loading"
    || deleteStatus === "loading";
  const effectiveTheme = resolveThemePreference(themePreference, systemTheme);
  const actionGateRef = useRef(isBusy);

  useEffect(() => {
    actionGateRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (matches: boolean) => {
      setSystemTheme(matches ? "dark" : "light");
    };

    updateSystemTheme(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      updateSystemTheme(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => {
        mediaQuery.removeEventListener("change", handleChange);
      };
    }

    mediaQuery.addListener(handleChange);
    return () => {
      mediaQuery.removeListener(handleChange);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.style.colorScheme = effectiveTheme;
  }, [effectiveTheme]);

  const beginExclusiveAction = (): boolean => {
    if (actionGateRef.current) {
      return false;
    }

    actionGateRef.current = true;
    return true;
  };

  const refreshHistory = () => {
    void getHistory().then((response) => setHistoryEntries(response.entries));
  };

  const refreshScheduledScanPlan = () => {
    setScheduledScanStatus("loading");
    setScheduledScanError(null);
    void getScheduledScanPlan()
      .then((plan) => {
        setScheduledScanPlan(plan);
        setScheduledScanStatus("ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "scheduledScanGenericError");
        setScheduledScanPlan(null);
        setScheduledScanStatus("error");
        setScheduledScanError(message);
      });
  };

  const resetScanExportState = () => {
    setScanExportStatus("idle");
    setScanExportArtifact(null);
    setScanExportError(null);
  };

  const currentScanExportPayload = (): ScanExportPayload | null => {
    if (resultsMode === "full") {
      return latestFullScan ? { kind: "fullScan", report: latestFullScan } : null;
    }

    return latestScan ? { kind: "categoryScan", report: latestScan } : null;
  };

  const navigateToPage = (page: "home" | "results" | "categories" | "history" | "settings") => {
    if (actionGateRef.current) {
      return;
    }

    setActivePage(page);
  };

  const ensurePreparedCategoriesCanRun = async (categoryIds: string[]) => {
    const elevation = await analyzeElevation(categoryIds);
    setIsProcessElevated(elevation.isProcessElevated);
    if (!elevation.requiresElevation) {
      return true;
    }

    setScanStatus("error");
    setCleanStatus("error");
    const message = t(locale, "preparedElevationRequired").replace("{categories}", elevation.adminCategoryIds.join(", "));
    setScanError(message);
    setCleanError(message);
    setActivePage("categories");
    return false;
  };

  useEffect(() => {
    setSettingsMetadataStatus("loading");
    void listCategories().then(setCategories);
    refreshHistory();
    refreshScheduledScanPlan();
    void analyzeElevation([]).then((elevation) => setIsProcessElevated(elevation.isProcessElevated));
    void getSettingsMetadata()
      .then((metadata) => {
        setSettingsMetadata(metadata);
        setSettingsMetadataStatus("ready");
      })
      .catch(() => {
        setSettingsMetadata(null);
        setSettingsMetadataStatus("error");
      });
  }, [setCategories, setHistoryEntries, setIsProcessElevated]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void listenFullScanProgress((progress) => setFullScanProgress(progress)).then((unlisten) => {
      dispose = unlisten;
    });

    return () => {
      dispose?.();
    };
  }, [setFullScanProgress]);

  const runQuickScan = () => {
    if (!beginExclusiveAction()) {
      return;
    }

    setResultsMode("safe");
    setLastListResultsMode("safe");
    setScanStatus("loading");
    setScanError(null);
    setFullScanError(null);
    setCleanError(null);
    setDeleteError(null);
    setLatestClean(null);
    setLatestDeletePathsResult(null);
    setDeletePreviewResult(null);
    resetScanExportState();
    setSelectedFullScanNodePath(null);
    setSelectedDeletePaths([]);
    setCleanConfirmationVisible(false);
    setDeleteConfirmationVisible(false);
    setDeleteStatus("idle");
    void scanSafeDefaults()
      .then((response) => {
          setLatestScan(response);
          setSelectedResultCategoryId(response.categories[0]?.categoryId ?? null);
        refreshHistory();
        setScanStatus("ready");
        setActivePage("results");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "safeScanFailed");
        setScanStatus("error");
        setScanError(message);
      });
  };

  const runPreparedScan = () => {
    if (actionGateRef.current) {
      return;
    }

    if (preparedCategoryIds.length === 0) {
      setScanStatus("error");
      setScanError(t(locale, "preparedSetEmpty"));
      setActivePage("categories");
      return;
    }

    if (!beginExclusiveAction()) {
      return;
    }

    setResultsMode("prepared");
    setLastListResultsMode("prepared");
    setScanStatus("loading");
    setScanError(null);
    setFullScanError(null);
    setCleanError(null);
    setDeleteError(null);
    setLatestClean(null);
    setLatestDeletePathsResult(null);
    setDeletePreviewResult(null);
    resetScanExportState();
    setSelectedFullScanNodePath(null);
    setSelectedDeletePaths([]);
    setCleanConfirmationVisible(false);
    setDeleteConfirmationVisible(false);
    setDeleteStatus("idle");
    void ensurePreparedCategoriesCanRun(preparedCategoryIds)
      .then((allowed) => {
        if (!allowed) {
          return null;
        }
        return scanCategories(preparedCategoryIds);
      })
      .then((response) => {
        if (!response) {
          return;
        }
        setLatestScan(response);
        setSelectedResultCategoryId(response.categories[0]?.categoryId ?? null);
        refreshHistory();
        setScanStatus("ready");
        setActivePage("results");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "preparedScanFailed");
        setScanStatus("error");
        setScanError(message);
        setActivePage("categories");
      });
  };

  const runFullScanInternal = (rootPath?: string) => {
    fullScanSessionRef.current += 1;
    setResultsMode("full");
    setFullScanQuery("");
    setFullScanStatus("loading");
    setFullScanError(null);
    setDeleteError(null);
    setLatestFullScan(null);
    setFullScanIndex(null);
    setFullScanProgress(null);
    setDeletePreviewResult(null);
    resetScanExportState();
    setSelectedFullScanNodePath(null);
    setSelectedDeletePaths([]);
    setCleanConfirmationVisible(false);
    setDeleteConfirmationVisible(false);
    setDeleteStatus("idle");
    setActivePage("results");

    window.setTimeout(() => {
      void scanFullTree(rootPath)
        .then((response) => {
          setLatestFullScan(response);
          setFullScanIndex(buildFullScanTreeIndex(response.tree));
          setSelectedFullScanNodePath(response.tree.path);
          setFullScanStatus("ready");
          setFullScanProgress(null);
          setActivePage("results");
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : t(locale, "fullScanFailed");
          setFullScanStatus("error");
          setFullScanError(message);
          setFullScanProgress(null);
        });
    }, 0);
  };

  const runFullScan = (rootPath?: string) => {
    if (!beginExclusiveAction()) {
      return;
    }

    runFullScanInternal(rootPath);
  };

  const runExpandFullScanNode = async (nodePath: string) => {
    if (actionGateRef.current || !latestFullScan) {
      return;
    }

    const activeFullScan = latestFullScan;
    const activeFullScanSession = fullScanSessionRef.current;

    if (expandingFullScanPathsRef.current.has(nodePath)) {
      return;
    }

    expandingFullScanPathsRef.current.add(nodePath);
    setFullScanError(null);

    try {
      const expandedNode = await expandFullScanNode(activeFullScan.rootPath, nodePath);
      const currentFullScan = useAppState.getState().latestFullScan;
      if (
        !currentFullScan
        || fullScanSessionRef.current !== activeFullScanSession
        || currentFullScan.rootPath !== activeFullScan.rootPath
      ) {
        return;
      }

      const mergedTree = mergeExpandedFullScanNode(currentFullScan.tree, expandedNode);
      useAppState.setState({
        latestFullScan: {
          ...currentFullScan,
          tree: mergedTree,
        },
      });
      setFullScanIndex((currentIndex) => currentIndex
        ? updateFullScanTreeIndex(currentIndex, mergedTree, expandedNode)
        : buildFullScanTreeIndex(mergedTree));
    } catch (error: unknown) {
      const message = t(locale, "fullScanNodeLoadFailed");
      setFullScanError(message);
      throw new Error(message);
    } finally {
      expandingFullScanPathsRef.current.delete(nodePath);
    }
  };

  const requestQuickClean = () => {
    if (actionGateRef.current) {
      return;
    }

    if (!latestScan) {
      return;
    }
    setCleanError(null);
    setActivePage("results");
    setCleanConfirmationVisible(true);
  };

  const requestDeleteSelection = () => {
    if (actionGateRef.current) {
      return;
    }

    if (selectedDeletePaths.length === 0) {
      setDeleteError(t(locale, "deleteSelectionEmpty"));
      return;
    }
    if (latestFullScan && selectedDeletePaths.includes(latestFullScan.rootPath)) {
      setDeleteError(t(locale, "deleteSelectionRootBlocked"));
      return;
    }
    setDeleteError(null);
    if (!latestFullScan) {
      return;
    }
    if (!beginExclusiveAction()) {
      return;
    }
    setDeleteStatus("loading");
    void previewSelectedPaths(latestFullScan.rootPath, selectedDeletePaths)
      .then((response) => {
        setDeletePreviewResult(response);
        setDeleteConfirmationVisible(true);
        setDeleteStatus("idle");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "deleteSelectionFailed");
        setDeleteStatus("error");
        setDeleteError(message);
      });
  };

  const selectFullScanNode = (nodePath: string) => {
    if (actionGateRef.current) {
      return;
    }

    setSelectedFullScanNodePath(nodePath);
  };

  const toggleDeletePath = (nodePath: string) => {
    if (actionGateRef.current) {
      return;
    }

    if (latestFullScan && nodePath === latestFullScan.rootPath) {
      setDeleteError(t(locale, "deleteSelectionRootBlocked"));
      return;
    }
    setDeleteError(null);
    toggleSelectedDeletePath(nodePath);
  };

  const runQuickClean = () => {
    if (!beginExclusiveAction()) {
      return;
    }

    setCleanStatus("loading");
    setCleanError(null);
    if (resultsMode === "prepared" && latestScan) {
      const preparedSnapshotIds = latestScan.categories.map((category) => category.categoryId);
      void ensurePreparedCategoriesCanRun(preparedSnapshotIds)
        .then((allowed) => {
          if (!allowed) {
            return null;
          }
          return cleanCategories(preparedSnapshotIds);
        })
        .then((response) => {
          if (!response) {
            return;
          }
          setLatestClean(response);
          refreshHistory();
          setCleanStatus("ready");
          setCleanConfirmationVisible(false);
          setActivePage("results");
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : t(locale, "preparedCleanFailed");
          setCleanStatus("error");
          setCleanError(message);
        });
      return;
    }

    void cleanSafeDefaults()
      .then((response) => {
        setLatestClean(response);
        refreshHistory();
        setCleanStatus("ready");
        setCleanConfirmationVisible(false);
        setActivePage("results");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "safeCleanFailed");
        setCleanStatus("error");
        setCleanError(message);
      });
  };

  const cancelQuickClean = () => {
    setCleanConfirmationVisible(false);
  };

  const cancelDeleteSelection = () => {
    setDeleteConfirmationVisible(false);
    setDeletePreviewResult(null);
  };

  const runDeleteSelection = () => {
    if (actionGateRef.current) {
      return;
    }

    if (!latestFullScan || selectedDeletePaths.length === 0) {
      setDeleteStatus("error");
      setDeleteError(t(locale, "deleteSelectionEmpty"));
      return;
    }

    if (!beginExclusiveAction()) {
      return;
    }

    setDeleteStatus("loading");
    setDeleteError(null);
    void deleteSelectedPaths(latestFullScan.rootPath, selectedDeletePaths)
      .then((response) => {
        setLatestDeletePathsResult(response);
        setDeletePreviewResult(null);
        setDeleteStatus("ready");
        setDeleteConfirmationVisible(false);
        setSelectedDeletePaths([]);
        runFullScanInternal(latestFullScan.rootPath);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "deleteSelectionFailed");
        setDeleteStatus("error");
        setDeleteError(message);
      });
  };

  const switchToListResults = () => {
    if (actionGateRef.current) {
      return;
    }

    setResultsMode(lastListResultsMode);
    setActivePage("results");
  };

  const switchToFullResults = () => {
    if (actionGateRef.current) {
      return;
    }

    setResultsMode("full");
    setActivePage("results");
  };

  const activateAuthorizationMode = () => {
    if (!beginExclusiveAction()) {
      return;
    }

    setScanError(null);
    setFullScanError(null);
    setCleanError(null);
    setAuthorizationStatus("loading");

    const startedAt = Date.now();
    void restartAsAdministrator()
      .then(() => {
        const remainingDelay = Math.max(0, 1500 - (Date.now() - startedAt));
        window.setTimeout(() => setAuthorizationStatus("idle"), remainingDelay);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "authorizationModeFailed");
        setAuthorizationStatus("error");
        setScanError(message);
        setFullScanError(message);
        setCleanError(message);
      });
  };

  const runExportScan = () => {
    const payload = currentScanExportPayload();
    if (!payload) {
      setScanExportStatus("error");
      setScanExportError(t(locale, "exportScanUnavailable"));
      return;
    }

    setScanExportStatus("loading");
    setScanExportArtifact(null);
    setScanExportError(null);
    void exportScanReport(payload)
      .then((artifact) => {
        setScanExportArtifact(artifact);
        setScanExportStatus("ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "exportFailed");
        setScanExportStatus("error");
        setScanExportError(message);
      });
  };

  const runExportHistory = () => {
    setHistoryExportStatus("loading");
    setHistoryExportArtifact(null);
    setHistoryExportError(null);
    void exportHistory({ entries: historyEntries })
      .then((artifact) => {
        setHistoryExportArtifact(artifact);
        setHistoryExportStatus("ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "exportFailed");
        setHistoryExportStatus("error");
        setHistoryExportError(message);
      });
  };

  const runSaveScheduledScanPlan = (draft: ScheduledScanPlanDraft) => {
    setScheduledScanStatus("saving");
    setScheduledScanError(null);
    void saveScheduledScanPlan(draft)
      .then((plan) => {
        setScheduledScanPlan(plan);
        setScheduledScanStatus("ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "scheduledScanGenericError");
        setScheduledScanStatus("error");
        setScheduledScanError(message);
      });
  };

  const runSetScheduledScanEnabled = (enabled: boolean) => {
    setScheduledScanStatus("saving");
    setScheduledScanError(null);
    void setScheduledScanPlanEnabled(enabled)
      .then((plan) => {
        setScheduledScanPlan(plan);
        setScheduledScanStatus("ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "scheduledScanGenericError");
        setScheduledScanStatus("error");
        setScheduledScanError(message);
      });
  };

  const runDeleteScheduledScanPlan = () => {
    setScheduledScanStatus("saving");
    setScheduledScanError(null);
    void deleteScheduledScanPlan()
      .then(() => {
        setScheduledScanPlan(null);
        setScheduledScanStatus("ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : t(locale, "scheduledScanGenericError");
        setScheduledScanStatus("error");
        setScheduledScanError(message);
      });
  };

  const pageMap = {
    home: <HomePage locale={locale} isProcessElevated={isProcessElevated} onQuickScan={runQuickScan} onFullScan={() => runFullScan()} onQuickCleanRequest={requestQuickClean} onRestartAsAdministrator={activateAuthorizationMode} canQuickClean={scanStatus === "ready" && latestScan !== null && resultsMode === "safe"} scanStatus={scanStatus} fullScanStatus={fullScanStatus} cleanStatus={cleanStatus} scanError={scanError} fullScanError={fullScanError} cleanError={cleanError} actionsDisabled={isBusy} authorizationStatus={authorizationStatus} />,
    results: <ResultsPage locale={locale} isProcessElevated={isProcessElevated} mode={resultsMode} categories={categories} preparedCategoryIds={preparedCategoryIds} scanResponse={latestScan} fullScanResponse={latestFullScan} fullScanIndex={fullScanIndex} fullScanProgress={fullScanProgress} fullScanStatus={fullScanStatus} fullScanError={fullScanError} cleanResponse={latestClean} latestDeletePathsResult={latestDeletePathsResult} deletePreviewResult={deletePreviewResult} selectedCategoryId={selectedResultCategoryId} selectedFullScanNodePath={selectedFullScanNodePath} selectedDeletePaths={selectedDeletePaths} deleteConfirmationVisible={deleteConfirmationVisible} deleteStatus={deleteStatus} deleteError={deleteError} onToggleDeletePath={toggleDeletePath} onRequestDeleteSelection={requestDeleteSelection} onConfirmDeleteSelection={runDeleteSelection} onCancelDeleteSelection={cancelDeleteSelection} onRestartAsAdministrator={activateAuthorizationMode} onSelectCategory={setSelectedResultCategoryId} onSelectFullScanNode={selectFullScanNode} onRequestCleanConfirmation={requestQuickClean} onConfirmClean={runQuickClean} onCancelClean={cancelQuickClean} onSwitchToListResults={switchToListResults} onSwitchToFullResults={switchToFullResults} onRunFullScan={runFullScan} onExpandFullScanNode={runExpandFullScanNode} listResultsSort={listResultsSort} onListResultsSortChange={setListResultsSort} onExportScan={runExportScan} scanExportStatus={scanExportStatus} scanExportArtifact={scanExportArtifact} scanExportError={scanExportError} fullScanQuery={fullScanQuery} onFullScanQueryChange={setFullScanQuery} cleanConfirmationVisible={cleanConfirmationVisible} cleanStatus={cleanStatus} cleanError={cleanError} actionsDisabled={isBusy} authorizationStatus={authorizationStatus} />,
    categories: <CategoriesPage locale={locale} isProcessElevated={isProcessElevated} onRunPreparedScan={runPreparedScan} onRestartAsAdministrator={activateAuthorizationMode} scanStatus={scanStatus} scanError={scanError} actionsDisabled={isBusy} authorizationStatus={authorizationStatus} />,
    history: <HistoryPage entries={historyEntries} locale={locale} exportStatus={historyExportStatus} exportArtifact={historyExportArtifact} exportError={historyExportError} onExportHistory={runExportHistory} actionsDisabled={isBusy} />,
    settings: <SettingsPage locale={locale} themePreference={themePreference} metadata={settingsMetadata} metadataStatus={settingsMetadataStatus} scheduledScanPlan={scheduledScanPlan} scheduledScanStatus={scheduledScanStatus} scheduledScanError={scheduledScanError} currentPreparedCategoryIds={preparedCategoryIds} onLocaleChange={setLocale} onThemeChange={setThemePreference} onSaveScheduledScanPlan={runSaveScheduledScanPlan} onSetScheduledScanEnabled={runSetScheduledScanEnabled} onDeleteScheduledScanPlan={runDeleteScheduledScanPlan} />,
  } as const;

  return (
    <div className="app-shell" data-theme={effectiveTheme}>
      <aside className="sidebar">
        <div>
          <p className="eyebrow">{t(locale, "appName")}</p>
          <h1 className="sidebar-title">{t(locale, "sidebarTitle")}</h1>
        </div>
        <nav className="nav-list">
          {(["home", "results", "categories", "history", "settings"] as const).map((page) => (
            <button
              key={page}
              className={page === activePage ? "nav-button nav-button-active" : "nav-button"}
              disabled={isBusy}
              onClick={() => navigateToPage(page)}
              type="button"
            >
              {navLabel(locale, page)}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content-shell">{pageMap[activePage]}</main>
      <AuthorizationOverlay locale={locale} visible={authorizationStatus === "loading"} />
    </div>
  );
}
