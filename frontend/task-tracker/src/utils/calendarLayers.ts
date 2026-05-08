export type CalendarLayers = "both" | "tasks" | "plans";

export const CALENDAR_LAYERS_KEY = "tasktracker.calendar.layers";
const VALID: ReadonlySet<CalendarLayers> = new Set(["both", "tasks", "plans"]);

export function loadLayers(): CalendarLayers {
  try {
    const raw = localStorage.getItem(CALENDAR_LAYERS_KEY);
    if (raw && (VALID as Set<string>).has(raw)) return raw as CalendarLayers;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through.
  }
  return "both";
}

export function saveLayers(v: CalendarLayers): void {
  try {
    localStorage.setItem(CALENDAR_LAYERS_KEY, v);
  } catch {
    // ignore quota / privacy failures
  }
}

export const tasksVisible = (v: CalendarLayers): boolean =>
  v === "both" || v === "tasks";
export const plansVisible = (v: CalendarLayers): boolean =>
  v === "both" || v === "plans";
