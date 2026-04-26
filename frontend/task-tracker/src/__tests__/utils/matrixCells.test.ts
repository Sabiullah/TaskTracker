import { describe, it, expect } from "vitest";
import {
  CELL_LABEL,
  CELL_STYLE,
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
});
