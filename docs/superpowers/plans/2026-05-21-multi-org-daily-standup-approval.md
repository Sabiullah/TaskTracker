# Multi-Org Daily Standup Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-21-multi-org-daily-standup-approval-design.md`

**Goal:** Collapse `OperationalStandup` to one row per `(profile, standup_date)` and track Pending/Approved/Reviewed state in a new per-org sibling table so multi-org managers see and act on a single standup with independent approval audit per org.

**Architecture:** Django REST Framework + Django ORM on the backend; React (Vite) + TypeScript on the frontend. The schema change is split into three migrations to keep the data migration in its own commit (and reversible up to that point). The viewset gains org-aware `approve` / `review` / `bulk_review` actions that target the new `OperationalStandupApproval` rows. The frontend stops deduplicating per-user in the "All" view and renders one approval chip per org.

**Tech Stack:** Django 5.2 / Python 3.12 / pytest+`APITestCase`, React + Vite + TypeScript + Vitest, WebSocket channel `pace-operational-standups`.

**Branch:** `All_Org_reflection` (current). No worktree split — work continues in this branch.

---

## File Structure

| Path | Role | Action |
|---|---|---|
| `core/pace/models.py` | `OperationalStandup` schema; new `OperationalStandupApproval` model | Modify |
| `core/pace/migrations/0005_operationalstandupapproval.py` | Additive: create new table | Create |
| `core/pace/migrations/0006_backfill_standup_approvals.py` | Data: dedupe rows, populate approvals | Create |
| `core/pace/migrations/0007_drop_standup_org_status.py` | Destructive: drop old columns, swap constraint | Create |
| `core/pace/services/standup.py` | Helper `ensure_approvals_for_standup(standup, creator=None)` — single place that creates the per-org rows | Create |
| `core/pace/serializers.py` | `OperationalStandupSerializer` no longer surfaces `org`/`status`/`approved_by`/etc.; new `OperationalStandupApprovalSerializer`; embed `approvals` array on standup | Modify |
| `core/pace/views.py` | Update `get_queryset`, `roster`, `perform_create`, `perform_update`, `perform_destroy`, `approve`, `review`, `bulk_review`, `pending_count`; drop `_resolve_target_org` org-uniqueness logic | Modify |
| `core/pace/urls.py` | Unchanged (existing router still handles all actions) | Read-only |
| `core/pace/tests.py` | Replace per-org tests with per-approval tests; add multi-org manager visibility cases | Modify |
| `core/pace/migrations/test_backfill_standup_approvals.py` | Migration data integrity test (uses Django's `MigratorTestCase` pattern) | Create |
| `frontend/task-tracker/src/types/api/pace.ts` | New `OperationalStandupApprovalDto`; remove flat `status`/`approved_*`/`reviewed_*` from `OperationalStandupDto`; embed `approvals[]`; update roster row to carry `approvals[]` and drop `org_uid` / `can_approve` | Modify |
| `frontend/task-tracker/src/hooks/useOperationalStandups.ts` | No structural change — only the DTO shape changes | Read-only (verify) |
| `frontend/task-tracker/src/pages/DailyStandupPage.tsx` | Remove user-uid dedupe; ignore `selectedOrg`; render one row per (profile, date); pass `approvals[]` down; per-admin-org Final Review | Modify |
| `frontend/task-tracker/src/components/pace/DailyStandupRow.tsx` | Per-org chip strip; per-org approve/review menu | Modify |
| `frontend/task-tracker/src/components/pace/DailyStandupDateSection.tsx` | One Final Review button per admin-org | Modify |
| `frontend/task-tracker/src/components/pace/DailyStandupAddModal.tsx` | Drop `orgUid` prop (no longer per-org) | Modify |
| `frontend/task-tracker/src/__tests__/hooks/operationalStandups.smoke.test.ts` | Update fixture shape | Modify |
| `frontend/task-tracker/src/__tests__/hooks/operationalStandupsBadge.smoke.test.ts` | Update fixture shape | Modify |
| `frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx` | Assert multi-org user shows once with two chips | Modify |
| `frontend/task-tracker/src/__tests__/components/pace/dailyStandupRow.test.tsx` | Per-org chip rendering and click handlers | Modify |
| `frontend/task-tracker/src/__tests__/components/pace/dailyStandupDateSection.test.tsx` | Multiple Final Review buttons for multi-admin-org | Modify |
| `frontend/task-tracker/src/__tests__/components/pace/dailyStandupAddModal.test.tsx` | Drop org-related assertions | Modify |

Each backend task pushes one schema/migration change and the matching code path; the frontend tasks land after the backend so the contract is stable before TS types change.

---

## Important commands

Backend tests:
```
uv run python manage.py test core.pace --keepdb -v 2
```

Specific test:
```
uv run python manage.py test core.pace.tests.OperationalStandupApprovalCreationTests.test_creates_one_approval_per_member_org --keepdb -v 2
```

Frontend tests:
```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx
```

Lint / type:
```
uv run pre-commit run --all-files
cd frontend/task-tracker && npm run typecheck
```

Migrations:
```
uv run python manage.py migrate pace
uv run python manage.py migrate pace 0004   # roll back to pre-approval state
```

---

## Task 1: Add `OperationalStandupApproval` model (additive)

**Files:**
- Modify: `core/pace/models.py`
- Create: `core/pace/migrations/0005_operationalstandupapproval.py`
- Modify: `core/pace/tests.py` (add new `OperationalStandupApprovalModelTests`)

- [ ] **Step 1: Write the failing model test**

Append to `core/pace/tests.py`:

```python
class OperationalStandupApprovalModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="alice@x.com", full_name="Alice")
        OrgMembership.objects.create(user=self.user, org=self.org, role="employee")
        self.standup = OperationalStandup.objects.create(
            org=self.org,  # still required pre-Task-5
            profile=self.user,
            standup_date=date(2026, 5, 4),
        )

    def test_default_status_is_pending(self):
        from core.pace.models import OperationalStandupApproval

        ap = OperationalStandupApproval.objects.create(standup=self.standup, org=self.org)
        self.assertEqual(ap.status, "Pending")
        self.assertIsNone(ap.approved_by)
        self.assertIsNone(ap.reviewed_at)

    def test_unique_per_standup_org(self):
        from core.pace.models import OperationalStandupApproval

        OperationalStandupApproval.objects.create(standup=self.standup, org=self.org)
        with self.assertRaises(IntegrityError):
            OperationalStandupApproval.objects.create(standup=self.standup, org=self.org)
```

- [ ] **Step 2: Run test to verify it fails**

```
uv run python manage.py test core.pace.tests.OperationalStandupApprovalModelTests --keepdb -v 2
```
Expected: `ImportError` / `ModuleNotFoundError` for `OperationalStandupApproval`.

- [ ] **Step 3: Add the model**

Append to `core/pace/models.py` (just below `OperationalStandup`):

```python
class OperationalStandupApproval(TimeStampedModel):
    id: int
    standup_id: int
    org_id: int

    STATUS_CHOICES = [("Pending", "Pending"), ("Approved", "Approved")]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    standup = models.ForeignKey(
        OperationalStandup,
        on_delete=models.CASCADE,
        related_name="approvals",
    )
    org = models.ForeignKey(
        "users.Org",
        on_delete=models.CASCADE,
        related_name="operational_standup_approvals",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="Pending",
        db_index=True,
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="op_standup_approvals_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="op_standup_approvals_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["standup", "org"],
                name="uniq_op_approval_standup_org",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "status"], name="op_approval_org_status_idx"),
        ]
        verbose_name = "operational standup approval"
        verbose_name_plural = "operational standup approvals"

    def __str__(self) -> str:
        return f"{self.standup} / {self.org} ({self.status})"
```

- [ ] **Step 4: Generate the migration**

```
uv run python manage.py makemigrations pace --name operationalstandupapproval
```

Rename the generated file to `0005_operationalstandupapproval.py` if Django picks a different number — leave the auto-generated body. Verify the migration only contains `CreateModel` for `OperationalStandupApproval` (no changes to `OperationalStandup` yet).

- [ ] **Step 5: Apply and re-run tests**

```
uv run python manage.py migrate pace
uv run python manage.py test core.pace.tests.OperationalStandupApprovalModelTests --keepdb -v 2
```
Expected: 2 passing tests.

- [ ] **Step 6: Commit**

```
git add core/pace/models.py core/pace/migrations/0005_operationalstandupapproval.py core/pace/tests.py
git commit -m "feat(pace): add OperationalStandupApproval model (additive)"
```

---

## Task 2: Service helper — `ensure_approvals_for_standup`

**Files:**
- Create: `core/pace/services/__init__.py`
- Create: `core/pace/services/standup.py`
- Modify: `core/pace/tests.py` (add `EnsureApprovalsHelperTests`)

- [ ] **Step 1: Write the failing tests**

Append to `core/pace/tests.py`:

```python
class EnsureApprovalsHelperTests(TestCase):
    def setUp(self):
        self.org_4d = Org.objects.create(name="4D")
        self.org_ybv = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        OrgMembership.objects.create(user=self.alice, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.alice, org=self.org_ybv, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org_4d, role="manager")
        OrgMembership.objects.create(user=self.bob, org=self.org_ybv, role="manager")
        self.standup = OperationalStandup.objects.create(
            org=self.org_4d,
            profile=self.alice,
            standup_date=date(2026, 5, 4),
        )

    def test_creates_one_approval_per_profile_org(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup)
        statuses = dict(self.standup.approvals.values_list("org__name", "status"))
        self.assertEqual(statuses, {"4D": "Pending", "YBV": "Pending"})

    def test_excludes_opted_out_memberships(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        OrgMembership.objects.filter(user=self.alice, org=self.org_ybv).update(
            exclude_from_operational_standup=True
        )
        ensure_approvals_for_standup(self.standup)
        org_names = set(self.standup.approvals.values_list("org__name", flat=True))
        self.assertEqual(org_names, {"4D"})

    def test_manager_creator_auto_approves_their_orgs(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup, creator=self.bob)
        approvals = {a.org.name: a for a in self.standup.approvals.all()}
        self.assertEqual(approvals["4D"].status, "Approved")
        self.assertEqual(approvals["4D"].approved_by, self.bob)
        self.assertEqual(approvals["YBV"].status, "Approved")

    def test_employee_creator_leaves_all_pending(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup, creator=self.alice)
        statuses = set(self.standup.approvals.values_list("status", flat=True))
        self.assertEqual(statuses, {"Pending"})

    def test_idempotent_does_not_duplicate(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup)
        ensure_approvals_for_standup(self.standup)
        self.assertEqual(self.standup.approvals.count(), 2)
```

- [ ] **Step 2: Run tests to verify they fail**

```
uv run python manage.py test core.pace.tests.EnsureApprovalsHelperTests --keepdb -v 2
```
Expected: `ModuleNotFoundError: No module named 'core.pace.services'`.

- [ ] **Step 3: Create the service module**

`core/pace/services/__init__.py`:

```python
```

`core/pace/services/standup.py`:

```python
from typing import TYPE_CHECKING

from django.utils import timezone

from users.models import OrgMembership

if TYPE_CHECKING:
    from users.models import User

    from ..models import OperationalStandup


def ensure_approvals_for_standup(
    standup: "OperationalStandup",
    creator: "User | None" = None,
) -> None:
    """Create one `OperationalStandupApproval` per profile-membership org.

    Skips memberships flagged `exclude_from_operational_standup`. If `creator`
    is a manager/admin in any of those orgs, the matching approval rows start
    as Approved with `creator` recorded; the rest stay Pending. Idempotent.
    """
    from ..models import OperationalStandupApproval

    memberships = OrgMembership.objects.filter(
        user_id=standup.profile_id,
        exclude_from_operational_standup=False,
    ).select_related("org")

    if creator is not None:
        manager_org_ids = set(
            OrgMembership.objects.filter(
                user=creator, role__in=["admin", "manager"]
            ).values_list("org_id", flat=True)
        )
    else:
        manager_org_ids = set()

    now = timezone.now()
    existing_org_ids = set(standup.approvals.values_list("org_id", flat=True))
    to_create = []
    for m in memberships:
        if m.org_id in existing_org_ids:
            continue
        if creator is not None and m.org_id in manager_org_ids:
            to_create.append(
                OperationalStandupApproval(
                    standup=standup,
                    org=m.org,
                    status="Approved",
                    approved_by=creator,
                    approved_at=now,
                )
            )
        else:
            to_create.append(
                OperationalStandupApproval(standup=standup, org=m.org)
            )
    if to_create:
        OperationalStandupApproval.objects.bulk_create(to_create)
```

- [ ] **Step 4: Run tests to verify they pass**

```
uv run python manage.py test core.pace.tests.EnsureApprovalsHelperTests --keepdb -v 2
```
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```
git add core/pace/services/ core/pace/tests.py
git commit -m "feat(pace): add ensure_approvals_for_standup helper"
```

---

## Task 3: Data migration — backfill approvals + dedupe per-(profile, date)

**Files:**
- Create: `core/pace/migrations/0006_backfill_standup_approvals.py`
- Create: `core/pace/tests_migrations.py` (a new module — keeps migration tests isolated from regular API tests)

The data migration must run AFTER `0005` so the new table exists, and BEFORE the destructive migration in Task 5. It iterates every existing `OperationalStandup`, groups by `(profile_id, standup_date)`, picks one canonical row to keep, copies that row's content fields, and converts every row in the group into an `OperationalStandupApproval` carrying its original status/approved_by/etc. Non-canonical rows are deleted at the end of the group.

- [ ] **Step 1: Write the migration**

Create `core/pace/migrations/0006_backfill_standup_approvals.py`:

```python
from django.db import migrations


def forwards(apps, schema_editor):
    OperationalStandup = apps.get_model("pace", "OperationalStandup")
    OperationalStandupApproval = apps.get_model("pace", "OperationalStandupApproval")

    # Walk the existing table grouped by (profile, date). For each group:
    # 1. pick a canonical row (prefer Approved, then most-recent updated_at)
    # 2. emit one Approval per row carrying its status/approved_by/etc.
    # 3. delete the non-canonical rows.
    rows = list(
        OperationalStandup.objects.all().order_by("profile_id", "standup_date", "id")
    )
    if not rows:
        return

    groups: dict[tuple[int, object], list] = {}
    for r in rows:
        groups.setdefault((r.profile_id, r.standup_date), []).append(r)

    approvals_to_create = []
    rows_to_delete = []

    for group in groups.values():
        group.sort(
            key=lambda r: (
                0 if r.status == "Approved" else 1,
                -(r.updated_at.timestamp() if r.updated_at else 0),
            )
        )
        canonical = group[0]
        # Every row in the group (including canonical) becomes one Approval
        # carrying its original org + status.
        for r in group:
            approvals_to_create.append(
                OperationalStandupApproval(
                    standup_id=canonical.id,
                    org_id=r.org_id,
                    status=r.status or "Pending",
                    approved_by_id=r.approved_by_id,
                    approved_at=r.approved_at,
                    reviewed_by_id=r.reviewed_by_id,
                    reviewed_at=r.reviewed_at,
                )
            )
            if r.id != canonical.id:
                rows_to_delete.append(r.id)

    OperationalStandupApproval.objects.bulk_create(approvals_to_create, batch_size=1000)
    if rows_to_delete:
        OperationalStandup.objects.filter(id__in=rows_to_delete).delete()


def backwards(apps, schema_editor):
    # We have already lost which `OperationalStandup` row each `Approval` came
    # from — the dedupe collapsed siblings. A faithful reverse is impossible,
    # so the safest thing is to clear the new table and leave the canonical
    # rows in place; an operator can re-import historic data from a backup if
    # needed.
    OperationalStandupApproval = apps.get_model("pace", "OperationalStandupApproval")
    OperationalStandupApproval.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("pace", "0005_operationalstandupapproval")]

    operations = [
        migrations.RunPython(forwards, backwards, atomic=True),
    ]
```

- [ ] **Step 2: Write the migration data-integrity test**

Create `core/pace/tests_migrations.py`:

```python
from datetime import date

from django.test import TransactionTestCase
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


class StandupBackfillMigrationTests(TransactionTestCase):
    """Verifies 0006_backfill_standup_approvals collapses siblings correctly.

    Uses TransactionTestCase so we can run migrate() forwards/backwards
    without poisoning the shared test database state.
    """

    def setUp(self):
        executor = MigrationExecutor(connection)
        # Move state to *just before* the backfill migration.
        executor.migrate([("pace", "0005_operationalstandupapproval")])
        self.executor = executor

    def tearDown(self):
        # Leave the test DB at the latest state so subsequent tests work.
        self.executor.loader.build_graph()
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())

    def test_collapses_per_profile_date(self):
        old_state = self.executor.loader.project_state(
            [("pace", "0005_operationalstandupapproval")]
        )
        Org = old_state.apps.get_model("users", "Org")
        User = old_state.apps.get_model("users", "User")
        OrgMembership = old_state.apps.get_model("users", "OrgMembership")
        OperationalStandup = old_state.apps.get_model("pace", "OperationalStandup")

        org_4d = Org.objects.create(name="4D")
        org_ybv = Org.objects.create(name="YBV")
        alice = User.objects.create(email="a@x.com", full_name="Alice", username="alice")
        OrgMembership.objects.create(user=alice, org=org_4d, role="employee")
        OrgMembership.objects.create(user=alice, org=org_ybv, role="employee")
        d = date(2026, 5, 4)
        OperationalStandup.objects.create(
            org=org_4d, profile=alice, standup_date=d,
            priorities="From 4D", status="Approved",
        )
        OperationalStandup.objects.create(
            org=org_ybv, profile=alice, standup_date=d,
            priorities="From YBV", status="Pending",
        )

        # Run the backfill.
        self.executor.migrate([("pace", "0006_backfill_standup_approvals")])

        new_state = self.executor.loader.project_state(
            [("pace", "0006_backfill_standup_approvals")]
        )
        OperationalStandup = new_state.apps.get_model("pace", "OperationalStandup")
        OperationalStandupApproval = new_state.apps.get_model(
            "pace", "OperationalStandupApproval"
        )

        # Exactly one canonical row remains — the Approved-from-4D row wins.
        rows = list(OperationalStandup.objects.filter(profile_id=alice.id))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].priorities, "From 4D")

        # Two approvals — one per original org — carrying their statuses.
        approvals = {a.org_id: a for a in OperationalStandupApproval.objects.all()}
        self.assertEqual(approvals[org_4d.id].status, "Approved")
        self.assertEqual(approvals[org_ybv.id].status, "Pending")
```

- [ ] **Step 3: Run the migration test**

```
uv run python manage.py test core.pace.tests_migrations --keepdb=False -v 2
```
Expected: 1 passing test. Note: `--keepdb=False` ensures the migration test starts from a clean DB; do not use `--keepdb` here.

- [ ] **Step 4: Commit**

```
git add core/pace/migrations/0006_backfill_standup_approvals.py core/pace/tests_migrations.py
git commit -m "feat(pace): backfill OperationalStandupApproval rows from existing standups"
```

---

## Task 4: Auto-create approvals in the viewset on standup create

**Files:**
- Modify: `core/pace/views.py`
- Modify: `core/pace/tests.py` (extend `OperationalStandupCreateTests`)

This task wires the helper into the viewset so new standups produce approval rows. The standup still has the old `org`/`status` columns at this point — that's fine, we just stop relying on `status` for permission checks in Task 6 and drop the column in Task 5.

- [ ] **Step 1: Write failing test for "create-fans-out-approvals"**

Append to `OperationalStandupCreateTests` in `core/pace/tests.py`:

```python
    def test_create_fans_out_approvals_per_profile_org(self):
        org_ybv = Org.objects.create(name="YBV")
        OrgMembership.objects.create(user=self.alice, org=org_ybv, role="employee")
        self.client.force_authenticate(self.alice)
        resp = self.client.post(
            "/api/operational_standups/", self._payload(self.alice.uid)
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        from core.pace.models import OperationalStandup, OperationalStandupApproval

        standup = OperationalStandup.objects.get(uid=resp.json()["uid"])
        statuses = dict(
            standup.approvals.values_list("org__name", "status")
        )
        self.assertEqual(statuses, {"4D": "Pending", "YBV": "Pending"})
```

- [ ] **Step 2: Run test to verify it fails**

```
uv run python manage.py test core.pace.tests.OperationalStandupCreateTests.test_create_fans_out_approvals_per_profile_org --keepdb -v 2
```
Expected: `OperationalStandup.approvals` queryset is empty — assertion fails.

- [ ] **Step 3: Wire `ensure_approvals_for_standup` into `perform_create`**

Edit `core/pace/views.py`. In `OperationalStandupViewSet.perform_create`, after the existing `serializer.save(...)` calls (both the manager and employee branches), call the helper:

```python
    def perform_create(self, serializer):
        from django.utils import timezone

        from .services.standup import ensure_approvals_for_standup

        user = cast(User, self.request.user)
        profile = serializer.validated_data["profile"]
        org = self._resolve_target_org(profile, self.request)
        if org is None:
            raise PermissionDenied(
                "Could not determine target org. Pass `org` explicitly when "
                "you and the target profile share more than one org."
            )

        if org.pk not in set(user.org_ids()):
            raise PermissionDenied("You don't belong to that org.")

        is_self = profile.pk == user.pk
        is_manager = user.is_manager_in(org)
        if not is_self and not is_manager:
            raise PermissionDenied("You don't have permission to create a row for that user.")

        if is_manager:
            standup = serializer.save(
                org=org,
                created_by=user,
                status="Approved",
                approved_by=user,
                approved_at=timezone.now(),
            )
        else:
            standup = serializer.save(org=org, created_by=user, status="Pending")

        ensure_approvals_for_standup(standup, creator=user)

        broadcast(
            "pace-operational-standups",
            "INSERT",
            OperationalStandupSerializer(standup).data,
        )
```

- [ ] **Step 4: Re-run test**

```
uv run python manage.py test core.pace.tests.OperationalStandupCreateTests.test_create_fans_out_approvals_per_profile_org --keepdb -v 2
```
Expected: PASS.

- [ ] **Step 5: Run the existing create tests to confirm no regression**

```
uv run python manage.py test core.pace.tests.OperationalStandupCreateTests --keepdb -v 2
```
Expected: all green (existing 6 tests + the new one).

- [ ] **Step 6: Commit**

```
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): fan out approvals when an OperationalStandup is created"
```

---

## Task 5: Destructive migration — drop old columns, swap constraint

**Files:**
- Create: `core/pace/migrations/0007_drop_standup_org_status.py`
- Modify: `core/pace/models.py`

After this migration:
- `OperationalStandup.org` / `status` / `approved_by` / `approved_at` / `reviewed_by` / `reviewed_at` are gone.
- The unique constraint becomes `(profile, standup_date)`.

- [ ] **Step 1: Update the model**

Edit `core/pace/models.py` — replace the existing `OperationalStandup` definition with:

```python
class OperationalStandup(TimeStampedModel):
    id: int
    profile_id: int

    BREAKTHROUGH_TYPE_CHOICES = [
        ("Breakdown", "Breakdown"),
        ("Breakthrough", "Breakthrough"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    profile = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_standups",
    )
    standup_date = models.DateField(db_index=True)
    breakthrough_type = models.CharField(
        max_length=20, choices=BREAKTHROUGH_TYPE_CHOICES, blank=True, default=""
    )
    priorities = models.TextField(blank=True)
    collaboration_need = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="operational_standups_created",
    )

    class Meta:
        ordering = ["-standup_date", "profile__full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "standup_date"],
                name="uniq_op_standup_profile_date",
            ),
        ]
        indexes = [
            models.Index(fields=["standup_date"], name="op_standup_date_idx"),
        ]
        verbose_name = "operational standup"
        verbose_name_plural = "operational standups"

    def __str__(self):
        return f"{self.profile} — {self.standup_date}"
```

- [ ] **Step 2: Generate the migration**

```
uv run python manage.py makemigrations pace --name drop_standup_org_status
```

Rename to `0007_drop_standup_org_status.py`. Verify the operations are exactly:
1. `RemoveConstraint` (`uniq_op_standup_org_profile_date`)
2. `RemoveIndex` (`op_standup_org_date_idx`)
3. `RemoveIndex` (`op_standup_org_status_idx`)
4. `RemoveField` × 6 (`org`, `status`, `approved_by`, `approved_at`, `reviewed_by`, `reviewed_at`)
5. `AddConstraint` (`uniq_op_standup_profile_date`)
6. `AddIndex` (`op_standup_date_idx`)

If Django generates extras (e.g. `AlterField`), trim them — the schema is plain.

- [ ] **Step 3: Apply the migration**

```
uv run python manage.py migrate pace
```
Expected: no errors. If the test DB still references `org_id` on a deleted column, drop and recreate it: `uv run python manage.py test core.pace --noinput`.

- [ ] **Step 4: Update `perform_create` (now that columns are gone)**

Edit `core/pace/views.py`. Replace `perform_create` with:

```python
    def perform_create(self, serializer):
        from .services.standup import ensure_approvals_for_standup

        user = cast(User, self.request.user)
        profile = serializer.validated_data["profile"]

        # Caller must share at least one org with the target.
        caller_orgs = set(user.org_ids())
        profile_orgs = set(profile.org_ids())
        if not (caller_orgs & profile_orgs):
            raise PermissionDenied("You don't share an org with that user.")

        # Only the user themselves or a manager in any shared org may create.
        is_self = profile.pk == user.pk
        is_manager_in_shared = any(user.is_manager_in_id(org_id) for org_id in (caller_orgs & profile_orgs))
        if not is_self and not is_manager_in_shared:
            raise PermissionDenied("You don't have permission to create a row for that user.")

        standup = serializer.save(created_by=user)
        ensure_approvals_for_standup(standup, creator=user)

        broadcast(
            "pace-operational-standups",
            "INSERT",
            OperationalStandupSerializer(standup).data,
        )
```

Also add a small helper to `users/models.py` for `is_manager_in_id`:

```python
    def is_manager_in_id(self, org_id) -> bool:
        return self.memberships.filter(
            org_id=org_id, role__in=["admin", "manager"]
        ).exists()
```

- [ ] **Step 5: Trim now-impossible tests**

Open `core/pace/tests.py` and delete:
- `OperationalStandupModelTests.test_unique_per_org_profile_date` (replaced by Task 6 `test_unique_per_profile_date`)
- `OperationalStandupModelTests.test_default_status_is_pending` (status moved to Approval)
- `OperationalStandupVisibilityTests.alice_org2_row` setup line plus `test_employee_sees_only_own_rows` — they will be rewritten in Task 7.
- `OperationalStandupCreateTests.test_manager_creating_own_row_is_approved` / `test_manager_creating_others_row_is_approved` / `test_admin_creating_others_row_is_approved`'s `status`-on-body assertions (replace with approval-row assertions in Task 7).
- All `status="..."` arguments on `OperationalStandup.objects.create(...)` in test setUps — drop them.
- `OperationalStandupUpdateDeleteTests.test_employee_cannot_edit_own_approved_row` and `test_manager_can_edit_approved_row` — replaced in Task 7.

Run the trimmed suite to confirm what remains still passes:

```
uv run python manage.py test core.pace --keepdb -v 2
```
Expected: green (smaller suite).

- [ ] **Step 6: Commit**

```
git add core/pace/models.py core/pace/migrations/0007_drop_standup_org_status.py core/pace/views.py core/pace/tests.py users/models.py
git commit -m "feat(pace): drop OperationalStandup.org/status/approved_*/reviewed_* columns"
```

---

## Task 6: Add the new model-level invariant test

**Files:**
- Modify: `core/pace/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/pace/tests.py` near the top:

```python
class OperationalStandupModelTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")

    def test_unique_per_profile_date(self):
        OperationalStandup.objects.create(
            profile=self.alice, standup_date=date(2026, 5, 4)
        )
        with self.assertRaises(IntegrityError):
            OperationalStandup.objects.create(
                profile=self.alice, standup_date=date(2026, 5, 4)
            )
```

- [ ] **Step 2: Run and confirm green**

```
uv run python manage.py test core.pace.tests.OperationalStandupModelTests --keepdb -v 2
```
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add core/pace/tests.py
git commit -m "test(pace): assert OperationalStandup unique(profile, standup_date)"
```

---

## Task 7: Rewrite list / roster / update / delete viewset paths

**Files:**
- Modify: `core/pace/views.py`
- Modify: `core/pace/serializers.py`
- Modify: `core/pace/tests.py`

The viewset's `get_queryset`, `get_object`, `perform_update`, `perform_destroy`, `roster` actions still reference `org`/`status`. Rewrite them so:

- `get_queryset`: a standup is visible if the caller shares ≥1 org with `profile`. Non-managers in every shared org see only their own row.
- `roster`: returns one row per `(profile, date)`; each row has `approvals[]` carrying per-org status + `can_act` for the caller.
- `perform_update`: caller is the profile themselves AND **every** approval is still `Pending`, OR caller is a manager in any of the profile's orgs.
- `perform_destroy`: only admins (in any of the profile's orgs) can delete.

- [ ] **Step 1: Write the failing tests**

Append to `core/pace/tests.py` (replacing the old `OperationalStandupVisibilityTests`):

```python
class OperationalStandupVisibilityTests(APITestCase):
    def setUp(self):
        from datetime import date as _d

        self.org_4d = Org.objects.create(name="4D")
        self.org_ybv = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")  # multi-org manager
        OrgMembership.objects.create(user=self.alice, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.alice, org=self.org_ybv, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.cathy, org=self.org_4d, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org_ybv, role="manager")

        self.alice_row = OperationalStandup.objects.create(
            profile=self.alice, standup_date=_d(2026, 5, 4), priorities="A1"
        )
        self.bob_row = OperationalStandup.objects.create(
            profile=self.bob, standup_date=_d(2026, 5, 4), priorities="B1"
        )

    def test_employee_sees_only_own_row(self):
        self.client.force_authenticate(self.alice)
        ids = {r["uid"] for r in self.client.get("/api/operational_standups/").json()}
        self.assertEqual(ids, {str(self.alice_row.uid)})

    def test_multi_org_manager_sees_all_shared_profile_rows(self):
        self.client.force_authenticate(self.cathy)
        ids = {r["uid"] for r in self.client.get("/api/operational_standups/").json()}
        self.assertEqual(ids, {str(self.alice_row.uid), str(self.bob_row.uid)})

    def test_org_query_param_is_ignored_for_managers(self):
        # Even passing ?org= shouldn't narrow the manager view.
        self.client.force_authenticate(self.cathy)
        ids = {
            r["uid"]
            for r in self.client.get(
                f"/api/operational_standups/?org={self.org_4d.uid}"
            ).json()
        }
        self.assertEqual(ids, {str(self.alice_row.uid), str(self.bob_row.uid)})
```

Also append:

```python
class OperationalStandupRosterMultiOrgTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        from core.pace.services.standup import ensure_approvals_for_standup

        self.org_4d = Org.objects.create(name="4D")
        self.org_ybv = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.manager_4d = User.objects.create_user(email="m@x.com", full_name="Mike")
        OrgMembership.objects.create(user=self.alice, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.alice, org=self.org_ybv, role="employee")
        OrgMembership.objects.create(user=self.manager_4d, org=self.org_4d, role="manager")
        self.row = OperationalStandup.objects.create(
            profile=self.alice, standup_date=_d(2026, 5, 4), priorities="A1"
        )
        ensure_approvals_for_standup(self.row)

    def test_roster_includes_approvals_with_can_act(self):
        self.client.force_authenticate(self.manager_4d)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        rows = {r["profile"]["full_name"]: r for r in resp.json()}
        alice = rows["Alice"]
        self.assertIsNotNone(alice["entry"])
        approvals = {a["org_name"]: a for a in alice["approvals"]}
        # Mike is a manager in 4D only, so can_act is true for 4D and false for YBV.
        self.assertTrue(approvals["4D"]["can_act"])
        self.assertFalse(approvals["YBV"]["can_act"])

    def test_roster_no_dedupe_one_row_per_profile(self):
        self.client.force_authenticate(self.manager_4d)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        names = [r["profile"]["full_name"] for r in resp.json()]
        self.assertEqual(names.count("Alice"), 1)
```

- [ ] **Step 2: Run tests to verify they fail**

```
uv run python manage.py test core.pace.tests.OperationalStandupVisibilityTests core.pace.tests.OperationalStandupRosterMultiOrgTests --keepdb -v 2
```
Expected: failures referencing missing keys (`approvals`) and incorrect visibility.

- [ ] **Step 3: Rewrite `get_queryset` and `roster`**

Edit `core/pace/views.py`. Replace `OperationalStandupViewSet.get_queryset` and `roster` with:

```python
    def get_queryset(self):
        user = cast(User, self.request.user)
        from django.db.models import Q

        # Visible standups: profiles who share ≥1 org with the caller. Plain
        # employees (no manager rights anywhere) see only their own.
        caller_org_ids = set(user.org_ids())
        manager_org_ids = set(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )

        # Profiles sharing an org with us.
        from users.models import OrgMembership

        shared_profile_ids = OrgMembership.objects.filter(
            org_id__in=caller_org_ids
        ).values_list("user_id", flat=True)

        qs = OperationalStandup.objects.select_related("profile", "created_by").prefetch_related(
            "approvals__approved_by", "approvals__reviewed_by", "approvals__org"
        )

        if manager_org_ids:
            qs = qs.filter(profile_id__in=shared_profile_ids)
        else:
            qs = qs.filter(profile=user)

        # Filters
        month = self.request.query_params.get("month")
        if month:
            qs = qs.filter(standup_date__startswith=month)
        single_date = self.request.query_params.get("date")
        if single_date:
            qs = qs.filter(standup_date=single_date)
        profile_uid = self.request.query_params.get("profile_uid")
        if profile_uid:
            qs = qs.filter(profile__uid=profile_uid)
        # NOTE: deliberately no `org=` filter — managers see across orgs.
        return qs

    @action(detail=False, methods=["get"], url_path="roster")
    def roster(self, request):
        from users.models import OrgMembership

        single_date = request.query_params.get("date")
        if not single_date:
            return Response({"detail": "`date` query param required."}, status=400)

        user = cast(User, request.user)
        manager_org_ids = set(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )
        caller_org_ids = set(user.org_ids())

        memberships = OrgMembership.objects.filter(
            org_id__in=caller_org_ids,
            user__is_active=True,
            exclude_from_operational_standup=False,
        ).select_related("user")
        if manager_org_ids:
            # Managers see every member of any of their orgs.
            memberships = memberships.filter(org_id__in=manager_org_ids)
        else:
            memberships = memberships.filter(user=user)

        # Collapse to unique profiles (a member of N orgs becomes one row).
        seen: dict[int, "OrgMembership"] = {}
        for m in memberships.order_by("user__full_name", "user__email"):
            seen.setdefault(m.user_id, m)

        # Fetch standups for these profiles on this date.
        standups = {
            s.profile_id: s
            for s in OperationalStandup.objects.filter(
                profile_id__in=seen.keys(),
                standup_date=single_date,
            ).prefetch_related("approvals__org", "approvals__approved_by", "approvals__reviewed_by")
        }

        rows = []
        for profile_id, m in seen.items():
            standup = standups.get(profile_id)
            approvals_payload = []
            if standup is not None:
                for ap in standup.approvals.all():
                    approvals_payload.append(
                        {
                            "uid": str(ap.uid),
                            "org_uid": str(ap.org.uid),
                            "org_name": ap.org.name,
                            "status": ap.status,
                            "approved_by": (
                                {
                                    "uid": str(ap.approved_by.uid),
                                    "full_name": ap.approved_by.full_name,
                                }
                                if ap.approved_by
                                else None
                            ),
                            "approved_at": ap.approved_at.isoformat() if ap.approved_at else None,
                            "reviewed_by": (
                                {
                                    "uid": str(ap.reviewed_by.uid),
                                    "full_name": ap.reviewed_by.full_name,
                                }
                                if ap.reviewed_by
                                else None
                            ),
                            "reviewed_at": ap.reviewed_at.isoformat() if ap.reviewed_at else None,
                            "can_act": ap.org_id in manager_org_ids,
                        }
                    )
            rows.append(
                {
                    "profile": {
                        "id": m.user_id,
                        "uid": str(m.user.uid),
                        "full_name": m.user.full_name,
                        "email": m.user.email,
                    },
                    "entry": OperationalStandupSerializer(standup).data if standup else None,
                    "approvals": approvals_payload,
                    "can_edit": (
                        bool(manager_org_ids)
                        or (
                            m.user_id == user.pk
                            and (
                                standup is None
                                or all(a.status == "Pending" for a in standup.approvals.all())
                            )
                        )
                    ),
                }
            )
        return Response(rows)
```

- [ ] **Step 4: Rewrite `perform_update` and `perform_destroy`**

In `core/pace/views.py`, replace these methods with:

```python
    def perform_update(self, serializer):
        user = cast(User, self.request.user)
        instance = cast(OperationalStandup, serializer.instance)

        profile_org_ids = set(instance.profile.org_ids())
        manager_org_ids = set(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )
        is_manager_in_any_profile_org = bool(profile_org_ids & manager_org_ids)

        if not is_manager_in_any_profile_org:
            if instance.profile_id != user.pk:
                raise PermissionDenied("You can only edit your own row.")
            if instance.approvals.filter(status="Approved").exists():
                raise PermissionDenied("This row is already approved and locked.")

        standup = serializer.save()
        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(standup).data,
        )

    def perform_destroy(self, instance):
        user = cast(User, self.request.user)
        profile_org_ids = set(instance.profile.org_ids())
        admin_org_ids = set(
            user.memberships.filter(role="admin").values_list("org_id", flat=True)
        )
        if not (profile_org_ids & admin_org_ids):
            raise PermissionDenied("Only admins (in one of the profile's orgs) can delete standup rows.")
        broadcast(
            "pace-operational-standups",
            "DELETE",
            {"id": instance.pk, "uid": str(instance.uid)},
        )
        instance.delete()
```

Also delete the old `_resolve_target_org` helper — it's no longer needed.

- [ ] **Step 5: Update the serializer**

Edit `core/pace/serializers.py`. Replace `OperationalStandupSerializer` with:

```python
class OperationalStandupApprovalSerializer(serializers.ModelSerializer):
    org_uid = serializers.UUIDField(source="org.uid", read_only=True)
    org_name = serializers.CharField(source="org.name", read_only=True)
    approved_by_detail = UserMinSerializer(source="approved_by", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)

    class Meta:
        model = OperationalStandupApproval  # add to imports
        fields = [
            "uid",
            "org_uid",
            "org_name",
            "status",
            "approved_by_detail",
            "approved_at",
            "reviewed_by_detail",
            "reviewed_at",
        ]
        read_only_fields = fields


class OperationalStandupSerializer(serializers.ModelSerializer):
    profile_detail = UserMinSerializer(source="profile", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    approvals = OperationalStandupApprovalSerializer(many=True, read_only=True)

    profile = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
    )

    class Meta:
        model = OperationalStandup
        fields = [
            "id",
            "uid",
            "profile",
            "profile_detail",
            "standup_date",
            "breakthrough_type",
            "priorities",
            "collaboration_need",
            "remarks",
            "created_by_detail",
            "approvals",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "profile_detail",
            "created_by_detail",
            "approvals",
            "created_at",
            "updated_at",
        ]
        validators: list = []
```

Add `OperationalStandupApproval` to the model imports at the top of the file:

```python
from .models import (
    ClientClassification,
    OperationalStandup,
    OperationalStandupApproval,
    PaceChecklist,
    PaceGoal,
    PaceGoalReview,
    PaceMeeting,
)
```

- [ ] **Step 6: Re-run the failing tests**

```
uv run python manage.py test core.pace.tests.OperationalStandupVisibilityTests core.pace.tests.OperationalStandupRosterMultiOrgTests --keepdb -v 2
```
Expected: green.

- [ ] **Step 7: Run the whole pace suite to surface fallout**

```
uv run python manage.py test core.pace --keepdb -v 2
```
Expected: green. Fix any leftover test references to `org_uid` / `can_approve` on roster rows by switching them to `approvals[]` assertions.

- [ ] **Step 8: Commit**

```
git add core/pace/views.py core/pace/serializers.py core/pace/tests.py
git commit -m "feat(pace): multi-org-aware standup list/roster/update/delete with embedded approvals"
```

---

## Task 8: Per-org `approve` and `review` actions

**Files:**
- Modify: `core/pace/views.py`
- Modify: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests**

Replace `OperationalStandupApproveTests` in `core/pace/tests.py` with:

```python
class OperationalStandupApproveTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        from core.pace.services.standup import ensure_approvals_for_standup

        self.org_4d = Org.objects.create(name="4D")
        self.org_ybv = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")  # mgr 4D only
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")  # admin in both
        OrgMembership.objects.create(user=self.alice, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.alice, org=self.org_ybv, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org_4d, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org_4d, role="admin")
        OrgMembership.objects.create(user=self.cathy, org=self.org_ybv, role="admin")

        self.row = OperationalStandup.objects.create(
            profile=self.alice, standup_date=_d(2026, 5, 4), priorities="A1"
        )
        ensure_approvals_for_standup(self.row)

    def _approval(self, org):
        return self.row.approvals.get(org=org)

    def test_manager_in_4d_can_approve_only_4d_approval(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post(
            f"/api/operational_standups/{self.row.uid}/approve/",
            {"org": str(self.org_4d.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._approval(self.org_4d).status, "Approved")
        self.assertEqual(self._approval(self.org_ybv).status, "Pending")

    def test_manager_in_4d_cannot_approve_ybv(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post(
            f"/api/operational_standups/{self.row.uid}/approve/",
            {"org": str(self.org_ybv.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_approve_requires_org_in_payload(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post(f"/api/operational_standups/{self.row.uid}/approve/", {})
        self.assertEqual(resp.status_code, 400)

    def test_approve_rejects_org_outside_profile_membership(self):
        outside = Org.objects.create(name="ZETA")
        OrgMembership.objects.create(user=self.cathy, org=outside, role="admin")
        self.client.force_authenticate(self.cathy)
        resp = self.client.post(
            f"/api/operational_standups/{self.row.uid}/approve/",
            {"org": str(outside.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_review_only_admin(self):
        self.client.force_authenticate(self.bob)  # manager, not admin
        resp = self.client.post(
            f"/api/operational_standups/{self.row.uid}/review/",
            {"org": str(self.org_4d.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

        self.client.force_authenticate(self.cathy)
        resp = self.client.post(
            f"/api/operational_standups/{self.row.uid}/review/",
            {"org": str(self.org_4d.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(self._approval(self.org_4d).reviewed_at)
        self.assertIsNone(self._approval(self.org_ybv).reviewed_at)
```

- [ ] **Step 2: Run and confirm failures**

```
uv run python manage.py test core.pace.tests.OperationalStandupApproveTests --keepdb -v 2
```
Expected: failures, mostly 400 vs 200 / wrong assertion on per-org state.

- [ ] **Step 3: Replace `approve` and `review` actions**

Edit `core/pace/views.py`. Replace the existing `approve` action and `review` action with:

```python
    def _resolve_approval(self, request, instance, *, role_check):
        from core.org_utils import resolve_org

        org_uid = request.data.get("org")
        if not org_uid:
            return None, Response({"detail": "`org` is required."}, status=400)
        org = resolve_org(org_uid)
        if org is None:
            return None, Response({"detail": "Org not found."}, status=400)

        try:
            approval = instance.approvals.select_related("org").get(org=org)
        except OperationalStandupApproval.DoesNotExist:
            return None, Response(
                {"detail": "That org has no approval row for this standup."},
                status=400,
            )

        user = cast(User, request.user)
        if not role_check(user, org):
            raise PermissionDenied("You don't have permission in that org.")
        return approval, None

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from django.utils import timezone

        instance = self.get_object()
        approval, err = self._resolve_approval(
            request, instance, role_check=lambda u, o: u.is_manager_in(o)
        )
        if err is not None:
            return err

        if approval.status != "Approved":
            approval.status = "Approved"
            approval.approved_by = request.user
            approval.approved_at = timezone.now()
            approval.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(instance).data,
        )
        return Response(OperationalStandupSerializer(instance).data)

    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, uid=None):
        from django.utils import timezone

        instance = self.get_object()
        approval, err = self._resolve_approval(
            request, instance, role_check=lambda u, o: u.is_admin_in(o)
        )
        if err is not None:
            return err

        if approval.reviewed_at is None:
            approval.reviewed_by = request.user
            approval.reviewed_at = timezone.now()
            approval.save(update_fields=["reviewed_by", "reviewed_at", "updated_at"])

        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(instance).data,
        )
        return Response(OperationalStandupSerializer(instance).data)
```

Add to the file's top-level imports if not already present:

```python
from .models import (
    ClientClassification,
    OperationalStandup,
    OperationalStandupApproval,
    PaceChecklist,
    PaceGoal,
    PaceGoalReview,
    PaceMeeting,
)
```

- [ ] **Step 4: Re-run the test class**

```
uv run python manage.py test core.pace.tests.OperationalStandupApproveTests --keepdb -v 2
```
Expected: green.

- [ ] **Step 5: Commit**

```
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): per-org approve/review actions on OperationalStandup"
```

---

## Task 9: Per-org `bulk_review` and `pending_count`

**Files:**
- Modify: `core/pace/views.py`
- Modify: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/pace/tests.py`:

```python
class OperationalStandupBulkReviewMultiOrgTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        from core.pace.services.standup import ensure_approvals_for_standup

        self.org_4d = Org.objects.create(name="4D")
        self.org_ybv = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.alice, org=self.org_ybv, role="employee")
        OrgMembership.objects.create(user=self.cathy, org=self.org_4d, role="admin")

        self.row = OperationalStandup.objects.create(
            profile=self.alice, standup_date=_d(2026, 5, 4)
        )
        ensure_approvals_for_standup(self.row)

    def test_bulk_review_only_touches_target_org(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.post(
            "/api/operational_standups/bulk_review/",
            {"date": "2026-05-04", "org": str(self.org_4d.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        a_4d = self.row.approvals.get(org=self.org_4d)
        a_ybv = self.row.approvals.get(org=self.org_ybv)
        self.assertEqual(a_4d.status, "Approved")
        self.assertIsNotNone(a_4d.reviewed_at)
        self.assertEqual(a_ybv.status, "Pending")
        self.assertIsNone(a_ybv.reviewed_at)

    def test_bulk_review_403_for_non_admin(self):
        bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        OrgMembership.objects.create(user=bob, org=self.org_4d, role="manager")
        self.client.force_authenticate(bob)
        resp = self.client.post(
            "/api/operational_standups/bulk_review/",
            {"date": "2026-05-04", "org": str(self.org_4d.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)


class OperationalStandupPendingCountTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        from core.pace.services.standup import ensure_approvals_for_standup

        self.org_4d = Org.objects.create(name="4D")
        self.org_ybv = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")  # mgr 4D only
        OrgMembership.objects.create(user=self.alice, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.alice, org=self.org_ybv, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org_4d, role="manager")

        self.row = OperationalStandup.objects.create(
            profile=self.alice, standup_date=_d(2026, 5, 4)
        )
        ensure_approvals_for_standup(self.row)

    def test_manager_pending_count_counts_only_their_orgs(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.get("/api/operational_standups/pending_count/")
        # Alice has 2 pending approvals (4D + YBV); Bob manages 4D only → count = 1.
        self.assertEqual(resp.json()["count"], 1)
```

- [ ] **Step 2: Run and confirm failures**

```
uv run python manage.py test core.pace.tests.OperationalStandupBulkReviewMultiOrgTests core.pace.tests.OperationalStandupPendingCountTests --keepdb -v 2
```
Expected: failures referencing old per-row `status`/`approved_by` semantics.

- [ ] **Step 3: Rewrite `bulk_review`**

Replace the action in `core/pace/views.py` with:

```python
    @action(detail=False, methods=["post"], url_path="bulk_review")
    def bulk_review(self, request):
        from django.utils import timezone

        from core.org_utils import resolve_org

        date_str = request.data.get("date")
        org_ident = request.data.get("org")
        if not date_str or not org_ident:
            return Response({"detail": "`date` and `org` are required."}, status=400)
        org = resolve_org(org_ident)
        if org is None:
            return Response({"detail": "Org not found."}, status=400)

        user = cast(User, request.user)
        if not user.is_admin_in(org):
            raise PermissionDenied("Only admins can run Final Review.")

        now = timezone.now()
        with transaction.atomic():
            pending = OperationalStandupApproval.objects.select_for_update().filter(
                org=org,
                status="Pending",
                standup__standup_date=date_str,
            )
            approved_ids = list(pending.values_list("id", flat=True))
            pending.update(status="Approved", approved_by=user, approved_at=now)

            unreviewed = OperationalStandupApproval.objects.select_for_update().filter(
                org=org,
                reviewed_at__isnull=True,
                standup__standup_date=date_str,
            )
            reviewed_ids = list(unreviewed.values_list("id", flat=True))
            unreviewed.update(reviewed_by=user, reviewed_at=now)

        # Broadcast updated standups (one event per affected standup, deduped).
        affected_standup_ids = set(
            OperationalStandupApproval.objects.filter(
                id__in=set(approved_ids) | set(reviewed_ids)
            ).values_list("standup_id", flat=True)
        )
        for s in OperationalStandup.objects.filter(id__in=affected_standup_ids):
            broadcast(
                "pace-operational-standups",
                "UPDATE",
                OperationalStandupSerializer(s).data,
            )

        return Response({"approved_count": len(approved_ids), "reviewed_count": len(reviewed_ids)})
```

- [ ] **Step 4: Rewrite `pending_count`**

Replace the action in `core/pace/views.py` with:

```python
    @action(detail=False, methods=["get"], url_path="pending_count")
    def pending_count(self, request):
        user = cast(User, request.user)
        from django.db.models import Q

        admin_org_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
        manager_org_ids = list(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )

        # Admin: Pending OR (Approved AND not reviewed) in admin orgs.
        admin_q = Q(org_id__in=admin_org_ids) & (
            Q(status="Pending") | Q(status="Approved", reviewed_at__isnull=True)
        )
        manager_only_org_ids = [o for o in manager_org_ids if o not in admin_org_ids]
        manager_q = Q(org_id__in=manager_only_org_ids, status="Pending")
        # Employee: their own pending approvals, scoped to orgs where they are
        # not a manager/admin (so we don't double-count the manager bucket).
        employee_q = (
            Q(standup__profile=user, status="Pending") & ~Q(org_id__in=manager_org_ids)
        )

        count = OperationalStandupApproval.objects.filter(admin_q | manager_q | employee_q).count()
        return Response({"count": count})
```

- [ ] **Step 5: Re-run tests**

```
uv run python manage.py test core.pace.tests.OperationalStandupBulkReviewMultiOrgTests core.pace.tests.OperationalStandupPendingCountTests --keepdb -v 2
```
Expected: green.

- [ ] **Step 6: Run the whole `core.pace` suite**

```
uv run python manage.py test core.pace --keepdb -v 2
```
Expected: all green.

- [ ] **Step 7: Commit**

```
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): per-org bulk_review and pending_count over OperationalStandupApproval"
```

---

## Task 10: Frontend types — embed `approvals[]` and drop flat status fields

**Files:**
- Modify: `frontend/task-tracker/src/types/api/pace.ts`

- [ ] **Step 1: Replace the standup DTOs**

In `frontend/task-tracker/src/types/api/pace.ts`, replace the standup section starting at `// ── Operational Standup (daily standup grid) ──` with:

```typescript
// ── Operational Standup (daily standup grid) ──────────────────────────────

export type BreakthroughTypeValue = "Breakdown" | "Breakthrough" | "";
export type OperationalStandupApprovalStatus = "Pending" | "Approved";

export interface OperationalStandupApprovalDto {
  readonly uid: string;
  readonly org_uid: string;
  readonly org_name: string;
  readonly status: OperationalStandupApprovalStatus;
  readonly approved_by_detail: UserRefDto | null;
  readonly approved_at: string | null;
  readonly reviewed_by_detail: UserRefDto | null;
  readonly reviewed_at: string | null;
}

export interface OperationalStandupDto extends BaseDto {
  readonly profile: string;
  readonly profile_detail: UserRefDto;
  readonly standup_date: string;
  readonly breakthrough_type: BreakthroughTypeValue;
  readonly priorities: string;
  readonly collaboration_need: string;
  readonly remarks: string;
  readonly created_by_detail: UserRefDto | null;
  readonly approvals: readonly OperationalStandupApprovalDto[];
}

export interface OperationalStandupCreate {
  profile: string;
  standup_date: string;
  breakthrough_type: BreakthroughTypeValue;
  priorities: string;
  collaboration_need: string;
  remarks: string;
}

export interface OperationalStandupRosterApproval {
  readonly uid: string;
  readonly org_uid: string;
  readonly org_name: string;
  readonly status: OperationalStandupApprovalStatus;
  readonly approved_by: { uid: string; full_name: string } | null;
  readonly approved_at: string | null;
  readonly reviewed_by: { uid: string; full_name: string } | null;
  readonly reviewed_at: string | null;
  readonly can_act: boolean;
}

export interface OperationalStandupRosterRow {
  readonly profile: UserRefDto;
  readonly entry: OperationalStandupDto | null;
  readonly approvals: readonly OperationalStandupRosterApproval[];
  readonly can_edit: boolean;
}

export interface PendingCountResponse {
  readonly count: number;
}

export interface BulkReviewResponse {
  readonly approved_count: number;
  readonly reviewed_count: number;
}
```

- [ ] **Step 2: Typecheck**

```
cd frontend/task-tracker && npm run typecheck
```
Expected: errors throughout the page/row/section components — those are fixed in Tasks 11–13.

- [ ] **Step 3: Commit**

```
git add frontend/task-tracker/src/types/api/pace.ts
git commit -m "feat(pace-fe): embed approvals[] on OperationalStandup DTOs"
```

---

## Task 11: Frontend page — drop dedupe and `selectedOrg` filter

**Files:**
- Modify: `frontend/task-tracker/src/pages/DailyStandupPage.tsx`
- Modify: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx`

- [ ] **Step 1: Update the smoke test fixture**

Open the existing test and rewrite the relevant fixture to include `approvals[]`. The skeleton (adjust to match the existing imports in the file):

```tsx
import { render, screen } from "@testing-library/react";
import DailyStandupPage from "@/pages/DailyStandupPage";
import { vi } from "vitest";

const multiOrgRoster = [
  {
    profile: { id: 1, uid: "alice-uid", full_name: "Alice", email: "a@x.com" },
    entry: {
      id: 1,
      uid: "row-1",
      profile: "alice-uid",
      profile_detail: { uid: "alice-uid", full_name: "Alice", email: "a@x.com" },
      standup_date: "2026-05-04",
      breakthrough_type: "Breakthrough",
      priorities: "Ship it",
      collaboration_need: "",
      remarks: "",
      created_by_detail: null,
      approvals: [
        {
          uid: "ap-4d",
          org_uid: "4d-uid",
          org_name: "4D",
          status: "Approved",
          approved_by_detail: { uid: "m-4d", full_name: "Mike" },
          approved_at: "2026-05-04T09:00:00Z",
          reviewed_by_detail: null,
          reviewed_at: null,
        },
        {
          uid: "ap-ybv",
          org_uid: "ybv-uid",
          org_name: "YBV",
          status: "Pending",
          approved_by_detail: null,
          approved_at: null,
          reviewed_by_detail: null,
          reviewed_at: null,
        },
      ],
      created_at: "2026-05-04T09:00:00Z",
      updated_at: "2026-05-04T09:00:00Z",
    },
    approvals: [
      { uid: "ap-4d", org_uid: "4d-uid", org_name: "4D", status: "Approved", approved_by: { uid: "m-4d", full_name: "Mike" }, approved_at: "2026-05-04T09:00:00Z", reviewed_by: null, reviewed_at: null, can_act: true },
      { uid: "ap-ybv", org_uid: "ybv-uid", org_name: "YBV", status: "Pending", approved_by: null, approved_at: null, reviewed_by: null, reviewed_at: null, can_act: true },
    ],
    can_edit: true,
  },
];

vi.mock("@/hooks/useOperationalStandups", () => ({
  useOperationalStandups: () => ({
    standups: [],
    roster: multiOrgRoster,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => true,
    isManagerInAny: () => true,
  }),
}));

test("multi-org user shows one row with one chip per org", () => {
  render(
    <DailyStandupPage
      profile={{ id: "u1", orgs: [{ uid: "4d-uid", name: "4D" }, { uid: "ybv-uid", name: "YBV" }] } as any}
      profiles={[]}
      selectedOrg=""
    />,
  );
  expect(screen.getAllByText("Alice")).toHaveLength(1);
  expect(screen.getByText("4D")).toBeInTheDocument();
  expect(screen.getByText("YBV")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx
```
Expected: failures (the page still dedupes, no chip strip yet).

- [ ] **Step 3: Rewrite `DailyStandupPage.tsx`**

Replace the entire file with:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useOperationalStandups } from "@/hooks/useOperationalStandups";
import type { Profile } from "@/types/auth";
import type {
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";
import { DailyStandupDateSection } from "@/components/pace/DailyStandupDateSection";
import { DailyStandupAddModal } from "@/components/pace/DailyStandupAddModal";

interface DailyStandupPageProps {
  profile: Profile | null;
  profiles?: Profile[];
  selectedOrg?: string; // accepted for API parity with the header; ignored here.
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function DailyStandupPage({ profile, profiles = [] }: DailyStandupPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const isManager = isManagerInAny();
  const canAdd = isAdmin || isManager;

  const [month, setMonth] = useState(currentMonth());
  const [showAdd, setShowAdd] = useState(false);

  const { standups, roster, refresh } = useOperationalStandups({
    month,
    rosterDate: todayISO(),
  });

  const today = todayISO();

  // Older-date rows come from `standups`. One row per (profile, date) — no dedupe.
  const dateGroups = useMemo(() => {
    const byDate = new Map<string, OperationalStandupRosterRow[]>();
    byDate.set(today, roster);

    const olderByDate = new Map<string, OperationalStandupRosterRow[]>();
    for (const s of standups) {
      if (s.standup_date === today) continue;
      const row: OperationalStandupRosterRow = {
        profile: s.profile_detail,
        entry: s,
        approvals: s.approvals.map((a) => ({
          uid: a.uid,
          org_uid: a.org_uid,
          org_name: a.org_name,
          status: a.status,
          approved_by: a.approved_by_detail
            ? { uid: a.approved_by_detail.uid, full_name: a.approved_by_detail.full_name }
            : null,
          approved_at: a.approved_at,
          reviewed_by: a.reviewed_by_detail
            ? { uid: a.reviewed_by_detail.uid, full_name: a.reviewed_by_detail.full_name }
            : null,
          reviewed_at: a.reviewed_at,
          can_act: isManager,
        })),
        can_edit: isManager || s.profile_detail.uid === profile?.id,
      };
      const arr = olderByDate.get(s.standup_date) ?? [];
      arr.push(row);
      olderByDate.set(s.standup_date, arr);
    }
    for (const [date, rows] of olderByDate) byDate.set(date, rows);
    return Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [standups, roster, today, isManager, profile]);

  const handleSave = useCallback(
    async (payload: Partial<OperationalStandupCreate>, rowUid: string | null) => {
      try {
        if (rowUid) {
          await apiPatch(`/operational_standups/${rowUid}/`, payload);
        } else {
          await apiPost(`/operational_standups/`, payload);
        }
        await refresh();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
      }
    },
    [refresh],
  );

  const handleApprove = useCallback(
    async (uid: string, orgUid: string) => {
      await apiPost(`/operational_standups/${uid}/approve/`, { org: orgUid });
      await refresh();
    },
    [refresh],
  );

  const handleReview = useCallback(
    async (uid: string, orgUid: string) => {
      await apiPost(`/operational_standups/${uid}/review/`, { org: orgUid });
      await refresh();
    },
    [refresh],
  );

  const handleFinalReview = useCallback(
    async (date: string, orgUid: string) => {
      if (!window.confirm(`Run Final Review for ${date}?`)) return;
      await apiPost(`/operational_standups/bulk_review/`, { date, org: orgUid });
      await refresh();
    },
    [refresh],
  );

  const adminOrgs = useMemo(
    () =>
      (profile?.orgs ?? [])
        .filter((o: { role?: string; uid: string; name: string }) => o.role === "admin")
        .map((o) => ({ uid: o.uid, name: o.name })),
    [profile],
  );

  const profileChoices = useMemo(
    () =>
      (profiles ?? [])
        .map((p) => ({ uid: p.id, full_name: p.full_name ?? p.username ?? "" }))
        .filter((p) => p.uid),
    [profiles],
  );

  const stats = useMemo(() => {
    const total = standups.length;
    const allApprovals = standups.flatMap((s) => s.approvals);
    const approved = allApprovals.filter((a) => a.status === "Approved").length;
    const pending = allApprovals.filter((a) => a.status === "Pending").length;
    const submitted = roster.filter((r) => r.entry !== null).length;
    return {
      total,
      approved,
      pending,
      notSubmittedToday: Math.max(0, roster.length - submitted),
    };
  }, [standups, roster]);

  useEffect(() => {
    void refresh();
  }, [refresh, month]);

  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="page-title">📋 Daily Standup</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: "6px 10px", fontSize: 13 }}
          />
          {canAdd && (
            <button
              onClick={() => setShowAdd(true)}
              style={{
                padding: "7px 14px", background: "#2563eb", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12,
              }}
            >
              + Add Entry
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          { l: "Total", v: stats.total, c: "#2563eb" },
          { l: "Approved", v: stats.approved, c: "#16a34a" },
          { l: "Pending", v: stats.pending, c: "#d97706" },
          { l: "Not submitted today", v: stats.notSubmittedToday, c: "#dc2626" },
        ].map((s) => (
          <div
            key={s.l}
            style={{
              background: "#fff", borderRadius: 8, padding: "8px 14px",
              borderTop: `3px solid ${s.c}`, minWidth: 110, textAlign: "center",
              boxShadow: "0 1px 4px rgba(0,0,0,.07)",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {dateGroups.map(([date, rows]) => {
        const pendingCount = rows.reduce(
          (acc, r) => acc + r.approvals.filter((a) => a.status === "Pending").length,
          0,
        );
        return (
          <DailyStandupDateSection
            key={date}
            date={date}
            rows={rows}
            defaultExpanded={date === today}
            adminOrgs={adminOrgs}
            pendingCount={pendingCount}
            isAdmin={isAdmin}
            onSave={handleSave}
            onApprove={handleApprove}
            onReview={handleReview}
            onFinalReview={handleFinalReview}
          />
        );
      })}

      {showAdd && (
        <DailyStandupAddModal
          date={today}
          profiles={profileChoices}
          onSubmit={async (payload) => {
            await apiPost("/operational_standups/", payload);
            await refresh();
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Re-run the page smoke test**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add frontend/task-tracker/src/pages/DailyStandupPage.tsx frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx
git commit -m "feat(pace-fe): one row per user per day with per-org approvals"
```

---

## Task 12: Frontend row — per-org approval chips

**Files:**
- Modify: `frontend/task-tracker/src/components/pace/DailyStandupRow.tsx`
- Modify: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupRow.test.tsx`

- [ ] **Step 1: Write failing chip-render test**

Replace the existing test with one that asserts a chip per approval. Skeleton:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { DailyStandupRow } from "@/components/pace/DailyStandupRow";

const row = {
  profile: { id: 1, uid: "alice", full_name: "Alice", email: "a@x.com" },
  entry: {
    uid: "row-1",
    profile_detail: { uid: "alice", full_name: "Alice", email: "a@x.com" },
    standup_date: "2026-05-04",
    breakthrough_type: "Breakthrough",
    priorities: "Ship",
    collaboration_need: "",
    remarks: "",
    created_by_detail: null,
    approvals: [],
  } as any,
  approvals: [
    { uid: "ap-4d", org_uid: "4d", org_name: "4D", status: "Approved" as const,
      approved_by: { uid: "m4d", full_name: "Mike" }, approved_at: "x",
      reviewed_by: null, reviewed_at: null, can_act: true },
    { uid: "ap-ybv", org_uid: "ybv", org_name: "YBV", status: "Pending" as const,
      approved_by: null, approved_at: null,
      reviewed_by: null, reviewed_at: null, can_act: true },
  ],
  can_edit: true,
};

test("renders one chip per approval and exposes per-org approve handler", () => {
  const onApprove = vi.fn();
  render(
    <table><tbody>
      <DailyStandupRow
        row={row as any}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={onApprove}
        onReview={vi.fn()}
      />
    </tbody></table>,
  );
  expect(screen.getByText("4D")).toBeInTheDocument();
  expect(screen.getByText("YBV")).toBeInTheDocument();

  // YBV is Pending and can_act=true → Approve button surfaces.
  fireEvent.click(screen.getByRole("button", { name: /Approve YBV/i }));
  expect(onApprove).toHaveBeenCalledWith("row-1", "ybv");
});
```

- [ ] **Step 2: Run the test to confirm failure**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupRow.test.tsx
```
Expected: failures (chips not rendered yet).

- [ ] **Step 3: Replace `DailyStandupRow.tsx`**

Replace the file with the following — the structure of editable cells is unchanged; only the **Status / Actions** columns become a per-approval chip strip:

```tsx
import { useEffect, useState } from "react";
import type {
  BreakthroughTypeValue,
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface DailyStandupRowProps {
  row: OperationalStandupRosterRow;
  isAdmin: boolean;
  onSave: (
    payload: OperationalStandupCreate | Partial<OperationalStandupCreate>,
    rowUid: string | null,
  ) => Promise<void>;
  onApprove: (rowUid: string, orgUid: string) => Promise<void>;
  onReview: (rowUid: string, orgUid: string) => Promise<void>;
}

export function DailyStandupRow({ row, isAdmin, onSave, onApprove, onReview }: DailyStandupRowProps) {
  const e = row.entry;
  const [breakthroughType, setBreakthroughType] = useState<BreakthroughTypeValue>(
    e?.breakthrough_type ?? "",
  );
  const [priorities, setPriorities] = useState(e?.priorities ?? "");
  const [collab, setCollab] = useState(e?.collaboration_need ?? "");
  const [remarks, setRemarks] = useState(e?.remarks ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(t);
  }, [justSaved]);

  const isPlaceholder = e === null;
  const locked = !row.can_edit;

  const startEdit = () => {
    setBreakthroughType(e?.breakthrough_type ?? "");
    setPriorities(e?.priorities ?? "");
    setCollab(e?.collaboration_need ?? "");
    setRemarks(e?.remarks ?? "");
    setDirty(isPlaceholder);
    setEditing(true);
  };

  const handleSaveClick = async () => {
    if (saving || locked) return;
    if (!dirty && !isPlaceholder) return;
    setSaving(true);
    try {
      const payload: OperationalStandupCreate = {
        profile: row.profile.uid,
        standup_date: e?.standup_date ?? "",
        breakthrough_type: breakthroughType,
        priorities,
        collaboration_need: collab,
        remarks,
      };
      await onSave(payload, e?.uid ?? null);
      setDirty(false);
      setJustSaved(true);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setBreakthroughType(e?.breakthrough_type ?? "");
    setPriorities(e?.priorities ?? "");
    setCollab(e?.collaboration_need ?? "");
    setRemarks(e?.remarks ?? "");
    setDirty(false);
    setEditing(false);
  };

  const cellS: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 12,
    verticalAlign: "top",
  };

  const readOnlyTextS: React.CSSProperties = {
    color: "#475569",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };

  const placeholderTextS: React.CSSProperties = {
    color: "#94a3b8",
  };

  const saveLabel = saving ? "Saving…" : justSaved ? "Saved ✓" : "Save";
  const saveBg = justSaved ? "#16a34a" : "#2563eb";

  const renderTypeCell = () => {
    if (isPlaceholder && !editing) return <span style={placeholderTextS}>—</span>;
    if (!editing)
      return (
        <span style={readOnlyTextS}>
          {breakthroughType || <span style={placeholderTextS}>—</span>}
        </span>
      );
    return (
      <select
        value={breakthroughType}
        onChange={(ev) => {
          setBreakthroughType(ev.target.value as BreakthroughTypeValue);
          setDirty(true);
        }}
        style={{ width: "100%", fontSize: 12, padding: "4px" }}
      >
        <option value="">—</option>
        <option value="Breakdown">Breakdown</option>
        <option value="Breakthrough">Breakthrough</option>
      </select>
    );
  };

  const renderPrioritiesCell = () => {
    if (isPlaceholder && !editing) return <span style={placeholderTextS}>Not submitted</span>;
    if (!editing)
      return <div style={readOnlyTextS}>{priorities || <span style={placeholderTextS}>—</span>}</div>;
    return (
      <textarea
        value={priorities}
        onChange={(ev) => {
          setPriorities(ev.target.value);
          setDirty(true);
        }}
        placeholder="Top priorities for the day…"
        style={{ width: "100%", minHeight: 40, fontSize: 12, padding: 4, resize: "vertical" }}
      />
    );
  };

  const renderCollabCell = () => {
    if (isPlaceholder && !editing) return <span style={placeholderTextS}>—</span>;
    if (!editing) return <div style={readOnlyTextS}>{collab || <span style={placeholderTextS}>—</span>}</div>;
    return (
      <input
        value={collab}
        onChange={(ev) => {
          setCollab(ev.target.value);
          setDirty(true);
        }}
        placeholder="Collaboration need…"
        style={{ width: "100%", fontSize: 12, padding: 4 }}
      />
    );
  };

  const renderRemarksCell = () => {
    if (isPlaceholder && !editing) return <span style={placeholderTextS}>—</span>;
    if (!editing) return <div style={readOnlyTextS}>{remarks || <span style={placeholderTextS}>—</span>}</div>;
    return (
      <input
        value={remarks}
        onChange={(ev) => {
          setRemarks(ev.target.value);
          setDirty(true);
        }}
        placeholder="Remarks…"
        style={{ width: "100%", fontSize: 12, padding: 4 }}
      />
    );
  };

  const renderChip = (a: OperationalStandupRosterRow["approvals"][number]) => {
    const approved = a.status === "Approved";
    return (
      <span
        key={a.uid}
        style={{
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
          padding: "2px 8px",
          borderRadius: 10,
          fontSize: 10,
          fontWeight: 700,
          background: approved ? "#f0fdf4" : "#fef3c7",
          color: approved ? "#16a34a" : "#d97706",
        }}
        title={
          approved && a.approved_by
            ? `Approved by ${a.approved_by.full_name}`
            : "Pending"
        }
      >
        {a.org_name} {approved ? "✓" : "⏳"} {approved && a.approved_by ? a.approved_by.full_name : ""}
        {!approved && e !== null && a.can_act && (
          <button
            type="button"
            onClick={() => void onApprove(e.uid, a.org_uid)}
            aria-label={`Approve ${a.org_name}`}
            style={{
              marginLeft: 4,
              padding: "1px 6px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Approve {a.org_name}
          </button>
        )}
        {approved && isAdmin && a.can_act && a.reviewed_at === null && e !== null && (
          <button
            type="button"
            onClick={() => void onReview(e.uid, a.org_uid)}
            aria-label={`Review ${a.org_name}`}
            style={{
              marginLeft: 4,
              padding: "1px 6px",
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Review {a.org_name}
          </button>
        )}
      </span>
    );
  };

  const editButtonLabel = isPlaceholder ? "+ Add" : "Edit";

  return (
    <tr style={{ background: isPlaceholder ? "#f8fafc" : "#fff" }}>
      <td style={cellS}>{row.profile.full_name}</td>
      <td style={cellS}>{renderTypeCell()}</td>
      <td style={cellS}>{renderPrioritiesCell()}</td>
      <td style={cellS}>{renderCollabCell()}</td>
      <td style={cellS}>{renderRemarksCell()}</td>
      <td style={cellS}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {row.approvals.map(renderChip)}
          {row.approvals.length === 0 && <span style={{ color: "#94a3b8" }}>—</span>}
        </div>
      </td>
      <td style={cellS}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {!editing && !locked && (
            <button
              onClick={startEdit}
              style={{
                padding: "3px 10px", background: "#fff", color: "#1e293b",
                border: "1px solid #cbd5e1", borderRadius: 5, cursor: "pointer",
                fontSize: 11, fontWeight: 700,
              }}
            >
              {editButtonLabel}
            </button>
          )}
          {editing && (
            <button
              onClick={() => void handleSaveClick()}
              disabled={(!dirty && !isPlaceholder) || saving}
              style={{
                padding: "3px 10px", background: saveBg, color: "#fff",
                border: "none", borderRadius: 5,
                cursor: (!dirty && !isPlaceholder) || saving ? "default" : "pointer",
                fontSize: 11, fontWeight: 700,
                opacity: (!dirty && !isPlaceholder) || saving ? 0.5 : 1,
              }}
            >
              {saveLabel}
            </button>
          )}
          {editing && !saving && (
            <button
              onClick={handleCancel}
              style={{
                padding: "3px 10px", background: "#e2e8f0", color: "#1e293b",
                border: "none", borderRadius: 5, cursor: "pointer",
                fontSize: 11, fontWeight: 700,
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
```

Note: the `Status` table-header label in `DailyStandupDateSection` becomes redundant with the chip strip but is harmless; Task 13 updates the header to "Orgs" anyway.

- [ ] **Step 4: Re-run the row test**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupRow.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add frontend/task-tracker/src/components/pace/DailyStandupRow.tsx frontend/task-tracker/src/__tests__/components/pace/dailyStandupRow.test.tsx
git commit -m "feat(pace-fe): per-org approval chips on DailyStandupRow"
```

---

## Task 13: Frontend section — one Final Review button per admin-org

**Files:**
- Modify: `frontend/task-tracker/src/components/pace/DailyStandupDateSection.tsx`
- Modify: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupDateSection.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { DailyStandupDateSection } from "@/components/pace/DailyStandupDateSection";

const adminOrgs = [{ uid: "4d", name: "4D" }, { uid: "ybv", name: "YBV" }];
const rows = [
  {
    profile: { id: 1, uid: "u1", full_name: "Alice", email: "a@x.com" },
    entry: { uid: "row-1" } as any,
    approvals: [
      { uid: "a1", org_uid: "4d", org_name: "4D", status: "Pending", approved_by: null, approved_at: null, reviewed_by: null, reviewed_at: null, can_act: true },
      { uid: "a2", org_uid: "ybv", org_name: "YBV", status: "Pending", approved_by: null, approved_at: null, reviewed_by: null, reviewed_at: null, can_act: true },
    ],
    can_edit: true,
  },
];

test("renders one Final Review button per admin-org", () => {
  const onFinalReview = vi.fn();
  render(
    <DailyStandupDateSection
      date="2026-05-04"
      rows={rows as any}
      defaultExpanded
      adminOrgs={adminOrgs}
      pendingCount={2}
      isAdmin
      onSave={vi.fn()}
      onApprove={vi.fn()}
      onReview={vi.fn()}
      onFinalReview={onFinalReview}
    />,
  );
  expect(screen.getByRole("button", { name: /Final Review.*4D/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Final Review.*YBV/i })).toBeInTheDocument();

  // Suppress confirm popups for the test.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: /Final Review.*YBV/i }));
  expect(onFinalReview).toHaveBeenCalledWith("2026-05-04", "ybv");
});
```

- [ ] **Step 2: Run and confirm failure**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupDateSection.test.tsx
```
Expected: failure (`adminOrgs` prop not accepted yet).

- [ ] **Step 3: Replace `DailyStandupDateSection.tsx`**

```tsx
import { useState } from "react";
import { fmtDate } from "@/utils/date";
import { DailyStandupRow } from "./DailyStandupRow";
import type {
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface DailyStandupDateSectionProps {
  date: string;
  rows: OperationalStandupRosterRow[];
  defaultExpanded: boolean;
  adminOrgs: { uid: string; name: string }[];
  pendingCount: number;
  isAdmin: boolean;
  onSave: (
    payload: OperationalStandupCreate | Partial<OperationalStandupCreate>,
    rowUid: string | null,
  ) => Promise<void>;
  onApprove: (rowUid: string, orgUid: string) => Promise<void>;
  onReview: (rowUid: string, orgUid: string) => Promise<void>;
  onFinalReview: (date: string, orgUid: string) => Promise<void>;
}

export function DailyStandupDateSection({
  date,
  rows,
  defaultExpanded,
  adminOrgs,
  pendingCount,
  isAdmin,
  onSave,
  onApprove,
  onReview,
  onFinalReview,
}: DailyStandupDateSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const submitted = rows.filter((r) => r.entry !== null).length;

  return (
    <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "#f8fafc",
          borderBottom: expanded ? "1px solid #e2e8f0" : "none",
          borderRadius: expanded ? "8px 8px 0 0" : 8,
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", gap: 8,
            fontWeight: 700, fontSize: 13, color: "#1e293b",
          }}
        >
          <span>{expanded ? "▾" : "▸"}</span>
          <span>📅 {fmtDate(date)}</span>
          <span style={{ color: "#64748b", fontWeight: 500 }}>
            · {submitted}/{rows.length} submitted
          </span>
          {pendingCount > 0 && (
            <span style={{ color: "#d97706", fontWeight: 700 }}>
              · {pendingCount} pending
            </span>
          )}
        </button>
        {isAdmin && pendingCount > 0 && (
          <div style={{ display: "flex", gap: 6 }}>
            {adminOrgs.map((o) => (
              <button
                key={o.uid}
                onClick={() => void onFinalReview(date, o.uid)}
                style={{
                  padding: "6px 14px", background: "#2563eb", color: "#fff",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  fontSize: 12, fontWeight: 700,
                }}
              >
                Final Review — {o.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {expanded && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Employee</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Type</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Priorities</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Collaboration</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Remarks</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Orgs</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <DailyStandupRow
                key={`${r.profile.uid}-${r.entry?.uid ?? "new"}`}
                row={r}
                isAdmin={isAdmin}
                onSave={(p, uid) => onSave({ ...p, standup_date: date }, uid)}
                onApprove={onApprove}
                onReview={onReview}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Re-run the section test**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupDateSection.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add frontend/task-tracker/src/components/pace/DailyStandupDateSection.tsx frontend/task-tracker/src/__tests__/components/pace/dailyStandupDateSection.test.tsx
git commit -m "feat(pace-fe): one Final Review button per admin-org"
```

---

## Task 14: Frontend Add modal — drop the `orgUid` prop

**Files:**
- Modify: `frontend/task-tracker/src/components/pace/DailyStandupAddModal.tsx`
- Modify: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupAddModal.test.tsx`

- [ ] **Step 1: Update the modal**

In `DailyStandupAddModal.tsx`, remove `orgUid` from the props interface and stop including `org` in the submitted payload. The submit payload becomes `OperationalStandupCreate` (no `org` field — the backend infers it from the profile's memberships).

Find the props interface and prop destructuring; delete `orgUid` and any usage. Verify the submit-payload object literal doesn't reference `org`.

- [ ] **Step 2: Update the test**

In `dailyStandupAddModal.test.tsx`, remove any `orgUid` prop from the rendered component and remove any assertion expecting `org` in the submitted payload.

- [ ] **Step 3: Run the modal test**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace/dailyStandupAddModal.test.tsx
```
Expected: PASS.

- [ ] **Step 4: Commit**

```
git add frontend/task-tracker/src/components/pace/DailyStandupAddModal.tsx frontend/task-tracker/src/__tests__/components/pace/dailyStandupAddModal.test.tsx
git commit -m "feat(pace-fe): DailyStandupAddModal no longer needs orgUid"
```

---

## Task 15: Realtime + badge fixture cleanup

**Files:**
- Modify: `frontend/task-tracker/src/__tests__/hooks/operationalStandups.smoke.test.ts`
- Modify: `frontend/task-tracker/src/__tests__/hooks/operationalStandupsBadge.smoke.test.ts`

- [ ] **Step 1: Update DTO fixtures**

Open each test file. Wherever the fixture creates an `OperationalStandupDto`, remove `org_uid`, `status`, `approved_by_detail`, `approved_at`, `reviewed_by_detail`, `reviewed_at` and add `approvals: []` (or a representative array). Wherever it creates an `OperationalStandupRosterRow`, replace `org_uid`/`org_name`/`can_approve` with `approvals: []` and keep `can_edit`.

- [ ] **Step 2: Run hook tests**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/hooks/operationalStandups.smoke.test.ts src/__tests__/hooks/operationalStandupsBadge.smoke.test.ts
```
Expected: PASS.

- [ ] **Step 3: Run the full pace frontend test set**

```
cd frontend/task-tracker && npm test -- --run src/__tests__/components/pace src/__tests__/hooks/operationalStandups.smoke.test.ts src/__tests__/hooks/operationalStandupsBadge.smoke.test.ts src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx
```
Expected: green.

- [ ] **Step 4: Commit**

```
git add frontend/task-tracker/src/__tests__/hooks/operationalStandups.smoke.test.ts frontend/task-tracker/src/__tests__/hooks/operationalStandupsBadge.smoke.test.ts
git commit -m "test(pace-fe): update hook fixtures for embedded approvals"
```

---

## Task 16: End-to-end verification

**Files:** None.

- [ ] **Step 1: Run the full backend `pace` suite**

```
uv run python manage.py test core.pace --keepdb -v 2
```
Expected: green.

- [ ] **Step 2: Run pre-commit (covers ruff, format, mypy/pyright, eslint, tsc, build)**

```
uv run pre-commit run --all-files
```
Expected: all checks pass. Per the project's saved feedback, this is the gate before pushing.

- [ ] **Step 3: Smoke-test the page in the dev server**

Start the backend (`uv run python manage.py runserver`) and frontend dev server, then sign in as a user who is **manager in both 4D and YBV** (e.g. Akilan from the seed data). Confirm:

- A single row appears for each user (no duplicates).
- The "Orgs" column shows one chip per org with the correct Pending/Approved colour.
- Clicking "Approve YBV" updates only the YBV chip; the 4D chip is unaffected.
- The Final Review header shows two buttons (`Final Review — 4D`, `Final Review — YBV`); each touches only its own org's approvals.
- Switching the header ORG selector between 4D / YBV / All produces the same data for the manager.

- [ ] **Step 4: Commit any docs the smoke surfaced** (optional — usually none).

```
git status   # should be clean
```

- [ ] **Step 5: Push the branch**

```
git push origin All_Org_reflection
```

Per the saved feedback, the push happens automatically after pre-commit succeeds — no separate confirmation needed.
