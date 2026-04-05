// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CategoryMetadata, FullScanTreeNode, FullScanTreeResponse, ScanResponse } from "../lib/contracts";
import { ResultsPage } from "./ResultsPage";
import uiFixtures from "../test-support/ui-fixtures.json";

const categoryMetadata = uiFixtures.categoryPayload as CategoryMetadata[];
const safeScanResponse = uiFixtures.scanPayload as ScanResponse;
const fullScanResponse = uiFixtures.fullScanPayload as FullScanTreeResponse;
const expandedTempPayload = uiFixtures.expandedTempPayload as FullScanTreeResponse["tree"];

function createExpandedFullScanResponse(): FullScanTreeResponse {
  return {
    ...fullScanResponse,
    tree: {
      ...fullScanResponse.tree,
      children: [expandedTempPayload, fullScanResponse.tree.children[1]!],
    },
  };
}

function createWarningBreakdownResponse(): FullScanTreeResponse {
  const warningTree: FullScanTreeNode = {
    path: "C:\\",
    name: "C:\\",
    isDirectory: true,
    sizeBytes: 4096,
    hasChildren: true,
    childrenLoaded: true,
    warnings: [],
    children: [
      {
        path: "C:\\Logs",
        name: "Logs",
        isDirectory: true,
        sizeBytes: 3072,
        hasChildren: true,
        childrenLoaded: true,
        warnings: [{ code: "PathScanFailed", severity: "Critical", message: "critical" }],
        children: [
          {
            path: "C:\\Logs\\latest.log",
            name: "latest.log",
            isDirectory: false,
            sizeBytes: 2048,
            hasChildren: false,
            childrenLoaded: true,
            warnings: [{ code: "FileInfoAccessDenied", severity: "Attention", message: "attention" }],
            children: [],
          },
          {
            path: "C:\\Logs\\trace.log",
            name: "trace.log",
            isDirectory: false,
            sizeBytes: 1024,
            hasChildren: false,
            childrenLoaded: true,
            warnings: [{ code: "FileInfoAccessDenied", severity: "Info", message: "info" }],
            children: [],
          },
        ],
      },
      {
        path: "C:\\notes.txt",
        name: "notes.txt",
        isDirectory: false,
        sizeBytes: 1024,
        hasChildren: false,
        childrenLoaded: true,
        warnings: [],
        children: [],
      },
    ],
  };

  return {
    rootPath: "C:\\",
    summary: {
      categoryCount: 1,
      totalEstimatedBytes: 4096,
      totalCandidateFiles: 3,
      totalWarnings: 3,
    },
    tree: warningTree,
  };
}

function renderResultsPage(overrides: Partial<Parameters<typeof ResultsPage>[0]> = {}) {
  return render(
    <ResultsPage
      locale="en"
      isProcessElevated={false}
      mode="safe"
      categories={categoryMetadata}
      preparedCategoryIds={["user-temp", "shader-cache"]}
      scanResponse={safeScanResponse}
      fullScanResponse={null}
      fullScanProgress={null}
      fullScanStatus="idle"
      fullScanError={null}
      cleanResponse={null}
      latestDeletePathsResult={null}
      deletePreviewResult={null}
      selectedCategoryId="user-temp"
      selectedFullScanNodePath={null}
      selectedDeletePaths={[]}
      deleteConfirmationVisible={false}
      deleteStatus="idle"
      deleteError={null}
      onToggleDeletePath={() => undefined}
      onRequestDeleteSelection={() => undefined}
      onConfirmDeleteSelection={() => undefined}
      onCancelDeleteSelection={() => undefined}
      onRestartAsAdministrator={() => undefined}
      onSelectCategory={() => undefined}
      onSelectFullScanNode={() => undefined}
      onRequestCleanConfirmation={() => undefined}
      onConfirmClean={() => undefined}
      onCancelClean={() => undefined}
      onSwitchToListResults={() => undefined}
      onSwitchToFullResults={() => undefined}
      onRunFullScan={() => undefined}
      onExpandFullScanNode={async () => undefined}
      listResultsSort="reclaimable"
      onListResultsSortChange={() => undefined}
      onExportScan={() => undefined}
      scanExportStatus="idle"
      scanExportArtifact={null}
      scanExportError={null}
      fullScanQuery=""
      onFullScanQueryChange={() => undefined}
      cleanConfirmationVisible={false}
      cleanStatus="idle"
      cleanError={null}
      actionsDisabled={false}
      authorizationStatus="idle"
      {...overrides}
    />,
  );
}

function resultOrder(): string[] {
  const resultList = document.querySelector(".result-list");
  if (!(resultList instanceof HTMLElement)) {
    throw new Error("expected results list to render");
  }

  return within(resultList).getAllByRole("button").map((button) => button.textContent ?? "");
}

describe("ResultsPage", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sorts list results by reclaimable bytes by default", () => {
    renderResultsPage({ listResultsSort: "reclaimable" });

    const labels = resultOrder();
    expect(labels[0]).toContain("Shader Cache");
    expect(labels[1]).toContain("Thumbnail Cache");
    expect(labels[2]).toContain("User Temp Files");
  });

  it("sorts list results by candidate file count", () => {
    renderResultsPage({ listResultsSort: "files" });

    const labels = resultOrder();
    expect(labels[0]).toContain("Shader Cache");
    expect(labels[1]).toContain("User Temp Files");
    expect(labels[2]).toContain("Thumbnail Cache");
  });

  it("sorts list results by warnings and risk emphasis", () => {
    renderResultsPage({ listResultsSort: "risk" });

    const labels = resultOrder();
    expect(labels[0]).toContain("Shader Cache");
    expect(labels[1]).toContain("Thumbnail Cache");
    expect(labels[2]).toContain("User Temp Files");
  });

  it("emits sort preference changes from the list controls", () => {
    const onListResultsSortChange = vi.fn();
    renderResultsPage({ onListResultsSortChange });

    const sorter = screen.getByLabelText("Sort list");
    fireEvent.click(within(sorter).getByRole("button", { name: "Files" }));

    expect(onListResultsSortChange).toHaveBeenCalledWith("files");
  });

  it("debounces loaded-tree query updates", () => {
    vi.useFakeTimers();
    const onFullScanQueryChange = vi.fn();

    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createExpandedFullScanResponse(),
      onFullScanQueryChange,
    });

    fireEvent.change(screen.getByPlaceholderText("Search loaded tree"), {
      target: { value: "cache" },
    });

    expect(onFullScanQueryChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(onFullScanQueryChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onFullScanQueryChange).toHaveBeenCalledWith("cache");
  });

  it("only emits the latest debounced query when typing continues within the delay", () => {
    vi.useFakeTimers();
    const onFullScanQueryChange = vi.fn();

    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createExpandedFullScanResponse(),
      onFullScanQueryChange,
    });

    const input = screen.getByPlaceholderText("Search loaded tree");
    fireEvent.change(input, { target: { value: "ca" } });
    act(() => {
      vi.advanceTimersByTime(75);
    });
    fireEvent.change(input, { target: { value: "cache" } });
    act(() => {
      vi.advanceTimersByTime(149);
    });

    expect(onFullScanQueryChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onFullScanQueryChange).toHaveBeenCalledTimes(1);
    expect(onFullScanQueryChange).toHaveBeenCalledWith("cache");
  });

  it("shows top-file and top-path previews for the selected full-scan context", () => {
    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createExpandedFullScanResponse(),
      selectedFullScanNodePath: "C:\\Temp",
    });

    expect(screen.getByText("Largest loaded files")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /cache\.bin.*C:\\Temp\\cache\.bin/s }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Largest loaded paths")).toBeTruthy();
    expect(screen.getByText("No loaded descendant paths yet.")).toBeTruthy();
    expect(screen.getByText("This treemap uses only currently loaded child nodes and keeps drill-in inside the existing tree context.")).toBeTruthy();
  });

  it("renders the analysis surface for the selected full-scan context", () => {
    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createExpandedFullScanResponse(),
      selectedFullScanNodePath: "C:\\",
    });

    expect(screen.getByText("Analysis")).toBeTruthy();
    expect(screen.getByText("Treemap")).toBeTruthy();
    expect(screen.getByText("Largest loaded files")).toBeTruthy();
    expect(screen.getByText("Largest loaded paths")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Temp\/ 3\.00 KB 75%/ })).toBeTruthy();
  });

  it("uses preview rows for selection only", () => {
    const onSelectFullScanNode = vi.fn();
    const onToggleDeletePath = vi.fn();

    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createExpandedFullScanResponse(),
      selectedFullScanNodePath: "C:\\Temp",
      onSelectFullScanNode,
      onToggleDeletePath,
    });

    fireEvent.click(screen.getAllByRole("button", { name: /cache\.bin.*C:\\Temp\\cache\.bin/s })[0]!);

    expect(onSelectFullScanNode).toHaveBeenCalledWith("C:\\Temp\\cache.bin");
    expect(onToggleDeletePath).not.toHaveBeenCalled();
  });

  it("uses treemap tiles for selection only", () => {
    const onSelectFullScanNode = vi.fn();
    const onToggleDeletePath = vi.fn();

    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createExpandedFullScanResponse(),
      selectedFullScanNodePath: "C:\\",
      onSelectFullScanNode,
      onToggleDeletePath,
    });

    fireEvent.click(screen.getByRole("button", { name: /Temp\/ 3\.00 KB 75%/ }));

    expect(onSelectFullScanNode).toHaveBeenCalledWith("C:\\Temp");
    expect(onToggleDeletePath).not.toHaveBeenCalled();
  });

  it("shows hover details for the focused treemap tile", () => {
    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createExpandedFullScanResponse(),
      selectedFullScanNodePath: "C:\\",
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Temp\/ 3\.00 KB 75%/ }));

    expect(screen.getByText("Share of loaded children")).toBeTruthy();
    expect(screen.getAllByText("Loaded descendants").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Known lazy branches")).toBeTruthy();
    expect(screen.getByText("Click to focus this path in the existing tree and detail panel.")).toBeTruthy();
    expect(screen.queryByText((_, element) => element?.textContent?.includes("Load them from the detail panel") ?? false)).toBeNull();
    expect(screen.queryByText("Warning breakdown")).toBeNull();
    expect(screen.getAllByText("C:\\Temp").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });

  it("shows warning severity breakdown for treemap tiles with subtree warnings", () => {
    renderResultsPage({
      mode: "full",
      scanResponse: null,
      fullScanResponse: createWarningBreakdownResponse(),
      selectedFullScanNodePath: "C:\\",
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: /Logs\/ 3\.00 KB 75%/ }));

    expect(screen.getByText("Loaded warning breakdown")).toBeTruthy();
    expect(screen.getAllByText("Needs attention").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Informational").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Critical").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Loaded subtree warnings: 3")).toBeTruthy();
  });
});
