# Employee Attendance, Leave & Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WFH approval, simple Leave application + approval, monthly employee×date Matrix view, Sunday/holiday handling with admin override, realtime approver badge, and full org-picker support — all under the **Employee** tab.

**Architecture:** Extend the existing `Attendance` model with WFH approval fields and a `leave_session` discriminator, add two new tables (`LeaveRequest`, `WorkingDayOverride`), and add corresponding DRF viewsets that reuse `core/org_utils` for visibility + create rules. Frontend introduces three Employee sub-tabs (Attendance/Leave/Approvals) and removes the top-level Attendance tab. Real-time uses the existing `broadcast()` SSE channel.

**Tech Stack:** Django 6 + DRF, Channels (SSE/WS), React 19 + Vite + TypeScript, Vitest for unit tests.

**Commit + push policy for this feature:** commit at every checkpoint locally; **do not push** until the user explicitly says "push." (See `feedback_auto_push.md` exception.)

**Spec:** [docs/superpowers/specs/2026-04-25-employee-attendance-leave-approvals-design.md](../specs/2026-04-25-employee-attendance-leave-approvals-design.md)

---

## File Structure

| File | Responsibility | Change type | Phase |
|---|---|---|---|
| `core/attendance/models.py` | Adds `approval_state`, `approver`, `approved_at`, `rejection_reason`, `leave_session` to `Attendance`. | Modify | 1 |
| `core/attendance/migrations/0003_attendance_wfh_approval.py` | Schema migration for the new fields + index. | Create | 1 |
| `core/attendance/migrations/0004_backfill_wfh_approved.py` | Data migration: existing WFH rows → `approval_state='Approved'`. | Create | 1 |
| `core/attendance/serializers.py` | Surface new fields read-only; add nested approver name. | Modify | 1 |
| `core/attendance/views.py` | Add `approve_wfh`, `reject_wfh`, `approvals_pending`, `matrix` actions. | Modify | 1, 4 |
| `core/attendance/matrix.py` | Pure-Python cell-derivation logic (priority order from §Matrix view). Testable in isolation. | Create | 4 |
| `core/leave/__init__.py` | New Django app marker. | Create | 1 |
| `core/leave/apps.py` | App config + signal registration. | Create | 1 |
| `core/leave/models.py` | `LeaveRequest` model, `apply_state_transition()` method. | Create | 1 |
| `core/leave/migrations/0001_initial.py` | Schema migration. | Create | 1 |
| `core/leave/serializers.py` | DRF serializer + nested approver. | Create | 1 |
| `core/leave/views.py` | `LeaveRequestViewSet` with approve / reject / withdraw actions. | Create | 1 |
| `core/leave/urls.py` | Router. | Create | 1 |
| `core/leave/signals.py` | Post-save handler that materialises Attendance rows on approve / removes them on reject/withdraw. | Create | 1 |
| `core/leave/tests.py` | Permission, transition, materialisation tests. | Create | 1 |
| `core/working_days/__init__.py` | New Django app marker. | Create | 1 |
| `core/working_days/apps.py` | App config. | Create | 1 |
| `core/working_days/models.py` | `WorkingDayOverride`. | Create | 1 |
| `core/working_days/migrations/0001_initial.py` | Schema. | Create | 1 |
| `core/working_days/serializers.py` | DRF serializer. | Create | 1 |
| `core/working_days/views.py` | Admin-only viewset. | Create | 1 |
| `core/working_days/urls.py` | Router. | Create | 1 |
| `core/working_days/tests.py` | Permission tests. | Create | 1 |
| `config/urls.py` | Mount the two new app URLs. | Modify | 1 |
| `config/settings.py` | Add new apps to `INSTALLED_APPS`. | Modify | 1 |
| `core/attendance/tests.py` | WFH approval permission + state transition tests. | Modify | 1 |
| `frontend/task-tracker/src/types/api/leave.ts` | DTO types. | Create | 2 |
| `frontend/task-tracker/src/types/api/working-day.ts` | DTO types. | Create | 5 |
| `frontend/task-tracker/src/types/leave.ts` | Frontend `LeaveRequest` shape. | Create | 2 |
| `frontend/task-tracker/src/lib/api.ts` | DTO ↔ entity converters for leave + matrix. | Modify | 2, 4 |
| `frontend/task-tracker/src/hooks/useLeaveRequests.ts` | List + mutations + SSE. | Create | 2 |
| `frontend/task-tracker/src/hooks/useWfhApprovals.ts` | List + mutations + SSE. | Create | 2 |
| `frontend/task-tracker/src/hooks/useApprovalsBadge.ts` | Single derived count. | Create | 2 |
| `frontend/task-tracker/src/hooks/useAttendanceMatrix.ts` | Fetch matrix payload. | Create | 4 |
| `frontend/task-tracker/src/hooks/useWorkingDayOverrides.ts` | CRUD. | Create | 5 |
| `frontend/task-tracker/src/utils/matrixCells.ts` | Pure cell-rendering helpers (mirror of `core/attendance/matrix.py`). | Create | 4 |
| `frontend/task-tracker/src/__tests__/utils/matrixCells.test.ts` | Vitest. | Create | 4 |
| `frontend/task-tracker/src/components/employee/EmployeeAttendanceTab.tsx` | Hosts existing `AttendancePage` body + `Log/Matrix/Report` toggle. | Create | 4 |
| `frontend/task-tracker/src/components/employee/EmployeeLeaveTab.tsx` | My Requests + Apply Leave modal. | Create | 3 |
| `frontend/task-tracker/src/components/employee/EmployeeApprovalsTab.tsx` | WFH + Leave queues with approve / reject / bulk. | Create | 2 |
| `frontend/task-tracker/src/components/employee/ApplyLeaveModal.tsx` | Form. | Create | 3 |
| `frontend/task-tracker/src/components/employee/RejectModal.tsx` | Reusable reason-required modal. | Create | 2 |
| `frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx` | The matrix grid. | Create | 4 |
| `frontend/task-tracker/src/components/attendance/MatrixCell.tsx` | One cell + tooltip. | Create | 4 |
| `frontend/task-tracker/src/components/attendance/MatrixLegend.tsx` | Collapsible legend. | Create | 4 |
| `frontend/task-tracker/src/components/holidays/WorkingDayOverridesTab.tsx` | Sunday-override admin UI. | Create | 5 |
| `frontend/task-tracker/src/pages/EmployeePage.tsx` | Add new sub-tabs + access gating. | Modify | 2, 3, 4 |
| `frontend/task-tracker/src/App.tsx` | Remove top-level Attendance tab; add `/attendance` redirect. | Modify | 5 |
| `frontend/task-tracker/src/lib/api.ts` (toast bus) | Tiny pub/sub for decision-toast. | Modify | 2 |

Each file has one focused responsibility; backend and frontend stay strictly separated; cell-logic lives in pure files (`matrix.py`, `matrixCells.ts`) so it's testable without the DB or React.

---

# PHASE 1 — Backend foundations

Verify in **DRF browsable API** at the end (`http://localhost:8000/api/leave-requests/`, `/api/working-day-overrides/`, `/api/attendance/<uid>/approve_wfh/`).

## Task 1: New `Attendance` fields + migration

**Files:**
- Modify: `core/attendance/models.py`
- Create: `core/attendance/migrations/0003_attendance_wfh_approval.py`
- Create: `core/attendance/migrations/0004_backfill_wfh_approved.py`

### - [ ] Step 1: Extend the `Attendance` model

Open `core/attendance/models.py`. Inside class `Attendance`, after the `remarks` field:

```python
    APPROVAL_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]
    LEAVE_SESSION_CHOICES = [
        ("First Half", "First Half"),
        ("Second Half", "Second Half"),
    ]
    approval_state = models.CharField(
        max_length=10, choices=APPROVAL_CHOICES, null=True, blank=True
    )
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="attendance_approvals",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    leave_session = models.CharField(
        max_length=12, choices=LEAVE_SESSION_CHOICES, null=True, blank=True
    )
```

Inside `class Meta:`, append (next to the existing `unique_together`):

```python
        indexes = [
            models.Index(fields=["approval_state", "org"]),
        ]
```

### - [ ] Step 2: Generate the schema migration

Run:
```bash
python manage.py makemigrations attendance --name attendance_wfh_approval
```

Expected: a file `core/attendance/migrations/0003_attendance_wfh_approval.py` is created. Open it and confirm it contains `AddField` operations for `approval_state`, `approver`, `approved_at`, `rejection_reason`, `leave_session` plus `AddIndex` for `(approval_state, org)`. If Django named it `0003_<auto>.py`, rename it manually.

### - [ ] Step 3: Write the back-fill data migration

Create `core/attendance/migrations/0004_backfill_wfh_approved.py`:

```python
from django.db import migrations


def forward(apps, schema_editor):
    Attendance = apps.get_model("attendance", "Attendance")
    Attendance.objects.filter(work_location="WFH", approval_state__isnull=True).update(
        approval_state="Approved"
    )


def backward(apps, schema_editor):
    # Non-reversible in spirit — but we restore null to be technically reversible.
    Attendance = apps.get_model("attendance", "Attendance")
    Attendance.objects.filter(work_location="WFH").update(approval_state=None)


class Migration(migrations.Migration):
    dependencies = [
        ("attendance", "0003_attendance_wfh_approval"),
    ]
    operations = [migrations.RunPython(forward, backward)]
```

### - [ ] Step 4: Apply migrations

Run:
```bash
python manage.py migrate attendance
```

Expected: both migrations apply cleanly. To verify the back-fill, run:
```bash
python manage.py shell -c "from core.attendance.models import Attendance; print(Attendance.objects.filter(work_location='WFH', approval_state='Approved').count(), Attendance.objects.filter(work_location='WFH', approval_state__isnull=True).count())"
```
Expected: first number = total WFH rows (3 today), second = 0.

### - [ ] Step 5: Commit

```bash
git add core/attendance/models.py core/attendance/migrations/0003_attendance_wfh_approval.py core/attendance/migrations/0004_backfill_wfh_approved.py
git commit -m "feat(attendance): add WFH approval fields + leave_session discriminator"
```

---

## Task 2: New `working_days` app + `WorkingDayOverride`

**Files:**
- Create: `core/working_days/__init__.py`
- Create: `core/working_days/apps.py`
- Create: `core/working_days/models.py`
- Create: `core/working_days/admin.py`
- Modify: `config/settings.py`

### - [ ] Step 1: Scaffold the app

```bash
python manage.py startapp working_days core/working_days
```

If the command rejects the existing folder, create `core/working_days/__init__.py` manually (empty) and write the files below by hand.

### - [ ] Step 2: Write `apps.py`

Replace `core/working_days/apps.py` with:

```python
from django.apps import AppConfig


class WorkingDaysConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.working_days"
    label = "working_days"
    verbose_name = "working day overrides"
```

### - [ ] Step 3: Write the model

Create `core/working_days/models.py`:

```python
import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class WorkingDayOverride(TimeStampedModel):
    """Override the default Sunday=holiday rule for a specific date.

    A row with ``is_working=True`` flips a Sunday into a working day. The
    field exists for symmetry — a future ``False`` row could mark an arbitrary
    weekday as a holiday, but the matrix's holiday-resolution order checks
    explicit `Holiday` rows first, so that case isn't used yet.
    """

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        on_delete=models.CASCADE,
        related_name="working_day_overrides",
    )
    date = models.DateField()
    is_working = models.BooleanField(default=True)
    note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="working_day_overrides",
    )

    class Meta:
        unique_together = ("org", "date")
        ordering = ["-date"]
        verbose_name = "working day override"
        verbose_name_plural = "working day overrides"

    def __str__(self):
        return f"{self.date} ({'working' if self.is_working else 'holiday'})"
```

### - [ ] Step 4: Stub admin.py

Create `core/working_days/admin.py`:

```python
from django.contrib import admin

from .models import WorkingDayOverride


@admin.register(WorkingDayOverride)
class WorkingDayOverrideAdmin(admin.ModelAdmin):
    list_display = ("date", "org", "is_working", "note", "created_by")
    list_filter = ("org", "is_working")
    search_fields = ("note",)
```

### - [ ] Step 5: Register in `INSTALLED_APPS`

Open `config/settings.py`, find the `INSTALLED_APPS` list, and add immediately after `"core.holidays"`:
```python
    "core.working_days",
```

### - [ ] Step 6: Generate + apply migration

```bash
python manage.py makemigrations working_days
python manage.py migrate working_days
```

Expected: `core/working_days/migrations/0001_initial.py` created and applied.

### - [ ] Step 7: Commit

```bash
git add core/working_days/ config/settings.py
git commit -m "feat(working_days): add WorkingDayOverride model + admin"
```

---

## Task 3: New `leave` app + `LeaveRequest` model

**Files:**
- Create: `core/leave/__init__.py`
- Create: `core/leave/apps.py`
- Create: `core/leave/models.py`
- Create: `core/leave/admin.py`
- Modify: `config/settings.py`

### - [ ] Step 1: Scaffold

```bash
python manage.py startapp leave core/leave
```

(Or create `__init__.py` manually if the folder exists.)

### - [ ] Step 2: Write `apps.py`

Replace `core/leave/apps.py` with:

```python
from django.apps import AppConfig


class LeaveConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.leave"
    label = "leave"
    verbose_name = "leave requests"

    def ready(self):
        from . import signals  # noqa: F401  — registers post_save handlers
```

### - [ ] Step 3: Write `models.py`

Create `core/leave/models.py`:

```python
import calendar
import datetime as dt
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction

from core.base import TimeStampedModel


class LeaveRequest(TimeStampedModel):
    SESSION_CHOICES = [
        ("Full", "Full"),
        ("First Half", "First Half"),
        ("Second Half", "Second Half"),
    ]
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
        ("Withdrawn", "Withdrawn"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_requests",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_requests",
    )
    from_date = models.DateField()
    to_date = models.DateField()
    from_session = models.CharField(max_length=12, choices=SESSION_CHOICES, default="Full")
    to_session = models.CharField(max_length=12, choices=SESSION_CHOICES, default="Full")
    reason = models.TextField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="Pending", db_index=True)
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_decisions",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    total_days = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_requests_created",
    )

    class Meta:
        ordering = ["-from_date", "-id"]
        verbose_name = "leave request"
        verbose_name_plural = "leave requests"
        indexes = [
            models.Index(fields=["status", "org"]),
            models.Index(fields=["user", "from_date", "to_date"]),
        ]

    def __str__(self):
        return f"{self.user} · {self.from_date} → {self.to_date} ({self.status})"

    # ── Day computation ──────────────────────────────────────────────────
    def included_dates(self) -> list[tuple[dt.date, str]]:
        """Yield (date, session) pairs for every day this request covers,
        skipping holidays and Sundays (per spec Q6(b)).

        Session is 'Full' for inner dates; the first/last date carries the
        from_session / to_session if the request is multi-day, or the merged
        session if from_date == to_date.
        """
        from core.holidays.models import Holiday
        from core.working_days.models import WorkingDayOverride

        if self.from_date > self.to_date:
            return []

        holidays = set(
            Holiday.objects.filter(date__range=(self.from_date, self.to_date)).values_list("date", flat=True)
        )
        overrides = {
            o.date: o.is_working
            for o in WorkingDayOverride.objects.filter(
                org=self.org, date__range=(self.from_date, self.to_date)
            )
        }

        out: list[tuple[dt.date, str]] = []
        cur = self.from_date
        single = self.from_date == self.to_date
        while cur <= self.to_date:
            if cur in holidays:
                cur += dt.timedelta(days=1)
                continue
            is_sunday = cur.weekday() == calendar.SUNDAY
            override_working = overrides.get(cur)
            if is_sunday and not override_working:
                cur += dt.timedelta(days=1)
                continue
            if single:
                # First and to sessions both apply — merge.
                if self.from_session == "Full" or self.to_session == "Full":
                    session = "Full"
                elif self.from_session == self.to_session:
                    session = self.from_session
                else:
                    # First Half + Second Half on the same date is a Full leave.
                    session = "Full"
            elif cur == self.from_date:
                session = self.from_session
            elif cur == self.to_date:
                session = self.to_session
            else:
                session = "Full"
            out.append((cur, session))
            cur += dt.timedelta(days=1)
        return out

    def compute_total_days(self) -> Decimal:
        total = Decimal("0")
        for _date, session in self.included_dates():
            total += Decimal("1") if session == "Full" else Decimal("0.5")
        return total

    # ── State transitions ────────────────────────────────────────────────
    def apply_state_transition(self, new_status: str, by_user, reason: str = ""):
        """Single source of truth for status changes + materialisation.

        Use this — never assign `status` directly — so that materialised
        Attendance rows stay in sync.
        """
        from .signals import materialise_attendance, demolish_attendance

        old = self.status
        if old == new_status:
            return self
        self.status = new_status
        if new_status in ("Approved", "Rejected"):
            self.approver = by_user
            self.approved_at = dt.datetime.now(dt.UTC)
        if new_status == "Rejected":
            self.rejection_reason = reason or ""
        with transaction.atomic():
            self.save(update_fields=["status", "approver", "approved_at", "rejection_reason", "updated_at"])
            if old == "Approved" and new_status in ("Rejected", "Withdrawn"):
                demolish_attendance(self)
            elif new_status == "Approved":
                materialise_attendance(self, by_user)
        return self
```

### - [ ] Step 4: Write the signal handlers

Create `core/leave/signals.py`:

```python
"""Materialise + demolish Attendance rows for an approved/withdrawn leave.

Called only from ``LeaveRequest.apply_state_transition`` — never wired as
a generic post_save listener, because the safe place to mutate Attendance
rows is right after the LeaveRequest's own save inside one transaction.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from core.attendance.models import Attendance

if TYPE_CHECKING:
    from .models import LeaveRequest


def materialise_attendance(req: "LeaveRequest", by_user) -> None:
    """Create one Attendance row per included date.

    If the date already has a non-Leave Half-Day row matching the unrequested
    half (e.g., user worked 1st half, leave is for 2nd half), keep that row
    and append a small remarks note instead of overwriting.
    """
    for date, session in req.included_dates():
        existing = Attendance.objects.filter(user=req.user, date=date).first()
        if existing and existing.status not in ("Leave", "Half Day"):
            # Conflict guard — this should have been caught by the approve view.
            # Be defensive and skip rather than overwrite.
            continue
        if existing and existing.status == "Half Day" and session != "Full":
            note = f"[leave: {session.lower()}]"
            if note not in (existing.remarks or ""):
                existing.remarks = (existing.remarks + "\n" + note).strip() if existing.remarks else note
                existing.save(update_fields=["remarks", "updated_at"])
            continue
        # Either no row, or an existing Leave row — overwrite to canonical state.
        if existing is None:
            Attendance.objects.create(
                user=req.user,
                date=date,
                status="Leave",
                work_location="Office",
                login_time=None,
                logout_time=None,
                remarks=f"Leave: {req.reason[:240]}" if req.reason else "",
                created_by=by_user,
                org=req.org,
                leave_session=None if session == "Full" else session,
            )
        else:
            existing.status = "Leave"
            existing.work_location = "Office"
            existing.login_time = None
            existing.logout_time = None
            existing.leave_session = None if session == "Full" else session
            existing.save(update_fields=["status", "work_location", "login_time", "logout_time", "leave_session", "updated_at"])


def demolish_attendance(req: "LeaveRequest") -> None:
    """Remove Attendance rows that this leave previously materialised.

    Half-Day rows that we only annotated (didn't create) are kept; we strip
    the leave-note suffix.
    """
    rows = Attendance.objects.filter(user=req.user, date__range=(req.from_date, req.to_date))
    for row in rows:
        if row.status == "Leave":
            row.delete()
            continue
        if row.status == "Half Day" and row.remarks:
            cleaned_lines = [ln for ln in row.remarks.splitlines() if not ln.startswith("[leave:")]
            new_remarks = "\n".join(cleaned_lines).strip()
            if new_remarks != (row.remarks or ""):
                row.remarks = new_remarks
                row.save(update_fields=["remarks", "updated_at"])
```

### - [ ] Step 5: Stub admin.py

Create `core/leave/admin.py`:

```python
from django.contrib import admin

from .models import LeaveRequest


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ("user", "from_date", "to_date", "total_days", "status", "approver", "org")
    list_filter = ("status", "org")
    search_fields = ("user__email", "user__full_name", "reason")
    raw_id_fields = ("user", "approver", "created_by")
```

### - [ ] Step 6: Register in `INSTALLED_APPS`

In `config/settings.py`, add immediately after `"core.working_days"`:

```python
    "core.leave",
```

### - [ ] Step 7: Generate + apply migration

```bash
python manage.py makemigrations leave
python manage.py migrate leave
```

### - [ ] Step 8: Commit

```bash
git add core/leave/ config/settings.py
git commit -m "feat(leave): add LeaveRequest model + materialisation signals"
```

---

## Task 4: Permission helper for approver pool

**Files:**
- Create: `core/leave/permissions.py` (shared between leave + WFH approval)

### - [ ] Step 1: Write the helper

Create `core/leave/permissions.py`:

```python
"""Approver-pool resolution shared by Leave + WFH approval flows.

Keeps the rule single-sourced: employee → managers; manager → admins;
admin → auto-approved.
"""

from __future__ import annotations

from users.models import User


def approver_pool(requester: User, org) -> list[int]:
    """User IDs who may approve a request from `requester` in `org`.

    Empty list means "auto-approve" (only happens when requester is admin).
    """
    role = requester.role_in(org)
    if role == "admin":
        return []  # auto-approve

    if role == "manager":
        return list(
            User.objects.filter(memberships__org=org, memberships__role="admin")
            .exclude(pk=requester.pk)
            .values_list("pk", flat=True)
        )

    # Employee
    manager_ids = list(requester.managers.values_list("pk", flat=True))
    if manager_ids:
        return manager_ids
    # Fallback: admins of the request's org
    return list(
        User.objects.filter(memberships__org=org, memberships__role="admin")
        .values_list("pk", flat=True)
    )


def can_approve(actor: User, requester: User, org) -> bool:
    if actor.pk == requester.pk:
        return False
    pool = approver_pool(requester, org)
    if not pool:
        # Auto-approve case: only the requester themselves "approves" — any
        # other user calling Approve is rejected.
        return False
    return actor.pk in pool
```

### - [ ] Step 2: Write tests

Create or extend `core/leave/tests.py`:

```python
import datetime as dt
from decimal import Decimal

from django.test import TestCase

from core.leave.models import LeaveRequest
from core.leave.permissions import approver_pool, can_approve
from users.models import Org, OrgMembership, User


class ApproverPoolTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x.com", password="x", full_name="Admin A")
        self.admin2 = User.objects.create_user(email="b@x.com", password="x", full_name="Admin B")
        self.mgr = User.objects.create_user(email="m@x.com", password="x", full_name="Manager M")
        self.emp = User.objects.create_user(email="e@x.com", password="x", full_name="Employee E")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.admin2, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)

    def test_admin_pool_is_empty(self):
        self.assertEqual(approver_pool(self.admin, self.org), [])

    def test_manager_pool_excludes_self(self):
        pool = approver_pool(self.mgr, self.org)
        self.assertIn(self.admin.pk, pool)
        self.assertIn(self.admin2.pk, pool)
        self.assertNotIn(self.mgr.pk, pool)

    def test_employee_pool_is_their_managers(self):
        pool = approver_pool(self.emp, self.org)
        self.assertEqual(pool, [self.mgr.pk])

    def test_employee_without_manager_falls_back_to_org_admins(self):
        self.emp.managers.clear()
        pool = approver_pool(self.emp, self.org)
        self.assertSetEqual(set(pool), {self.admin.pk, self.admin2.pk})

    def test_can_approve_blocks_self(self):
        self.assertFalse(can_approve(self.admin, self.admin, self.org))

    def test_can_approve_allows_admin_for_manager_request(self):
        self.assertTrue(can_approve(self.admin, self.mgr, self.org))

    def test_can_approve_blocks_unrelated_user(self):
        outsider = User.objects.create_user(email="o@x.com", password="x")
        self.assertFalse(can_approve(outsider, self.emp, self.org))
```

### - [ ] Step 3: Run tests to verify they pass

```bash
python manage.py test core.leave.tests.ApproverPoolTests -v 2
```

Expected: 7 tests pass.

### - [ ] Step 4: Commit

```bash
git add core/leave/permissions.py core/leave/tests.py
git commit -m "feat(leave): approver-pool helper + tests"
```

---

## Task 5: `LeaveRequestViewSet` + URLs

**Files:**
- Create: `core/leave/serializers.py`
- Create: `core/leave/views.py`
- Create: `core/leave/urls.py`
- Modify: `config/urls.py`

### - [ ] Step 1: Write serializer

Create `core/leave/serializers.py`:

```python
from rest_framework import serializers

from core.serializers import UserMinSerializer
from users.models import User

from .models import LeaveRequest


class LeaveRequestSerializer(serializers.ModelSerializer):
    user_detail = UserMinSerializer(source="user", read_only=True)
    approver_detail = UserMinSerializer(source="approver", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    user = serializers.SlugRelatedField(slug_field="uid", queryset=User.objects.all())

    class Meta:
        model = LeaveRequest
        fields = [
            "id", "uid", "org_uid",
            "user", "user_detail",
            "from_date", "to_date", "from_session", "to_session",
            "reason", "status",
            "approver", "approver_detail", "approved_at", "rejection_reason",
            "total_days",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "uid", "org_uid",
            "user_detail", "approver", "approver_detail", "approved_at",
            "rejection_reason", "total_days",
            "status",  # use approve/reject/withdraw actions to change
            "created_at", "updated_at",
        ]

    def validate(self, data):
        if data.get("from_date") and data.get("to_date") and data["from_date"] > data["to_date"]:
            raise serializers.ValidationError({"to_date": "to_date cannot be before from_date"})
        return data
```

### - [ ] Step 2: Write the viewset

Create `core/leave/views.py`:

```python
from typing import cast

from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.attendance.models import Attendance
from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import LeaveRequest
from .permissions import approver_pool, can_approve
from .serializers import LeaveRequestSerializer


def _raise(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class LeaveRequestViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = LeaveRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = LeaveRequest.objects.select_related("user", "approver", "org").filter(visibility_q(user, "user"))

        status_q = self.request.query_params.get("status")
        user_uid = self.request.query_params.get("user_uid")
        month = self.request.query_params.get("month")
        if status_q:
            qs = qs.filter(status=status_q)
        if user_uid:
            qs = qs.filter(user__uid=user_uid)
        if month:
            qs = qs.filter(from_date__startswith=month)
        return qs.order_by("-from_date", "-id")

    def perform_create(self, serializer):
        request = self.request
        user = cast(User, request.user)
        org, err = resolve_create_org(request)
        if err is not None:
            _raise(err)
        target_uid = request.data.get("user")
        target = user
        if target_uid and str(target_uid) != str(user.uid):
            looked = User.objects.filter(uid=target_uid).first()
            if looked is None:
                raise ValidationError({"user": "Unknown user"})
            if not user.is_admin_in(org):
                raise PermissionDenied({"detail": "Only an admin may file leave for another user"})
            target = looked
        instance: LeaveRequest = serializer.save(user=target, created_by=user, org=org)
        instance.total_days = instance.compute_total_days()
        instance.save(update_fields=["total_days"])

        # Admins are auto-approved (spec Q5).
        if not approver_pool(target, org):
            instance.apply_state_transition("Approved", by_user=user)

        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "INSERT", payload)
        broadcast(
            "leave.approval",
            "PENDING" if instance.status == "Pending" else "DECIDED",
            {**payload, "approver_uids": [str(User.objects.get(pk=u).uid) for u in approver_pool(target, org)]},
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.status != "Pending":
            raise ValidationError({"detail": "Only Pending requests can be edited"})
        user = cast(User, self.request.user)
        if instance.user_id != user.pk and not user.is_admin_in(instance.org):
            raise PermissionDenied({"detail": "Only the requester or an admin may edit"})
        obj = serializer.save()
        obj.total_days = obj.compute_total_days()
        obj.save(update_fields=["total_days"])
        broadcast("leave", "UPDATE", LeaveRequestSerializer(obj).data)

    def perform_destroy(self, instance):
        # Use Withdraw instead of delete to keep history.
        raise PermissionDenied({"detail": "Use the withdraw action instead of DELETE"})

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        instance: LeaveRequest = self.get_object()
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool for this request"})
        if instance.status != "Pending":
            raise ValidationError({"detail": f"Cannot approve a {instance.status} request"})
        # Conflict guard — see signals.materialise_attendance.
        conflicting = []
        for date, session in instance.included_dates():
            row = Attendance.objects.filter(user=instance.user, date=date).first()
            if row and row.status not in ("Leave", "Half Day"):
                conflicting.append(str(date))
            elif row and row.status == "Half Day" and session == "Full":
                conflicting.append(str(date))
        if conflicting:
            raise ValidationError({"detail": "conflict-on-date", "dates": conflicting})
        instance.apply_state_transition("Approved", by_user=actor)
        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "UPDATE", payload)
        broadcast("leave.approval", "DECIDED", {**payload, "decision": "Approved"})
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        instance: LeaveRequest = self.get_object()
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool for this request"})
        if instance.status != "Pending":
            raise ValidationError({"detail": f"Cannot reject a {instance.status} request"})
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Required when rejecting"})
        instance.apply_state_transition("Rejected", by_user=actor, reason=reason)
        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "UPDATE", payload)
        broadcast("leave.approval", "DECIDED", {**payload, "decision": "Rejected"})
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="withdraw")
    def withdraw(self, request, uid=None):
        instance: LeaveRequest = self.get_object()
        actor = cast(User, request.user)
        if instance.user_id != actor.pk:
            raise PermissionDenied({"detail": "Only the requester may withdraw"})
        if instance.status not in ("Pending", "Approved"):
            raise ValidationError({"detail": f"Cannot withdraw a {instance.status} request"})
        instance.apply_state_transition("Withdrawn", by_user=actor)
        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "UPDATE", payload)
        return Response(payload)
```

### - [ ] Step 3: Write `urls.py`

Create `core/leave/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import LeaveRequestViewSet

router = DefaultRouter()
router.register("leave-requests", LeaveRequestViewSet, basename="leave-request")

urlpatterns = [path("", include(router.urls))]
```

### - [ ] Step 4: Mount in root URLs

Open `config/urls.py`. After the line `path("api/", include("core.attendance.urls"))`, insert:

```python
    path("api/", include("core.leave.urls")),
    path("api/", include("core.working_days.urls")),
```

(`core.working_days.urls` will be created in Task 6 — file path is reserved here so we don't have to come back.)

### - [ ] Step 5: Smoke-test the leave endpoints

Run the Django dev server in another terminal:
```bash
python manage.py runserver 0.0.0.0:8000
```

Then in your browser, visit `http://localhost:8000/api/leave-requests/`. Expected: DRF browsable API page with an empty list (or whatever pre-existing rows you have). POST a new request through the form and confirm `total_days` is computed.

### - [ ] Step 6: Commit

```bash
git add core/leave/serializers.py core/leave/views.py core/leave/urls.py config/urls.py
git commit -m "feat(leave): viewset with approve/reject/withdraw + materialisation"
```

---

## Task 6: `WorkingDayOverrideViewSet` + URLs

**Files:**
- Create: `core/working_days/serializers.py`
- Create: `core/working_days/views.py`
- Create: `core/working_days/urls.py`

### - [ ] Step 1: Write serializer

Create `core/working_days/serializers.py`:

```python
from rest_framework import serializers

from .models import WorkingDayOverride


class WorkingDayOverrideSerializer(serializers.ModelSerializer):
    org_uid = serializers.UUIDField(source="org.uid", read_only=True)

    class Meta:
        model = WorkingDayOverride
        fields = ["id", "uid", "org_uid", "date", "is_working", "note", "created_at"]
        read_only_fields = ["id", "uid", "org_uid", "created_at"]
```

### - [ ] Step 2: Write the viewset

Create `core/working_days/views.py`:

```python
from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, scoped
from users.models import User

from .models import WorkingDayOverride
from .serializers import WorkingDayOverrideSerializer


def _raise(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class WorkingDayOverrideViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = WorkingDayOverrideSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(WorkingDayOverride.objects.select_related("org"), user)
        year = self.request.query_params.get("year")
        if year:
            qs = qs.filter(date__year=year)
        return qs.order_by("-date")

    def perform_create(self, serializer):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        serializer.save(created_by=self.request.user, org=org)

    def perform_update(self, serializer):
        # Admin-only edits.
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        serializer.save()

    def perform_destroy(self, instance):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        instance.delete()
```

### - [ ] Step 3: Write urls.py

Create `core/working_days/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import WorkingDayOverrideViewSet

router = DefaultRouter()
router.register("working-day-overrides", WorkingDayOverrideViewSet, basename="working-day-override")

urlpatterns = [path("", include(router.urls))]
```

### - [ ] Step 4: Smoke-test

Visit `http://localhost:8000/api/working-day-overrides/`. Expected: empty list. POST one `{"date":"2026-04-26", "is_working":true, "note":"team release Sunday"}`; the response should include `org_uid` and `uid`.

### - [ ] Step 5: Commit

```bash
git add core/working_days/serializers.py core/working_days/views.py core/working_days/urls.py
git commit -m "feat(working_days): admin-only WorkingDayOverride viewset"
```

---

## Task 7: WFH approval actions on `AttendanceViewSet`

**Files:**
- Modify: `core/attendance/views.py`
- Modify: `core/attendance/serializers.py`
- Modify: `core/attendance/tests.py`

### - [ ] Step 1: Surface new fields in the serializer

Open `core/attendance/serializers.py`. In the `fields` list (after `"remarks"`), add:

```python
            "approval_state",
            "approver",
            "approved_at",
            "rejection_reason",
            "leave_session",
```

In `read_only_fields`, append:

```python
            "approver",
            "approved_at",
```

(Other fields stay writable so admins can edit through the matrix drawer in Phase 4.)

Add `approver_detail` next to `user_detail`:

```python
    approver_detail = UserMinSerializer(source="approver", read_only=True)
```

And include `"approver_detail"` in `fields` and `read_only_fields`.

### - [ ] Step 2: Default approval_state on create when WFH

In `core/attendance/views.py`, find `perform_create` and replace the body with:

```python
    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        user = cast(User, self.request.user)
        approval_state = None
        if serializer.validated_data.get("work_location") == "WFH":
            # Admin's own WFH auto-approves; everyone else starts Pending.
            approval_state = "Approved" if user.is_admin_in(org) else "Pending"
        obj = serializer.save(
            created_by=user, org=org,
            approval_state=approval_state,
            approver=user if approval_state == "Approved" else None,
            approved_at=timezone.now() if approval_state == "Approved" else None,
        )
        broadcast("attendance", "INSERT", AttendanceSerializer(obj).data)
        if approval_state == "Pending":
            from core.leave.permissions import approver_pool
            broadcast(
                "attendance.approval",
                "PENDING",
                {
                    **AttendanceSerializer(obj).data,
                    "approver_uids": [str(User.objects.get(pk=u).uid) for u in approver_pool(user, org)],
                    "kind": "WFH",
                },
            )
```

(Confirm `from django.utils import timezone` is imported at the top — it already is per the existing file.)

### - [ ] Step 3: Add approve / reject actions

In `core/attendance/views.py`, after the existing `bulk_import` action:

```python
    @action(detail=True, methods=["post"], url_path="approve_wfh")
    def approve_wfh(self, request, uid=None):
        from core.leave.permissions import can_approve
        instance: Attendance = self.get_object()
        if instance.work_location != "WFH" or instance.approval_state != "Pending":
            raise ValidationError({"detail": "Row is not a pending WFH entry"})
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool"})
        instance.approval_state = "Approved"
        instance.approver = actor
        instance.approved_at = timezone.now()
        instance.rejection_reason = ""
        instance.save(update_fields=["approval_state", "approver", "approved_at", "rejection_reason", "updated_at"])
        payload = AttendanceSerializer(instance).data
        broadcast("attendance", "UPDATE", payload)
        broadcast("attendance.approval", "DECIDED", {**payload, "decision": "Approved", "kind": "WFH"})
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="reject_wfh")
    def reject_wfh(self, request, uid=None):
        from core.leave.permissions import can_approve
        instance: Attendance = self.get_object()
        if instance.work_location != "WFH" or instance.approval_state != "Pending":
            raise ValidationError({"detail": "Row is not a pending WFH entry"})
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool"})
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Required when rejecting"})
        instance.approval_state = "Rejected"
        instance.approver = actor
        instance.approved_at = timezone.now()
        instance.rejection_reason = reason
        instance.save(update_fields=["approval_state", "approver", "approved_at", "rejection_reason", "updated_at"])
        payload = AttendanceSerializer(instance).data
        broadcast("attendance", "UPDATE", payload)
        broadcast("attendance.approval", "DECIDED", {**payload, "decision": "Rejected", "kind": "WFH"})
        return Response(payload)

    @action(detail=False, methods=["get"], url_path="approvals_pending")
    def approvals_pending(self, request):
        from core.leave.models import LeaveRequest
        from core.leave.permissions import can_approve
        actor = cast(User, request.user)

        wfh_qs = (
            Attendance.objects.select_related("user", "org")
            .filter(work_location="WFH", approval_state="Pending")
            .filter(visibility_q(actor, "user"))
        )
        leave_qs = (
            LeaveRequest.objects.select_related("user", "org")
            .filter(status="Pending")
            .filter(visibility_q(actor, "user"))
        )

        org_filter = request.query_params.get("org_uid")
        if org_filter:
            wfh_qs = wfh_qs.filter(org__uid=org_filter)
            leave_qs = leave_qs.filter(org__uid=org_filter)

        wfh_items = [r for r in wfh_qs if can_approve(actor, r.user, r.org)]
        leave_items = [r for r in leave_qs if can_approve(actor, r.user, r.org)]
        return Response({
            "wfh_count": len(wfh_items),
            "leave_count": len(leave_items),
            "wfh_uids": [str(r.uid) for r in wfh_items[:20]],
            "leave_uids": [str(r.uid) for r in leave_items[:20]],
        })
```

### - [ ] Step 4: Write WFH approval tests

Append to `core/attendance/tests.py`:

```python
import datetime as dt

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from core.attendance.models import Attendance
from users.models import Org, OrgMembership, User


class WfhApprovalTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="adm@x.com", password="x")
        self.mgr = User.objects.create_user(email="mgr@x.com", password="x")
        self.emp = User.objects.create_user(email="emp@x.com", password="x")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def test_employee_wfh_starts_pending(self):
        c = self._client(self.emp)
        r = c.post("/api/attendance/", {
            "user": str(self.emp.uid), "date": "2026-04-25",
            "status": "Present", "work_location": "WFH",
            "login_time": "09:00", "logout_time": "18:00",
            "org": str(self.org.uid),
        }, format="json")
        self.assertEqual(r.status_code, 201, r.json())
        row = Attendance.objects.get(uid=r.json()["uid"])
        self.assertEqual(row.approval_state, "Pending")

    def test_admin_wfh_auto_approves(self):
        c = self._client(self.admin)
        r = c.post("/api/attendance/", {
            "user": str(self.admin.uid), "date": "2026-04-25",
            "status": "Present", "work_location": "WFH",
            "login_time": "09:00", "logout_time": "18:00",
            "org": str(self.org.uid),
        }, format="json")
        self.assertEqual(r.status_code, 201)
        row = Attendance.objects.get(uid=r.json()["uid"])
        self.assertEqual(row.approval_state, "Approved")

    def test_manager_can_approve_employee_wfh(self):
        Attendance.objects.create(
            user=self.emp, org=self.org, date=dt.date(2026, 4, 25),
            status="Present", work_location="WFH",
            login_time=dt.time(9), logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-04-25")
        c = self._client(self.mgr)
        r = c.post(f"/api/attendance/{row.uid}/approve_wfh/")
        self.assertEqual(r.status_code, 200, r.json())
        row.refresh_from_db()
        self.assertEqual(row.approval_state, "Approved")
        self.assertEqual(row.approver, self.mgr)

    def test_employee_cannot_approve_own_wfh(self):
        Attendance.objects.create(
            user=self.emp, org=self.org, date=dt.date(2026, 4, 26),
            status="Present", work_location="WFH",
            login_time=dt.time(9), logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-04-26")
        c = self._client(self.emp)
        r = c.post(f"/api/attendance/{row.uid}/approve_wfh/")
        self.assertEqual(r.status_code, 403)

    def test_reject_requires_reason(self):
        Attendance.objects.create(
            user=self.emp, org=self.org, date=dt.date(2026, 4, 27),
            status="Present", work_location="WFH",
            login_time=dt.time(9), logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-04-27")
        c = self._client(self.mgr)
        r = c.post(f"/api/attendance/{row.uid}/reject_wfh/", {}, format="json")
        self.assertEqual(r.status_code, 400)
        r = c.post(f"/api/attendance/{row.uid}/reject_wfh/", {"reason": "team day"}, format="json")
        self.assertEqual(r.status_code, 200)
```

### - [ ] Step 5: Run the tests

```bash
python manage.py test core.attendance.tests.WfhApprovalTests core.leave.tests -v 2
```

Expected: all green.

### - [ ] Step 6: Commit

```bash
git add core/attendance/views.py core/attendance/serializers.py core/attendance/tests.py
git commit -m "feat(attendance): WFH approve/reject + approvals_pending action"
```

---

## Phase 1 checkpoint

**Verification (no UI yet):**

1. DRF browsable API at:
   - `http://localhost:8000/api/leave-requests/` — list, POST a request, see `total_days` computed
   - `http://localhost:8000/api/working-day-overrides/` — admin POSTs work, employee POST 403s
   - `http://localhost:8000/api/attendance/<uid>/approve_wfh/` — works for an approver, 403s for others
   - `http://localhost:8000/api/attendance/approvals_pending/` — returns `{wfh_count, leave_count}`
2. `python manage.py test core.leave core.attendance` — all green.
3. Migrations apply cleanly on a fresh DB (`rm db.sqlite3 && python manage.py migrate`).

**Pause and ask the user to verify the API surface before moving to Phase 2.**

---

# PHASE 2 — Approvals UX (first clickable surface)

## Task 8: Frontend DTOs + types

**Files:**
- Create: `frontend/task-tracker/src/types/api/leave.ts`
- Create: `frontend/task-tracker/src/types/leave.ts`
- Modify: `frontend/task-tracker/src/types/api/attendance.ts`
- Modify: `frontend/task-tracker/src/types/attendance.ts`
- Modify: `frontend/task-tracker/src/types/api/index.ts` (export the new file)
- Modify: `frontend/task-tracker/src/types/index.ts` (export the new file)

### - [ ] Step 1: Add Attendance approval fields to DTO

Open `frontend/task-tracker/src/types/api/attendance.ts`. Add to the `AttendanceDto` interface:

```typescript
  approval_state: "Pending" | "Approved" | "Rejected" | null;
  approver: number | null;
  approver_detail: { id: number; uid: string; full_name: string } | null;
  approved_at: string | null;
  rejection_reason: string;
  leave_session: "First Half" | "Second Half" | null;
```

### - [ ] Step 2: Add the same to the entity type

Open `frontend/task-tracker/src/types/attendance.ts`. Add to `AttendanceRecord`:

```typescript
  approval_state?: "Pending" | "Approved" | "Rejected" | null;
  approver_name?: string | null;
  approved_at?: string | null;
  rejection_reason?: string;
  leave_session?: "First Half" | "Second Half" | null;
```

### - [ ] Step 3: Create leave DTO

Create `frontend/task-tracker/src/types/api/leave.ts`:

```typescript
export type LeaveSession = "Full" | "First Half" | "Second Half";
export type LeaveStatus = "Pending" | "Approved" | "Rejected" | "Withdrawn";

export interface LeaveRequestDto {
  id: number;
  uid: string;
  org_uid: string | null;
  user: string; // user uid
  user_detail: { id: number; uid: string; full_name: string };
  from_date: string;
  to_date: string;
  from_session: LeaveSession;
  to_session: LeaveSession;
  reason: string;
  status: LeaveStatus;
  approver: number | null;
  approver_detail: { id: number; uid: string; full_name: string } | null;
  approved_at: string | null;
  rejection_reason: string;
  total_days: string; // DRF DecimalField → string
  created_at: string;
  updated_at: string;
}

export interface LeaveRequestCreate {
  user: string;
  org: string;
  from_date: string;
  to_date: string;
  from_session: LeaveSession;
  to_session: LeaveSession;
  reason: string;
}
```

### - [ ] Step 4: Create leave entity

Create `frontend/task-tracker/src/types/leave.ts`:

```typescript
import type { LeaveSession, LeaveStatus } from "./api/leave";

export interface LeaveRequest {
  id: string;          // uid
  user_uid: string;
  user_name: string;
  org_uid: string | null;
  from_date: string;
  to_date: string;
  from_session: LeaveSession;
  to_session: LeaveSession;
  reason: string;
  status: LeaveStatus;
  approver_name: string | null;
  approved_at: string | null;
  rejection_reason: string;
  total_days: number;
}
```

### - [ ] Step 5: Re-export the new files

In `frontend/task-tracker/src/types/api/index.ts`, append:
```typescript
export * from "./leave";
```

In `frontend/task-tracker/src/types/index.ts`, append:
```typescript
export * from "./leave";
```

### - [ ] Step 6: Commit

```bash
git add frontend/task-tracker/src/types/
git commit -m "feat(types): leave + WFH approval DTOs and entities"
```

---

## Task 9: Leave / WFH-approval converters in `lib/api.ts`

**Files:**
- Modify: `frontend/task-tracker/src/lib/api.ts`

### - [ ] Step 1: Add converters

Open `frontend/task-tracker/src/lib/api.ts`. Find a logical "converters" section near the existing `dtoToAttendance` (search the file for it). Add immediately after:

```typescript
import type { LeaveRequest, LeaveRequestDto } from "@/types";

export function dtoToLeaveRequest(d: LeaveRequestDto): LeaveRequest {
  return {
    id: d.uid,
    user_uid: d.user,
    user_name: d.user_detail?.full_name ?? "",
    org_uid: d.org_uid,
    from_date: d.from_date,
    to_date: d.to_date,
    from_session: d.from_session,
    to_session: d.to_session,
    reason: d.reason,
    status: d.status,
    approver_name: d.approver_detail?.full_name ?? null,
    approved_at: d.approved_at,
    rejection_reason: d.rejection_reason,
    total_days: parseFloat(d.total_days),
  };
}
```

(If `lib/api.ts` already has its own import block — match the existing style; don't duplicate the `import type` line.)

### - [ ] Step 2: Add a tiny toast bus

In the same file, near the bottom export:

```typescript
type ToastFn = (msg: string, kind: "ok" | "err") => void;
const _toastListeners = new Set<ToastFn>();
export const toast = {
  show(msg: string, kind: "ok" | "err" = "ok") {
    _toastListeners.forEach((fn) => fn(msg, kind));
  },
  subscribe(fn: ToastFn) {
    _toastListeners.add(fn);
    return () => _toastListeners.delete(fn);
  },
};
```

### - [ ] Step 3: Commit

```bash
git add frontend/task-tracker/src/lib/api.ts
git commit -m "feat(api): leave converter + toast bus"
```

---

## Task 10: `useLeaveRequests` + `useWfhApprovals` + `useApprovalsBadge`

**Files:**
- Create: `frontend/task-tracker/src/hooks/useLeaveRequests.ts`
- Create: `frontend/task-tracker/src/hooks/useWfhApprovals.ts`
- Create: `frontend/task-tracker/src/hooks/useApprovalsBadge.ts`

### - [ ] Step 1: `useLeaveRequests`

Create `frontend/task-tracker/src/hooks/useLeaveRequests.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import {
  apiGet, apiPost, dtoToLeaveRequest, toast, ws,
} from "@/lib/api";
import type { LeaveRequest, LeaveRequestCreate } from "@/types";
import type { LeaveRequestDto } from "@/types/api/leave";

export function useLeaveRequests() {
  const [items, setItems] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const dtos = await apiGet<LeaveRequestDto[]>("/leave-requests/");
    setItems(dtos.map(dtoToLeaveRequest));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await reload(); } finally { if (!cancelled) setLoading(false); }
    })();
    const unsub = ws.subscribe<LeaveRequestDto>("leave", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToLeaveRequest(evt.record);
        setItems((prev) => prev.some((r) => r.id === next.id) ? prev : [next, ...prev]);
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToLeaveRequest(evt.record);
        setItems((prev) => prev.map((r) => r.id === next.id ? next : r));
      } else if (evt.event === "DELETE" && evt.record) {
        const uid = (evt.record as { uid?: string }).uid;
        if (uid) setItems((prev) => prev.filter((r) => r.id !== uid));
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [reload]);

  const create = useCallback(async (body: LeaveRequestCreate) => {
    const dto = await apiPost<LeaveRequestDto>("/leave-requests/", body);
    return dtoToLeaveRequest(dto);
  }, []);

  const approve = useCallback(async (uid: string) => {
    const dto = await apiPost<LeaveRequestDto>(`/leave-requests/${uid}/approve/`, {});
    toast.show(`Leave approved`, "ok");
    return dtoToLeaveRequest(dto);
  }, []);

  const reject = useCallback(async (uid: string, reason: string) => {
    const dto = await apiPost<LeaveRequestDto>(`/leave-requests/${uid}/reject/`, { reason });
    toast.show(`Leave rejected`, "ok");
    return dtoToLeaveRequest(dto);
  }, []);

  const withdraw = useCallback(async (uid: string) => {
    const dto = await apiPost<LeaveRequestDto>(`/leave-requests/${uid}/withdraw/`, {});
    toast.show(`Leave withdrawn`, "ok");
    return dtoToLeaveRequest(dto);
  }, []);

  return { items, loading, reload, create, approve, reject, withdraw };
}

/** Subscribe globally so a requester sees a toast when their own
 *  request is decided — even if their Leave tab isn't open. Mount once
 *  in `App.tsx` at root.
 */
export function useLeaveDecisionToasts(myUserUid: string | undefined) {
  useEffect(() => {
    if (!myUserUid) return;
    const unsub = ws.subscribe<LeaveRequestDto>("leave.approval", (evt) => {
      const r = evt.record;
      if (!r || r.user !== myUserUid) return;
      const decision = (evt as unknown as { decision?: string }).decision ?? r.status;
      if (decision === "Approved") toast.show(`✓ ${r.approver_detail?.full_name ?? "Approver"} approved your leave (${r.from_date} → ${r.to_date})`, "ok");
      if (decision === "Rejected") toast.show(`✗ ${r.approver_detail?.full_name ?? "Approver"} rejected your leave: "${r.rejection_reason || "(no reason given)"}"`, "err");
    });
    return () => { unsub(); };
  }, [myUserUid]);
}
```

### - [ ] Step 2: `useWfhApprovals`

Create `frontend/task-tracker/src/hooks/useWfhApprovals.ts`:

```typescript
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, dtoToAttendance, toast, ws } from "@/lib/api";
import type { AttendanceRecord } from "@/types";
import type { AttendanceDto } from "@/types/api";

export function useWfhApprovals() {
  const [items, setItems] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const dtos = await apiGet<AttendanceDto[]>("/attendance/?status=Present");
    const mapped = dtos.map(dtoToAttendance).filter(
      (r) => r.work_location === "WFH" && r.approval_state === "Pending",
    );
    setItems(mapped);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await reload(); } finally { if (!cancelled) setLoading(false); }
    })();
    const unsub = ws.subscribe<AttendanceDto>("attendance", (evt) => {
      if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToAttendance(evt.record);
        setItems((prev) => {
          const isPending = next.work_location === "WFH" && next.approval_state === "Pending";
          const exists = prev.some((r) => r.id === next.id);
          if (isPending) return exists ? prev.map((r) => r.id === next.id ? next : r) : [next, ...prev];
          return prev.filter((r) => r.id !== next.id);
        });
      } else if (evt.event === "INSERT" && evt.record) {
        const next = dtoToAttendance(evt.record);
        if (next.work_location === "WFH" && next.approval_state === "Pending") {
          setItems((prev) => prev.some((r) => r.id === next.id) ? prev : [next, ...prev]);
        }
      } else if (evt.event === "DELETE" && evt.record) {
        const uid = (evt.record as { uid?: string }).uid;
        if (uid) setItems((prev) => prev.filter((r) => r.id !== uid));
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [reload]);

  const approve = useCallback(async (uid: string) => {
    await apiPost(`/attendance/${uid}/approve_wfh/`, {});
    toast.show("WFH approved", "ok");
  }, []);

  const reject = useCallback(async (uid: string, reason: string) => {
    await apiPost(`/attendance/${uid}/reject_wfh/`, { reason });
    toast.show("WFH rejected", "ok");
  }, []);

  return { items, loading, reload, approve, reject };
}
```

### - [ ] Step 3: `useApprovalsBadge`

Create `frontend/task-tracker/src/hooks/useApprovalsBadge.ts`:

```typescript
import { useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";

interface ApprovalsPending {
  wfh_count: number;
  leave_count: number;
}

export function useApprovalsBadge() {
  const [count, setCount] = useState(0);

  const refresh = async () => {
    try {
      const data = await apiGet<ApprovalsPending>("/attendance/approvals_pending/");
      setCount(data.wfh_count + data.leave_count);
    } catch {
      /* network blip; safety-net interval will retry */
    }
  };

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    const unsubA = ws.subscribe<unknown>("attendance.approval", () => refresh());
    const unsubL = ws.subscribe<unknown>("leave.approval", () => refresh());
    return () => {
      window.clearInterval(interval);
      unsubA();
      unsubL();
    };
  }, []);

  return count;
}
```

### - [ ] Step 4: Commit

```bash
git add frontend/task-tracker/src/hooks/useLeaveRequests.ts frontend/task-tracker/src/hooks/useWfhApprovals.ts frontend/task-tracker/src/hooks/useApprovalsBadge.ts
git commit -m "feat(hooks): leave requests + WFH approvals + badge counter"
```

---

## Task 11: `RejectModal` + `EmployeeApprovalsTab`

**Files:**
- Create: `frontend/task-tracker/src/components/employee/RejectModal.tsx`
- Create: `frontend/task-tracker/src/components/employee/EmployeeApprovalsTab.tsx`

### - [ ] Step 1: `RejectModal`

Create `frontend/task-tracker/src/components/employee/RejectModal.tsx`:

```typescript
import { useState } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
}

export default function RejectModal({ open, title, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 16, width: 380 }}>
        <h3 style={{ margin: 0, marginBottom: 12 }}>{title}</h3>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason for rejection (required)"
          style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6 }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose} disabled={busy}
            style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>
            Cancel
          </button>
          <button
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit(reason.trim()); onClose(); setReason(""); }
              finally { setBusy(false); }
            }}
            style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer" }}>
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
```

### - [ ] Step 2: `EmployeeApprovalsTab`

Create `frontend/task-tracker/src/components/employee/EmployeeApprovalsTab.tsx`:

```typescript
import { useState } from "react";
import { useWfhApprovals } from "@/hooks/useWfhApprovals";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import RejectModal from "./RejectModal";
import { fmtDate } from "@/utils/date";
import { fmtClockTime } from "@/utils/time";

type RejectTarget = { kind: "wfh" | "leave"; uid: string; label: string } | null;

export default function EmployeeApprovalsTab() {
  const wfh = useWfhApprovals();
  const leave = useLeaveRequests();
  const pendingLeave = leave.items.filter((l) => l.status === "Pending");
  const [rejectTarget, setRejectTarget] = useState<RejectTarget>(null);

  const cell: React.CSSProperties = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid #e2e8f0" };
  const head: React.CSSProperties = { ...cell, background: "#f8fafc", fontWeight: 700 };

  return (
    <div style={{ padding: "10px 16px" }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Approvals</h2>

      <section style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 16 }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
          WFH approvals ({wfh.items.length})
        </div>
        {wfh.loading && <div style={{ padding: 14, color: "#64748b" }}>Loading…</div>}
        {!wfh.loading && wfh.items.length === 0 && (
          <div style={{ padding: 14, color: "#64748b" }}>Nothing pending.</div>
        )}
        {wfh.items.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>Employee</th>
                <th style={head}>Date</th>
                <th style={head}>Login</th>
                <th style={head}>Logout</th>
                <th style={head}>Remarks</th>
                <th style={head}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {wfh.items.map((r) => (
                <tr key={r.id}>
                  <td style={cell}>{r.employee_name}</td>
                  <td style={cell}>{fmtDate(r.date ?? "")}</td>
                  <td style={cell}>{fmtClockTime(r.login_time)}</td>
                  <td style={cell}>{fmtClockTime(r.logout_time) || "—"}</td>
                  <td style={cell}>{r.remarks || "—"}</td>
                  <td style={cell}>
                    <button onClick={() => void wfh.approve(r.id)}
                      style={{ marginRight: 6, padding: "4px 10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" }}>
                      Approve
                    </button>
                    <button onClick={() => setRejectTarget({ kind: "wfh", uid: r.id, label: `WFH ${r.employee_name} ${r.date}` })}
                      style={{ padding: "4px 10px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 5, cursor: "pointer" }}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", fontWeight: 700 }}>
          Leave approvals ({pendingLeave.length})
        </div>
        {leave.loading && <div style={{ padding: 14, color: "#64748b" }}>Loading…</div>}
        {!leave.loading && pendingLeave.length === 0 && (
          <div style={{ padding: 14, color: "#64748b" }}>Nothing pending.</div>
        )}
        {pendingLeave.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>Employee</th>
                <th style={head}>From → To</th>
                <th style={head}>Days</th>
                <th style={head}>Reason</th>
                <th style={head}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingLeave.map((l) => (
                <tr key={l.id}>
                  <td style={cell}>{l.user_name}</td>
                  <td style={cell}>{fmtDate(l.from_date)} ({l.from_session}) → {fmtDate(l.to_date)} ({l.to_session})</td>
                  <td style={cell}>{l.total_days}</td>
                  <td style={cell}>{l.reason}</td>
                  <td style={cell}>
                    <button onClick={() => void leave.approve(l.id)}
                      style={{ marginRight: 6, padding: "4px 10px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer" }}>
                      Approve
                    </button>
                    <button onClick={() => setRejectTarget({ kind: "leave", uid: l.id, label: `Leave ${l.user_name} ${l.from_date}` })}
                      style={{ padding: "4px 10px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 5, cursor: "pointer" }}>
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RejectModal
        open={rejectTarget !== null}
        title={rejectTarget ? `Reject — ${rejectTarget.label}` : ""}
        onClose={() => setRejectTarget(null)}
        onSubmit={async (reason) => {
          if (!rejectTarget) return;
          if (rejectTarget.kind === "wfh") await wfh.reject(rejectTarget.uid, reason);
          else await leave.reject(rejectTarget.uid, reason);
        }}
      />
    </div>
  );
}
```

### - [ ] Step 3: Commit

```bash
git add frontend/task-tracker/src/components/employee/RejectModal.tsx frontend/task-tracker/src/components/employee/EmployeeApprovalsTab.tsx
git commit -m "feat(employee): Approvals sub-tab UI"
```

---

## Task 12: Wire Approvals into Employee tab + badge

**Files:**
- Modify: `frontend/task-tracker/src/pages/EmployeePage.tsx`

### - [ ] Step 1: Import + add tab

Open `frontend/task-tracker/src/pages/EmployeePage.tsx`. Add at the top alongside other imports:

```typescript
import EmployeeApprovalsTab from "@/components/employee/EmployeeApprovalsTab";
import { useApprovalsBadge } from "@/hooks/useApprovalsBadge";
import { useAuth } from "@/hooks/useAuth";
```

Find the `SubTab` type:
```typescript
type SubTab = "personal" | "salary" | "documents";
```
Replace with:
```typescript
type SubTab = "personal" | "salary" | "documents" | "attendance" | "leave" | "approvals";
```

Inside the component, after the existing hook calls, add:
```typescript
  const { isManagerInAny, hasAttendanceInAny } = useAuth();
  const approvalsCount = useApprovalsBadge();
  // Spec §UI: attendance_access flag gates the three new sub-tabs;
  // Approvals additionally requires the user to be a manager/admin somewhere.
  const showAttendanceTabs = hasAttendanceInAny?.() ?? true;
  const showApprovalsTab = showAttendanceTabs && isManagerInAny();
```

(If `useAuth` doesn't expose `hasAttendanceInAny`, add it next to `isManagerInAny` — backed by `profile.access_flags.attendance_access` per existing pattern in `useAuth.ts`. The `?.()` guard above keeps this task non-blocking if the hook needs a small extension.)

Find the existing tab navigation block (search for `setSubTab("personal")` or similar). Add Approvals as a tab button — example pattern matching the existing buttons:

```typescript
{showApprovalsTab && (
  <button
    onClick={() => setSubTab("approvals")}
    style={{
      padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer",
      fontSize: 13, fontWeight: 600,
      background: subTab === "approvals" ? "#fff" : "transparent",
      color: subTab === "approvals" ? "#1e293b" : "#64748b",
    }}
  >
    Approvals{approvalsCount > 0 ? ` (${approvalsCount})` : ""}
  </button>
)}
```

(Place it after the Documents tab button. If Personal/Salary/Documents are rendered via `.map()`, replace with explicit buttons or extend the array; preserve the existing visual style.)

Find where each sub-tab body is rendered (e.g. `subTab === "personal" && (...)`). Append:
```typescript
{subTab === "approvals" && <EmployeeApprovalsTab />}
```

### - [ ] Step 2: Smoke-test in browser

```bash
cd frontend/task-tracker && npm run dev
```

Open `http://localhost:5173` (or your configured port). Log in as a manager. Navigate to **Employee → Approvals**. Confirm:
- The tab shows "Approvals" with no badge if nothing pending.
- File a WFH attendance row from another browser/incognito as one of the manager's employees → the badge should show `(1)` within ~1s without refresh (SSE).
- Approve / Reject buttons work; the row disappears from the queue.

### - [ ] Step 3: Commit

```bash
git add frontend/task-tracker/src/pages/EmployeePage.tsx
git commit -m "feat(employee): wire Approvals sub-tab + realtime badge"
```

---

## Phase 2 checkpoint

**Verification (real DB data):**

1. Visit Employee → Approvals as a manager. Empty queues show "Nothing pending."
2. Use the existing Attendance Log to create a WFH row as an employee that the manager supervises. The Approvals badge updates without refresh.
3. Approve from manager view → row disappears from queue and the SSE event flips the row's `approval_state` everywhere.
4. Reject without reason → modal blocks submit. With reason → row disappears.

**Pause for user verification before Phase 3.**

---

# PHASE 3 — Leave UX

## Task 13: `ApplyLeaveModal`

**Files:**
- Create: `frontend/task-tracker/src/components/employee/ApplyLeaveModal.tsx`

### - [ ] Step 1: Build the modal

Create `frontend/task-tracker/src/components/employee/ApplyLeaveModal.tsx`:

```typescript
import { useEffect, useMemo, useState } from "react";
import { TODAY } from "@/utils/date";
import type { LeaveSession } from "@/types/api/leave";
import type { Profile } from "@/types";

interface Props {
  open: boolean;
  profile: Profile | null;
  selectedOrg?: string;
  onClose: () => void;
  onSubmit: (body: {
    user: string; org: string;
    from_date: string; to_date: string;
    from_session: LeaveSession; to_session: LeaveSession;
    reason: string;
  }) => Promise<void>;
}

const SESSIONS: LeaveSession[] = ["Full", "First Half", "Second Half"];

export default function ApplyLeaveModal({ open, profile, selectedOrg, onClose, onSubmit }: Props) {
  const [from, setFrom] = useState(TODAY);
  const [to, setTo] = useState(TODAY);
  const [fromSession, setFromSession] = useState<LeaveSession>("Full");
  const [toSession, setToSession] = useState<LeaveSession>("Full");
  const [reason, setReason] = useState("");
  const [org, setOrg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const orgOptions = useMemo(() => profile?.orgs ?? [], [profile]);

  useEffect(() => {
    if (!open) return;
    setFrom(TODAY); setTo(TODAY);
    setFromSession("Full"); setToSession("Full");
    setReason(""); setErr(null);
    if (selectedOrg) setOrg(selectedOrg);
    else if (orgOptions.length === 1) setOrg(orgOptions[0].uid);
    else setOrg("");
  }, [open, orgOptions, selectedOrg]);

  if (!open) return null;

  const days = computeDays(from, to, fromSession, toSession);
  const canSubmit = !!from && !!to && from <= to && reason.trim() && org && !busy;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: 16, width: 460 }}>
        <h3 style={{ margin: "0 0 10px" }}>Apply Leave</h3>
        {err && <div style={{ background: "#fee2e2", color: "#dc2626", padding: 8, borderRadius: 6, marginBottom: 10 }}>{err}</div>}
        {orgOptions.length > 1 && (
          <Row label="Organisation">
            <select value={org} onChange={(e) => setOrg(e.target.value)} style={inp}>
              <option value="">— pick one —</option>
              {orgOptions.map((o) => <option key={o.uid} value={o.uid}>{o.name}</option>)}
            </select>
          </Row>
        )}
        <Row label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inp} />
          <select value={fromSession} onChange={(e) => setFromSession(e.target.value as LeaveSession)} style={{ ...inp, marginLeft: 6, width: 130 }}>
            {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
        <Row label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inp} />
          <select value={toSession} onChange={(e) => setToSession(e.target.value as LeaveSession)} style={{ ...inp, marginLeft: 6, width: 130 }}>
            {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
        <Row label="Reason">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ ...inp, fontFamily: "inherit" }} />
        </Row>
        <div style={{ fontSize: 13, color: "#475569", margin: "6px 0 12px" }}>
          Approx <strong>{days}</strong> day(s). Holidays + Sundays inside the range are skipped server-side.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={btnSecondary}>Cancel</button>
          <button
            disabled={!canSubmit}
            onClick={async () => {
              if (!profile) return;
              setBusy(true); setErr(null);
              try {
                await onSubmit({
                  user: profile.id, org,
                  from_date: from, to_date: to,
                  from_session: fromSession, to_session: toSession,
                  reason: reason.trim(),
                });
                onClose();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally { setBusy(false); }
            }}
            style={btnPrimary}>
            {busy ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
      <label style={{ width: 100, fontSize: 13, color: "#475569" }}>{label}</label>
      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

const inp: React.CSSProperties = { padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, width: "100%" };
const btnPrimary: React.CSSProperties = { padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 };
const btnSecondary: React.CSSProperties = { padding: "6px 14px", background: "#fff", color: "#475569", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" };

function computeDays(from: string, to: string, fromS: LeaveSession, toS: LeaveSession): number {
  if (!from || !to || from > to) return 0;
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  const diff = Math.floor((t.getTime() - f.getTime()) / 86400000) + 1;
  if (diff <= 0) return 0;
  if (diff === 1) {
    if (fromS === "Full" || toS === "Full") return 1;
    if (fromS === toS) return 0.5;
    return 1; // 1st half + 2nd half = full day
  }
  let d = diff;
  if (fromS !== "Full") d -= 0.5;
  if (toS !== "Full") d -= 0.5;
  return d;
}
```

### - [ ] Step 2: Commit

```bash
git add frontend/task-tracker/src/components/employee/ApplyLeaveModal.tsx
git commit -m "feat(employee): ApplyLeaveModal"
```

---

## Task 14: `EmployeeLeaveTab` + wire

**Files:**
- Create: `frontend/task-tracker/src/components/employee/EmployeeLeaveTab.tsx`
- Modify: `frontend/task-tracker/src/pages/EmployeePage.tsx`

### - [ ] Step 1: Build `EmployeeLeaveTab`

Create `frontend/task-tracker/src/components/employee/EmployeeLeaveTab.tsx`:

```typescript
import { useMemo, useState } from "react";
import ApplyLeaveModal from "./ApplyLeaveModal";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { fmtDate } from "@/utils/date";
import type { Profile } from "@/types";

interface Props {
  profile: Profile | null;
  selectedOrg?: string;
}

export default function EmployeeLeaveTab({ profile, selectedOrg }: Props) {
  const { items, loading, create, withdraw } = useLeaveRequests();
  const [open, setOpen] = useState(false);
  const [fStatus, setFStatus] = useState("");
  const [fMonth, setFMonth] = useState("");

  const my = useMemo(
    () => items.filter((r) => r.user_uid === profile?.id),
    [items, profile?.id],
  );
  const filtered = my.filter((r) =>
    (!fStatus || r.status === fStatus)
    && (!fMonth || r.from_date.startsWith(fMonth))
  );

  const cell: React.CSSProperties = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid #e2e8f0" };
  const head: React.CSSProperties = { ...cell, background: "#f8fafc", fontWeight: 700 };
  const inp: React.CSSProperties = { padding: "4px 8px", border: "1px solid #cbd5e1", borderRadius: 5, fontSize: 13 };

  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>My Leave Requests</h2>
        <button
          onClick={() => setOpen(true)}
          style={{ padding: "7px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
          + Apply Leave
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <select style={inp} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option>Pending</option><option>Approved</option><option>Rejected</option><option>Withdrawn</option>
        </select>
        <input type="month" style={inp} value={fMonth} onChange={(e) => setFMonth(e.target.value)} />
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
        {loading && <div style={{ padding: 14, color: "#64748b" }}>Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 14, color: "#64748b" }}>No leave requests yet.</div>
        )}
        {filtered.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>#</th>
                <th style={head}>Type</th>
                <th style={head}>From</th>
                <th style={head}>To</th>
                <th style={head}>Days</th>
                <th style={head}>Reason</th>
                <th style={head}>Status</th>
                <th style={head}>Approver</th>
                <th style={head}>Decided</th>
                <th style={head}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id}>
                  <td style={cell}>{i + 1}</td>
                  <td style={{ ...cell, color: "#94a3b8" }}>—</td>
                  <td style={cell}>{fmtDate(r.from_date)} ({r.from_session})</td>
                  <td style={cell}>{fmtDate(r.to_date)} ({r.to_session})</td>
                  <td style={cell}>{r.total_days}</td>
                  <td style={cell}>{r.reason}</td>
                  <td style={cell}>{r.status}</td>
                  <td style={cell}>{r.approver_name ?? "—"}</td>
                  <td style={cell}>{r.approved_at ? fmtDate(r.approved_at.slice(0, 10)) : "—"}</td>
                  <td style={cell}>
                    {(r.status === "Pending" || r.status === "Approved") && (
                      <button onClick={() => void withdraw(r.id)}
                        style={{ padding: "3px 10px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                        Withdraw
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ApplyLeaveModal
        open={open}
        profile={profile}
        selectedOrg={selectedOrg}
        onClose={() => setOpen(false)}
        onSubmit={async (body) => { await create(body); }}
      />
    </div>
  );
}
```

### - [ ] Step 2: Wire into Employee tab

In `frontend/task-tracker/src/pages/EmployeePage.tsx`, mirror Task 12 step 1 for the `leave` sub-tab:

- Import `EmployeeLeaveTab`.
- Add a "Leave" tab button (no badge).
- Render `<EmployeeLeaveTab profile={profile} selectedOrg={selectedOrg} />` when `subTab === "leave"`.

(`profile` and `selectedOrg` should already be available; if they're not currently passed into EmployeePage, thread them down from `App.tsx` matching the Conveyance pattern in commit `4c29897`.)

### - [ ] Step 3: Smoke-test

In the browser as an employee, click **+ Apply Leave**, file a 2-day leave (e.g. 28 Apr → 29 Apr, both Full). Observe the row appear with status "Pending". Switch to the manager browser → Approvals tab shows the new leave under "Leave approvals". Approve → matrix-row materialisation will be checked once Phase 4 lands; for now, verify the leave row flips to "Approved" and `approver_name` populates.

### - [ ] Step 4: Commit

```bash
git add frontend/task-tracker/src/components/employee/EmployeeLeaveTab.tsx frontend/task-tracker/src/pages/EmployeePage.tsx
git commit -m "feat(employee): Leave sub-tab with apply + withdraw"
```

---

## Phase 3 checkpoint

**Verification:**

1. Apply a leave (today + 1 day, both Full) → request appears in My Requests as Pending; in Manager → Approvals; Approvals badge increments.
2. Approve from manager → row flips to Approved with approver name + decided date.
3. Backend: `python manage.py shell -c "from core.attendance.models import Attendance; print(Attendance.objects.filter(status='Leave', date__gte='2026-04-25').count())"` shows the materialised rows.
4. Withdraw the request → status flips to Withdrawn; the materialised Attendance rows are deleted (re-run the count above; should drop).

**Pause for user verification.**

---

# PHASE 4 — Matrix view (the headline)

## Task 15: Backend `matrix.py` + `/attendance/matrix/`

**Files:**
- Create: `core/attendance/matrix.py`
- Modify: `core/attendance/views.py`
- Create: `core/attendance/test_matrix.py`

### - [ ] Step 1: Write `matrix.py` (pure)

Create `core/attendance/matrix.py`:

```python
"""Pure-Python cell derivation for the monthly Attendance Matrix.

Inputs are plain dicts so this module is testable without the DB. The view
adapter assembles inputs from querysets and hands them to ``build_matrix``.
"""

from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass


@dataclass
class CellInput:
    date: dt.date
    is_holiday: bool       # explicit Holiday row
    is_override: bool      # WorkingDayOverride(is_working=True)
    holiday_name: str | None
    attendance: dict | None  # serialised Attendance row or None
    leave_sessions: list[str]  # any approved leave sessions covering this date


def derive_cell(inp: CellInput) -> dict:
    """Return {code, hours?, login?, logout?, location?, approval?, holiday_name?}."""
    a = inp.attendance
    has_punch_in = bool(a and a.get("login_time"))
    has_punch_out = bool(a and a.get("logout_time"))
    hours = _hours(a) if a else None

    # Priority order — first match wins (spec §Matrix view).
    if has_punch_in and not has_punch_out:
        return _cell("?", a, hours)
    if inp.is_holiday or (inp.date.weekday() == calendar.SUNDAY and not inp.is_override):
        if a and has_punch_in:
            return _cell("HW", a, hours, holiday_name=inp.holiday_name or "Sunday")
        return {"code": "HD", "holiday_name": inp.holiday_name or "Sunday"}
    if a and a.get("work_location") == "WFH" and a.get("approval_state") == "Pending":
        return _cell("WP", a, hours)
    if a and a.get("work_location") == "WFH" and a.get("approval_state") == "Approved" and (hours or 0) >= 4:
        return _cell("WFH", a, hours)
    # Half-day leave + half-day work composite
    if "First Half" in inp.leave_sessions and a and a.get("status") == "Half Day":
        return _cell("L½+H", a, hours)
    if "Second Half" in inp.leave_sessions and a and a.get("status") == "Half Day":
        return _cell("L½+H", a, hours)
    if "Full" in inp.leave_sessions:
        return {"code": "L"}
    if any(s in inp.leave_sessions for s in ("First Half", "Second Half")):
        return {"code": "L½"}
    if a:
        h = hours or 0
        if h >= 8.5 or a.get("status") == "Present":
            return _cell("P", a, hours)
        if h >= 4:
            return _cell("H", a, hours)
    return {"code": "A"}


def _cell(code: str, a: dict | None, hours: float | None, **extra) -> dict:
    if not a:
        return {"code": code, **extra}
    return {
        "code": code,
        "hours": hours,
        "login": a.get("login_time"),
        "logout": a.get("logout_time"),
        "location": a.get("work_location"),
        "approval": a.get("approval_state"),
        **extra,
    }


def _hours(a: dict) -> float | None:
    li = a.get("login_time"); lo = a.get("logout_time")
    if not li or not lo:
        return None
    h1, m1, *_ = (int(p) for p in li.split(":"))
    h2, m2, *_ = (int(p) for p in lo.split(":"))
    delta = (h2 * 60 + m2) - (h1 * 60 + m1)
    return round(delta / 60, 2)


def build_matrix(*, employees, dates, attendance_rows, leave_rows, holidays, overrides) -> dict:
    """Assemble the matrix payload.

    All inputs are simple iterables — see view for assembly.
    """
    holiday_map = {h.date: h.name for h in holidays}
    override_dates = {o.date for o in overrides if o.is_working}

    by_user_date: dict[tuple[int, dt.date], dict] = {}
    for r in attendance_rows:
        by_user_date[(r.user_id, r.date)] = {
            "login_time": r.login_time.strftime("%H:%M") if r.login_time else None,
            "logout_time": r.logout_time.strftime("%H:%M") if r.logout_time else None,
            "work_location": r.work_location,
            "approval_state": r.approval_state,
            "status": r.status,
            "leave_session": r.leave_session,
        }

    leave_by_user: dict[int, list] = {}
    for lv in leave_rows:
        if lv.status != "Approved":
            continue
        for date, session in lv.included_dates():
            leave_by_user.setdefault(lv.user_id, []).append((date, session))

    cells: dict[str, dict[str, dict]] = {}
    for emp in employees:
        emp_cells: dict[str, dict] = {}
        leaves = {(d, s) for (d, s) in leave_by_user.get(emp.id, [])}
        for d in dates:
            sessions = [s for (ld, s) in leaves if ld == d]
            inp = CellInput(
                date=d,
                is_holiday=d in holiday_map,
                is_override=d in override_dates,
                holiday_name=holiday_map.get(d),
                attendance=by_user_date.get((emp.id, d)),
                leave_sessions=sessions,
            )
            emp_cells[d.isoformat()] = derive_cell(inp)
        cells[str(emp.uid)] = emp_cells

    return {
        "employees": [
            {"uid": str(e.uid), "full_name": e.full_name, "org_uids": [str(o.uid) for o in e.orgs.all()]}
            for e in employees
        ],
        "dates": [
            {
                "date": d.isoformat(),
                "weekday": d.strftime("%a"),
                "is_holiday": d in holiday_map,
                "is_override": d in override_dates,
                "holiday_name": holiday_map.get(d),
            }
            for d in dates
        ],
        "cells": cells,
    }
```

### - [ ] Step 2: Write tests for the cell logic

Create `core/attendance/test_matrix.py`:

```python
import datetime as dt

from django.test import TestCase

from core.attendance.matrix import CellInput, derive_cell


def _att(login=None, logout=None, location="Office", approval=None, status="Present"):
    return {
        "login_time": login,
        "logout_time": logout,
        "work_location": location,
        "approval_state": approval,
        "status": status,
        "leave_session": None,
    }


class DeriveCellTests(TestCase):
    D = dt.date(2026, 4, 23)  # Thursday
    SUN = dt.date(2026, 4, 26)  # Sunday

    def test_open_punch_wins_over_everything(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att(login="09:00"), []))
        self.assertEqual(cell["code"], "?")

    def test_sunday_renders_HD_when_no_override(self):
        cell = derive_cell(CellInput(self.SUN, False, False, None, None, []))
        self.assertEqual(cell["code"], "HD")

    def test_sunday_with_override_treats_as_workday(self):
        cell = derive_cell(CellInput(self.SUN, False, True, None, None, []))
        self.assertEqual(cell["code"], "A")

    def test_holiday_with_punch_renders_HW(self):
        cell = derive_cell(CellInput(self.D, True, False, "Republic Day", _att("09:00", "18:00"), []))
        self.assertEqual(cell["code"], "HW")
        self.assertEqual(cell["holiday_name"], "Republic Day")

    def test_wfh_pending(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "18:00", "WFH", "Pending"), []))
        self.assertEqual(cell["code"], "WP")

    def test_wfh_approved_full_day(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "18:00", "WFH", "Approved"), []))
        self.assertEqual(cell["code"], "WFH")

    def test_present_at_exactly_85_hours(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "17:30"), []))
        self.assertEqual(cell["code"], "P")
        self.assertEqual(cell["hours"], 8.5)

    def test_half_day_at_4_hours(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "13:00"), []))
        self.assertEqual(cell["code"], "H")

    def test_under_4_hours_with_no_explicit_present_becomes_A(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "12:00", status="Half Day"), []))
        # 3 hours, Half Day status — falls through; status='Present' would force P.
        self.assertEqual(cell["code"], "A")

    def test_full_leave(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, ["Full"]))
        self.assertEqual(cell["code"], "L")

    def test_half_leave_alone(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, ["First Half"]))
        self.assertEqual(cell["code"], "L½")

    def test_half_leave_plus_half_work(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("13:00", "17:00", status="Half Day"), ["First Half"]))
        self.assertEqual(cell["code"], "L½+H")

    def test_absent_default(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, []))
        self.assertEqual(cell["code"], "A")
```

### - [ ] Step 3: Run cell tests

```bash
python manage.py test core.attendance.test_matrix -v 2
```

Expected: 13 tests pass.

### - [ ] Step 4: Add the `matrix` action to `AttendanceViewSet`

In `core/attendance/views.py`, add at the end of the class:

```python
    @action(detail=False, methods=["get"], url_path="matrix")
    def matrix(self, request):
        from datetime import date as date_cls
        from core.holidays.models import Holiday
        from core.leave.models import LeaveRequest
        from core.working_days.models import WorkingDayOverride
        from core.attendance.matrix import build_matrix

        actor = cast(User, request.user)
        month = request.query_params.get("month")
        if not month:
            return Response({"error": "month=YYYY-MM is required"}, status=400)
        try:
            year, mo = (int(p) for p in month.split("-"))
            first = date_cls(year, mo, 1)
        except ValueError:
            return Response({"error": "month must be YYYY-MM"}, status=400)
        # Last day of month
        if mo == 12:
            next_first = date_cls(year + 1, 1, 1)
        else:
            next_first = date_cls(year, mo + 1, 1)
        from datetime import timedelta
        last = next_first - timedelta(days=1)
        dates = [first + timedelta(days=i) for i in range((last - first).days + 1)]

        # Visible employees
        emps = User.objects.filter(memberships__org_id__in=actor.org_ids()).distinct()
        if not actor.memberships.filter(role__in=("admin", "manager")).exists():
            emps = emps.filter(pk=actor.pk)
        elif not actor.memberships.filter(role="admin").exists():
            # Manager: self + subordinates
            sub_ids = list(actor.subordinates.values_list("pk", flat=True))
            emps = emps.filter(pk__in=[*sub_ids, actor.pk])
        org_uid = request.query_params.get("org_uid")
        if org_uid:
            emps = emps.filter(memberships__org__uid=org_uid)
        emps = emps.prefetch_related("orgs")

        emp_ids = list(emps.values_list("pk", flat=True))
        attendance_rows = Attendance.objects.filter(user_id__in=emp_ids, date__range=(first, last))
        leave_rows = LeaveRequest.objects.filter(user_id__in=emp_ids, status="Approved", from_date__lte=last, to_date__gte=first)
        holidays = Holiday.objects.filter(date__range=(first, last))
        overrides = WorkingDayOverride.objects.filter(date__range=(first, last))
        if org_uid:
            attendance_rows = attendance_rows.filter(org__uid=org_uid)
            leave_rows = leave_rows.filter(org__uid=org_uid)
            holidays = holidays.filter(org__uid=org_uid)
            overrides = overrides.filter(org__uid=org_uid)

        payload = build_matrix(
            employees=list(emps),
            dates=dates,
            attendance_rows=list(attendance_rows),
            leave_rows=list(leave_rows),
            holidays=list(holidays),
            overrides=list(overrides),
        )
        return Response(payload)
```

### - [ ] Step 5: Smoke-test the endpoint

`curl http://localhost:8000/api/attendance/matrix/?month=2026-04 -H "Cookie: <your session cookie>"` (or open in browser as logged-in user). Expected: a JSON with `employees`, `dates`, `cells` keys.

### - [ ] Step 6: Commit

```bash
git add core/attendance/matrix.py core/attendance/test_matrix.py core/attendance/views.py
git commit -m "feat(attendance): /matrix/ endpoint + pure cell derivation"
```

---

## Task 16: Frontend matrix util + tests

**Files:**
- Create: `frontend/task-tracker/src/utils/matrixCells.ts`
- Create: `frontend/task-tracker/src/__tests__/utils/matrixCells.test.ts`

### - [ ] Step 1: Write style helpers

Create `frontend/task-tracker/src/utils/matrixCells.ts`:

```typescript
export type CellCode = "P" | "H" | "A" | "L" | "L½" | "L½+H" | "WFH" | "WP" | "HW" | "?" | "HD";

export interface CellPayload {
  code: CellCode;
  hours?: number;
  login?: string;
  logout?: string;
  location?: string;
  approval?: string;
  holiday_name?: string;
}

export const CELL_STYLE: Record<CellCode, { bg: string; color: string; outline?: string }> = {
  P:     { bg: "#dcfce7", color: "#166534" },
  H:     { bg: "#fef3c7", color: "#92400e" },
  A:     { bg: "#fee2e2", color: "#991b1b" },
  L:     { bg: "#ede9fe", color: "#5b21b6" },
  "L½":  { bg: "#ede9fe", color: "#5b21b6" },
  "L½+H":{ bg: "#fef3c7", color: "#5b21b6" },
  WFH:   { bg: "#cffafe", color: "#0e7490" },
  WP:    { bg: "#fff",   color: "#0e7490", outline: "#0e7490" },
  HW:    { bg: "#a5f3fc", color: "#155e75" },
  "?":   { bg: "#fff",   color: "#dc2626", outline: "#dc2626" },
  HD:    { bg: "#e2e8f0", color: "#475569" },
};

export function tooltipFor(date: string, c: CellPayload): string {
  const parts: string[] = [date];
  if (c.login || c.logout) parts.push(`${c.login ?? "—"} – ${c.logout ?? "—"}`);
  if (c.location) parts.push(c.location);
  if (c.approval) parts.push(c.approval);
  if (c.holiday_name) parts.push(c.holiday_name);
  return parts.join(" · ");
}

export function totalsFor(cells: Record<string, CellPayload>): Record<CellCode, number> {
  const totals: Record<CellCode, number> = {
    P: 0, H: 0, A: 0, L: 0, "L½": 0, "L½+H": 0, WFH: 0, WP: 0, HW: 0, "?": 0, HD: 0,
  };
  for (const c of Object.values(cells)) totals[c.code] += 1;
  return totals;
}
```

### - [ ] Step 2: Write the unit tests

Create `frontend/task-tracker/src/__tests__/utils/matrixCells.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { tooltipFor, totalsFor, type CellPayload } from "@/utils/matrixCells";

describe("tooltipFor", () => {
  it("includes date, times, location and approval", () => {
    const c: CellPayload = { code: "WFH", login: "09:00", logout: "18:00", location: "WFH", approval: "Approved" };
    expect(tooltipFor("23 Apr 2026", c)).toBe("23 Apr 2026 · 09:00 – 18:00 · WFH · Approved");
  });
  it("falls back gracefully when fields are missing", () => {
    expect(tooltipFor("23 Apr 2026", { code: "A" })).toBe("23 Apr 2026");
  });
});

describe("totalsFor", () => {
  it("counts each code", () => {
    const cells: Record<string, CellPayload> = {
      "2026-04-01": { code: "P" },
      "2026-04-02": { code: "P" },
      "2026-04-03": { code: "WFH" },
      "2026-04-04": { code: "L" },
      "2026-04-05": { code: "?" },
    };
    const t = totalsFor(cells);
    expect(t.P).toBe(2);
    expect(t.WFH).toBe(1);
    expect(t.L).toBe(1);
    expect(t["?"]).toBe(1);
    expect(t.A).toBe(0);
  });
});
```

### - [ ] Step 3: Run vitest

```bash
cd frontend/task-tracker && npm test -- matrixCells
```

Expected: 3 tests pass.

### - [ ] Step 4: Commit

```bash
git add frontend/task-tracker/src/utils/matrixCells.ts frontend/task-tracker/src/__tests__/utils/matrixCells.test.ts
git commit -m "feat(matrix): cell style + tooltip helpers + tests"
```

---

## Task 17: `useAttendanceMatrix` hook + matrix components

**Files:**
- Create: `frontend/task-tracker/src/hooks/useAttendanceMatrix.ts`
- Create: `frontend/task-tracker/src/components/attendance/MatrixCell.tsx`
- Create: `frontend/task-tracker/src/components/attendance/MatrixLegend.tsx`
- Create: `frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx`

### - [ ] Step 1: Hook

Create `frontend/task-tracker/src/hooks/useAttendanceMatrix.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { CellPayload } from "@/utils/matrixCells";

export interface MatrixEmployee { uid: string; full_name: string; org_uids: string[]; }
export interface MatrixDate { date: string; weekday: string; is_holiday: boolean; is_override: boolean; holiday_name: string | null; }
export interface MatrixPayload {
  employees: MatrixEmployee[];
  dates: MatrixDate[];
  cells: Record<string, Record<string, CellPayload>>; // [user_uid][date] -> CellPayload
}

export function useAttendanceMatrix(month: string, orgUid?: string) {
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const params = new URLSearchParams({ month });
    if (orgUid) params.set("org_uid", orgUid);
    const payload = await apiGet<MatrixPayload>(`/attendance/matrix/?${params.toString()}`);
    setData(payload);
  }, [month, orgUid]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try { await reload(); } finally { if (!cancelled) setLoading(false); }
    })();
    // Refresh on any attendance/leave event — small payloads, simplest approach.
    const unsubA = ws.subscribe<unknown>("attendance", () => { void reload(); });
    const unsubL = ws.subscribe<unknown>("leave", () => { void reload(); });
    return () => { cancelled = true; unsubA(); unsubL(); };
  }, [reload]);

  return { data, loading, reload };
}
```

### - [ ] Step 2: `MatrixCell`

Create `frontend/task-tracker/src/components/attendance/MatrixCell.tsx`:

```typescript
import { CELL_STYLE, tooltipFor, type CellPayload } from "@/utils/matrixCells";

interface Props {
  date: string;
  payload: CellPayload;
  onClick?: () => void;
}

export default function MatrixCell({ date, payload, onClick }: Props) {
  const s = CELL_STYLE[payload.code];
  return (
    <div
      onClick={onClick}
      title={tooltipFor(date, payload)}
      style={{
        width: 32, height: 28, lineHeight: "28px", textAlign: "center",
        background: s.bg, color: s.color,
        border: s.outline ? `1px solid ${s.outline}` : "1px solid transparent",
        fontSize: 11, fontWeight: 700, cursor: onClick ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {payload.code}
    </div>
  );
}
```

### - [ ] Step 3: `MatrixLegend`

Create `frontend/task-tracker/src/components/attendance/MatrixLegend.tsx`:

```typescript
import { useState } from "react";
import { CELL_STYLE, type CellCode } from "@/utils/matrixCells";

const ENTRIES: { code: CellCode; label: string }[] = [
  { code: "P", label: "Present (≥ 8.5h)" },
  { code: "H", label: "Half day (4–8.5h)" },
  { code: "A", label: "Absent" },
  { code: "L", label: "Leave (full)" },
  { code: "L½", label: "Half-day leave" },
  { code: "L½+H", label: "Half leave + half worked" },
  { code: "WFH", label: "WFH (approved)" },
  { code: "WP", label: "WFH pending" },
  { code: "HW", label: "Holiday worked" },
  { code: "?", label: "Open punch — needs logout fix" },
  { code: "HD", label: "Holiday / Sunday" },
];

export default function MatrixLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", padding: "8px 12px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}
      >
        {open ? "▾" : "▸"} Legend
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {ENTRIES.map((e) => {
            const s = CELL_STYLE[e.code];
            return (
              <div key={e.code} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span style={{
                  background: s.bg, color: s.color,
                  border: s.outline ? `1px solid ${s.outline}` : "1px solid transparent",
                  width: 28, height: 22, lineHeight: "22px", textAlign: "center",
                  fontWeight: 700, fontSize: 11, borderRadius: 3,
                }}>{e.code}</span>
                <span style={{ color: "#475569" }}>{e.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

### - [ ] Step 4: `AttendanceMatrixView`

Create `frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx`:

```typescript
import { useMemo, useState } from "react";
import { useAttendanceMatrix } from "@/hooks/useAttendanceMatrix";
import MatrixCell from "./MatrixCell";
import MatrixLegend from "./MatrixLegend";
import { totalsFor, type CellPayload } from "@/utils/matrixCells";
import { TODAY } from "@/utils/date";

interface Props {
  selectedOrg?: string;
}

export default function AttendanceMatrixView({ selectedOrg }: Props) {
  const [month, setMonth] = useState(TODAY.slice(0, 7));
  const { data, loading } = useAttendanceMatrix(month, selectedOrg);

  const totalsPerEmp = useMemo(() => {
    if (!data) return {};
    const out: Record<string, ReturnType<typeof totalsFor>> = {};
    for (const emp of data.employees) {
      out[emp.uid] = totalsFor(data.cells[emp.uid] ?? {});
    }
    return out;
  }, [data]);

  if (loading || !data) return <div style={{ padding: 14, color: "#64748b" }}>Loading…</div>;

  const head: React.CSSProperties = { padding: 4, fontSize: 11, fontWeight: 700, color: "#475569", textAlign: "center", borderBottom: "1px solid #e2e8f0" };
  const empCell: React.CSSProperties = { padding: "4px 8px", fontSize: 12, fontWeight: 600, color: "#1e293b", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap", background: "#fff", position: "sticky", left: 0, zIndex: 1 };
  const totalCol: React.CSSProperties = { ...head, padding: "4px 6px", fontWeight: 700, color: "#1e293b", borderLeft: "1px solid #e2e8f0" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ padding: "5px 9px", border: "1px solid #cbd5e1", borderRadius: 5, fontSize: 13 }} />
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{data.employees.length} employees · {data.dates.length} days</span>
      </div>
      <MatrixLegend />
      <div style={{ overflow: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...empCell, top: 0, zIndex: 3 }}>Employee</th>
              {data.dates.map((d) => (
                <th key={d.date} style={{
                  ...head, minWidth: 32,
                  background: d.is_holiday ? "#fff7ed" : d.weekday === "Sun" && !d.is_override ? "#f1f5f9" : "#fff",
                }}>
                  <div>{parseInt(d.date.slice(8))}</div>
                  <div style={{ fontWeight: 500, color: "#94a3b8" }}>{d.weekday[0]}</div>
                </th>
              ))}
              {(["P","H","L","WFH","HW","?","WP"] as const).map((c) => (
                <th key={c} style={totalCol}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.employees.map((emp) => (
              <tr key={emp.uid}>
                <td style={empCell}>
                  {emp.full_name}
                  {emp.org_uids.length > 1 && (
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>{emp.org_uids.length} orgs</div>
                  )}
                </td>
                {data.dates.map((d) => {
                  const c: CellPayload = data.cells[emp.uid]?.[d.date] ?? { code: "A" };
                  return (
                    <td key={d.date} style={{ padding: 0, borderBottom: "1px solid #f1f5f9" }}>
                      <MatrixCell date={d.date} payload={c} />
                    </td>
                  );
                })}
                {(["P","H","L","WFH","HW","?","WP"] as const).map((c) => (
                  <td key={c} style={{ ...totalCol, fontSize: 11 }}>
                    {totalsPerEmp[emp.uid]?.[c] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### - [ ] Step 5: Add employee multi-select + status filters above the grid

In `AttendanceMatrixView.tsx`, replace the small "{N employees · M days}" line with a filter row:

```typescript
const [empFilter, setEmpFilter] = useState<Set<string>>(new Set());
const [codeFilter, setCodeFilter] = useState<Set<CellCode>>(new Set());

// inside JSX, before MatrixLegend:
<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
  <select
    multiple
    value={[...empFilter]}
    onChange={(e) => setEmpFilter(new Set([...e.target.selectedOptions].map((o) => o.value)))}
    style={{ minWidth: 180, padding: 4, border: "1px solid #cbd5e1", borderRadius: 5, fontSize: 12 }}
  >
    {data.employees.map((e) => <option key={e.uid} value={e.uid}>{e.full_name}</option>)}
  </select>
  {(["?", "WP", "A"] as const).map((c) => (
    <label key={c} style={{ fontSize: 12, color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
      <input type="checkbox" checked={codeFilter.has(c)}
        onChange={(e) => {
          const next = new Set(codeFilter);
          if (e.target.checked) next.add(c); else next.delete(c);
          setCodeFilter(next);
        }} />
      Highlight {c}
    </label>
  ))}
</div>
```

Then in the body, filter `data.employees` to `empFilter.size === 0 ? data.employees : data.employees.filter((e) => empFilter.has(e.uid))`. For each `MatrixCell`, pass an `outlined` prop when `codeFilter.has(payload.code)` and update `MatrixCell` to draw a 2px outline in those cases.

### - [ ] Step 6: Commit

```bash
git add frontend/task-tracker/src/hooks/useAttendanceMatrix.ts frontend/task-tracker/src/components/attendance/MatrixCell.tsx frontend/task-tracker/src/components/attendance/MatrixLegend.tsx frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx
git commit -m "feat(matrix): hook + cell + legend + grid view + filters"
```

---

## Task 18: `EmployeeAttendanceTab` wraps Log/Matrix/Report

**Files:**
- Create: `frontend/task-tracker/src/components/employee/EmployeeAttendanceTab.tsx`
- Modify: `frontend/task-tracker/src/pages/EmployeePage.tsx`

### - [ ] Step 1: Create the wrapper

Create `frontend/task-tracker/src/components/employee/EmployeeAttendanceTab.tsx`:

```typescript
import { useState } from "react";
import AttendancePage from "@/pages/AttendancePage";
import AttendanceMatrixView from "@/components/attendance/AttendanceMatrixView";
import type { Profile } from "@/types";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  profile: Profile | null;
  profiles: Profile[];
  selectedOrg?: string;
}

type View = "log" | "matrix" | "report";

export default function EmployeeAttendanceTab({ profile, profiles, selectedOrg }: Props) {
  const { isManagerInAny } = useAuth();
  const [view, setView] = useState<View>(isManagerInAny() ? "matrix" : "log");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, padding: "10px 16px 0" }}>
        {(["log","matrix","report"] as const).map((v) => (
          <button key={v}
            onClick={() => setView(v)}
            style={{
              padding: "5px 14px", borderRadius: 6, border: "1px solid #cbd5e1",
              background: view === v ? "#1e293b" : "#fff",
              color: view === v ? "#fff" : "#475569",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>
            {v === "log" ? "📋 Log" : v === "matrix" ? "📊 Matrix" : "📈 Report"}
          </button>
        ))}
      </div>
      {view === "matrix" ? (
        <div style={{ padding: "10px 16px" }}>
          <AttendanceMatrixView selectedOrg={selectedOrg} />
        </div>
      ) : view === "log" ? (
        <AttendancePage profile={profile} profiles={profiles} selectedOrg={selectedOrg} />
      ) : (
        // The Report view today lives inside AttendancePage's sub-tab. Render
        // AttendancePage with a flag that picks Report directly. Since
        // AttendancePage already has its own log/report toggle, just render it
        // and let the user click Report — for v1 this is acceptable; cleaner
        // split lands in Phase 5.
        <AttendancePage profile={profile} profiles={profiles} selectedOrg={selectedOrg} />
      )}
    </div>
  );
}
```

### - [ ] Step 2: Wire `attendance` sub-tab into `EmployeePage`

In `frontend/task-tracker/src/pages/EmployeePage.tsx`:

- Import `EmployeeAttendanceTab`.
- Add an "Attendance" tab button (no badge).
- Render `<EmployeeAttendanceTab profile={profile} profiles={profiles} selectedOrg={selectedOrg} />` when `subTab === "attendance"`.
- For employees, this is the default sub-tab; for managers/admins, default to Approvals or Personal as already wired (no change needed).

### - [ ] Step 3: Smoke-test

Open Employee → Attendance → Matrix as an admin. Confirm:
- Current month shows employee rows.
- Sundays render as full-column tinted gray.
- A WFH-pending row shows as `WP` (cyan outline).
- Hovering a cell shows the tooltip.
- The totals on the right sum `P/H/L/WFH/HW/?/WP`.

### - [ ] Step 4: Commit

```bash
git add frontend/task-tracker/src/components/employee/EmployeeAttendanceTab.tsx frontend/task-tracker/src/pages/EmployeePage.tsx
git commit -m "feat(employee): Attendance sub-tab with Log/Matrix/Report toggle"
```

---

## Phase 4 checkpoint

**Verification:**

1. Employee → Attendance → Matrix renders for the current month using your real April 2026 data (Vetrivel S, Sulthan Alavutheen).
2. Codes appear correctly: WFH-approved rows = `WFH`; April 26 (Sun) = `HD` and tinted; missing days = `A`.
3. File a leave for Sulthan from another browser, approve as admin, and the matrix refreshes (SSE) showing `L` on those dates.
4. Open-punch row (login but no logout) shows `?`.

**Pause for user verification.**

---

# PHASE 5 — Polish & restructure

## Task 19: Sunday-override admin UI under Holidays

**Files:**
- Create: `frontend/task-tracker/src/types/api/working-day.ts`
- Create: `frontend/task-tracker/src/hooks/useWorkingDayOverrides.ts`
- Create: `frontend/task-tracker/src/components/holidays/WorkingDayOverridesTab.tsx`
- Modify: existing Holidays page to add the new sub-tab (file path will be discovered during implementation; the Holidays UI is rendered from the top-level `Masters` or a dedicated holidays page — find by grep on `Holiday`).

### - [ ] Step 1: Types

Create `frontend/task-tracker/src/types/api/working-day.ts`:

```typescript
export interface WorkingDayOverrideDto {
  id: number;
  uid: string;
  org_uid: string;
  date: string;
  is_working: boolean;
  note: string;
  created_at: string;
}

export interface WorkingDayOverrideCreate {
  date: string;
  is_working: boolean;
  note: string;
  org: string;
}
```

### - [ ] Step 2: Hook

Create `frontend/task-tracker/src/hooks/useWorkingDayOverrides.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type { WorkingDayOverrideDto, WorkingDayOverrideCreate } from "@/types/api/working-day";

export function useWorkingDayOverrides() {
  const [items, setItems] = useState<WorkingDayOverrideDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await apiGet<WorkingDayOverrideDto[]>("/working-day-overrides/");
    setItems(data);
  }, []);

  useEffect(() => { void reload().finally(() => setLoading(false)); }, [reload]);

  const create = useCallback(async (body: WorkingDayOverrideCreate) => {
    const dto = await apiPost<WorkingDayOverrideDto>("/working-day-overrides/", body);
    setItems((p) => [dto, ...p]);
  }, []);

  const remove = useCallback(async (uid: string) => {
    await apiDelete(`/working-day-overrides/${uid}/`);
    setItems((p) => p.filter((r) => r.uid !== uid));
  }, []);

  return { items, loading, reload, create, remove };
}
```

### - [ ] Step 3: Tab

Create `frontend/task-tracker/src/components/holidays/WorkingDayOverridesTab.tsx`:

```typescript
import { useState } from "react";
import { useWorkingDayOverrides } from "@/hooks/useWorkingDayOverrides";
import { fmtDate, TODAY } from "@/utils/date";
import type { Profile } from "@/types";

interface Props { profile: Profile | null; selectedOrg?: string; }

export default function WorkingDayOverridesTab({ profile, selectedOrg }: Props) {
  const { items, loading, create, remove } = useWorkingDayOverrides();
  const [date, setDate] = useState(TODAY);
  const [note, setNote] = useState("");
  const [org, setOrg] = useState<string>(selectedOrg ?? "");
  const [busy, setBusy] = useState(false);
  const orgs = profile?.orgs ?? [];

  const cell: React.CSSProperties = { padding: "6px 10px", fontSize: 13, borderBottom: "1px solid #e2e8f0" };
  const head: React.CSSProperties = { ...cell, background: "#f8fafc", fontWeight: 700 };

  return (
    <div style={{ padding: "10px 16px" }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Sunday / Working-Day Overrides</h2>
      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "8px 12px", borderRadius: 6, fontSize: 12, color: "#1e40af", marginBottom: 12 }}>
        Mark a Sunday as working (e.g. release weekends). Holiday rows in the Holidays tab still take precedence.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
        <input placeholder="Note (e.g. team release)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inp, width: 240 }} />
        {orgs.length > 1 && (
          <select value={org} onChange={(e) => setOrg(e.target.value)} style={inp}>
            <option value="">— pick org —</option>
            {orgs.map((o) => <option key={o.uid} value={o.uid}>{o.name}</option>)}
          </select>
        )}
        <button
          disabled={busy || !date || (!org && orgs.length > 1)}
          onClick={async () => {
            setBusy(true);
            try {
              const todayDate = new Date(date + "T00:00:00");
              const past = todayDate.getTime() < Date.now() - 86_400_000;
              if (past && !window.confirm("This date is in the past — flipping it may change historical attendance codes. Continue?")) return;
              await create({ date, is_working: true, note: note.trim(), org: org || orgs[0]?.uid });
              setNote("");
            } finally { setBusy(false); }
          }}
          style={{ padding: "6px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
          + Add as working day
        </button>
      </div>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
        {loading && <div style={{ padding: 14, color: "#64748b" }}>Loading…</div>}
        {!loading && items.length === 0 && <div style={{ padding: 14, color: "#64748b" }}>No overrides yet.</div>}
        {items.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={head}>Date</th><th style={head}>Note</th><th style={head}>Actions</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.uid}>
                  <td style={cell}>{fmtDate(r.date)}</td>
                  <td style={cell}>{r.note || "—"}</td>
                  <td style={cell}>
                    <button onClick={() => void remove(r.uid)}
                      style={{ padding: "3px 10px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 };
```

### - [ ] Step 4: Mount the tab

Find the existing Holidays page:

```bash
grep -rln "holiday" frontend/task-tracker/src/pages/ frontend/task-tracker/src/components/
```

Add a "Working Days" sub-tab next to whatever exists (commonly `HolidaysPage.tsx`). If there's no existing sub-tab structure, just render the new tab alongside the holidays table inside the same page.

### - [ ] Step 5: Smoke-test

Log in as admin → Holidays → Working Days. Add `2026-04-26` (Sunday) with note "test". Open Matrix → April 26 column should now NOT be tinted gray; cells render `A` (or whatever the user actually had that day).

### - [ ] Step 6: Commit

```bash
git add frontend/task-tracker/src/types/api/working-day.ts frontend/task-tracker/src/hooks/useWorkingDayOverrides.ts frontend/task-tracker/src/components/holidays/WorkingDayOverridesTab.tsx
# Also add whichever Holidays page file you modified.
git commit -m "feat(holidays): admin UI for Sunday/working-day overrides"
```

---

## Task 20: Remove top-level Attendance tab + add redirect

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`

### - [ ] Step 1: Remove the top-level tab + redirect `/attendance`

Open `frontend/task-tracker/src/App.tsx`. Find the route for the top-level Attendance page (search for `AttendancePage` or `path="/attendance"`).

- Remove the corresponding entry from the top-level header tab array.
- Replace the route element for `/attendance` with a redirect that navigates to Employee → Attendance:

```typescript
// React-router v6 example:
import { Navigate } from "react-router-dom";
// …
<Route path="/attendance" element={<Navigate to="/employee?tab=attendance" replace />} />
```

If `App.tsx` does not use react-router (the existing project may switch tabs via local state), just remove the Attendance tab from the header tabs array and add `tab=attendance` query handling in `EmployeePage`. Either way, end-state: `/attendance` lands on Employee → Attendance.

### - [ ] Step 2: Mount the global decision toaster

In `App.tsx`, near the root component body:

```typescript
import { useLeaveDecisionToasts } from "@/hooks/useLeaveRequests";
// inside the App component (after profile is loaded):
useLeaveDecisionToasts(profile?.id);
```

Also mount a tiny ToastHost (one-line div that renders the latest toasts from the `toast.subscribe` bus). Pseudocode:

```typescript
function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: "ok" | "err" }[]>([]);
  useEffect(() => toast.subscribe((msg, kind) => {
    const id = Date.now();
    setItems((p) => [...p, { id, msg, kind }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 6000);
  }), []);
  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, display: "flex", flexDirection: "column", gap: 6, zIndex: 1000 }}>
      {items.map((t) => (
        <div key={t.id} style={{
          background: t.kind === "ok" ? "#16a34a" : "#dc2626",
          color: "#fff", padding: "8px 14px", borderRadius: 6, fontSize: 13, fontWeight: 600,
        }}>{t.msg}</div>
      ))}
    </div>
  );
}
```

Render `<ToastHost />` once at the App root.

### - [ ] Step 2: Smoke-test

Open `http://localhost:5173/attendance` → expect to land on `/employee?tab=attendance` with the Attendance sub-tab pre-selected. As an employee, file a leave; from the admin browser, approve it → confirm a green toast pops in the lower-right of the employee's screen reading `✓ <Admin Name> approved your leave (...)`.

### - [ ] Step 3: Commit

```bash
git add frontend/task-tracker/src/App.tsx frontend/task-tracker/src/pages/EmployeePage.tsx frontend/task-tracker/src/hooks/useLeaveRequests.ts
git commit -m "feat(employee): remove top-level Attendance tab; mount decision toaster"
```

---

## Task 21: CSV export of the matrix

**Files:**
- Modify: `frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx`

### - [ ] Step 1: Add an export button

In `AttendanceMatrixView`, add next to the month picker:

```typescript
<button
  onClick={() => exportCsv(data, totalsPerEmp, month)}
  style={{ padding: "5px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
  ⬇ Export CSV
</button>
```

Add the function near the bottom of the file:

```typescript
function exportCsv(data: import("@/hooks/useAttendanceMatrix").MatrixPayload, totals: Record<string, ReturnType<typeof totalsFor>>, month: string) {
  const headerCells = ["Employee", ...data.dates.map((d) => `${d.date.slice(8)} ${d.weekday[0]}`), "P", "H", "L", "WFH", "HW", "?", "WP"];
  const rows: string[][] = [headerCells];
  for (const emp of data.employees) {
    const row = [emp.full_name];
    for (const d of data.dates) {
      row.push(data.cells[emp.uid]?.[d.date]?.code ?? "A");
    }
    const t = totals[emp.uid];
    row.push(...(["P","H","L","WFH","HW","?","WP"] as const).map((c) => String(t?.[c] ?? 0)));
    rows.push(row);
  }
  const csv = rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-matrix-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
```

### - [ ] Step 2: Smoke-test

Click Export CSV; open the file in Excel/Numbers — confirm header row, employee rows, and totals all present.

### - [ ] Step 3: Commit

```bash
git add frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx
git commit -m "feat(matrix): CSV export"
```

---

## Phase 5 checkpoint

**Verification:**

1. `/attendance` redirects to Employee → Attendance.
2. Top-level Attendance tab is gone from the header.
3. Holidays page has a "Working Days" tab (admin only writes; everyone reads).
4. Matrix CSV downloads and opens cleanly.

**Pause for final user verification — and at this point ask the user to say "push" before pushing any commits.**

---

## Final sanity checklist (run before asking the user to push)

- [ ] `python manage.py test core.attendance core.leave core.working_days` — all green
- [ ] `cd frontend/task-tracker && npm test -- --run` — all green
- [ ] `cd frontend/task-tracker && npm run build` — succeeds
- [ ] `python manage.py check` — no warnings
- [ ] `python manage.py makemigrations --dry-run --check` — exit 0
- [ ] Open the SPA, log in as employee → check Employee → Attendance / Leave (no Approvals tab)
- [ ] Log in as manager → all three sub-tabs render; Approvals badge live-updates
- [ ] Log in as admin → can also see Working Days tab; admin's own WFH auto-approves
- [ ] Org picker = `All` shows merged data; picker = a specific org filters everything
