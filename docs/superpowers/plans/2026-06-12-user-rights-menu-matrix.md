# User Rights — Menu/Submenu View/Edit Matrix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a per-org User Rights matrix that grants every menu and submenu to each user at View or Edit granularity, and make those rights actually drive nav visibility, tab visibility, edit affordances, and backend authorization.

**Architecture:** A declarative menu catalog in Python (single source of truth, served to the frontend) drives both the matrix and gating. Rights live in a sparse `MenuRight` table keyed by `(membership, menu_code)`. Admins always override to full. A data migration backfills from today's 7 boolean flags + roles so nobody loses access; the legacy `has_*_in()` helpers are reimplemented over `MenuRight` so existing permission classes keep working unchanged.

**Tech Stack:** Django + DRF (pytest-django, `TestCase` + `APIClient`); React + TypeScript (Vite). Backend tests: `uv run pytest`. Frontend checks: `npm run` (tsc/build) from `frontend/task-tracker`. Run `uv run pre-commit run --all-files` before pushing.

**Spec:** `docs/superpowers/specs/2026-06-12-user-rights-menu-matrix-design.md`

---

## File Structure

**Backend (create):**
- `users/menu_catalog.py` — ordered catalog nodes + `FEATURE_TO_CODE` map + lookups.
- `users/migrations/0006_menuright.py` — schema migration for `MenuRight`.
- `users/migrations/0007_backfill_menu_rights.py` — data migration backfilling from flags/roles.
- `users/test_menu_catalog.py`, `users/test_menu_rights.py`, `users/test_user_rights_api.py`, `users/test_menu_rights_migration.py` — tests.
- `core/test_menu_permissions.py` — `HasMenuRight` tests.

**Backend (modify):**
- `users/models.py` — `MenuRight` model + `User` menu helpers + reimplement `has_*_in` over `MenuRight`.
- `users/views.py` — `menu_catalog`, `user_rights` (GET/PATCH) views; `menu_rights` in `_membership_to_dict`.
- `users/urls.py` — routes for the two new endpoints.
- `core/permissions.py` — `HasMenuRight` class + `MenuGatedViewSet` mixin.
- Per-menu viewsets (Phase 4 checklist) — apply the mixin.

**Frontend (create):**
- `frontend/task-tracker/src/types/menuRights.ts` — catalog + rights DTOs.
- `frontend/task-tracker/src/lib/menuRightsApi.ts` — API client.
- `frontend/task-tracker/src/hooks/usePermissions.ts` — gating hook.
- `frontend/task-tracker/src/components/users/UserRightsMatrix.tsx` — the matrix grid.

**Frontend (modify):**
- `frontend/task-tracker/src/types/auth.ts` — add `menu_rights` to `ProfileOrg`; add helpers to `AuthHelpers`.
- `frontend/task-tracker/src/pages/UsersPage.tsx` — User Rights tab toggle.
- `frontend/task-tracker/src/components/header/NavMenu.tsx` + `src/App.tsx` — nav gating from rights.
- Multi-tab pages (Phase 3 checklist) — tab + edit-affordance gating.

---

## PHASE 1 — Catalog, model, migration, payload

### Task 1: Menu catalog module

**Files:**
- Create: `users/menu_catalog.py`
- Test: `users/test_menu_catalog.py`

- [ ] **Step 1: Write the failing test**

```python
# users/test_menu_catalog.py
from django.test import SimpleTestCase

from users.menu_catalog import MENU_CATALOG, ALL_CODES, top_level_code, FEATURE_TO_CODE


class MenuCatalogTests(SimpleTestCase):
    def test_codes_are_unique(self):
        codes = [n.code for n in MENU_CATALOG]
        self.assertEqual(len(codes), len(set(codes)))

    def test_parents_exist_and_precede_children(self):
        seen: set[str] = set()
        top_level: set[str] = set()
        for node in MENU_CATALOG:
            if node.parent is None:
                top_level.add(node.code)
            else:
                self.assertIn(node.parent, top_level, f"{node.code} parent missing/out of order")
                self.assertTrue(node.code.startswith(node.parent + "."))
            seen.add(node.code)

    def test_submenu_codes_dotted_under_parent(self):
        self.assertEqual(top_level_code("employee.salary"), "employee")
        self.assertEqual(top_level_code("board"), "board")

    def test_all_codes_matches_catalog(self):
        self.assertEqual(ALL_CODES, {n.code for n in MENU_CATALOG})

    def test_feature_map_targets_are_real_codes(self):
        for code in FEATURE_TO_CODE.values():
            self.assertIn(code, ALL_CODES)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_menu_catalog.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'users.menu_catalog'`.

- [ ] **Step 3: Write the catalog module**

```python
# users/menu_catalog.py
"""Single source of truth for the menu/submenu tree used by the User Rights
matrix and by nav/tab gating. Add a menu here and both the matrix rows and the
``/api/menu-catalog/`` payload pick it up automatically.

``code`` is the stable identifier persisted on ``MenuRight.menu_code`` — do NOT
rename an existing code without a data migration. Submenu codes are dotted
under their parent (``employee.salary``). Parents MUST precede their children.
"""

from typing import NamedTuple


class MenuNode(NamedTuple):
    code: str
    label: str
    parent: str | None  # None for top-level menus


MENU_CATALOG: list[MenuNode] = [
    MenuNode("board", "Board", None),
    MenuNode("dashboard", "Dashboard", None),
    MenuNode("calendar", "Calendar", None),
    MenuNode("worklog", "Work Log", None),
    MenuNode("worklog.log", "Log Table", "worklog"),
    MenuNode("worklog.plan", "Work Plan", "worklog"),
    MenuNode("worklog.dashboard", "Dashboard", "worklog"),
    MenuNode("leads", "Leads", None),
    MenuNode("leads.open", "Open", "leads"),
    MenuNode("leads.confirmed", "Confirmed", "leads"),
    MenuNode("leads.cancelled", "Cancelled", "leads"),
    MenuNode("clients", "Clients", None),
    MenuNode("clients.roadmap", "Road Map", "clients"),
    MenuNode("clients.mom", "MOM & Action Points", "clients"),
    MenuNode("clients.observation", "Observation Report", "clients"),
    MenuNode("clients.audit", "Internal Audit Report", "clients"),
    MenuNode("notice", "Notice", None),
    MenuNode("notice.open", "Open", "notice"),
    MenuNode("notice.completed", "Completed", "notice"),
    MenuNode("invoice", "Invoice", None),
    MenuNode("invoice.schedule", "Schedule", "invoice"),
    MenuNode("invoice.summary", "Summary", "invoice"),
    MenuNode("invoice.invoices", "Invoices", "invoice"),
    MenuNode("invoice.report", "Report", "invoice"),
    MenuNode("conveyance", "Conveyance", None),
    MenuNode("conveyance.transactions", "Transactions", "conveyance"),
    MenuNode("conveyance.employee_totals", "Employee Totals", "conveyance"),
    MenuNode("conveyance.client_totals", "Client Totals", "conveyance"),
    MenuNode("masters", "Masters", None),
    MenuNode("masters.orgs", "Organizations", "masters"),
    MenuNode("masters.clients", "Clients", "masters"),
    MenuNode("masters.categories", "Categories", "masters"),
    MenuNode("masters.team", "Team Members", "masters"),
    MenuNode("holidays", "Holidays", None),
    MenuNode("holidays.holidays", "Holidays", "holidays"),
    MenuNode("holidays.working_days", "Working Days", "holidays"),
    MenuNode("employee", "Employee", None),
    MenuNode("employee.personal", "Personal Info", "employee"),
    MenuNode("employee.salary", "Salary", "employee"),
    MenuNode("employee.leave", "Leave", "employee"),
    MenuNode("employee.matrix", "Matrix", "employee"),
    MenuNode("employee.attendance_log", "Attendance Log", "employee"),
    MenuNode("employee.approvals", "Approvals", "employee"),
    MenuNode("pace", "PACE", None),
    MenuNode("pace.meetings", "Meetings", "pace"),
    MenuNode("pace.standup", "Daily Standup", "pace"),
    MenuNode("pace.goals", "Goals", "pace"),
    MenuNode("pace.classification", "Client Classification", "pace"),
    MenuNode("pace.checklist", "Checklist", "pace"),
    MenuNode("growthplan", "Growth Plan", None),
    MenuNode("kaizen", "Kaizen", None),
    MenuNode("users", "Users", None),
    MenuNode("settings", "Settings", None),
]

ALL_CODES: set[str] = {n.code for n in MENU_CATALOG}

# Maps the legacy 7 OrgMembership boolean flags onto the catalog code that now
# represents them. Used by the backfill migration and the compat helpers.
FEATURE_TO_CODE: dict[str, str] = {
    "invoice_access": "invoice",
    "notice_access": "notice",
    "masters_access": "masters",
    "attendance_access": "employee.attendance_log",
    "employee_access": "employee",
    "leads_access": "leads",
    "conveyance_access": "conveyance",
}


def top_level_code(code: str) -> str:
    """The parent menu code for any code (``employee.salary`` -> ``employee``)."""
    return code.split(".", 1)[0]


def children_of(parent: str) -> list[MenuNode]:
    return [n for n in MENU_CATALOG if n.parent == parent]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest users/test_menu_catalog.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add users/menu_catalog.py users/test_menu_catalog.py
git commit -m "feat(users): declarative menu/submenu catalog"
```

---

### Task 2: `MenuRight` model + schema migration

**Files:**
- Modify: `users/models.py` (append after `OrgMembership`)
- Create: `users/migrations/0006_menuright.py` (generated)
- Test: `users/test_menu_rights.py`

- [ ] **Step 1: Write the failing test**

```python
# users/test_menu_rights.py
from django.test import TestCase

from users.models import MenuRight, Org, OrgMembership, User


class MenuRightModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="e@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.user, org=self.org, role="employee")

    def test_edit_forces_view_on_save(self):
        r = MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=False, can_edit=True)
        r.refresh_from_db()
        self.assertTrue(r.can_view)

    def test_unique_per_membership_and_code(self):
        MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True)
        with self.assertRaises(Exception):
            MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_menu_rights.py -v`
Expected: FAIL — `ImportError: cannot import name 'MenuRight'`.

- [ ] **Step 3: Add the model**

Append to `users/models.py` (after `OrgMembership`):

```python
class MenuRight(models.Model):
    """Per-membership View/Edit right on one catalog menu/submenu code.

    Sparse: a row exists only when something is granted. No row = no access.
    ``can_edit`` implies ``can_view`` (normalised in ``save``). Admins bypass
    this table entirely (see ``User.menu_view_in``).
    """

    id: int

    membership = models.ForeignKey(
        OrgMembership,
        on_delete=models.CASCADE,
        related_name="menu_rights",
    )
    menu_code = models.CharField(max_length=64)
    can_view = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)
    granted_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    granted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "users_menuright"
        unique_together = [("membership", "menu_code")]
        ordering = ["membership_id", "menu_code"]

    def save(self, *args, **kwargs):
        if self.can_edit:
            self.can_view = True
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        level = "edit" if self.can_edit else ("view" if self.can_view else "none")
        return f"{self.membership} / {self.menu_code} ({level})"
```

- [ ] **Step 4: Generate the migration**

Run: `uv run python manage.py makemigrations users`
Expected: creates `users/migrations/0006_menuright.py`. Confirm it adds one model, no unexpected field changes.

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest users/test_menu_rights.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add users/models.py users/migrations/0006_menuright.py users/test_menu_rights.py
git commit -m "feat(users): MenuRight model (sparse per-menu view/edit)"
```

---

### Task 3: `User` menu-right helpers (with admin override)

**Files:**
- Modify: `users/models.py` (add methods to `User`, in the per-org helpers section ~line 232)
- Test: `users/test_menu_rights.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `users/test_menu_rights.py`:

```python
class MenuRightHelperTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.emp = User.objects.create_user(email="emp@x", password="pw")
        self.adm = User.objects.create_user(email="adm@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.adm, org=self.org, role="admin")
        MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True, can_edit=False)
        MenuRight.objects.create(membership=self.m, menu_code="masters", can_view=True, can_edit=True)

    def test_view_and_edit_resolution(self):
        self.assertTrue(self.emp.menu_view_in(self.org, "invoice"))
        self.assertFalse(self.emp.menu_edit_in(self.org, "invoice"))
        self.assertTrue(self.emp.menu_edit_in(self.org, "masters"))
        self.assertFalse(self.emp.menu_view_in(self.org, "leads"))

    def test_admin_overrides_everything(self):
        self.assertTrue(self.adm.menu_view_in(self.org, "leads"))
        self.assertTrue(self.adm.menu_edit_in(self.org, "leads"))

    def test_rights_map_shape(self):
        m = self.emp.menu_rights_map(self.org)
        self.assertEqual(m["invoice"], {"view": True, "edit": False})
        self.assertEqual(m["masters"], {"view": True, "edit": True})
        self.assertNotIn("leads", m)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_menu_rights.py::MenuRightHelperTests -v`
Expected: FAIL — `AttributeError: 'User' object has no attribute 'menu_view_in'`.

- [ ] **Step 3: Add the helpers**

In `users/models.py`, add a typing hint near the other `User` manager hints (~line 121):

```python
    menu_rights: "models.Manager[MenuRight]"
```

And add these methods to `User` (after the access-flag helpers, ~line 294):

```python
    # ── Per-org menu rights (admins always full) ────────────────────────────
    def _membership_in(self, org) -> "OrgMembership | None":
        if org is None:
            return None
        org_pk = org.pk if hasattr(org, "pk") else org
        return self.memberships.filter(org_id=org_pk).first()

    def menu_view_in(self, org, code: str) -> bool:
        m = self._membership_in(org)
        if m is None:
            return False
        if m.role == "admin":
            return True
        return m.menu_rights.filter(menu_code=code, can_view=True).exists()

    def menu_edit_in(self, org, code: str) -> bool:
        m = self._membership_in(org)
        if m is None:
            return False
        if m.role == "admin":
            return True
        return m.menu_rights.filter(menu_code=code, can_edit=True).exists()

    def menu_rights_map(self, org) -> dict:
        """``{code: {"view": bool, "edit": bool}}`` for this org's membership.

        Sparse — only codes with a stored right appear. Admins are handled by
        the frontend via the membership ``role`` (they bypass the map).
        """
        m = self._membership_in(org)
        if m is None:
            return {}
        return {
            r.menu_code: {"view": r.can_view, "edit": r.can_edit}
            for r in m.menu_rights.all()
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest users/test_menu_rights.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add users/models.py users/test_menu_rights.py
git commit -m "feat(users): User.menu_view_in/menu_edit_in/menu_rights_map helpers"
```

---

### Task 4: Reimplement legacy `has_*_in` helpers over `MenuRight`

**Why:** keeps `core/permissions.py` and every existing access check working after `MenuRight` becomes authoritative, without touching call sites.

**Files:**
- Modify: `users/models.py` (`_has_access_in` / `_has_access_in_any`)
- Test: `users/test_menu_rights.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `users/test_menu_rights.py`:

```python
class LegacyHelperCompatTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.emp = User.objects.create_user(email="c@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        # MenuRight is the new source of truth — the legacy boolean is NOT set.
        MenuRight.objects.create(membership=self.m, menu_code="masters", can_view=True, can_edit=True)

    def test_legacy_helper_reads_from_menu_right(self):
        self.assertTrue(self.emp.has_masters_in(self.org))
        self.assertTrue(self.emp.has_masters_in_any())
        self.assertFalse(self.emp.has_invoice_in(self.org))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_menu_rights.py::LegacyHelperCompatTests -v`
Expected: FAIL — `has_masters_in` still reads the (unset) boolean column → returns False.

- [ ] **Step 3: Reimplement the private helpers**

In `users/models.py`, replace the bodies of `_has_access_in` / `_has_access_in_any` (~line 238) with reads over `MenuRight` via the feature→code map:

```python
    def _has_access_in(self, feature: str, org) -> bool:
        from users.menu_catalog import FEATURE_TO_CODE

        if org is None:
            return False
        org_pk = org.pk if hasattr(org, "pk") else org
        m = self.memberships.filter(org_id=org_pk).first()
        if m is None:
            return False
        if m.role == "admin":
            return True
        return m.menu_rights.filter(menu_code=FEATURE_TO_CODE[feature], can_view=True).exists()

    def _has_access_in_any(self, feature: str) -> bool:
        from users.menu_catalog import FEATURE_TO_CODE

        return MenuRight.objects.filter(
            membership__user=self,
            menu_code=FEATURE_TO_CODE[feature],
            can_view=True,
        ).exists() or self.memberships.filter(role="admin").exists()
```

> Note: `employee_access` previously gated **writes** in the Employee module (`IsAdminOrEmployeeAccess`). After Phase 4 that check is replaced by `HasMenuRight("employee")` at edit level. Until then, the compat helper above maps it to `can_view` on `employee`, which is correct for the existing read-breadth checks (attendance visibility). The one write-gate (`has_employee_in` in `IsAdminOrEmployeeAccess.has_object_permission`) is migrated in Task 18.

- [ ] **Step 4: Run the broad suite to confirm no regressions**

Run: `uv run pytest users/test_menu_rights.py core/attendance/test_employee_access.py core/employees/test_employee_access.py -v`
Expected: PASS. (These existing tests set the legacy booleans; see Task 5 — they must be updated to set `MenuRight` instead. If any fail because they create `OrgMembership(..., masters_access=True)`, that's expected and handled in Task 5's compat shim.)

> If existing tests fail here because they set legacy booleans directly, do NOT weaken the model. Instead keep the boolean columns writable AND have the compat helper fall back to the column when no MenuRight row exists — see Step 3b below.

- [ ] **Step 3b (only if Step 4 shows failures from tests setting legacy booleans): dual-read fallback**

Make the compat helpers prefer `MenuRight` but fall back to the legacy column so old data/tests still resolve:

```python
    def _has_access_in(self, feature: str, org) -> bool:
        from users.menu_catalog import FEATURE_TO_CODE

        if org is None:
            return False
        org_pk = org.pk if hasattr(org, "pk") else org
        m = self.memberships.filter(org_id=org_pk).first()
        if m is None:
            return False
        if m.role == "admin":
            return True
        code = FEATURE_TO_CODE[feature]
        if m.menu_rights.filter(menu_code=code, can_view=True).exists():
            return True
        return bool(getattr(m, feature, False))  # legacy fallback during transition
```

(Apply the analogous fallback to `_has_access_in_any`.)

- [ ] **Step 5: Commit**

```bash
git add users/models.py users/test_menu_rights.py
git commit -m "refactor(users): legacy access helpers read MenuRight (with column fallback)"
```

---

### Task 5: Data migration — backfill `MenuRight` from flags + roles

**Files:**
- Create: `users/migrations/0007_backfill_menu_rights.py`
- Test: `users/test_menu_rights_migration.py`

- [ ] **Step 1: Write the failing test**

```python
# users/test_menu_rights_migration.py
from django.test import TestCase

from users.menu_catalog import FEATURE_TO_CODE
from users.models import MenuRight, Org, OrgMembership, User

ALWAYS_ON_VIEW = [
    "board", "dashboard", "calendar", "worklog", "conveyance",
    "holidays", "employee", "pace", "kaizen", "settings",
]


def _seed_rights_for(membership):
    """Mirror of the migration's per-membership logic, callable in tests so we
    assert the SAME rule the migration applies. Imported by the migration too."""
    from users.migrations._menu_backfill import seed_membership_rights
    seed_membership_rights(MenuRight, membership)


class BackfillRuleTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")

    def test_employee_with_masters_flag_gets_view_edit(self):
        u = User.objects.create_user(email="m@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee", masters_access=True)
        m.menu_rights.all().delete()  # clear any auto-seed
        _seed_rights_for(m)
        r = MenuRight.objects.get(membership=m, menu_code="masters")
        self.assertTrue(r.can_view and r.can_edit)

    def test_always_on_menus_get_view_for_non_admin(self):
        u = User.objects.create_user(email="p@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee")
        m.menu_rights.all().delete()
        _seed_rights_for(m)
        for code in ALWAYS_ON_VIEW:
            self.assertTrue(
                m.menu_rights.filter(menu_code=code, can_view=True).exists(),
                f"missing always-on view: {code}",
            )

    def test_admin_seeds_nothing(self):
        u = User.objects.create_user(email="a@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="admin", masters_access=True)
        m.menu_rights.all().delete()
        _seed_rights_for(m)
        self.assertEqual(m.menu_rights.count(), 0)

    def test_growthplan_and_users_not_seeded_for_employee(self):
        u = User.objects.create_user(email="g@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee")
        m.menu_rights.all().delete()
        _seed_rights_for(m)
        self.assertFalse(m.menu_rights.filter(menu_code="growthplan").exists())
        self.assertFalse(m.menu_rights.filter(menu_code="users").exists())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_menu_rights_migration.py -v`
Expected: FAIL — `ModuleNotFoundError: users.migrations._menu_backfill`.

- [ ] **Step 3: Write the shared backfill helper**

```python
# users/migrations/_menu_backfill.py
"""Pure backfill logic shared by the data migration and its tests.

Takes the ``MenuRight`` model class (so it works with the historical model
inside a migration's ``apps.get_model``) and one membership instance.
"""

FEATURE_TO_CODE = {
    "invoice_access": "invoice",
    "notice_access": "notice",
    "masters_access": "masters",
    "attendance_access": "employee.attendance_log",
    "employee_access": "employee",
    "leads_access": "leads",
    "conveyance_access": "conveyance",
}

ALWAYS_ON_VIEW = [
    "board", "dashboard", "calendar", "worklog", "conveyance",
    "holidays", "employee", "pace", "kaizen", "settings",
]

# Submenus that should mirror their parent's level when the parent is granted.
SUBMENUS = {
    "worklog": ["worklog.log", "worklog.plan", "worklog.dashboard"],
    "leads": ["leads.open", "leads.confirmed", "leads.cancelled"],
    "clients": ["clients.roadmap", "clients.mom", "clients.observation", "clients.audit"],
    "notice": ["notice.open", "notice.completed"],
    "invoice": ["invoice.schedule", "invoice.summary", "invoice.invoices", "invoice.report"],
    "conveyance": ["conveyance.transactions", "conveyance.employee_totals", "conveyance.client_totals"],
    "masters": ["masters.orgs", "masters.clients", "masters.categories", "masters.team"],
    "holidays": ["holidays.holidays", "holidays.working_days"],
    "employee": [
        "employee.personal", "employee.salary", "employee.leave",
        "employee.matrix", "employee.attendance_log", "employee.approvals",
    ],
    "pace": ["pace.meetings", "pace.standup", "pace.goals", "pace.classification", "pace.checklist"],
}


def _grant(MenuRight, membership, code, view, edit):
    """Upsert, OR-ing the new levels onto any existing row (edit implies view)."""
    edit = bool(edit)
    view = bool(view) or edit
    row, created = MenuRight.objects.get_or_create(
        membership=membership, menu_code=code,
        defaults={"can_view": view, "can_edit": edit},
    )
    if not created:
        changed = False
        if view and not row.can_view:
            row.can_view = True
            changed = True
        if edit and not row.can_edit:
            row.can_edit, row.can_view = True, True
            changed = True
        if changed:
            row.save()


def seed_membership_rights(MenuRight, membership):
    if membership.role == "admin":
        return  # admins bypass the matrix entirely

    # 1. Always-on menus -> view (parent + submenus).
    for code in ALWAYS_ON_VIEW:
        _grant(MenuRight, membership, code, view=True, edit=False)
        for sub in SUBMENUS.get(code, []):
            _grant(MenuRight, membership, sub, view=True, edit=False)

    # 2. Legacy flags -> their menu at view+edit (parent + submenus).
    for feature, code in FEATURE_TO_CODE.items():
        if not getattr(membership, feature, False):
            continue
        parent = code.split(".", 1)[0]
        _grant(MenuRight, membership, code, view=True, edit=True)
        _grant(MenuRight, membership, parent, view=True, edit=True)
        for sub in SUBMENUS.get(parent, []):
            _grant(MenuRight, membership, sub, view=True, edit=True)
```

- [ ] **Step 4: Run the rule test to verify it passes**

Run: `uv run pytest users/test_menu_rights_migration.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Write the data migration**

```python
# users/migrations/0007_backfill_menu_rights.py
from django.db import migrations

from users.migrations._menu_backfill import seed_membership_rights


def forwards(apps, schema_editor):
    MenuRight = apps.get_model("users", "MenuRight")
    OrgMembership = apps.get_model("users", "OrgMembership")
    for m in OrgMembership.objects.all().iterator():
        seed_membership_rights(MenuRight, m)


def backwards(apps, schema_editor):
    apps.get_model("users", "MenuRight").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("users", "0006_menuright")]
    operations = [migrations.RunPython(forwards, backwards)]
```

- [ ] **Step 6: Verify the migration runs (and on real Postgres)**

Run: `uv run python manage.py migrate users`
Expected: applies `0006` then `0007` with no error.

> **CI is SQLite, prod is Postgres.** Before pushing, also run the full migration on a Postgres database (matching prod) and confirm `0007` completes — backfills that pass SQLite CI can still crash Postgres.

- [ ] **Step 7: Commit**

```bash
git add users/migrations/_menu_backfill.py users/migrations/0007_backfill_menu_rights.py users/test_menu_rights_migration.py
git commit -m "feat(users): backfill MenuRight from legacy flags + roles"
```

---

### Task 6: Expose `menu_rights` in the user payload

**Files:**
- Modify: `users/views.py` (`_membership_to_dict`, ~line 28)
- Test: `users/test_user_rights_api.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# users/test_user_rights_api.py
from django.test import TestCase
from rest_framework.test import APIClient

from users.models import MenuRight, Org, OrgMembership, User


class MePayloadTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.u = User.objects.create_user(email="e@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.u, org=self.org, role="employee")
        MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True, can_edit=True)

    def test_me_includes_menu_rights(self):
        c = APIClient()
        c.force_authenticate(user=self.u)
        resp = c.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        org0 = resp.json()["orgs"][0]
        self.assertEqual(org0["menu_rights"]["invoice"], {"view": True, "edit": True})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_user_rights_api.py::MePayloadTests -v`
Expected: FAIL — `KeyError: 'menu_rights'`.

- [ ] **Step 3: Add `menu_rights` to the membership dict**

In `users/views.py`, inside `_membership_to_dict`, after the `ACCESS_FEATURES` loop and before `return out`:

```python
    out["menu_rights"] = {
        r.menu_code: {"view": r.can_view, "edit": r.can_edit}
        for r in m.menu_rights.all()
    }
```

And in `UserSerializer.get_orgs`, widen the prefetch so this doesn't N+1:

```python
    def get_orgs(self, obj):
        qs = (
            obj.memberships.select_related("org")
            .prefetch_related("menu_rights")
            .order_by("-is_default", "org__name")
        )
        return [_membership_to_dict(m) for m in qs]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest users/test_user_rights_api.py::MePayloadTests -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add users/views.py users/test_user_rights_api.py
git commit -m "feat(users): include per-org menu_rights in user payload"
```

---

## PHASE 2 — Catalog + User Rights API + matrix UI

### Task 7: `GET /api/menu-catalog/`

**Files:**
- Modify: `users/views.py` (add view), `users/urls.py` (route)
- Test: `users/test_user_rights_api.py` (append)

- [ ] **Step 1: Write the failing test**

```python
class MenuCatalogEndpointTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.u = User.objects.create_user(email="e@x", password="pw")
        OrgMembership.objects.create(user=self.u, org=self.org, role="employee")

    def test_requires_auth(self):
        self.assertEqual(APIClient().get("/api/menu-catalog/").status_code, 401)

    def test_returns_ordered_tree(self):
        c = APIClient(); c.force_authenticate(user=self.u)
        resp = c.get("/api/menu-catalog/")
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertEqual(rows[0], {"code": "board", "label": "Board", "parent": None})
        codes = [r["code"] for r in rows]
        self.assertIn("employee.salary", codes)
        self.assertLess(codes.index("employee"), codes.index("employee.salary"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_user_rights_api.py::MenuCatalogEndpointTests -v`
Expected: FAIL — 404 (no route).

- [ ] **Step 3: Add the view**

In `users/views.py` (after the imports, add `from .menu_catalog import MENU_CATALOG`), then:

```python
@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def menu_catalog(request):
    """The ordered menu/submenu tree — drives the rights matrix and nav gating."""
    return Response([{"code": n.code, "label": n.label, "parent": n.parent} for n in MENU_CATALOG])
```

In `users/urls.py`, under the User-management section:

```python
    path("menu-catalog/", views.menu_catalog),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest users/test_user_rights_api.py::MenuCatalogEndpointTests -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add users/views.py users/urls.py users/test_user_rights_api.py
git commit -m "feat(users): GET /api/menu-catalog/ endpoint"
```

---

### Task 8: `GET /api/user-rights/?org=` (admin-only, per-org)

**Files:**
- Modify: `users/views.py` (add `user_rights` view, GET branch), `users/urls.py`
- Test: `users/test_user_rights_api.py` (append)

- [ ] **Step 1: Write the failing test**

```python
class UserRightsGetTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x", password="pw")
        self.emp = User.objects.create_user(email="e@x", password="pw")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        m = OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        MenuRight.objects.create(membership=m, menu_code="invoice", can_view=True)

    def test_non_admin_forbidden(self):
        c = APIClient(); c.force_authenticate(user=self.emp)
        self.assertEqual(c.get(f"/api/user-rights/?org={self.org.id}").status_code, 403)

    def test_admin_gets_member_rights(self):
        c = APIClient(); c.force_authenticate(user=self.admin)
        resp = c.get(f"/api/user-rights/?org={self.org.id}")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        users = {u["user_uid"]: u for u in body["users"]}
        self.assertTrue(users[str(self.admin.uid)]["is_admin"])
        self.assertEqual(users[str(self.emp.uid)]["rights"]["invoice"], {"view": True, "edit": False})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_user_rights_api.py::UserRightsGetTests -v`
Expected: FAIL — 404.

- [ ] **Step 3: Add the view (GET branch)**

In `users/views.py` (uses existing `_resolve_org`, `_caller_admin_orgs`):

```python
@api_view(["GET", "PATCH"])
@permission_classes([IsAdmin])
def user_rights(request):
    """Per-org User Rights matrix. Admin-only. GET returns the member grid;
    PATCH batch-saves rights (see Task 9)."""
    org = _resolve_org(request.query_params.get("org") or request.data.get("org"))
    if org is None:
        return Response({"error": "org is required"}, status=400)
    if org.id not in set(_caller_admin_orgs(request.user)):
        return Response({"error": "Not an admin of that organisation"}, status=403)

    if request.method == "GET":
        memberships = (
            OrgMembership.objects.filter(org=org)
            .select_related("user")
            .prefetch_related("menu_rights")
            .order_by("user__full_name", "user__email")
        )
        return Response(
            {
                "org_id": org.id,
                "org_uid": str(org.uid),
                "users": [
                    {
                        "user_uid": str(m.user.uid),
                        "full_name": m.user.full_name or m.user.email,
                        "is_admin": m.role == "admin",
                        "rights": {
                            r.menu_code: {"view": r.can_view, "edit": r.can_edit}
                            for r in m.menu_rights.all()
                        },
                    }
                    for m in memberships
                ],
            }
        )
    return _save_user_rights(request, org)  # defined in Task 9
```

In `users/urls.py`:

```python
    path("user-rights/", views.user_rights),
```

- [ ] **Step 4: Add a temporary stub so the module imports**

Add above `user_rights` (replaced in Task 9):

```python
def _save_user_rights(request, org):
    return Response({"error": "not implemented"}, status=501)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest users/test_user_rights_api.py::UserRightsGetTests -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add users/views.py users/urls.py users/test_user_rights_api.py
git commit -m "feat(users): GET /api/user-rights/ matrix endpoint"
```

---

### Task 9: `PATCH /api/user-rights/` (batch save)

**Files:**
- Modify: `users/views.py` (`_save_user_rights`)
- Test: `users/test_user_rights_api.py` (append)

- [ ] **Step 1: Write the failing test**

```python
class UserRightsPatchTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x", password="pw")
        self.emp = User.objects.create_user(email="e@x", password="pw")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")

    def _patch(self, body):
        c = APIClient(); c.force_authenticate(user=self.admin)
        return c.patch(f"/api/user-rights/?org={self.org.id}", body, format="json")

    def test_grants_and_normalises_edit_implies_view(self):
        resp = self._patch({str(self.emp.uid): {"invoice": {"view": False, "edit": True}}})
        self.assertEqual(resp.status_code, 200)
        m = OrgMembership.objects.get(user=self.emp, org=self.org)
        r = m.menu_rights.get(menu_code="invoice")
        self.assertTrue(r.can_view and r.can_edit)
        self.assertIsNotNone(r.granted_by_id)

    def test_clearing_both_deletes_the_row(self):
        m = OrgMembership.objects.get(user=self.emp, org=self.org)
        MenuRight.objects.create(membership=m, menu_code="invoice", can_view=True)
        self._patch({str(self.emp.uid): {"invoice": {"view": False, "edit": False}}})
        self.assertFalse(m.menu_rights.filter(menu_code="invoice").exists())

    def test_rejects_unknown_code(self):
        self.assertEqual(self._patch({str(self.emp.uid): {"nope": {"view": True}}}).status_code, 400)

    def test_rejects_editing_admin_member(self):
        self.assertEqual(
            self._patch({str(self.admin.uid): {"invoice": {"view": True}}}).status_code, 400
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest users/test_user_rights_api.py::UserRightsPatchTests -v`
Expected: FAIL — 501 stub.

- [ ] **Step 3: Implement `_save_user_rights`**

Replace the stub in `users/views.py` (add `from .menu_catalog import ALL_CODES` to imports):

```python
def _save_user_rights(request, org):
    """Batch-apply ``{user_uid: {menu_code: {view, edit}}}`` to the org's
    members. Validates codes, enforces edit->view, deletes emptied rows,
    rejects admin-member edits."""
    payload = request.data
    if not isinstance(payload, dict):
        return Response({"error": "body must be an object keyed by user_uid"}, status=400)

    memberships = {
        str(m.user.uid): m
        for m in OrgMembership.objects.filter(org=org).select_related("user")
    }

    with transaction.atomic():
        for user_uid, codes in payload.items():
            if user_uid == "org":
                continue
            m = memberships.get(str(user_uid))
            if m is None:
                return Response({"error": f"{user_uid} is not a member of {org.name}"}, status=400)
            if m.role == "admin":
                return Response({"error": "Admins always have full access; cannot edit"}, status=400)
            if not isinstance(codes, dict):
                return Response({"error": f"rights for {user_uid} must be an object"}, status=400)
            for code, levels in codes.items():
                if code not in ALL_CODES:
                    return Response({"error": f"unknown menu code: {code}"}, status=400)
                edit = bool(levels.get("edit"))
                view = bool(levels.get("view")) or edit
                if not view and not edit:
                    m.menu_rights.filter(menu_code=code).delete()
                    continue
                row, _ = MenuRight.objects.get_or_create(membership=m, menu_code=code)
                newly_granted = (view and not row.can_view) or (edit and not row.can_edit)
                row.can_view, row.can_edit = view, edit
                if newly_granted:
                    row.granted_by = request.user
                    row.granted_at = timezone.now()
                row.save()

    return user_rights_get_response(org)


def user_rights_get_response(org):
    """Return the same shape as the GET branch (reused after a save)."""
    memberships = (
        OrgMembership.objects.filter(org=org)
        .select_related("user")
        .prefetch_related("menu_rights")
        .order_by("user__full_name", "user__email")
    )
    return Response(
        {
            "org_id": org.id,
            "org_uid": str(org.uid),
            "users": [
                {
                    "user_uid": str(m.user.uid),
                    "full_name": m.user.full_name or m.user.email,
                    "is_admin": m.role == "admin",
                    "rights": {
                        r.menu_code: {"view": r.can_view, "edit": r.can_edit}
                        for r in m.menu_rights.all()
                    },
                }
                for m in memberships
            ],
        }
    )
```

Then refactor the GET branch in `user_rights` to `return user_rights_get_response(org)` so the shape lives in one place.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest users/test_user_rights_api.py -v`
Expected: PASS (all classes).

- [ ] **Step 5: Commit**

```bash
git add users/views.py users/test_user_rights_api.py
git commit -m "feat(users): PATCH /api/user-rights/ batch save with audit + validation"
```

---

### Task 10: Frontend types + API client

**Files:**
- Create: `frontend/task-tracker/src/types/menuRights.ts`
- Create: `frontend/task-tracker/src/lib/menuRightsApi.ts`
- Modify: `frontend/task-tracker/src/types/auth.ts` (add `menu_rights` to `ProfileOrg`)

- [ ] **Step 1: Add the menu-rights types**

```typescript
// frontend/task-tracker/src/types/menuRights.ts
import type { Uid } from "./api/common";

export interface MenuNodeDto {
  code: string;
  label: string;
  parent: string | null;
}

/** view/edit pair for one menu code. Edit implies View. */
export interface RightLevel {
  view: boolean;
  edit: boolean;
}

export type RightsMap = Record<string, RightLevel>;

export interface UserRightsRow {
  user_uid: Uid;
  full_name: string;
  is_admin: boolean;
  rights: RightsMap;
}

export interface UserRightsResponse {
  org_id: number;
  org_uid: Uid;
  users: UserRightsRow[];
}
```

- [ ] **Step 2: Add `menu_rights` to `ProfileOrg`**

In `frontend/task-tracker/src/types/auth.ts`, add to the `ProfileOrg` interface (after the access flags):

```typescript
  /** Per-menu view/edit rights for this membership. Sparse — only granted
   *  codes appear. Admins bypass this (gate on ``role === "admin"``). */
  menu_rights: Record<string, { view: boolean; edit: boolean }>;
```

- [ ] **Step 3: Add the API client**

```typescript
// frontend/task-tracker/src/lib/menuRightsApi.ts
import { apiGet, apiPatch } from "@/lib/api";
import type { MenuNodeDto, RightsMap, UserRightsResponse } from "@/types/menuRights";

export const fetchMenuCatalog = (): Promise<MenuNodeDto[]> =>
  apiGet<MenuNodeDto[]>("/menu-catalog/");

export const fetchUserRights = (orgUid: string): Promise<UserRightsResponse> =>
  apiGet<UserRightsResponse>(`/user-rights/?org=${encodeURIComponent(orgUid)}`);

/** Batch-save. ``changes`` maps user_uid -> menu_code -> {view, edit}. */
export const saveUserRights = (
  orgUid: string,
  changes: Record<string, RightsMap>,
): Promise<UserRightsResponse> =>
  apiPatch<UserRightsResponse>(
    `/user-rights/?org=${encodeURIComponent(orgUid)}`,
    changes,
  );
```

- [ ] **Step 4: Typecheck**

Run (from `frontend/task-tracker`): `npm run build`
Expected: builds clean (no TS errors). If `apiPatch` generic differs, match its existing signature in `src/lib/api.ts`.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/types/menuRights.ts frontend/task-tracker/src/lib/menuRightsApi.ts frontend/task-tracker/src/types/auth.ts
git commit -m "feat(users): frontend menu-rights types + api client"
```

---

### Task 11: `UserRightsMatrix` component

**Files:**
- Create: `frontend/task-tracker/src/components/users/UserRightsMatrix.tsx`

This is the image1 grid: org selector handled by parent, menus as rows (submenus indented), users as columns, View+Edit checkboxes per cell, admin columns locked, batch Cancel/Save.

- [ ] **Step 1: Write the component**

```tsx
// frontend/task-tracker/src/components/users/UserRightsMatrix.tsx
import { useEffect, useMemo, useState } from "react";
import {
  fetchMenuCatalog,
  fetchUserRights,
  saveUserRights,
} from "@/lib/menuRightsApi";
import type {
  MenuNodeDto,
  RightLevel,
  RightsMap,
  UserRightsResponse,
} from "@/types/menuRights";

interface Props {
  /** Org uid whose matrix to edit. */
  orgUid: string;
}

type Draft = Record<string, RightsMap>; // user_uid -> code -> level

const EMPTY: RightLevel = { view: false, edit: false };

export default function UserRightsMatrix({ orgUid }: Props) {
  const [catalog, setCatalog] = useState<MenuNodeDto[]>([]);
  const [data, setData] = useState<UserRightsResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load catalog once + rights whenever the org changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [cat, rights] = await Promise.all([
        fetchMenuCatalog(),
        fetchUserRights(orgUid),
      ]);
      if (cancelled) return;
      setCatalog(cat);
      setData(rights);
      setDraft(buildDraft(rights));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgUid]);

  const dirty = useMemo(
    () => (data ? JSON.stringify(draft) !== JSON.stringify(buildDraft(data)) : false),
    [draft, data],
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    // Keep a parent if it or any of its children match.
    const matches = (n: MenuNodeDto) => n.label.toLowerCase().includes(q);
    const keepParents = new Set(
      catalog.filter((n) => n.parent && matches(n)).map((n) => n.parent!),
    );
    return catalog.filter(
      (n) => matches(n) || keepParents.has(n.code) || (n.parent && keepParents.has(n.parent)),
    );
  }, [catalog, search]);

  if (loading || !data) return <div style={{ padding: 24 }}>Loading rights…</div>;

  const cell = (uid: string, code: string): RightLevel =>
    draft[uid]?.[code] ?? EMPTY;

  const setCell = (uid: string, code: string, next: RightLevel) => {
    // Edit implies View; clearing View clears Edit.
    const norm: RightLevel = next.edit
      ? { view: true, edit: true }
      : { view: next.view, edit: false };
    setDraft((d) => ({
      ...d,
      [uid]: { ...(d[uid] ?? {}), [code]: norm },
    }));
  };

  const toggleSubtree = (uid: string, parent: string, level: "view" | "edit") => {
    const subs = catalog.filter((n) => n.parent === parent).map((n) => n.code);
    const all = [parent, ...subs];
    const turnOn = !all.every((c) => cell(uid, c)[level]);
    setDraft((d) => {
      const userMap = { ...(d[uid] ?? {}) };
      for (const c of all) {
        userMap[c] =
          level === "edit"
            ? { view: turnOn, edit: turnOn }
            : { view: turnOn, edit: turnOn ? (userMap[c]?.edit ?? false) : false };
      }
      return { ...d, [uid]: userMap };
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      // Only send users whose rights changed.
      const base = buildDraft(data);
      const changes: Draft = {};
      for (const uid of Object.keys(draft)) {
        if (JSON.stringify(draft[uid]) !== JSON.stringify(base[uid] ?? {})) {
          changes[uid] = draft[uid];
        }
      }
      const fresh = await saveUserRights(orgUid, changes);
      setData(fresh);
      setDraft(buildDraft(fresh));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Search menu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 10px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 13, width: 260 }}
        />
        <span style={{ marginLeft: "auto" }} />
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => setDraft(buildDraft(data))}
          style={btn(!dirty || saving, "#64748b", "#f1f5f9")}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          style={btn(!dirty || saving, "#fff", "#16a34a")}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr style={{ background: "#1e293b", color: "#fff" }}>
              <th style={{ textAlign: "left", padding: "10px 12px", position: "sticky", left: 0, background: "#1e293b" }}>
                Menu
              </th>
              {data.users.map((u) => (
                <th key={u.user_uid} style={{ padding: "8px 10px", minWidth: 96 }}>
                  <div>{u.full_name}</div>
                  {u.is_admin && <div style={{ fontSize: 10, opacity: 0.8 }}>admin · full</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((node) => (
              <tr key={node.code} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td
                  style={{
                    padding: "6px 12px",
                    paddingLeft: node.parent ? 32 : 12,
                    position: "sticky",
                    left: 0,
                    background: "#fff",
                    fontWeight: node.parent ? 400 : 600,
                    color: node.parent ? "#475569" : "#1e293b",
                  }}
                >
                  {node.label}
                </td>
                {data.users.map((u) => {
                  const c = cell(u.user_uid, node.code);
                  const locked = u.is_admin;
                  const isParent = !node.parent && catalog.some((n) => n.parent === node.code);
                  return (
                    <td key={u.user_uid} style={{ textAlign: "center", padding: "4px 6px" }}>
                      <label style={{ marginRight: 6, opacity: locked ? 0.5 : 1 }} title="View">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={locked || c.view}
                          onChange={(e) =>
                            isParent
                              ? toggleSubtree(u.user_uid, node.code, "view")
                              : setCell(u.user_uid, node.code, { ...c, view: e.target.checked })
                          }
                        />{" "}
                        V
                      </label>
                      <label style={{ opacity: locked ? 0.5 : 1 }} title="Edit">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={locked || c.edit}
                          onChange={(e) =>
                            isParent
                              ? toggleSubtree(u.user_uid, node.code, "edit")
                              : setCell(u.user_uid, node.code, { ...c, edit: e.target.checked })
                          }
                        />{" "}
                        E
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function buildDraft(r: UserRightsResponse): Record<string, RightsMap> {
  const d: Record<string, RightsMap> = {};
  for (const u of r.users) d[u.user_uid] = { ...u.rights };
  return d;
}

function btn(disabled: boolean, color: string, bg: string) {
  return {
    padding: "7px 16px",
    borderRadius: 6,
    border: "none",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    color,
    background: bg,
    opacity: disabled ? 0.6 : 1,
  } as const;
}
```

- [ ] **Step 2: Typecheck/build**

Run (from `frontend/task-tracker`): `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/users/UserRightsMatrix.tsx
git commit -m "feat(users): User Rights matrix grid component"
```

---

### Task 12: Wire the matrix as a tab on the Users page

**Files:**
- Modify: `frontend/task-tracker/src/pages/UsersPage.tsx`

- [ ] **Step 1: Add a sub-view toggle + render the matrix**

Near the top of the `UsersPage` component body (after the `useState` hooks), add:

```tsx
  const [tab, setTab] = useState<"users" | "rights">("users");
  // Matrix is per-org; default to the caller's first admin org, fall back to
  // the header-selected org if it's one they admin.
  const rightsOrgUid =
    (selectedOrg && adminOrgs.some((o) => o.uid === selectedOrg) && selectedOrg) ||
    defaultOrgUid;
```

Add the import at the top:

```tsx
import UserRightsMatrix from "@/components/users/UserRightsMatrix";
```

In the header block (just after the `<div className="page-title">…</div>` group), add a segmented toggle:

```tsx
        <div style={{ display: "flex", gap: 4, background: "#f1f5f9", padding: 3, borderRadius: 8 }}>
          {(["users", "rights"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                background: tab === t ? "#fff" : "transparent",
                color: tab === t ? "#1e293b" : "#64748b",
                boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,.12)" : "none",
              }}
            >
              {t === "users" ? "👥 User Management" : "🔒 User Rights"}
            </button>
          ))}
        </div>
```

Wrap the existing users content (stats strip + `<div style={boxStyle}><UserTable …/></div>`) so it only renders on the users tab, and render the matrix on the rights tab:

```tsx
      {tab === "rights" ? (
        <div style={boxStyle}>
          {rightsOrgUid ? (
            <UserRightsMatrix orgUid={rightsOrgUid} />
          ) : (
            <div style={{ padding: 16, color: "#64748b" }}>
              You are not an admin of any organisation.
            </div>
          )}
        </div>
      ) : (
        <>
          {/* existing stats strip + users table JSX moves here unchanged */}
        </>
      )}
```

- [ ] **Step 2: Build**

Run (from `frontend/task-tracker`): `npm run build`
Expected: clean build.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Use the `/run` skill to launch the app, sign in as an admin, open Users → User Rights, toggle a cell, Save, refresh, confirm it persists.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/pages/UsersPage.tsx
git commit -m "feat(users): User Rights tab on the Users page"
```

---

## PHASE 3 — Frontend enforcement (nav, tabs, edit affordances)

### Task 13: `usePermissions()` hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/usePermissions.ts`

- [ ] **Step 1: Write the hook**

```typescript
// frontend/task-tracker/src/hooks/usePermissions.ts
import { useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ProfileOrg } from "@/types/auth";

/** Resolve view/edit rights for the active org. Admins always allowed.
 *  ``activeOrgUid`` is the header-selected org (empty => default org). */
export function usePermissions(activeOrgUid?: string) {
  const { orgs, defaultOrg } = useAuth();

  const org: ProfileOrg | null = useMemo(() => {
    if (activeOrgUid) return orgs.find((o) => o.uid === activeOrgUid) ?? defaultOrg;
    return defaultOrg;
  }, [orgs, defaultOrg, activeOrgUid]);

  const canView = useCallback(
    (code: string): boolean => {
      if (!org) return false;
      if (org.role === "admin") return true;
      return org.menu_rights?.[code]?.view ?? false;
    },
    [org],
  );

  const canEdit = useCallback(
    (code: string): boolean => {
      if (!org) return false;
      if (org.role === "admin") return true;
      return org.menu_rights?.[code]?.edit ?? false;
    },
    [org],
  );

  return { canView, canEdit, org };
}
```

- [ ] **Step 2: Build**

Run (from `frontend/task-tracker`): `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/hooks/usePermissions.ts
git commit -m "feat(users): usePermissions hook (view/edit per active org)"
```

---

### Task 14: Nav gating from rights

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`, `frontend/task-tracker/src/components/header/NavMenu.tsx`

Today nav visibility uses `useAccessRoles` (the 7 flags) + `isAdmin`. Switch the gate so a menu shows iff `canView(<code>)`. Keep `useAccessRoles` only if still referenced elsewhere; prefer replacing its consumers.

- [ ] **Step 1: Compute a per-menu visible map in App**

In `src/App.tsx`, near the existing access derivation (~line 84), add:

```tsx
  const { canView } = usePermissions(/* activeOrgUid from header filter */ selectedOrgUid);
  // NAV_CODES maps each nav tab id to its catalog code.
  const navVisible = useMemo(
    () => ({
      board: canView("board"),
      dashboard: canView("dashboard"),
      calendar: canView("calendar"),
      worklog: canView("worklog"),
      leads: canView("leads"),
      clients: canView("clients"),
      notice: canView("notice"),
      invoice: canView("invoice"),
      conveyance: canView("conveyance"),
      masters: canView("masters"),
      holidays: canView("holidays"),
      employee: canView("employee"),
      pace: canView("pace"),
      growthplan: canView("growthplan"),
      kaizen: canView("kaizen"),
      users: canView("users"),
      settings: canView("settings"),
    }),
    [canView],
  );
```

Add `import { usePermissions } from "@/hooks/usePermissions";`. Use the existing header org-filter value for `selectedOrgUid` (the same value passed to `UsersPage`); if none, the hook falls back to the default org.

- [ ] **Step 2: Pass the map to NavMenu and gate each tab**

Change `NavMenuProps` to accept `navVisible: Record<string, boolean>` (replace the individual `hasInvoiceAccess`/etc. booleans), and in `NAV_TABS_RAW` gate every entry uniformly:

```tsx
    const NAV_TABS_RAW: NavTab[] = [
      ...(navVisible.board ? [{ id: "board", label: "Board", icon: icons.board }] : []),
      ...(navVisible.dashboard ? [{ id: "dashboard", label: "Dashboard", icon: icons.dashboard }] : []),
      ...(navVisible.calendar ? [{ id: "calendar", label: "Calendar", icon: icons.calendar }] : []),
      ...(navVisible.worklog ? [{ id: "worklog", label: "Work Log", icon: icons.worklog }] : []),
      ...(navVisible.leads ? [{ id: "leads", label: "Leads", icon: icons.leads }] : []),
      ...(navVisible.clients ? [{ id: "clients", label: "Clients", icon: icons.clients }] : []),
      ...(navVisible.notice ? [{ id: "notice", label: "Notice", icon: icons.notice }] : []),
      ...(navVisible.invoice ? [{ id: "invoice", label: "Invoice", icon: icons.invoice }] : []),
      ...(navVisible.conveyance ? [{ id: "conveyance", label: "Conveyance", icon: icons.conveyance }] : []),
      ...(navVisible.masters ? [{ id: "masters", label: "Masters", icon: icons.masters }] : []),
      ...(navVisible.holidays ? [{ id: "holidays", label: "Holidays", icon: icons.holidays }] : []),
      ...(navVisible.employee ? [{ id: "employee", label: "Employee", icon: icons.employee }] : []),
      ...(navVisible.pace ? [{ id: "pace", label: "PACE", icon: icons.pacecheck }] : []),
      ...(navVisible.growthplan ? [{ id: "growthplan", label: "Growth Plan", icon: icons.growthplan }] : []),
      ...(navVisible.kaizen ? [{ id: "kaizen", label: "Kaizen", icon: icons.kaizen }] : []),
      ...(navVisible.users ? [{ id: "users", label: "Users", icon: icons.users }] : []),
      ...(navVisible.settings ? [{ id: "settings", label: "Settings", icon: icons.settings }] : []),
    ];
```

Update the `useMemo` dependency array to `[tabOrder, icons, navVisible]`.

- [ ] **Step 3: Guard the active-view render**

In `src/App.tsx`, the view map (~line 420) gates some views (`masters`, `users`, `invoice`, `notice`, `growthplan`) on the old flags. Replace those conditions with `navVisible.<code>` and add a fallback: if `!navVisible[currentView]`, render a "You don't have access to this menu" panel instead of the page (prevents deep-linking to a hidden view).

- [ ] **Step 4: Build + smoke**

Run (from `frontend/task-tracker`): `npm run build`
Expected: clean. Then via `/run`: sign in as a non-admin employee whose rights grant only some menus; confirm the nav shows exactly those menus.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/App.tsx frontend/task-tracker/src/components/header/NavMenu.tsx
git commit -m "feat(users): gate nav menus on menu_rights view"
```

---

### Task 15: Submenu (tab) gating within pages

**Pattern (apply per page):** import `usePermissions`, and for each tab render the tab button only if `canView("<menu>.<sub>")`; if the currently-selected tab becomes hidden, fall back to the first visible tab.

**Representative example — Employee page:**

- [ ] **Step 1: Gate Employee tabs**

In `frontend/task-tracker/src/pages/EmployeePage.tsx`:

```tsx
import { usePermissions } from "@/hooks/usePermissions";
// inside component:
const { canView } = usePermissions(activeOrgUid);
const EMP_TABS = [
  { id: "personal", code: "employee.personal", label: "Personal Info" },
  { id: "salary", code: "employee.salary", label: "Salary" },
  { id: "leave", code: "employee.leave", label: "Leave" },
  { id: "matrix", code: "employee.matrix", label: "Matrix" },
  { id: "attendance_log", code: "employee.attendance_log", label: "Attendance Log" },
  { id: "approvals", code: "employee.approvals", label: "Approvals" },
].filter((t) => canView(t.code));
// render only EMP_TABS; if the active tab id isn't in EMP_TABS, switch to EMP_TABS[0].
```

- [ ] **Step 2: Repeat for every multi-tab page using its catalog codes:**

| Page file | Codes |
|---|---|
| `pages/WorkLogPage.tsx` | `worklog.log`, `worklog.plan`, `worklog.dashboard` |
| `pages/LeadsPage.tsx` | `leads.open`, `leads.confirmed`, `leads.cancelled` |
| `pages/ClientsPage.tsx` | `clients.roadmap`, `clients.mom`, `clients.observation`, `clients.audit` |
| `pages/NoticePage.tsx` | `notice.open`, `notice.completed` |
| `pages/InvoicePage.tsx` | `invoice.schedule`, `invoice.summary`, `invoice.invoices`, `invoice.report` |
| `pages/ConveyancePage.tsx` | `conveyance.transactions`, `conveyance.employee_totals`, `conveyance.client_totals` |
| `pages/MastersPage.tsx` | `masters.orgs`, `masters.clients`, `masters.categories`, `masters.team` |
| `pages/HolidayMasterPage.tsx` | `holidays.holidays`, `holidays.working_days` |
| `pages/PacePage.tsx` | `pace.meetings`, `pace.standup`, `pace.goals`, `pace.classification`, `pace.checklist` |

For each: filter the tab list by `canView(code)`, and ensure the active tab falls back to the first visible one when its tab is hidden. Build after each page (`npm run build`).

- [ ] **Step 3: Commit (one commit per ~3 pages is fine)**

```bash
git add frontend/task-tracker/src/pages/EmployeePage.tsx
git commit -m "feat(users): gate Employee submenu tabs on rights"
```

---

### Task 16: Edit-affordance gating

**Pattern:** within a tab, wrap create/edit/delete buttons and form submits so they're hidden or disabled when `!canEdit("<code>")`. Use the most specific code available (submenu code if the action lives in a submenu, else the menu code).

- [ ] **Step 1: Representative — gate the Masters → Categories add/edit buttons**

In the Categories section component, derive `const editable = canEdit("masters.categories");` and gate:

```tsx
{editable && <button onClick={openAddCategory}>+ Add Category</button>}
// and disable row edit/delete controls when !editable
```

- [ ] **Step 2: Apply to the primary write actions of each menu/submenu**

Walk each page's create/update/delete controls and gate on the matching code from the Task 15 table (or the parent menu code for single-view menus: `board`, `dashboard`, `calendar`, `growthplan`, `kaizen`, `settings`). Build after each.

- [ ] **Step 3: Commit**

```bash
git add -A frontend/task-tracker/src
git commit -m "feat(users): gate edit affordances on canEdit"
```

> Backend remains the source of truth for writes (Phase 4) — frontend gating is UX, not security.

---

## PHASE 4 — Backend enforcement

### Task 17: `HasMenuRight` permission class + `MenuGatedViewSet` mixin

**Files:**
- Modify: `core/permissions.py`
- Test: `core/test_menu_permissions.py`

- [ ] **Step 1: Write the failing test**

```python
# core/test_menu_permissions.py
from django.test import RequestFactory, TestCase

from core.permissions import HasMenuRight
from users.models import MenuRight, Org, OrgMembership, User


class _View:
    menu_code = "invoice"

    def __init__(self, org):
        self._org = org

    def get_menu_org(self, request):
        return self._org


class HasMenuRightTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.viewer = User.objects.create_user(email="v@x", password="pw")
        self.editor = User.objects.create_user(email="ed@x", password="pw")
        self.admin = User.objects.create_user(email="a@x", password="pw")
        mv = OrgMembership.objects.create(user=self.viewer, org=self.org, role="employee")
        me = OrgMembership.objects.create(user=self.editor, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        MenuRight.objects.create(membership=mv, menu_code="invoice", can_view=True)
        MenuRight.objects.create(membership=me, menu_code="invoice", can_view=True, can_edit=True)
        self.rf = RequestFactory()

    def _check(self, user, method):
        req = getattr(self.rf, method.lower())("/")
        req.user = user
        return HasMenuRight().has_permission(req, _View(self.org))

    def test_view_can_read_not_write(self):
        self.assertTrue(self._check(self.viewer, "GET"))
        self.assertFalse(self._check(self.viewer, "POST"))

    def test_editor_can_write(self):
        self.assertTrue(self._check(self.editor, "POST"))

    def test_admin_overrides(self):
        self.assertTrue(self._check(self.admin, "DELETE"))

    def test_anonymous_denied(self):
        from django.contrib.auth.models import AnonymousUser

        req = self.rf.get("/")
        req.user = AnonymousUser()
        self.assertFalse(HasMenuRight().has_permission(req, _View(self.org)))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest core/test_menu_permissions.py -v`
Expected: FAIL — `ImportError: cannot import name 'HasMenuRight'`.

- [ ] **Step 3: Add the permission class + mixin**

Append to `core/permissions.py`:

```python
class HasMenuRight(permissions.BasePermission):
    """Generic menu-rights gate.

    The view must expose ``menu_code`` (str) and ``get_menu_org(request)``
    returning the Org the right is checked against. SAFE_METHODS require
    ``can_view``; writes require ``can_edit``. Admins override.
    """

    def has_permission(self, request, view):
        u = _as_user(request)
        if u is None:
            return False
        org = view.get_menu_org(request)
        code = view.menu_code
        if request.method in permissions.SAFE_METHODS:
            return u.menu_view_in(org, code)
        return u.menu_edit_in(org, code)


class MenuGatedViewSet:
    """Mixin: set ``menu_code`` and implement ``get_menu_org`` (or rely on the
    default below) to gate a viewset on menu rights."""

    menu_code: str = ""
    permission_classes = [HasMenuRight]

    def get_menu_org(self, request):
        """Default: the org from the ``?org=`` query param, else the caller's
        default org. Override for viewsets that resolve org differently."""
        from users.views import _resolve_org

        ident = request.query_params.get("org") or request.data.get("org")
        org = _resolve_org(ident)
        if org is not None:
            return org
        u = _as_user(request)
        return u.default_org if u else None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest core/test_menu_permissions.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add core/permissions.py core/test_menu_permissions.py
git commit -m "feat(core): HasMenuRight permission class + MenuGatedViewSet mixin"
```

---

### Task 18: Wire `HasMenuRight` onto each menu's viewset

For each menu's primary resource viewset (and submenus that own a distinct endpoint), set `menu_code`, add `HasMenuRight` to `permission_classes`, and ensure `get_menu_org` resolves the row's org. **Do one viewset per cycle: add a focused test → wire → run → commit.**

**Per-menu wiring checklist** (file → `menu_code`). Use the existing viewset in each app's `views.py`:

| Menu / submenu | Viewset location | `menu_code` |
|---|---|---|
| Work Log | `core/worklog/views.py` | `worklog` |
| Leads | `core/leads/views.py` (leads viewset) | `leads` |
| Clients (roadmap/mom/observation/audit have distinct viewsets) | `core/*` client viewsets | `clients` (+ `clients.observation`, `clients.audit` where separate) |
| Notice | `core/notice` views | `notice` |
| Invoice | `core/invoice` views | `invoice` |
| Conveyance | `core/conveyance` views | `conveyance` |
| Masters: orgs | `users/views.py:OrgViewSet` | `masters.orgs` |
| Masters: categories | masters category viewset | `masters.categories` |
| Masters: clients | masters client viewset | `masters.clients` |
| Holidays | `core/.../holiday` views | `holidays` |
| Employee (personal) | `core/employees/views.py` | `employee` |
| Employee: salary | salary viewset | `employee.salary` |
| Employee: attendance/matrix | `core/attendance/views.py` | `employee.attendance_log` |
| Employee: approvals | leave/WFH approval viewset | `employee.approvals` |
| PACE | `core/pace/views.py` (per sub-resource) | `pace` (+ `pace.standup`, `pace.goals`, `pace.checklist` where separate) |
| Growth Plan | growth plan viewset | `growthplan` |
| Kaizen | `core/...kaizen` views | `kaizen` |

**Not backend-gated (frontend-only, by design — see spec):** `leads.open/confirmed/cancelled`, `notice.open/completed`, `conveyance.employee_totals`, `conveyance.client_totals`, `worklog.*`, `invoice.summary/report`, `clients.roadmap/mom`, `masters.team` (avatar recolour stays open per existing `set_avatar_color` design). These are filtered views/roll-ups of an already-gated resource.

**Per-viewset procedure (repeat for each row):**

- [ ] **Step 1: Add a focused test** (model on `core/attendance/test_employee_access.py`): a `view`-only user can GET but not POST/PATCH/DELETE; an `edit` user can write; an admin can write; a user with no right gets 403 on GET.

- [ ] **Step 2: Wire the viewset**

```python
from core.permissions import HasMenuRight  # or MenuGatedViewSet

class ThingViewSet(ModelViewSet):
    menu_code = "invoice"            # the code from the table
    permission_classes = [HasMenuRight]

    def get_menu_org(self, request):
        # resolve the org these rows belong to; for org-scoped lists use the
        # ?org filter, else the caller's default org. For object writes the
        # existing queryset filtering already restricts to the caller's orgs.
        from users.views import _resolve_org
        return _resolve_org(request.query_params.get("org") or request.data.get("org")) or request.user.default_org
```

Where a viewset currently uses a flag-based class (`IsAdminOrReadOnlyInAny`, `IsAdminOrEmployeeAccess`, etc.), **replace** it with `HasMenuRight` once the test passes. For `IsAdminOrEmployeeAccess` (Employee module write-gate), `HasMenuRight` with `menu_code="employee"` reproduces it (view=read, edit=write, admin override).

- [ ] **Step 3: Run that viewset's test + the app's existing suite**

Run: `uv run pytest <app>/ -v`
Expected: PASS, including pre-existing tests (update any that relied on the old flag by granting the equivalent `MenuRight` in their `setUp`).

- [ ] **Step 4: Commit** (one per viewset)

```bash
git add <app>/views.py <app>/test_*.py
git commit -m "feat(<app>): gate <Menu> viewset on HasMenuRight"
```

---

## Final verification (before pushing)

- [ ] **Full backend suite:** `uv run pytest`
  Expected: all pass.
- [ ] **Frontend build + typecheck:** from `frontend/task-tracker`, `npm run build`
  Expected: clean.
- [ ] **Migrations on Postgres:** run `0006`+`0007` against a Postgres DB matching prod; confirm no error and that a spot-checked employee retains their prior access (nav menus unchanged).
- [ ] **Pre-commit (covers ruff/format/line-endings/mypy/pyright/eslint/tsc/build):** `uv run pre-commit run --all-files`
  Expected: all hooks pass.
- [ ] **Manual smoke via `/run`:** admin edits the matrix and saves; a non-admin sees exactly their granted menus/tabs and is blocked from writing where they only have View; a 403 is returned by the API for an ungranted write.
- [ ] **Push** (auto-commit/push per user preference) and open a PR to `main`.

---

## Notes for the implementer

- **DRY:** the backfill rule lives only in `users/migrations/_menu_backfill.py`; the matrix-response shape lives only in `user_rights_get_response`; the catalog lives only in `users/menu_catalog.py`.
- **YAGNI:** no "copy rights from another user", no admin-rights editing, no dropping legacy columns — all explicitly out of scope.
- **Edit implies View** is enforced in three places (model `save`, PATCH handler, matrix UI) — keep all three consistent.
- **Admins bypass** the matrix everywhere: model helpers, `HasMenuRight`, the PATCH handler rejects admin edits, and the matrix UI locks admin columns.
