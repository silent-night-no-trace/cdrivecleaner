import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("formats raw bytes into human readable units", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(256000, "en")).toBe("250.00 KB");
    expect(formatBytes(5_242_880, "en")).toBe("5.00 MB");
    expect(formatBytes(3_221_225_472, "en")).toBe("3.00 GB");
  });

  it("uses locale-aware number formatting", () => {
    expect(formatBytes(1_536, "zh")).toBe("1.50 KB");
  });
});
