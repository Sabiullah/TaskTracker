# Conveyance — Recurring Entries — Design

**Date:** 2026-04-30
**Author:** Safy (with Claude)
**Status:** Spec — pending implementation plan.

---

## 1. Goal

Extend the Conveyance module to support **recurring expenses** (e.g. *Claude MAX Registration · monthly*, *C Panel Purchase · yearly*). When the user creates an entry they pick a frequency; for any recurring frequency the system materialises one `ConveyanceEntry` per period across the chosen `start_month`–`end_month` window so each occurrence shows up in the transactions list and rolls into the existing summary endpoints with no special-casing.

Today every entry is a one-off; recurring expenses are tracked manually by typing them in each period. This change replaces that toil with a single submit.

## 2. Behavioural requirements

1. **Frequency choices** on the Add Entry form: `One-time` (default), `Monthly`, `Half-yearly`, `Yearly`.
2. **Start month / End month** fields appear only when frequency ≠ `one_time`. Both required for recurring; end ≥ start; ignored (and not stored) for one-time.
3. **Materialisation on create.** Recurring submission generates one `ConveyanceEntry` per period:
   - Step: monthly = +1 month, half-yearly = +6 months, yearly = +12 months.
   - Each generated entry's `date` is the **1st of its month**.
   - All siblings share a single `series_uid` so the backend and frontend can operate on the group.
   - One-time entries set `series_uid = NULL` and behave exactly as today.
4. **Approve / Reject is series-wide.** A single approve or reject action on any sibling flips the status of every row sharing the `series_uid` in one transaction. (One-time rows are a series of one — same code path, no special case.)
5. **Edit / Delete have a scope choice** when the row has a `series_uid`. The frontend modal offers:
   - **This entry only** — single row.
   - **Entire series** — every sibling, past and future.
   - **Entire series from this month** — the clicked row plus every sibling whose `date` is later (earlier siblings untouched).
   - One-time rows skip the modal and use the row-only path.
6. **Frequency, `start_month`, `end_month` and `series_uid` are immutable after creation.** To change them the user deletes the series and recreates it.
7. **Future-date validation is lifted for recurring rows.** A monthly Jan→Dec 2026 series submitted in April will legitimately create rows dated 2026-05-01 onward. One-time entries keep the existing `date <= today` rule.
8. **Transactions list collapses each series to one headline row.** Headline = the sibling whose `date` is the most recent on-or-before today; if every sibling is in the future, the earliest sibling. The headline shows a small badge (`Monthly · Jan–Dec 2026 · 5/12`) and a chevron that expands the rest of the series inline. One-time rows render exactly as today (no badge, no chevron).
9. **Existing filters keep working at the row level.** A month or status filter narrows the visible row set; if the natural headline drops out of the filtered view, the frontend re-picks the headline from what's still visible.

## 3. Out of scope

- Editable frequency / start / end after creation (see §2.6).
- Per-row "skip this month" affordance — to drop one occurrence the user runs Edit/Delete with `scope=row`.
- Open-ended series (no `end_month`). End month is always required for recurring.
- Automatic future generation past `end_month`. The series is a finite, fully-materialised set at create time.
- Changes to the `summary` endpoint. It already aggregates by month/employee/client; series rows roll up naturally.
- Bulk approve/reject of multiple unrelated series.
- Notifying the raiser on approve/reject of a series (the existing per-entry WebSocket broadcast fans out automatically when each row is updated).
- Cron / scheduled job to materialise rows over time. Everything is created upfront in the create transaction.

## 4. Backend design

### 4.1 Model changes — `core/conveyance/models.py`

Three new fields on `ConveyanceEntry`:

| Field | Type | Notes |
|---|---|---|
| `frequency` | `CharField(max_length=12, choices=FREQUENCY_CHOICES, default="one_time", db_index=True)` | required |
| `series_uid` | `UUIDField(null=True, blank=True, db_index=True)` | shared across siblings; `NULL` for one-time rows |
| `start_month` | `DateField(null=True, blank=True)` | first of month; `NULL` for one-time |
| `end_month` | `DateField(null=True, blank=True)` | first of month; `NULL` for one-time |

```python
FREQUENCY_CHOICES = [
    ("one_time", "One-time"),
    ("monthly", "Monthly"),
    ("half_yearly", "Half-yearly"),
    ("yearly", "Yearly"),
]
```

`start_month` / `end_month` are denormalised (every sibling carries the same pair) — no separate `Series` table. Reasons: keeps existing list/filter queries unchanged, avoids a JOIN on every list call, and the values never drift because they're immutable. YAGNI on a series table until we genuinely need series-level data we can't reconstruct from siblings.

A new index `Index(fields=["org", "series_uid"])` is added so series-wide reads (the approve/reject fan-out, scope-series edits) stay fast.

A migration adds the columns with their defaults. Existing entries become `frequency="one_time"`, all other new fields `NULL` — behaviourally identical to today.

### 4.2 Serializer — `core/conveyance/serializers.py`

`ConveyanceEntrySerializer` exposes `frequency`, `series_uid`, `start_month`, `end_month`:

- `frequency`: writable on create, **read-only on update**.
- `series_uid`: read-only always (assigned by the server).
- `start_month` / `end_month`: writable on create, read-only on update. Stored as the first of the month — the serializer normalises any `YYYY-MM-DD` input to the 1st of that month.

`validate_date`:
- For one-time submissions, keeps the existing `date <= today` rule.
- For recurring submissions, this validator is bypassed; the materialiser instead validates the **window** (see §4.3).

New cross-field `validate(self, attrs)` enforces:
- If `frequency == "one_time"` → `start_month` and `end_month` must be omitted/null.
- If `frequency != "one_time"` → both `start_month` and `end_month` are required, both normalised to the 1st of their month, and `end_month >= start_month`.
- For recurring, the explicit `date` field is ignored on input — the materialiser sets each sibling's `date` to the 1st of its own month.

### 4.3 View — `core/conveyance/views.py`

#### 4.3.1 Materialisation in `perform_create`

Existing `perform_create` already wraps the save in `transaction.atomic()` and processes attachments. The recurring path is folded in:

1. Resolve org and target employee as today.
2. Validate uploaded files as today.
3. If `frequency == "one_time"`: behaviour is unchanged (single `ConveyanceEntry`, `series_uid=None`, `start_month=None`, `end_month=None`).
4. If `frequency != "one_time"`:
   - Build the list of period start dates from `start_month` to `end_month` using the frequency step (1, 6, or 12 months). Each is the 1st of that month.
   - Generate a single `series_uid = uuid4()` for the batch.
   - For each period, instantiate a `ConveyanceEntry` with the same `client`, `reason`, `amount`, `claimable`, `frequency`, `series_uid`, `start_month`, `end_month`, `org`, `employee`, `created_by`. The row's `date` is the period start.
   - `bulk_create` the rows in a single statement.
   - Attachments are duplicated **per sibling**: each uploaded file is written once to disk per sibling (so a 12-month series with 2 attachments produces 24 stored files and 24 `ConveyanceAttachment` rows), giving every row independent ownership of its own file. This keeps the existing delete-on-row-delete cleanup path unchanged. See §6 for the cost note and the alternative we chose against.
5. Return the **headline row** (most recent sibling whose `date <= today`, else the earliest) so the frontend has a stable single row to insert into the table. The frontend's WebSocket handler reloads the full list anyway, so the response shape doesn't need to change.

The `validate_amount` / `validate_reason` / `validate_client` checks already apply to the single submission; they're inherited because `frequency` doesn't change those constraints.

#### 4.3.2 Series-wide approve / reject

`approve` and `reject` actions accept the same URL as today (`POST /api/conveyance-entries/<uid>/approve/`). The handler:

1. Loads the target entry, runs the existing permission checks (admin/manager in entry's org, no self-approve unless admin).
2. If `entry.series_uid is None` → updates only that row (current behaviour preserved).
3. If `entry.series_uid is not None` → updates **every** row sharing the `series_uid` whose status is currently `pending`. Rows already in a terminal state are left alone; the response includes a `skipped_count` so the frontend can surface "approved 11/12; one already approved".
4. One audit-log entry per action with `resource_id = series_uid` (or `entry.uid` for one-time), `changes={"status": "approved", "row_count": N}`.
5. WebSocket broadcasts: one `UPDATE` per affected row. The frontend already coalesces these via the `load()` reload.

#### 4.3.3 Scoped edit / delete

`PATCH` / `PUT` / `DELETE` on `/api/conveyance-entries/<uid>/` accept a query param `?scope=`:

| Value | Effect |
|---|---|
| `row` (default, or scope omitted) | Operate on the single row (existing behaviour). |
| `series` | Apply changes to every sibling sharing `series_uid`. The `date` field is **never** propagated (each sibling keeps its own 1st-of-month). `frequency`, `series_uid`, `start_month`, `end_month` are read-only as per §4.2. |
| `series_forward` | Same as `series`, but restricted to siblings whose `date >= entry.date`. |

If `entry.series_uid is None`, any `scope` other than `row` returns `400 Bad Request` (`{"scope": "row scope only — entry is not part of a series"}`).

The existing `_assert_mutable_for_caller` check is run for **every** affected row before any write — if the caller can't mutate one of them (e.g. it's already approved and they're not an admin), the entire update is rejected. Single transaction.

DELETE with `scope=series` / `series_forward` deletes attachments per row using the existing per-row file cleanup loop.

#### 4.3.4 List queryset

No change needed. Rows are returned per-row; the frontend handles the headline grouping.

### 4.4 Permissions and audit

Permissions are unchanged — every per-row check (mutability, ownership, org admin) runs on every affected row in the series-scoped paths. No new role.

Audit logs: today only `conveyance.approve` and `conveyance.reject` write audit entries. Both gain a `series_uid` field in their `changes` payload when the affected entry has one, and `row_count` records how many siblings were flipped. No new audit log call sites are introduced; create/update/delete continue to rely on the existing WebSocket broadcast and DB row history.

## 5. Frontend design

### 5.1 Form dialog — `ConveyanceFormDialog.tsx`

Three new fields, inserted after **Amount** and before **Claimable**:

```
Frequency:    [ One-time ▾ ]      ← always visible
Start month:  [ 2026-04   ]       ← visible only when frequency ≠ one-time
End month:    [ 2026-12   ]       ← visible only when frequency ≠ one-time
```

- Frequency uses the four `FREQUENCY_CHOICES` values; default `One-time`.
- Start/End month use `<input type="month">` so the browser supplies a month picker.
- The existing **Date** field is hidden when frequency ≠ `one_time` (the materialiser computes per-row dates).
- All three fields are **read-only in edit mode** — they reflect the row's current values but the user can't change them. A small inline note explains "Frequency, start and end months are fixed at creation. Delete the series to change them."
- Client-side validation: end ≥ start; both required when frequency ≠ one-time.
- The validator helper `conveyanceFormHelpers.ts` gains a `frequency` branch in `validateFormInputs` and a new `buildCreateFormData` field set.

### 5.2 Edit / Delete scope modal

Add a small `ConveyanceScopeDialog` component — a 3-button modal triggered by Edit or Delete on a row whose `series_uid` is set:

```
┌──────────────────────────────────────────┐
│ This entry is part of a recurring series.│
│                                          │
│  ( ) This entry only                     │
│  ( ) Entire series                       │
│  ( ) Entire series from this month       │
│                                          │
│              [ Cancel ]  [ Continue ]   │
└──────────────────────────────────────────┘
```

The choice is converted to the `?scope=row | series | series_forward` query param. One-time rows skip this modal entirely.

### 5.3 Transactions list — `ConveyanceTransactions.tsx`

Grouping is purely client-side from the existing `listEntries` payload:

1. Partition rows into series buckets by `series_uid` (one-time rows → singleton buckets keyed by `entry.uid`).
2. For each bucket, pick the headline:
   - Most recent sibling whose `date <= today` (using the user's local date), or
   - The earliest sibling if every `date > today`.
3. Render one row per bucket. Recurring rows show:
   - A small badge under the **Reason** cell: `Monthly · Jan–Dec 2026 · 5/12` (the count is `headline_index + 1 / total`).
   - A chevron on the leftmost cell. Click expands the bucket inline (sibling rows render as indented rows below the headline).
4. Filter interaction: existing filters (status, month, claimable, search, etc.) run row-level. After filtering, the headline-pick step runs again on the surviving rows so the user always sees a sensible headline for each visible bucket. Buckets with zero surviving siblings disappear from the list.
5. Approve / Reject buttons on a recurring headline trigger the series-wide endpoints unchanged (the API already fans out by `series_uid`). Edit / Delete trigger the scope modal first.

### 5.4 API client — `utils/conveyanceApi.ts`

- `createEntry(form)` — gains nothing; the new fields are part of the FormData payload.
- `updateEntry(uid, body, scope?: "row" | "series" | "series_forward")` — `scope` is appended as a query string when present.
- `deleteEntry(uid, scope?)` — same.
- `approveEntry` / `rejectEntry` — unchanged.

### 5.5 Types — `types/api/conveyance.ts`

Add to `ConveyanceEntry`:

```ts
frequency: "one_time" | "monthly" | "half_yearly" | "yearly";
series_uid: string | null;
start_month: string | null;   // YYYY-MM-DD (1st of month) or null
end_month: string | null;
```

Existing fields untouched.

## 6. Trade-offs and notes

- **Per-row attachments duplicate both DB rows and stored files** (one `ConveyanceAttachment` row + one file copy per sibling). For typical attachment counts (1–3 per entry) and reasonable series lengths (≤12), worst case is ~36 extra files per submission. The cheaper alternative — saving the file once and pointing all siblings at the same path — would either break the per-row delete cleanup (every sibling tries to unlink the file) or require shared-ownership tracking we don't have. Storage cost is small enough that we accept the duplication.
- **No reschedule.** If a series should run Jan→Dec but the user typed Jan→Nov, the only fix is delete-and-recreate. Acceptable for v1; revisit if real users hit this often.
- **No partial materialisation.** Yearly Jan 2026 → Dec 2030 creates 5 rows up front. Half-yearly with a 24-month window creates 4. Worst plausible case (monthly over 5 years) is 60 rows — fine for `bulk_create`.
- **Headline pick is purely UX.** The data model has no "current row" concept; the frontend decides on every render. This means scrolling forward in time (e.g. May 1) without reloading still shows April as the headline until the next list refresh — acceptable, the list is reloaded on any mutation and on tab focus.
