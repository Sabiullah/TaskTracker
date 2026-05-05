# Operational Daily Standup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Operational meeting modal with a date-grouped per-employee daily standup grid backed by a new `OperationalStandup` model with role-aware editing and approval.

**Architecture:** New Django model `OperationalStandup` in `core/pace`. New `OrgMembership.exclude_from_operational_standup` flag. New DRF ViewSet at `/operational_standups/` with custom actions (`roster`, `approve`, `bulk_approve`, `pending_count`). New React page `DailyStandupPage` rendered as a sub-tab of the existing PACE page. Operational entry points removed from `PaceMeetingsPage`; existing `PaceMeeting` data left untouched.

**Tech Stack:** Django 5 + DRF, Django Channels (websockets via `core.realtime.broadcast`), React 18 + TypeScript, vitest for frontend tests, Django `APITestCase` for backend tests.

**Spec:** `docs/superpowers/specs/2026-05-04-operational-daily-standup-design.md`

---

## Task 1: Backend models + migrations

**Files:**
- Modify: `core/pace/models.py` (append new model)
- Modify: `users/models.py:293` (add field on `OrgMembership`)
- Create: `core/pace/migrations/0003_operationalstandup.py`
- Create: `users/migrations/0005_orgmembership_exclude_op_standup.py`
- Test: `core/pace/tests.py` (new file — currently empty)

- [ ] **Step 1: Write the failing test for model uniqueness**

Add to `core/pace/tests.py`:

```python
from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase

from core.pace.models import OperationalStandup
from users.models import Org, OrgMembership

User = get_user_model()


class OperationalStandupModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="alice@x.com", full_name="Alice")
        OrgMembership.objects.create(user=self.user, org=self.org, role="employee")

    def test_unique_per_org_profile_date(self):
        OperationalStandup.objects.create(
            org=self.org, profile=self.user, standup_date=date(2026, 5, 4),
        )
        with self.assertRaises(IntegrityError):
            OperationalStandup.objects.create(
                org=self.org, profile=self.user, standup_date=date(2026, 5, 4),
            )

    def test_default_status_is_pending(self):
        s = OperationalStandup.objects.create(
            org=self.org, profile=self.user, standup_date=date(2026, 5, 4),
        )
        self.assertEqual(s.status, "Pending")
        self.assertIsNone(s.approved_by)
        self.assertIsNone(s.approved_at)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test core.pace.tests.OperationalStandupModelTests -v 2`
Expected: FAIL — `ModuleNotFoundError` or `cannot import OperationalStandup`.

- [ ] **Step 3: Add the `OperationalStandup` model**

Append to `core/pace/models.py` (after the existing `PaceMeeting` class, before `PaceChecklist`):

```python
class OperationalStandup(TimeStampedModel):
    BREAKTHROUGH_TYPE_CHOICES = [
        ("Breakdown", "Breakdown"),
        ("Breakthrough", "Breakthrough"),
    ]
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org", on_delete=models.CASCADE, related_name="operational_standups"
    )
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
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default="Pending", db_index=True
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL,
        related_name="operational_standups_created",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL,
        related_name="operational_standups_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-standup_date", "profile__full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["org", "profile", "standup_date"],
                name="uniq_op_standup_org_profile_date",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "standup_date"], name="op_standup_org_date_idx"),
            models.Index(fields=["org", "status"], name="op_standup_org_status_idx"),
        ]
        verbose_name = "operational standup"
        verbose_name_plural = "operational standups"

    def __str__(self):
        return f"{self.profile} — {self.standup_date}"
```

- [ ] **Step 4: Add `exclude_from_operational_standup` to `OrgMembership`**

In `users/models.py`, locate the `OrgMembership` class and add this field after the existing `*_access` fields (look near line 325-330 for the pattern):

```python
    # Per-org opt-out of the daily Operational standup roster (admin/senior staff).
    exclude_from_operational_standup = models.BooleanField(default=False)
```

- [ ] **Step 5: Generate migrations**

Run:
```bash
python manage.py makemigrations pace
python manage.py makemigrations users
```

Expected output: creates `core/pace/migrations/0003_operationalstandup.py` and `users/migrations/0005_orgmembership_exclude_op_standup.py`.

- [ ] **Step 6: Apply migrations and re-run tests**

Run:
```bash
python manage.py migrate
python manage.py test core.pace.tests.OperationalStandupModelTests -v 2
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add core/pace/models.py core/pace/migrations/0003_operationalstandup.py \
        users/models.py users/migrations/0005_orgmembership_exclude_op_standup.py \
        core/pace/tests.py
git commit -m "feat(pace): OperationalStandup model + OrgMembership exclude flag

OperationalStandup is unique per (org, profile, standup_date) and
defaults to status='Pending'. OrgMembership gains a per-org opt-out
flag for the daily standup roster.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Serializer + URL wiring

**Files:**
- Modify: `core/pace/serializers.py` (append `OperationalStandupSerializer`)
- Modify: `core/pace/urls.py` (register new viewset; viewset stub added in this task)
- Modify: `core/pace/views.py` (stub `OperationalStandupViewSet`)
- Test: `core/pace/tests.py`

- [ ] **Step 1: Write a failing test that GET `/api/operational_standups/` returns 200 for an authenticated user**

Append to `core/pace/tests.py`:

```python
from rest_framework.test import APITestCase


class OperationalStandupListEmptyTests(APITestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="bob@x.com", full_name="Bob")
        OrgMembership.objects.create(user=self.user, org=self.org, role="employee")
        self.client.force_authenticate(self.user)

    def test_list_returns_200_with_empty_array(self):
        resp = self.client.get("/api/operational_standups/")
        self.assertEqual(resp.status_code, 200)
        # DRF default pagination may wrap; this codebase doesn't use it.
        self.assertEqual(resp.json(), [])
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test core.pace.tests.OperationalStandupListEmptyTests -v 2`
Expected: FAIL — 404 (URL not wired) or NameError on viewset.

- [ ] **Step 3: Add the serializer**

Append to `core/pace/serializers.py` (after `ClientClassificationSerializer`):

```python
class OperationalStandupSerializer(OrgScopedMixin, serializers.ModelSerializer):
    profile_detail = UserMinSerializer(source="profile", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    approved_by_detail = UserMinSerializer(source="approved_by", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    profile = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
    )
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        from .models import OperationalStandup
        model = OperationalStandup
        fields = [
            "id",
            "uid",
            "org",
            "org_uid",
            "profile",
            "profile_detail",
            "standup_date",
            "breakthrough_type",
            "priorities",
            "collaboration_need",
            "remarks",
            "status",
            "created_by_detail",
            "approved_by_detail",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "profile_detail",
            "created_by_detail",
            "approved_by_detail",
            "status",
            "approved_at",
            "created_at",
            "updated_at",
        ]
```

Also fix the import block at top of `core/pace/serializers.py` to include the new model:

```python
from .models import (
    ClientClassification,
    OperationalStandup,
    PaceChecklist,
    PaceGoal,
    PaceGoalReview,
    PaceMeeting,
)
```

Then remove the local `from .models import OperationalStandup` inside `Meta` (it was a placeholder).

- [ ] **Step 4: Add a stub ViewSet**

Append to `core/pace/views.py`:

```python
from .models import (
    ClientClassification,
    OperationalStandup,
    PaceChecklist,
    PaceGoal,
    PaceGoalReview,
    PaceMeeting,
)
from .serializers import (
    ClientClassificationSerializer,
    OperationalStandupSerializer,
    PaceChecklistSerializer,
    PaceGoalReviewSerializer,
    PaceGoalSerializer,
    PaceMeetingSerializer,
)
```

(Replace the existing import block; merge with what's already there.)

Then add the class:

```python
class OperationalStandupViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = OperationalStandupSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        # Phase 1: returns nothing yet — Task 3 implements role-based scoping.
        return OperationalStandup.objects.none()
```

- [ ] **Step 5: Wire the URL route**

In `core/pace/urls.py`, add to imports and register:

```python
from .views import (
    ClientClassificationViewSet,
    OperationalStandupViewSet,
    PaceChecklistViewSet,
    PaceGoalReviewViewSet,
    PaceGoalViewSet,
    PaceMeetingViewSet,
)

# ...
router.register("operational_standups", OperationalStandupViewSet, basename="operationalstandup")
```

- [ ] **Step 6: Run tests**

Run: `python manage.py test core.pace.tests.OperationalStandupListEmptyTests -v 2`
Expected: PASS — 200 with empty array.

- [ ] **Step 7: Commit**

```bash
git add core/pace/serializers.py core/pace/views.py core/pace/urls.py core/pace/tests.py
git commit -m "feat(pace): OperationalStandup serializer + viewset stub + URL route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ViewSet — list/retrieve with role-based scoping

**Files:**
- Modify: `core/pace/views.py` (`OperationalStandupViewSet.get_queryset`)
- Test: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests for visibility rules**

Append to `core/pace/tests.py`:

```python
class OperationalStandupVisibilityTests(APITestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.org2 = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        # Alice also in org2 as employee — orgs don't bleed across.
        OrgMembership.objects.create(user=self.alice, org=self.org2, role="employee")

        from datetime import date
        d = date(2026, 5, 4)
        self.alice_row = OperationalStandup.objects.create(
            org=self.org, profile=self.alice, standup_date=d, priorities="A1",
        )
        self.bob_row = OperationalStandup.objects.create(
            org=self.org, profile=self.bob, standup_date=d, priorities="B1",
        )
        self.alice_org2_row = OperationalStandup.objects.create(
            org=self.org2, profile=self.alice, standup_date=d, priorities="A2",
        )

    def test_employee_sees_only_own_rows(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.get("/api/operational_standups/")
        ids = {r["id"] for r in resp.json()}
        self.assertEqual(ids, {self.alice_row.id, self.alice_org2_row.id})

    def test_manager_sees_all_rows_in_their_org(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.get("/api/operational_standups/")
        ids = {r["id"] for r in resp.json()}
        self.assertEqual(ids, {self.alice_row.id, self.bob_row.id})

    def test_admin_sees_all_rows_in_their_org(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/")
        ids = {r["id"] for r in resp.json()}
        self.assertEqual(ids, {self.alice_row.id, self.bob_row.id})

    def test_filter_by_month(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/?month=2026-05")
        self.assertEqual(len(resp.json()), 2)
        resp = self.client.get("/api/operational_standups/?month=2026-04")
        self.assertEqual(resp.json(), [])

    def test_filter_by_date(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/?date=2026-05-04")
        self.assertEqual(len(resp.json()), 2)
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test core.pace.tests.OperationalStandupVisibilityTests -v 2`
Expected: FAIL — all rows missing because `get_queryset` returns `none()`.

- [ ] **Step 3: Implement role-based scoping**

Replace `OperationalStandupViewSet.get_queryset` in `core/pace/views.py`:

```python
    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = OperationalStandup.objects.select_related(
            "org", "profile", "created_by", "approved_by"
        )

        # Build per-org visibility: in orgs where the user is admin/manager,
        # they see every row; in orgs where they're a plain employee, only
        # their own rows.
        manager_org_ids = list(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )
        employee_org_ids = list(
            user.memberships.filter(role="employee").values_list("org_id", flat=True)
        )

        from django.db.models import Q
        visibility = Q(org_id__in=manager_org_ids) | (
            Q(org_id__in=employee_org_ids) & Q(profile=user)
        )
        qs = qs.filter(visibility)

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
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        breakthrough_type = self.request.query_params.get("breakthrough_type")
        if breakthrough_type:
            qs = qs.filter(breakthrough_type=breakthrough_type)

        return qs
```

- [ ] **Step 4: Run tests**

Run: `python manage.py test core.pace.tests.OperationalStandupVisibilityTests -v 2`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): OperationalStandup list with per-org role-based scoping

Employees see only their own rows; managers and admins see every row
in orgs where they hold that role. Filters: month, date, profile_uid,
status, breakthrough_type.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ViewSet — create with status auto-assignment

**Files:**
- Modify: `core/pace/views.py` (`OperationalStandupViewSet.perform_create`)
- Test: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests for create + status auto-assignment**

Append to `core/pace/tests.py`:

```python
from datetime import date


class OperationalStandupCreateTests(APITestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")

    def _payload(self, profile_uid):
        return {
            "profile": str(profile_uid),
            "standup_date": "2026-05-04",
            "breakthrough_type": "Breakthrough",
            "priorities": "Ship the thing",
            "collaboration_need": "",
            "remarks": "",
        }

    def test_employee_creating_own_row_is_pending(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["status"], "Pending")

    def test_manager_creating_own_row_is_approved(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post("/api/operational_standups/", self._payload(self.bob.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["status"], "Approved")
        self.assertIsNotNone(body["approved_at"])
        self.assertEqual(body["approved_by_detail"]["uid"], str(self.bob.uid))

    def test_manager_creating_others_row_is_approved(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["status"], "Approved")
        self.assertEqual(body["approved_by_detail"]["uid"], str(self.bob.uid))

    def test_admin_creating_others_row_is_approved(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["status"], "Approved")

    def test_employee_cannot_create_for_others(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.post("/api/operational_standups/", self._payload(self.bob.uid))
        self.assertEqual(resp.status_code, 403)

    def test_create_blocked_when_target_user_not_in_caller_org(self):
        other_org = Org.objects.create(name="OTHER")
        outsider = User.objects.create_user(email="out@x.com", full_name="Outsider")
        OrgMembership.objects.create(user=outsider, org=other_org, role="employee")
        self.client.force_authenticate(self.bob)  # manager in self.org only
        resp = self.client.post("/api/operational_standups/", self._payload(outsider.uid))
        self.assertEqual(resp.status_code, 403)

    def test_create_uniqueness_returns_400(self):
        self.client.force_authenticate(self.alice)
        self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python manage.py test core.pace.tests.OperationalStandupCreateTests -v 2`
Expected: FAIL — `status` stays default `Pending`, no permission gating, etc.

- [ ] **Step 3: Implement `perform_create` with status logic**

Add to `OperationalStandupViewSet` in `core/pace/views.py`:

```python
    def _resolve_target_org(self, profile, request):
        """Pick the org to write the row in: payload `org`, else the single org
        the *target profile* shares with the caller."""
        org_uid = request.data.get("org")
        if org_uid:
            from core.org_utils import resolve_org
            return resolve_org(org_uid)
        caller = cast(User, request.user)
        caller_org_ids = set(caller.org_ids())
        target_org_ids = set(profile.org_ids())
        shared = caller_org_ids & target_org_ids
        if len(shared) == 1:
            from users.models import Org
            return Org.objects.filter(pk=shared.pop()).first()
        return None

    def perform_create(self, serializer):
        from django.utils import timezone

        user = cast(User, self.request.user)
        profile = serializer.validated_data["profile"]
        org = self._resolve_target_org(profile, self.request)
        if org is None:
            raise PermissionDenied(
                "Could not determine target org. Pass `org` explicitly when "
                "you and the target profile share more than one org."
            )

        # Caller must belong to the target org.
        if org.pk not in set(user.org_ids()):
            raise PermissionDenied("You don't belong to that org.")

        # Employees can only create their own row.
        is_self = profile.pk == user.pk
        is_manager = user.is_manager_in(org)  # admin OR manager
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

        broadcast(
            "pace-operational-standups",
            "INSERT",
            OperationalStandupSerializer(standup).data,
        )

    def create(self, request, *args, **kwargs):
        from django.db import IntegrityError
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            return Response(
                {"detail": "A standup already exists for that employee on that date."},
                status=400,
            )
```

- [ ] **Step 4: Run tests**

Run: `python manage.py test core.pace.tests.OperationalStandupCreateTests -v 2`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): create endpoint with role-aware status auto-assignment

Manager/admin-entered rows land as Approved with approved_by/_at set.
Employee-entered rows are Pending. Employees cannot create rows for
others. Cross-org targets are rejected with 403.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ViewSet — update + delete with edit-after-approval rules

**Files:**
- Modify: `core/pace/views.py`
- Test: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests for update/delete permissions**

Append to `core/pace/tests.py`:

```python
class OperationalStandupUpdateDeleteTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        self.row = OperationalStandup.objects.create(
            org=self.org, profile=self.alice, standup_date=_d(2026, 5, 4),
            priorities="orig", status="Pending",
        )

    def _patch(self, body):
        return self.client.patch(
            f"/api/operational_standups/{self.row.uid}/", body, format="json"
        )

    def test_employee_can_edit_own_pending_row(self):
        self.client.force_authenticate(self.alice)
        resp = self._patch({"priorities": "edited"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.row.refresh_from_db()
        self.assertEqual(self.row.priorities, "edited")

    def test_employee_cannot_edit_own_approved_row(self):
        from django.utils import timezone
        self.row.status = "Approved"
        self.row.approved_by = self.bob
        self.row.approved_at = timezone.now()
        self.row.save()
        self.client.force_authenticate(self.alice)
        resp = self._patch({"priorities": "edited"})
        self.assertEqual(resp.status_code, 403)

    def test_manager_can_edit_approved_row(self):
        from django.utils import timezone
        self.row.status = "Approved"
        self.row.approved_at = timezone.now()
        self.row.save()
        self.client.force_authenticate(self.bob)
        resp = self._patch({"priorities": "manager-edit"})
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_employee_cannot_edit_others_row(self):
        bob_row = OperationalStandup.objects.create(
            org=self.org, profile=self.bob, standup_date=self.row.standup_date,
        )
        self.client.force_authenticate(self.alice)
        resp = self.client.patch(
            f"/api/operational_standups/{bob_row.uid}/", {"priorities": "x"}, format="json"
        )
        self.assertEqual(resp.status_code, 403)

    def test_only_admin_can_delete(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.delete(f"/api/operational_standups/{self.row.uid}/")
        self.assertEqual(resp.status_code, 403)
        self.client.force_authenticate(self.cathy)
        resp = self.client.delete(f"/api/operational_standups/{self.row.uid}/")
        self.assertEqual(resp.status_code, 204)
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test core.pace.tests.OperationalStandupUpdateDeleteTests -v 2`
Expected: FAIL — no permission gating yet.

- [ ] **Step 3: Implement `perform_update` and `perform_destroy`**

Add to `OperationalStandupViewSet` in `core/pace/views.py`:

```python
    def perform_update(self, serializer):
        user = cast(User, self.request.user)
        instance = serializer.instance
        is_manager = user.is_manager_in(instance.org)

        # Employees can only edit their own rows, and only while Pending.
        if not is_manager:
            if instance.profile_id != user.pk:
                raise PermissionDenied("You can only edit your own row.")
            if instance.status == "Approved":
                raise PermissionDenied("This row is already approved and locked.")

        standup = serializer.save()
        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(standup).data,
        )

    def perform_destroy(self, instance):
        user = cast(User, self.request.user)
        if not user.is_admin_in(instance.org):
            raise PermissionDenied("Only admins can delete standup rows.")
        broadcast(
            "pace-operational-standups",
            "DELETE",
            {"id": instance.pk, "uid": str(instance.uid)},
        )
        instance.delete()
```

- [ ] **Step 4: Run tests**

Run: `python manage.py test core.pace.tests.OperationalStandupUpdateDeleteTests -v 2`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): update/delete with edit-after-approval rules

Employees can edit their own row only while it is Pending. Managers
and admins can edit any row in their org. Only admins can delete.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ViewSet — `roster` action

**Files:**
- Modify: `core/pace/views.py`
- Test: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests for roster**

Append to `core/pace/tests.py`:

```python
class OperationalStandupRosterTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.dave = User.objects.create_user(email="d@x.com", full_name="Dave")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin",
                                     exclude_from_operational_standup=True)
        OrgMembership.objects.create(user=self.dave, org=self.org, role="employee")
        # Submitted standup for Alice only.
        self.alice_row = OperationalStandup.objects.create(
            org=self.org, profile=self.alice, standup_date=_d(2026, 5, 4),
            priorities="A1", status="Pending",
        )

    def test_admin_roster_includes_all_active_non_excluded(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        # Cathy is excluded; Alice/Bob/Dave appear.
        names = {r["profile"]["full_name"] for r in rows}
        self.assertEqual(names, {"Alice", "Bob", "Dave"})

    def test_roster_returns_entry_or_null(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        rows = {r["profile"]["full_name"]: r for r in resp.json()}
        self.assertIsNotNone(rows["Alice"]["entry"])
        self.assertEqual(rows["Alice"]["entry"]["priorities"], "A1")
        self.assertIsNone(rows["Bob"]["entry"])

    def test_employee_roster_only_self(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        rows = resp.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["profile"]["full_name"], "Alice")

    def test_inactive_user_excluded(self):
        self.dave.is_active = False
        self.dave.save()
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        names = {r["profile"]["full_name"] for r in resp.json()}
        self.assertNotIn("Dave", names)

    def test_roster_requires_date(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/")
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test core.pace.tests.OperationalStandupRosterTests -v 2`
Expected: FAIL — 404 (action not registered).

- [ ] **Step 3: Implement `roster` action**

Add to `OperationalStandupViewSet` in `core/pace/views.py`:

```python
    @action(detail=False, methods=["get"], url_path="roster")
    def roster(self, request):
        single_date = request.query_params.get("date")
        if not single_date:
            return Response({"detail": "`date` query param required."}, status=400)

        user = cast(User, request.user)
        from users.models import OrgMembership

        # For employees, only themselves; for managers/admins, full roster.
        manager_org_ids = set(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )

        memberships = (
            OrgMembership.objects
            .filter(
                org_id__in=user.org_ids(),
                user__is_active=True,
                exclude_from_operational_standup=False,
            )
            .select_related("user", "org")
        )
        # Employees see only themselves in orgs where they aren't manager/admin.
        from django.db.models import Q
        memberships = memberships.filter(
            Q(org_id__in=manager_org_ids) | Q(user=user)
        )

        # Stable order: org name then full_name.
        memberships = memberships.order_by("org__name", "user__full_name", "user__email")

        entries_by_key = {
            (s.org_id, s.profile_id): s
            for s in OperationalStandup.objects.filter(
                org_id__in=user.org_ids(), standup_date=single_date,
            )
        }

        rows = []
        for m in memberships:
            entry = entries_by_key.get((m.org_id, m.user_id))
            rows.append({
                "profile": {
                    "id": m.user_id,
                    "uid": str(m.user.uid),
                    "full_name": m.user.full_name,
                    "email": m.user.email,
                },
                "org_uid": str(m.org.uid),
                "org_name": m.org.name,
                "entry": OperationalStandupSerializer(entry).data if entry else None,
                "can_edit": (
                    m.org_id in manager_org_ids
                    or (m.user_id == user.pk and (entry is None or entry.status == "Pending"))
                ),
                "can_approve": m.org_id in manager_org_ids,
            })
        return Response(rows)
```

- [ ] **Step 4: Run tests**

Run: `python manage.py test core.pace.tests.OperationalStandupRosterTests -v 2`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): roster endpoint returns full org roster with placeholders

Returns one row per active, non-excluded org member for a given date,
with the existing OperationalStandup entry (or null) and per-row
can_edit/can_approve flags derived from the caller's role.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ViewSet — `approve` and `bulk_approve` actions

**Files:**
- Modify: `core/pace/views.py`
- Test: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/pace/tests.py`:

```python
class OperationalStandupApproveTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        self.row1 = OperationalStandup.objects.create(
            org=self.org, profile=self.alice, standup_date=_d(2026, 5, 4),
            priorities="A1", status="Pending",
        )
        self.row2 = OperationalStandup.objects.create(
            org=self.org, profile=self.bob, standup_date=_d(2026, 5, 4),
            priorities="B1", status="Pending",
        )

    def test_manager_can_approve_single_row(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post(f"/api/operational_standups/{self.row1.uid}/approve/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.row1.refresh_from_db()
        self.assertEqual(self.row1.status, "Approved")
        self.assertEqual(self.row1.approved_by, self.bob)
        self.assertIsNotNone(self.row1.approved_at)

    def test_employee_cannot_approve(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.post(f"/api/operational_standups/{self.row1.uid}/approve/")
        self.assertEqual(resp.status_code, 403)

    def test_admin_bulk_approve_for_date(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.post(
            "/api/operational_standups/bulk_approve/",
            {"date": "2026-05-04", "org": str(self.org.uid)}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.row1.refresh_from_db()
        self.row2.refresh_from_db()
        self.assertEqual(self.row1.status, "Approved")
        self.assertEqual(self.row2.status, "Approved")
        self.assertEqual(self.row1.approved_by, self.cathy)
        self.assertEqual(resp.json()["approved_count"], 2)

    def test_bulk_approve_idempotent(self):
        self.row1.status = "Approved"
        self.row1.approved_by = self.bob
        self.row1.save()
        self.client.force_authenticate(self.cathy)
        resp = self.client.post(
            "/api/operational_standups/bulk_approve/",
            {"date": "2026-05-04", "org": str(self.org.uid)}, format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.row1.refresh_from_db()
        # row1 was already approved by Bob; bulk_approve must not overwrite it.
        self.assertEqual(self.row1.approved_by, self.bob)
        self.assertEqual(resp.json()["approved_count"], 1)

    def test_manager_cannot_bulk_approve(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post(
            "/api/operational_standups/bulk_approve/",
            {"date": "2026-05-04", "org": str(self.org.uid)}, format="json",
        )
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test core.pace.tests.OperationalStandupApproveTests -v 2`
Expected: FAIL — actions not registered.

- [ ] **Step 3: Implement actions**

Add to `OperationalStandupViewSet` in `core/pace/views.py`:

```python
    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from django.utils import timezone

        instance = self.get_object()
        user = cast(User, request.user)
        if not user.is_manager_in(instance.org):
            raise PermissionDenied("Only managers and admins can approve standups.")

        if instance.status != "Approved":
            instance.status = "Approved"
            instance.approved_by = user
            instance.approved_at = timezone.now()
            instance.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

        broadcast(
            "pace-operational-standups",
            "UPDATE",
            OperationalStandupSerializer(instance).data,
        )
        return Response(OperationalStandupSerializer(instance).data)

    @action(detail=False, methods=["post"], url_path="bulk_approve")
    def bulk_approve(self, request):
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

        with transaction.atomic():
            qs = OperationalStandup.objects.select_for_update().filter(
                org=org, standup_date=date_str, status="Pending",
            )
            now = timezone.now()
            updated_ids = list(qs.values_list("id", flat=True))
            qs.update(status="Approved", approved_by=user, approved_at=now)

        # Broadcast each updated row.
        for row in OperationalStandup.objects.filter(id__in=updated_ids):
            broadcast(
                "pace-operational-standups",
                "UPDATE",
                OperationalStandupSerializer(row).data,
            )

        return Response({"approved_count": len(updated_ids)})
```

- [ ] **Step 4: Run tests**

Run: `python manage.py test core.pace.tests.OperationalStandupApproveTests -v 2`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add core/pace/views.py core/pace/tests.py
git commit -m "feat(pace): single + bulk approve actions

approve/ flips one Pending row to Approved (managers + admins).
bulk_approve/ atomically approves every Pending row for {date, org}
(admin only — Final Review). Both broadcast UPDATE events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: ViewSet — `pending_count` action + admin OrgMembership update

**Files:**
- Modify: `core/pace/views.py`
- Modify: `users/serializers.py` (expose new exclude flag)
- Modify: `users/views.py` (allow admin PATCH on the flag)
- Test: `core/pace/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/pace/tests.py`:

```python
class OperationalStandupPendingCountTests(APITestCase):
    def setUp(self):
        from datetime import date as _d
        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        OperationalStandup.objects.create(
            org=self.org, profile=self.alice, standup_date=_d(2026, 5, 4),
            status="Pending",
        )
        OperationalStandup.objects.create(
            org=self.org, profile=self.bob, standup_date=_d(2026, 5, 4),
            status="Pending",
        )
        OperationalStandup.objects.create(
            org=self.org, profile=self.bob, standup_date=_d(2026, 5, 3),
            status="Approved",
        )

    def test_admin_pending_count_is_org_wide(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/pending_count/")
        self.assertEqual(resp.json(), {"count": 2})

    def test_manager_pending_count_is_org_wide(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.get("/api/operational_standups/pending_count/")
        self.assertEqual(resp.json(), {"count": 2})

    def test_employee_pending_count_is_self_only(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.get("/api/operational_standups/pending_count/")
        self.assertEqual(resp.json(), {"count": 1})
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test core.pace.tests.OperationalStandupPendingCountTests -v 2`
Expected: FAIL — 404 (action not registered).

- [ ] **Step 3: Implement `pending_count`**

Add to `OperationalStandupViewSet`:

```python
    @action(detail=False, methods=["get"], url_path="pending_count")
    def pending_count(self, request):
        user = cast(User, request.user)
        manager_org_ids = list(
            user.memberships.filter(role__in=["admin", "manager"]).values_list("org_id", flat=True)
        )
        from django.db.models import Q
        q = Q(status="Pending") & (
            Q(org_id__in=manager_org_ids) | Q(profile=user)
        )
        count = OperationalStandup.objects.filter(q).count()
        return Response({"count": count})
```

- [ ] **Step 4: Wire `exclude_from_operational_standup` into the existing `update_user` flow**

There is no dedicated `OrgMembership` viewset. Membership updates flow through `update_user` in `users/views.py` (around line 380–422). It iterates a set of per-org keys and applies them to the membership. We extend that set.

In `users/views.py`, locate this block:

```python
        per_org_keys = {"role", "is_default", *ACCESS_FEATURES}
```

Replace it with:

```python
        per_org_keys = {"role", "is_default", "exclude_from_operational_standup", *ACCESS_FEATURES}
```

Then immediately before `membership.save()` (around line 422), add:

```python
            if "exclude_from_operational_standup" in request.data:
                membership.exclude_from_operational_standup = bool(
                    request.data["exclude_from_operational_standup"]
                )
```

Now in the membership-flattening helper `_membership_to_dict` (around line 28-29), add the new field to the returned dict so the frontend can read current state. Search for the existing access flags being added and add a sibling entry:

```python
        "exclude_from_operational_standup": m.exclude_from_operational_standup,
```

Add a backend test in `users/tests.py` (or wherever existing membership-update tests live):

```python
def test_admin_can_set_exclude_from_operational_standup(self):
    # caller: admin in org; target: any user in same org
    self.client.force_authenticate(self.admin)
    resp = self.client.patch(
        f"/api/users/{self.target.uid}/",
        {"org_uid": str(self.org.uid), "exclude_from_operational_standup": True},
        format="json",
    )
    self.assertEqual(resp.status_code, 200)
    membership = OrgMembership.objects.get(user=self.target, org=self.org)
    self.assertTrue(membership.exclude_from_operational_standup)
```

(If `users/tests.py` doesn't have a similar test fixture you can copy from, skip this added test — the field will be exercised end-to-end via the frontend RosterExcludePanel in Task 15. The model-level field already has a default in T1.)

- [ ] **Step 5: Run tests**

Run: `python manage.py test core.pace -v 2`
Expected: full pace test suite passes (all tasks 1-8).

- [ ] **Step 6: Commit**

```bash
git add core/pace/views.py core/pace/tests.py users/serializers.py users/views.py
git commit -m "feat(pace): pending_count action + expose membership exclude flag

pending_count/ returns scoped count for nav badge: managers/admins see
org-wide pending; employees see only their own. OrgMembership
serializer exposes exclude_from_operational_standup for admin PATCH.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Frontend — API types

**Files:**
- Modify: `frontend/task-tracker/src/types/api/pace.ts` (append new types alongside existing PaceGoal/PaceMeeting types)

The existing `pace.ts` uses `UserRefDto` from `common.ts` and a `BaseDto` base interface. Match that pattern.

- [ ] **Step 1: Append new types to `pace.ts`**

Append to the end of `frontend/task-tracker/src/types/api/pace.ts`:

```typescript
// ── Operational Standup (daily standup grid) ──────────────────────────────

export type BreakthroughTypeValue = "Breakdown" | "Breakthrough" | "";
export type OperationalStandupStatus = "Pending" | "Approved";

export interface OperationalStandupDto extends BaseDto {
  readonly org_uid: string | null;
  readonly profile: string; // uid
  readonly profile_detail: UserRefDto;
  readonly standup_date: string; // YYYY-MM-DD
  readonly breakthrough_type: BreakthroughTypeValue;
  readonly priorities: string;
  readonly collaboration_need: string;
  readonly remarks: string;
  readonly status: OperationalStandupStatus;
  readonly created_by_detail: UserRefDto | null;
  readonly approved_by_detail: UserRefDto | null;
  readonly approved_at: string | null;
}

export interface OperationalStandupCreate {
  profile: string;
  org?: string;
  standup_date: string;
  breakthrough_type: BreakthroughTypeValue;
  priorities: string;
  collaboration_need: string;
  remarks: string;
}

export interface OperationalStandupRosterRow {
  readonly profile: UserRefDto;
  readonly org_uid: string;
  readonly org_name: string;
  readonly entry: OperationalStandupDto | null;
  readonly can_edit: boolean;
  readonly can_approve: boolean;
}

export interface PendingCountResponse {
  readonly count: number;
}

export interface BulkApproveResponse {
  readonly approved_count: number;
}
```

The references to `BaseDto` and `UserRefDto` are already imported at the top of `pace.ts` (verify; if missing, add them). No `index.ts` changes needed — `pace.ts` is already re-exported.

**Throughout the rest of the plan**, every reference to `UserMin` / `UserMinDto` should be read as `UserRefDto`. Specifically: in Tasks 12 and 13's tests, the test fixture uses `{ profile: { id: 1, uid: "p1", full_name: "Alice", email: "" } }` — that shape matches `UserRefDto`, so no test changes needed.

- [ ] **Step 2: Type-check**

Run: `cd frontend/task-tracker && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/types/api/pace.ts
git commit -m "feat(pace): types for OperationalStandup DTOs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Frontend — `useOperationalStandups` hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/useOperationalStandups.ts`
- Create: `frontend/task-tracker/src/__tests__/hooks/operationalStandups.smoke.test.ts`

- [ ] **Step 1: Write a failing smoke test**

Create `frontend/task-tracker/src/__tests__/hooks/operationalStandups.smoke.test.ts`:

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOperationalStandups } from "@/hooks/useOperationalStandups";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.startsWith("/operational_standups/?month=")) {
      return [{ id: 1, uid: "u1", standup_date: "2026-05-04" }];
    }
    if (url.startsWith("/operational_standups/roster/")) {
      return [{ profile: { uid: "p1", full_name: "Alice", email: "" }, entry: null, can_edit: true, can_approve: false, org_uid: "o", org_name: "4D" }];
    }
    return [];
  }),
  ws: { subscribe: () => () => {} },
}));

describe("useOperationalStandups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads month entries on mount", async () => {
    const { result } = renderHook(() =>
      useOperationalStandups({ month: "2026-05" }),
    );
    await waitFor(() => expect(result.current.standups.length).toBe(1));
  });

  it("loads roster for a date when requested", async () => {
    const { result } = renderHook(() =>
      useOperationalStandups({ month: "2026-05", rosterDate: "2026-05-04" }),
    );
    await waitFor(() => expect(result.current.roster.length).toBe(1));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npm test -- operationalStandups.smoke`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `frontend/task-tracker/src/hooks/useOperationalStandups.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type {
  OperationalStandupDto,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface UseOperationalStandupsArgs {
  month: string; // YYYY-MM
  rosterDate?: string; // YYYY-MM-DD — when set, also fetches roster
}

export interface UseOperationalStandupsResult {
  standups: OperationalStandupDto[];
  roster: OperationalStandupRosterRow[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useOperationalStandups({
  month,
  rosterDate,
}: UseOperationalStandupsArgs): UseOperationalStandupsResult {
  const [standups, setStandups] = useState<OperationalStandupDto[]>([]);
  const [roster, setRoster] = useState<OperationalStandupRosterRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        apiGet<OperationalStandupDto[]>(
          `/operational_standups/?month=${encodeURIComponent(month)}`,
        ),
        rosterDate
          ? apiGet<OperationalStandupRosterRow[]>(
              `/operational_standups/roster/?date=${encodeURIComponent(rosterDate)}`,
            )
          : Promise.resolve<OperationalStandupRosterRow[]>([]),
      ]);
      setStandups(results[0]);
      setRoster(results[1]);
    } finally {
      setLoading(false);
    }
  }, [month, rosterDate]);

  useEffect(() => {
    void refresh();
    const unsubscribe = ws.subscribe<OperationalStandupDto>(
      "pace-operational-standups",
      () => {
        void refresh();
      },
    );
    return unsubscribe;
  }, [refresh]);

  return { standups, roster, loading, refresh };
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend/task-tracker && npm test -- operationalStandups.smoke`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/hooks/useOperationalStandups.ts \
        frontend/task-tracker/src/__tests__/hooks/operationalStandups.smoke.test.ts
git commit -m "feat(pace): useOperationalStandups hook (list + roster + ws sub)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Frontend — `useOperationalStandupsBadge` hook + nav wiring

**Files:**
- Create: `frontend/task-tracker/src/hooks/useOperationalStandupsBadge.ts`
- Modify: `frontend/task-tracker/src/components/header/NavMenu.tsx` (add `paceBadgeCount` prop)
- Modify: `frontend/task-tracker/src/pages/PacePage.tsx` (forward badge to sub-tab + use hook)
- Modify: `frontend/task-tracker/src/components/layout/Header.tsx` (or equivalent — wire the hook to NavMenu)

- [ ] **Step 1: Write a failing smoke test for the badge hook**

Create `frontend/task-tracker/src/__tests__/hooks/operationalStandupsBadge.smoke.test.ts`:

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOperationalStandupsBadge } from "@/hooks/useOperationalStandupsBadge";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async () => ({ count: 3 })),
  ws: { subscribe: () => () => {} },
}));

describe("useOperationalStandupsBadge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the pending count from the API", async () => {
    const { result } = renderHook(() => useOperationalStandupsBadge());
    await waitFor(() => expect(result.current).toBe(3));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npm test -- operationalStandupsBadge.smoke`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the badge hook**

Create `frontend/task-tracker/src/hooks/useOperationalStandupsBadge.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { PendingCountResponse } from "@/types/api";

export function useOperationalStandupsBadge(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await apiGet<PendingCountResponse>(
        "/operational_standups/pending_count/",
      );
      setCount(r.count);
    } catch {
      // Auth/network errors — leave count at 0; nav menu stays clean.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = ws.subscribe("pace-operational-standups", () => {
      void refresh();
    });
    return unsubscribe;
  }, [refresh]);

  return count;
}
```

- [ ] **Step 4: Wire into NavMenu**

In `frontend/task-tracker/src/components/header/NavMenu.tsx`:

1. Add `paceBadgeCount?: number;` to `NavMenuProps`.
2. Accept it as a prop in the function signature.
3. Apply it to the PACE tab — find the `{ id: "pace", label: "PACE", icon: icons.pacecheck },` line and replace with:

```tsx
      { id: "pace", label: "PACE", icon: icons.pacecheck, badge: paceBadgeCount },
```

4. If the existing `NavTab` type doesn't have a `badge` field, follow the existing pattern used for `clientsBadgeCount` / `kaizenBadgeCount` — they already plumb through. Reuse that exact mechanism (search for `clientsBadgeCount` in the file to see how it's wired, then mirror it for `paceBadgeCount`).

- [ ] **Step 5: Wire into Header**

In `frontend/task-tracker/src/components/layout/Header.tsx` (or wherever NavMenu is rendered): import and call `useOperationalStandupsBadge()`, pass result as `paceBadgeCount`. Mirror how `useClientsBadgeCounts` / `useKaizenPendingBadge` are wired.

- [ ] **Step 6: Run tests**

```bash
cd frontend/task-tracker && npm test -- operationalStandupsBadge.smoke
cd frontend/task-tracker && npm run typecheck
```

Expected: PASS for both.

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/hooks/useOperationalStandupsBadge.ts \
        frontend/task-tracker/src/__tests__/hooks/operationalStandupsBadge.smoke.test.ts \
        frontend/task-tracker/src/components/header/NavMenu.tsx \
        frontend/task-tracker/src/components/layout/Header.tsx
git commit -m "feat(pace): pending-count badge wired to PACE nav tab

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Frontend — `DailyStandupRow` component

**Files:**
- Create: `frontend/task-tracker/src/components/pace/DailyStandupRow.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupRow.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/task-tracker/src/__tests__/components/pace/dailyStandupRow.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DailyStandupRow } from "@/components/pace/DailyStandupRow";
import type { OperationalStandupRosterRow } from "@/types/api";

const baseRow: OperationalStandupRosterRow = {
  profile: { id: 1, uid: "p1", full_name: "Alice", email: "a@x.com" },
  org_uid: "o1",
  org_name: "4D",
  entry: null,
  can_edit: true,
  can_approve: false,
};

describe("DailyStandupRow", () => {
  it("shows 'Not submitted' for placeholder row", () => {
    render(
      <DailyStandupRow
        row={baseRow}
        onSave={vi.fn()}
        onApprove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Not submitted/i)).toBeInTheDocument();
  });

  it("renders entry priorities when present", () => {
    const row = {
      ...baseRow,
      entry: {
        id: 1, uid: "e1", org_uid: "o1", profile: "p1",
        profile_detail: baseRow.profile,
        standup_date: "2026-05-04",
        breakthrough_type: "Breakthrough" as const,
        priorities: "Ship release",
        collaboration_need: "",
        remarks: "",
        status: "Pending" as const,
        created_by_detail: null, approved_by_detail: null,
        approved_at: null, created_at: "", updated_at: "",
      },
    };
    render(
      <DailyStandupRow row={row} onSave={vi.fn()} onApprove={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Ship release")).toBeInTheDocument();
  });

  it("calls onApprove when Approve clicked on a pending row", async () => {
    const onApprove = vi.fn();
    const row = {
      ...baseRow,
      can_approve: true,
      entry: {
        id: 1, uid: "e1", org_uid: "o1", profile: "p1",
        profile_detail: baseRow.profile,
        standup_date: "2026-05-04",
        breakthrough_type: "" as const,
        priorities: "x", collaboration_need: "", remarks: "",
        status: "Pending" as const,
        created_by_detail: null, approved_by_detail: null,
        approved_at: null, created_at: "", updated_at: "",
      },
    };
    render(<DailyStandupRow row={row} onSave={vi.fn()} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("e1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npm test -- dailyStandupRow`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the row component**

Create `frontend/task-tracker/src/components/pace/DailyStandupRow.tsx`:

```tsx
import { useState, useEffect } from "react";
import type {
  BreakthroughTypeValue,
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface DailyStandupRowProps {
  row: OperationalStandupRosterRow;
  onSave: (
    payload: OperationalStandupCreate | Partial<OperationalStandupCreate>,
    rowUid: string | null,
  ) => Promise<void>;
  onApprove: (rowUid: string) => Promise<void>;
}

export function DailyStandupRow({ row, onSave, onApprove }: DailyStandupRowProps) {
  const e = row.entry;
  const [breakthroughType, setBreakthroughType] = useState<BreakthroughTypeValue>(
    e?.breakthrough_type ?? "",
  );
  const [priorities, setPriorities] = useState(e?.priorities ?? "");
  const [collab, setCollab] = useState(e?.collaboration_need ?? "");
  const [remarks, setRemarks] = useState(e?.remarks ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setBreakthroughType(e?.breakthrough_type ?? "");
    setPriorities(e?.priorities ?? "");
    setCollab(e?.collaboration_need ?? "");
    setRemarks(e?.remarks ?? "");
    setDirty(false);
  }, [e?.uid]);

  const isPlaceholder = e === null;
  const locked = !row.can_edit;

  // Debounced save: 600ms after the last change.
  useEffect(() => {
    if (!dirty || locked) return;
    const t = setTimeout(() => {
      const payload: OperationalStandupCreate = {
        profile: row.profile.uid,
        org: row.org_uid,
        standup_date: e?.standup_date ?? "",  // parent provides for placeholders via wrapping
        breakthrough_type: breakthroughType,
        priorities,
        collaboration_need: collab,
        remarks,
      };
      void onSave(payload, e?.uid ?? null);
      setDirty(false);
    }, 600);
    return () => clearTimeout(t);
  }, [dirty, breakthroughType, priorities, collab, remarks, locked, e, row, onSave]);

  const cellS: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 12,
    verticalAlign: "top",
  };

  return (
    <tr style={{ background: isPlaceholder ? "#f8fafc" : "#fff" }}>
      <td style={cellS}>{row.profile.full_name}</td>
      <td style={cellS}>
        {isPlaceholder ? (
          <span style={{ color: "#94a3b8" }}>—</span>
        ) : (
          <select
            disabled={locked}
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
        )}
      </td>
      <td style={cellS}>
        {isPlaceholder ? (
          <span style={{ color: "#94a3b8" }}>Not submitted</span>
        ) : (
          <textarea
            disabled={locked}
            value={priorities}
            onChange={(ev) => {
              setPriorities(ev.target.value);
              setDirty(true);
            }}
            placeholder="Top priorities for the day…"
            style={{ width: "100%", minHeight: 40, fontSize: 12, padding: 4, resize: "vertical" }}
          />
        )}
      </td>
      <td style={cellS}>
        {isPlaceholder ? "—" : (
          <input
            disabled={locked}
            value={collab}
            onChange={(ev) => { setCollab(ev.target.value); setDirty(true); }}
            placeholder="Collaboration need…"
            style={{ width: "100%", fontSize: 12, padding: 4 }}
          />
        )}
      </td>
      <td style={cellS}>
        {isPlaceholder ? "—" : (
          <input
            disabled={locked}
            value={remarks}
            onChange={(ev) => { setRemarks(ev.target.value); setDirty(true); }}
            placeholder="Remarks…"
            style={{ width: "100%", fontSize: 12, padding: 4 }}
          />
        )}
      </td>
      <td style={cellS}>
        {e?.status === "Approved" && e.approved_by_detail
          ? e.approved_by_detail.full_name
          : e?.created_by_detail?.full_name ?? "—"}
      </td>
      <td style={cellS}>
        {e ? (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              background: e.status === "Approved" ? "#f0fdf4" : "#fef3c7",
              color: e.status === "Approved" ? "#16a34a" : "#d97706",
            }}
          >
            {e.status}
          </span>
        ) : (
          <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
        )}
      </td>
      <td style={cellS}>
        {e && e.status === "Pending" && row.can_approve && (
          <button
            onClick={() => void onApprove(e.uid)}
            style={{
              padding: "3px 10px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            Approve
          </button>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend/task-tracker && npm test -- dailyStandupRow`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/pace/DailyStandupRow.tsx \
        frontend/task-tracker/src/__tests__/components/pace/dailyStandupRow.test.tsx
git commit -m "feat(pace): DailyStandupRow inline-editable row component

Renders one employee's standup as a table row with inline-edit and
debounced auto-save. Placeholder row shown for non-submitters; Approve
button shown to authorized approvers on Pending rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Frontend — `DailyStandupDateSection` component

**Files:**
- Create: `frontend/task-tracker/src/components/pace/DailyStandupDateSection.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupDateSection.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/task-tracker/src/__tests__/components/pace/dailyStandupDateSection.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DailyStandupDateSection } from "@/components/pace/DailyStandupDateSection";

const profile = { id: 1, uid: "p1", full_name: "Alice", email: "" };
const row = {
  profile,
  org_uid: "o1",
  org_name: "4D",
  entry: null,
  can_edit: true,
  can_approve: false,
};

describe("DailyStandupDateSection", () => {
  it("collapses and expands on header click", () => {
    render(
      <DailyStandupDateSection
        date="2026-05-04"
        rows={[row]}
        defaultExpanded={false}
        canFinalReview={false}
        pendingCount={0}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onFinalReview={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2026-05-04/ }));
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("shows Final Review only when admin and pending > 0", () => {
    const { rerender } = render(
      <DailyStandupDateSection
        date="2026-05-04" rows={[row]} defaultExpanded
        canFinalReview={false} pendingCount={3}
        onSave={vi.fn()} onApprove={vi.fn()} onFinalReview={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /final review/i })).not.toBeInTheDocument();

    rerender(
      <DailyStandupDateSection
        date="2026-05-04" rows={[row]} defaultExpanded
        canFinalReview pendingCount={3}
        onSave={vi.fn()} onApprove={vi.fn()} onFinalReview={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /final review/i })).toBeInTheDocument();
  });

  it("calls onFinalReview when clicked", () => {
    const onFinalReview = vi.fn();
    render(
      <DailyStandupDateSection
        date="2026-05-04" rows={[row]} defaultExpanded
        canFinalReview pendingCount={2}
        onSave={vi.fn()} onApprove={vi.fn()} onFinalReview={onFinalReview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /final review/i }));
    expect(onFinalReview).toHaveBeenCalledWith("2026-05-04");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npm test -- dailyStandupDateSection`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the date section**

Create `frontend/task-tracker/src/components/pace/DailyStandupDateSection.tsx`:

```tsx
import { useState } from "react";
import { fmtDate } from "@/utils/date";
import { DailyStandupRow } from "./DailyStandupRow";
import type {
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface DailyStandupDateSectionProps {
  date: string; // YYYY-MM-DD
  rows: OperationalStandupRosterRow[];
  defaultExpanded: boolean;
  canFinalReview: boolean;
  pendingCount: number;
  onSave: (
    payload: OperationalStandupCreate | Partial<OperationalStandupCreate>,
    rowUid: string | null,
  ) => Promise<void>;
  onApprove: (rowUid: string) => Promise<void>;
  onFinalReview: (date: string) => Promise<void>;
}

export function DailyStandupDateSection({
  date, rows, defaultExpanded, canFinalReview, pendingCount,
  onSave, onApprove, onFinalReview,
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
        {canFinalReview && pendingCount > 0 && (
          <button
            onClick={() => void onFinalReview(date)}
            style={{
              padding: "6px 14px", background: "#2563eb", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer",
              fontSize: 12, fontWeight: 700,
            }}
          >
            Final Review
          </button>
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
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>By</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Status</th>
              <th style={{ padding: 6, fontSize: 11, color: "#475569" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <DailyStandupRow
                key={`${r.org_uid}-${r.profile.uid}`}
                row={r}
                onSave={(p, uid) => onSave({ ...p, standup_date: date }, uid)}
                onApprove={onApprove}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend/task-tracker && npm test -- dailyStandupDateSection`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/pace/DailyStandupDateSection.tsx \
        frontend/task-tracker/src/__tests__/components/pace/dailyStandupDateSection.test.tsx
git commit -m "feat(pace): DailyStandupDateSection collapsible per-date table

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Frontend — `DailyStandupAddModal` component

**Files:**
- Create: `frontend/task-tracker/src/components/pace/DailyStandupAddModal.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupAddModal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/task-tracker/src/__tests__/components/pace/dailyStandupAddModal.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DailyStandupAddModal } from "@/components/pace/DailyStandupAddModal";

describe("DailyStandupAddModal", () => {
  it("submits payload with selected employee and date", async () => {
    const onSubmit = vi.fn(async () => {});
    const profiles = [{ uid: "p1", full_name: "Alice" }];
    render(
      <DailyStandupAddModal
        date="2026-05-04"
        profiles={profiles}
        orgUid="o1"
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/employee/i), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(/priorities/i), { target: { value: "Ship it" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      profile: "p1",
      standup_date: "2026-05-04",
      priorities: "Ship it",
      org: "o1",
    }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npm test -- dailyStandupAddModal`
Expected: FAIL.

- [ ] **Step 3: Implement the modal**

Create `frontend/task-tracker/src/components/pace/DailyStandupAddModal.tsx`:

```tsx
import { useState } from "react";
import type {
  BreakthroughTypeValue,
  OperationalStandupCreate,
} from "@/types/api";

export interface DailyStandupAddModalProps {
  date: string;
  profiles: { uid: string; full_name: string }[];
  orgUid: string;
  onSubmit: (payload: OperationalStandupCreate) => Promise<void>;
  onClose: () => void;
}

export function DailyStandupAddModal({
  date, profiles, orgUid, onSubmit, onClose,
}: DailyStandupAddModalProps) {
  const [profile, setProfile] = useState("");
  const [d, setD] = useState(date);
  const [bt, setBt] = useState<BreakthroughTypeValue>("");
  const [priorities, setPriorities] = useState("");
  const [collab, setCollab] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!profile || !d) return;
    setSaving(true);
    try {
      await onSubmit({
        profile, org: orgUid, standup_date: d,
        breakthrough_type: bt, priorities,
        collaboration_need: collab, remarks,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, backdropFilter: "blur(3px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 12, padding: 20, width: 540, maxWidth: "94vw",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>
          ➕ Add Daily Standup
        </div>
        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Employee</div>
            <select
              aria-label="employee"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            >
              <option value="">— select —</option>
              {profiles.map((p) => (
                <option key={p.uid} value={p.uid}>{p.full_name}</option>
              ))}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Date</div>
            <input
              type="date" value={d}
              onChange={(e) => setD(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Breakdown / Breakthrough</div>
            <select
              value={bt}
              onChange={(e) => setBt(e.target.value as BreakthroughTypeValue)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            >
              <option value="">—</option>
              <option value="Breakdown">Breakdown</option>
              <option value="Breakthrough">Breakthrough</option>
            </select>
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Priorities</div>
            <textarea
              aria-label="priorities" value={priorities}
              onChange={(e) => setPriorities(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13, minHeight: 80 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Collaboration need</div>
            <input
              value={collab}
              onChange={(e) => setCollab(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>Remarks</div>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              style={{ width: "100%", padding: 6, fontSize: 13 }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 6 }}>
            Cancel
          </button>
          <button
            onClick={() => void handleSave()} disabled={saving || !profile}
            style={{
              padding: "8px 16px", background: "#2563eb", color: "#fff",
              border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend/task-tracker && npm test -- dailyStandupAddModal`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/pace/DailyStandupAddModal.tsx \
        frontend/task-tracker/src/__tests__/components/pace/dailyStandupAddModal.test.tsx
git commit -m "feat(pace): DailyStandupAddModal for manager/admin entry creation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Frontend — `RosterExcludePanel` component

**Files:**
- Create: `frontend/task-tracker/src/components/pace/RosterExcludePanel.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/pace/rosterExcludePanel.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/task-tracker/src/__tests__/components/pace/rosterExcludePanel.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RosterExcludePanel } from "@/components/pace/RosterExcludePanel";

describe("RosterExcludePanel", () => {
  it("calls onToggle with member uid", () => {
    const onToggle = vi.fn();
    render(
      <RosterExcludePanel
        memberships={[
          { membership_uid: "m1", user_uid: "u1", user_name: "Alice", excluded: false },
          { membership_uid: "m2", user_uid: "u2", user_name: "Bob",   excluded: true  },
        ]}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Alice/i));
    expect(onToggle).toHaveBeenCalledWith("m1", true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npm test -- rosterExcludePanel`
Expected: FAIL.

- [ ] **Step 3: Implement the panel**

Create `frontend/task-tracker/src/components/pace/RosterExcludePanel.tsx`:

```tsx
import { useState } from "react";

export interface RosterMembership {
  membership_uid: string;
  user_uid: string;
  user_name: string;
  excluded: boolean;
}

export interface RosterExcludePanelProps {
  memberships: RosterMembership[];
  onToggle: (membershipUid: string, nextExcluded: boolean) => void;
}

export function RosterExcludePanel({ memberships, onToggle }: RosterExcludePanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", padding: "8px 12px", background: "#f8fafc",
          border: "none", borderRadius: 8, textAlign: "left", cursor: "pointer",
          fontWeight: 700, fontSize: 12, color: "#475569",
        }}
      >
        {open ? "▾" : "▸"} Roster settings — exclude members from the standup grid
      </button>
      {open && (
        <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {memberships.map((m) => (
            <label
              key={m.membership_uid}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 10px", border: "1px solid #e2e8f0", borderRadius: 14,
                fontSize: 12, background: m.excluded ? "#fef3c7" : "#f8fafc",
              }}
            >
              <input
                type="checkbox"
                aria-label={m.user_name}
                checked={m.excluded}
                onChange={(e) => onToggle(m.membership_uid, e.target.checked)}
              />
              <span>{m.user_name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend/task-tracker && npm test -- rosterExcludePanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/pace/RosterExcludePanel.tsx \
        frontend/task-tracker/src/__tests__/components/pace/rosterExcludePanel.test.tsx
git commit -m "feat(pace): RosterExcludePanel for admin opt-out toggles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Frontend — `DailyStandupPage` page

**Files:**
- Create: `frontend/task-tracker/src/pages/DailyStandupPage.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx`

- [ ] **Step 1: Write smoke test**

Create `frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import DailyStandupPage from "@/pages/DailyStandupPage";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.startsWith("/operational_standups/?month=")) return [];
    if (url.startsWith("/operational_standups/roster/")) {
      return [{
        profile: { id: 1, uid: "u1", full_name: "Alice", email: "" },
        org_uid: "o1", org_name: "4D",
        entry: null, can_edit: true, can_approve: false,
      }];
    }
    return [];
  }),
  apiPost: vi.fn(async () => ({})),
  apiPatch: vi.fn(async () => ({})),
  ws: { subscribe: () => () => {} },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => false,
    isManagerInAny: () => false,
  }),
}));

describe("DailyStandupPage", () => {
  it("renders title and date sections", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByText(/Daily Standup/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npm test -- dailyStandupPage.smoke`
Expected: FAIL.

- [ ] **Step 3: Implement the page**

Create `frontend/task-tracker/src/pages/DailyStandupPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useOperationalStandups } from "@/hooks/useOperationalStandups";
import type { Profile } from "@/types";
import type {
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";
import { DailyStandupDateSection } from "@/components/pace/DailyStandupDateSection";
import { DailyStandupAddModal } from "@/components/pace/DailyStandupAddModal";

interface DailyStandupPageProps {
  profile: Profile | null;
  profiles?: Profile[];
  selectedOrg?: string;
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
  const canFinalReview = isAdmin;
  const canAdd = isAdmin || isManager;

  const [month, setMonth] = useState(currentMonth());
  const [showAdd, setShowAdd] = useState(false);

  const { standups, roster, refresh } = useOperationalStandups({
    month,
    rosterDate: todayISO(),
  });

  // Group standups by date for the older-dates sections.
  const dateGroups = useMemo(() => {
    const today = todayISO();
    const byDate = new Map<string, OperationalStandupRosterRow[]>();
    // Today gets the full roster (placeholders + entries).
    byDate.set(today, roster);
    // Earlier dates: only show submitted entries grouped.
    for (const s of standups) {
      if (s.standup_date === today) continue;
      const existing = byDate.get(s.standup_date) ?? [];
      existing.push({
        profile: s.profile_detail,
        org_uid: s.org_uid ?? "",
        org_name: "",
        entry: s,
        can_edit: isAdmin || isManager || s.profile_detail.uid === profile?.uid,
        can_approve: isAdmin || isManager,
      });
      byDate.set(s.standup_date, existing);
    }
    return Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [standups, roster, isAdmin, isManager, profile]);

  const today = todayISO();

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
    async (uid: string) => {
      await apiPost(`/operational_standups/${uid}/approve/`, {});
      await refresh();
    },
    [refresh],
  );

  const handleFinalReview = useCallback(
    async (date: string) => {
      if (!window.confirm(`Bulk-approve all pending standups for ${date}?`)) return;
      const orgUid = roster[0]?.org_uid ?? profile?.orgs?.[0]?.uid;
      if (!orgUid) {
        alert("Could not determine org for Final Review.");
        return;
      }
      await apiPost(`/operational_standups/bulk_approve/`, { date, org: orgUid });
      await refresh();
    },
    [roster, profile, refresh],
  );

  const orgUid = roster[0]?.org_uid ?? profile?.orgs?.[0]?.uid ?? "";
  const profileChoices = useMemo(
    () => (profiles ?? [])
      .map((p) => ({ uid: p.uid, full_name: p.full_name ?? p.email ?? "" }))
      .filter((p) => p.uid),
    [profiles],
  );

  // Stats
  const stats = useMemo(() => {
    const total = standups.length;
    const approved = standups.filter((s) => s.status === "Approved").length;
    const pending = standups.filter((s) => s.status === "Pending").length;
    const todayRoster = roster.length;
    const todaySubmitted = roster.filter((r) => r.entry !== null).length;
    return {
      total, approved, pending,
      notSubmittedToday: Math.max(0, todayRoster - todaySubmitted),
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
        const pendingCount = rows.filter((r) => r.entry?.status === "Pending").length;
        return (
          <DailyStandupDateSection
            key={date}
            date={date}
            rows={rows}
            defaultExpanded={date === today}
            canFinalReview={canFinalReview}
            pendingCount={pendingCount}
            onSave={handleSave}
            onApprove={handleApprove}
            onFinalReview={handleFinalReview}
          />
        );
      })}

      {showAdd && (
        <DailyStandupAddModal
          date={today}
          profiles={profileChoices}
          orgUid={orgUid}
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

- [ ] **Step 4: Run tests**

```bash
cd frontend/task-tracker && npm test -- dailyStandupPage.smoke
cd frontend/task-tracker && npm run typecheck
```

Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/pages/DailyStandupPage.tsx \
        frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx
git commit -m "feat(pace): DailyStandupPage assembling grid + stats + add modal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Frontend — Wire into PacePage + remove Operational from PaceMeetingsPage

**Files:**
- Modify: `frontend/task-tracker/src/pages/PacePage.tsx` (add `daily-standup` sub-tab)
- Modify: `frontend/task-tracker/src/pages/PaceMeetingsPage.tsx` (remove Operational button + filter option)
- Modify: `frontend/task-tracker/src/utils/paceMeetings.ts` (remove `Operational` from `MEETING_TYPES` array, keep type union for legacy data display)
- Test: existing tests + smoke

- [ ] **Step 1: Read current PacePage layout**

Run: `cat frontend/task-tracker/src/pages/PacePage.tsx`

- [ ] **Step 2: Add the new sub-tab to `PacePage`**

In `frontend/task-tracker/src/pages/PacePage.tsx`:

1. Add import at top: `import DailyStandupPage from "@/pages/DailyStandupPage";`
2. Add to the `tabs` array (place after `meetings`):
   ```typescript
   { id: "daily-standup", label: "Daily Standup" },
   ```
3. Add the conditional render:
   ```tsx
   {subTab === "daily-standup" && (
     <DailyStandupPage profile={profile} profiles={profiles} selectedOrg={selectedOrg} />
   )}
   ```
4. Forward props correctly — match the existing pattern used for `<PaceMeetingsPage>`.

- [ ] **Step 3: Remove Operational from `PaceMeetingsPage`**

In `frontend/task-tracker/src/pages/PaceMeetingsPage.tsx`:

1. Locate the `MEETING_TYPES.map((t) => { ... Schedule ${t}` block and filter out `"Operational"`:
   ```tsx
   {MEETING_TYPES.filter((t) => t !== "Operational").map((t) => {
   ```
2. In the type filter dropdown, similarly:
   ```tsx
   {MEETING_TYPES.filter((t) => t !== "Operational").map((t) => (
     <option key={t} value={t}>{t}</option>
   ))}
   ```

(Don't change `MEETING_TYPE_CHOICES` on the backend model — historical Operational rows still need to round-trip.)

- [ ] **Step 4: Run all relevant frontend tests + typecheck**

```bash
cd frontend/task-tracker && npm test
cd frontend/task-tracker && npm run typecheck
cd frontend/task-tracker && npm run build
```

Expected: all tests pass, typecheck clean, build succeeds.

- [ ] **Step 5: Manual smoke verification**

Start dev server and navigate to PACE → Daily Standup sub-tab. Verify:
- Today's date section is expanded with a "Not submitted" placeholder for each non-excluded org member.
- Switching to a manager/admin user shows the "+ Add Entry" button and (for admin) the "Final Review" button on the date header when ≥1 pending row exists.
- Switching to an employee user shows only their own row.
- The PACE nav tab shows a red badge when there's a pending standup.
- The Meetings sub-tab no longer shows "Schedule Operational" or "Operational" in the type filter.

Run:
```bash
cd frontend/task-tracker && npm run dev
```

Then exercise the page in a browser as described. If any check fails, iterate on it before continuing.

- [ ] **Step 6: Run the full backend test suite once more for regression**

Run: `python manage.py test core.pace -v 2`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/pages/PacePage.tsx \
        frontend/task-tracker/src/pages/PaceMeetingsPage.tsx
git commit -m "feat(pace): wire Daily Standup sub-tab; remove Operational from Meetings

PACE page gains a 'Daily Standup' sub-tab between Meetings and Goals.
PaceMeetingsPage no longer offers 'Schedule Operational' or filters
on the Operational type — the new daily standup grid replaces it.
Historical PaceMeeting rows of type Operational remain in the DB
but are not surfaced in the UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Plan self-review notes

- **Spec coverage:** every spec section maps to a task above (model→T1, exclude flag→T1, serializer→T2, scoping→T3, status auto-assign→T4, edit-after-approval→T5, roster→T6, approve+bulk_approve→T7, pending_count→T8, types→T9, list/roster hook→T10, badge→T11, row→T12, date section→T13, add modal→T14, exclude panel→T15, page→T16, integration→T17). Edge cases live in tests in T1, T4, T5, T7.
- **No placeholders:** all code blocks are concrete; commands have expected output; commit messages provided.
- **Type consistency:** `OperationalStandupDto`, `OperationalStandupCreate`, `OperationalStandupRosterRow`, `BreakthroughTypeValue` referenced consistently across T9–T17. Backend channel name `pace-operational-standups` consistent across T4/T5/T7 broadcasts and T10/T11 hooks.
- **Frontend testing utilities:** assumes `@testing-library/react`, `vitest`, and the existing `@/lib/api` mock surface — patterns mirror existing tests in `frontend/task-tracker/src/__tests__`.
- **Scope check:** single feature, single spec, ~17 tasks. Each task ends in a commit. Reasonable for one execution session.
