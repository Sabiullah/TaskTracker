# Main task + sub-tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Add Task modal with a Main Goal + Sub-tasks editor; introduce a self-FK on `Task` so existing rows are valid Mains automatically and dashboard/board/calendar views remain unchanged.

**Architecture:** Single `Task` table gains a nullable `parent` FK (CASCADE). A new `TaskWithSubtasksSerializer` upserts a Main + N Subs in one transaction, copying inheritance fields (`org`, `client`, `reporting_manager`, `recurrence`) onto each sub. Frontend rebuilds `TaskModal` into orchestrator + `MainGoalFields` + `SubtaskTable` (a row-editor grid) and routes every list/board click through the parent uid.

**Tech Stack:** Django 5 + DRF, React 18 + TypeScript + Vite, vitest, ruff, mypy, pyright.

**Spec:** [docs/superpowers/specs/2026-05-05-task-main-sub-design.md](../specs/2026-05-05-task-main-sub-design.md)

---

## Task 1: Add `parent` field and migration

**Files:**
- Modify: `core/tasks/models.py` (add field, update `clean`)
- Create: `core/tasks/migrations/0004_task_parent.py`

- [ ] **Step 1: Write failing model test for `parent` FK**

Replace the empty `core/tasks/tests.py` with:

```python
import datetime as dt
from django.test import TestCase
from django.core.exceptions import ValidationError

from core.masters.models import Master
from core.tasks.models import Task
from users.models import Org, OrgMembership, User


def _setup():
    org = Org.objects.create(name="Acme")
    user = User.objects.create_user(username="u1", password="pw", full_name="U One")
    OrgMembership.objects.create(user=user, org=org, role="admin")
    client = Master.objects.create(name="C1", type="client", org=org)
    return org, user, client


class TaskParentFieldTests(TestCase):
    def test_task_has_nullable_parent_defaulting_to_null(self):
        org, user, client = _setup()
        t = Task.objects.create(
            description="Main", org=org, client=client,
            reporting_manager=user, target_date=dt.date(2026, 6, 1),
        )
        self.assertIsNone(t.parent)

    def test_subtask_links_to_parent_via_parent_fk(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main", org=org, client=client,
            reporting_manager=user, target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sub", org=org, client=client,
            reporting_manager=user, responsible=user,
            parent=main, target_date=dt.date(2026, 5, 1),
        )
        self.assertEqual(sub.parent_id, main.pk)
        self.assertEqual(list(main.subtasks.all()), [sub])

    def test_deleting_main_cascades_to_subs(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main", org=org, reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub", org=org, reporting_manager=user,
            responsible=user, parent=main,
        )
        main.delete()
        self.assertEqual(Task.objects.count(), 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test core.tasks.tests.TaskParentFieldTests -v 2`

Expected: FAIL with `Task() got an unexpected keyword argument 'parent'`.

- [ ] **Step 3: Add `parent` field to model**

Edit `core/tasks/models.py` after the `created_by` field (around line 90):

```python
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="subtasks",
        db_index=True,
    )
```

- [ ] **Step 4: Generate migration**

Run: `python manage.py makemigrations tasks --name task_parent`

Expected output: `core/tasks/migrations/0004_task_parent.py` is created with `AddField` op for `parent`.

- [ ] **Step 5: Run migration on test DB & re-run tests**

Run: `python manage.py test core.tasks.tests.TaskParentFieldTests -v 2`

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add core/tasks/models.py core/tasks/migrations/0004_task_parent.py core/tasks/tests.py
git commit -m "feat(tasks): add parent FK for main/sub task grouping"
```

---

## Task 2: Validation — sub date cap, no grandchildren, main shrinkage

**Files:**
- Modify: `core/tasks/models.py` (extend `clean()`)
- Modify: `core/tasks/tests.py` (add validation tests)

- [ ] **Step 1: Write failing validation tests**

Append to `core/tasks/tests.py`:

```python
class TaskValidationTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client = _setup()
        self.main = Task.objects.create(
            description="Main", org=self.org, client=self.client,
            reporting_manager=self.user, target_date=dt.date(2026, 6, 1),
        )

    def test_sub_target_date_after_parent_target_is_rejected(self):
        sub = Task(
            description="Sub", org=self.org, client=self.client,
            reporting_manager=self.user, responsible=self.user,
            parent=self.main, target_date=dt.date(2026, 7, 1),
        )
        with self.assertRaises(ValidationError) as ctx:
            sub.full_clean()
        self.assertIn("main goal's target date", str(ctx.exception))

    def test_sub_target_date_on_or_before_parent_target_is_ok(self):
        sub = Task(
            description="Sub", org=self.org, client=self.client,
            reporting_manager=self.user, responsible=self.user,
            parent=self.main, target_date=dt.date(2026, 6, 1),
        )
        sub.full_clean()  # no exception

    def test_grandchild_is_rejected(self):
        sub = Task.objects.create(
            description="Sub", org=self.org, client=self.client,
            reporting_manager=self.user, responsible=self.user,
            parent=self.main,
        )
        grand = Task(
            description="Grand", org=self.org, client=self.client,
            reporting_manager=self.user, responsible=self.user,
            parent=sub,
        )
        with self.assertRaises(ValidationError) as ctx:
            grand.full_clean()
        self.assertIn("Sub-tasks cannot have sub-tasks", str(ctx.exception))

    def test_sub_expected_date_can_exceed_parent_target(self):
        # expected_date is a realistic estimate, not capped against parent.
        sub = Task(
            description="Sub", org=self.org, client=self.client,
            reporting_manager=self.user, responsible=self.user,
            parent=self.main,
            target_date=dt.date(2026, 5, 1),
            expected_date=dt.date(2026, 7, 15),
        )
        sub.full_clean()  # no exception
```

- [ ] **Step 2: Run to verify they fail**

Run: `python manage.py test core.tasks.tests.TaskValidationTests -v 2`

Expected: 3 of 4 tests FAIL (`test_sub_expected_date_can_exceed_parent_target` may pass since expected ≥ target only).

- [ ] **Step 3: Extend `Task.clean()`**

In `core/tasks/models.py`, replace the existing `clean` method:

```python
    def clean(self):
        if not (self.description or "").strip():
            raise ValidationError({"description": "Description is required."})
        if self.completed_date and self.status not in self.COMPLETED_STATUSES:
            raise ValidationError(
                "completed_date should only be set when status is completed or completed_delay."
            )
        if self.target_date and self.expected_date and self.expected_date < self.target_date:
            raise ValidationError("expected_date cannot be before target_date.")

        if self.parent_id is not None:
            parent = self.parent
            if parent is not None and parent.parent_id is not None:
                raise ValidationError("Sub-tasks cannot have sub-tasks (two levels max).")
            if (
                parent is not None
                and parent.target_date
                and self.target_date
                and self.target_date > parent.target_date
            ):
                raise ValidationError(
                    {
                        "target_date": (
                            f"Sub-task target date cannot be after the main goal's "
                            f"target date ({parent.target_date.isoformat()})."
                        )
                    }
                )
```

- [ ] **Step 4: Run validation tests**

Run: `python manage.py test core.tasks.tests.TaskValidationTests -v 2`

Expected: 4 tests PASS.

- [ ] **Step 5: Add main-shrinkage test**

Append to `core/tasks/tests.py`:

```python
class TaskMainShrinkageTests(TestCase):
    def test_moving_main_target_earlier_than_existing_subs_is_rejected(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main", org=org, client=client,
            reporting_manager=user, target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub1", org=org, client=client,
            reporting_manager=user, responsible=user, parent=main,
            target_date=dt.date(2026, 5, 28),
        )
        main.target_date = dt.date(2026, 5, 1)
        with self.assertRaises(ValidationError) as ctx:
            main.full_clean()
        self.assertIn("sub-task", str(ctx.exception).lower())
```

- [ ] **Step 6: Extend `clean()` for main-shrinkage**

Append inside `Task.clean()` after the sub-checks:

```python
        if self.parent_id is None and self.pk and self.target_date:
            late = list(
                self.subtasks.filter(target_date__gt=self.target_date)
                .values_list("serial_no", flat=True)
            )
            if late:
                joined = ", ".join(f"#{s}" for s in late if s is not None)
                raise ValidationError(
                    {
                        "target_date": (
                            f"Cannot move main target date earlier than sub-tasks: {joined}."
                        )
                    }
                )
```

- [ ] **Step 7: Run all task tests**

Run: `python manage.py test core.tasks -v 2`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add core/tasks/models.py core/tasks/tests.py
git commit -m "feat(tasks): validation rules for sub date cap and grandchildren"
```

---

## Task 3: `TaskWithSubtasksSerializer` — nested upsert

**Files:**
- Modify: `core/tasks/serializers.py`
- Modify: `core/tasks/tests.py`

- [ ] **Step 1: Write failing serializer create test**

Append to `core/tasks/tests.py`:

```python
from rest_framework.test import APIRequestFactory, force_authenticate


class TaskWithSubtasksSerializerTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.factory = APIRequestFactory()

    def _ctx(self):
        req = self.factory.post("/api/tasks/")
        force_authenticate(req, user=self.user)
        return {"request": req}

    def test_create_main_with_two_subs_in_one_transaction(self):
        from core.tasks.serializers import TaskWithSubtasksSerializer
        payload = {
            "description": "Main goal",
            "org": str(self.org.uid),
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "recurrence": "onetime",
            "subtasks": [
                {
                    "description": "Sub A", "responsible": str(self.user.uid),
                    "target_date": "2026-05-01",
                },
                {
                    "description": "Sub B", "responsible": str(self.user.uid),
                    "target_date": "2026-05-15",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(data=payload, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        main = s.save(created_by=self.user, org=self.org)
        self.assertEqual(Task.objects.count(), 3)
        subs = list(main.subtasks.order_by("target_date"))
        self.assertEqual(len(subs), 2)
        # Inheritance copied onto each sub
        self.assertEqual(subs[0].org_id, self.org.pk)
        self.assertEqual(subs[0].client_id, self.client_master.pk)
        self.assertEqual(subs[0].reporting_manager_id, self.user.pk)
        self.assertEqual(subs[0].recurrence, "onetime")
```

- [ ] **Step 2: Run to verify it fails**

Run: `python manage.py test core.tasks.tests.TaskWithSubtasksSerializerTests -v 2`

Expected: FAIL with `ImportError: cannot import name 'TaskWithSubtasksSerializer'`.

- [ ] **Step 3: Implement the serializer**

Append to `core/tasks/serializers.py`:

```python
class _SubtaskItemSerializer(serializers.ModelSerializer):
    """Sub-row payload — only the per-row fields are writable here.

    Inheritance fields (org, client, reporting_manager, recurrence) are
    copied from the parent at save time by ``TaskWithSubtasksSerializer``.
    """

    uid = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="category"),
        required=False, allow_null=True,
    )
    responsible = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False, allow_null=True,
    )

    def validate_description(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Sub-task description is required.")
        return value.strip()

    class Meta:
        model = Task
        fields = [
            "uid",
            "description",
            "category",
            "responsible",
            "target_date",
            "expected_date",
            "remarks",
        ]


class TaskWithSubtasksSerializer(TaskSerializer):
    """Wraps ``TaskSerializer`` to upsert a Main + N Subs atomically."""

    subtasks = _SubtaskItemSerializer(many=True, required=False)

    class Meta(TaskSerializer.Meta):
        fields = TaskSerializer.Meta.fields + ["subtasks"]
        read_only_fields = TaskSerializer.Meta.read_only_fields

    def _inheritance(self, main: "Task") -> dict:
        return {
            "org": main.org,
            "client": main.client,
            "reporting_manager": main.reporting_manager,
            "recurrence": main.recurrence,
        }

    def _upsert_subs(self, main: "Task", rows: list[dict]) -> None:
        from django.db import transaction
        keep_uids: set = set()
        inherit = self._inheritance(main)
        with transaction.atomic():
            for row in rows:
                uid = row.pop("uid", None)
                if uid:
                    sub = Task.objects.filter(uid=uid, parent=main).first()
                    if sub is None:
                        raise serializers.ValidationError(
                            {"subtasks": f"Sub uid {uid} does not belong to this goal."}
                        )
                    for k, v in row.items():
                        setattr(sub, k, v)
                    for k, v in inherit.items():
                        setattr(sub, k, v)
                    sub.full_clean()
                    sub.save()
                    keep_uids.add(str(sub.uid))
                else:
                    sub = Task(parent=main, **row, **inherit)
                    sub.full_clean()
                    sub.save()
                    keep_uids.add(str(sub.uid))
            # Delete subs no longer in payload
            (
                Task.objects.filter(parent=main)
                .exclude(uid__in=keep_uids)
                .delete()
            )

    def create(self, validated_data):
        subs = validated_data.pop("subtasks", [])
        from django.db import transaction
        with transaction.atomic():
            main = super().create(validated_data)
            if subs:
                self._upsert_subs(main, subs)
        return main

    def update(self, instance, validated_data):
        subs = validated_data.pop("subtasks", None)
        from django.db import transaction
        with transaction.atomic():
            main = super().update(instance, validated_data)
            if subs is not None:
                self._upsert_subs(main, subs)
            # Re-validate main vs subs after both have changed.
            main.full_clean()
        return main
```

- [ ] **Step 4: Run create test**

Run: `python manage.py test core.tasks.tests.TaskWithSubtasksSerializerTests.test_create_main_with_two_subs_in_one_transaction -v 2`

Expected: PASS.

- [ ] **Step 5: Add update tests**

Append to `TaskWithSubtasksSerializerTests`:

```python
    def test_update_replaces_subs_and_deletes_missing(self):
        from core.tasks.serializers import TaskWithSubtasksSerializer
        main = Task.objects.create(
            description="Main", org=self.org, client=self.client_master,
            reporting_manager=self.user, target_date=dt.date(2026, 6, 1),
        )
        keep = Task.objects.create(
            description="Keep", parent=main, org=self.org, client=self.client_master,
            reporting_manager=self.user, responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        Task.objects.create(
            description="Drop", parent=main, org=self.org, client=self.client_master,
            reporting_manager=self.user, responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        payload = {
            "description": "Main",
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "subtasks": [
                {"uid": str(keep.uid), "description": "Keep edited",
                 "responsible": str(self.user.uid), "target_date": "2026-05-10"},
                {"description": "New", "responsible": str(self.user.uid),
                 "target_date": "2026-05-20"},
            ],
        }
        s = TaskWithSubtasksSerializer(instance=main, data=payload,
                                       partial=True, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        subs = list(main.subtasks.order_by("description"))
        self.assertEqual([s.description for s in subs], ["Keep edited", "New"])

    def test_create_rejects_sub_target_after_main_target(self):
        from core.tasks.serializers import TaskWithSubtasksSerializer
        payload = {
            "description": "Main",
            "org": str(self.org.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "subtasks": [
                {"description": "Late sub", "responsible": str(self.user.uid),
                 "target_date": "2026-07-01"},
            ],
        }
        s = TaskWithSubtasksSerializer(data=payload, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        with self.assertRaises(ValidationError) as ctx:
            s.save(created_by=self.user, org=self.org)
        self.assertIn("main goal's target date", str(ctx.exception))
```

- [ ] **Step 6: Run all tests**

Run: `python manage.py test core.tasks -v 2`

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add core/tasks/serializers.py core/tasks/tests.py
git commit -m "feat(tasks): TaskWithSubtasksSerializer for nested upsert"
```

---

## Task 4: Wire serializer into the view

**Files:**
- Modify: `core/tasks/views.py`
- Modify: `core/tasks/tests.py`

- [ ] **Step 1: Write failing API test for nested POST**

Append to `core/tasks/tests.py`:

```python
from rest_framework.test import APIClient


class TaskWithSubtasksApiTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_post_with_subtasks_creates_full_tree(self):
        payload = {
            "description": "Main goal",
            "org": str(self.org.uid),
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "recurrence": "onetime",
            "subtasks": [
                {"description": "S1", "responsible": str(self.user.uid),
                 "target_date": "2026-05-01"},
            ],
        }
        res = self.api.post("/api/tasks/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Task.objects.count(), 2)
        main = Task.objects.get(parent__isnull=True)
        self.assertEqual(main.subtasks.count(), 1)

    def test_patch_main_updates_tree(self):
        main = Task.objects.create(
            description="Main", org=self.org, client=self.client_master,
            reporting_manager=self.user, target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Old sub", org=self.org, client=self.client_master,
            reporting_manager=self.user, responsible=self.user, parent=main,
            target_date=dt.date(2026, 5, 1),
        )
        payload = {
            "description": "Main edited",
            "subtasks": [
                {"description": "New sub", "responsible": str(self.user.uid),
                 "target_date": "2026-05-15"},
            ],
        }
        res = self.api.patch(f"/api/tasks/{main.uid}/", payload, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        main.refresh_from_db()
        self.assertEqual(main.description, "Main edited")
        subs = list(main.subtasks.all())
        self.assertEqual(len(subs), 1)
        self.assertEqual(subs[0].description, "New sub")
```

- [ ] **Step 2: Run — expect 4xx (missing serializer wiring)**

Run: `python manage.py test core.tasks.tests.TaskWithSubtasksApiTests -v 2`

Expected: tests fail because `subtasks` is silently dropped (default serializer ignores the key).

- [ ] **Step 3: Switch serializer per request shape**

Edit `core/tasks/views.py` — replace the `serializer_class = TaskSerializer` line with:

```python
    def get_serializer_class(self):
        # Use the nested serializer when the request includes a subtasks
        # array; otherwise fall back to the flat serializer so single-row
        # endpoints (board quick-edits, dashboard inline patches) keep
        # working unchanged.
        body = getattr(self.request, "data", None)
        if isinstance(body, dict) and "subtasks" in body:
            return TaskWithSubtasksSerializer
        return TaskSerializer
```

Add the import at the top of the file:

```python
from .serializers import TaskLogSerializer, TaskSerializer, TaskWithSubtasksSerializer
```

- [ ] **Step 4: Run API tests**

Run: `python manage.py test core.tasks.tests.TaskWithSubtasksApiTests -v 2`

Expected: 2 tests PASS.

- [ ] **Step 5: Verify single-row endpoint still works**

Append to `TaskWithSubtasksApiTests`:

```python
    def test_flat_post_without_subtasks_uses_flat_serializer(self):
        payload = {
            "description": "Standalone",
            "org": str(self.org.uid),
            "reporting_manager": str(self.user.uid),
        }
        res = self.api.post("/api/tasks/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Task.objects.count(), 1)
```

Run: `python manage.py test core.tasks.tests.TaskWithSubtasksApiTests -v 2`

Expected: 3 tests PASS.

- [ ] **Step 6: Lint backend**

Run: `ruff check core/tasks/ && ruff format --check core/tasks/`

If format complaints, run `ruff format core/tasks/` and re-stage.

- [ ] **Step 7: Type check backend**

Run: `mypy core/tasks/ && pyright core/tasks/`

Expected: clean. Fix any issues by adding type hints inline.

- [ ] **Step 8: Commit**

```bash
git add core/tasks/views.py core/tasks/tests.py
git commit -m "feat(tasks): nested-aware serializer dispatch on TaskViewSet"
```

---

## Task 5: Frontend — DTO & domain types

**Files:**
- Modify: `frontend/task-tracker/src/types/api/task.ts`
- Modify: `frontend/task-tracker/src/types/task.ts`

- [ ] **Step 1: Add `parent` to `TaskDto` and `TaskCreate`**

Edit `frontend/task-tracker/src/types/api/task.ts` — inside `TaskDto`, add:

```typescript
  readonly parent: Uid | null;
```

Inside `TaskCreate`, add:

```typescript
  readonly parent?: Uid | null;
```

Append a new sub item type and tree-create payload at end of file:

```typescript
/** One sub-row inside a goal-level create/update body. */
export interface SubtaskItemDto {
  readonly uid?: Uid;
  readonly description: string;
  readonly category?: Uid | null;
  readonly responsible?: Uid | null;
  readonly target_date?: IsoDate | null;
  readonly expected_date?: IsoDate | null;
  readonly remarks?: string;
}

/** Body for `POST/PATCH /api/tasks/` when sending a Main + Subs tree. */
export interface TaskWithSubtasksCreate extends TaskCreate {
  readonly subtasks: readonly SubtaskItemDto[];
}
```

- [ ] **Step 2: Add `parentId` and `subtasks` to domain `Task`**

Edit `frontend/task-tracker/src/types/task.ts` — add to `Task`:

```typescript
  parentId: ID | null;
```

Add a new sub item domain type at end of file:

```typescript
export interface SubtaskItem {
  id: ID | null; // null for unsaved rows
  description: string;
  category: string;
  responsible: string;
  targetDate: DateString;
  expectedDate: DateString;
  remarks: string;
}
```

- [ ] **Step 3: Verify type compile**

Run: `cd frontend/task-tracker && npx tsc -b`

Expected: errors in `mappers.ts` for the missing `parentId` field. Continue to Task 6 to fix.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/types/api/task.ts frontend/task-tracker/src/types/task.ts
git commit -m "feat(types): parent and subtasks shape on TaskDto/Task"
```

---

## Task 6: Frontend — mappers

**Files:**
- Modify: `frontend/task-tracker/src/lib/api/mappers.ts`

- [ ] **Step 1: Add `parentId` to `dtoToTask`**

In `frontend/task-tracker/src/lib/api/mappers.ts`, inside `dtoToTask`, add:

```typescript
    parentId: dto.parent ?? null,
```

- [ ] **Step 2: Add `taskWithSubtasksToCreate`**

Append to `mappers.ts`:

```typescript
import type {
  SubtaskItemDto,
  TaskWithSubtasksCreate,
} from "@/types/api/task";
import type { SubtaskItem } from "@/types";

export interface SubtaskWriteRefs {
  readonly responsibleByName: Readonly<Record<string, string>>;
  readonly categoryByName: Readonly<Record<string, string>>;
}

export function subtaskToDto(
  sub: SubtaskItem,
  refs: SubtaskWriteRefs,
): SubtaskItemDto {
  return {
    uid: sub.id ?? undefined,
    description: sub.description,
    category: refs.categoryByName[sub.category] ?? null,
    responsible: refs.responsibleByName[sub.responsible] ?? null,
    target_date: sub.targetDate || null,
    expected_date: sub.expectedDate || null,
    remarks: sub.remarks,
  };
}

export function taskWithSubtasksToCreate(
  task: Task,
  subs: readonly SubtaskItem[],
  refs: TaskWriteRefs,
  subRefs: SubtaskWriteRefs,
): TaskWithSubtasksCreate {
  return {
    ...taskToCreate(task, refs),
    subtasks: subs.map((s) => subtaskToDto(s, subRefs)),
  };
}
```

- [ ] **Step 3: Type check**

Run: `cd frontend/task-tracker && npx tsc -b`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/lib/api/mappers.ts
git commit -m "feat(api): mappers for nested goal create/update"
```

---

## Task 7: `SubtaskTable` component

**Files:**
- Create: `frontend/task-tracker/src/components/board/SubtaskTable.tsx`
- Create: `frontend/task-tracker/src/components/board/SubtaskTable.test.tsx`

- [ ] **Step 1: Write failing component test**

Create `frontend/task-tracker/src/components/board/SubtaskTable.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SubtaskTable from "./SubtaskTable";
import type { SubtaskItem } from "@/types";

const empty: SubtaskItem = {
  id: null, description: "", category: "", responsible: "",
  targetDate: "", expectedDate: "", remarks: "",
};

describe("SubtaskTable", () => {
  it("renders one row per sub and an Add button", () => {
    const subs: SubtaskItem[] = [
      { ...empty, description: "First" },
      { ...empty, description: "Second" },
    ];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={[]}
        mainTargetDate="2026-06-01"
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3); // header + 2
    expect(screen.getByText(/\+ Add subtask/i)).toBeInTheDocument();
  });

  it("calls onChange with appended row when Add is clicked", () => {
    const onChange = vi.fn();
    render(
      <SubtaskTable
        subs={[]}
        categories={[]}
        members={[]}
        mainTargetDate=""
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/\+ Add subtask/i));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: null })]);
  });

  it("flags a sub target date past the main target date", () => {
    const subs: SubtaskItem[] = [{ ...empty, description: "Late", targetDate: "2026-07-01" }];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={[]}
        mainTargetDate="2026-06-01"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/cannot be after the main/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend/task-tracker && npx vitest run src/components/board/SubtaskTable.test.tsx`

Expected: FAIL — `Cannot find module './SubtaskTable'`.

- [ ] **Step 3: Implement `SubtaskTable.tsx`**

Create `frontend/task-tracker/src/components/board/SubtaskTable.tsx`:

```typescript
import type { SubtaskItem } from "@/types";

interface Props {
  subs: readonly SubtaskItem[];
  categories: readonly string[];
  members: readonly string[];
  /** ISO date string (YYYY-MM-DD) or empty. Caps each sub's target. */
  mainTargetDate: string;
  onChange: (next: SubtaskItem[]) => void;
}

const EMPTY_SUB: SubtaskItem = {
  id: null,
  description: "",
  category: "",
  responsible: "",
  targetDate: "",
  expectedDate: "",
  remarks: "",
};

export default function SubtaskTable({
  subs,
  categories,
  members,
  mainTargetDate,
  onChange,
}: Props) {
  const updateAt = (idx: number, patch: Partial<SubtaskItem>) => {
    const next = subs.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange([...next]);
  };
  const removeAt = (idx: number) => {
    const row = subs[idx];
    if (row.id && !window.confirm("Remove this saved sub-task? It will be deleted on save.")) return;
    onChange(subs.filter((_, i) => i !== idx));
  };
  const addRow = () => onChange([...subs, { ...EMPTY_SUB }]);

  const violatesMain = (d: string) =>
    !!d && !!mainTargetDate && d > mainTargetDate;
  const violatesExpected = (s: SubtaskItem) =>
    !!s.targetDate && !!s.expectedDate && s.expectedDate < s.targetDate;

  return (
    <div className="subtask-section">
      <div className="subtask-head">
        <strong>SUBTASKS ({subs.length})</strong>
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          + Add subtask
        </button>
      </div>
      <table className="subtask-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Description *</th>
            <th>Owner *</th>
            <th>Target *</th>
            <th>Expected</th>
            <th>Remarks</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {subs.map((s, i) => {
            const dateErr = violatesMain(s.targetDate);
            const expErr = violatesExpected(s);
            return (
              <tr key={i}>
                <td>
                  <select
                    value={s.category}
                    onChange={(e) => updateAt(i, { category: e.target.value })}
                  >
                    <option value="">—</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={s.description}
                    onChange={(e) => updateAt(i, { description: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={s.responsible}
                    onChange={(e) => updateAt(i, { responsible: e.target.value })}
                  >
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="date"
                    value={s.targetDate}
                    max={mainTargetDate || undefined}
                    onChange={(e) => updateAt(i, { targetDate: e.target.value })}
                    style={dateErr ? { borderColor: "#dc2626" } : undefined}
                  />
                  {dateErr && (
                    <div className="subtask-err">
                      Sub-task target date cannot be after the main goal's target date.
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="date"
                    value={s.expectedDate}
                    onChange={(e) => updateAt(i, { expectedDate: e.target.value })}
                    style={expErr ? { borderColor: "#dc2626" } : undefined}
                  />
                  {expErr && (
                    <div className="subtask-err">
                      Expected cannot be before target.
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="text"
                    value={s.remarks}
                    onChange={(e) => updateAt(i, { remarks: e.target.value })}
                  />
                </td>
                <td>
                  <button type="button" className="btn-icon" onClick={() => removeAt(i)} aria-label="Remove">
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function hasSubErrors(subs: readonly SubtaskItem[], mainTargetDate: string): boolean {
  return subs.some(
    (s) =>
      (!!s.targetDate && !!mainTargetDate && s.targetDate > mainTargetDate) ||
      (!!s.targetDate && !!s.expectedDate && s.expectedDate < s.targetDate),
  );
}
```

- [ ] **Step 4: Add minimal CSS**

Append to `frontend/task-tracker/src/styles/index.css` (or the existing modal stylesheet — find with `grep -l "modal-foot" frontend/task-tracker/src/`):

```css
.subtask-section { margin-top: 16px; }
.subtask-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.subtask-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.subtask-table th { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--border, #e5e7eb); }
.subtask-table td { padding: 4px; vertical-align: top; }
.subtask-table input, .subtask-table select { width: 100%; }
.subtask-err { color: #dc2626; font-size: 11px; margin-top: 2px; }
.btn-icon { background: transparent; border: 0; cursor: pointer; padding: 4px; }
@media (max-width: 720px) {
  .subtask-table thead { display: none; }
  .subtask-table tr { display: block; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; padding: 6px; margin-bottom: 8px; }
  .subtask-table td { display: block; padding: 2px 0; }
}
```

- [ ] **Step 5: Run tests**

Run: `cd frontend/task-tracker && npx vitest run src/components/board/SubtaskTable.test.tsx`

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/components/board/SubtaskTable.tsx frontend/task-tracker/src/components/board/SubtaskTable.test.tsx frontend/task-tracker/src/styles/index.css
git commit -m "feat(board): SubtaskTable component with date-cap validation"
```

---

## Task 8: `MainGoalFields` component (extract from `TaskFormFields`)

**Files:**
- Create: `frontend/task-tracker/src/components/board/MainGoalFields.tsx`
- Modify: `frontend/task-tracker/src/components/board/TaskFormFields.tsx` (still used elsewhere — keep)

- [ ] **Step 1: Create `MainGoalFields.tsx` mirroring `TaskFormFields`**

The new component is a thin wrapper around `TaskFormFields` (the existing layout is a perfect Main-fields panel — every field lives at the Main level per the spec). Create `frontend/task-tracker/src/components/board/MainGoalFields.tsx`:

```typescript
import TaskFormFields from "./TaskFormFields";
import type { OrgOption } from "./TaskFormFields";
import type { MasterEntry } from "@/utils/masters";

interface FormState {
  client: string;
  category: string;
  description: string;
  status: string;
  targetDate: string;
  expectedDate: string;
  completedDate: string;
  responsible: string;
  reportingManager: string;
  remarks: string;
  recurrence: string;
  organization: string;
}

interface Props {
  form: FormState;
  orgs: readonly OrgOption[];
  filteredClients: string[];
  categories: string[];
  members: string[];
  clientObjects: MasterEntry[];
  set: (k: string, v: unknown) => void;
  onOrgChange: (orgUid: string) => void;
  onClientChange: (client: string) => void;
  isCreate?: boolean;
}

export default function MainGoalFields(props: Props) {
  // Wrapping rather than duplicating keeps a single source of layout for
  // the Main panel; if we later want Main-only field tweaks (e.g., hide
  // Completed Date when subs exist), do it here without forking.
  return <TaskFormFields {...props} />;
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend/task-tracker && npx tsc -b`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/board/MainGoalFields.tsx
git commit -m "feat(board): MainGoalFields wrapper for the goal modal"
```

---

## Task 9: Rebuild `TaskModal` to orchestrate Main + Subs

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`

- [ ] **Step 1: Update `TaskModalProps` for the tree shape**

Replace contents of `frontend/task-tracker/src/components/board/TaskModal.tsx` with:

```typescript
import { useState, useEffect, useMemo } from "react";
import { useMasters } from "@/hooks/useMasters";
import { useProfiles } from "@/hooks/useProfiles";
import { useAuth } from "@/hooks/useAuth";
import MainGoalFields from "./MainGoalFields";
import SubtaskTable, { hasSubErrors } from "./SubtaskTable";
import type { OrgOption } from "./TaskFormFields";
import type { Task, SubtaskItem } from "@/types";

export interface TaskModalProps {
  task?: Partial<Task> | null;
  /** When opening from a sub-row, which sub uid to scroll to. */
  focusSubId?: string | null;
  /** Existing subs of the goal being edited (already loaded by caller). */
  initialSubs?: readonly SubtaskItem[];
  defaultStatus?: string;
  onSave: (
    main: Partial<Task> & { id?: string },
    subs: SubtaskItem[],
  ) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

const EMPTY = {
  client: "", category: "", description: "", status: "Pending",
  targetDate: "", expectedDate: "", completedDate: "",
  responsible: "", reportingManager: "", remarks: "", recurrence: "Onetime", organization: "",
};

export default function TaskModal({
  task,
  focusSubId = null,
  initialSubs = [],
  defaultStatus,
  onSave,
  onClose,
  onDelete,
}: TaskModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [subs, setSubs] = useState<SubtaskItem[]>([]);

  const { orgs: myOrgs } = useAuth();
  const orgs = useMemo<OrgOption[]>(
    () => myOrgs.map((o) => ({ uid: o.uid, name: o.name })),
    [myOrgs],
  );

  const { clients: clientMasters, cats: catMasters } = useMasters();
  const { profiles } = useProfiles();
  const clientObjects = useMemo(
    () =>
      clientMasters
        .map((c) => ({
          name: c.name,
          orgs: c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clientMasters],
  );
  const categories = useMemo(
    () => [...new Set(catMasters.map((c) => c.name))].sort((a, b) => a.localeCompare(b)),
    [catMasters],
  );
  const members = useMemo(() => {
    const matchOrg = form.organization;
    const names = profiles
      .filter((p) => (matchOrg ? p.orgs.some((o) => o.uid === matchOrg) : true))
      .map((p) => p.full_name)
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [profiles, form.organization]);
  const filteredClients = useMemo(() => {
    const all = clientObjects.map((c) => c.name);
    if (!form.organization) return all;
    const filtered = clientObjects
      .filter((c) => c.orgs.includes(form.organization))
      .map((c) => c.name);
    return filtered.length ? filtered : all;
  }, [clientObjects, form.organization]);

  useEffect(() => {
    const next = task
      ? { ...EMPTY, ...(task as object) }
      : { ...EMPTY, status: defaultStatus ?? "Pending" };
    Promise.resolve().then(() => {
      setForm(next);
      setSubs([...initialSubs]);
    });
  }, [task, defaultStatus, initialSubs]);

  // Auto-scroll a sub row into view when opened from a sub click
  useEffect(() => {
    if (!focusSubId) return;
    const el = document.querySelector(`[data-sub-uid="${focusSubId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("sub-flash");
      setTimeout(() => el.classList.remove("sub-flash"), 1500);
    }
  }, [focusSubId, subs.length]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleOrgChange = (newOrgUid: string) => {
    set("organization", newOrgUid);
    if (newOrgUid && form.client) {
      const obj = clientObjects.find((c) => c.name === form.client);
      if (obj?.orgs.length && !obj.orgs.includes(newOrgUid)) set("client", "");
    }
  };

  const handleClientChange = (clientName: string) => {
    set("client", clientName);
    if (clientName && !form.organization) {
      const obj = clientObjects.find((c) => c.name === clientName);
      const firstOrgUid = obj?.orgs?.[0];
      if (firstOrgUid) set("organization", firstOrgUid);
    }
  };

  const isCreate = !task;
  const subsHaveErrors = hasSubErrors(subs, form.targetDate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) {
      alert("Please enter a task description.");
      return;
    }
    if (isCreate && !form.reportingManager) {
      alert("Please select a Reporting Manager.");
      return;
    }
    if (subsHaveErrors) {
      alert("Please fix the highlighted sub-task date errors before saving.");
      return;
    }
    onSave({ ...form, id: task?.id } as Partial<Task> & { id?: string }, subs);
  };

  const headerLabel = task
    ? `Edit Goal #${(task as { serialNo?: number }).serialNo ?? ""}`
    : "Add New Task";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{headerLabel}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <MainGoalFields
            form={form}
            orgs={orgs}
            filteredClients={filteredClients}
            categories={categories}
            members={members}
            clientObjects={clientObjects}
            set={set}
            onOrgChange={handleOrgChange}
            onClientChange={handleClientChange}
            isCreate={isCreate}
          />

          <SubtaskTable
            subs={subs}
            categories={categories}
            members={members}
            mainTargetDate={form.targetDate}
            onChange={setSubs}
          />

          <div className="modal-foot">
            <div className="modal-foot-left">
              {task && (
                <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                  Task #{(task as { serialNo?: number }).serialNo}
                </span>
              )}
            </div>
            {task && onDelete && (
              <button
                type="button" className="btn"
                style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", marginRight: "auto" }}
                onClick={() => {
                  const subCount = subs.length;
                  const msg = subCount > 0
                    ? `Delete this goal and its ${subCount} sub-task(s)? This cannot be undone.`
                    : "Delete this task? This cannot be undone.";
                  if (window.confirm(msg)) {
                    onDelete((task as { id?: string }).id!);
                    onClose();
                  }
                }}
              >
                🗑 Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={subsHaveErrors}
            >
              {task ? "✓ Save Goal" : "+ Add Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `data-sub-uid` to rows in `SubtaskTable.tsx`**

Edit `frontend/task-tracker/src/components/board/SubtaskTable.tsx` — change the `<tr key={i}>` line to:

```typescript
              <tr key={s.id ?? i} data-sub-uid={s.id ?? undefined}>
```

Also append CSS to support the flash:

```css
.sub-flash { animation: sub-flash 1.5s ease-out; }
@keyframes sub-flash { 0% { background: #fef3c7; } 100% { background: transparent; } }
.modal-wide { max-width: 1100px; }
```

- [ ] **Step 3: Type check**

Run: `cd frontend/task-tracker && npx tsc -b`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/board/TaskModal.tsx frontend/task-tracker/src/components/board/SubtaskTable.tsx frontend/task-tracker/src/styles/index.css
git commit -m "feat(board): TaskModal orchestrates Main + Subs"
```

---

## Task 10: App.tsx wiring — load subs, save tree, route clicks

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`
- Modify: `frontend/task-tracker/src/hooks/useTasks.ts`

- [ ] **Step 1: Add `saveGoalTree` to `useTasks`**

In `frontend/task-tracker/src/hooks/useTasks.ts`, after `saveTask`, add:

```typescript
  const saveGoalTree = useCallback(
    async (
      taskData: Partial<Task> & { id?: ID },
      subs: SubtaskItem[],
      _myName: string,
      refs: TaskWriteRefs,
      subRefs: SubtaskWriteRefs,
    ): Promise<void> => {
      const withStatus: Task = {
        ...(taskData as Task),
        status: computeStatus(taskData as Task),
      };
      const payload = taskWithSubtasksToCreate(withStatus, subs, refs, subRefs);
      try {
        if (taskData.id) {
          await apiPatch<TaskDto>(`/tasks/${taskData.id}/`, payload);
        } else {
          await apiPost<TaskDto>("/tasks/", payload);
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
      }
    },
    [],
  );
```

Add the imports near the top:

```typescript
import {
  taskWithSubtasksToCreate,
  type SubtaskWriteRefs,
} from "@/lib/api/mappers";
import type { SubtaskItem } from "@/types";
```

Return `saveGoalTree` from the hook (add to the existing return object).

- [ ] **Step 2: Wire goal modal in `App.tsx`**

Edit `App.tsx` — extend the modal-state object to track loaded subs and focus uid:

```typescript
  const [modal, setModal] = useState<{
    open: boolean;
    task: Task | null;
    defaultStatus: string;
    subs: SubtaskItem[];
    focusSubId: string | null;
  }>({ open: false, task: null, defaultStatus: "", subs: [], focusSubId: null });
```

Replace `openEditModal` with a goal-aware version:

```typescript
  const openGoalModal = useCallback(
    async (clicked: Task) => {
      // Click any row → resolve to its main and load all its subs.
      const mainId = clicked.parentId ?? clicked.id;
      const main = tasks.find((t) => t.id === mainId) ?? clicked;
      const subs = tasks.filter((t) => t.parentId === mainId);
      const subItems: SubtaskItem[] = subs.map((s) => ({
        id: s.id,
        description: s.description,
        category: s.category,
        responsible: s.responsible,
        targetDate: s.targetDate,
        expectedDate: s.expectedDate,
        remarks: s.remarks,
      }));
      setModal({
        open: true,
        task: main,
        defaultStatus: main.status,
        subs: subItems,
        focusSubId: clicked.parentId ? clicked.id : null,
      });
    },
    [tasks],
  );
```

Replace existing `openEditModal` references throughout `App.tsx` with `openGoalModal`. Update `closeModal`:

```typescript
  const closeModal = useCallback(
    () => setModal({ open: false, task: null, defaultStatus: "", subs: [], focusSubId: null }),
    [],
  );
```

Replace `handleSaveTask` body to use `saveGoalTree` and build `subRefs`:

```typescript
  const handleSaveTask = useCallback(
    async (taskData: Partial<Task> & { id?: ID }, subs: SubtaskItem[]) => {
      if (!user) return;
      const refs = {
        responsible:
          taskData.responsible && responsibleUidByName[taskData.responsible]
            ? responsibleUidByName[taskData.responsible]
            : undefined,
        reporting_manager:
          taskData.reportingManager && responsibleUidByName[taskData.reportingManager]
            ? responsibleUidByName[taskData.reportingManager]
            : undefined,
        client:
          taskData.client && clientUidByName[taskData.client]
            ? clientUidByName[taskData.client]
            : undefined,
        category:
          taskData.category && categoryUidByName[taskData.category]
            ? categoryUidByName[taskData.category]
            : undefined,
        org: taskData.organization || selectedOrg || undefined,
      };
      const subRefs = {
        responsibleByName: responsibleUidByName,
        categoryByName: categoryUidByName,
      };
      await saveGoalTree(taskData, subs, myName, refs, subRefs);
      closeModal();
    },
    [
      saveGoalTree, user, myName, closeModal,
      responsibleUidByName, clientUidByName, categoryUidByName, selectedOrg,
    ],
  );
```

Update the `<TaskModal>` mount to pass the new props:

```typescript
{modal.open && (
  <TaskModal
    task={modal.task}
    initialSubs={modal.subs}
    focusSubId={modal.focusSubId}
    defaultStatus={modal.defaultStatus}
    onSave={handleSaveTask}
    onClose={closeModal}
    onDelete={modal.task?.id ? () => deleteTask(modal.task!.id) : undefined}
  />
)}
```

Replace any callsite that passes `openEditModal` (e.g., dashboard popup) with `openGoalModal`.

- [ ] **Step 3: Type check + lint**

Run: `cd frontend/task-tracker && npx tsc -b && npm run lint`

Expected: clean.

- [ ] **Step 4: Manual smoke test (dev server)**

Start backend in one terminal: `python manage.py runserver 0.0.0.0:8000`

Start frontend: `cd frontend/task-tracker && npm run dev`

Open the app, click "+ Add Task". Check:
- Modal shows Main fields on top, Subtasks table below with "+ Add subtask" button.
- Add 2 subs with target dates ≤ Main target. Save.
- Refresh — both Main and Subs appear in the dashboard as individual rows.
- Click the Sub row → modal opens with Main + both subs, the clicked sub is briefly highlighted.
- Edit the Main target date to a date earlier than a sub's target → Save button disables, sub cell turns red.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/App.tsx frontend/task-tracker/src/hooks/useTasks.ts
git commit -m "feat(app): wire goal modal save tree and parent-aware row clicks"
```

---

## Task 11: Optional dashboard polish (sub-row indicator)

**Files:**
- Modify: `frontend/task-tracker/src/lib/api/mappers.ts` (already has `parentId`)
- Modify: `frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx` and/or `TaskDrillModal.tsx`

- [ ] **Step 1: Find description renderers**

Run: `grep -rn "task.description\|task\.description" frontend/task-tracker/src/components/dashboard/ | head -10`

- [ ] **Step 2: Add `↳` prefix for sub rows**

In each renderer that outputs `task.description` for the descriptive cell, replace with:

```typescript
{task.parentId ? "↳ " : ""}{task.description || (task.parentId ? `Sub of #${task.serialNo ?? ""}` : "")}
```

- [ ] **Step 3: Type check**

Run: `cd frontend/task-tracker && npx tsc -b`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/
git commit -m "polish(dashboard): mark sub rows with ↳ indicator"
```

---

## Task 12: End-to-end verification

**Files:** none

- [ ] **Step 1: Backend test suite**

Run: `python manage.py test core.tasks -v 2`

Expected: all PASS.

- [ ] **Step 2: Backend lint + typecheck**

Run: `ruff check . && ruff format --check . && mypy core/tasks/ && pyright core/tasks/`

Expected: clean. Fix as needed.

- [ ] **Step 3: Frontend test + typecheck + lint**

Run: `cd frontend/task-tracker && npm run test -- --run && npx tsc -b && npm run lint`

Expected: clean.

- [ ] **Step 4: Manual acceptance walk-through**

Confirm each spec acceptance check passes:

1. Existing tasks display unchanged after migration.
2. Creating a Main with 0 subs behaves identically to today's flow.
3. Creating a Main with N subs creates 1+N rows in one transaction; all subs share the Main's `org`/`client`/`reporting_manager`/`recurrence`.
4. Sub target date > Main target date is rejected client-side AND server-side.
5. Editing a Main target earlier than any sub's target is blocked with the listed-sub error.
6. Deleting a Main cascades to subs and writes audit log entries.
7. Clicking a Sub from dashboard opens the full goal modal with that sub auto-scrolled and briefly highlighted.

- [ ] **Step 5: Final push**

```bash
git push
```
