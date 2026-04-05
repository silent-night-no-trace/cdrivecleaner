// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WarningSummary } from "./WarningSummary";

describe("WarningSummary", () => {
  it("renders severity chips in display order with localized labels", () => {
    render(
      <WarningSummary
        locale="en"
        label="Warning mix"
        warnings={[
          { code: "FileInfoAccessDenied", severity: "Info", message: "Info message." },
          { code: "FileDeleteAccessDenied", severity: "Attention", message: "Attention message." },
          { code: "PathScanFailed", severity: "Critical", message: "Critical message." },
        ]}
      />, 
    );

    expect(screen.getByText("Warning mix")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Informational")).toBeTruthy();
  });

  it("renders nothing when there are no warnings", () => {
    const { container } = render(<WarningSummary locale="en" warnings={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
