// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows loading placeholders while settings metadata is loading", () => {
    render(
      <SettingsPage
        locale="en"
        themePreference="system"
        metadata={null}
        metadataStatus="loading"
        scheduledScanPlan={null}
        scheduledScanStatus="ready"
        scheduledScanError={null}
        currentPreparedCategoryIds={[]}
        onLocaleChange={() => undefined}
        onThemeChange={() => undefined}
        onSaveScheduledScanPlan={() => undefined}
        onSetScheduledScanEnabled={() => undefined}
        onDeleteScheduledScanPlan={() => undefined}
      />,
    );

    expect(screen.getByText("Version")).toBeTruthy();
    expect(screen.getAllByText("Loading...").length).toBeGreaterThanOrEqual(2);
  });

  it("shows unavailable placeholders when metadata fetch fails", () => {
    render(
      <SettingsPage
        locale="en"
        themePreference="dark"
        metadata={null}
        metadataStatus="error"
        scheduledScanPlan={null}
        scheduledScanStatus="error"
        scheduledScanError={null}
        currentPreparedCategoryIds={[]}
        onLocaleChange={() => undefined}
        onThemeChange={() => undefined}
        onSaveScheduledScanPlan={() => undefined}
        onSetScheduledScanEnabled={() => undefined}
        onDeleteScheduledScanPlan={() => undefined}
      />,
    );

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
  });

  it("renders version and log location values when metadata is ready", () => {
    render(
      <SettingsPage
        locale="en"
        themePreference="light"
        metadata={{
          appVersion: "0.1.0",
          logDirectory: "C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner",
        }}
        metadataStatus="ready"
        scheduledScanPlan={null}
        scheduledScanStatus="ready"
        scheduledScanError={null}
        currentPreparedCategoryIds={[]}
        onLocaleChange={() => undefined}
        onThemeChange={() => undefined}
        onSaveScheduledScanPlan={() => undefined}
        onSetScheduledScanEnabled={() => undefined}
        onDeleteScheduledScanPlan={() => undefined}
      />,
    );

    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("C:\\Users\\Tester\\AppData\\Local\\CDriveCleaner")).toBeTruthy();
  });

  it("creates a safe-default scheduled scan plan from settings", () => {
    const onSaveScheduledScanPlan = vi.fn();

    render(
      <SettingsPage
        locale="en"
        themePreference="light"
        metadata={null}
        metadataStatus="ready"
        scheduledScanPlan={null}
        scheduledScanStatus="ready"
        scheduledScanError={null}
        currentPreparedCategoryIds={[]}
        onLocaleChange={() => undefined}
        onThemeChange={() => undefined}
        onSaveScheduledScanPlan={onSaveScheduledScanPlan}
        onSetScheduledScanEnabled={() => undefined}
        onDeleteScheduledScanPlan={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Daily time"), { target: { value: "09:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    expect(onSaveScheduledScanPlan).toHaveBeenCalledWith({
      mode: "safeDefaults",
      scheduledTime: "09:15",
      enabled: true,
      capturedCategoryIds: [],
    });
  });

  it("disables prepared scheduled plan creation when no prepared preset exists", () => {
    render(
      <SettingsPage
        locale="en"
        themePreference="light"
        metadata={null}
        metadataStatus="ready"
        scheduledScanPlan={null}
        scheduledScanStatus="ready"
        scheduledScanError={null}
        currentPreparedCategoryIds={[]}
        onLocaleChange={() => undefined}
        onThemeChange={() => undefined}
        onSaveScheduledScanPlan={() => undefined}
        onSetScheduledScanEnabled={() => undefined}
        onDeleteScheduledScanPlan={() => undefined}
      />,
    );

    expect((screen.getByRole("button", { name: "Prepared preset (0)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows scheduled scan status and last run summary", () => {
    render(
      <SettingsPage
        locale="en"
        themePreference="light"
        metadata={null}
        metadataStatus="ready"
        scheduledScanPlan={{
          id: "daily-safe-scan",
          mode: "safeDefaults",
          scheduledTime: "08:30",
          enabled: true,
          capturedCategoryIds: [],
          requiresAdmin: false,
          nextRunAt: "2026-04-01T08:30:00Z",
          lastRunAt: "2026-03-31T08:30:00Z",
          lastRunSummary: "Scheduled scan (Safe defaults) complete. Categories=3, estimated=1.00 MB, warnings=0",
          lastRunCategoryCount: 3,
          lastRunEstimatedBytes: 1_048_576,
          lastRunWarnings: 0,
        }}
        scheduledScanStatus="ready"
        scheduledScanError={null}
        currentPreparedCategoryIds={[]}
        onLocaleChange={() => undefined}
        onThemeChange={() => undefined}
        onSaveScheduledScanPlan={() => undefined}
        onSetScheduledScanEnabled={() => undefined}
        onDeleteScheduledScanPlan={() => undefined}
      />,
    );

    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("Last result")).toBeTruthy();
    expect(screen.getByText(/Scheduled scan complete\./)).toBeTruthy();
    expect(screen.getByText(/1\.00 MB/)).toBeTruthy();
  });
});
