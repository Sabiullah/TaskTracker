# Per-User Holiday Pin (HD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins mark Holiday (HD) on a single (user, date) cell from the Attendance Matrix view picker, so a holiday can apply to a subset of employees (regional functions, community days) without a full org-wide `Holiday` row.

**Architecture:** Reuses the existing `manual_status_override` pipeline end-to-end. Add `"Holiday"` to `Attendance.STATUS_CHOICES`; teach `POST /attendance/set_status/` to accept it; add one branch to `derive_cell` in the override block so the matrix emits `HD`. Frontend adds a 5th picker option. No schema columns change, no data backfill, no new permission code, no realtime plumbing.

**Tech Stack:** Django 5 (Python) backend, Django REST Framework, Django test runner. React + TypeScript + Vite + Vitest frontend.

**Spec:** [docs/superpowers/specs/2026-05-22-per-user-holiday-pin-design.md](../specs/2026-05-22-per-user-holiday-pin-design.md)

**Test commands:**
- Backend (focused): `python manage.py test core.attendance -v 2`
- Frontend (focused): `cd frontend/task-tracker && npm test -- matrixCell`
- Full pre-push gate: `uv run pre-commit run --all-files`

---

## Task 1: Add `"Holiday"` to `Attendance.STATUS_CHOICES` + migration

**Files:**
- Modify: `core/attendance/models.py:28-33`
- Create: `core/attendance/migrations/0006_attendance_status_holiday_choice.py`

Choices-only change. `Attendance.status` column is already `max_length=20`; `"Holiday"` is 7 chars, fits. `_derive_status` already skips when `manual_status_override=True`, so storing the new value is safe. No data backfill — pinned Holiday rows only come into existence as admins click them from this PR onward.

- [ ] **Step 1: Add the choice to the model**

Edit the `STATUS_CHOICES` tuple in `core/attendance/models.py:28-33`:

```python
    STATUS_CHOICES = [
        ("Present", "Present"),
        ("Absent", "Absent"),
        ("Half Day", "Half Day"),
        ("Leave", "Leave"),
        ("Holiday", "Holiday"),
    ]
```

- [ ] **Step 2: Generate the migration with makemigrations**

Run: `python manage.py makemigrations attendance --name attendance_status_holiday_choice`

Expected output: creates `core/attendance/migrations/0006_attendance_status_holiday_choice.py` with an `AlterField` operation on `status`.

If `makemigrations` isn't available in this environment, write it by hand to `core/attendance/migrations/0006_attendance_status_holiday_choice.py`:

```python
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("attendance", "0005_manual_status_override_and_backfill"),
    ]

    operations = [
        migrations.AlterField(
            model_name="attendance",
            name="status",
            field=models.CharField(
                choices=[
                    ("Present", "Present"),
                    ("Absent", "Absent"),
                    ("Half Day", "Half Day"),
                    ("Leave", "Leave"),
                    ("Holiday", "Holiday"),
                ],
                default="Present",
                max_length=20,
            ),
        ),
    ]
```

- [ ] **Step 3: Apply the migration**

Run: `python manage.py migrate attendance`
Expected: `Applying attendance.0006_attendance_status_holiday_choice... OK`

- [ ] **Step 4: Sanity-check existing tests still pass**

Run: `python manage.py test core.attendance -v 1`
Expected: all existing tests pass — this change is purely additive.

- [ ] **Step 5: Commit**

```bash
git add core/attendance/models.py core/attendance/migrations/0006_attendance_status_holiday_choice.py
git commit -m "feat(attendance): add Holiday to Attendance.STATUS_CHOICES"
```

---

## Task 2: Render `HD` in `derive_cell` for Holiday-pinned rows (TDD)

**Files:**
- Test: `core/attendance/test_matrix.py` (add three tests inside `DeriveCellTests`)
- Modify: `core/attendance/matrix.py:38-47`

The existing `manual_status_override` block handles `"Present"`, `"Half Day"`, `"Leave"`, `"Absent"`. Add one clause for `"Holiday"`. The branch already sits above the Sunday/holiday/leave rules, so the pin is sticky on any day; open-punch `?` upstream still wins.

- [ ] **Step 1: Write the failing tests**

Add to `core/attendance/test_matrix.py`, immediately after `test_manual_override_beats_full_leave_session` (around line 135):

```python
    def test_manual_override_holiday_on_weekday_renders_HD(self):
        # Admin pinned a regular weekday to Holiday — the override branch
        # must emit HD with a default holiday_name even though the day is
        # not in the Holiday table.
        a = _att(status="Holiday", manual_status_override=True)
        cell = derive_cell(CellInput(self.D, False, False, None, a, []))
        self.assertEqual(cell["code"], "HD")
        self.assertEqual(cell["holiday_name"], "Regional Holiday")

    def test_manual_override_holiday_on_sunday_renders_HD(self):
        # Sunday already renders HD by default. Pinning Holiday is idempotent
        # in appearance but explicit in storage (status="Holiday").
        a = _att(status="Holiday", manual_status_override=True)
        cell = derive_cell(CellInput(self.SUN, False, False, None, a, []))
        self.assertEqual(cell["code"], "HD")

    def test_manual_override_holiday_loses_to_open_punch(self):
        # Open-punch '?' must still win — data-integrity issue trumps any
        # admin pin, same rule as the other four override statuses.
        a = _att(login="09:00", status="Holiday", manual_status_override=True)
        cell = derive_cell(CellInput(self.D, False, False, None, a, []))
        self.assertEqual(cell["code"], "?")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python manage.py test core.attendance.test_matrix.DeriveCellTests -v 2`
Expected: `test_manual_override_holiday_on_weekday_renders_HD` and `test_manual_override_holiday_on_sunday_renders_HD` FAIL — both return `{"code": "A"}` because the override block doesn't recognise `"Holiday"` yet and falls through to the default. `test_manual_override_holiday_loses_to_open_punch` should already PASS because the open-punch check sits above the override block.

- [ ] **Step 3: Add the Holiday branch to `derive_cell`**

Edit `core/attendance/matrix.py`. The existing override block lives at lines 38-47:

```python
    if a and a.get("manual_status_override"):
        s = a.get("status")
        if s == "Present":
            return _cell("P", a, hours)
        if s == "Half Day":
            return _cell("H", a, hours)
        if s == "Leave":
            return {"code": "L"}
        if s == "Absent":
            return _cell("A", a, hours)
```

Insert a new `Holiday` clause **before** the `"Absent"` line (order doesn't strictly matter since these are mutually exclusive string comparisons, but matches the spec):

```python
    if a and a.get("manual_status_override"):
        s = a.get("status")
        if s == "Present":
            return _cell("P", a, hours)
        if s == "Half Day":
            return _cell("H", a, hours)
        if s == "Leave":
            return {"code": "L"}
        if s == "Holiday":
            return {"code": "HD", "holiday_name": "Regional Holiday"}
        if s == "Absent":
            return _cell("A", a, hours)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test core.attendance.test_matrix.DeriveCellTests -v 2`
Expected: all three new tests PASS, plus all existing `DeriveCellTests` continue to pass.

- [ ] **Step 5: Commit**

```bash
git add core/attendance/matrix.py core/attendance/test_matrix.py
git commit -m "feat(matrix): render HD for Holiday-pinned cells"
```

---

## Task 3: Accept `"Holiday"` in `POST /attendance/set_status/` (TDD)

**Files:**
- Test: `core/attendance/tests.py` (add three tests inside `WfhApprovalTests`)
- Modify: `core/attendance/views.py:403`

The endpoint's `set_status` action validates the inbound `status` against a hard-coded tuple. Widen the tuple. The admin-in-target-org permission check, org resolution, upsert logic, `manual_status_override=True` flag, and broadcast are already correct for any of the five status values.

- [ ] **Step 1: Write the failing tests**

Add to `core/attendance/tests.py` inside `class WfhApprovalTests`, after `test_set_status_rejects_invalid_status` (around line 355):

```python
    def test_admin_set_status_holiday_creates_row(self):
        # Admin clicks a regular weekday cell and pins it Holiday. Row must
        # land with status="Holiday" and manual_status_override=True so the
        # matrix renders HD on that single (user, date) without affecting
        # other employees.
        c = self._client(self.admin)
        r = c.post(
            "/api/attendance/set_status/",
            {"user_uid": str(self.emp.uid), "date": "2026-05-24", "status": "Holiday"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.json())
        row = Attendance.objects.get(user=self.emp, date="2026-05-24")
        self.assertEqual(row.status, "Holiday")
        self.assertTrue(row.manual_status_override)
        self.assertEqual(row.org, self.org)

    def test_admin_set_status_holiday_renders_HD_in_matrix(self):
        # End-to-end: pinning Holiday on a regular weekday must surface as
        # code "HD" in the matrix payload for that single employee, with
        # the auto-label "Regional Holiday".
        c = self._client(self.admin)
        r = c.post(
            "/api/attendance/set_status/",
            {"user_uid": str(self.emp.uid), "date": "2026-05-25", "status": "Holiday"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.json())
        m = c.get("/api/attendance/matrix/?month=2026-05")
        self.assertEqual(m.status_code, 200, m.json())
        cell = m.json()["cells"][str(self.emp.uid)]["2026-05-25"]
        self.assertEqual(cell["code"], "HD", cell)
        self.assertEqual(cell["holiday_name"], "Regional Holiday")

    def test_employee_cannot_set_status_holiday(self):
        # Same admin gate as the other four statuses — employee gets 403
        # and no row is created.
        c = self._client(self.emp)
        r = c.post(
            "/api/attendance/set_status/",
            {"user_uid": str(self.emp.uid), "date": "2026-05-26", "status": "Holiday"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)
        self.assertFalse(Attendance.objects.filter(user=self.emp, date="2026-05-26").exists())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python manage.py test core.attendance.tests.WfhApprovalTests -v 2`
Expected:
- `test_admin_set_status_holiday_creates_row` and `test_admin_set_status_holiday_renders_HD_in_matrix` FAIL with HTTP 400 because the current `set_status` validator rejects `"Holiday"`.
- `test_employee_cannot_set_status_holiday` already PASSES (the 400 will fire for non-admin too because the status check happens before the permission check — verify this by reading the assertion message; if it's `400` instead of `403`, we'll just confirm the test passes after Step 3 instead).

If the third test fails because the 400 fires before the 403, that's fine — Step 3 (widening the validator) lets the request reach the admin check, which then correctly returns 403. The TDD signal is unchanged.

- [ ] **Step 3: Widen the `set_status` allow-list**

Edit `core/attendance/views.py:403`. Current line:

```python
        if status not in ("Present", "Absent", "Half Day", "Leave"):
            raise ValidationError({"status": "must be Present / Absent / Half Day / Leave"})
```

Replace with:

```python
        if status not in ("Present", "Absent", "Half Day", "Leave", "Holiday"):
            raise ValidationError({"status": "must be Present / Absent / Half Day / Leave / Holiday"})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test core.attendance.tests.WfhApprovalTests -v 2`
Expected: all three new tests PASS plus all existing `WfhApprovalTests` continue to pass. In particular `test_set_status_rejects_invalid_status` (still POSTs `"Bogus"`) must still return 400.

- [ ] **Step 5: Commit**

```bash
git add core/attendance/views.py core/attendance/tests.py
git commit -m "feat(attendance): set_status accepts Holiday for per-user HD pin"
```

---

## Task 4: Add the "Holiday" option to the Matrix cell picker (TDD)

**Files:**
- Test: `frontend/task-tracker/src/__tests__/components/attendance/matrixCell.behavior.test.tsx`
- Modify: `frontend/task-tracker/src/components/attendance/MatrixCell.tsx:12, 26-35`

Add one entry to `PICKER_OPTIONS`. Broaden the `onStatusChange` prop type so TypeScript propagates `"Holiday"` through to the parent. `CELL_STYLE.HD` already exists, so the picker swatch renders correctly with no style edits.

- [ ] **Step 1: Update the first existing test so it asserts the 5-option picker**

Edit `frontend/task-tracker/src/__tests__/components/attendance/matrixCell.behavior.test.tsx`. The current test at lines 7-29 expects exactly four options (Present / Half Day / Absent / Leave). Add a Holiday assertion and update the click expectation so the test now requires the 5th option to be wired up.

Replace the first test body (lines 7-29) with:

```typescript
  it("opens the status picker when admin clicks an HD cell", () => {
    cleanup();
    const onStatusChange = vi.fn();
    render(
      <MatrixCell
        date="2026-05-10"
        payload={{ code: "HD", holiday_name: "Sunday" }}
        editable={true}
        onStatusChange={onStatusChange}
      />,
    );
    // HD cell exists
    expect(screen.getByText("HD")).toBeTruthy();
    fireEvent.click(screen.getByText("HD"));
    // Picker now shows all 5 status options including Holiday
    expect(screen.getByText("Present")).toBeTruthy();
    expect(screen.getByText("Half Day")).toBeTruthy();
    expect(screen.getByText("Absent")).toBeTruthy();
    expect(screen.getByText("Leave")).toBeTruthy();
    expect(screen.getByText("Holiday")).toBeTruthy();
    // Choosing one fires onStatusChange with the right status string
    fireEvent.click(screen.getByText("Present"));
    expect(onStatusChange).toHaveBeenCalledWith("Present");
  });
```

Add a new test below the existing three describing the Holiday selection path. Insert immediately before the closing `});` of the `describe` block (after line 58):

```typescript
  it("emits onStatusChange('Holiday') when admin picks Holiday", () => {
    cleanup();
    const onStatusChange = vi.fn();
    render(
      <MatrixCell
        date="2026-05-24"
        payload={{ code: "P" }}
        editable={true}
        onStatusChange={onStatusChange}
      />,
    );
    fireEvent.click(screen.getByText("P"));
    expect(screen.getByText("Holiday")).toBeTruthy();
    fireEvent.click(screen.getByText("Holiday"));
    expect(onStatusChange).toHaveBeenCalledWith("Holiday");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend/task-tracker && npm test -- matrixCell`
Expected: both updated/new tests FAIL — the picker currently has 4 options, so `getByText("Holiday")` throws "Unable to find element with text: Holiday".

- [ ] **Step 3: Broaden `onStatusChange` and add the Holiday picker option**

Edit `frontend/task-tracker/src/components/attendance/MatrixCell.tsx`.

Update the `Props` interface at lines 4-13 — broaden the `onStatusChange` parameter type to include `"Holiday"`:

```typescript
interface Props {
  date: string;
  payload: CellPayload;
  outlined?: boolean;
  /** When true, clicking the cell opens an inline status picker. The
   *  parent receives the chosen status via ``onStatusChange``. The picker
   *  is suppressed for non-status cells (open punch '?'). */
  editable?: boolean;
  onStatusChange?: (
    status: "Present" | "Absent" | "Half Day" | "Leave" | "Holiday",
  ) => void;
}
```

Update the `PICKER_OPTIONS` declaration at lines 26-35 — broaden the type tuple and append the Holiday row:

```typescript
const PICKER_OPTIONS: {
  code: "P" | "H" | "A" | "L" | "HD";
  status: "Present" | "Half Day" | "Absent" | "Leave" | "Holiday";
  label: string;
}[] = [
  { code: "P", status: "Present", label: "Present" },
  { code: "H", status: "Half Day", label: "Half Day" },
  { code: "A", status: "Absent", label: "Absent" },
  { code: "L", status: "Leave", label: "Leave" },
  { code: "HD", status: "Holiday", label: "Holiday" },
];
```

No other edits needed: the picker's swatch lookup `CELL_STYLE[opt.code]` covers `HD` already, and the "current selection highlight" check `payload.code === opt.code` works for `HD` cells automatically.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend/task-tracker && npm test -- matrixCell`
Expected: all three tests (two updated, one new) PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/attendance/MatrixCell.tsx frontend/task-tracker/src/__tests__/components/attendance/matrixCell.behavior.test.tsx
git commit -m "feat(matrix-fe): add Holiday option to cell status picker"
```

---

## Task 5: Broaden `StatusValue` in `AttendanceMatrixView` to plumb `"Holiday"` through

**Files:**
- Modify: `frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx:16`

The parent passes `onStatusChange` into `MatrixCell` and forwards the value to `apiPost("/attendance/set_status/", { status })`. Once `MatrixCell` widens its callback type, the parent must accept the wider union too or TypeScript fails the build.

- [ ] **Step 1: Run the typecheck to see it fail**

Run: `cd frontend/task-tracker && npx tsc --noEmit`
Expected: an error in `AttendanceMatrixView.tsx` because the inline `onStatusChange` callback narrows to `StatusValue` (the local 4-value union) and `MatrixCell`'s new wider signature isn't assignable. The exact error text will be along the lines of: `Type '(status: "Present" | "Absent" | "Half Day" | "Leave" | "Holiday") => void' is not assignable to ...`.

(If `npx tsc` isn't routinely run, the same failure surfaces via the next `npm run build` or `uv run pre-commit run --all-files`.)

- [ ] **Step 2: Broaden the `StatusValue` alias**

Edit `frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx:16`. Current:

```typescript
type StatusValue = "Present" | "Absent" | "Half Day" | "Leave";
```

Replace with:

```typescript
type StatusValue = "Present" | "Absent" | "Half Day" | "Leave" | "Holiday";
```

No other lines need editing. `handleStatusChange` already forwards `status` directly into the POST body, and the alert / reload paths are status-agnostic.

- [ ] **Step 3: Run the typecheck to verify it passes**

Run: `cd frontend/task-tracker && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx
git commit -m "feat(matrix-fe): plumb Holiday through StatusValue in matrix view"
```

---

## Task 6: Full pre-push verification

**Files:** none modified — verification only.

Catches anything the focused tests missed (ruff, format, line endings, mypy/pyright, eslint, tsc, build).

- [ ] **Step 1: Run the full pre-commit gate**

Run: `uv run pre-commit run --all-files`
Expected: all hooks pass. If any hook fails (formatter, linter, type-checker), fix the underlying issue and re-run — do **not** skip with `--no-verify`.

- [ ] **Step 2: Run the full backend test suite for the attendance app**

Run: `python manage.py test core.attendance -v 1`
Expected: 0 failures.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend/task-tracker && npm test`
Expected: 0 failures.

- [ ] **Step 4: Manual smoke (admin in the browser)**

Start the app, log in as an admin, navigate to Employee Management → Matrix tab.
1. Click a regular weekday cell on any employee. Picker opens; Holiday option is visible as the 5th row.
2. Click Holiday. Cell flips to `HD`. Tooltip on hover shows `<date> · Regional Holiday`.
3. Refresh the page. The HD pin persists.
4. As a non-admin (employee), navigate to the same view — the picker does not open on click. (Existing behaviour, just confirming Holiday didn't regress it.)

- [ ] **Step 5: Push**

```bash
git push
```

The branch is `Holiday_Sel`; per the user's standing preference, auto-push after the work passes the local gate is the expected flow.

---

## Self-review checklist (done at write time)

1. **Spec coverage:**
   - "Add Holiday to STATUS_CHOICES" → Task 1 ✓
   - "Extend set_status to accept Holiday" → Task 3 ✓
   - "derive_cell emits HD for status=Holiday with default name" → Task 2 ✓
   - "Frontend picker gets 5th option" → Task 4 ✓
   - "StatusValue widened" → Task 5 ✓
   - "Migration generated" → Task 1 Step 2 ✓
   - "Tests: derive_cell HD on weekday / Sunday / loses to open-punch" → Task 2 ✓
   - "Tests: set_status accepts Holiday, rejects unknown, requires admin" → Task 3 ✓
   - "Tests: picker shows 5 options, clicking Holiday emits Holiday" → Task 4 ✓
   - "Tooltip shows `<date> · Regional Holiday`" → covered by Task 6 Step 4 (manual smoke); auto-tested via the matrix payload containing `holiday_name` (Task 3 test).

2. **Placeholder scan:** No TBD/TODO/"similar to" placeholders. All code blocks contain real code.

3. **Type consistency:**
   - `onStatusChange` widening in `MatrixCell.tsx` and `StatusValue` in `AttendanceMatrixView.tsx` both spell the union the same way: `"Present" | "Absent" | "Half Day" | "Leave" | "Holiday"`.
   - `STATUS_CHOICES` in the model migration matches the model module.
   - `derive_cell` returns the same dict shape (`code`, `holiday_name`) as the existing Sunday / org-holiday branch — frontend `CellPayload.holiday_name` already optional.

4. **Scope:** Single focused change. No out-of-scope features (bulk pin, Holiday-model FK, name input, clear button) crept in.
