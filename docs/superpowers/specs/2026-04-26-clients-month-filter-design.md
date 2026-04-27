# Clients — Month Filter for Roadmap & MOM (Design)

**Status:** Approved
**Date:** 2026-04-26
**Branch:** `Client_MonthFilter`

## Problem

The Clients screen shows two tabs that drive client delivery planning:

- **Road Map** (`ClientRoadmapTab`) — roadmap items grouped by client, each with a `target_date`.
- **MOM & Action Points** (`ClientMOMTab` → `ClientMOMAllView` / `ClientMOMSingleView`) — meetings grouped by client, each containing action points with their own `target_date`.

Today there is no way to ask "what is deliverable in a given month?" To plan deliverables earlier, users need to pinpoint the items whose target falls in a chosen calendar month, on both tabs.

## Goal

Add a month filter to both the Road Map and MOM tabs, working off `target_date`, so users can see what they need to deliver in any selected month.

## Decisions (locked in during brainstorming)

| # | Decision |
|---|----------|
| 1 | On MOM, "Target date" means **action point `target_date`** (not meeting date or next-meeting date). |
| 2 | UI control is a single **`<input type="month">`** (native month-year picker). |
| 3 | Default value is **empty / no filter** — user picks a month when needed. |
| 4 | Items with **no `target_date` always show**, regardless of the selected month. |
| 5 | When a meeting is shown because of a matching action point, the expanded action point table shows **only matching action points** (plus those with no target date, per #4). |
| 6 | The month picker is **per-tab and independent** — each tab keeps its own state; switching tabs does not sync. |

## Approach

Client-side filtering only. Both `useClientRoadmap` and `useClientMeetings` already fetch all rows once and filter in memory; the new month filter slots into that pipeline. No backend changes, no refetches when the month changes, consistent with existing tab patterns.

Server-side filtering via `?target_month=YYYY-MM` was considered and rejected: it adds Django changes, refetch latency on every month switch, and makes the "items without `target_date` always show" rule awkward to express on the server.

## UI

### `ClientRoadmapTab.tsx`
Add a `<input type="month">` labeled **"Target month"** in the existing filter row, after the Status / Priority / Owner multi-selects and before the "Overdue only" checkbox. State: `const [targetMonth, setTargetMonth] = useState<string>("")` — value is `"YYYY-MM"` or `""`.

### `ClientMOMAllView.tsx` and `ClientMOMSingleView.tsx`
Add the same `<input type="month">` labeled **"AP target month"** above the existing content. In All view it sits directly above the client groups list. In Single view it sits **above the two-column grid** (above both the meeting list and the right-side meeting panel) so it's clearly scoped to the whole tab. Each component owns its own independent state — no cross-tab sync.

## Filter semantics

A new shared helper lives in `frontend/task-tracker/src/components/clients/monthFilter.ts`:

```ts
/**
 * True when the given ISO-date string falls in the selected YYYY-MM month.
 * Empty filter (`month === ""`) and null dates both return true so unplanned
 * items remain visible regardless of the active month.
 */
export function matchesMonth(dateStr: string | null, month: string): boolean {
  if (month === "") return true;
  if (dateStr === null) return true;
  return dateStr.startsWith(month);
}
```

### Roadmap
Add a `matchesMonth(r.target_date, targetMonth)` check inside the existing `filtered` `useMemo` in `ClientRoadmapTab.tsx`, after the other filters. The existing client grouping and per-client counts then automatically reflect the filtered set.

### MOM (both views)
For each meeting, compute:

```ts
const visibleActionPoints = m.action_points.filter(ap =>
  matchesMonth(ap.target_date, targetMonth)
);
```

A meeting is **shown** if `targetMonth === ""` OR `visibleActionPoints.length > 0`.

When a meeting is rendered:
- The action point table receives `visibleActionPoints` rather than `m.action_points`.
- The `# AP` column shows the visible count, with the total when filtered (e.g. `2 of 5`); when `targetMonth === ""` it renders the plain count.

In `ClientMOMAllView.tsx` the per-client meeting badge ("(N meetings)") reflects the filtered meeting count.

In `ClientMOMSingleView.tsx` the same logic gates the left-hand meeting list and the right-hand selected meeting's action point table.

## Components touched

- `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx` — add state, filter helper call, UI element.
- `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` — add state, filter logic, pass filtered APs into `ClientActionPointsTable`, update count display.
- `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` — same as above for the single-client layout.
- `frontend/task-tracker/src/components/clients/monthFilter.ts` — new shared helper module.

## Edge cases

- **Year boundary** — `"2026-12"` correctly excludes any `"2027-01-…"` date because the comparison is a literal `startsWith` on a `YYYY-MM` prefix.
- **Empty month string** — short-circuits the filter; everything passes.
- **Null target dates** — always pass (per decision #4 and #5).
- **CSV export (Roadmap)** — already iterates `filtered`, so it inherits the month filter automatically with no extra code.

## Out of scope

- Server-side `?target_month=` query support.
- Cross-tab month syncing.
- Persisting the chosen month across page reloads.
- Filtering by `start_date`, `expected_date`, or `completion_date`.
- Range / quarter pickers.

## Testing

- **Unit tests** for `matchesMonth`: empty filter, null date, exact match, non-match, year-boundary (`"2026-12"` vs `"2027-01-01"`).
- **Manual verification** (component-level testing isn't established for these tabs):
  - Roadmap: pick a month, confirm only rows with `target_date` in that month (plus nulls) remain; clear, confirm all return.
  - MOM (All view): pick a month, confirm meetings without matching APs disappear, expanded meetings show only matching APs, `# AP` column shows `X of Y`.
  - MOM (Single view): pick a month, confirm the left-side meeting list and right-side AP table both filter consistently.
  - CSV export: confirm the exported rows match the on-screen filtered set.
