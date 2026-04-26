import { describe, it, expect } from "vitest";
import AttendanceMatrixView from "@/components/attendance/AttendanceMatrixView";
import MatrixCell from "@/components/attendance/MatrixCell";
import MatrixLegend from "@/components/attendance/MatrixLegend";
import { useAttendanceMatrix } from "@/hooks/useAttendanceMatrix";

describe("Phase 4 matrix components — module shape", () => {
  it("AttendanceMatrixView is a function component", () => {
    expect(typeof AttendanceMatrixView).toBe("function");
  });
  it("MatrixCell is a function component", () => {
    expect(typeof MatrixCell).toBe("function");
  });
  it("MatrixLegend is a function component", () => {
    expect(typeof MatrixLegend).toBe("function");
  });
  it("useAttendanceMatrix is a hook function", () => {
    expect(typeof useAttendanceMatrix).toBe("function");
  });
});
