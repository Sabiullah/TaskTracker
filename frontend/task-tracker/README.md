# Task Tracker — Frontend

React 19 / TypeScript 6 / Vite 8 single-page app for a Django REST backend. The frontend is a thin client against the API documented in [`API_USAGE_GUIDE.md`](../../API_USAGE_GUIDE.md) — no database access from the browser.

---

## What it does

| Module | Purpose |
|---|---|
| **Board** | Kanban board with drag-and-drop, month filtering, recurring tasks |
| **Dashboard** | Task analytics and team overview |
| **Calendar** | Calendar view of tasks by date |
| **Work Log / Plan** | Daily hour logging with backdate control, and forward-looking plans |
| **Leads** | CRM-style pipeline with table + Kanban views |
| **Invoice** | Invoice plans + per-month entries, upload / approve / reject workflow |
| **Notice** | Legal / compliance notice tracker |
| **Attendance** | Daily attendance with quick-punch, WFH, backdate control |
| **Employee** | Employee master with salary + document uploads |
| **Masters** | Clients, categories, teams, orgs |
| **Users** | User CRUD, access-flag toggles, password reset (admin only) |
| **Growth Plan** | Per-employee growth activities (admin only) |
| **Holidays** | Holiday calendar |
| **PACE** | Four sub-modules: Meetings, Goals, Client Classification, Checklist |
| **Chat** | Floating real-time chat with DMs, groups, file attachments |
| **Sticky Notes** | Per-user private notes (localStorage) |

### Roles

| Role | Access |
|---|---|
| `admin` | Everything |
| `manager` | Self + direct reports |
| `employee` | Self only |

Module-level access (Invoice, Notice, Masters, Attendance, Employee) is a per-user boolean flag on the Django `User` model, surfaced in `UsersPage` as toggle switches.

---

## Stack

| Tool | Version | Notes |
|---|---|---|
| [Vite](https://vitejs.dev/) | ^8 | Rolldown bundler |
| [React](https://react.dev/) | ^19 | **React Compiler** enabled via Babel; memoisation is automatic |
| [TypeScript](https://www.typescriptlang.org/) | ~6 | Strict mode, no `any`, no suppressions |
| [ESLint](https://eslint.org/) | ^9 | Flat config |
| [Vitest](https://vitest.dev/) | ^4 | 97+ unit tests |
| [@dnd-kit](https://dndkit.com/) | ^6 / ^10 | Board drag-and-drop |

Backend is a separate Django REST + Channels project (see `../backend/`). This repo only contains the frontend.

---

## Getting started

### Requirements

- Node.js ≥ 20 (LTS)
- npm ≥ 10
- A running Django backend on `http://localhost:8000` (or edit `VITE_API_BASE_URL`)

### Install and run

```bash
npm install
npm run dev                       # http://localhost:5173
```

### Environment

`.env` at the project root:

```env
VITE_API_BASE_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000/ws/
```

The dev server proxies `/api` to `http://127.0.0.1:8000` already (see `vite.config.ts`), so you can also omit `VITE_API_BASE_URL` when running both locally.

### Commands

```bash
npm run dev        # Vite dev server with HMR, exposed on LAN (--host)
npm run build      # tsc -b && vite build — must exit with zero warnings
npm run preview    # serve the production build locally
npm run lint       # ESLint; must exit 0
npm test           # Vitest single pass
npx ts-node analyze.ts <files> --format=table    # combined tsc + eslint reporter
```

---

## Project structure

```
src/
├── pages/                   # Every route, one .tsx per screen
├── components/
│   ├── <feature>/           # Feature components — only .tsx files
│   └── ui/                  # Generic primitives
├── hooks/                   # Data hooks (useTasks, useLeads, useInvoices, …)
├── contexts/                # AuthContext
├── lib/api/                 # The only place we touch HTTP
│   ├── client.ts            # apiGet/Post/Patch/Delete, ApiError, token refresh
│   ├── auth.ts              # login / logout / me
│   ├── ws.ts                # ws.subscribe<Dto>(channel, handler)
│   ├── mappers.ts           # DTO ↔ domain
│   └── index.ts             # Public barrel
├── types/
│   ├── <feature>.ts         # Domain types
│   ├── api/<feature>.ts     # DTO types
│   └── index.ts             # Barrel
├── utils/<feature>.ts       # Pure helpers, constants, BLANK defaults
├── data/                    # One-time admin import payloads only (e.g. seedGoals.ts)
├── __tests__/               # Vitest tests mirroring src/
├── App.tsx                  # Lazy route table + layout
└── main.tsx                 # Mount
```

**Folder invariants** (enforced on review — see [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)):

- `components/<feature>/` holds **only `.tsx` components**. No `.ts` helpers, constants, or type files.
- `utils/<feature>.ts` is **pure** — no React, no JSX, no hooks.
- `types/<feature>.ts` holds **only types**, no runtime values.
- `pages/` holds **only route screens**. Sub-pages rendered as tabs of another page (e.g. the four PACE pages) still live here.
- **No sub-subfolders** — if grouping helps, prefix filenames (`goalConstants.ts`, `meetingConstants.ts`).

---

## How the app talks to the backend

```
Django REST + Channels
   │  JSON with _detail expansions, uid FKs, signed file URLs
   ▼
src/lib/api/client.ts              # apiGet<Dto>(path, query?)
   │                                 # throws ApiError on non-2xx
   │                                 # auto-refreshes JWT on 401
   ▼
src/lib/api/mappers.ts             # dtoToDomain(dto)
   │
   ▼
src/hooks/use<Feature>.ts          # returns { items, loading, reload, save, remove }
   │
   ▼
src/pages/ · src/components/…      # presentational only
```

- Components **never** call `apiGet`/`apiPost` directly for shared resources — they go through a hook.
- DTO types (`*Dto`, `*Create`, `*Update`) never leak past `mappers.ts` or the feature's `utils/<feature>.ts`.
- File uploads use `apiPostForm` / `apiPatchForm`; signed file URLs are short-lived and must be re-fetched per render.

---

## Build output

The app is code-split by route via `React.lazy()` in `App.tsx`. A typical production build looks like:

```
dist/assets/index-*.js           ~290 kB (gzip ~89 kB)   # shell + eager widgets
dist/assets/PacePage-*.js        ~104 kB
dist/assets/WorkLogPage-*.js      ~77 kB
dist/assets/InvoicePage-*.js      ~45 kB
dist/assets/LeadsPage-*.js        ~33 kB
…plus one chunk per page
```

React Compiler is scoped to `src/**/*.{ts,tsx,js,jsx}` in `vite.config.ts`; the full build runs in under a second on a warm cache.

---

## Development rules

Non-negotiable. Full detail and examples are in [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md). The short version:

- **No `any`.** No `// @ts-ignore`, no `// @ts-expect-error`, no `// eslint-disable-*`.
- **Strict DTO/domain separation.** Conversion happens in `mappers.ts` or `utils/<feature>.ts` — nowhere else.
- **One way to do each thing.** Before writing a new helper, grep for an existing one. Before inlining `toLocaleString("en-IN")`, import `fmtMoney`.
- **Every effect cleans up.** WebSocket subscriptions, intervals, listeners — all return a cleanup.
- **Every feature addition goes: types → utils → hook → component → page.** See the worked example in [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md#adding-a-feature-end-to-end).
- **Final gate before done:** `analyze.ts` full tree · `tsc -b` · `npm run build` · `npm run lint` · `npm test` all exit 0.

## Contributing

1. Read [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) in full. It documents every convention this codebase enforces.
2. Check [`API_USAGE_GUIDE.md`](./API_USAGE_GUIDE.md) for the exact shape of any endpoint you touch. Field names matter.
3. Follow the [per-file workflow](./docs/DEVELOPMENT.md#per-file-workflow): edit → analyze → tsc → test → commit.
4. Run the [final gate](./docs/DEVELOPMENT.md#per-file-workflow) before opening a PR.
5. Keep commits small. One concern per commit.

## For AI agents

You're a contributor. The same rules apply, plus the [AI agent checklist](./docs/DEVELOPMENT.md#ai-agent-checklist) in the dev guide. If a rule is unclear for the task at hand, ask before guessing.

---

## Further reading

- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — full development guide, patterns, pitfalls, agent checklist.
- [`API_USAGE_GUIDE.md`](./API_USAGE_GUIDE.md) — Django REST endpoint contract.
