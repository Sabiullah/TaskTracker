# Floating Day Priority Widget — Design

**Date:** 2026-05-15
**Status:** Approved (design phase)
**Branch:** Popup_DailyPlan

## Problem

The signed-in user's "Day Priority" — the Priorities text from their current-day Daily Standup row in PACE — is only visible by navigating to PACE → Daily Standup and scrolling to their own row. Users want quick read-only access from any screen.

## Goal

A floating icon, persistent on every screen, that expands into a small read-only panel showing the logged-in user's priorities for today. Click to expand, click again (or click outside / Escape) to collapse. Drag and resize supported.

## Non-goals (v1)

- Editing from the popup — explicit view-only requirement.
- Showing entries for other days.
- Mobile/touch drag (mouse-only; can be added later).
- Notifications or attention badges beyond a single status dot.
- A separate backend endpoint — reuse the existing roster endpoint.

## High-level approach

Add a new `FloatingDayPriority` component to the existing floating-widget stack in `App.tsx` (alongside `FloatingChat` and `StickyNotes`). Data comes from the existing `GET /operational_standups/roster/?date=<today>` endpoint, filtered client-side to the logged-in user's row. Live updates come from the existing `pace-operational-standups` WebSocket channel.

No backend changes.

## Components

### `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`

New React component. Props:

```ts
interface FloatingDayPriorityProps {
  profile: Profile | null;
  onNavigateToPace: () => void;
}
```

Responsibilities:
- Render the collapsed icon (button) and the expanded panel.
- Drive open/close state, drag position, and resize size.
- Persist `{ x, y, width, height }` to `localStorage` keyed by user id.
- Call `onNavigateToPace()` from the empty-state link.

Lazy-loaded in `App.tsx` the same way `FloatingChat` and `StickyNotes` are.

### `frontend/task-tracker/src/hooks/useMyTodayStandup.ts`

New hook. Signature:

```ts
function useMyTodayStandup(profileId: string | null): {
  entry: OperationalStandupDto | null;
  loading: boolean;
  refresh: () => void;
};
```

Behavior:
1. On mount and when `profileId` changes, fetch `GET /operational_standups/roster/?date=<todayISO>`.
2. Filter to rows where `row.profile.uid === profileId`. If multiple rows (multi-org user), pick the highest-scored row using the same `rosterScore` logic in `DailyStandupPage.tsx:58-62` (Approved > any entry > placeholder).
3. Return that row's `entry` (which may be `null` if not yet submitted).
4. Subscribe to WS channel `pace-operational-standups`; any message bumps an internal refresh key, forcing a re-fetch (mirrors `useOperationalStandups.ts:61-66`).
5. `refresh()` bumps the same key for explicit re-fetch.
6. When `profileId` is falsy, return `{ entry: null, loading: false, refresh: noop }` immediately.

### `App.tsx` change

Add inside the existing `<Suspense fallback={null}>` block (line ~569-582), next to `FloatingChat` and `StickyNotes`:

```tsx
{user && (
  <FloatingDayPriority
    profile={profile}
    onNavigateToPace={() => setView("pace")}
  />
)}
```

Add the lazy import next to the other floating-widget lazy imports:

```tsx
const FloatingDayPriority = lazy(() => import("./pages/FloatingDayPriority"));
```

## Visual & Interaction

### Collapsed icon

- `position: fixed; bottom: 148; right: 24; z-index: 1000`
  (Above `FloatingChat` button at `bottom: 86` and `StickyNotes` button at `bottom: 24`.)
- Circular button, ~48px diameter, matching the size and shadow of the existing floating buttons.
- Icon: 📋 (clipboard) to match the Daily Standup page title.
- Tooltip on hover: `My priorities today`.
- Small status dot at the top-right of the button (~8px):
  - Green if `entry.status === "Approved"`
  - Amber if `entry.status === "Pending"`
  - Grey if `entry === null` (not submitted today)

### Expanded panel

- Initial position when first opened: `position: fixed; bottom: 200; right: 24`.
- Initial size: `width: 320px; height: auto (capped by max-height)`.
- Constraints: `min-width: 260px; min-height: 180px; max-width: 600px; max-height: 80vh`.
- White card, rounded 8px, shadow `0 4px 12px rgba(0,0,0,.12)`, consistent with the other widgets.
- `overflow: auto; resize: both;` for native browser corner-resize.
- Header acts as drag handle (`cursor: move`).

Panel contents (top to bottom):
1. **Header row** — `📋 My Priorities` (left), date in `15 May 2026` format (middle/right), `✕` close button (far right).
2. **Status badge** — `Approved` (green chip) or `Pending` (amber chip). Hidden in empty state.
3. **Body** —
   - If `entry !== null`: render `entry.priorities` as read-only multi-line text. Preserve newlines (use `white-space: pre-wrap`). No edit affordance, no text input.
   - If `entry === null`: centered placeholder text `No priorities submitted for today yet.` plus a text button `Go to Daily Standup →` that calls `onNavigateToPace()` and closes the panel.

### Interaction

- Click collapsed icon → panel opens.
- Click ✕, click outside the panel, or press Escape → panel closes (mirrors `StickyNotes.tsx:64-72`).
- Drag header → panel moves; position clamped to viewport (min 0, max `window.innerWidth - panelWidth` / `window.innerHeight - panelHeight`).
- Resize via bottom-right corner handle → size updates; bounded by min/max constraints.
- The collapsed icon does not move; only the expanded panel is draggable/resizable.

### Persistence

`localStorage` key: `day_priority_panel_<userId>`. Stored value:

```ts
{ x: number; y: number; width: number; height: number }
```

On mount, restore and clamp against current viewport. If clamped values fall below min sizes, discard the stored value and fall back to the default anchor + default size.

## Data flow

```
useMyTodayStandup(profile.id)
  └─ GET /operational_standups/roster/?date=<today>
  └─ filter: row.profile.uid === profile.id
  └─ pick highest-scored row (Approved > any > placeholder)
  └─ subscribe ws('pace-operational-standups') → refresh
  └─ return { entry, loading, refresh }

FloatingDayPriority
  └─ status dot color ← entry?.status (or grey if null)
  └─ open state (local)
  └─ position/size state (local, persisted to localStorage)
  └─ panel renders entry.priorities or empty state
```

Today is computed by a local `todayISO()` helper (same shape as `DailyStandupPage.tsx:19-22`) on each render — handles tabs left open past midnight without a dedicated timer.

The widget is org-agnostic; it does not read `selectedOrg` from the header. Multi-org users see the most informative row across all their orgs.

## Error handling

- Fetch failures (network, 500): caught inside the hook's effect, logged to console; last-known `entry` is retained. No toast — the widget is passive.
- `loading` resets to `false` in a `finally` clause regardless of outcome.
- The component is gated on `profile?.id`; if it's missing, the hook returns `null` entry and the component renders nothing (collapsed icon stays present but shows the grey dot).

## Edge cases

| Case | Behavior |
|---|---|
| Tab open past midnight | `todayISO()` recomputes each render; WS or state change triggers re-fetch against the new date. |
| Multi-org user with multiple today rows | Highest-scored row wins (Approved > any > placeholder). |
| Saved panel position off-screen after resize | Clamp on mount; if clamp produces invalid sizes, discard saved value and use defaults. |
| Status changes Pending → Approved while panel open | WS triggers `refresh`; component re-renders with green badge. |
| User signs out while panel open | `App.tsx` unmounts the `<Suspense>` block; widget disappears. |
| User has never submitted today | Grey dot on icon, empty-state body, "Go to Daily Standup →" link visible. |

## Testing

Files added under `frontend/task-tracker/src/__tests__/`.

### `hooks/useMyTodayStandup.test.ts`

- Returns `entry: null` when no roster row matches the profile.
- Returns the row's `entry` when one match exists.
- Picks the Approved row when multiple rows exist for the same user across orgs.
- Re-fetches on WS message to `pace-operational-standups`.
- Returns `{ entry: null, loading: false }` immediately when `profileId` is null.

### `pages/floatingDayPriority.test.tsx`

- Renders the collapsed icon when `profile` is present.
- Status dot is green for Approved, amber for Pending, grey for null entry.
- Click icon → panel opens; click icon again → panel closes.
- Click outside panel → closes.
- Press Escape → closes.
- Approved entry: priorities text renders with newlines preserved; green "Approved" badge shown.
- Pending entry: amber "Pending" badge shown.
- Null entry: empty-state text and link button render; clicking the link calls `onNavigateToPace` and closes the panel.
- Dragging the header updates the panel's inline position and writes to localStorage.
- Resizing via the corner handle updates size and writes to localStorage.
- Restoring a saved position out of viewport falls back to defaults.

## Files added / changed

**Added:**
- `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- `frontend/task-tracker/src/hooks/useMyTodayStandup.ts`
- `frontend/task-tracker/src/__tests__/hooks/useMyTodayStandup.test.ts`
- `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

**Changed:**
- `frontend/task-tracker/src/App.tsx` — add lazy import and mount the widget inside the existing `<Suspense fallback={null}>` block.

**No backend changes.**
