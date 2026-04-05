// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistoryPage } from "./HistoryPage";

describe("HistoryPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders export status and path feedback", () => {
    render(
      <HistoryPage
        entries={[]}
        locale="en"
        exportStatus="ready"
        exportArtifact={{
          filePath: "C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\history-export-20260330-120000.json",
          fileName: "history-export-20260330-120000.json",
          format: "json",
        }}
        exportError={null}
        onExportHistory={() => undefined}
        actionsDisabled={false}
      />,
    );

    expect(screen.getByText(/Saved to C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner\\exports\\history-export-20260330-120000.json/)).toBeTruthy();
  });

  it("fires history export from the toolbar", () => {
    const onExportHistory = vi.fn();
    render(
      <HistoryPage
        entries={[]}
        locale="en"
        exportStatus="idle"
        exportArtifact={null}
        exportError={null}
        onExportHistory={onExportHistory}
        actionsDisabled={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export History JSON" }));
    expect(onExportHistory).toHaveBeenCalledTimes(1);
  });

  it("shows a badge for scheduled scan history entries", () => {
    render(
      <HistoryPage
        entries={[{
          timestamp: "2026-03-31T08:30:00Z",
          kind: "scan",
          summary: "Scheduled scan (Safe defaults) complete. Categories=3, estimated=1.00 MB, warnings=0",
          origin: "scheduled",
          originLabel: "Safe defaults",
          categoryCount: 3,
          totalEstimatedBytes: 1_048_576,
          totalCandidateFiles: 10,
          totalWarnings: 0,
        }]}
        locale="en"
        exportStatus="idle"
        exportArtifact={null}
        exportError={null}
        onExportHistory={() => undefined}
        actionsDisabled={false}
      />,
    );

    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.getByText(/Scheduled scan complete\./)).toBeTruthy();
  });
});
