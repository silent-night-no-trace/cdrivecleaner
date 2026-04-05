import { beforeEach, describe, expect, it } from "vitest";
import { APP_STATE_STORAGE_VERSION, appStateDefaults, clearAppStateStorage, readAppStateStorage, useAppState, writeAppStateStorage, writeRawAppStateStorage } from "./appState";

type LegacyPersistedAppStateRecordV1 = {
  state: {
    locale: "en" | "zh";
    themePreference: "system" | "light" | "dark";
    categoryFilter: "all" | "safe-defaults" | "admin";
    preparedCategoryIds: string[];
  };
  version: 1;
};

type LegacyPersistedAppStateRecordV2 = {
  state: {
    locale: "en" | "zh";
    themePreference: "system" | "light" | "dark";
    categoryFilter: "all" | "safe-defaults" | "admin";
    preparedCategoryIds: string[];
    resultsMode: "safe" | "prepared" | "full";
    lastListResultsMode: "safe" | "prepared";
  };
  version: 2;
};

function createBaseState() {
  return {
    ...appStateDefaults,
    categories: [],
    historyEntries: [],
    preparedCategoryIds: [],
    selectedDeletePaths: [],
  };
}

describe("app state", () => {
  beforeEach(() => {
    clearAppStateStorage();
    useAppState.persist.clearStorage();
    useAppState.setState(createBaseState());
  });

  it("starts on home and updates categories/history deterministically", () => {
    useAppState.setState(createBaseState());

    useAppState.getState().setCategories([
      {
        id: "user-temp",
        displayName: "User Temp Files",
        description: "Cleans the current user's temporary folder.",
        categoryGroup: "System",
        badgeLabel: "Recommended",
        safetyNote: "Low risk.",
        riskTier: "SafeDefault",
        requiresAdmin: false,
        includedInSafeDefaults: true,
      },
    ]);
    useAppState.getState().setHistoryEntries([
      {
        timestamp: "2026-03-22 09:00:00",
        kind: "scan",
        summary: "Scan complete.",
      },
    ]);
    useAppState.getState().setActivePage("results");

    const state = useAppState.getState();
    expect(state.activePage).toBe("results");
    expect(state.categories).toHaveLength(1);
    expect(state.historyEntries[0]?.kind).toBe("scan");
  });

  it("stores scan payload and scan lifecycle state", () => {
    useAppState.setState(createBaseState());

    useAppState.getState().setScanStatus("loading");
    useAppState.getState().setLatestScan({
      summary: {
        categoryCount: 1,
        totalEstimatedBytes: 1024,
        totalCandidateFiles: 4,
        totalWarnings: 0,
      },
      categories: [
        {
          categoryId: "user-temp",
          displayName: "User Temp Files",
          estimatedBytes: 1024,
          candidateFileCount: 4,
          requiresAdmin: false,
          riskTier: "SafeDefault",
          warnings: [],
        },
      ],
    });
    useAppState.getState().setScanStatus("ready");

    const state = useAppState.getState();
    expect(state.scanStatus).toBe("ready");
    expect(state.latestScan?.categories[0]?.categoryId).toBe("user-temp");
  });

  it("stores clean payload and selected result category state", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results", scanStatus: "ready" });

    useAppState.getState().setSelectedResultCategoryId("shader-cache");
    useAppState.getState().setCleanStatus("loading");
    useAppState.getState().setLatestClean({
      summary: {
        categoryCount: 1,
        successfulCategories: 0,
        failedCategories: 1,
        totalFreedBytes: 0,
        totalDeletedFiles: 0,
        totalWarnings: 1,
      },
      categories: [
        {
          categoryId: "shader-cache",
          displayName: "Shader Cache",
          freedBytes: 0,
          deletedFileCount: 0,
          success: false,
          warnings: [{ code: "FileDeleteAccessDenied", severity: "Attention", message: "Access denied." }],
        },
      ],
    });
    useAppState.getState().setCleanStatus("ready");

    const state = useAppState.getState();
    expect(state.selectedResultCategoryId).toBe("shader-cache");
    expect(state.cleanStatus).toBe("ready");
    expect(state.latestClean?.categories[0]?.success).toBe(false);
  });

  it("tracks clean confirmation visibility independently from clean execution", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results", scanStatus: "ready" });

    useAppState.getState().setCleanConfirmationVisible(true);
    expect(useAppState.getState().cleanConfirmationVisible).toBe(true);
    useAppState.getState().setCleanStatus("loading");
    useAppState.getState().setCleanConfirmationVisible(false);

    const state = useAppState.getState();
    expect(state.cleanStatus).toBe("loading");
    expect(state.cleanConfirmationVisible).toBe(false);
  });

  it("stores history entries for later History page rendering", () => {
    useAppState.setState({ ...createBaseState(), activePage: "history" });

    useAppState.getState().setHistoryEntries([
      {
        timestamp: "2026-03-22T09:00:00Z",
        kind: "scan",
        summary: "Scan complete. Categories=3, estimated=5.52 MB, warnings=1.",
      },
      {
        timestamp: "2026-03-22T09:03:00Z",
        kind: "clean",
        summary: "Cleanup complete. Successful=2, Failed=1, Freed=5.27 MB.",
      },
    ]);

    const state = useAppState.getState();
    expect(state.historyEntries).toHaveLength(2);
    expect(state.historyEntries[1]?.kind).toBe("clean");
  });

  it("stores locale state for UI translation", () => {
    useAppState.setState({ ...createBaseState(), activePage: "settings" });

    useAppState.getState().setLocale("zh");

    expect(useAppState.getState().locale).toBe("zh");
  });

  it("stores theme preference for shell appearance", () => {
    useAppState.setState({ ...createBaseState(), activePage: "settings" });

    useAppState.getState().setThemePreference("dark");

    expect(useAppState.getState().themePreference).toBe("dark");
  });

  it("stores category filter state for later category review sessions", () => {
    useAppState.setState({ ...createBaseState(), activePage: "categories" });

    useAppState.getState().setCategoryFilter("admin");

    expect(useAppState.getState().categoryFilter).toBe("admin");
  });

  it("stores process elevation state independently from navigation", () => {
    useAppState.setState(createBaseState());

    useAppState.getState().setIsProcessElevated(true);

    expect(useAppState.getState().isProcessElevated).toBe(true);
    expect(useAppState.getState().activePage).toBe("home");
  });

  it("stores full scan query without changing the active mode", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results", resultsMode: "full", fullScanStatus: "ready" });

    useAppState.getState().setFullScanQuery("cache");

    expect(useAppState.getState().fullScanQuery).toBe("cache");
    expect(useAppState.getState().resultsMode).toBe("full");
  });

  it("tracks last list results mode separately from full tree mode", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results", resultsMode: "full", lastListResultsMode: "prepared" });

    useAppState.getState().setResultsMode("safe");

    expect(useAppState.getState().resultsMode).toBe("safe");
    expect(useAppState.getState().lastListResultsMode).toBe("prepared");
  });

  it("stores results workspace preference independently from scan payloads", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results", resultsMode: "safe", lastListResultsMode: "safe" });

    useAppState.getState().setLastListResultsMode("prepared");
    useAppState.getState().setResultsMode("full");

    expect(useAppState.getState().resultsMode).toBe("full");
    expect(useAppState.getState().lastListResultsMode).toBe("prepared");
  });

  it("stores list results sort preference independently from the active workspace", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results", resultsMode: "full", listResultsSort: "reclaimable" });

    useAppState.getState().setListResultsSort("risk");

    expect(useAppState.getState().listResultsSort).toBe("risk");
    expect(useAppState.getState().resultsMode).toBe("full");
  });

  it("stores full scan state independently from safe scan state", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results" });

    useAppState.getState().setResultsMode("full");
    useAppState.getState().setFullScanStatus("ready");
    useAppState.getState().setLatestFullScan({
      rootPath: "C:/",
      summary: {
        categoryCount: 1,
        totalEstimatedBytes: 4096,
        totalCandidateFiles: 2,
        totalWarnings: 0,
      },
      tree: {
        path: "C:/",
        name: "C:/",
        isDirectory: true,
        sizeBytes: 4096,
        hasChildren: true,
        childrenLoaded: true,
        warnings: [],
        children: [
          {
            path: "C:/Temp",
            name: "Temp",
            isDirectory: true,
            sizeBytes: 4096,
            hasChildren: false,
            childrenLoaded: true,
            warnings: [],
            children: [],
          },
        ],
      },
    });
    useAppState.getState().setSelectedFullScanNodePath("C:/Temp");

    const state = useAppState.getState();
    expect(state.resultsMode).toBe("full");
    expect(state.fullScanStatus).toBe("ready");
    expect(state.latestFullScan?.tree.isDirectory).toBe(true);
    expect(state.selectedFullScanNodePath).toBe("C:/Temp");
  });

  it("stores full scan progress and targeted delete state", () => {
    useAppState.setState({ ...createBaseState(), activePage: "results", resultsMode: "full" });

    useAppState.getState().setFullScanProgress({
      phase: "Scanning",
      currentPath: "C:/PerfLogs",
      directoriesScanned: 8,
      filesScanned: 120,
      warningsCount: 2,
    });
    useAppState.getState().toggleSelectedDeletePath("C:/Temp/cache.bin");
    useAppState.getState().setDeleteConfirmationVisible(true);
    useAppState.getState().setDeleteStatus("loading");
    useAppState.getState().setLatestDeletePathsResult({
      summary: {
        selectedCount: 1,
        successfulPaths: 1,
        failedPaths: 0,
        totalEstimatedBytes: 4096,
        totalDeletedFiles: 1,
        totalWarnings: 0,
      },
      paths: [
        {
          path: "C:/Temp/cache.bin",
          isDirectory: false,
          estimatedBytes: 4096,
          deletedFileCount: 1,
          success: true,
          warnings: [],
        },
      ],
    });

    const state = useAppState.getState();
    expect(state.fullScanProgress?.currentPath).toBe("C:/PerfLogs");
    expect(state.selectedDeletePaths).toEqual(["C:/Temp/cache.bin"]);
    expect(state.deleteConfirmationVisible).toBe(true);
    expect(state.deleteStatus).toBe("loading");
    expect(state.latestDeletePathsResult?.summary.successfulPaths).toBe(1);
  });

  it("tracks prepared category preset selection independently from scan results", () => {
    useAppState.setState(createBaseState());

    useAppState.getState().setPreparedCategoryIds(["user-temp"]);
    useAppState.getState().togglePreparedCategoryId("shader-cache");
    useAppState.getState().togglePreparedCategoryId("user-temp");

    expect(useAppState.getState().preparedCategoryIds).toEqual(["shader-cache"]);
  });

  it("drops stale prepared category ids when the live category catalog changes", () => {
    useAppState.setState(createBaseState());
    useAppState.getState().setPreparedCategoryIds(["user-temp", "missing-category", "shader-cache"]);

    useAppState.getState().setCategories([
      {
        id: "shader-cache",
        displayName: "Shader Cache",
        description: "Cleans compiled shader cache files.",
        categoryGroup: "System",
        badgeLabel: "Optional",
        safetyNote: "Low risk.",
        riskTier: "SafeDefault",
        requiresAdmin: false,
        includedInSafeDefaults: true,
      },
    ]);

    expect(useAppState.getState().preparedCategoryIds).toEqual(["shader-cache"]);
  });

  it("persists only the phase-1 UI preference subset", () => {
    useAppState.getState().setLocale("zh");
    useAppState.getState().setThemePreference("dark");
    useAppState.getState().setCategoryFilter("safe-defaults");
    useAppState.getState().setPreparedCategoryIds(["user-temp", "user-temp", "shader-cache"]);
    useAppState.getState().setResultsMode("full");
    useAppState.getState().setLastListResultsMode("prepared");
    useAppState.getState().setListResultsSort("risk");
    useAppState.getState().setFullScanQuery("cache");
    useAppState.getState().setScanStatus("error");
    useAppState.getState().setScanError("transient");

    expect(readAppStateStorage()).toEqual({
      state: {
        locale: "zh",
        themePreference: "dark",
        categoryFilter: "safe-defaults",
        preparedCategoryIds: ["user-temp", "shader-cache"],
        resultsMode: "full",
        lastListResultsMode: "prepared",
        listResultsSort: "risk",
      },
      version: APP_STATE_STORAGE_VERSION,
    });
  });

  it("keeps full scan query session-scoped even when other UI preferences persist", async () => {
    useAppState.getState().setFullScanQuery("cache");
    useAppState.getState().setResultsMode("full");
    useAppState.getState().setLastListResultsMode("prepared");

    expect(readAppStateStorage()?.state).not.toHaveProperty("fullScanQuery");

    useAppState.setState({
      ...createBaseState(),
      fullScanQuery: "local-only",
      resultsMode: "safe",
      lastListResultsMode: "safe",
    });

    writeRawAppStateStorage(JSON.stringify({
      state: {
        locale: "en",
        themePreference: "system",
        categoryFilter: "all",
        preparedCategoryIds: [],
        resultsMode: "full",
        lastListResultsMode: "prepared",
      },
      version: APP_STATE_STORAGE_VERSION,
    }));

    await useAppState.persist.rehydrate();

    const state = useAppState.getState();
    expect(state.fullScanQuery).toBe("local-only");
    expect(state.resultsMode).toBe("full");
    expect(state.lastListResultsMode).toBe("prepared");
  });

  it("rehydrates persisted preferences without reviving transient runtime state", async () => {
    useAppState.setState({
      ...createBaseState(),
      locale: "en",
      themePreference: "system",
      categoryFilter: "all",
      preparedCategoryIds: [],
      resultsMode: "safe",
      lastListResultsMode: "safe",
      listResultsSort: "reclaimable",
      scanStatus: "loading",
      scanError: "should reset",
    });

    writeAppStateStorage({
      state: {
        locale: "zh",
        themePreference: "dark",
        categoryFilter: "admin",
        preparedCategoryIds: ["user-temp", "shader-cache", "user-temp"],
        resultsMode: "full",
        lastListResultsMode: "prepared",
        listResultsSort: "files",
      },
      version: APP_STATE_STORAGE_VERSION,
    });

    await useAppState.persist.rehydrate();

    const state = useAppState.getState();
    expect(state.locale).toBe("zh");
    expect(state.themePreference).toBe("dark");
    expect(state.categoryFilter).toBe("admin");
    expect(state.preparedCategoryIds).toEqual(["user-temp", "shader-cache"]);
    expect(state.resultsMode).toBe("full");
    expect(state.lastListResultsMode).toBe("prepared");
    expect(state.listResultsSort).toBe("files");
    expect(state.scanStatus).toBe("loading");
    expect(state.scanError).toBe("should reset");
  });

  it("backfills results mode preferences when rehydrating older persisted records", async () => {
    useAppState.setState({
      ...createBaseState(),
      resultsMode: "full",
      lastListResultsMode: "prepared",
    });

    const legacyRecord: LegacyPersistedAppStateRecordV1 = {
      state: {
        locale: "zh",
        themePreference: "system",
        categoryFilter: "all",
        preparedCategoryIds: ["shader-cache"],
      },
      version: 1,
    };

    writeRawAppStateStorage(JSON.stringify(legacyRecord));

    await useAppState.persist.rehydrate();

    const state = useAppState.getState();
    expect(state.locale).toBe("zh");
    expect(state.resultsMode).toBe("safe");
    expect(state.lastListResultsMode).toBe("safe");
    expect(state.listResultsSort).toBe("reclaimable");
  });

  it("sanitizes malformed current-version results mode preferences", async () => {
    useAppState.setState({
      ...createBaseState(),
      resultsMode: "prepared",
      lastListResultsMode: "prepared",
    });

    writeRawAppStateStorage(JSON.stringify({
      state: {
        locale: "zh",
        themePreference: "dark",
        categoryFilter: "admin",
        preparedCategoryIds: ["shader-cache"],
        resultsMode: "full",
        lastListResultsMode: "broken",
        listResultsSort: "weird",
      },
      version: APP_STATE_STORAGE_VERSION,
    }));

    await useAppState.persist.rehydrate();

    const state = useAppState.getState();
    expect(state.locale).toBe("zh");
    expect(state.themePreference).toBe("dark");
    expect(state.categoryFilter).toBe("admin");
    expect(state.resultsMode).toBe("full");
    expect(state.lastListResultsMode).toBe("safe");
    expect(state.listResultsSort).toBe("reclaimable");
  });

  it("derives missing list preference from persisted list mode on current-version payloads", async () => {
    useAppState.setState({
      ...createBaseState(),
      resultsMode: "full",
      lastListResultsMode: "safe",
    });

    writeRawAppStateStorage(JSON.stringify({
      state: {
        locale: "en",
        themePreference: "system",
        categoryFilter: "safe-defaults",
        preparedCategoryIds: ["shader-cache"],
        resultsMode: "prepared",
      },
      version: APP_STATE_STORAGE_VERSION,
    }));

    await useAppState.persist.rehydrate();

    const state = useAppState.getState();
    expect(state.resultsMode).toBe("prepared");
    expect(state.lastListResultsMode).toBe("prepared");
    expect(state.listResultsSort).toBe("reclaimable");
  });

  it("backfills list results sort when rehydrating version 2 records", async () => {
    useAppState.setState({
      ...createBaseState(),
      listResultsSort: "risk",
    });

    const legacyRecord: LegacyPersistedAppStateRecordV2 = {
      state: {
        locale: "zh",
        themePreference: "dark",
        categoryFilter: "admin",
        preparedCategoryIds: ["shader-cache"],
        resultsMode: "prepared",
        lastListResultsMode: "prepared",
      },
      version: 2,
    };

    writeRawAppStateStorage(JSON.stringify(legacyRecord));

    await useAppState.persist.rehydrate();

    const state = useAppState.getState();
    expect(state.resultsMode).toBe("prepared");
    expect(state.lastListResultsMode).toBe("prepared");
    expect(state.listResultsSort).toBe("reclaimable");
  });
});
