# User Rights — per-user menu/submenu View/Edit matrix

**Date:** 2026-06-12
**Branch:** `User_rights`
**Status:** Design — approved for plan

## Problem

Today, permissions are 7 coarse per-org boolean flags on `OrgMembership`
(`invoice_access`, `notice_access`, `masters_access`, `attendance_access`,
`employee_access`, `leads_access`, `conveyance_access`), each on/off. Admins
implicitly get everything; the flags gate a handful of nav items and DRF
viewsets. Most of the ~17 menus have no per-user access control at all, and
there is no read-vs-write distinction.

We want a **User Rights** screen (modeled on a reference matrix UI) that lets an
admin grant **every** menu — and its submenus — to each user at **View** or
**Edit** granularity, scoped per org. The granted rights must actually drive
what each user can see and do (nav visibility, tab visibility, edit
affordances, and backend authorization).

## Decisions (locked during brainstorming)

- **Coverage:** all 17 main menus **and** their submenus get View/Edit rights.
- **Scope:** per org. A user can have different rights in 4D vs YBV (fits the
  existing `OrgMembership` model).
- **Cell model:** two checkboxes per cell — **View** and **Edit**. Edit implies
  View. Both unchecked = no access (menu/tab hidden).
- **Storage:** declarative code catalog + a sparse `MenuRight` table
  (Approach A). Not JSON-blob, not per-menu columns.
- **Placement:** a **User Rights** tab on the existing admin **Users** page.
- **Admins:** always full access. Admin columns render all-checked and locked;
  admins bypass the matrix entirely (no zero-admin lockout risk).

## Menu / submenu catalog

Stable `code`s use dotted notation (`employee`, `employee.salary`). Submenus
listed under each main menu; menus with no listed submenu are single-view.

| Main menu (`code`) | Submenus (`code`) |
|---|---|
| `board` | — |
| `dashboard` | — |
| `calendar` | — |
| `worklog` | `worklog.log` (Log Table) · `worklog.plan` (Work Plan) · `worklog.dashboard` (Dashboard) |
| `leads` | `leads.open` · `leads.confirmed` · `leads.cancelled` |
| `clients` | `clients.roadmap` · `clients.mom` (MOM & Action Points) · `clients.observation` (Observation Report) · `clients.audit` (Internal Audit Report) |
| `notice` | `notice.open` · `notice.completed` |
| `invoice` | `invoice.schedule` · `invoice.summary` · `invoice.invoices` · `invoice.report` |
| `conveyance` | `conveyance.transactions` · `conveyance.employee_totals` · `conveyance.client_totals` |
| `masters` | `masters.orgs` (Organizations) · `masters.clients` · `masters.categories` · `masters.team` (Team Members) |
| `holidays` | `holidays.holidays` · `holidays.working_days` |
| `employee` | `employee.personal` · `employee.salary` · `employee.leave` · `employee.matrix` · `employee.attendance_log` · `employee.approvals` |
| `pace` | `pace.meetings` · `pace.standup` (Daily Standup) · `pace.goals` · `pace.classification` (Client Classification) · `pace.checklist` |
| `growthplan` | — |
| `kaizen` | — |
| `users` | — |
| `settings` | — |

~17 main + ~35 submenu = ~52 rights rows × {View, Edit}.

## Architecture

### 1. Catalog (single source of truth)

`users/menu_catalog.py` defines an ordered list of catalog nodes:

```python
MenuNode = namedtuple("MenuNode", "code label parent")
MENU_CATALOG: list[MenuNode] = [ ... ]  # ordered; parents before children
```

Each node: stable `code`, human `label`, `parent` (None for top-level). The
catalog is the authority for valid `menu_code` values, render order, and the
parent/child tree.

Served read-only at `GET /api/menu-catalog/` (authenticated). The frontend
fetches it to build **both** the nav gating map and the matrix rows, so the
backend and frontend can never drift on the menu list.

A small unit test asserts every code is unique, every non-null `parent`
references an existing top-level code, and parents precede children.

### 2. Model

```python
class MenuRight(models.Model):
    membership = FK(OrgMembership, related_name="menu_rights", on_delete=CASCADE)
    menu_code  = CharField(max_length=64)        # must be in MENU_CATALOG
    can_view   = BooleanField(default=False)
    can_edit   = BooleanField(default=False)     # edit implies view (enforced in save)
    granted_by = FK(User, null=True, SET_NULL, related_name="+")
    granted_at = DateTimeField(null=True)
    class Meta:
        unique_together = [("membership", "menu_code")]
```

Sparse: a row exists only when something is granted. No row = no access.
`save()` normalises `can_edit → can_view` (edit forces view true). Rows where
both are false are deleted rather than stored.

`User` helpers (admins always True):
- `menu_view_in(org, code) -> bool`
- `menu_edit_in(org, code) -> bool`
- `menu_rights_map(org) -> dict[str, {"view": bool, "edit": bool}]` (for `/me`).

### 3. Migration / backfill

A data migration seeds `MenuRight` from current state so **no one loses access**:

- 7 flags → their menu codes at view+edit:
  `invoice_access→invoice`, `notice_access→notice`, `masters_access→masters`,
  `attendance_access→employee.attendance_log` (+ `employee.matrix` view),
  `employee_access→employee` (view+edit), `leads_access→leads`,
  `conveyance_access→conveyance`.
- Always-on menus (currently shown to every member regardless of flag) get
  **view** for every non-admin membership: `board`, `dashboard`, `calendar`,
  `worklog`, `conveyance`, `holidays`, `employee` (view), `pace`, `kaizen`,
  `settings`. (`growthplan` and `users` stay admin-only — never shown to
  non-admins today — so they get no seed.) Where a member already had edit via
  a flag, edit is preserved.
- Admins get nothing seeded (they bypass via override).
- Submenu rights default to the parent's level at seed time (e.g. a member with
  `masters` view+edit gets view+edit on all `masters.*`).

The 7 boolean columns **remain** during transition. The existing
`has_<feature>_in()` / `has_<feature>_in_any()` helpers are reimplemented as
reads over `MenuRight` (mapping feature→code), so all current permission
classes in `core/permissions.py` keep working unchanged. A later cleanup
migration (out of scope here) can drop the columns.

> **CI vs prod note:** verify the data migration on real Postgres, not just
> SQLite CI — backfills that pass CI can crash prod.

### 4. API

- `GET /api/menu-catalog/` — the catalog tree (authenticated).
- `GET /api/user-rights/?org=<id|uid>` — admin-only. Returns, for the chosen
  org: the member list (columns) and each member's `menu_rights_map`. Admin
  members flagged `is_admin: true` so the UI locks their column.
- `PATCH /api/user-rights/?org=<id|uid>` — admin-only. Batch save: body is
  `{ user_uid: { menu_code: {view, edit}, ... }, ... }`. Server validates every
  `menu_code` against the catalog, enforces edit→view, writes/deletes
  `MenuRight` rows, stamps `granted_by`/`granted_at` on newly-granted rights.
  Rejects edits to admin members and to orgs the caller isn't admin of.
- `/me` and `UserSerializer` per-org dict gain `menu_rights` (the resolved
  map for that membership) so the frontend can gate without an extra call.

### 5. Matrix UI — User Rights tab on Users page

Admin-only tab/toggle in the Users page header. Layout mirrors the reference:

- **Org selector** (defaults to active org), **search** (filters menu rows),
  menu-count and user-count chips, **Cancel** / **Save Changes**.
- Rows = catalog: main menu rows with submenu rows indented beneath. Columns =
  members of the selected org, with a per-user grant count in the header
  (e.g. `11/52`).
- Each cell = **View** + **Edit** checkboxes. Checking Edit auto-checks View;
  unchecking View clears Edit. A main-menu cell offers select-all/clear for its
  subtree.
- **Admin columns:** all-checked, disabled, with an "admin — full access" hint.
- Local edit state is diffed against loaded state; **Save** sends one PATCH;
  **Cancel** reverts. Unsaved-changes guard before leaving the tab.

### 6. Enforcement

**Frontend (full coverage):**
- `usePermissions()` hook reads the active org's `menu_rights` from the
  authenticated user payload plus the catalog.
- Nav: show a main menu only if `can_view`.
- Tabs: show a submenu tab only if its `can_view` (and parent viewable).
- Edit affordances: create/edit/delete buttons and form submits are
  hidden/disabled when `!can_edit` for that menu/submenu.

**Backend (authoritative where endpoints separate cleanly):**
- `HasMenuRight(menu_code)` DRF permission class + a `MenuGatedViewSet` mixin:
  SAFE_METHODS require `can_view`, writes require `can_edit`, admins override.
- Applied to each menu's primary resource viewset, and to submenus that own a
  distinct endpoint (e.g. `employee.salary`, `employee.approvals`,
  `masters.orgs`). Replaces the old flag-based `permission_classes` on those
  viewsets (the helper shims keep any un-migrated checks valid).
- Status-filter tabs (`leads.open/confirmed/cancelled`,
  `notice.open/completed`) and read-only roll-ups (`conveyance.*_totals`) are
  **frontend-gated only** — they are filtered views of one resource, so a
  distinct backend right would be meaningless. This is called out so the
  partial backend coverage is intentional, not an oversight.

### 7. Phasing (one spec, shippable stages)

1. Catalog module + `/api/menu-catalog/` + `MenuRight` model + migration +
   `menu_rights` on `/me`. (Backend, no behaviour change — old helpers shim.)
2. `GET`/`PATCH /api/user-rights/` + the User Rights matrix tab (read + save).
3. Frontend gating: nav visibility, tab visibility, edit-affordance gating via
   `usePermissions()`.
4. Backend `HasMenuRight` wiring per menu/submenu-with-endpoint, retiring the
   old flag checks at those call sites.

## Testing (TDD)

- **Model:** `can_edit` forces `can_view`; both-false row is not persisted;
  unique `(membership, menu_code)`.
- **Catalog:** codes unique; parents exist and precede children.
- **Migration:** backfill preserves every current access (parametrised over the
  7 flags + role); admins seed nothing; submenu defaults follow parent.
- **Helpers/compat:** `has_masters_in` etc. still return correct values reading
  from `MenuRight`; admin override returns True everywhere.
- **API authz:** catalog requires auth; user-rights GET/PATCH admin-only and
  per-org scoped; PATCH rejects unknown codes, admin-member edits, and
  cross-org writes; edit→view normalised on save.
- **`HasMenuRight`:** read needs view, write needs edit, admin overrides,
  anonymous denied.
- **Serializer:** `/me` per-org dict includes a correct `menu_rights` map.

## Out of scope

- Dropping the 7 legacy boolean columns (later cleanup migration).
- Submenu-level backend enforcement for status-filter/roll-up tabs.
- Editing admin rights / role management (unchanged).
- Bulk "copy rights from another user" (possible future nicety).
