import { describe, it, expect } from "vitest";
import {
  CELL_LABEL,
  CELL_STYLE,
  formatTotal,
  tooltipFor,
  totalsFor,
  type CellCode,
  type CellPayload,
} from "@/utils/matrixCells";

const ALL_CODES: CellCode[] = [
  "P", "H", "A", "L", "L½", "L½+H", "WFH", "WP", "HW", "?", "HD",
];

describe("CELL_STYLE", () => {
  it("has an entry for every code", () => {
    for (const code of ALL_CODES) {
      expect(CELL_STYLE[code]).toBeTruthy();
      expect(CELL_STYLE[code].bg).toMatch(/^#[0-9a-f]{3,6}$/i);
      expect(CELL_STYLE[code].color).toMatch(/^#[0-9a-f]{3,6}$/i);
    }
  });

  it("uses outlines (not solid fill) for needs-attention codes WP and ?", () => {
    expect(CELL_STYLE.WP.outline).toBeTruthy();
    expect(CELL_STYLE["?"].outline).toBeTruthy();
  });

  it("does NOT use outlines for solid-fill codes", () => {
    expect(CELL_STYLE.P.outline).toBeUndefined();
    expect(CELL_STYLE.A.outline).toBeUndefined();
    expect(CELL_STYLE.HD.outline).toBeUndefined();
  });
});

describe("CELL_LABEL", () => {
  it("has a label for every code", () => {
    for (const code of ALL_CODES) {
      expect(CELL_LABEL[code]).toBeTruthy();
      expect(typeof CELL_LABEL[code]).toBe("string");
    }
  });
});

describe("tooltipFor", () => {
  it("includes date, times, location, approval, and holiday name when present", () => {
    const c: CellPayload = {
      code: "WFH",
      login: "09:00",
      logout: "18:00",
      location: "WFH",
      approval: "Approved",
    };
    expect(tooltipFor("23 Apr 2026", c)).toBe(
      "23 Apr 2026 · 09:00 – 18:00 · WFH · Approved",
    );
  });

  it("falls back to just the date when no other fields are populated", () => {
    expect(tooltipFor("23 Apr 2026", { code: "A" })).toBe("23 Apr 2026");
  });

  it("renders an em-dash for missing time half", () => {
    expect(
      tooltipFor("23 Apr 2026", { code: "?", login: "09:00", logout: null }),
    ).toBe("23 Apr 2026 · 09:00 – —");
  });

  it("includes the holiday name on HD/HW cells", () => {
    expect(
      tooltipFor("26 Apr 2026", { code: "HD", holiday_name: "Sunday" }),
    ).toBe("26 Apr 2026 · Sunday");
  });

  it("skips null/empty location/approval fields", () => {
    expect(
      tooltipFor("23 Apr 2026", {
        code: "P",
        login: "09:00",
        logout: "18:00",
        location: null,
        approval: null,
      }),
    ).toBe("23 Apr 2026 · 09:00 – 18:00");
  });
});

describe("totalsFor", () => {
  it("counts each code once per cell", () => {
    const cells: Record<string, CellPayload> = {
      "2026-04-01": { code: "P" },
      "2026-04-02": { code: "P" },
      "2026-04-03": { code: "WFH" },
      "2026-04-04": { code: "L" },
      "2026-04-05": { code: "?" },
      "2026-04-06": { code: "HD" },
      "2026-04-07": { code: "P" },
    };
    const t = totalsFor(cells);
    expect(t.P).toBe(3);
    expect(t.WFH).toBe(1);
    expect(t.L).toBe(1);
    expect(t["?"]).toBe(1);
    expect(t.HD).toBe(1);
    expect(t.A).toBe(0);
    expect(t.H).toBe(0);
  });

  it("returns all-zero totals for an empty cells object", () => {
    const t = totalsFor({});
    for (const code of ALL_CODES) {
      expect(t[code]).toBe(0);
    }
  });

  it("rolls L½ and L½+H into the L bucket as 0.5 each (day-of-leave semantics)", () => {
    const cells: Record<string, CellPayload> = {
      "2026-05-27": { code: "L½" },     // half-day leave
      "2026-05-28": { code: "L" },      // full leave
      "2026-05-29": { code: "L" },      // full leave
      "2026-05-30": { code: "L½+H" },   // half leave + half worked
    };
    const t = totalsFor(cells);
    expect(t.L).toBe(3); // 0.5 + 1 + 1 + 0.5
    // L½+H is half worked, so its worked half lands in Present. L½ (other
    // half not worked) credits no Present.
    expect(t.P).toBe(0.5);
    // Individual buckets still carry their own cell counts so the row can
    // distinguish "two half-days" from "one full".
    expect(t["L½"]).toBe(1);
    expect(t["L½+H"]).toBe(1);
  });

  it("splits H (half day worked) into 0.5 P and 0.5 L, keeping the H bucket", () => {
    const cells: Record<string, CellPayload> = {
      "2026-05-01": { code: "P" },
      "2026-05-02": { code: "H" },
      "2026-05-03": { code: "H" },
    };
    const t = totalsFor(cells);
    expect(t.H).toBe(2); // bucket still counts the half-day cells
    expect(t.P).toBe(2); // 1 full + 0.5 + 0.5
    expect(t.L).toBe(1); // 0.5 + 0.5
  });
});

describe("formatTotal", () => {
  it("prints whole numbers without a decimal", () => {
    expect(formatTotal(0)).toBe("0");
    expect(formatTotal(17)).toBe("17");
  });

  it("prints halves with a single decimal place", () => {
    expect(formatTotal(2.5)).toBe("2.5");
    expect(formatTotal(0.5)).toBe("0.5");
  });
});
