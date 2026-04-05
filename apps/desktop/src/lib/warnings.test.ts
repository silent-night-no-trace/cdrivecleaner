import { describe, expect, it } from "vitest";
import type { CleanupWarning } from "./contracts";
import { groupWarningsBySeverity, sortWarnings } from "./warnings";

const sampleWarnings: CleanupWarning[] = [
  {
    code: "FileInfoAccessDenied",
    severity: "Info",
    message: "Skipped file info for 'C:/locked.bin': Access is denied.",
  },
  {
    code: "FileDeleteAccessDenied",
    severity: "Attention",
    message: "Skipped file 'C:/locked.bin': Access is denied.",
  },
  {
    code: "PathScanFailed",
    severity: "Attention",
    message: "Skipped path 'C:/Games': io error",
  },
];

describe("sortWarnings", () => {
  it("orders by severity before message", () => {
    const sorted = sortWarnings(sampleWarnings);
    expect(sorted[0]?.severity).toBe("Attention");
    expect(sorted[1]?.severity).toBe("Attention");
    expect(sorted[2]?.severity).toBe("Info");
  });
});

describe("groupWarningsBySeverity", () => {
  it("groups warnings by severity in display order", () => {
    const groups = groupWarningsBySeverity(sampleWarnings);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.severity).toBe("Attention");
    expect(groups[0]?.warnings).toHaveLength(2);
    expect(groups[1]?.severity).toBe("Info");
    expect(groups[1]?.warnings).toHaveLength(1);
  });
});
