import { describe, expect, it } from "vitest";
import { decimalToHours, hoursToDecimal } from "@/utils/hours";

describe("hoursToDecimal", () => {
  it("converts H:MM to two-decimal string", () => {
    expect(hoursToDecimal("3:30")).toBe("3.50");
    expect(hoursToDecimal("0:15")).toBe("0.25");
    expect(hoursToDecimal("1:00")).toBe("1.00");
    expect(hoursToDecimal("24:00")).toBe("24.00");
  });

  it("handles single-digit hours", () => {
    expect(hoursToDecimal("7:45")).toBe("7.75");
    expect(hoursToDecimal("2:00")).toBe("2.00");
  });

  it("returns 0.00 for empty or null input", () => {
    expect(hoursToDecimal("")).toBe("0.00");
    expect(hoursToDecimal(null)).toBe("0.00");
    expect(hoursToDecimal(undefined)).toBe("0.00");
  });

  it("returns 0.00 for malformed input", () => {
    expect(hoursToDecimal("not-a-time")).toBe("0.00");
    expect(hoursToDecimal("3:90")).toBe("0.00");
  });
});

describe("decimalToHours", () => {
  it("converts a decimal string to H:MM", () => {
    expect(decimalToHours("3.50")).toBe("3:30");
    expect(decimalToHours("0.25")).toBe("0:15");
    expect(decimalToHours("1.00")).toBe("1:00");
    expect(decimalToHours("24.00")).toBe("24:00");
  });

  it("accepts a number input as well as a string", () => {
    expect(decimalToHours(3.5)).toBe("3:30");
    expect(decimalToHours(7.75)).toBe("7:45");
    expect(decimalToHours(0)).toBe("0:00");
  });

  it("rounds to the nearest minute", () => {
    // 0.126 h = 7.56 min → rounds to 8 min → "0:08"
    expect(decimalToHours("0.126")).toBe("0:08");
    // 1.01 h = 60.6 min → rounds to 61 → "1:01"
    expect(decimalToHours("1.01")).toBe("1:01");
  });

  it("returns an empty string for null / undefined / blank", () => {
    expect(decimalToHours(null)).toBe("");
    expect(decimalToHours(undefined)).toBe("");
    expect(decimalToHours("")).toBe("");
  });

  it("returns an empty string for non-numeric input", () => {
    expect(decimalToHours("abc")).toBe("");
    expect(decimalToHours(Number.NaN)).toBe("");
  });
});

describe("round-trip H:MM ↔ decimal", () => {
  const cases = ["0:00", "0:15", "1:00", "3:30", "7:45", "12:00", "23:59"];
  it.each(cases)("preserves %s through both directions", (hhmm) => {
    expect(decimalToHours(hoursToDecimal(hhmm))).toBe(hhmm);
  });
});
