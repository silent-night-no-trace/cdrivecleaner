import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { CategoryMetadata, CleanResponse, DeletePathsResponse, FullScanProgress, FullScanTreeResponse, HistoryEntry, ScanResponse } from "../lib/contracts";
import type { Locale } from "../lib/i18n";

export type CategoryFilter = "all" | "safe-defaults" | "admin";
export type ThemePreference = "system" | "light" | "dark";
export type ListResultsMode = "safe" | "prepared";
export type ResultsMode = ListResultsMode | "full";
export type ListResultsSort = "reclaimable" | "files" | "risk";

export const APP_STATE_STORAGE_KEY = "cdrivecleaner-ui-preferences";
export const APP_STATE_STORAGE_VERSION = 3;

const memoryStorage = new Map<string, string>();

interface SyncStateStorage extends StateStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}

interface AppStateData {
  activePage: "home" | "results" | "categories" | "history" | "settings";
  isProcessElevated: boolean;
  locale: Locale;
  themePreference: ThemePreference;
  categoryFilter: CategoryFilter;
  categories: CategoryMetadata[];
  historyEntries: HistoryEntry[];
  latestScan: ScanResponse | null;
  latestFullScan: FullScanTreeResponse | null;
  latestClean: CleanResponse | null;
  latestDeletePathsResult: DeletePathsResponse | null;
  deletePreviewResult: DeletePathsResponse | null;
  fullScanProgress: FullScanProgress | null;
  selectedResultCategoryId: string | null;
  selectedFullScanNodePath: string | null;
  selectedDeletePaths: string[];
  preparedCategoryIds: string[];
  cleanConfirmationVisible: boolean;
  deleteConfirmationVisible: boolean;
  resultsMode: ResultsMode;
  lastListResultsMode: ListResultsMode;
  listResultsSort: ListResultsSort;
  fullScanQuery: string;
  scanStatus: "idle" | "loading" | "ready" | "error";
  fullScanStatus: "idle" | "loading" | "ready" | "error";
  cleanStatus: "idle" | "loading" | "ready" | "error";
  deleteStatus: "idle" | "loading" | "ready" | "error";
  scanError: string | null;
  fullScanError: string | null;
  cleanError: string | null;
  deleteError: string | null;
}

interface AppStateActions {
  setActivePage: (page: AppState["activePage"]) => void;
  setIsProcessElevated: (isProcessElevated: boolean) => void;
  setLocale: (locale: Locale) => void;
  setThemePreference: (themePreference: ThemePreference) => void;
  setCategoryFilter: (filter: CategoryFilter) => void;
  setCategories: (categories: CategoryMetadata[]) => void;
  setHistoryEntries: (entries: HistoryEntry[]) => void;
  setLatestScan: (scan: ScanResponse | null) => void;
  setLatestFullScan: (scan: FullScanTreeResponse | null) => void;
  setLatestClean: (clean: CleanResponse | null) => void;
  setLatestDeletePathsResult: (result: DeletePathsResponse | null) => void;
  setDeletePreviewResult: (result: DeletePathsResponse | null) => void;
  setFullScanProgress: (progress: FullScanProgress | null) => void;
  setSelectedResultCategoryId: (categoryId: string | null) => void;
  setSelectedFullScanNodePath: (path: string | null) => void;
  setSelectedDeletePaths: (paths: string[]) => void;
  toggleSelectedDeletePath: (path: string) => void;
  setPreparedCategoryIds: (categoryIds: string[]) => void;
  togglePreparedCategoryId: (categoryId: string) => void;
  setCleanConfirmationVisible: (visible: boolean) => void;
  setDeleteConfirmationVisible: (visible: boolean) => void;
  setResultsMode: (mode: ResultsMode) => void;
  setLastListResultsMode: (mode: ListResultsMode) => void;
  setListResultsSort: (sort: ListResultsSort) => void;
  setFullScanQuery: (query: string) => void;
  setScanStatus: (status: AppState["scanStatus"]) => void;
  setFullScanStatus: (status: AppState["fullScanStatus"]) => void;
  setCleanStatus: (status: AppState["cleanStatus"]) => void;
  setDeleteStatus: (status: AppState["deleteStatus"]) => void;
  setScanError: (message: string | null) => void;
  setFullScanError: (message: string | null) => void;
  setCleanError: (message: string | null) => void;
  setDeleteError: (message: string | null) => void;
}

export type AppState = AppStateData & AppStateActions;

export interface PersistedAppState {
  locale: Locale;
  themePreference: ThemePreference;
  categoryFilter: CategoryFilter;
  preparedCategoryIds: string[];
  resultsMode: ResultsMode;
  lastListResultsMode: ListResultsMode;
  listResultsSort: ListResultsSort;
}

export interface PersistedAppStateRecord {
  state: PersistedAppState;
  version: number;
}

export const appStateDefaults: AppStateData = {
  activePage: "home",
  isProcessElevated: false,
  locale: "en",
  themePreference: "system",
  categoryFilter: "all",
  categories: [],
  historyEntries: [],
  latestScan: null,
  latestFullScan: null,
  latestClean: null,
  latestDeletePathsResult: null,
  deletePreviewResult: null,
  fullScanProgress: null,
  selectedResultCategoryId: null,
  selectedFullScanNodePath: null,
  selectedDeletePaths: [],
  preparedCategoryIds: [],
  cleanConfirmationVisible: false,
  deleteConfirmationVisible: false,
  resultsMode: "safe",
  lastListResultsMode: "safe",
  listResultsSort: "reclaimable",
  fullScanQuery: "",
  scanStatus: "idle",
  fullScanStatus: "idle",
  cleanStatus: "idle",
  deleteStatus: "idle",
  scanError: null,
  fullScanError: null,
  cleanError: null,
  deleteError: null,
};

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh";
}

function isCategoryFilter(value: unknown): value is CategoryFilter {
  return value === "all" || value === "safe-defaults" || value === "admin";
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isListResultsMode(value: unknown): value is ListResultsMode {
  return value === "safe" || value === "prepared";
}

function isResultsMode(value: unknown): value is ResultsMode {
  return value === "safe" || value === "prepared" || value === "full";
}

function isListResultsSort(value: unknown): value is ListResultsSort {
  return value === "reclaimable" || value === "files" || value === "risk";
}

function normalizePreparedCategoryIds(categoryIds: string[]): string[] {
  return [...new Set(categoryIds.filter((categoryId) => categoryId.length > 0))];
}

function reconcilePreparedCategoryIds(preparedCategoryIds: string[], categories: CategoryMetadata[]): string[] {
  const validCategoryIds = new Set(categories.map((category) => category.id));
  return preparedCategoryIds.filter((categoryId) => validCategoryIds.has(categoryId));
}

function sanitizePersistedResultsModes(state: Partial<PersistedAppState> | undefined): Pick<PersistedAppState, "resultsMode" | "lastListResultsMode"> {
  const fallbackListMode = isListResultsMode(state?.resultsMode) ? state.resultsMode : appStateDefaults.lastListResultsMode;
  const lastListResultsMode = isListResultsMode(state?.lastListResultsMode) ? state.lastListResultsMode : fallbackListMode;
  const resultsMode = isResultsMode(state?.resultsMode) ? state.resultsMode : lastListResultsMode;

  return {
    resultsMode,
    lastListResultsMode,
  };
}

function sanitizePersistedListResultsSort(state: Partial<PersistedAppState> | undefined): ListResultsSort {
  return isListResultsSort(state?.listResultsSort) ? state.listResultsSort : appStateDefaults.listResultsSort;
}

function sanitizePersistedAppState(state: Partial<PersistedAppState> | undefined): PersistedAppState {
  const sanitizedResultsModes = sanitizePersistedResultsModes(state);

  return {
    locale: isLocale(state?.locale) ? state.locale : appStateDefaults.locale,
    themePreference: isThemePreference(state?.themePreference) ? state.themePreference : appStateDefaults.themePreference,
    categoryFilter: isCategoryFilter(state?.categoryFilter) ? state.categoryFilter : appStateDefaults.categoryFilter,
    preparedCategoryIds: Array.isArray(state?.preparedCategoryIds)
      ? normalizePreparedCategoryIds(state.preparedCategoryIds.filter((categoryId): categoryId is string => typeof categoryId === "string"))
      : appStateDefaults.preparedCategoryIds,
    resultsMode: sanitizedResultsModes.resultsMode,
    lastListResultsMode: sanitizedResultsModes.lastListResultsMode,
    listResultsSort: sanitizePersistedListResultsSort(state),
  };
}

function getAppStateStorageBackend(): SyncStateStorage {
  const fallbackStorage: SyncStateStorage = {
    getItem: (name) => memoryStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryStorage.delete(name);
    },
  };

  if (!(typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage)) {
    return fallbackStorage;
  }

  const browserStorage = globalThis.localStorage;

  return {
    getItem: (name) => {
      try {
        return browserStorage.getItem(name);
      } catch {
        return fallbackStorage.getItem(name);
      }
    },
    setItem: (name, value) => {
      try {
        browserStorage.setItem(name, value);
      } catch {
        fallbackStorage.setItem(name, value);
      }
    },
    removeItem: (name) => {
      try {
        browserStorage.removeItem(name);
      } catch {
        fallbackStorage.removeItem(name);
      }
    },
  };
}

export function clearAppStateStorage(): void {
  getAppStateStorageBackend().removeItem(APP_STATE_STORAGE_KEY);
}

export function readAppStateStorage(): PersistedAppStateRecord | null {
  const raw = getAppStateStorageBackend().getItem(APP_STATE_STORAGE_KEY);
  return raw ? JSON.parse(raw) as PersistedAppStateRecord : null;
}

export function writeAppStateStorage(record: PersistedAppStateRecord): void {
  getAppStateStorageBackend().setItem(APP_STATE_STORAGE_KEY, JSON.stringify(record));
}

export function writeRawAppStateStorage(raw: string): void {
  getAppStateStorageBackend().setItem(APP_STATE_STORAGE_KEY, raw);
}

export const useAppState = create<AppState>()(persist((set) => ({
  ...appStateDefaults,
  setActivePage: (page) => set({ activePage: page }),
  setIsProcessElevated: (isProcessElevated) => set({ isProcessElevated }),
  setLocale: (locale) => set({ locale }),
  setThemePreference: (themePreference) => set({ themePreference }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setCategories: (categories) => set((state) => ({
    categories,
    preparedCategoryIds: reconcilePreparedCategoryIds(state.preparedCategoryIds, categories),
  })),
  setHistoryEntries: (historyEntries) => set({ historyEntries }),
  setLatestScan: (latestScan) => set({ latestScan }),
  setLatestFullScan: (latestFullScan) => set({ latestFullScan }),
  setLatestClean: (latestClean) => set({ latestClean }),
  setLatestDeletePathsResult: (latestDeletePathsResult) => set({ latestDeletePathsResult }),
  setDeletePreviewResult: (deletePreviewResult) => set({ deletePreviewResult }),
  setFullScanProgress: (fullScanProgress) => set({ fullScanProgress }),
  setSelectedResultCategoryId: (selectedResultCategoryId) => set({ selectedResultCategoryId }),
  setSelectedFullScanNodePath: (selectedFullScanNodePath) => set({ selectedFullScanNodePath }),
  setSelectedDeletePaths: (selectedDeletePaths) => set({ selectedDeletePaths }),
  toggleSelectedDeletePath: (path) => set((state) => ({
    selectedDeletePaths: state.selectedDeletePaths.includes(path)
      ? state.selectedDeletePaths.filter((item) => item !== path)
      : [...state.selectedDeletePaths, path],
  })),
  setPreparedCategoryIds: (preparedCategoryIds) => set({ preparedCategoryIds: normalizePreparedCategoryIds(preparedCategoryIds) }),
  togglePreparedCategoryId: (categoryId) => set((state) => ({
    preparedCategoryIds: state.preparedCategoryIds.includes(categoryId)
      ? state.preparedCategoryIds.filter((item) => item !== categoryId)
      : normalizePreparedCategoryIds([...state.preparedCategoryIds, categoryId]),
  })),
  setCleanConfirmationVisible: (cleanConfirmationVisible) => set({ cleanConfirmationVisible }),
  setDeleteConfirmationVisible: (deleteConfirmationVisible) => set({ deleteConfirmationVisible }),
  setResultsMode: (resultsMode) => set({ resultsMode }),
  setLastListResultsMode: (lastListResultsMode) => set({ lastListResultsMode }),
  setListResultsSort: (listResultsSort) => set({ listResultsSort }),
  setFullScanQuery: (fullScanQuery) => set({ fullScanQuery }),
  setScanStatus: (scanStatus) => set({ scanStatus }),
  setFullScanStatus: (fullScanStatus) => set({ fullScanStatus }),
  setCleanStatus: (cleanStatus) => set({ cleanStatus }),
  setDeleteStatus: (deleteStatus) => set({ deleteStatus }),
  setScanError: (scanError) => set({ scanError }),
  setFullScanError: (fullScanError) => set({ fullScanError }),
  setCleanError: (cleanError) => set({ cleanError }),
  setDeleteError: (deleteError) => set({ deleteError }),
}), {
  name: APP_STATE_STORAGE_KEY,
  version: APP_STATE_STORAGE_VERSION,
  storage: createJSONStorage(getAppStateStorageBackend),
  partialize: (state): PersistedAppState => ({
    locale: state.locale,
    themePreference: state.themePreference,
    categoryFilter: state.categoryFilter,
    preparedCategoryIds: state.preparedCategoryIds,
    resultsMode: state.resultsMode,
    lastListResultsMode: state.lastListResultsMode,
    listResultsSort: state.listResultsSort,
    // Keep fullScanQuery session-scoped because it only filters currently loaded tree nodes.
  }),
  migrate: (persistedState) => sanitizePersistedAppState(persistedState as Partial<PersistedAppState> | undefined),
  merge: (persistedState, currentState) => ({
    ...currentState,
    ...sanitizePersistedAppState(persistedState as Partial<PersistedAppState> | undefined),
  }),
}));
