# Work Plan recurrence series — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every recurring Work Plan row with a `series_uid`, surface recurrence info in the list, and let the user choose between "this entry only" and "this and following entries" when editing a series row.

**Architecture:** Three additive nullable fields on `WorkPlan` (`series_uid`, `recurrence`, `recurrence_end_date`). The Add Plan modal generates one UUID per employee per submission. A new `POST /work_plans/{id}/apply_to_following/` endpoint atomically updates this row and all later same-series rows (date applied as a delta to preserve weekday cadence; other fields applied verbatim). The list table grows a new column; the edit flow opens an inline scope-picker modal when the source row has a `series_uid`.

**Tech Stack:** Django REST Framework, vitest + React Testing Library, TypeScript, Vite.

**Spec:** [docs/superpowers/specs/2026-05-14-workplan-recurrence-series-design.md](../specs/2026-05-14-workplan-recurrence-series-design.md)

---

## File map

**Backend**
- Modify: `core/worklog/models.py` — add 3 nullable fields to `WorkPlan`
- Create: `core/worklog/migrations/0003_workplan_recurrence_series.py`
- Modify: `core/worklog/serializers.py` — expose 3 fields; read-only on PATCH
- Modify: `core/worklog/views.py` — add `apply_to_following` action
- Modify: `core/worklog/tests.py` — new `WorkPlanRecurrenceSeriesTests` class

**Frontend**
- Modify: `frontend/task-tracker/src/types/api/workPlan.ts` — DTO + create types
- Modify: `frontend/task-tracker/src/types/worklog.ts` — UI-facing `WorkPlan`
- Modify: `frontend/task-tracker/src/lib/api/mappers.ts` — `dtoToWorkPlan` passes 3 fields through; `workPlanToCreate` accepts them on writes
- Modify: `frontend/task-tracker/src/components/worklog/PlanAddModal.tsx` — generate one `series_uid` per employee; attach series fields to every body
- Create: `frontend/task-tracker/src/components/worklog/PlanEditScopeModal.tsx` — inline scope picker
- Modify: `frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx` — new Recurrence column + integration with scope modal
- Modify: `frontend/task-tracker/src/__tests__/lib/api/mappers.test.ts` — extend WorkPlan round-trip test
- Modify: `frontend/task-tracker/src/__tests__/hooks/useWorkPlans.test.ts` — extend fixture with new fields

---

## Task 1: Backend model + migration

**Files:**
- Modify: `core/worklog/models.py:60-99`
- Create: `core/worklog/migrations/0003_workplan_recurrence_series.py`

- [ ] **Step 1: Add fields to `WorkPlan`**

Insert the three new fields into the `WorkPlan` model, after `planned_hours`:

```python
# core/worklog/models.py — inside class WorkPlan
RECURRENCE_CHOICES = [
    ("", "One-time"),
    ("daily", "Daily"),
    ("weekly", "Weekly"),
    ("monthly", "Monthly"),
]

series_uid = models.UUIDField(null=True, blank=True, db_index=True)
recurrence = models.CharField(
    max_length=20,
    choices=RECURRENCE_CHOICES,
    blank=True,
    default="",
)
recurrence_end_date = models.DateField(null=True, blank=True)
```

Place `RECURRENCE_CHOICES` above the field definitions in `class WorkPlan`.

- [ ] **Step 2: Generate the migration**

Run: `python manage.py makemigrations worklog --name workplan_recurrence_series`
Expected: file `core/worklog/migrations/0003_workplan_recurrence_series.py` created with three `AddField` operations.

- [ ] **Step 3: Verify migration is additive only**

Read the generated file. Expected: three `migrations.AddField` operations, no `RemoveField`, no `AlterField` on existing columns. Confirm `series_uid` has `db_index=True` and the other two have `null=True, blank=True`.

- [ ] **Step 4: Apply the migration**

Run: `python manage.py migrate worklog`
Expected: `Applying worklog.0003_workplan_recurrence_series... OK`

- [ ] **Step 5: Commit**

```bash
git add core/worklog/models.py core/worklog/migrations/0003_workplan_recurrence_series.py
git commit -m "feat(worklog): add series_uid/recurrence/recurrence_end_date to WorkPlan"
```

---

## Task 2: Backend serializer — expose fields, lock on PATCH

**Files:**
- Modify: `core/worklog/serializers.py:58-101`
- Test: `core/worklog/tests.py` (extend with new test class)

- [ ] **Step 1: Write failing tests for serializer behavior**

Append to `core/worklog/tests.py` (after the existing `WorkPlanCreateMultiOrgTests` class):

```python
import uuid

class WorkPlanSeriesFieldsTests(TestCase):
    """Pin the read/write contract of series_uid / recurrence / recurrence_end_date.
    POST accepts them; PATCH must ignore them so the series tag can't be
    silently reassigned via the standard update path.
    """

    def setUp(self):
        self.org = Org.objects.create(name="Org-1")
        self.admin = User.objects.create_user(username="adm", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.assignee = User.objects.create_user(username="emp1", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.assignee, org=self.org, role="employee")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

    def _post(self, **overrides):
        body = {
            "assigned_to": str(self.assignee.uid),
            "date": "2026-05-14",
            "task_description": "Audit",
            "planned_hours": "4.00",
            "org": str(self.org.uid),
        }
        body.update(overrides)
        return self.client_api.post("/api/work_plans/", body, format="json")

    def test_post_accepts_and_stores_series_fields(self):
        sid = str(uuid.uuid4())
        res = self._post(
            series_uid=sid,
            recurrence="weekly",
            recurrence_end_date="2026-07-31",
        )
        self.assertEqual(res.status_code, 201, res.data)
        row = WorkPlan.objects.get()
        self.assertEqual(str(row.series_uid), sid)
        self.assertEqual(row.recurrence, "weekly")
        self.assertEqual(str(row.recurrence_end_date), "2026-07-31")

    def test_post_default_blanks_for_one_time(self):
        res = self._post()
        self.assertEqual(res.status_code, 201, res.data)
        row = WorkPlan.objects.get()
        self.assertIsNone(row.series_uid)
        self.assertEqual(row.recurrence, "")
        self.assertIsNone(row.recurrence_end_date)

    def test_patch_ignores_series_fields(self):
        sid = str(uuid.uuid4())
        res = self._post(series_uid=sid, recurrence="weekly", recurrence_end_date="2026-07-31")
        uid = res.data["uid"]
        new_sid = str(uuid.uuid4())
        res2 = self.client_api.patch(
            f"/api/work_plans/{uid}/",
            {
                "series_uid": new_sid,
                "recurrence": "monthly",
                "recurrence_end_date": "2027-01-01",
                "task_description": "Field Audit",
            },
            format="json",
        )
        self.assertEqual(res2.status_code, 200, res2.data)
        row = WorkPlan.objects.get()
        # PATCH-able field changed
        self.assertEqual(row.task_description, "Field Audit")
        # Series fields are immutable on PATCH
        self.assertEqual(str(row.series_uid), sid)
        self.assertEqual(row.recurrence, "weekly")
        self.assertEqual(str(row.recurrence_end_date), "2026-07-31")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test core.worklog.tests.WorkPlanSeriesFieldsTests -v 2`
Expected: 3 failures — fields not present in serializer output, POST values not persisted, PATCH freely overwrites.

- [ ] **Step 3: Update the serializer**

In `core/worklog/serializers.py`, modify `WorkPlanSerializer.Meta`:

```python
class Meta:
    model = WorkPlan
    fields = [
        "id",
        "uid",
        "assigned_to",
        "assigned_to_detail",
        "created_by_detail",
        "date",
        "task_description",
        "planned_hours",
        "client",
        "client_detail",
        "series_uid",
        "recurrence",
        "recurrence_end_date",
        "created_at",
        "updated_at",
    ]
    read_only_fields = [
        "id",
        "uid",
        "assigned_to_detail",
        "created_by_detail",
        "client_detail",
        "created_at",
        "updated_at",
    ]
```

Add the immutability rule for PATCH by overriding `update`:

```python
def update(self, instance, validated_data):
    # Series tag is stamped at create-time only. The dedicated
    # ``apply_to_following`` endpoint handles series-wide edits; the
    # standard PATCH path must not move a row between series.
    validated_data.pop("series_uid", None)
    validated_data.pop("recurrence", None)
    validated_data.pop("recurrence_end_date", None)
    return super().update(instance, validated_data)
```

Place `update` directly above the `Meta` class inside `WorkPlanSerializer`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test core.worklog.tests.WorkPlanSeriesFieldsTests -v 2`
Expected: 3 tests pass.

- [ ] **Step 5: Run the full worklog test module to check for regressions**

Run: `python manage.py test core.worklog -v 2`
Expected: All existing tests still pass (the `WorkPlanCreateMultiOrgTests` payloads don't send series fields, so they should be unaffected).

- [ ] **Step 6: Commit**

```bash
git add core/worklog/serializers.py core/worklog/tests.py
git commit -m "feat(worklog): expose series fields on WorkPlan serializer (read-only on PATCH)"
```

---

## Task 3: Backend `apply_to_following` endpoint

**Files:**
- Modify: `core/worklog/views.py:194-227`
- Modify: `core/worklog/tests.py` (extend)

- [ ] **Step 1: Write failing tests for the endpoint**

Append to `core/worklog/tests.py`:

```python
class WorkPlanApplyToFollowingTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-1")
        self.admin = User.objects.create_user(username="adm", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.assignee = User.objects.create_user(username="emp1", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.assignee, org=self.org, role="employee")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

        # Build a 4-row weekly series + 1 sibling-series row + 1 one-time row
        self.sid_a = uuid.uuid4()
        self.sid_b = uuid.uuid4()
        dates_a = ["2026-05-07", "2026-05-14", "2026-05-21", "2026-05-28"]
        for d in dates_a:
            WorkPlan.objects.create(
                org=self.org,
                assigned_to=self.assignee,
                date=d,
                task_description="Audit",
                planned_hours="4.00",
                series_uid=self.sid_a,
                recurrence="weekly",
                recurrence_end_date="2026-05-28",
            )
        # A different series; must never be touched
        WorkPlan.objects.create(
            org=self.org,
            assigned_to=self.assignee,
            date="2026-05-14",
            task_description="Other series",
            planned_hours="2.00",
            series_uid=self.sid_b,
            recurrence="weekly",
            recurrence_end_date="2026-06-04",
        )
        # A one-time row on the same date — also must never be touched
        WorkPlan.objects.create(
            org=self.org,
            assigned_to=self.assignee,
            date="2026-05-14",
            task_description="One-off",
            planned_hours="1.00",
        )

    def _middle_row(self):
        return WorkPlan.objects.get(series_uid=self.sid_a, date="2026-05-14")

    def _url(self, row):
        return f"/api/work_plans/{row.uid}/apply_to_following/"

    def test_updates_this_and_later_rows_only(self):
        row = self._middle_row()
        res = self.client_api.post(
            self._url(row),
            {"task_description": "Field Audit", "planned_hours": "6.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["updated_count"], 3)

        affected = WorkPlan.objects.filter(
            series_uid=self.sid_a, date__gte="2026-05-14"
        ).order_by("date")
        for r in affected:
            self.assertEqual(r.task_description, "Field Audit")
            self.assertEqual(str(r.planned_hours), "6.00")

        # Earlier row in same series is untouched
        earlier = WorkPlan.objects.get(series_uid=self.sid_a, date="2026-05-07")
        self.assertEqual(earlier.task_description, "Audit")
        self.assertEqual(str(earlier.planned_hours), "4.00")

        # Sibling series untouched
        other = WorkPlan.objects.get(series_uid=self.sid_b)
        self.assertEqual(other.task_description, "Other series")

        # One-time row untouched
        oneoff = WorkPlan.objects.get(series_uid__isnull=True)
        self.assertEqual(oneoff.task_description, "One-off")

    def test_date_shift_applies_delta_to_later_rows(self):
        row = self._middle_row()
        # Shift this row from Thu 2026-05-14 to Fri 2026-05-15: +1 day delta.
        res = self.client_api.post(
            self._url(row),
            {"date": "2026-05-15"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["updated_count"], 3)

        # The row we edited
        self.assertEqual(
            str(WorkPlan.objects.get(pk=row.pk).date), "2026-05-15"
        )
        # The later rows shifted by the same +1 day
        self.assertTrue(
            WorkPlan.objects.filter(series_uid=self.sid_a, date="2026-05-22").exists()
        )
        self.assertTrue(
            WorkPlan.objects.filter(series_uid=self.sid_a, date="2026-05-29").exists()
        )
        # Earlier row is unchanged
        self.assertTrue(
            WorkPlan.objects.filter(series_uid=self.sid_a, date="2026-05-07").exists()
        )

    def test_400_when_source_has_no_series_uid(self):
        oneoff = WorkPlan.objects.get(series_uid__isnull=True)
        res = self.client_api.post(
            self._url(oneoff),
            {"task_description": "X"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_400_when_payload_empty(self):
        row = self._middle_row()
        res = self.client_api.post(self._url(row), {}, format="json")
        self.assertEqual(res.status_code, 400, res.data)

    def test_403_when_caller_lacks_visibility(self):
        # A user in a different org cannot apply to a series they can't see.
        other_org = Org.objects.create(name="Org-2")
        other_user = User.objects.create_user(username="other", password="pw", full_name="Other")
        OrgMembership.objects.create(user=other_user, org=other_org, role="admin")
        cli = APIClient()
        _auth(cli, other_user)
        row = self._middle_row()
        res = cli.post(
            self._url(row),
            {"task_description": "Hack"},
            format="json",
        )
        # Visibility filters this out → 404 (DRF default for "no match in queryset").
        self.assertIn(res.status_code, (403, 404), res.data)
```

Note the import `import uuid` at the top of the file (or near the existing imports) if not already present from Task 2.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python manage.py test core.worklog.tests.WorkPlanApplyToFollowingTests -v 2`
Expected: 5 failures — endpoint returns 404 because `apply_to_following` doesn't exist.

- [ ] **Step 3: Implement the endpoint**

In `core/worklog/views.py`, inside `WorkPlanViewSet` (after `perform_destroy`), add:

```python
@action(detail=True, methods=["post"], url_path="apply_to_following")
def apply_to_following(self, request, *args, **kwargs):
    """Apply the edited fields to this row and every later same-series row.

    Atomic. ``date`` is applied as a delta so weekday/day-of-month cadence
    is preserved across the shifted block. Other fields are applied verbatim.
    """
    source = self.get_object()
    if source.series_uid is None:
        raise ValidationError({"detail": "Row is not part of a series."})

    allowed = {"date", "task_description", "planned_hours", "client"}
    payload = {k: v for k, v in request.data.items() if k in allowed}
    if not payload:
        raise ValidationError({"detail": "Provide at least one field to update."})

    # Resolve the client uid → Master pk, if provided.
    new_client = None
    if "client" in payload:
        from core.masters.models import Master
        client_uid = payload["client"]
        if client_uid in (None, ""):
            new_client = None
        else:
            try:
                new_client = Master.objects.get(uid=client_uid, type="client")
            except Master.DoesNotExist:
                raise ValidationError({"client": "Unknown client uid."})

    # Resolve the date delta, if provided.
    delta = None
    if "date" in payload:
        import datetime
        try:
            new_date = datetime.date.fromisoformat(payload["date"])
        except (TypeError, ValueError):
            raise ValidationError({"date": "Invalid date."})
        delta = new_date - source.date

    new_task = payload.get("task_description")
    new_hours = payload.get("planned_hours")

    updated_count = 0
    with transaction.atomic():
        rows = (
            WorkPlan.objects.select_for_update()
            .filter(series_uid=source.series_uid, date__gte=source.date)
            .order_by("date")
        )
        for row in rows:
            if new_task is not None:
                row.task_description = new_task
            if new_hours is not None:
                row.planned_hours = new_hours
            if "client" in payload:
                row.client = new_client
            if delta is not None:
                row.date = row.date + delta
            row.save()
            broadcast("work-plans", "UPDATE", WorkPlanSerializer(row).data)
            updated_count += 1

    return Response({"updated_count": updated_count})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test core.worklog.tests.WorkPlanApplyToFollowingTests -v 2`
Expected: 5 tests pass.

- [ ] **Step 5: Run full worklog tests for regression**

Run: `python manage.py test core.worklog -v 2`
Expected: All worklog tests pass.

- [ ] **Step 6: Commit**

```bash
git add core/worklog/views.py core/worklog/tests.py
git commit -m "feat(worklog): apply_to_following endpoint for series-wide edits"
```

---

## Task 4: Frontend types + mapper passthrough

**Files:**
- Modify: `frontend/task-tracker/src/types/api/workPlan.ts`
- Modify: `frontend/task-tracker/src/types/worklog.ts`
- Modify: `frontend/task-tracker/src/lib/api/mappers.ts`
- Test: `frontend/task-tracker/src/__tests__/lib/api/mappers.test.ts`

- [ ] **Step 1: Update the mapper test first (failing)**

Open `frontend/task-tracker/src/__tests__/lib/api/mappers.test.ts` and add a new test inside the `describe("dtoToWorkPlan / workPlanToCreate", ...)` block:

```ts
it("passes recurrence series fields through dtoToWorkPlan", () => {
  const dto: WorkPlanDto = {
    ...BASE,
    assigned_to_detail: USER_REF,
    created_by_detail: USER_REF,
    date: "2026-05-14",
    task_description: "Audit",
    planned_hours: "4.00",
    client: null,
    client_detail: null,
    org: "org-uid-3",
    org_uid: "org-uid-3",
    series_uid: "series-uid-1",
    recurrence: "weekly",
    recurrence_end_date: "2026-07-31",
  };
  const domain = dtoToWorkPlan(dto);
  expect(domain.series_uid).toBe("series-uid-1");
  expect(domain.recurrence).toBe("weekly");
  expect(domain.recurrence_end_date).toBe("2026-07-31");
});

it("treats missing series fields as a one-time row", () => {
  const dto: WorkPlanDto = {
    ...BASE,
    assigned_to_detail: USER_REF,
    created_by_detail: USER_REF,
    date: "2026-05-14",
    task_description: "Solo",
    planned_hours: "1.00",
    client: null,
    client_detail: null,
    org: "org-uid-3",
    org_uid: "org-uid-3",
    series_uid: null,
    recurrence: "",
    recurrence_end_date: null,
  };
  const domain = dtoToWorkPlan(dto);
  expect(domain.series_uid).toBeNull();
  expect(domain.recurrence).toBe("");
  expect(domain.recurrence_end_date).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npm test -- src/__tests__/lib/api/mappers.test.ts`
Expected: TypeScript errors on the new DTO properties + assertion failures because the mapper doesn't carry the fields.

- [ ] **Step 3: Update `WorkPlanDto` and create payloads**

In `frontend/task-tracker/src/types/api/workPlan.ts`, modify both interfaces:

```ts
export type WorkPlanRecurrenceValue = "" | "daily" | "weekly" | "monthly";

/** Full work-plan payload. */
export interface WorkPlanDto extends BaseDto {
  readonly assigned_to_detail: UserRefDto;
  readonly created_by_detail: UserRefDto | null;
  readonly date: IsoDate;
  readonly task_description: string;
  /** Decimal string, `"0.01".."24.00"`. */
  readonly planned_hours: string;

  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;

  readonly org: Uid;
  readonly org_uid: Uid;

  /** Series tag — null for one-time rows and all legacy rows. */
  readonly series_uid: Uid | null;
  readonly recurrence: WorkPlanRecurrenceValue;
  readonly recurrence_end_date: IsoDate | null;
}

/** Body for `POST /api/work_plans/`. `created_by` is auto-set. */
export interface WorkPlanCreate {
  readonly assigned_to: Uid;
  readonly date: IsoDate;
  readonly task_description: string;
  readonly planned_hours: string;
  /** `null` explicitly clears the client; `undefined` leaves it unchanged. */
  readonly client?: Uid | null;
  readonly org?: Uid;
  readonly series_uid?: Uid | null;
  readonly recurrence?: WorkPlanRecurrenceValue;
  readonly recurrence_end_date?: IsoDate | null;
}

/** Body for `PATCH /api/work_plans/<uid>/`. */
export type WorkPlanUpdate = Partial<WorkPlanCreate>;

/** Body for `POST /api/work_plans/<uid>/apply_to_following/`. */
export interface WorkPlanApplyToFollowing {
  readonly date?: IsoDate;
  readonly task_description?: string;
  readonly planned_hours?: string;
  readonly client?: Uid | null;
}
```

- [ ] **Step 4: Update the UI-facing `WorkPlan` type**

In `frontend/task-tracker/src/types/worklog.ts`, extend `WorkPlan`:

```ts
export interface WorkPlan {
  id: ID;
  user_id: ID;
  name: string;
  date: DateString;
  day: string;
  client: string;
  task_description: string;
  /** `"H:MM"` string. Converted to decimal at the API boundary. */
  hours_planned: string;
  priority: string;
  organization: string;
  sort_order: number | null;
  /** Null for one-time and legacy rows. */
  series_uid: string | null;
  /** `""` for one-time. */
  recurrence: "" | "daily" | "weekly" | "monthly";
  /** `"YYYY-MM-DD"` or null. */
  recurrence_end_date: DateString | null;
}
```

- [ ] **Step 5: Pass the fields through the mapper**

In `frontend/task-tracker/src/lib/api/mappers.ts`, update `dtoToWorkPlan`:

```ts
export function dtoToWorkPlan(dto: WorkPlanDto): WorkPlan {
  return {
    id: dto.uid,
    user_id: dto.assigned_to_detail.uid,
    name: dto.assigned_to_detail.full_name,
    date: dto.date,
    day: getDayName(dto.date),
    client: dto.client_detail?.name ?? "",
    task_description: dto.task_description,
    hours_planned: decimalToHours(dto.planned_hours),
    priority: "Normal",
    organization: dto.org_uid,
    sort_order: null,
    series_uid: dto.series_uid ?? null,
    recurrence: dto.recurrence ?? "",
    recurrence_end_date: dto.recurrence_end_date ?? null,
  };
}
```

- [ ] **Step 6: Run mapper tests to verify they pass**

Run: `cd frontend/task-tracker && npm test -- src/__tests__/lib/api/mappers.test.ts`
Expected: All mapper tests pass.

- [ ] **Step 7: Update `useWorkPlans` test fixture so it still typechecks**

In `frontend/task-tracker/src/__tests__/hooks/useWorkPlans.test.ts`, add the three new fields to both fixture rows (after `org`):

```ts
series_uid: null,
recurrence: "",
recurrence_end_date: null,
```

- [ ] **Step 8: Run the hooks test**

Run: `cd frontend/task-tracker && npm test -- src/__tests__/hooks/useWorkPlans.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full frontend typecheck + tests**

Run: `cd frontend/task-tracker && npm run build` and `npm test`
Expected: Build succeeds; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/task-tracker/src/types/api/workPlan.ts frontend/task-tracker/src/types/worklog.ts frontend/task-tracker/src/lib/api/mappers.ts frontend/task-tracker/src/__tests__/lib/api/mappers.test.ts frontend/task-tracker/src/__tests__/hooks/useWorkPlans.test.ts
git commit -m "feat(workplan): thread series_uid/recurrence/recurrence_end_date through DTO and mapper"
```

---

## Task 5: Frontend — Add modal stamps one series_uid per employee

**Files:**
- Modify: `frontend/task-tracker/src/components/worklog/PlanAddModal.tsx:125-222`

- [ ] **Step 1: Add the series-uid generation inside the per-employee loop**

Locate the `for (const empName of selEmps) { ... }` block (around line 162-185). Replace the body so each employee gets a fresh UUID and the three series fields are attached to every body for that employee:

```ts
const isSeries = recur !== "onetime";
for (const empName of selEmps) {
  const emp = profiles.find((p) => p.full_name === empName);
  if (!emp) continue;
  const empDefaultOrg =
    emp.orgs.find((o) => o.is_default) ?? emp.orgs[0];
  const orgUid = selectedOrg || empDefaultOrg?.uid;
  if (!orgUid) {
    missingOrg.push(empName);
    continue;
  }
  // One series_uid per employee per Add submission. Editing Emp A's
  // series later must not bleed into Emp B's rows even though they
  // were created in the same modal submission.
  const empSeriesUid = isSeries ? crypto.randomUUID() : null;
  for (const d of dates) {
    bodies.push({
      assigned_to: emp.id,
      date: d,
      task_description: task.trim(),
      planned_hours: hoursStr,
      client: clientUid,
      org: orgUid,
      series_uid: empSeriesUid,
      recurrence: isSeries
        ? (recur as "daily" | "weekly" | "monthly")
        : "",
      recurrence_end_date: isSeries ? endDate : null,
    });
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd frontend/task-tracker && npm run build`
Expected: No TypeScript errors. `WorkPlanCreate` now accepts the optional series fields (added in Task 4).

- [ ] **Step 3: Manual smoke check (deferred to Task 8 e2e)**

Note in the commit message that browser verification is done at the end of Task 8 to avoid stepping through the UI multiple times. Move on.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/worklog/PlanAddModal.tsx
git commit -m "feat(workplan-add): stamp one series_uid per employee on recurring submissions"
```

---

## Task 6: Frontend — Recurrence column on the list

**Files:**
- Modify: `frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx`

- [ ] **Step 1: Add a date formatter helper near the top of the file**

Inside the component file, just below the imports, add:

```ts
function formatDDMMYYYY(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const RECURRENCE_ICON: Record<"daily" | "weekly" | "monthly", string> = {
  daily: "☀️",
  weekly: "🔁",
  monthly: "📆",
};
const RECURRENCE_LABEL: Record<"daily" | "weekly" | "monthly", string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};
```

- [ ] **Step 2: Insert a "Recurrence" header between Client and Planned Task**

Locate the header array in `renderTable` (around line 267-275). Update it:

```ts
{[
  "#",
  ...(showMember ? ["Employee"] : []),
  "Day",
  "Date",
  "Client",
  "Recurrence",
  "Planned Task",
  "Planned Hours",
  ...(canManage ? ["Actions"] : []),
].map((h) => ( /* ...existing header cell... */ ))}
```

Also bump the `colSpan` calculation: change `2 + (showMember ? 1 : 0) + 5 + (canManage ? 1 : 0)` to `2 + (showMember ? 1 : 0) + 6 + (canManage ? 1 : 0)`.

- [ ] **Step 3: Insert the cell into each row**

After the Client `<td>` (around line 407) and before the Planned Task `<td>` (around line 408), insert:

```tsx
<td style={{ ...cell, minWidth: 160, whiteSpace: "nowrap" }}>
  {row.series_uid && row.recurrence && row.recurrence !== "" ? (
    <span
      style={{
        background: "#f5f3ff",
        color: "#7c3aed",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
      }}
      title={`Series ends ${formatDDMMYYYY(row.recurrence_end_date)}`}
    >
      {RECURRENCE_ICON[row.recurrence]} {RECURRENCE_LABEL[row.recurrence]}
      {row.recurrence_end_date
        ? ` · ends ${formatDDMMYYYY(row.recurrence_end_date)}`
        : ""}
    </span>
  ) : (
    <span style={{ color: "#94a3b8" }}>—</span>
  )}
</td>
```

The row is editable but the recurrence cell is read-only in edit mode (no input — recurrence is set at create-time and can't be changed via PATCH, per Task 2). When `isEditing` is true, still render the same read-only cell.

- [ ] **Step 4: Run frontend tests + build**

Run: `cd frontend/task-tracker && npm test && npm run build`
Expected: All tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx
git commit -m "feat(workplan-list): add Recurrence column with type + series end date"
```

---

## Task 7: Frontend — Edit scope picker modal

**Files:**
- Create: `frontend/task-tracker/src/components/worklog/PlanEditScopeModal.tsx`

- [ ] **Step 1: Create the modal component**

Write the file:

```tsx
import type { CSSProperties, ReactNode } from "react";

export type EditScope = "this" | "following";

interface ChangedField {
  label: string;
  before: ReactNode;
  after: ReactNode;
}

interface PlanEditScopeModalProps {
  /** Friendly description of the source row, e.g. "Weekly · 2026-05-14 (Thu)" */
  rowSummary: string;
  /** Fields the user changed, with before/after snippets. */
  changes: readonly ChangedField[];
  saving: boolean;
  onChoose: (scope: EditScope) => void;
  onCancel: () => void;
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 4100,
};

const card: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  width: "min(480px,94vw)",
  boxShadow: "0 24px 80px rgba(0,0,0,.32)",
  padding: 0,
  overflow: "hidden",
};

export default function PlanEditScopeModal({
  rowSummary,
  changes,
  saving,
  onChoose,
  onCancel,
}: PlanEditScopeModalProps) {
  return (
    <div style={overlay} onClick={saving ? undefined : onCancel}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #e2e8f0",
            fontWeight: 800,
            fontSize: 15,
            color: "#1e293b",
          }}
        >
          🔁 This entry is part of a series
        </div>
        <div style={{ padding: "14px 18px", color: "#475569", fontSize: 13 }}>
          <div style={{ marginBottom: 10 }}>
            <strong>{rowSummary}</strong>
          </div>
          {changes.length > 0 && (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                Changes
              </div>
              {changes.map((c) => (
                <div
                  key={c.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr",
                    columnGap: 10,
                    fontSize: 12,
                    padding: "3px 0",
                  }}
                >
                  <span style={{ color: "#64748b" }}>{c.label}</span>
                  <span>
                    <span style={{ color: "#94a3b8" }}>{c.before}</span>
                    <span style={{ margin: "0 6px", color: "#94a3b8" }}>→</span>
                    <span style={{ color: "#0f172a", fontWeight: 600 }}>
                      {c.after}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            Apply this edit to…
          </div>
        </div>
        <div
          style={{
            padding: "0 18px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <button
            disabled={saving}
            onClick={() => onChoose("this")}
            style={{
              padding: "10px 14px",
              border: "1.5px solid #2563eb",
              background: "#eff6ff",
              color: "#1e40af",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
              textAlign: "left",
            }}
          >
            This entry only
            <div
              style={{
                fontWeight: 400,
                fontSize: 11,
                color: "#64748b",
                marginTop: 2,
              }}
            >
              Other entries in the series stay as they are.
            </div>
          </button>
          <button
            disabled={saving}
            onClick={() => onChoose("following")}
            style={{
              padding: "10px 14px",
              border: "1.5px solid #7c3aed",
              background: "#f5f3ff",
              color: "#5b21b6",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
              textAlign: "left",
            }}
          >
            This and following entries
            <div
              style={{
                fontWeight: 400,
                fontSize: 11,
                color: "#64748b",
                marginTop: 2,
              }}
            >
              Apply to this row and every later row in the series.
            </div>
          </button>
          <button
            disabled={saving}
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#475569",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd frontend/task-tracker && npm run build`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/worklog/PlanEditScopeModal.tsx
git commit -m "feat(workplan): inline scope picker modal for series edits"
```

---

## Task 8: Frontend — Wire scope modal into WorkPlanTab edit flow

**Files:**
- Modify: `frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx`

- [ ] **Step 1: Import the modal and helper types**

At the top of `WorkPlanTab.tsx`, add to the existing imports:

```ts
import PlanEditScopeModal, {
  type EditScope,
} from "./PlanEditScopeModal";
import { apiPost } from "@/lib/api";
import type { WorkPlanApplyToFollowing } from "@/types/api";
```

(Adjust to merge with the existing `apiDelete, apiPatch` import line — keep them on one statement.)

- [ ] **Step 2: Add scope-modal state**

Inside the `WorkPlanTab` function, near the other `useState` declarations, add:

```ts
const [scopePrompt, setScopePrompt] = useState<{
  rowId: string;
  /** API-shaped payload — only contains fields the user actually changed. */
  changedFields: WorkPlanApplyToFollowing;
  /** Human-readable diff for the modal. */
  changes: { label: string; before: string; after: string }[];
  rowSummary: string;
} | null>(null);
```

- [ ] **Step 3: Compute the diff inside `saveEdit`**

Replace `saveEdit` with this version:

```ts
const saveEdit = async (id: string): Promise<void> => {
  const d = editRows[id];
  const original = filtered.find((p) => p.id === id);
  if (!d || !original) return;
  if (!d.task_description?.trim()) {
    alert("Task is required.");
    return;
  }
  if (!validTime(d.hours_planned)) {
    alert("Hours must be H:MM (e.g. 2:30)");
    return;
  }

  const clientUid = d.client ? clientUidByName[d.client] : undefined;
  const newHoursDecimal = hoursToDecimal(d.hours_planned);
  const originalHoursDecimal = hoursToDecimal(original.hours_planned);

  // Build a diff containing only fields the user actually changed. Both
  // edit-scope branches send the same diff — PATCH and apply_to_following
  // both accept partial bodies — so we don't need to track an "all fields"
  // body in parallel.
  const changedFields: WorkPlanApplyToFollowing = {};
  const changes: { label: string; before: string; after: string }[] = [];

  if (d.task_description.trim() !== original.task_description) {
    changedFields.task_description = d.task_description.trim();
    changes.push({
      label: "Task",
      before: original.task_description,
      after: d.task_description.trim(),
    });
  }
  if (newHoursDecimal !== originalHoursDecimal) {
    changedFields.planned_hours = newHoursDecimal;
    changes.push({
      label: "Hours",
      before: original.hours_planned,
      after: d.hours_planned,
    });
  }
  if ((d.client || "") !== (original.client || "")) {
    changedFields.client = clientUid ?? null;
    changes.push({
      label: "Client",
      before: original.client || "—",
      after: d.client || "—",
    });
  }
  if (d.date !== original.date) {
    changedFields.date = d.date;
    changes.push({
      label: "Date",
      before: original.date,
      after: d.date,
    });
  }

  if (changes.length === 0) {
    // Nothing actually changed — just close the editor.
    cancelEdit(id);
    return;
  }

  const hasSeries = !!original.series_uid;

  // If not part of a series → existing behavior, no prompt.
  if (!hasSeries) {
    setSaving((s) => ({ ...s, [id]: true }));
    try {
      await apiPatch<WorkPlanDto>(
        `/work_plans/${id}/`,
        changedFields as WorkPlanUpdate,
      );
      await load();
      cancelEdit(id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving((s) => ({ ...s, [id]: false }));
    }
    return;
  }

  setScopePrompt({
    rowId: id,
    changedFields,
    changes,
    rowSummary: `${original.recurrence ? original.recurrence[0].toUpperCase() + original.recurrence.slice(1) : "Series"} · ${original.date} (${original.day})`,
  });
};
```

(Make sure `WorkPlanUpdate` is imported alongside `WorkPlanDto` at the top of the file.)

- [ ] **Step 4: Add the scope-choice handler**

Below `saveEdit`, add:

```ts
const handleScopeChoice = async (scope: EditScope): Promise<void> => {
  if (!scopePrompt) return;
  const { rowId, changedFields } = scopePrompt;
  setSaving((s) => ({ ...s, [rowId]: true }));
  try {
    if (scope === "this") {
      // ``changedFields`` is shape-compatible with WorkPlanUpdate — both are
      // partial work-plan bodies. ``client: null`` is preserved (used to clear).
      await apiPatch<WorkPlanDto>(
        `/work_plans/${rowId}/`,
        changedFields as WorkPlanUpdate,
      );
    } else {
      await apiPost<{ updated_count: number }>(
        `/work_plans/${rowId}/apply_to_following/`,
        changedFields,
      );
    }
    await load();
    cancelEdit(rowId);
    setScopePrompt(null);
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : String(err);
    alert(`Save failed: ${msg}`);
  } finally {
    setSaving((s) => ({ ...s, [rowId]: false }));
  }
};
```

- [ ] **Step 5: Render the modal**

At the end of the component's `return`, just before the closing tag of the outer `<div>`, add:

```tsx
{scopePrompt && (
  <PlanEditScopeModal
    rowSummary={scopePrompt.rowSummary}
    changes={scopePrompt.changes}
    saving={!!saving[scopePrompt.rowId]}
    onChoose={handleScopeChoice}
    onCancel={() => setScopePrompt(null)}
  />
)}
```

- [ ] **Step 6: Typecheck + tests**

Run: `cd frontend/task-tracker && npm run build && npm test`
Expected: Build succeeds; all existing tests pass.

- [ ] **Step 7: Manual browser verification**

Start the dev server (`cd frontend/task-tracker && npm run dev`) and walk through:

1. Open Work Log → Work Plan tab.
2. Click **+ Add Plan**, pick 2 employees, set **Weekly** recurrence with an end date ~6 weeks out, set a client + task + hours, Save.
3. Verify the list now shows ~12 rows (6 per employee) with the new **Recurrence** column showing `🔁 Weekly · ends DD/MM/YYYY`.
4. Edit a non-recurring row (legacy or one-time) → Save → no scope modal appears, change applies directly.
5. Edit a recurring row in the middle of the series, change task description and hours → click ✓ Save.
   - Scope modal opens, listing the two changes.
   - Click **This entry only** → only that row updates; later rows keep old values.
6. Edit the same row again, change task again → Save → **This and following entries** → all later rows in *this employee's* series update; the other employee's series for the same dates is untouched.
7. Edit a row's date by +1 day → **This and following entries** → all later rows shift by +1 day.
8. Confirm: editing Employee A's series does not touch Employee B's parallel series (each got its own `series_uid`).

Note any defects and fix before commit.

- [ ] **Step 8: Commit**

```bash
git add frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx
git commit -m "feat(workplan-edit): scope picker — this entry only vs this and following"
```

---

## Final verification

- [ ] **Step 1: Run the full backend suite**

Run: `python manage.py test core.worklog -v 2`
Expected: All worklog tests pass.

- [ ] **Step 2: Run the full frontend suite + build**

Run: `cd frontend/task-tracker && npm test && npm run build`
Expected: All tests pass; build succeeds.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin Work_Plan_Rvsn
```

(Per durable user instructions, auto-push is approved for this feature branch.)
