// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { FullScanTreeResponse, ScanResponse } from "./lib/contracts";
import { APP_STATE_STORAGE_VERSION, appStateDefaults, clearAppStateStorage, useAppState, writeAppStateStorage } from "./state/appState";
import uiFixtures from "./test-support/ui-fixtures.json";

const invokeMock = vi.fn();
let historyCallCount = 0;
const progressListeners = new Set<(event: { payload: unknown }) => void>();
let deferredFullScan: { promise: Promise<unknown>; resolve: (value: unknown) => void } | null = null;
let deferredExpandFullScanNode: { promise: Promise<unknown>; resolve: (value: unknown) => void } | null = null;
let deferredSafeScan: { promise: Promise<unknown>; resolve: (value: unknown) => void } | null = null;
let deferredAuthorization: { promise: Promise<unknown>; resolve: (value: unknown) => void } | null = null;
const matchMediaListeners = new Set<(event: MediaQueryListEvent) => void>();
let prefersDarkMode = false;
const settingsMetadataPayload = {
  appVersion: "0.1.0",
  logDirectory: "C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner",
};
const scanExportArtifact = {
  filePath: "C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\scan-report-20260330-120000.json",
  fileName: "scan-report-20260330-120000.json",
  format: "json",
};
const fullScanExportArtifact = {
  filePath: "C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\full-scan-report-20260330-120000.json",
  fileName: "full-scan-report-20260330-120000.json",
  format: "json",
};
const historyExportArtifact = {
  filePath: "C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\history-export-20260330-120000.json",
  fileName: "history-export-20260330-120000.json",
  format: "json",
};
const scheduledScanPlan = {
  id: "daily-safe-scan",
  mode: "safeDefaults",
  scheduledTime: "08:30",
  enabled: true,
  capturedCategoryIds: [],
  requiresAdmin: false,
  nextRunAt: "2026-04-01T08:30:00Z",
  lastRunAt: null,
  lastRunSummary: null,
};

function emitSystemThemeChange(matches: boolean): void {
  prefersDarkMode = matches;
  matchMediaListeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    if (eventName === "full-scan-progress") {
      progressListeners.add(handler);
    }
    return () => {
      progressListeners.delete(handler);
    };
  },
}));

const {
  categoryPayload,
  initialHistoryPayload,
  postScanHistoryPayload,
  postCleanHistoryPayload,
  fullScanProgressPayload,
  scanPayload,
  cleanPayload,
  preparedScanPayload,
  preparedCleanPayload,
  fullScanPayload,
  expandedTempPayload,
  deleteSelectedPathsPayload,
} = uiFixtures;
const preparedScanFixture = preparedScanPayload as ScanResponse;
const fullScanFixture = fullScanPayload as FullScanTreeResponse;
const adminCategoryIds = categoryPayload.filter((category) => category.requiresAdmin).map((category) => category.id);

describe("desktop-trigger clean flow", () => {
  beforeEach(() => {
    clearAppStateStorage();
    useAppState.persist.clearStorage();
    useAppState.setState({
      ...appStateDefaults,
      categories: [],
      historyEntries: [],
      selectedDeletePaths: [],
      preparedCategoryIds: [],
    });

    prefersDarkMode = false;
    matchMediaListeners.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)" ? prefersDarkMode : false,
        media: query,
        onchange: null,
        addEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
          matchMediaListeners.add(listener);
        },
        removeEventListener: (_event: string, listener: (event: MediaQueryListEvent) => void) => {
          matchMediaListeners.delete(listener);
        },
        addListener: (listener: (event: MediaQueryListEvent) => void) => {
          matchMediaListeners.add(listener);
        },
        removeListener: (listener: (event: MediaQueryListEvent) => void) => {
          matchMediaListeners.delete(listener);
        },
        dispatchEvent: () => true,
      })),
    });

    historyCallCount = 0;
    progressListeners.clear();
    deferredFullScan = null;
    deferredExpandFullScanNode = null;
    deferredSafeScan = null;
    deferredAuthorization = null;

    invokeMock.mockImplementation(async (command: string, args?: { categoryIds?: string[]; rootPath?: string; nodePath?: string; paths?: string[] }) => {
      switch (command) {
        case "list_categories":
          return categoryPayload;
        case "get_history":
          historyCallCount += 1;
          if (historyCallCount <= 1) {
            return initialHistoryPayload;
          }
          if (historyCallCount === 2) {
            return postScanHistoryPayload;
          }
          return postCleanHistoryPayload;
        case "get_settings_metadata":
          return settingsMetadataPayload;
        case "get_scheduled_scan_plan":
          return null;
        case "save_scheduled_scan_plan":
          return scheduledScanPlan;
        case "set_scheduled_scan_plan_enabled":
          return { ...scheduledScanPlan, enabled: (args as { enabled: boolean }).enabled };
        case "delete_scheduled_scan_plan":
          return null;
        case "export_scan_report":
          return args && "payload" in args && (args.payload as { kind: string }).kind === "fullScan"
            ? fullScanExportArtifact
            : scanExportArtifact;
        case "export_history":
          return historyExportArtifact;
        case "analyze_elevation": {
          const ids = args?.categoryIds ?? [];
          const requestedAdminCategoryIds = ids.filter((id) => adminCategoryIds.includes(id));
          return {
            isProcessElevated: false,
            requiresElevation: requestedAdminCategoryIds.length > 0,
            adminCategoryIds: requestedAdminCategoryIds,
          };
        }
        case "restart_as_administrator":
          return deferredAuthorization ? deferredAuthorization.promise : undefined;
        case "scan_safe_defaults":
          return deferredSafeScan ? deferredSafeScan.promise : scanPayload;
        case "scan_categories":
          return preparedScanPayload;
        case "scan_full_tree":
          return deferredFullScan ? deferredFullScan.promise : fullScanFixture;
        case "expand_full_scan_node":
          return deferredExpandFullScanNode ? deferredExpandFullScanNode.promise : expandedTempPayload;
        case "clean_safe_defaults":
          return cleanPayload;
        case "clean_categories":
          return preparedCleanPayload;
        case "preview_selected_paths":
          return deleteSelectedPathsPayload;
        case "delete_selected_paths":
          return deleteSelectedPathsPayload;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
    document.documentElement.dataset.theme = "";
    document.documentElement.style.colorScheme = "";
    cleanup();
  });

  it("routes Home -> Results -> Confirm -> Clean through Tauri commands", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Quick Scan" }));

    await screen.findByText("250.00 KB reclaimable");
    expect(invokeMock).toHaveBeenCalledWith("scan_safe_defaults", undefined);
    expect(screen.getByRole("button", { name: "Authorization mode" })).toBeTruthy();
    expect(screen.getByText("Unlock protected cleanup targets")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Shader Cache/ }));
    await screen.findByText("Warning mix");
    expect((await screen.findAllByText("Informational")).length).toBeGreaterThanOrEqual(1);
    await screen.findByText(/Skipped file info for 'C:\\Fixture\\shader-cache\\locked.bin': Access is denied\./);
    expect(screen.getByText("Cleans shader cache.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Review & Clean" }));
    await screen.findByText("Confirm safe clean");
    expect(invokeMock).not.toHaveBeenCalledWith("clean_safe_defaults", undefined);

    await user.click(screen.getByRole("button", { name: "Confirm Clean" }));

    await screen.findByText(/Freed 250.00 KB/);
    expect(invokeMock).toHaveBeenCalledWith("clean_safe_defaults", undefined);
    expect((await screen.findAllByText("Needs attention")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Skipped file 'C:\\Fixture\\shader-cache\\locked.bin': Access is denied\./)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "History" }));
    await screen.findByText(/Cleanup complete\. Successful=2, Failed=1, Freed=0.24 MB\./);
    expect(historyCallCount).toBeGreaterThanOrEqual(3);
  });

  it("switches UI labels to Chinese from settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "中文" }));

    await screen.findByRole("button", { name: "首页" });
    expect(screen.getByRole("button", { name: "结果" })).toBeTruthy();
    expect(screen.getByText("语言")).toBeTruthy();
  });

  it("shows version and log location on the settings page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_settings_metadata", undefined));

    await user.click(screen.getByRole("button", { name: "Settings" }));

    await screen.findByText("Version");
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("Log location")).toBeTruthy();
    expect(screen.getByText("C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner")).toBeTruthy();
  });

  it("creates and toggles a bounded scheduled scan plan from Settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.clear(screen.getByLabelText("Daily time"));
    await user.type(screen.getByLabelText("Daily time"), "09:15");
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("save_scheduled_scan_plan", {
      draft: {
        mode: "safeDefaults",
        scheduledTime: "09:15",
        enabled: true,
        capturedCategoryIds: [],
      },
    }));

    await user.click(screen.getByRole("button", { name: "Disable plan" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("set_scheduled_scan_plan_enabled", { enabled: false }));
  });

  it("exports the current scan report from Results", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Quick Scan" }));
    await screen.findByText("250.00 KB reclaimable");

    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    await screen.findByText(/Saved to C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\scan-report-20260330-120000.json/);
    expect(invokeMock).toHaveBeenCalledWith("export_scan_report", {
      payload: {
        kind: "categoryScan",
        report: scanPayload,
      },
    });
  });

  it("exports the current full scan snapshot from Results", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Full Scan" }));
    await screen.findByRole("button", { name: "Export Full Scan JSON" });

    await user.click(screen.getByRole("button", { name: "Export Full Scan JSON" }));

    await screen.findByText(/Saved to C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\full-scan-report-20260330-120000.json/);
    expect(invokeMock).toHaveBeenCalledWith("export_scan_report", {
      payload: {
        kind: "fullScan",
      report: fullScanFixture,
      },
    });
  });

  it("exports history from the History page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "History" }));
    await user.click(screen.getByRole("button", { name: "Export History JSON" }));

    await screen.findByText(/Saved to C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\history-export-20260330-120000.json/);
    expect(invokeMock).toHaveBeenCalledWith("export_history", {
      history: initialHistoryPayload,
    });
  });

  it("switches shell theme from settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));
    expect(document.documentElement.dataset.theme).toBe("light");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelector(".app-shell")?.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" }).className.includes("lang-button-active")).toBe(true);
  });

  it("follows system theme changes while preference stays on system", async () => {
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));
    expect(document.documentElement.dataset.theme).toBe("light");

    emitSystemThemeChange(true);

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.querySelector(".app-shell")?.getAttribute("data-theme")).toBe("dark");
  });

  it("restores full workspace and returns to the persisted prepared list preference", async () => {
    const user = userEvent.setup();

    writeAppStateStorage({
      state: {
        locale: "en",
        themePreference: "system",
        categoryFilter: "all",
        preparedCategoryIds: ["user-temp", "shader-cache"],
        resultsMode: "full",
        lastListResultsMode: "prepared",
        listResultsSort: "reclaimable",
      },
      version: APP_STATE_STORAGE_VERSION,
    });
    await useAppState.persist.rehydrate();
    useAppState.setState({
      latestScan: preparedScanFixture,
      selectedResultCategoryId: preparedScanFixture.categories[0]?.categoryId ?? null,
    });

    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));
    await user.click(screen.getByRole("button", { name: "Results" }));

    await screen.findByRole("heading", { level: 1, name: "Run a full scan to explore directory and file space usage." });
    await user.click(screen.getByRole("tab", { name: "Quick results" }));

    await screen.findByText("Latest prepared scan");
    expect(useAppState.getState().resultsMode).toBe("prepared");
    expect(screen.getByText("Prepared categories come from the Categories preset panel and can include admin-only or optional items.")).toBeTruthy();
  });

  it("applies a persisted non-default list sort preference on initial results render", async () => {
    const user = userEvent.setup();

    writeAppStateStorage({
      state: {
        locale: "en",
        themePreference: "system",
        categoryFilter: "all",
        preparedCategoryIds: [],
        resultsMode: "safe",
        lastListResultsMode: "safe",
        listResultsSort: "files",
      },
      version: APP_STATE_STORAGE_VERSION,
    });
    await useAppState.persist.rehydrate();

    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));
    await user.click(screen.getByRole("button", { name: "Quick Scan" }));
    await screen.findByText("250.00 KB reclaimable");

    const resultsList = document.querySelector(".result-list");
    if (!(resultsList instanceof HTMLElement)) {
      throw new Error("expected results list to render");
    }

    const resultButtons = within(resultsList).getAllByRole("button");
    expect(resultButtons[0]?.textContent).toContain("Shader Cache");
    expect(resultButtons[1]?.textContent).toContain("User Temp Files");
    expect(resultButtons[2]?.textContent).toContain("Thumbnail Cache");
  });

  it("blocks overlapping home actions while a quick scan is running", async () => {
    const user = userEvent.setup();
    deferredSafeScan = (() => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((innerResolve) => {
        resolve = innerResolve;
      });
      return { promise, resolve };
    })();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Quick Scan" }));

    expect((screen.getByRole("button", { name: "Scanning..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Full Scan" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Authorization mode" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Results" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Full Scan" }));
    await user.click(screen.getByRole("button", { name: "Authorization mode" }));

    expect(invokeMock).not.toHaveBeenCalledWith("scan_full_tree", undefined);
    expect(invokeMock).not.toHaveBeenCalledWith("restart_as_administrator", undefined);

    deferredSafeScan.resolve(scanPayload);
    await screen.findByText("250.00 KB reclaimable");
    expect((screen.getByRole("button", { name: "Home" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sorts quick results without breaking category selection semantics", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Quick Scan" }));
    await screen.findByText("250.00 KB reclaimable");

    const resultsList = document.querySelector(".result-list");
    if (!(resultsList instanceof HTMLElement)) {
      throw new Error("expected results list to render");
    }

    const resultButtonsBefore = within(resultsList).getAllByRole("button");
    expect(resultButtonsBefore[0]?.textContent).toContain("Shader Cache");
    expect(resultButtonsBefore[1]?.textContent).toContain("Thumbnail Cache");

    await user.click(screen.getByRole("button", { name: "Files" }));

    const resultButtonsAfter = within(resultsList).getAllByRole("button");
    expect(resultButtonsAfter[0]?.textContent).toContain("Shader Cache");
    expect(resultButtonsAfter[1]?.textContent).toContain("User Temp Files");

    await user.click(resultButtonsAfter[0]!);
    await screen.findByText("Cleans shader cache.");
    expect(screen.getByText(/156\.25 KB · 4 files · No admin required/)).toBeTruthy();
  });

  it("routes Home -> Results tree mode through full scan command", async () => {
    const user = userEvent.setup();
    deferredFullScan = (() => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((innerResolve) => {
        resolve = innerResolve;
      });
      return { promise, resolve };
    })();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Full Scan" }));

    progressListeners.forEach((handler) => handler({
      payload: fullScanProgressPayload,
    }));

    await screen.findByRole("heading", { level: 1, name: "Scanning full tree" });
    await screen.findByText(/C:\\PerfLogs/);
    expect((screen.getByRole("button", { name: "Home" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("tab", { name: "Quick results" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "Authorization mode" })[0] as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(invokeMock).not.toHaveBeenCalledWith("scan_safe_defaults", undefined);

    deferredFullScan.resolve(fullScanFixture);

    await screen.findByText("4.00 KB reclaimable");
    expect(invokeMock).toHaveBeenCalledWith("scan_full_tree", undefined);
    expect(screen.getByText("Tree view")).toBeTruthy();
    expect(screen.getByText("Selected node")).toBeTruthy();
    expect(screen.getByText("Focused node")).toBeTruthy();
    expect(screen.getByText("Warnings in loaded tree")).toBeTruthy();
    expect(screen.getByText("Full path: C:\\")).toBeTruthy();
    expect(screen.getAllByText("Informational").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Share of full scan")).toBeTruthy();
    expect(screen.getByText("Analysis")).toBeTruthy();
    expect(screen.getByText("Treemap")).toBeTruthy();
    expect(screen.getByText("Largest loaded files")).toBeTruthy();
    expect(screen.getByText("Largest loaded paths")).toBeTruthy();
    expect(screen.getByText("Largest loaded children")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /notes\.txt.*C:\\notes\.txt/s }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /Temp\/.*C:\\Temp/s }).length).toBeGreaterThanOrEqual(1);
    await user.hover(screen.getByRole("button", { name: /Temp\/ 3\.00 KB 75%/ }));
    await screen.findByText("Click to focus this path in the existing tree and detail panel.");
    await user.click(screen.getByRole("button", { name: /Temp\/ 3\.00 KB 75%/ }));
    await screen.findByText("Full path: C:\\Temp");

    const treeView = document.querySelector(".tree-view");
    if (!(treeView instanceof HTMLElement)) {
      throw new Error("expected tree view to render");
    }

    await user.click(within(treeView).getByRole("button", { name: "Temp/" }));
    await screen.findByText("Full path: C:\\Temp");
    expect((await screen.findAllByRole("button", { name: /cache\.bin/ })).length).toBeGreaterThanOrEqual(1);
    expect(invokeMock).toHaveBeenCalledWith("expand_full_scan_node", { rootPath: "C:\\", nodePath: "C:\\Temp" });
    expect(invokeMock.mock.calls.filter(([command]) => command === "expand_full_scan_node")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "cache.bin" }));
    await screen.findByText("Full path: C:\\Temp\\cache.bin");

    await user.click(screen.getByLabelText("Select cache.bin for deletion"));
    await user.click(screen.getByRole("button", { name: "Review delete selection" }));
    await screen.findByText(/You are about to delete 1 selected results/);
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(invokeMock).toHaveBeenCalledWith("preview_selected_paths", { rootPath: "C:\\", paths: ["C:\\Temp\\cache.bin"] });
    expect(invokeMock).toHaveBeenCalledWith("delete_selected_paths", { rootPath: "C:\\", paths: ["C:\\Temp\\cache.bin"] });
    await screen.findByText(/Latest targeted delete/);

    const searchInput = screen.getByPlaceholderText("Search loaded tree");
    await user.type(searchInput, "cache");
    await screen.findByText("No loaded nodes match the current search.");
  });

  it("runs prepared preset scan/clean from the Categories page", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Categories" }));
    await screen.findByText("Review category trust notes before adding them to future scan presets.");
    expect(screen.getByText("Shader Cache")).toBeTruthy();
    expect(screen.getByText("selected categories")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use safe defaults" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Use safe defaults" }));
    expect(screen.getAllByText("Prepared").length).toBeGreaterThanOrEqual(3);
    await user.click(screen.getAllByRole("button", { name: "Remove from preset" })[0]!);
    expect((await screen.findAllByText("Not prepared")).length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getAllByRole("button", { name: "Add to preset" })[0]!);

    await user.type(screen.getByPlaceholderText("Search categories"), "shader");
    expect(screen.getByText("Shader Cache")).toBeTruthy();
    expect(screen.queryByText("User Temp Files")).toBeNull();

    await user.clear(screen.getByPlaceholderText("Search categories"));
    await user.click(screen.getByRole("button", { name: "Scan prepared set" }));

    await screen.findByText("Latest prepared scan");
    expect(invokeMock).toHaveBeenCalledWith("scan_categories", { categoryIds: ["thumbnail-cache", "shader-cache", "user-temp"] });
    expect(screen.getByText("Prepared categories come from the Categories preset panel and can include admin-only or optional items.")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Full tree" }));
    await screen.findByRole("heading", { level: 1, name: "Run a full scan to explore directory and file space usage." });
    await user.click(screen.getByRole("tab", { name: "Quick results" }));
    await screen.findByText("Latest prepared scan");

    await user.click(screen.getByRole("button", { name: "Review & Clean" }));
    await screen.findByText("Confirm prepared clean");
    await user.click(screen.getByRole("button", { name: "Confirm Clean" }));

    await screen.findByText(/Freed 191.41 KB/);
    expect(invokeMock).toHaveBeenCalledWith("clean_categories", { categoryIds: ["user-temp", "shader-cache"] });
  });

  it("blocks prepared admin preset execution until elevation flow exists", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Categories" }));
    await screen.findByText("Review category trust notes before adding them to future scan presets.");
    await user.click(screen.getByRole("button", { name: "Review admin set" }));
    await user.click(screen.getByRole("button", { name: "Scan prepared set" }));

    await screen.findByText(/Restart in authorization mode/);
    expect(invokeMock).not.toHaveBeenCalledWith("scan_categories", expect.anything());
    await user.click(screen.getByRole("button", { name: "Authorization mode" }));
    expect(invokeMock).toHaveBeenCalledWith("restart_as_administrator", undefined);
  });

  it("offers authorization mode from the full scan surface", async () => {
    const user = userEvent.setup();
    deferredAuthorization = (() => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((innerResolve) => {
        resolve = innerResolve;
      });
      return { promise, resolve };
    })();
    render(<App />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Full Scan" }));
    await screen.findByText("Authorization mode");
    await user.click(screen.getAllByRole("button", { name: "Authorization mode" })[0]!);
    await screen.findByText("Waiting for Windows confirmation");
    expect(screen.getByText("Approve the Windows prompt to reopen CDriveCleaner with elevated access.")).toBeTruthy();
    expect((screen.getAllByRole("button", { name: "Starting authorization mode..." })[0] as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getAllByRole("button", { name: "Starting authorization mode..." })[0]!);

    expect(invokeMock).toHaveBeenCalledWith("restart_as_administrator", undefined);
    expect(invokeMock.mock.calls.filter(([command]) => command === "restart_as_administrator")).toHaveLength(1);
    deferredAuthorization.resolve(undefined);
  });

  it("shows an error and keeps the folder collapsed when selected-node child loading fails", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation(async (command: string, args?: { categoryIds?: string[]; rootPath?: string; nodePath?: string; paths?: string[] }) => {
      switch (command) {
        case "list_categories":
          return categoryPayload;
        case "get_history":
          return initialHistoryPayload;
        case "get_settings_metadata":
          return settingsMetadataPayload;
        case "get_scheduled_scan_plan":
          return null;
        case "save_scheduled_scan_plan":
          return scheduledScanPlan;
        case "set_scheduled_scan_plan_enabled":
          return { ...scheduledScanPlan, enabled: (args as { enabled: boolean }).enabled };
        case "delete_scheduled_scan_plan":
          return null;
        case "export_scan_report":
          return scanExportArtifact;
        case "export_history":
          return historyExportArtifact;
        case "analyze_elevation": {
          const ids = args?.categoryIds ?? [];
          const requestedAdminCategoryIds = ids.filter((id) => adminCategoryIds.includes(id));
          return {
            isProcessElevated: false,
            requiresElevation: requestedAdminCategoryIds.length > 0,
            adminCategoryIds: requestedAdminCategoryIds,
          };
        }
        case "restart_as_administrator":
          return undefined;
        case "scan_full_tree":
          return fullScanFixture;
        case "expand_full_scan_node":
          throw new Error("backend boom");
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Full Scan" }));
    await screen.findByText("4.00 KB reclaimable");
    await user.click(screen.getAllByRole("button", { name: "Temp/" })[0]!);
    await screen.findByText("Full path: C:\\Temp");
    await user.click(screen.getByRole("button", { name: "Load child paths" }));

    await screen.findByText("Could not load this folder's child paths.");
    expect(screen.queryByRole("button", { name: "Collapse Temp" })).toBeNull();
    expect(screen.queryByRole("button", { name: "cache.bin" })).toBeNull();
  });

  it("ignores stale expand responses after a newer full scan replaces the tree", async () => {
    const user = userEvent.setup();
    const replacementFullScanPayload: FullScanTreeResponse = {
      ...fullScanFixture,
      tree: {
        ...fullScanFixture.tree,
        children: [
          {
            path: "C:\\Logs",
            name: "Logs",
            isDirectory: true,
            sizeBytes: 2048,
            hasChildren: true,
            childrenLoaded: false,
            warnings: [],
            children: [],
          },
        ],
      },
    };

    deferredExpandFullScanNode = (() => {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((innerResolve) => {
        resolve = innerResolve;
      });
      return { promise, resolve };
    })();

    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Full Scan" }));
    await screen.findByText("4.00 KB reclaimable");
    await user.click(screen.getAllByRole("button", { name: "Temp/" })[0]!);
    await screen.findByText("Full path: C:\\Temp");
    await user.click(screen.getByRole("button", { name: "Load child paths" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("expand_full_scan_node", { rootPath: "C:\\", nodePath: "C:\\Temp" });
    });

    useAppState.getState().setLatestFullScan(replacementFullScanPayload);

    deferredExpandFullScanNode.resolve(expandedTempPayload);

    await waitFor(() => {
      expect(useAppState.getState().latestFullScan?.tree.children[0]?.path).toBe("C:\\Logs");
    });
    expect(useAppState.getState().latestFullScan?.tree.children[0]?.children).toEqual([]);
  });

  it("accepts overlapping sibling expand responses within the same full scan session", async () => {
    const user = userEvent.setup();
    const pendingExpands = new Map<string, { promise: Promise<unknown>; resolve: (value: unknown) => void }>();
    const windowsExpandedPayload = {
      path: "C:\\Windows",
      name: "Windows",
      isDirectory: true,
      sizeBytes: 2048,
      hasChildren: true,
      childrenLoaded: true,
      warnings: [],
      children: [
        {
          path: "C:\\Windows\\system32.dll",
          name: "system32.dll",
          isDirectory: false,
          sizeBytes: 1024,
          hasChildren: false,
          childrenLoaded: true,
          warnings: [],
          children: [],
        },
      ],
    };

    invokeMock.mockImplementation(async (command: string, args?: { categoryIds?: string[]; rootPath?: string; nodePath?: string; paths?: string[] }) => {
      switch (command) {
        case "list_categories":
          return categoryPayload;
        case "get_history":
          historyCallCount += 1;
          return initialHistoryPayload;
        case "get_settings_metadata":
          return settingsMetadataPayload;
        case "get_scheduled_scan_plan":
          return null;
        case "save_scheduled_scan_plan":
          return scheduledScanPlan;
        case "set_scheduled_scan_plan_enabled":
          return { ...scheduledScanPlan, enabled: (args as { enabled: boolean }).enabled };
        case "delete_scheduled_scan_plan":
          return null;
        case "export_scan_report":
          return scanExportArtifact;
        case "export_history":
          return historyExportArtifact;
        case "analyze_elevation":
          return {
            isProcessElevated: false,
            requiresElevation: false,
            adminCategoryIds: [],
          };
        case "restart_as_administrator":
          return undefined;
        case "scan_full_tree":
          return {
            ...fullScanFixture,
            tree: {
              ...fullScanFixture.tree,
              children: [
                fullScanFixture.tree.children[0]!,
                {
                  path: "C:\\Windows",
                  name: "Windows",
                  isDirectory: true,
                  sizeBytes: 2048,
                  hasChildren: true,
                  childrenLoaded: false,
                  warnings: [],
                  children: [],
                },
              ],
            },
          };
        case "expand_full_scan_node": {
          const nodePath = args?.nodePath ?? "";
          const deferred = (() => {
            let resolve!: (value: unknown) => void;
            const promise = new Promise<unknown>((innerResolve) => {
              resolve = innerResolve;
            });
            return { promise, resolve };
          })();
          pendingExpands.set(nodePath, deferred);
          return deferred.promise;
        }
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    });

    render(<App />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_categories", undefined));

    await user.click(screen.getByRole("button", { name: "Full Scan" }));
    await screen.findByText("4.00 KB reclaimable");
    const treeButtons = screen.getAllByRole("button", { name: /Temp\/|Windows\// });
    await user.click(treeButtons.find((button) => button.textContent?.includes("Temp/"))!);
    await user.click(treeButtons.find((button) => button.textContent?.includes("Windows/"))!);

    await waitFor(() => {
      expect(pendingExpands.has("C:\\Temp")).toBe(true);
      expect(pendingExpands.has("C:\\Windows")).toBe(true);
    });

    pendingExpands.get("C:\\Temp")!.resolve(expandedTempPayload);
    await waitFor(() => {
      expect(useAppState.getState().latestFullScan?.tree.children[0]?.childrenLoaded).toBe(true);
    });

    pendingExpands.get("C:\\Windows")!.resolve(windowsExpandedPayload);
    await waitFor(() => {
      const windowsNode = useAppState.getState().latestFullScan?.tree.children.find((node) => node.path === "C:\\Windows");
      expect(windowsNode?.childrenLoaded).toBe(true);
      expect(windowsNode?.children[0]?.path).toBe("C:\\Windows\\system32.dll");
    });
  });
});
