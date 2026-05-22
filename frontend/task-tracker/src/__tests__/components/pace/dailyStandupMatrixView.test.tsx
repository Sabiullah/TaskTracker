// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { DailyStandupMatrixView } from "@/components/pace/DailyStandupMatrixView";
import type { MatrixPayload } from "@/hooks/useAttendanceMatrix";

beforeEach(() => cleanup());

const emptyMatrix: MatrixPayload = {
  employees: [],
  dates: [
    { date: "2026-05-01", weekday: "Fri", is_holiday: false, is_override: false, holiday_name: null },
  ],
  cells: {},
};

describe("DailyStandupMatrixView empty state", () => {
  it("shows 'No standup entries this month' when standups is empty", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[]}
        attendanceMatrix={emptyMatrix}
        loading={false}
      />,
    );
    expect(screen.getByText(/No standup entries this month/i)).toBeTruthy();
  });

  it("shows a loading indicator when loading=true and no data yet", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[]}
        attendanceMatrix={null}
        loading={true}
      />,
    );
    expect(screen.getByText(/Loading matrix/i)).toBeTruthy();
  });
});

import type {
  OperationalStandupApprovalDto,
  OperationalStandupDto,
} from "@/types/api";

function makeStandup(
  uid: string,
  full_name: string,
  date: string,
  priorities: string,
  breakthrough_type: "Breakdown" | "Breakthrough" | "" = "",
  approvals: OperationalStandupApprovalDto[] = [],
): OperationalStandupDto {
  return {
    id: 1,
    uid: `s-${uid}-${date}`,
    profile: uid,
    profile_detail: { id: 1, uid, full_name, username: full_name.toLowerCase() },
    standup_date: date,
    breakthrough_type,
    priorities,
    collaboration_need: "",
    remarks: "",
    created_by_detail: null,
    approvals,
    created_at: "",
    updated_at: "",
  };
}

const twoDayMatrix: MatrixPayload = {
  employees: [],
  dates: [
    { date: "2026-05-01", weekday: "Fri", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-02", weekday: "Sat", is_holiday: false, is_override: false, holiday_name: null },
  ],
  cells: {},
};

describe("DailyStandupMatrixView rows", () => {
  it("renders one row per unique submitted employee, sorted alphabetically", () => {
    const standups = [
      makeStandup("u-bob", "Bob", "2026-05-01", "Bob priorities"),
      makeStandup("u-alice", "Alice", "2026-05-01", "Alice priorities"),
      makeStandup("u-alice", "Alice", "2026-05-02", "Alice day 2"),
    ];
    const { container } = render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={standups}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0]!.textContent).toContain("Alice");
    expect(bodyRows[1]!.textContent).toContain("Bob");
  });

  it("renders the full priorities text wrapped (white-space: pre-wrap)", () => {
    const longText = "1. First task\n2. Second task that is a bit longer\n3. Third";
    const { container } = render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[makeStandup("u1", "Alice", "2026-05-01", longText)]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const cellWithText = [...container.querySelectorAll("td")].find(
      (td) => td.textContent === longText,
    );
    expect(cellWithText).toBeTruthy();
    expect(getComputedStyle(cellWithText!).whiteSpace).toBe("pre-wrap");
  });

  it("renders a BT chip for Breakthrough entries and BD for Breakdowns", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[
          makeStandup("u1", "Alice", "2026-05-01", "p", "Breakthrough"),
          makeStandup("u2", "Bob", "2026-05-01", "p", "Breakdown"),
        ]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    expect(screen.getByText("BT")).toBeTruthy();
    expect(screen.getByText("BD")).toBeTruthy();
  });

  it("does not render a type chip when breakthrough_type is empty", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[makeStandup("u1", "Alice", "2026-05-01", "p", "")]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    expect(screen.queryByText("BT")).toBeNull();
    expect(screen.queryByText("BD")).toBeNull();
  });
});

const fiveDayMatrix: MatrixPayload = {
  employees: [],
  dates: [
    { date: "2026-05-04", weekday: "Mon", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-05", weekday: "Tue", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-06", weekday: "Wed", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-07", weekday: "Thu", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-08", weekday: "Fri", is_holiday: false, is_override: false, holiday_name: null },
  ],
  cells: {
    u1: {
      "2026-05-05": { code: "L" },
      "2026-05-06": { code: "WFH" },
      "2026-05-07": { code: "HD", holiday_name: "Founders Day" },
      // 2026-05-08 left unset → should fall back to dash
    },
  },
};

describe("DailyStandupMatrixView fallback cells", () => {
  it("renders Leave / WFH / Holiday-name / dash for non-submission cells", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[makeStandup("u1", "Alice", "2026-05-04", "Alice priorities")]}
        attendanceMatrix={fiveDayMatrix}
        loading={false}
      />,
    );
    expect(screen.getByText("Leave")).toBeTruthy();
    expect(screen.getByText("WFH")).toBeTruthy();
    expect(screen.getByText("Founders Day")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

function ap(status: "Pending" | "Approved"): OperationalStandupApprovalDto {
  return {
    uid: `ap-${status}-${Math.random()}`,
    org_uid: "o1",
    org_name: "Org",
    status,
    approved_by_detail: null,
    approved_at: null,
    reviewed_by_detail: null,
    reviewed_at: null,
  };
}

describe("DailyStandupMatrixView approval tint", () => {
  it("applies green left border when all approvals are Approved", () => {
    const { container } = render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[
          makeStandup("u1", "Alice", "2026-05-01", "All approved", "", [
            ap("Approved"),
            ap("Approved"),
          ]),
        ]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const cellWithText = [...container.querySelectorAll("td")].find(
      (n) => n.textContent === "All approved",
    );
    expect(cellWithText).toBeTruthy();
    expect(cellWithText!.style.borderLeftColor).toBe("rgb(22, 163, 74)");
  });

  it("applies amber left border when any approval is Pending", () => {
    const { container } = render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[
          makeStandup("u1", "Alice", "2026-05-01", "Any pending", "", [
            ap("Approved"),
            ap("Pending"),
          ]),
        ]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const cellWithText = [...container.querySelectorAll("td")].find(
      (n) => n.textContent === "Any pending",
    );
    expect(cellWithText!.style.borderLeftColor).toBe("rgb(217, 119, 6)");
  });
});
