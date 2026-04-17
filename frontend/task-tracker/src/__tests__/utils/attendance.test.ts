import { describe, expect, it } from "vitest";
import {
  packAttendanceForServer,
  unpackAttendanceFromServer,
} from "@/utils/attendance";

describe("packAttendanceForServer", () => {
  it("splits WFH status into Present + work_location=WFH", () => {
    const domain = {
      date: "2026-04-17",
      status: "WFH",
      work_location: "Office",
      login_time: "09:00",
      logout_time: "17:00",
    };

    expect(packAttendanceForServer(domain)).toEqual({
      date: "2026-04-17",
      status: "Present",
      work_location: "WFH",
      login_time: "09:00",
      logout_time: "17:00",
    });
  });

  it("passes non-WFH statuses through unchanged", () => {
    const domain = {
      date: "2026-04-17",
      status: "Present",
      work_location: "Office",
    };

    expect(packAttendanceForServer(domain)).toEqual(domain);
  });

  it("does not mutate the input row", () => {
    const original = {
      date: "2026-04-17",
      status: "WFH",
      work_location: "Office",
    };
    const snapshot = { ...original };

    packAttendanceForServer(original);

    expect(original).toEqual(snapshot);
  });

  it("handles null work_location", () => {
    const domain = {
      date: "2026-04-17",
      status: "WFH",
      work_location: null,
    };

    expect(packAttendanceForServer(domain)).toEqual({
      date: "2026-04-17",
      status: "Present",
      work_location: "WFH",
    });
  });
});

describe("unpackAttendanceFromServer", () => {
  it("projects Present + WFH location back to status=WFH", () => {
    const dto = {
      date: "2026-04-17",
      status: "Present",
      work_location: "WFH",
      login_time: "09:00",
    };

    expect(unpackAttendanceFromServer(dto)).toEqual({
      date: "2026-04-17",
      status: "WFH",
      work_location: "WFH",
      login_time: "09:00",
    });
  });

  it("leaves Present + non-WFH location alone", () => {
    const dto = {
      date: "2026-04-17",
      status: "Present",
      work_location: "Office",
    };

    expect(unpackAttendanceFromServer(dto)).toEqual(dto);
  });

  it("leaves Absent / Leave / Half Day rows alone even if work_location=WFH", () => {
    const absent = {
      date: "2026-04-17",
      status: "Absent",
      work_location: "WFH",
    };
    expect(unpackAttendanceFromServer(absent)).toEqual(absent);
  });
});

describe("pack / unpack round trip", () => {
  it("restores the original status after wire round trip", () => {
    const domain = {
      date: "2026-04-17",
      status: "WFH",
      work_location: "Office",
      remarks: "",
    };

    const afterRoundTrip = unpackAttendanceFromServer(
      packAttendanceForServer(domain),
    );

    expect(afterRoundTrip.status).toBe("WFH");
  });

  it("normalises work_location to 'WFH' after round trip for WFH rows", () => {
    const domain = {
      date: "2026-04-17",
      status: "WFH",
      work_location: "Office",
    };

    // Packing rewrites work_location to "WFH"; unpacking leaves it there.
    // This is a deliberate side-effect — a WFH day is stored with
    // `work_location: "WFH"` server-side.
    const afterRoundTrip = unpackAttendanceFromServer(
      packAttendanceForServer(domain),
    );

    expect(afterRoundTrip.work_location).toBe("WFH");
  });
});
