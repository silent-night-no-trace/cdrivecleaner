// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WarningGroups } from "./WarningGroups";

describe("WarningGroups", () => {
  it("renders severity-specific group classes and counts", () => {
    const { container } = render(
      <WarningGroups
        locale="en"
        warnings={[
          { code: "FileDeleteAccessDenied", severity: "Attention", message: "Delete skipped." },
          { code: "FileInfoAccessDenied", severity: "Info", message: "Read skipped." },
        ]}
      />,
    );

    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Informational")).toBeTruthy();
    expect(container.querySelector(".warning-group-attention")).toBeTruthy();
    expect(container.querySelector(".warning-group-info")).toBeTruthy();
    expect(screen.getAllByText("1")).toHaveLength(2);
  });
});
