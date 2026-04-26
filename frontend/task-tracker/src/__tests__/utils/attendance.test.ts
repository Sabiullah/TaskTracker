import { describe, expect, it } from "vitest";
import {
  packAttendanceForServer,
  unpackAttendanceFromServer,
  STATUSES,
} from "@/utils/attendance";

describe("STATUSES", () => {
  it("does not contain 'WFH' (status and work_location are now orthogonal)", () => {
    expect(STATUSES).toEqual(["Present", "Absent", "Half Day", "Leave"]);
  });
});

describe("packAttendanceForServer", () => {
  it("passes the row through unchanged (pack is now a no-op)", () => {
    const domain = {
      date: "2026-04-17",
      status: "Present",
      work_location: "WFH",
      login_time: "09:00",
      logout_time: "17:00",
    };
    expect(packAttendanceForServer(domain)).toEqual(domain);
  });

  it("does not mutate the input", () => {
    const original = {
      date: "2026-04-17",
      status: "Half Day",
      work_location: "Office",
    };
    const snapshot = { ...original };
    packAttendanceForServer(original);
    expect(original).toEqual(snapshot);
  });
});

describe("unpackAttendanceFromServer", () => {
  it("passes the row through unchanged (unpack is now a no-op)", () => {
    const dto = {
      date: "2026-04-17",
      status: "Present",
      work_location: "WFH",
      login_time: "09:00",
    };
    expect(unpackAttendanceFromServer(dto)).toEqual(dto);
  });
});
