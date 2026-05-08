// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  CALENDAR_LAYERS_KEY,
  loadLayers,
  saveLayers,
  tasksVisible,
  plansVisible,
  type CalendarLayers,
} from "@/utils/calendarLayers";

describe("calendarLayers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 'both' when nothing is stored", () => {
    expect(loadLayers()).toBe("both");
  });

  it("ignores invalid stored values and returns the default", () => {
    localStorage.setItem(CALENDAR_LAYERS_KEY, "garbage");
    expect(loadLayers()).toBe("both");
  });

  it("round-trips a valid value via saveLayers/loadLayers", () => {
    saveLayers("plans");
    expect(loadLayers()).toBe("plans");
    saveLayers("tasks");
    expect(loadLayers()).toBe("tasks");
  });

  it("computes tasksVisible/plansVisible correctly", () => {
    const cases: Array<[CalendarLayers, boolean, boolean]> = [
      ["both", true, true],
      ["tasks", true, false],
      ["plans", false, true],
    ];
    for (const [v, t, p] of cases) {
      expect(tasksVisible(v)).toBe(t);
      expect(plansVisible(v)).toBe(p);
    }
  });
});
