# Conveyance — Recurring Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark a Conveyance entry as recurring (`monthly` / `half_yearly` / `yearly`) over a `start_month`–`end_month` window. The backend materialises one `ConveyanceEntry` per period sharing a `series_uid`; approve/reject is series-wide; edit/delete take a `?scope=row|series|series_forward` query param. The transactions list collapses each series to a single headline row with an expand chevron.

**Architecture:** Three new fields on `ConveyanceEntry` (`frequency`, `series_uid`, `start_month`, `end_month`) plus a small period-date helper module. `ConveyanceEntrySerializer` validates frequency+window cross-field; the viewset's existing transaction in `perform_create` is extended to fan-out via `bulk_create`. Approve/reject and update/delete fan out via `series_uid`. Frontend adds three form fields, a 3-button scope modal, and client-side series grouping with a headline picker.

**Tech Stack:** Django 6, DRF, Django Channels (existing), React 19 + Vite + TypeScript + Vitest (existing). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-30-conveyance-recurring-entries-design.md`](../specs/2026-04-30-conveyance-recurring-entries-design.md).

---

## File Layout

**Backend (created):**

| File | Purpose |
|---|---|
| `core/conveyance/recurrence.py` | Pure helper: build the list of period start dates for a frequency+window. |
| `core/conveyance/migrations/0002_recurring_fields.py` | Adds `frequency`, `series_uid`, `start_month`, `end_month` + index. |

**Backend (modified):**

| File | Change |
|---|---|
| `core/conveyance/models.py` | Add 4 new fields + `Index(fields=["org", "series_uid"])`. |
| `core/conveyance/serializers.py` | Expose new fields read/write; cross-field validate; immutable on update. |
| `core/conveyance/views.py` | `perform_create` materialisation; `approve`/`reject` series fan-out; `?scope=` on update/delete. |
| `core/conveyance/tests.py` | New tests for recurrence, scopes, validation, list shape. |

**Frontend (created):**

| File | Purpose |
|---|---|
| `frontend/task-tracker/src/components/conveyance/conveyanceRecurrenceHelpers.ts` | Pure helpers: validate window, group by series, pick headline, build series badge label. |
| `frontend/task-tracker/src/components/conveyance/ConveyanceScopeDialog.tsx` | 3-button "this row / entire series / from this month" modal. |
| `frontend/task-tracker/src/__tests__/components/conveyanceRecurrenceHelpers.test.ts` | Vitest tests for the helpers. |

**Frontend (modified):**

| File | Change |
|---|---|
| `frontend/task-tracker/src/types/api/conveyance.ts` | Add `frequency`, `series_uid`, `start_month`, `end_month` to `ConveyanceEntry`. |
| `frontend/task-tracker/src/utils/conveyanceApi.ts` | `updateEntry`/`deleteEntry` accept optional `scope`. |
| `frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts` | Extend `validateFormInputs` and `buildCreateFormData` for the new fields. |
| `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx` | Render Frequency / Start / End fields; hide Date when recurring; read-only on edit. |
| `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx` | Group by series, render headline row, expand chevron, route Edit/Delete via scope dialog. |
| `frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts` | Tests for frequency-aware validation/form-data. |

---

## Task 1 — Backend: period-date helper (TDD)

This computes the list of `date(1)` values from `start_month` through `end_month` given a frequency. Pure function, no DB — easy to test.

**Files:**
- Create: `core/conveyance/recurrence.py`
- Test: `core/conveyance/tests.py` (append a new `RecurrenceHelperTests` class)

- [ ] **Step 1.1: Write the failing tests**

Append to `core/conveyance/tests.py`:

```python
import datetime as _dt

from core.conveyance.recurrence import period_dates


class RecurrenceHelperTests(TestCase):
    def test_one_time_returns_single_date(self):
        result = period_dates("one_time", _dt.date(2026, 4, 1), _dt.date(2026, 4, 1))
        self.assertEqual(result, [_dt.date(2026, 4, 1)])

    def test_monthly_inclusive_range(self):
        result = period_dates("monthly", _dt.date(2026, 1, 1), _dt.date(2026, 12, 1))
        self.assertEqual(len(result), 12)
        self.assertEqual(result[0], _dt.date(2026, 1, 1))
        self.assertEqual(result[-1], _dt.date(2026, 12, 1))
        self.assertEqual(result[3], _dt.date(2026, 4, 1))

    def test_monthly_crosses_year_boundary(self):
        result = period_dates("monthly", _dt.date(2026, 11, 1), _dt.date(2027, 2, 1))
        self.assertEqual(result, [
            _dt.date(2026, 11, 1),
            _dt.date(2026, 12, 1),
            _dt.date(2027, 1, 1),
            _dt.date(2027, 2, 1),
        ])

    def test_half_yearly_step(self):
        result = period_dates("half_yearly", _dt.date(2026, 1, 1), _dt.date(2027, 6, 1))
        self.assertEqual(result, [
            _dt.date(2026, 1, 1),
            _dt.date(2026, 7, 1),
            _dt.date(2027, 1, 1),
        ])

    def test_yearly_step(self):
        result = period_dates("yearly", _dt.date(2026, 1, 1), _dt.date(2028, 12, 1))
        self.assertEqual(result, [
            _dt.date(2026, 1, 1),
            _dt.date(2027, 1, 1),
            _dt.date(2028, 1, 1),
        ])

    def test_end_before_start_returns_empty(self):
        result = period_dates("monthly", _dt.date(2026, 6, 1), _dt.date(2026, 3, 1))
        self.assertEqual(result, [])

    def test_unknown_frequency_raises(self):
        with self.assertRaises(ValueError):
            period_dates("weekly", _dt.date(2026, 1, 1), _dt.date(2026, 2, 1))

    def test_dates_normalised_to_first_of_month(self):
        # Caller may pass any day; helper still steps from the 1st.
        result = period_dates("monthly", _dt.date(2026, 1, 15), _dt.date(2026, 3, 25))
        self.assertEqual(result, [
            _dt.date(2026, 1, 1),
            _dt.date(2026, 2, 1),
            _dt.date(2026, 3, 1),
        ])
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
uv run python manage.py test core.conveyance.tests.RecurrenceHelperTests -v 2
```

Expected: ImportError / ModuleNotFoundError for `core.conveyance.recurrence`.

- [ ] **Step 1.3: Implement the helper**

Create `core/conveyance/recurrence.py`:

```python
"""Period-date computation for recurring Conveyance entries.

Pure functions only — no DB, no Django imports. Kept in its own module so
the materialiser in ``views.py`` and the serializer's cross-field validator
can both import without a circular dependency.
"""

import datetime
from typing import List

# Step in months for each frequency. ``one_time`` is special-cased.
_STEP_MONTHS = {
    "monthly": 1,
    "half_yearly": 6,
    "yearly": 12,
}


def _first_of_month(d: datetime.date) -> datetime.date:
    return d.replace(day=1)


def _add_months(d: datetime.date, n: int) -> datetime.date:
    """Return d shifted by n months, snapped to the 1st."""
    total = d.year * 12 + (d.month - 1) + n
    year, month0 = divmod(total, 12)
    return datetime.date(year, month0 + 1, 1)


def period_dates(
    frequency: str,
    start_month: datetime.date,
    end_month: datetime.date,
) -> List[datetime.date]:
    """Return the list of period-start dates (1st of month) for the series.

    - ``one_time`` returns ``[start_month]`` snapped to the 1st.
    - Recurring frequencies step from start to end inclusive; if end < start
      the result is ``[]``.
    - Unknown frequency raises ``ValueError``.
    """
    start = _first_of_month(start_month)
    end = _first_of_month(end_month)

    if frequency == "one_time":
        return [start]
    if frequency not in _STEP_MONTHS:
        raise ValueError(f"Unknown frequency: {frequency!r}")
    if end < start:
        return []

    step = _STEP_MONTHS[frequency]
    out: List[datetime.date] = []
    cursor = start
    while cursor <= end:
        out.append(cursor)
        cursor = _add_months(cursor, step)
    return out
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
uv run python manage.py test core.conveyance.tests.RecurrenceHelperTests -v 2
```

Expected: 8 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add core/conveyance/recurrence.py core/conveyance/tests.py
git commit -m "feat(conveyance): period_dates helper for series materialisation"
```

---

## Task 2 — Backend: model fields + migration

**Files:**
- Modify: `core/conveyance/models.py`
- Create: `core/conveyance/migrations/0002_recurring_fields.py`

- [ ] **Step 2.1: Add fields and choices to the model**

Edit `core/conveyance/models.py`. At the top of the `ConveyanceEntry` class, alongside the existing `STATUS_CHOICES`, add:

```python
    FREQUENCY_CHOICES = [
        ("one_time", "One-time"),
        ("monthly", "Monthly"),
        ("half_yearly", "Half-yearly"),
        ("yearly", "Yearly"),
    ]
```

After the existing `created_by` field (around line 66), before `class Meta`, add:

```python
    frequency = models.CharField(
        max_length=12,
        choices=FREQUENCY_CHOICES,
        default="one_time",
        db_index=True,
    )
    series_uid = models.UUIDField(null=True, blank=True, db_index=True)
    start_month = models.DateField(null=True, blank=True)
    end_month = models.DateField(null=True, blank=True)
```

Also update the type-hint block at the top of the class so pyright is happy:

```python
    series_uid: uuid.UUID | None
```

(insert next to the other typing hints, after `created_by_id: int | None`).

In the `Meta.indexes` list, append:

```python
            models.Index(fields=["org", "series_uid"]),
```

- [ ] **Step 2.2: Generate the migration**

```bash
uv run python manage.py makemigrations conveyance --name recurring_fields
```

Expected stdout: a new file `core/conveyance/migrations/0002_recurring_fields.py` is created listing 4 `AddField` operations and an `AddIndex`.

Open the file and confirm the `dependencies` list contains `("conveyance", "0001_initial")` and nothing else conveyance-related. Sanity-check no other unrelated changes leaked in (if so, revert `models.py` to only the intended changes and re-run).

- [ ] **Step 2.3: Apply the migration**

```bash
uv run python manage.py migrate conveyance
```

Expected: `Applying conveyance.0002_recurring_fields... OK`.

- [ ] **Step 2.4: Add a model-level test for defaults**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntryDefaultsTests(TestCase):
    def test_existing_style_create_defaults_to_one_time(self):
        org, user = _make_org_user("emp")
        master = _make_client(org)
        entry = _make_entry(org, user, master, reason="taxi")
        self.assertEqual(entry.frequency, "one_time")
        self.assertIsNone(entry.series_uid)
        self.assertIsNone(entry.start_month)
        self.assertIsNone(entry.end_month)
```

- [ ] **Step 2.5: Run tests**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntryDefaultsTests -v 2
```

Expected: 1 test passes.

- [ ] **Step 2.6: Commit**

```bash
git add core/conveyance/models.py core/conveyance/migrations/0002_recurring_fields.py core/conveyance/tests.py
git commit -m "feat(conveyance): add frequency, series_uid, start_month, end_month fields"
```

---

## Task 3 — Backend: serializer fields + cross-field validation (TDD)

**Files:**
- Modify: `core/conveyance/serializers.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 3.1: Write the failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntrySerializerRecurringValidationTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("emp", role="employee")
        self.master = _make_client(self.org)
        self.factory = APIRequestFactory()

    def _ctx(self):
        request = self.factory.post("/")
        request.user = self.user
        return {"request": request}

    def _base_payload(self, **overrides):
        payload = {
            "date": "2026-04-18",
            "client": str(self.master.uid),
            "reason": "taxi",
            "amount": "100.00",
            "claimable": True,
            "frequency": "one_time",
        }
        payload.update(overrides)
        return payload

    def test_one_time_rejects_start_or_end_month(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(start_month="2026-04-01"),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("start_month", str(s.errors))

    def test_recurring_requires_both_months(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(frequency="monthly", start_month="2026-04-01"),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("end_month", str(s.errors))

    def test_recurring_rejects_end_before_start(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(
                frequency="monthly",
                start_month="2026-06-01",
                end_month="2026-03-01",
            ),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("end_month", str(s.errors))

    def test_recurring_normalises_to_first_of_month(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(
                frequency="monthly",
                start_month="2026-04-15",
                end_month="2026-06-20",
            ),
            context=self._ctx(),
        )
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["start_month"], _dt.date(2026, 4, 1))
        self.assertEqual(s.validated_data["end_month"], _dt.date(2026, 6, 1))

    def test_one_time_keeps_future_date_check(self):
        future = (_dt.date.today() + _dt.timedelta(days=30)).isoformat()
        s = ConveyanceEntrySerializer(
            data=self._base_payload(date=future),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("date", s.errors)

    def test_recurring_skips_future_date_check(self):
        # Future start_month is the whole point of recurring.
        future = _dt.date.today().replace(day=1) + _dt.timedelta(days=400)
        s = ConveyanceEntrySerializer(
            data=self._base_payload(
                frequency="monthly",
                start_month=future.isoformat(),
                end_month=future.isoformat(),
            ),
            context=self._ctx(),
        )
        self.assertTrue(s.is_valid(), s.errors)
```

- [ ] **Step 3.2: Run tests to verify they fail**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntrySerializerRecurringValidationTests -v 2
```

Expected: 6 failures (fields not declared on serializer, no cross-field validation, future-date check still firing).

- [ ] **Step 3.3: Update the serializer**

Edit `core/conveyance/serializers.py`. At the top, add the import:

```python
from .recurrence import period_dates  # noqa: F401  -- imported here so views.py uses the same module path
```

In `ConveyanceEntrySerializer.Meta.fields`, after `"claimable"` and before `"status"`, insert:

```python
            "frequency",
            "series_uid",
            "start_month",
            "end_month",
```

In `read_only_fields`, after `"id"` and `"uid"`, append:

```python
            "series_uid",
```

(`series_uid` is server-assigned and never accepted from a payload.)

Replace the existing `validate_date` method with:

```python
    def validate_date(self, value):
        from django.utils import timezone

        # Future-date rule applies only to one-time entries; the materialiser
        # handles the window check for recurring submissions.
        if self.initial_data.get("frequency", "one_time") != "one_time":
            return value
        if value > timezone.localdate():
            raise serializers.ValidationError("Date cannot be in the future")
        return value
```

After `validate_client`, add a cross-field `validate`:

```python
    def validate(self, attrs):
        import datetime

        frequency = attrs.get("frequency", getattr(self.instance, "frequency", "one_time"))
        start_month = attrs.get("start_month")
        end_month = attrs.get("end_month")

        if frequency == "one_time":
            if start_month or end_month:
                raise serializers.ValidationError({
                    "start_month": "Only set start_month / end_month for recurring entries.",
                })
            return attrs

        # Recurring: both months required, end >= start, normalise to 1st.
        missing = {}
        if not start_month:
            missing["start_month"] = "Required for recurring entries."
        if not end_month:
            missing["end_month"] = "Required for recurring entries."
        if missing:
            raise serializers.ValidationError(missing)

        start_norm = start_month.replace(day=1)
        end_norm = end_month.replace(day=1)
        if end_norm < start_norm:
            raise serializers.ValidationError({
                "end_month": "End month must be on or after start month.",
            })

        attrs["start_month"] = start_norm
        attrs["end_month"] = end_norm
        return attrs
```

The serializer's `update` path must reject changes to immutable fields. Add this method (place it next to `create`):

```python
    def update(self, instance, validated_data):
        # Frequency / series_uid / start_month / end_month are immutable once
        # the row exists. Silently dropping is friendlier than 400ing because
        # the frontend will sometimes resend the full row; the server is the
        # source of truth.
        for k in ("frequency", "start_month", "end_month"):
            validated_data.pop(k, None)
        return super().update(instance, validated_data)
```

- [ ] **Step 3.4: Run tests to verify they pass**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntrySerializerRecurringValidationTests -v 2
```

Expected: 6 tests pass.

- [ ] **Step 3.5: Run the full conveyance test suite to catch regressions**

```bash
uv run python manage.py test core.conveyance -v 2
```

Expected: every existing test still passes.

- [ ] **Step 3.6: Commit**

```bash
git add core/conveyance/serializers.py core/conveyance/tests.py
git commit -m "feat(conveyance): serializer accepts frequency/start_month/end_month with cross-field validation"
```

---

## Task 4 — Backend: materialise series rows in `perform_create` (TDD)

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 4.1: Write the failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntryMaterialisationTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def test_one_time_create_unchanged(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "taxi",
            "amount": "100.00",
            "claimable": True,
            "frequency": "one_time",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 1)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.frequency, "one_time")
        self.assertIsNone(entry.series_uid)

    def test_monthly_creates_one_row_per_month(self):
        payload = {
            "client": str(self.client_master.uid),
            "reason": "subscription",
            "amount": "500.00",
            "claimable": True,
            "frequency": "monthly",
            "start_month": "2026-01-01",
            "end_month": "2026-12-01",
            # date is required by the model but ignored for recurring; send today
            "date": _dt.date.today().isoformat(),
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 12)

        rows = ConveyanceEntry.objects.order_by("date")
        self.assertEqual(rows[0].date, _dt.date(2026, 1, 1))
        self.assertEqual(rows[11].date, _dt.date(2026, 12, 1))

        # All siblings share the same series_uid.
        series_uids = {r.series_uid for r in rows}
        self.assertEqual(len(series_uids), 1)
        self.assertIsNotNone(series_uids.pop())

        # Every row has identical core fields.
        for r in rows:
            self.assertEqual(r.frequency, "monthly")
            self.assertEqual(r.reason, "subscription")
            self.assertEqual(str(r.amount), "500.00")
            self.assertEqual(r.start_month, _dt.date(2026, 1, 1))
            self.assertEqual(r.end_month, _dt.date(2026, 12, 1))
            self.assertEqual(r.status, "pending")

    def test_yearly_three_year_window(self):
        payload = {
            "client": str(self.client_master.uid),
            "reason": "renewal",
            "amount": "12000.00",
            "claimable": True,
            "frequency": "yearly",
            "start_month": "2026-01-01",
            "end_month": "2028-01-01",
            "date": _dt.date.today().isoformat(),
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 3)
        years = sorted(r.date.year for r in ConveyanceEntry.objects.all())
        self.assertEqual(years, [2026, 2027, 2028])

    def test_recurring_with_attachments_duplicates_per_sibling(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        f = SimpleUploadedFile("receipt.pdf", b"%PDF-1.4 fake", content_type="application/pdf")
        res = self.api.post(
            "/api/conveyance_entries/",
            {
                "client": str(self.client_master.uid),
                "reason": "subscription",
                "amount": "500.00",
                "claimable": "true",
                "frequency": "monthly",
                "start_month": "2026-01-01",
                "end_month": "2026-03-01",
                "date": _dt.date.today().isoformat(),
                "attachments": f,
            },
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 3)
        # 1 attachment per sibling.
        self.assertEqual(ConveyanceAttachment.objects.count(), 3)
        # Cleanup the test files we just wrote to MEDIA_ROOT.
        for att in ConveyanceAttachment.objects.all():
            if att.file:
                try:
                    os.remove(att.file.path)
                except FileNotFoundError:
                    pass
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntryMaterialisationTests -v 2
```

Expected: 3 of 4 tests fail (`test_one_time_create_unchanged` should already pass because the serializer accepts the new fields; the materialisation tests fail because `perform_create` still saves a single row).

- [ ] **Step 4.3: Implement materialisation in `perform_create`**

Edit `core/conveyance/views.py`. At the top of the file, add:

```python
import uuid

from .recurrence import period_dates
```

Replace the body of `perform_create` (lines 94–126) with:

```python
    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        org, err = resolve_create_org(self.request)
        if err is not None:
            exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
            raise exc_cls(err.data)

        target_employee: User = user
        employee_uid = self.request.data.get("employee_uid")
        if employee_uid:
            if not user.is_admin_in(org):
                raise PermissionDenied({"detail": "Only an admin of the target org may set employee_uid"})
            looked_up = User.objects.filter(uid=employee_uid, memberships__org=org).first()
            if looked_up is None:
                raise ValidationError({"employee_uid": "User is not a member of the target organisation"})
            target_employee = looked_up

        files = self.request.FILES.getlist("attachments")
        labels = self.request.POST.getlist("attachment_labels")
        for f in files:
            validate_upload(f)

        frequency = serializer.validated_data.get("frequency", "one_time")

        with transaction.atomic():
            if frequency == "one_time":
                entry = serializer.save(employee=target_employee, created_by=user, org=org)
                self._attach_files(entry, files, labels, user)
                # Pin the saved instance so DRF's response body uses the
                # full object (matches behaviour before the recurring path).
                serializer.instance = entry
                return

            # Recurring: build the period list and create one row per period.
            start = serializer.validated_data["start_month"]
            end = serializer.validated_data["end_month"]
            dates = period_dates(frequency, start, end)
            if not dates:
                raise ValidationError({"end_month": "No periods in the requested window."})

            series_uid = uuid.uuid4()
            shared = {
                "client": serializer.validated_data["client"],
                "reason": serializer.validated_data["reason"],
                "amount": serializer.validated_data["amount"],
                "claimable": serializer.validated_data.get("claimable", True),
                "frequency": frequency,
                "start_month": start,
                "end_month": end,
                "series_uid": series_uid,
                "employee": target_employee,
                "created_by": user,
                "org": org,
            }
            siblings = [
                ConveyanceEntry(date=d, **shared)
                for d in dates
            ]
            ConveyanceEntry.objects.bulk_create(siblings)

            # Re-fetch siblings so they have PKs (bulk_create on SQLite returns
            # them, but defensive) and attach files to every one.
            siblings = list(
                ConveyanceEntry.objects.filter(series_uid=series_uid).order_by("date")
            )
            for sibling in siblings:
                # Per spec §6: each sibling gets its own copy of every file.
                # Re-open each uploaded file from the start so multiple writes
                # of the same source don't share a cursor.
                for f in files:
                    f.seek(0)
                self._attach_files(sibling, files, labels, user)

            # Pick the headline sibling: most recent on-or-before today, else
            # earliest. Drives the 201 response shape.
            today = _now_local_date()
            past = [s for s in siblings if s.date <= today]
            headline = past[-1] if past else siblings[0]
            serializer.instance = headline

    def _attach_files(self, entry, files, labels, user):
        for idx, f in enumerate(files):
            label = labels[idx].strip()[:100] if idx < len(labels) else ""
            ConveyanceAttachment.objects.create(
                entry=entry,
                file=f,
                label=label,
                uploaded_by=user,
            )
```

Add a small helper near the top of the file (after the imports):

```python
def _now_local_date():
    from django.utils import timezone
    return timezone.localdate()
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntryMaterialisationTests -v 2
```

Expected: 4 tests pass.

- [ ] **Step 4.5: Run the full conveyance suite**

```bash
uv run python manage.py test core.conveyance -v 2
```

Expected: every existing test still passes.

- [ ] **Step 4.6: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): materialise per-period rows for recurring entries"
```

---

## Task 5 — Backend: series-wide approve / reject (TDD)

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 5.1: Write the failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntrySeriesApproveRejectTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def _make_series(self, *, count=3, status="pending"):
        sid = uuid.uuid4()
        rows = []
        for i in range(count):
            rows.append(ConveyanceEntry.objects.create(
                org=self.org,
                employee=self.emp,
                client=self.client_master,
                reason="subscription",
                amount="100.00",
                claimable=True,
                date=_dt.date(2026, 1 + i, 1),
                frequency="monthly",
                series_uid=sid,
                start_month=_dt.date(2026, 1, 1),
                end_month=_dt.date(2026, 1 + count - 1, 1),
                status=status,
            ))
        return rows

    def test_approve_fans_out_across_series(self):
        rows = self._make_series(count=3)
        target_uid = rows[1].uid  # any sibling
        res = self.api.post(f"/api/conveyance_entries/{target_uid}/approve/")
        self.assertEqual(res.status_code, 200, res.data)
        statuses = list(ConveyanceEntry.objects.values_list("status", flat=True))
        self.assertEqual(statuses, ["approved", "approved", "approved"])

    def test_reject_fans_out_with_required_note(self):
        rows = self._make_series(count=2)
        res = self.api.post(
            f"/api/conveyance_entries/{rows[0].uid}/reject/",
            {"review_note": "duplicate of series X"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        for r in ConveyanceEntry.objects.all():
            self.assertEqual(r.status, "rejected")
            self.assertEqual(r.review_note, "duplicate of series X")

    def test_one_time_approve_unchanged(self):
        # Sanity: a one-time entry approves only itself.
        entry = _make_entry(self.org, self.emp, self.client_master, reason="taxi")
        res = self.api.post(f"/api/conveyance_entries/{entry.uid}/approve/")
        self.assertEqual(res.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual(entry.status, "approved")

    def test_approve_skips_terminal_siblings(self):
        rows = self._make_series(count=3)
        # Pretend one is already approved (e.g. via a manual admin override).
        rows[0].status = "approved"
        rows[0].save()
        res = self.api.post(f"/api/conveyance_entries/{rows[2].uid}/approve/")
        self.assertEqual(res.status_code, 200, res.data)
        # All three end up approved (the already-approved row was a no-op).
        self.assertEqual(
            list(ConveyanceEntry.objects.order_by("date").values_list("status", flat=True)),
            ["approved", "approved", "approved"],
        )
        # Audit log row_count counts only the rows actually flipped.
        from core.audit.models import AuditLog
        log = AuditLog.objects.filter(action="conveyance.approve").latest("created_at")
        self.assertEqual(log.changes.get("row_count"), 2)
```

- [ ] **Step 5.2: Run tests to verify they fail**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntrySeriesApproveRejectTests -v 2
```

Expected: failures (only the target row gets approved/rejected; row_count not in audit changes).

- [ ] **Step 5.3: Replace the `approve` action with series fan-out**

Edit `core/conveyance/views.py`. Replace the existing `approve` method with:

```python
    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from django.utils import timezone

        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        is_admin_in_org = user.is_admin_in(entry.org_id)
        if entry.employee_id == user.id and not is_admin_in_org:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied({"detail": "Manager or admin role required in the entry's organisation"})
        if entry.status != "pending" and entry.series_uid is None:
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )

        # Fan-out across the series (a one-time row's series is itself).
        if entry.series_uid is None:
            rows = [entry]
        else:
            rows = list(
                ConveyanceEntry.objects.filter(
                    series_uid=entry.series_uid,
                    status="pending",
                )
            )
            if not rows:
                return Response(
                    {"detail": "No pending entries in this series"},
                    status=409,
                )

        review_note = (request.data.get("review_note") or "").strip()[:500]
        now = timezone.now()
        flipped = 0
        with transaction.atomic():
            for r in rows:
                r.status = "approved"
                r.reviewed_by = user
                r.reviewed_at = now
                r.review_note = review_note
                r.save()
                flipped += 1

        audit_log(
            user,
            "conveyance.approve",
            resource_type="conveyance_entry",
            resource_id=entry.series_uid or entry.uid,
            changes={
                "status": "approved",
                "row_count": flipped,
                "series_uid": str(entry.series_uid) if entry.series_uid else None,
            },
            request=request,
        )

        # Broadcast every flipped row so open clients get fresh data; the
        # frontend coalesces these via its list reload.
        for r in rows:
            broadcast(
                "conveyance-entries",
                "UPDATE",
                ConveyanceEntrySerializer(r, context={"request": request}).data,
            )
        # 200 body is the entry the caller acted on (matches old behaviour).
        entry.refresh_from_db()
        return Response(ConveyanceEntrySerializer(entry, context={"request": request}).data)
```

Replace the existing `reject` method with the same pattern:

```python
    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        from django.utils import timezone

        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        note = (request.data.get("review_note") or "").strip()
        if len(note) < 3:
            return Response(
                {"review_note": "A rejection note of at least 3 characters is required"},
                status=400,
            )
        is_admin_in_org = user.is_admin_in(entry.org_id)
        if entry.employee_id == user.id and not is_admin_in_org:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied({"detail": "Manager or admin role required in the entry's organisation"})
        if entry.status != "pending" and entry.series_uid is None:
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )

        if entry.series_uid is None:
            rows = [entry]
        else:
            rows = list(
                ConveyanceEntry.objects.filter(
                    series_uid=entry.series_uid,
                    status="pending",
                )
            )
            if not rows:
                return Response(
                    {"detail": "No pending entries in this series"},
                    status=409,
                )

        now = timezone.now()
        flipped = 0
        truncated = note[:500]
        with transaction.atomic():
            for r in rows:
                r.status = "rejected"
                r.reviewed_by = user
                r.reviewed_at = now
                r.review_note = truncated
                r.save()
                flipped += 1

        audit_log(
            user,
            "conveyance.reject",
            resource_type="conveyance_entry",
            resource_id=entry.series_uid or entry.uid,
            changes={
                "status": "rejected",
                "reason": truncated,
                "row_count": flipped,
                "series_uid": str(entry.series_uid) if entry.series_uid else None,
            },
            request=request,
        )

        for r in rows:
            broadcast(
                "conveyance-entries",
                "UPDATE",
                ConveyanceEntrySerializer(r, context={"request": request}).data,
            )
        entry.refresh_from_db()
        return Response(ConveyanceEntrySerializer(entry, context={"request": request}).data)
```

- [ ] **Step 5.4: Run tests**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntrySeriesApproveRejectTests -v 2
```

Expected: 4 tests pass.

- [ ] **Step 5.5: Run the full conveyance suite**

```bash
uv run python manage.py test core.conveyance -v 2
```

Expected: every existing test still passes.

- [ ] **Step 5.6: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): fan-out approve/reject across series_uid siblings"
```

---

## Task 6 — Backend: scoped update / delete (TDD)

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 6.1: Write the failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntryScopedEditDeleteTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.admin)

        self.sid = uuid.uuid4()
        self.rows = []
        for i in range(4):
            self.rows.append(ConveyanceEntry.objects.create(
                org=self.org,
                employee=self.emp,
                client=self.client_master,
                reason="subscription",
                amount="100.00",
                claimable=True,
                date=_dt.date(2026, 1 + i, 1),
                frequency="monthly",
                series_uid=self.sid,
                start_month=_dt.date(2026, 1, 1),
                end_month=_dt.date(2026, 4, 1),
                status="pending",
            ))

    def test_scope_row_default(self):
        # The middle row's amount changes; siblings unaffected.
        target = self.rows[1]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/",
            {"amount": "999.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        amounts = sorted(str(r.amount) for r in ConveyanceEntry.objects.all())
        self.assertEqual(amounts, ["100.00", "100.00", "100.00", "999.00"])

    def test_scope_series_propagates_to_all(self):
        target = self.rows[2]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series",
            {"amount": "555.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        amounts = sorted(str(r.amount) for r in ConveyanceEntry.objects.all())
        self.assertEqual(amounts, ["555.00", "555.00", "555.00", "555.00"])

    def test_scope_series_forward_only_clicked_and_later(self):
        target = self.rows[2]  # March
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series_forward",
            {"amount": "777.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        rows_by_month = {r.date.month: str(r.amount) for r in ConveyanceEntry.objects.all()}
        self.assertEqual(rows_by_month[1], "100.00")
        self.assertEqual(rows_by_month[2], "100.00")
        self.assertEqual(rows_by_month[3], "777.00")
        self.assertEqual(rows_by_month[4], "777.00")

    def test_scope_series_does_not_propagate_date(self):
        target = self.rows[0]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series",
            {"date": "2026-06-01", "reason": "renamed"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        # Reason changed everywhere; dates are untouched.
        for r in ConveyanceEntry.objects.all().order_by("date"):
            self.assertEqual(r.reason, "renamed")
        months = [r.date.month for r in ConveyanceEntry.objects.order_by("date")]
        self.assertEqual(months, [1, 2, 3, 4])

    def test_scope_invalid_for_one_time(self):
        entry = _make_entry(self.org, self.emp, self.client_master, reason="taxi")
        res = self.api.patch(
            f"/api/conveyance_entries/{entry.uid}/?scope=series",
            {"amount": "200.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("scope", res.data)

    def test_scope_unknown_value_rejected(self):
        target = self.rows[0]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=bogus",
            {"amount": "1.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_delete_scope_series_removes_all_siblings(self):
        target = self.rows[1]
        res = self.api.delete(f"/api/conveyance_entries/{target.uid}/?scope=series")
        self.assertEqual(res.status_code, 204, getattr(res, "data", None))
        self.assertEqual(ConveyanceEntry.objects.count(), 0)

    def test_delete_scope_series_forward_keeps_earlier(self):
        target = self.rows[2]  # March
        res = self.api.delete(f"/api/conveyance_entries/{target.uid}/?scope=series_forward")
        self.assertEqual(res.status_code, 204)
        remaining_months = sorted(r.date.month for r in ConveyanceEntry.objects.all())
        self.assertEqual(remaining_months, [1, 2])

    def test_immutable_fields_silently_dropped(self):
        target = self.rows[0]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series",
            {"frequency": "yearly", "start_month": "2099-01-01"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        for r in ConveyanceEntry.objects.all():
            self.assertEqual(r.frequency, "monthly")  # unchanged
            self.assertEqual(r.start_month, _dt.date(2026, 1, 1))
```

- [ ] **Step 6.2: Run tests to verify they fail**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntryScopedEditDeleteTests -v 2
```

Expected: most fail (no scope handling yet).

- [ ] **Step 6.3: Extend `perform_update` and `perform_destroy` for scope**

Edit `core/conveyance/views.py`. Add a small helper near the other private methods:

```python
    _ALLOWED_SCOPES = {"row", "series", "series_forward"}

    def _resolve_scope(self, request, entry):
        scope = request.query_params.get("scope") or "row"
        if scope not in self._ALLOWED_SCOPES:
            raise ValidationError({"scope": f"Must be one of {sorted(self._ALLOWED_SCOPES)}"})
        if scope != "row" and entry.series_uid is None:
            raise ValidationError({"scope": "row scope only — entry is not part of a series"})
        return scope

    def _siblings_for_scope(self, entry, scope):
        if scope == "row":
            return [entry]
        qs = ConveyanceEntry.objects.filter(series_uid=entry.series_uid)
        if scope == "series_forward":
            qs = qs.filter(date__gte=entry.date)
        return list(qs)
```

Replace `perform_update` with:

```python
    def perform_update(self, serializer):
        request = self.request
        instance = serializer.instance
        scope = self._resolve_scope(request, instance)
        targets = self._siblings_for_scope(instance, scope)

        # Mutability check runs against every target before any write.
        for t in targets:
            self._assert_mutable_for_caller(t)

        # Compute the patch payload once; date is excluded from any series
        # propagation so each sibling keeps its 1st-of-month date. The base
        # serializer.update() already strips frequency/start/end (immutable).
        patch_fields = dict(serializer.validated_data)
        if scope != "row":
            patch_fields.pop("date", None)

        with transaction.atomic():
            # Save the clicked row through the serializer so DRF runs the
            # standard field-by-field assignment + UpdateModelMixin response
            # contract.
            serializer.save()

            if scope == "row":
                return

            # Apply the same patch to siblings (excluding the clicked row,
            # which the serializer already saved).
            other_uids = [t.uid for t in targets if t.uid != instance.uid]
            if not other_uids:
                return
            ConveyanceEntry.objects.filter(uid__in=other_uids).update(**patch_fields)
```

Replace `perform_destroy` with:

```python
    def perform_destroy(self, instance):
        request = self.request
        scope = self._resolve_scope(request, instance)
        targets = self._siblings_for_scope(instance, scope)
        for t in targets:
            self._assert_mutable_for_caller(t)
        with transaction.atomic():
            for t in targets:
                for attachment in t.attachments.all():
                    if attachment.file:
                        attachment.file.delete(save=False)
                t.delete()
```

- [ ] **Step 6.4: Run tests**

```bash
uv run python manage.py test core.conveyance.tests.ConveyanceEntryScopedEditDeleteTests -v 2
```

Expected: 9 tests pass.

- [ ] **Step 6.5: Run the full conveyance suite**

```bash
uv run python manage.py test core.conveyance -v 2
```

Expected: every existing test still passes.

- [ ] **Step 6.6: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): support ?scope=row|series|series_forward on update/delete"
```

---

## Task 7 — Frontend: types + API client

**Files:**
- Modify: `frontend/task-tracker/src/types/api/conveyance.ts`
- Modify: `frontend/task-tracker/src/utils/conveyanceApi.ts`

- [ ] **Step 7.1: Add new fields to `ConveyanceEntry`**

Edit `frontend/task-tracker/src/types/api/conveyance.ts`. Inside the `ConveyanceEntry` interface, after `attachments` and before `created_by_detail`, add:

```ts
  frequency: "one_time" | "monthly" | "half_yearly" | "yearly";
  series_uid: string | null;
  start_month: string | null;   // YYYY-MM-DD (1st of month) or null
  end_month: string | null;
```

Above the interface, add a reusable `Frequency` alias and re-export from the same file (matches the `ConveyanceStatus` pattern already in this file):

```ts
export type ConveyanceFrequency = "one_time" | "monthly" | "half_yearly" | "yearly";
```

Replace the inline literal in `ConveyanceEntry.frequency` with the alias.

- [ ] **Step 7.2: Add `scope` parameter to `updateEntry` / `deleteEntry`**

Edit `frontend/task-tracker/src/utils/conveyanceApi.ts`. Add the type:

```ts
export type EntryScope = "row" | "series" | "series_forward";
```

Replace the existing `updateEntry` and `deleteEntry` exports with:

```ts
function withScopeQuery(uid: string, scope?: EntryScope): string {
  return scope ? `/conveyance_entries/${uid}/?scope=${scope}` : `/conveyance_entries/${uid}/`;
}

export function updateEntry(
  uid: string,
  body: Partial<Pick<ConveyanceEntry, "date" | "reason" | "amount" | "claimable">> & { client?: string },
  scope?: EntryScope,
): Promise<ConveyanceEntry> {
  return apiPatch<ConveyanceEntry>(withScopeQuery(uid, scope), body);
}

export function deleteEntry(uid: string, scope?: EntryScope): Promise<void> {
  return apiDelete(withScopeQuery(uid, scope));
}
```

- [ ] **Step 7.3: Type-check**

```bash
cd frontend/task-tracker && npm run build
```

Expected: build succeeds (compile-only validation; some downstream call sites may not yet pass `scope`, which is fine because the parameter is optional).

- [ ] **Step 7.4: Commit**

```bash
git add frontend/task-tracker/src/types/api/conveyance.ts frontend/task-tracker/src/utils/conveyanceApi.ts
git commit -m "feat(conveyance): frontend types + scoped update/delete in API client"
```

---

## Task 8 — Frontend: form helpers (validateFormInputs / buildCreateFormData) (TDD)

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts`
- Modify: `frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts`

- [ ] **Step 8.1: Write the failing tests**

Edit `frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts`. Append a new `describe` block at the bottom of the file:

```ts
import type { ConveyanceFrequency } from "@/types/api/conveyance";

describe("validateFormInputs — frequency", () => {
  const baseRecurring = {
    reason: "monthly subscription",
    amount: "500",
    client: "client-uid-abc",
    org: "org-uid-abc",
    files: [],
    frequency: "monthly" as ConveyanceFrequency,
    start_month: "2026-01",
    end_month: "2026-12",
  };

  it("ok for a valid recurring window", () => {
    const result = validateFormInputs(baseRecurring);
    expect(result.ok).toBe(true);
  });

  it("flags missing start_month for recurring", () => {
    const result = validateFormInputs({ ...baseRecurring, start_month: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /start month/i.test(e))).toBe(true);
  });

  it("flags missing end_month for recurring", () => {
    const result = validateFormInputs({ ...baseRecurring, end_month: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /end month/i.test(e))).toBe(true);
  });

  it("rejects end before start", () => {
    const result = validateFormInputs({
      ...baseRecurring,
      start_month: "2026-06",
      end_month: "2026-03",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /on or after/i.test(e))).toBe(true);
  });

  it("ignores start/end for one-time", () => {
    const result = validateFormInputs({
      reason: "fuel",
      amount: "100",
      client: "c",
      org: "o",
      files: [],
      frequency: "one_time" as ConveyanceFrequency,
      start_month: "",
      end_month: "",
    });
    expect(result.ok).toBe(true);
  });
});

describe("buildCreateFormData — frequency", () => {
  it("emits frequency + months for recurring submissions", () => {
    const fd = buildCreateFormData({
      date: "2026-04-30",
      client: "c",
      reason: "subscription",
      amount: "500",
      claimable: true,
      org: "o",
      files: [],
      frequency: "monthly",
      start_month: "2026-01",
      end_month: "2026-12",
    });
    expect(fd.get("frequency")).toBe("monthly");
    expect(fd.get("start_month")).toBe("2026-01-01");
    expect(fd.get("end_month")).toBe("2026-12-01");
  });

  it("omits start/end for one-time submissions", () => {
    const fd = buildCreateFormData({
      date: "2026-04-30",
      client: "c",
      reason: "fuel",
      amount: "100",
      claimable: false,
      org: "o",
      files: [],
      frequency: "one_time",
      start_month: "",
      end_month: "",
    });
    expect(fd.get("frequency")).toBe("one_time");
    expect(fd.get("start_month")).toBeNull();
    expect(fd.get("end_month")).toBeNull();
  });
});
```

- [ ] **Step 8.2: Run tests to verify they fail**

```bash
cd frontend/task-tracker && npm test -- conveyanceFormDialog
```

Expected: TS errors (`frequency` not a known param) plus assertion failures.

- [ ] **Step 8.3: Update the helpers**

Edit `frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts`. Replace the file's contents with:

```ts
/**
 * Pure helper functions for ConveyanceFormDialog.
 *
 * Kept in a separate file so the dialog component file exports only the
 * component (required by react-refresh/only-export-components).
 */

import type { ConveyanceFrequency } from "@/types/api/conveyance";

export interface FileRow {
  file: File;
  label: string;
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export function validateFormInputs(input: {
  reason: string;
  amount: string;
  client: string;
  org: string;
  files: { file: File }[];
  frequency?: ConveyanceFrequency;
  start_month?: string;  // YYYY-MM
  end_month?: string;    // YYYY-MM
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (input.reason.trim().length < 3) errors.push("Reason must be at least 3 characters.");
  const amt = Number(input.amount);
  if (Number.isNaN(amt) || amt <= 0) errors.push("Amount must be greater than 0.");
  if (!input.client) errors.push("Client is required.");
  if (!input.org) errors.push("Organisation is required.");
  for (const { file } of input.files) {
    if (file.size > MAX_FILE_BYTES) {
      errors.push(`File "${file.name}" exceeds 20 MB limit.`);
    }
  }

  const frequency = input.frequency ?? "one_time";
  if (frequency !== "one_time") {
    if (!input.start_month) errors.push("Start month is required for recurring entries.");
    if (!input.end_month) errors.push("End month is required for recurring entries.");
    if (input.start_month && input.end_month && input.end_month < input.start_month) {
      errors.push("End month must be on or after start month.");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function buildCreateFormData(input: {
  date: string;
  client: string;
  reason: string;
  amount: string;
  claimable: boolean;
  org?: string;
  files: FileRow[];
  frequency?: ConveyanceFrequency;
  start_month?: string;  // YYYY-MM
  end_month?: string;    // YYYY-MM
}): FormData {
  const form = new FormData();
  form.append("date", input.date);
  form.append("client", input.client);
  form.append("reason", input.reason.trim());
  form.append("amount", input.amount);
  form.append("claimable", input.claimable ? "true" : "false");
  if (input.org) form.append("org", input.org);
  const frequency = input.frequency ?? "one_time";
  form.append("frequency", frequency);
  if (frequency !== "one_time") {
    if (input.start_month) form.append("start_month", `${input.start_month}-01`);
    if (input.end_month) form.append("end_month", `${input.end_month}-01`);
  }
  for (const { file, label } of input.files) {
    form.append("attachments", file);
    form.append("attachment_labels", label);
  }
  return form;
}
```

- [ ] **Step 8.4: Run tests**

```bash
cd frontend/task-tracker && npm test -- conveyanceFormDialog
```

Expected: all tests pass (the new ones plus the existing pure-logic tests).

- [ ] **Step 8.5: Commit**

```bash
git add frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts
git commit -m "feat(conveyance): frequency-aware form validation + FormData builder"
```

---

## Task 9 — Frontend: series-grouping helpers (TDD)

These power the headline-row pick and the badge label. Pure functions, easy to unit-test.

**Files:**
- Create: `frontend/task-tracker/src/components/conveyance/conveyanceRecurrenceHelpers.ts`
- Create: `frontend/task-tracker/src/__tests__/components/conveyanceRecurrenceHelpers.test.ts`

- [ ] **Step 9.1: Write the failing tests**

Create `frontend/task-tracker/src/__tests__/components/conveyanceRecurrenceHelpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  groupBySeries,
  pickHeadline,
  formatSeriesBadge,
} from "@/components/conveyance/conveyanceRecurrenceHelpers";
import type { ConveyanceEntry } from "@/types/api/conveyance";

function row(partial: Partial<ConveyanceEntry>): ConveyanceEntry {
  return {
    uid: "u-" + Math.random(),
    date: "2026-04-01",
    employee_detail: { uid: "e", username: "e", full_name: "E" },
    client_detail: { uid: "c", name: "C", type: "client" },
    reason: "r",
    amount: "100.00",
    claimable: true,
    status: "pending",
    review_note: "",
    reviewed_by_detail: null,
    reviewed_at: null,
    attachments: [],
    created_by_detail: null,
    created_at: "",
    updated_at: "",
    frequency: "one_time",
    series_uid: null,
    start_month: null,
    end_month: null,
    ...partial,
  };
}

describe("groupBySeries", () => {
  it("treats one-time entries as singleton groups", () => {
    const r1 = row({ uid: "a", series_uid: null });
    const r2 = row({ uid: "b", series_uid: null });
    const groups = groupBySeries([r1, r2]);
    expect(groups).toHaveLength(2);
    expect(groups[0].entries).toEqual([r1]);
    expect(groups[1].entries).toEqual([r2]);
  });

  it("buckets siblings by series_uid", () => {
    const r1 = row({ uid: "a", series_uid: "s1", date: "2026-01-01" });
    const r2 = row({ uid: "b", series_uid: "s1", date: "2026-02-01" });
    const r3 = row({ uid: "c", series_uid: null, date: "2026-03-01" });
    const groups = groupBySeries([r1, r2, r3]);
    expect(groups).toHaveLength(2);
    const series = groups.find((g) => g.seriesUid === "s1")!;
    expect(series.entries.map((e) => e.uid)).toEqual(["a", "b"]);
  });

  it("preserves chronological order within a series", () => {
    const r2 = row({ uid: "b", series_uid: "s", date: "2026-02-01" });
    const r1 = row({ uid: "a", series_uid: "s", date: "2026-01-01" });
    const r3 = row({ uid: "c", series_uid: "s", date: "2026-03-01" });
    const groups = groupBySeries([r2, r1, r3]);
    expect(groups[0].entries.map((e) => e.uid)).toEqual(["a", "b", "c"]);
  });
});

describe("pickHeadline", () => {
  const today = new Date("2026-04-15T12:00:00Z");

  it("picks the most recent on-or-before today", () => {
    const r1 = row({ uid: "a", date: "2026-01-01" });
    const r2 = row({ uid: "b", date: "2026-04-01" });
    const r3 = row({ uid: "c", date: "2026-08-01" });
    expect(pickHeadline([r1, r2, r3], today).uid).toBe("b");
  });

  it("picks earliest sibling when all are future", () => {
    const r1 = row({ uid: "a", date: "2027-01-01" });
    const r2 = row({ uid: "b", date: "2027-06-01" });
    expect(pickHeadline([r1, r2], today).uid).toBe("a");
  });

  it("picks the most recent past sibling when all are past", () => {
    const r1 = row({ uid: "a", date: "2025-01-01" });
    const r2 = row({ uid: "b", date: "2025-06-01" });
    expect(pickHeadline([r1, r2], today).uid).toBe("b");
  });
});

describe("formatSeriesBadge", () => {
  it("formats a monthly Jan–Dec window", () => {
    const r = row({
      uid: "a",
      frequency: "monthly",
      start_month: "2026-01-01",
      end_month: "2026-12-01",
      date: "2026-04-01",
    });
    expect(formatSeriesBadge(r, 12)).toBe("Monthly · Jan–Dec 2026 · 4/12");
  });

  it("formats a yearly multi-year window", () => {
    const r = row({
      uid: "a",
      frequency: "yearly",
      start_month: "2026-01-01",
      end_month: "2028-01-01",
      date: "2027-01-01",
    });
    expect(formatSeriesBadge(r, 3)).toBe("Yearly · Jan 2026 – Jan 2028 · 2/3");
  });
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

```bash
cd frontend/task-tracker && npm test -- conveyanceRecurrenceHelpers
```

Expected: import error — module not found.

- [ ] **Step 9.3: Implement the helpers**

Create `frontend/task-tracker/src/components/conveyance/conveyanceRecurrenceHelpers.ts`:

```ts
/**
 * Pure helpers for the recurring-conveyance grouping in the transactions
 * list. No React, no DOM — kept in their own module so the test file can
 * import them without the rest of the dialog component graph.
 */

import type { ConveyanceEntry, ConveyanceFrequency } from "@/types/api/conveyance";

export interface SeriesGroup {
  /** ``null`` for one-time singletons, the shared series_uid otherwise. */
  seriesUid: string | null;
  /** Chronological (ascending by date). One element for one-time. */
  entries: ConveyanceEntry[];
}

export function groupBySeries(rows: ConveyanceEntry[]): SeriesGroup[] {
  const out: SeriesGroup[] = [];
  const bySeries = new Map<string, ConveyanceEntry[]>();
  // Preserve original ordering of "first appearance" for stable list output.
  for (const r of rows) {
    if (r.series_uid == null) {
      out.push({ seriesUid: null, entries: [r] });
    } else {
      let bucket = bySeries.get(r.series_uid);
      if (bucket == null) {
        bucket = [];
        bySeries.set(r.series_uid, bucket);
        // Reserve a slot in the output so the group appears in the order of
        // its first sibling (matches the API's date-desc ordering).
        out.push({ seriesUid: r.series_uid, entries: bucket });
      }
      bucket.push(r);
    }
  }
  // Sort each series' entries chronologically (ascending).
  for (const g of out) {
    if (g.seriesUid != null) {
      g.entries.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return out;
}

/**
 * Most recent sibling whose ``date <= today``; if every sibling is in the
 * future, the earliest sibling. ``today`` is normalised to a YYYY-MM-DD
 * string in the user's local timezone for date-string comparison.
 */
export function pickHeadline(entries: ConveyanceEntry[], today: Date): ConveyanceEntry {
  if (entries.length === 0) {
    throw new Error("pickHeadline called with empty entries");
  }
  const todayStr = toLocalISODate(today);
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  // Walk from the latest backwards; first <= today wins.
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].date <= todayStr) return sorted[i];
  }
  return sorted[0];
}

const FREQUENCY_LABEL: Record<ConveyanceFrequency, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ymToShort(ym: string): { month: string; year: string } {
  // Accepts YYYY-MM-DD or YYYY-MM. Returns "Jan" + "2026".
  const [yearPart, monthPart] = ym.split("-");
  const m = parseInt(monthPart, 10);
  return { month: MONTH_NAMES[m - 1] ?? monthPart, year: yearPart };
}

/**
 * "Monthly · Jan–Dec 2026 · 4/12" or "Yearly · Jan 2026 – Jan 2028 · 2/3".
 * Compact form when start and end fall in the same year.
 */
export function formatSeriesBadge(headline: ConveyanceEntry, total: number): string {
  if (headline.start_month == null || headline.end_month == null) return "";
  const freq = FREQUENCY_LABEL[headline.frequency];
  const start = ymToShort(headline.start_month);
  const end = ymToShort(headline.end_month);
  const range =
    start.year === end.year
      ? `${start.month}–${end.month} ${start.year}`
      : `${start.month} ${start.year} – ${end.month} ${end.year}`;
  // Index = position of the headline within the (chronologically sorted)
  // siblings, 1-based. Caller passes the total count.
  const idx = headlineIndex(headline);
  return `${freq} · ${range} · ${idx}/${total}`;
}

function headlineIndex(headline: ConveyanceEntry): number {
  // For monthly steps the index is (headline.date.month - start.month + 1)
  // crossed with year deltas. We compute it generically off the date strings
  // and the start_month so the function stays correct for any frequency.
  if (headline.start_month == null) return 1;
  const [startYear, startMonth] = headline.start_month.split("-").map(Number);
  const [hYear, hMonth] = headline.date.split("-").map(Number);
  const monthsFromStart = (hYear - startYear) * 12 + (hMonth - startMonth);
  switch (headline.frequency) {
    case "monthly":
      return monthsFromStart + 1;
    case "half_yearly":
      return Math.floor(monthsFromStart / 6) + 1;
    case "yearly":
      return Math.floor(monthsFromStart / 12) + 1;
    default:
      return 1;
  }
}

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 9.4: Run tests**

```bash
cd frontend/task-tracker && npm test -- conveyanceRecurrenceHelpers
```

Expected: all tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add frontend/task-tracker/src/components/conveyance/conveyanceRecurrenceHelpers.ts frontend/task-tracker/src/__tests__/components/conveyanceRecurrenceHelpers.test.ts
git commit -m "feat(conveyance): series grouping + headline picker + badge formatter"
```

---

## Task 10 — Frontend: ConveyanceScopeDialog component

**Files:**
- Create: `frontend/task-tracker/src/components/conveyance/ConveyanceScopeDialog.tsx`

- [ ] **Step 10.1: Write the component**

Create `frontend/task-tracker/src/components/conveyance/ConveyanceScopeDialog.tsx`:

```tsx
import { useState } from "react";

import type { EntryScope } from "@/utils/conveyanceApi";

export type ScopeAction = "edit" | "delete";

interface Props {
  open: boolean;
  action: ScopeAction;
  onCancel: () => void;
  onConfirm: (scope: EntryScope) => void;
}

const dialogStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 24,
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
};

const radioRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
};

const btnPrimary: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  background: "#2563eb",
  color: "#fff",
};

const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: "#e5e7eb",
  color: "#111",
};

export default function ConveyanceScopeDialog({ open, action, onCancel, onConfirm }: Props) {
  const [scope, setScope] = useState<EntryScope>("row");
  if (!open) return null;

  const verb = action === "edit" ? "Edit" : "Delete";
  return (
    <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={`${verb} scope`}>
      <div style={panelStyle}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 16 }}>
          {verb} recurring entry
        </h3>
        <p style={{ margin: 0, marginBottom: 16, fontSize: 13, color: "#374151" }}>
          This entry is part of a recurring series. Apply the {verb.toLowerCase()} to:
        </p>

        <label style={radioRow}>
          <input
            type="radio"
            name="cs-scope"
            checked={scope === "row"}
            onChange={() => setScope("row")}
          />
          This entry only
        </label>
        <label style={radioRow}>
          <input
            type="radio"
            name="cs-scope"
            checked={scope === "series"}
            onChange={() => setScope("series")}
          />
          Entire series
        </label>
        <label style={radioRow}>
          <input
            type="radio"
            name="cs-scope"
            checked={scope === "series_forward"}
            onChange={() => setScope("series_forward")}
          />
          Entire series from this month
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" style={btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" style={btnPrimary} onClick={() => onConfirm(scope)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.2: Type-check**

```bash
cd frontend/task-tracker && npm run build
```

Expected: build succeeds.

- [ ] **Step 10.3: Commit**

```bash
git add frontend/task-tracker/src/components/conveyance/ConveyanceScopeDialog.tsx
git commit -m "feat(conveyance): ConveyanceScopeDialog modal for edit/delete scope choice"
```

---

## Task 11 — Frontend: form dialog adds Frequency / Start / End fields

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`

- [ ] **Step 11.1: Add state + read-from-entry seeding**

Open `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`. After the `import` block, replace the `today` constant with:

```tsx
const today = new Date().toISOString().slice(0, 10);

// YYYY-MM-DD → YYYY-MM (drop day for <input type="month">)
function toMonthInput(date: string | null | undefined): string {
  return (date ?? "").slice(0, 7);
}
```

Inside the component, after the existing `claimable` state hook (around line 117), add:

```tsx
  const [frequency, setFrequency] = useState<ConveyanceEntry["frequency"]>(
    entry?.frequency ?? "one_time",
  );
  const [startMonth, setStartMonth] = useState(toMonthInput(entry?.start_month));
  const [endMonth, setEndMonth] = useState(toMonthInput(entry?.end_month));
```

(Add `import type { ConveyanceEntry, ... }` already exists; ensure `ConveyanceFrequency` is unused or import it if you prefer.)

In the existing `useEffect` that re-syncs on `open`/`entry` (the block that resets `date`, `client`, `reason`, etc.), append:

```tsx
    setFrequency(entry?.frequency ?? "one_time");
    setStartMonth(toMonthInput(entry?.start_month));
    setEndMonth(toMonthInput(entry?.end_month));
```

- [ ] **Step 11.2: Wire validation + submit**

Update the `validateFormInputs` call to pass the new fields:

```tsx
  const { ok: formValid, errors: validationErrors } = validateFormInputs({
    reason,
    amount,
    client,
    org: isCreate ? org : "edit-mode",
    files: newFiles,
    frequency,
    start_month: startMonth,
    end_month: endMonth,
  });
```

Update the `handleSubmit` function: in the **isCreate** branch, pass the new fields to `buildCreateFormData`:

```tsx
        const form = buildCreateFormData({
          date,
          client,
          reason,
          amount,
          claimable,
          org,
          files: newFiles,
          frequency,
          start_month: startMonth,
          end_month: endMonth,
        });
```

The **edit** branch is unchanged — frequency/start/end are immutable server-side and the serializer drops them silently.

- [ ] **Step 11.3: Render the new fields**

In the JSX, find the **Amount** field block (search for `id="cf-amount"`) and insert these blocks **after the Amount field** and **before the Claimable checkbox**:

```tsx
          {/* Frequency */}
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="cf-frequency">Frequency</label>
            <select
              id="cf-frequency"
              style={inputStyle}
              value={frequency}
              disabled={!isCreate || !canEdit}
              onChange={(e) => setFrequency(e.target.value as ConveyanceEntry["frequency"])}
            >
              <option value="one_time">One-time</option>
              <option value="monthly">Monthly</option>
              <option value="half_yearly">Half-yearly</option>
              <option value="yearly">Yearly</option>
            </select>
            {!isCreate && (
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Frequency, start and end months are fixed at creation. Delete the series to change them.
              </div>
            )}
          </div>

          {/* Start month — only for recurring */}
          {frequency !== "one_time" && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cf-start-month">Start month</label>
              <input
                id="cf-start-month"
                type="month"
                style={inputStyle}
                value={startMonth}
                disabled={!isCreate || !canEdit}
                onChange={(e) => setStartMonth(e.target.value)}
                required
              />
            </div>
          )}

          {/* End month — only for recurring */}
          {frequency !== "one_time" && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cf-end-month">End month</label>
              <input
                id="cf-end-month"
                type="month"
                style={inputStyle}
                value={endMonth}
                disabled={!isCreate || !canEdit}
                onChange={(e) => setEndMonth(e.target.value)}
                required
              />
            </div>
          )}
```

Also: the **Date** field is meaningful only for one-time entries. Wrap the existing Date field block with `{frequency === "one_time" && ( … )}` so it disappears when the user picks a recurring frequency. (If you'd rather keep it visible-but-disabled, that's fine too — the spec says the materialiser ignores the value.)

- [ ] **Step 11.4: Type-check + run helper tests**

```bash
cd frontend/task-tracker && npm run build && npm test -- conveyanceFormDialog
```

Expected: build and tests pass.

- [ ] **Step 11.5: Manual smoke (optional but recommended)**

Start the dev server and confirm:

```bash
cd frontend/task-tracker && npm run dev
```

In the running app, open the Conveyance tab, click + Add Entry, and verify:
- Frequency dropdown defaults to One-time; Start/End fields are hidden.
- Selecting Monthly reveals Start month and End month, and hides Date.
- Selecting an end month earlier than start month surfaces the inline error.

- [ ] **Step 11.6: Commit**

```bash
git add frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx
git commit -m "feat(conveyance): form dialog renders frequency/start/end fields"
```

---

## Task 12 — Frontend: transactions list groups + scope-aware actions

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx`

- [ ] **Step 12.1: Wire imports**

At the top of `ConveyanceTransactions.tsx`, add:

```tsx
import {
  groupBySeries,
  pickHeadline,
  formatSeriesBadge,
} from "./conveyanceRecurrenceHelpers";
import ConveyanceScopeDialog, { type ScopeAction } from "./ConveyanceScopeDialog";
import type { EntryScope } from "@/utils/conveyanceApi";
```

- [ ] **Step 12.2: Add expand-state + scope-dialog state**

Inside the component, next to the existing `dialogState`, add:

```tsx
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [scopeDialog, setScopeDialog] = useState<{ action: ScopeAction; entry: ConveyanceEntry } | null>(null);
```

Helper to toggle expansion:

```tsx
  function toggleExpand(seriesUid: string) {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(seriesUid)) next.delete(seriesUid);
      else next.add(seriesUid);
      return next;
    });
  }
```

- [ ] **Step 12.3: Replace the table body with grouped rendering**

Replace the inner `entries.map((row) => …)` block with a grouping pass:

```tsx
            {(() => {
              const groups = groupBySeries(entries);
              const today = new Date();
              const out: React.ReactNode[] = [];
              for (const g of groups) {
                if (g.seriesUid == null) {
                  // One-time — render exactly as today.
                  const row = g.entries[0];
                  out.push(renderRow(row, /* indent */ false, /* isHeadline */ false));
                  continue;
                }
                const headline = pickHeadline(g.entries, today);
                const isOpen = expandedSeries.has(g.seriesUid);
                out.push(renderRow(headline, false, true, {
                  seriesUid: g.seriesUid,
                  total: g.entries.length,
                  isOpen,
                  onToggle: () => toggleExpand(g.seriesUid!),
                }));
                if (isOpen) {
                  for (const sib of g.entries) {
                    if (sib.uid === headline.uid) continue;
                    out.push(renderRow(sib, true, false));
                  }
                }
              }
              return out;
            })()}
```

Add a `renderRow` function inside the component (replaces the inline `(row) => { … }` body and accepts the new props). Place it just before the `return` statement:

```tsx
  function renderRow(
    row: ConveyanceEntry,
    indent: boolean,
    isHeadline: boolean,
    badge?: { seriesUid: string; total: number; isOpen: boolean; onToggle: () => void },
  ) {
    const actions = rowActions(row);
    return (
      <tr key={row.uid} style={indent ? { background: "#f9fafb" } : undefined}>
        <td style={{ paddingLeft: indent ? 24 : undefined }}>
          {badge && (
            <button
              type="button"
              aria-label={badge.isOpen ? "Collapse series" : "Expand series"}
              onClick={badge.onToggle}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                marginRight: 4,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              {badge.isOpen ? "▾" : "▸"}
            </button>
          )}
          {row.date}
        </td>
        <td>{row.employee_detail.full_name}</td>
        <td>{row.client_detail.name}</td>
        <td title={row.reason} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.reason}
          {badge && (
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
              {formatSeriesBadge(row, badge.total)}
            </div>
          )}
        </td>
        <td style={{ textAlign: "right" }}>{formatAmount(row.amount)}</td>
        <td style={{ textAlign: "center" }}>{row.claimable ? "Yes" : "No"}</td>
        <td style={{ textAlign: "center" }}>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 12,
              background:
                row.status === "approved"
                  ? "#d1fae5"
                  : row.status === "rejected"
                    ? "#fee2e2"
                    : "#fef3c7",
              color:
                row.status === "approved"
                  ? "#065f46"
                  : row.status === "rejected"
                    ? "#991b1b"
                    : "#92400e",
            }}
          >
            {row.status}
          </span>
        </td>
        <td style={{ textAlign: "center" }}>
          <ConveyanceAttachmentList attachments={row.attachments} />
        </td>
        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {actions.canApprove && (
              <>
                <button
                  type="button"
                  onClick={() => { void handleApprove(row); }}
                  style={{ padding: "3px 10px", fontSize: 12, border: "none", borderRadius: 4, cursor: "pointer", background: "#d1fae5", color: "#065f46" }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setDialogState({ type: "reject", entry: row })}
                  style={{ padding: "3px 10px", fontSize: 12, border: "none", borderRadius: 4, cursor: "pointer", background: "#fee2e2", color: "#991b1b" }}
                >
                  Reject
                </button>
              </>
            )}
            {actions.canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (row.series_uid) setScopeDialog({ action: "edit", entry: row });
                    else setDialogState({ type: "edit", entry: row });
                  }}
                  style={{ padding: "3px 10px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", background: "#f9fafb" }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (row.series_uid) setScopeDialog({ action: "delete", entry: row });
                    else { void handleDelete(row); }
                  }}
                  style={{ padding: "3px 10px", fontSize: 12, border: "none", borderRadius: 4, cursor: "pointer", background: "#fee2e2", color: "#991b1b" }}
                >
                  Delete
                </button>
              </>
            )}
          </span>
        </td>
      </tr>
    );
  }
```

- [ ] **Step 12.4: Wire scope-dialog confirmation**

Just before the final closing `</div>` of the component's return, add the dialog mount:

```tsx
      <ConveyanceScopeDialog
        open={scopeDialog !== null}
        action={scopeDialog?.action ?? "edit"}
        onCancel={() => setScopeDialog(null)}
        onConfirm={(scope) => {
          if (!scopeDialog) return;
          const entry = scopeDialog.entry;
          if (scopeDialog.action === "edit") {
            // Edit dialog opens with the chosen scope; the form submits
            // through updateEntry(uid, body, scope). We pass the scope in by
            // stashing it on the dialog state.
            setDialogState({ type: "edit", entry });
            setEditScope(scope);
          } else {
            void handleScopedDelete(entry, scope);
          }
          setScopeDialog(null);
        }}
      />
```

Add the new state + handlers:

```tsx
  const [editScope, setEditScope] = useState<EntryScope | null>(null);

  async function handleScopedDelete(row: ConveyanceEntry, scope: EntryScope) {
    if (!confirm(scope === "row" ? "Delete this entry?" : `Delete ${scope === "series" ? "the entire series" : "this entry and later siblings"}?`)) {
      return;
    }
    try {
      await deleteEntry(row.uid, scope);
      // Remove every affected row from local state. The realtime broadcast
      // will reconcile if anything else changed.
      setEntries((prev) =>
        prev.filter((e) => {
          if (scope === "series") return e.series_uid !== row.series_uid;
          if (scope === "series_forward") return !(e.series_uid === row.series_uid && e.date >= row.date);
          return e.uid !== row.uid;
        }),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }
```

Update the Edit dialog mount (the existing `dialogState.type === "edit"` block) to pass `editScope` through to `onSaved` so the parent can call `updateEntry(uid, body, editScope ?? undefined)`. The cleanest fix: pass `editScope` as a prop to `ConveyanceFormDialog` and let the dialog include it on its `updateEntry` call. Add a new optional prop:

In `ConveyanceFormDialog.tsx`:

```tsx
export interface ConveyanceFormDialogProps {
  // … existing fields …
  /** Scope for the update call when editing a series row. */
  editScope?: EntryScope;
}
```

Inside the component's `handleSubmit`, in the `else` branch (edit), thread the scope:

```tsx
        const saved = await updateEntry(entry.uid, {
          date,
          client,
          reason: reason.trim(),
          amount,
          claimable,
        }, editScope);
```

In `ConveyanceTransactions.tsx`, on the existing `<ConveyanceFormDialog … />` for the edit dialog, pass `editScope={editScope ?? undefined}`. Reset `editScope` to `null` whenever the edit dialog closes (already covered by `setDialogState({ type: null })`; add `setEditScope(null)` next to it).

- [ ] **Step 12.5: Type-check + lint**

```bash
cd frontend/task-tracker && npm run build && npm run lint
```

Expected: both succeed.

- [ ] **Step 12.6: Manual smoke**

Run `npm run dev`, then:
1. Create a `Monthly · 2026-01 → 2026-04` series with reason "subscription" and amount ₹500.
2. Confirm the transactions list shows **one** row (the headline) with the badge `Monthly · Jan–Apr 2026 · 4/4` (or `4/4` if today > April; today = 2026-04-30, so the headline is April).
3. Click the chevron — the other 3 rows expand inline indented under the headline.
4. Click **Edit** — the scope modal appears. Pick **Entire series**, change amount to ₹600, save. Reload — every sibling shows ₹600.
5. Click **Delete** on the same row, pick **Entire series from this month**, confirm — only the rows whose date < April remain.
6. Approve any remaining row — every sibling in the same series flips to `approved`.

- [ ] **Step 12.7: Commit**

```bash
git add frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx
git commit -m "feat(conveyance): collapse series in transactions list with scope-aware edit/delete"
```

---

## Task 13 — Final verification

- [ ] **Step 13.1: Backend test suite**

```bash
uv run python manage.py test core.conveyance -v 2
```

Expected: every test passes.

- [ ] **Step 13.2: Frontend test suite**

```bash
cd frontend/task-tracker && npm test
```

Expected: every test passes.

- [ ] **Step 13.3: Build + lint**

```bash
cd frontend/task-tracker && npm run build && npm run lint
```

Expected: both succeed with no errors.

- [ ] **Step 13.4: Push the branch**

```bash
git push origin Conveyance_Recurring
```

---

## Self-review checklist (run after writing the plan, then fix inline)

1. **Spec coverage** — every numbered behavioural requirement in §2 of the spec is covered:
   - 2.1 Frequency choices → Tasks 2 (model), 11 (form select)
   - 2.2 Start/end visibility, end ≥ start → Tasks 3 (serializer), 8 (helpers), 11 (form)
   - 2.3 Materialisation, 1st-of-month, series_uid → Tasks 1 (helper), 2 (fields), 4 (perform_create)
   - 2.4 Series-wide approve/reject → Task 5
   - 2.5 Scoped edit/delete with 3-button modal → Tasks 6 (backend), 10 (modal), 12 (wiring)
   - 2.6 Immutability → Task 3 (serializer.update drops fields), Task 11 (form disables inputs in edit mode)
   - 2.7 Future-date validation lifted for recurring → Task 3 (validate_date branch)
   - 2.8 Headline collapse → Tasks 9 (helpers), 12 (rendering)
   - 2.9 Filters re-pick headline from surviving rows → Task 12 (`groupBySeries` runs over the already-filtered `entries` array, and `pickHeadline` runs per group on every render)
2. **Placeholder scan** — no TBD/TODO/FIXME, no "implement later", no bare "add validation". Every code step shows the actual code.
3. **Type consistency** — `frequency`, `series_uid`, `start_month`, `end_month` use the same names everywhere (Python snake_case in the API, TS field names matching the JSON keys). `EntryScope = "row" | "series" | "series_forward"` — same three values appear in backend `_ALLOWED_SCOPES`, frontend `EntryScope`, and the scope-dialog radio buttons.
4. **Scope check** — single feature, single plan; no sub-feature creep.
