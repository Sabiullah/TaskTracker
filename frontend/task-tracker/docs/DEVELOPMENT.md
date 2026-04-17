# Development Guide

> Audience: human developers and AI coding agents contributing to the Task Tracker frontend. This document replaces tribal knowledge — if something isn't written here, follow the pattern already used in the codebase.

---

## Table of contents

1. [Goals](#goals)
2. [Stack](#stack)
3. [Folder structure (authoritative)](#folder-structure-authoritative)
4. [Data flow](#data-flow)
5. [Adding a feature end-to-end](#adding-a-feature-end-to-end)
6. [API client patterns](#api-client-patterns)
7. [WebSocket patterns](#websocket-patterns)
8. [React patterns](#react-patterns)
9. [TypeScript rules](#typescript-rules)
10. [Styling rules](#styling-rules)
11. [Testing](#testing)
12. [Per-file workflow](#per-file-workflow)
13. [Build performance](#build-performance)
14. [Common pitfalls (from real audit findings)](#common-pitfalls-from-real-audit-findings)
15. [AI agent checklist](#ai-agent-checklist)

---

## Goals

This codebase is production-grade. Every change must leave it in that state:

- **Strict types end to end.** No `any`, no suppressions. DTOs and domain models are distinct.
- **One way to do each thing.** No parallel implementations of the same helper in different files.
- **Flat, predictable folders.** A new contributor should be able to guess where a file lives.
- **Clean build.** `npm run build`, `npm run lint`, `npm test`, and `analyze.ts` all exit 0.
- **No dead code.** If a function isn't called, delete it; if a file isn't imported, delete it.

---

## Stack

| Tool | Version | Purpose |
|---|---|---|
| Vite | ^8 | Dev server + production bundler (Rolldown under the hood) |
| React | ^19 | UI, with **React Compiler** enabled (see `vite.config.ts`) |
| TypeScript | ~6 | Strict mode; no `any` |
| ESLint | ^9 | Flat config in `eslint.config.js` |
| Vitest | ^4 | Unit tests in `src/__tests__/` |
| `@dnd-kit` | ^6 / ^10 | Board drag-and-drop |

Backend is a **Django REST + Channels** API documented in [`API_USAGE_GUIDE.md`](../API_USAGE_GUIDE.md). The frontend never talks directly to a database.

---

## Folder structure (authoritative)

```
src/
├── pages/                  # One .tsx per route. The only place top-level screens live.
├── components/
│   ├── <feature>/          # Feature components ONLY — .tsx files.
│   └── ui/                 # Generic primitives shared across features.
├── hooks/                  # Data hooks (`useTasks`, `useLeads`, ...). One concern per file.
├── contexts/               # Global React context (`AuthContext`). Use sparingly.
├── lib/
│   └── api/                # Fetch client, WS client, mappers. The only place we touch HTTP.
│       ├── client.ts       # apiGet/Post/Patch/Delete/Form, ApiError, token lifecycle
│       ├── auth.ts         # login/logout/me
│       ├── ws.ts           # ws.subscribe<Dto>(channel, handler)
│       ├── mappers.ts      # DTO ↔ domain converters
│       └── index.ts        # Narrow public barrel
├── types/
│   ├── <feature>.ts        # Domain types (what the UI works with).
│   ├── api/<feature>.ts    # DTO types (shape on the wire).
│   └── index.ts            # Barrel re-export.
├── utils/
│   └── <feature>.ts        # Pure helpers, constants, BLANK defaults, dtoTo<Row> mappers.
├── data/                   # One-time admin import payloads only (e.g. seedGoals.ts).
│                           # UI config (board columns, month names, colour swatches)
│                           # lives in utils/ — NOT here.
├── __tests__/              # Vitest tests mirroring the src tree.
├── App.tsx                 # Lazy route table + layout shell.
└── main.tsx                # Mount point.
```

**Hard rules about this tree — do not violate:**

- `components/<feature>/` contains **only `.tsx` files**. Styles, constants, and types belong in `utils/` or `types/`.
- `utils/` contains **only pure modules**. No React imports, no hooks, no JSX.
- `types/` contains **only `interface`/`type` declarations**. No runtime values.
- `pages/` contains **only route-level screens**. Even if a page is a tab inside another page (like the four PACE sub-pages), it still lives here.
- **No sub-subfolders** inside any of these. If grouping helps, use filename prefixes (`goalConstants.ts`, `meetingConstants.ts`), not nested directories.

---

## Data flow

The frontend has one valid data path:

```
Server (Django)
   │   JSON with _detail expansions, uid FKs
   ▼
src/lib/api/client.ts               // apiGet<Dto>(…)
   │   Dto[]
   ▼
src/lib/api/mappers.ts              // dtoToDomain(dto)
   │   Domain objects
   ▼
src/hooks/use<Feature>.ts           // { items, loading, reload, save, remove }
   │
   ▼
src/pages/ | src/components/…       // presentational
```

Rules:

1. **Pages and components never call `apiGet`/`apiPost` directly for shared resources.** They go through a hook. (Exceptions: one-off reads like `/task_logs/?task_uid=…` live in the page that needs them — see `App.tsx` `openLogModal`.)
2. **DTO shapes never leak past `mappers.ts`.** Hooks return domain types; components see domain types.
3. **Writes resolve FKs before they hit the API.** If the component holds a client _name_ and the API wants a client _uid_, the hook (or a buildBody helper) does that lookup.

---

## Adding a feature end-to-end

Say you're adding a **"Reminders"** module with CRUD against `/api/reminders/`.

### 1. Types (read-only)

`src/types/api/reminder.ts`:

```ts
import type { BaseDto, IsoDate, Uid, UserRefDto } from "./common";

export type ReminderStatus = "Open" | "Done" | "Snoozed";

export interface ReminderDto extends BaseDto {
  readonly title: string;
  readonly due_date: IsoDate | null;
  readonly status: ReminderStatus;
  readonly assigned_to: Uid | null;
  readonly assigned_to_detail: UserRefDto | null;
}

export interface ReminderCreate {
  readonly title: string;
  readonly due_date?: IsoDate;
  readonly status?: ReminderStatus;
  readonly assigned_to?: Uid;
}

export type ReminderUpdate = Partial<ReminderCreate>;
```

`src/types/reminder.ts`:

```ts
import type { ReminderStatus } from "./api/reminder";

export interface Reminder {
  id: string;
  title: string;
  due_date: string;           // "" when null
  status: ReminderStatus;
  assigned_to: string;        // display name
  assigned_to_uid: string | null;
}
```

Add `export * from "./reminder";` to `src/types/index.ts`.

### 2. Utils (constants + pure helpers)

`src/utils/reminder.ts`:

```ts
import type { Reminder } from "@/types/reminder";
import type { ReminderDto, ReminderStatus } from "@/types/api";

export const STATUSES: ReminderStatus[] = ["Open", "Done", "Snoozed"];

export const STATUS_CFG: Record<ReminderStatus, { color: string; bg: string }> = {
  Open: { color: "#d97706", bg: "#fef3c7" },
  Done: { color: "#16a34a", bg: "#f0fdf4" },
  Snoozed: { color: "#6b7280", bg: "#f9fafb" },
};

export const BLANK_REMINDER: Reminder = {
  id: "",
  title: "",
  due_date: "",
  status: "Open",
  assigned_to: "",
  assigned_to_uid: null,
};

export function dtoToReminder(dto: ReminderDto): Reminder {
  return {
    id: dto.uid,
    title: dto.title,
    due_date: dto.due_date ?? "",
    status: dto.status,
    assigned_to: dto.assigned_to_detail?.full_name ?? "",
    assigned_to_uid: dto.assigned_to,
  };
}
```

### 3. Hook (data access)

`src/hooks/useReminders.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import { dtoToReminder } from "@/utils/reminder";
import type { Reminder } from "@/types";
import type { ReminderDto } from "@/types/api";

export function useReminders() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const dtos = await apiGet<ReminderDto[]>("/reminders/");
      setItems(dtos.map(dtoToReminder));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const unsubscribe = ws.subscribe<ReminderDto>("reminders", () => {
      void reload();
    });
    return unsubscribe;
  }, [reload]);

  return { items, loading, reload };
}
```

### 4. Components (presentational)

`src/components/reminder/ReminderRow.tsx` — purely presentational, no fetch, no state that belongs in the hook.

### 5. Page

`src/pages/RemindersPage.tsx` — composes the hook with the row component. If this page will be reachable from the nav, add a `React.lazy()` import to `App.tsx`.

### 6. Tests

`src/__tests__/utils/reminder.test.ts` covers `dtoToReminder` and `BLANK_REMINDER`.

### 7. Verify

```bash
npx tsc -b --noEmit
npx ts-node analyze.ts src/utils/reminder.ts src/types/reminder.ts src/hooks/useReminders.ts src/pages/RemindersPage.tsx --format=table
npm test
npm run build
npm run lint
```

All must exit 0.

---

## API client patterns

Import from the barrel:

```ts
import {
  apiGet, apiPost, apiPatch, apiDelete,
  apiPostForm, apiPatchForm,       // multipart
  ApiError,
  ws,
} from "@/lib/api";
```

### GET list / GET single

```ts
const dtos = await apiGet<ReminderDto[]>("/reminders/");
const one  = await apiGet<ReminderDto>(`/reminders/${uid}/`);
```

### GET by string key (NOT by query param)

Some endpoints are keyed by a string slug, not a uid or a `?key=` query:

```ts
// ✅ Correct — matches /api/app_settings/<key>/
const row = await apiGet<AppSettingDto>(`/app_settings/${BACKDATE_SETTING_KEY}/`);

// ❌ Wrong — this is the bug we fixed during the audit
const rows = await apiGet<AppSettingDto[]>("/app_settings/", { key: "..." });
```

Always read the endpoint's entry in `API_USAGE_GUIDE.md` before deciding between these.

### Query parameters

```ts
const dtos = await apiGet<LeadHistoryDto[]>("/lead_history/", { lead_uid: lead.id });
```

### POST / PATCH

```ts
await apiPost<ReminderDto>("/reminders/", body);
await apiPatch<ReminderDto>(`/reminders/${uid}/`, patch);
```

### File uploads (multipart)

```ts
const fd = new FormData();
fd.append("file", file);               // exact field name comes from the guide
await apiPostForm<InvoiceEntryDto>(`/invoice_entries/${id}/upload/`, fd);
```

### Errors

`apiRequest` throws `ApiError` with `.status` and `.message`. Catch only where you can do something useful — at the top of a hook or in the component that shows a toast. Never swallow silently:

```ts
try {
  await apiPost("/leads/", body);
} catch (err) {
  const msg = err instanceof ApiError ? err.message : String(err);
  alert(`Save failed: ${msg}`);
}
```

### Signed file URLs

`file_url` and `address_proof_url` fields on Django responses are **short-lived** (default 300 s). **Never cache them** in localStorage or long-lived state — re-fetch the owning resource before displaying. See `InvoiceActionModal.tsx` and `ChatMessageList.tsx` for the pattern.

---

## WebSocket patterns

`ws.subscribe` is the only way to listen for realtime updates:

```ts
useEffect(() => {
  void reload();
  const unsubscribe = ws.subscribe<ReminderDto>("reminders", (evt) => {
    // evt.event is "INSERT" | "UPDATE" | "DELETE"
    // evt.record is the full DTO payload
    void reload();
  });
  return unsubscribe;  // ← every subscription MUST clean up
}, [reload]);
```

Channel naming is **hyphenated**: `"work-logs"`, `"lead-statuses"`, `"invoice-plans"`. Mirror what other hooks already do.

For realtime channels that aren't yet live on the backend, the subscription is still safe to set up — `ws.ts` simply won't receive events. A matching channel name in the frontend is the forward-compatible contract.

---

## React patterns

### Function components only

Class components are banned.

### React Compiler handles memoisation

The Babel plugin in `vite.config.ts` runs React Compiler on every file under `src/`. **Do not hand-roll `useMemo`/`useCallback` unless a profiler shows a need.** Accept that "pretty" inline objects in JSX are fine:

```tsx
// ✅ Fine under React Compiler
<Row style={{ marginTop: 12 }} onEdit={(x) => setEditing(x)} />
```

### Effect cleanup is non-negotiable

Every `useEffect` that subscribes to a WebSocket, sets an interval, attaches a listener, or starts an async flow must return a cleanup:

```ts
useEffect(() => {
  let cancelled = false;
  (async () => {
    const rows = await apiGet(...);
    if (cancelled) return;
    setRows(rows);
  })();
  return () => { cancelled = true; };
}, [deps]);
```

### Lazy routes

All pages are lazy-loaded in `App.tsx`:

```ts
const LeadsPage = lazy(() => import("./pages/LeadsPage"));
```

Add new pages to the `VIEW_MAP` with a `lazy(...)` import. Board, LoginPage, and the always-mounted widgets (FloatingChat, StickyNotes) stay eager.

### Keys come from `uid`

Never use array indices as keys for lists of server data.

```tsx
{items.map((it) => <Row key={it.id} ... />)}  // ✅ stable server uid
```

### Server state in hooks, UI state in components

If state has to survive a refetch, it lives in the hook's store. If it's purely visual (open/closed, hover, which tab), it lives in the component.

---

## TypeScript rules

1. **No `any`.** Period. Use `unknown` for untyped boundaries and narrow with type guards.
2. **No suppressions.** No `// @ts-ignore`, no `// @ts-expect-error`, no `// eslint-disable-*`. If a library type is wrong, write a minimal typed wrapper.
3. **DTO and domain types are separate.** The converter in `mappers.ts` or `utils/<feature>.ts` is the only place they meet.
4. **Explicit types at module boundaries.** Function parameters and return types across files must be typed. Inference is fine inside a function body.
5. **Discriminated unions for state.** Prefer `{ kind: "loading" } | { kind: "error", error: ApiError } | { kind: "ok", data: T }` over a bag of optional fields. (The codebase isn't fully there yet — when you touch an existing hook, don't make it worse.)
6. **Named exports for new code.** Default exports are only tolerated where an existing pattern (pages, certain components) already requires them.
7. **Readonly on DTOs.** DTO fields are `readonly`. Never mutate a DTO — convert to domain first.

---

## Styling rules

- **Shared table styles** live in `src/utils/tableStyles.ts` — `thS`, `tdS`, `inpS`, `lblS`. Use these; don't redeclare.
- **Money**: `fmtMoney(amount)` from `src/utils/money.ts`. Handles `null`/`undefined` and emits `₹ 1,23,456`.
- **Dates**: `fmtDate`, `fmtDateShort`, `fmtFull`, `fmtTime`, `formatMonthLabel` from `src/utils/date.ts`. **Don't inline `.toLocaleDateString(...)`** — the existing helpers cover the formats we render.
- **Per-feature styles** (status colours, priority colours, icon maps) live in `src/utils/<feature>.ts` as `STATUS_CFG` / `PRIORITY_CFG`.
- **Two table-size variants exist:** the shared dense one (`tableStyles.ts`, 7 px padding) and a comfortable variant inlined in a few feature files (8 px padding). They're intentionally different.

No global CSS framework. Inline React `style={{ … }}` is the norm.

---

## Testing

- Framework: **Vitest**. Tests live under `src/__tests__/` mirroring the source tree.
- **Every pure utility gets a test.** Converters (`dtoTo<Row>`), numeric helpers (`hoursToDecimal`), and stats computations all ship with tests.
- **Components are not unit-tested** unless they contain non-trivial logic. We rely on the browser to catch visual issues.
- **Tests are deterministic.** No random seeds, no `Date.now()` assertions without a clock mock.
- **Property-based tests** via `fast-check` for wide input domains — see `src/__tests__/utils/hours.test.ts` for the pattern.

Run:

```bash
npm test                        # single pass
npm test -- hours               # filtered
```

---

## Per-file workflow

This is the loop for every edit:

1. **Read** the file.
2. **Edit** — small, targeted changes. One concern per edit.
3. **Analyze** immediately after saving:
   ```
   npx ts-node analyze.ts <paths> --format=table
   ```
   Zero issues in the touched files before moving on.
4. **Typecheck** across the whole tree when multiple files are touched:
   ```
   npx tsc -b --noEmit
   ```
5. **Run affected tests**:
   ```
   npm test -- <pattern>
   ```
6. **Manual smoke** in the browser (`npm run dev`) for anything visual.
7. **Commit** with a one-line message scoped to the single concern.

The **final gate** before you consider work done:

```bash
npx ts-node analyze.ts $(git ls-files 'src/**/*.ts' 'src/**/*.tsx') --format=table
npx tsc -b --noEmit
npm run build
npm run lint
npm test
```

All must exit 0. No warnings, no skipped tests.

---

## Build performance

Two things keep the build fast and the main bundle small:

1. **React Compiler is scoped to `src/`** via `include`/`exclude` in `vite.config.ts`. If you add a new top-level folder and you want React Compiler to run on it, add it to `include`.
2. **Every page is `React.lazy()`-loaded** in `App.tsx`. Adding a new page without lazy-loading it will re-introduce the 500 kB chunk-size warning.

If the build prints `[PLUGIN_TIMINGS]` or a chunk-size warning, fix it before merging — those are canaries for a regression in the two rules above.

---

## Common pitfalls (from real audit findings)

These are mistakes we've already made and fixed. Don't re-introduce them:

| Pitfall | What it looked like | Fix |
|---|---|---|
| **Querying a by-key endpoint as a list.** | `apiGet<AppSettingDto[]>("/app_settings/", { key })` then `.find(...)` | `apiGet<AppSettingDto>(\`/app_settings/${key}/\`)` |
| **Stale field aliases after a rename.** | References to `sNo` / `compDate` after the rename to `serialNo` / `completedDate` | Grep the codebase; rename everywhere in one pass. |
| **Nested subfolders for "grouping".** | `components/pace/goals/*`, `components/worklog/dashboard/*` | Flat folders. Use filename prefixes (`goalConstants.ts`). |
| **Constants and types in `components/`.** | `components/notice/constants.ts`, `components/growthplan/types.ts` | Constants → `utils/<feature>.ts`. Types → `types/<feature>.ts`. |
| **`@ts-expect-error` hiding a real type mismatch.** | `getApplicableMonths(form, ...)` where `form: PlanForm` but the param typed as `InvoicePlan` | Widen the function param (`Pick<InvoicePlan, ...>`), delete the suppression. |
| **Spreading an unrelated domain's BLANK into a form.** | `setModal({ ...BLANK, status: ... })` where `BLANK` came from `utils/attendance` | Spread only the fields that exist on the target type. |
| **Inline `toLocaleString("en-IN")` for money.** | `₹{value.toLocaleString("en-IN")}` | `{fmtMoney(value)}` |
| **Duplicated `thS`/`tdS`/`inpS`.** | 10 copies across pages | Import from `@/utils/tableStyles`. |
| **Unused exports.** | `createResource` factory exported but never instantiated | Delete the file and the barrel export. |
| **Effect without cleanup.** | WebSocket subscription without `return unsubscribe` | Always return the unsubscribe function. |
| **Hardcoded fallback lists in `data/`.** | `utils/masters.ts` returning a baked-in `["Tamil", "Musthafa", …]` when the localStorage cache was empty | Return `[]` from live lookups when the cache is cold — the backend is the source of truth. `data/` is reserved for one-time admin import payloads (like `seedGoals.ts`). |

---

## AI agent checklist

Before finishing any task that touches code, verify:

- [ ] No `any` introduced. No `// @ts-ignore` / `// @ts-expect-error` / `// eslint-disable-*` introduced.
- [ ] Every new file lives in the correct folder per the [folder structure](#folder-structure-authoritative).
- [ ] Every new utility is a pure function in `src/utils/<feature>.ts`.
- [ ] Every new type is in `src/types/<feature>.ts` or `src/types/api/<feature>.ts`.
- [ ] Every new page is added to `App.tsx` via `React.lazy()`.
- [ ] Every new `ws.subscribe` call has a cleanup.
- [ ] DTO → domain conversion happens in exactly one place per feature.
- [ ] Field names on write payloads match `API_USAGE_GUIDE.md` exactly (`assigned_to`, `next_step_date`, `serial_no`, etc.).
- [ ] You ran the [per-file workflow](#per-file-workflow) and the [final gate](#per-file-workflow) is green.
- [ ] No file you touched exceeds ~900 lines after your edit; if it does, split it the same way the existing feature folders split modals/rows out.
- [ ] You did NOT rename an API field or a DTO without also updating every consumer (grep the codebase).
- [ ] You did NOT leave dead code — unused imports, commented-out blocks, orphaned files.

If any of these are unclear for the task at hand, **ask first** rather than guess.
