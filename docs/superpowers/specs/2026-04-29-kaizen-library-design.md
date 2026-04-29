# Kaizen Library — Design

**Date:** 2026-04-29
**Author:** Safy (with Claude)
**Status:** Spec — pending implementation plan.

---

## 1. Goal

Add a **Kaizen Library** module: a lightweight, company-wide knowledge base where any employee can record a takeaway from a client engagement (audit miss, process gap, billing mistake, etc.) so the team builds a shared library of lessons.

Entries are submitted by employees and approved (or rejected) by an admin. Approved entries become a permanent reference; rejected entries are hidden from the list with a stored reason.

## 2. Behavioural requirements

1. **Open to all employees.** Any authenticated user can raise a Kaizen entry.
2. **Admin approval required.** A new entry starts in `Pending`; an admin (in any organisation) approves or rejects it.
3. **Status visibility:** `Pending` and `Approved` rows are visible to everyone. `Rejected` rows are hidden from the default list (visible only to admins via a toggle).
4. **Cross-organisation visibility.** The list view is **not** filtered by the caller's organisation — every user sees every (non-rejected) Kaizen entry. The `org` of the raiser is still stored on the row for reporting/traceability.
5. **Auto-populated fields.** `raised_by` and `entry_date` are filled by the server when the row is created.
6. **Raiser can fix typos** while the entry is still `Pending` (edit + delete allowed). Once `Approved`, the row is locked for the raiser; admins can still edit/delete.
7. **Required reason on reject.** Admins must provide a non-empty rejection reason; the reason is stored on the row.

## 3. Out of scope

- Per-org Kaizen libraries (the library is global by design — see §2.4).
- Comments / discussion threads on a Kaizen entry.
- Attachments / file uploads on entries.
- Voting / "this helped me" reactions.
- Email / Slack notifications to the raiser on approve/reject (a future enhancement; the WebSocket broadcast already updates the raiser's open browser tab).
- Categorising Kaizen entries beyond the free-text `area` field. If a fixed taxonomy becomes useful later, `area` can be promoted to a `Master` lookup.

## 4. Backend design

### 4.1 New app

A new Django app `core/kaizen` following the project's standard skeleton:

```
core/kaizen/
├── __init__.py
├── apps.py
├── models.py
├── serializers.py
├── views.py
├── urls.py
├── admin.py
└── tests.py
```

Registered in `config/settings.py` (`INSTALLED_APPS`) and `config/urls.py` (`path("api/", include("core.kaizen.urls"))`).

### 4.2 Model

A single model — `Kaizen` — inheriting `core.base.TimeStampedModel`:

| Field | Type | Notes |
|---|---|---|
| `uid` | `UUIDField` (default `uuid4`, `unique=True`, `db_index=True`) | external identifier — never expose `id`. |
| `org` | `FK → users.Org` (`null=True`, `on_delete=SET_NULL`, `related_name="kaizens"`) | auto-set from creator via `core.org_utils.resolve_create_org`. **Not used for list filtering.** |
| `raised_by` | `FK → settings.AUTH_USER_MODEL` (`null=True`, `on_delete=SET_NULL`, `related_name="raised_kaizens"`) | auto-set to `request.user` on create. Read-only after that. |
| `entry_date` | `DateField` (`db_index=True`) | auto-set to `timezone.localdate()` on create. Read-only after that. |
| `client` | `FK → masters.Master` (string ref, `limit_choices_to={"type": "client"}`, `null=True`, `on_delete=SET_NULL`, `related_name="client_kaizens"`) | required at API level. |
| `area` | `CharField(max_length=255)` | free text. |
| `description` | `TextField` | required (non-blank). |
| `takeaway` | `TextField` | required (non-blank). |
| `status` | `CharField(max_length=20, choices=STATUS_CHOICES, default="Pending", db_index=True)` | `Pending` / `Approved` / `Rejected`. |
| `reviewed_by` | `FK → settings.AUTH_USER_MODEL` (`null=True`, `on_delete=SET_NULL`, `related_name="reviewed_kaizens"`) | the admin who approved/rejected. |
| `reviewed_at` | `DateTimeField (null=True, blank=True)` | when reviewed. |
| `rejection_reason` | `TextField(blank=True, default="")` | required at reject time; otherwise empty. |
| `created_at` / `updated_at` | inherited from `TimeStampedModel`. |

```python
STATUS_CHOICES = [
    ("Pending", "Pending"),
    ("Approved", "Approved"),
    ("Rejected", "Rejected"),
]
```

`Meta`:

```python
ordering = ["-entry_date", "-created_at"]
verbose_name = "kaizen entry"
verbose_name_plural = "kaizen entries"
indexes = [
    models.Index(fields=["status", "-entry_date"], name="kaizen_status_date_idx"),
]
```

`__str__` returns `f"{self.area} ({self.status})"` (or `f"Kaizen #{self.pk}"` if `area` is empty).

> Note on the "S No" column from the spreadsheet — **not stored**. The frontend numbers rows by display index. Storing it would invite drift across paginated/filtered views.

### 4.3 Serializer

`KaizenSerializer` follows the project's read-vs-write FK pattern:

```python
class KaizenSerializer(serializers.ModelSerializer):
    raised_by_detail = UserMinSerializer(source="raised_by", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    client_detail = MasterMinSerializer(source="client", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=True,
        allow_null=False,
    )

    class Meta:
        model = Kaizen
        fields = [
            "id", "uid",
            "org_uid",
            "raised_by_detail",
            "entry_date",
            "client", "client_detail",
            "area", "description", "takeaway",
            "status",
            "reviewed_by_detail", "reviewed_at",
            "rejection_reason",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "uid",
            "org_uid",
            "raised_by_detail",
            "entry_date",
            "client_detail",
            "status",                # status changes only via approve/reject actions
            "reviewed_by_detail", "reviewed_at",
            "rejection_reason",
            "created_at", "updated_at",
        ]
```

`raised_by` is **not** an API-writable field — the viewset sets it from `request.user`. Same for `org` (`resolve_create_org`), `entry_date`, and `status`.

### 4.4 ViewSet

`KaizenViewSet(UidLookupMixin, ModelViewSet)`:

```python
class KaizenViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = KaizenSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = Kaizen.objects.select_related(
            "org", "raised_by", "client", "reviewed_by"
        )

        # Hide Rejected by default. Admins (in any org) can opt in.
        include_rejected = (
            self.request.query_params.get("include_rejected") == "1"
            and user.memberships.filter(role="admin").exists()
        )
        if not include_rejected:
            qs = qs.exclude(status="Rejected")

        # Optional filters
        status = self.request.query_params.get("status")
        client_uid = self.request.query_params.get("client_uid")
        if status:
            qs = qs.filter(status=status)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        return qs
```

> No `visibility_q(...)` call — the list is global by design (§2.4). Each row's `org` is informational only.

**`perform_create`:**

```python
def perform_create(self, serializer):
    org, err = resolve_create_org(self.request)
    if err is not None:
        _raise_from_response(err)
    obj = serializer.save(
        raised_by=self.request.user,
        org=org,
        entry_date=timezone.localdate(),
        status="Pending",
    )
    broadcast("kaizen", "INSERT", KaizenSerializer(obj).data)
```

**`perform_update`:** allowed if `(obj.raised_by_id == user.id and obj.status == "Pending")` or the caller is admin in any org. Otherwise raise `PermissionDenied`. Cannot change `status`, `reviewed_by`, `reviewed_at`, `rejection_reason` here — those are read-only on the serializer.

**`perform_destroy`:** same gate as `perform_update`.

**Custom actions:**

```python
@action(detail=True, methods=["post"], url_path="approve")
def approve(self, request, uid=None):
    user = cast(User, request.user)
    if not user.memberships.filter(role="admin").exists():
        raise PermissionDenied("Admin role required to approve")
    obj = self.get_object()
    if obj.status != "Pending":
        raise ValidationError({"detail": f"Cannot approve a {obj.status} entry"})
    obj.status = "Approved"
    obj.reviewed_by = user
    obj.reviewed_at = timezone.now()
    obj.rejection_reason = ""
    obj.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
    broadcast("kaizen", "UPDATE", KaizenSerializer(obj).data)
    return Response(KaizenSerializer(obj).data)

@action(detail=True, methods=["post"], url_path="reject")
def reject(self, request, uid=None):
    user = cast(User, request.user)
    if not user.memberships.filter(role="admin").exists():
        raise PermissionDenied("Admin role required to reject")
    reason = (request.data.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "Rejection reason is required"})
    obj = self.get_object()
    if obj.status != "Pending":
        raise ValidationError({"detail": f"Cannot reject a {obj.status} entry"})
    obj.status = "Rejected"
    obj.reviewed_by = user
    obj.reviewed_at = timezone.now()
    obj.rejection_reason = reason
    obj.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "updated_at"])
    broadcast("kaizen", "UPDATE", KaizenSerializer(obj).data)
    return Response(KaizenSerializer(obj).data)
```

> Both actions reuse `get_object()`, which honours the viewset's queryset — meaning a non-admin who somehow guesses a Pending row's UID still gets a 403 because the action body checks the admin role.

### 4.5 URLs

```python
# core/kaizen/urls.py
router = DefaultRouter()
router.register("kaizens", KaizenViewSet, basename="kaizen")
urlpatterns = [path("", include(router.urls))]
```

Included in `config/urls.py`:

```python
path("api/", include("core.kaizen.urls")),
```

### 4.6 Admin

```python
@admin.register(Kaizen)
class KaizenAdmin(admin.ModelAdmin):
    list_display = ["uid", "raised_by", "client", "area", "status", "entry_date"]
    list_filter = ["status"]
    search_fields = ["area", "description", "takeaway"]
    autocomplete_fields = ["raised_by", "client", "reviewed_by"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    date_hierarchy = "entry_date"
```

### 4.7 Realtime

Channel name: `"kaizen"`. Events: `INSERT` on create, `UPDATE` on patch / approve / reject, `DELETE` on destroy. Frontend subscribes via the existing Channels consumer.

## 5. Frontend design

### 5.1 New page

`frontend/task-tracker/src/pages/KaizenPage.tsx` — modelled on `pages/GrowthPlanPage.tsx`:

- Header bar: filters (`Search`, `Status`, `Client`) on the left, **+ New Kaizen** button on the right.
- "Show rejected" toggle visible only to admins (`isAdminInAny()`).
- Table columns: **# | Raised By | Client | Area | Description | Take Away | Status | Entry Date | Actions**.
- Status pill: `Pending` (amber), `Approved` (green). `Rejected` rows are hidden by default.

### 5.2 Add / edit row

`frontend/task-tracker/src/components/kaizen/EditRow.tsx` — inline-editable row mirroring the GrowthPlan pattern:

- Fields the user fills: **Client** (dropdown from `useMasters().clients`), **Area** (text input), **Description** (textarea), **Take Away** (textarea).
- Read-only display: Raised By (current user's name), Entry Date (today).
- **Save** posts to `/kaizens/`; **Cancel** discards. Save is disabled until `client`, `description`, and `takeaway` are non-empty.
- **Edit** on an existing `Pending` row reuses the same component. Edit is hidden for the raiser once `status='Approved'`. Admins always see Edit.

### 5.3 Approve / reject

In the **Actions** column, on every `Pending` row visible to an admin:

- **Approve** ✓ → POST `/kaizens/<uid>/approve/` (no body). Optimistic update via WS broadcast.
- **Reject** ✕ → opens `components/kaizen/RejectModal.tsx`: a small modal with a required `Reason` textarea and a Submit / Cancel pair. Submit posts `{ reason }` to `/kaizens/<uid>/reject/`. The row disappears from the default list (reappears under "Show rejected").

### 5.4 Realtime + badge

- Subscribe to `ws("kaizen")` in `KaizenPage` to refresh on remote `INSERT` / `UPDATE` / `DELETE`.
- New hook `hooks/useKaizenPendingBadge.ts` returns the count of `Pending` entries for **admins only** (returns `0` for non-admins). Mirrors `useLeadsBadgeCount`.
- `App.tsx` passes `kaizenBadgeCount` to `Header` → `NavMenu`. `NavMenu.tsx` renders the count on the Kaizen tab when it's `> 0` and the user is admin.

### 5.5 Navigation wiring

Files to edit:

- `App.tsx` — `lazy` import for `KaizenPage`, add `kaizen` entry to `VIEW_MAP`, add `kaizenBadgeCount` prop on `Header`.
- `types/index.ts` — add `"kaizen"` to the `View` union.
- `components/header/NavMenu.tsx` — add `{ id: "kaizen", label: "Kaizen", icon: icons.kaizen }`. Visible to **all users** (no access flag, like Conveyance).
- `components/layout/Header.tsx` — pass `icons.kaizen` and `kaizenBadgeCount` through to `NavMenu`. Add a small icon for the new tab in the icon set used by `Header`.

### 5.6 New types

`frontend/task-tracker/src/types/kaizen.ts`:

```ts
export type KaizenStatus = "Pending" | "Approved" | "Rejected";

export interface KaizenRow {
  id: string;          // uid from API
  raisedByName: string;
  raisedByUid: string | null;
  entryDate: string;   // ISO date
  clientUid: string | null;
  clientName: string;
  area: string;
  description: string;
  takeaway: string;
  status: KaizenStatus;
  reviewedByName: string;
  reviewedAt: string | null;
  rejectionReason: string;
  orgUid: string | null;
  createdAt: string;
  updatedAt: string;
}
```

DTO types (`KaizenDto`, `KaizenCreate`, `KaizenUpdate`) added to `types/api.ts` next to the existing `GrowthPlanDto` patterns.

## 6. Validation behaviour

- `client_uid` missing → 400 `{"client": ["This field is required."]}`.
- `description` or `takeaway` empty → 400 `{"<field>": ["This field may not be blank."]}`.
- `PATCH` by a non-raiser non-admin → 403.
- `PATCH` by raiser when `status != 'Pending'` → 403.
- `POST /approve/` by non-admin → 403.
- `POST /reject/` without `reason` → 400 `{"reason": ["Rejection reason is required"]}`.
- `POST /approve/` or `/reject/` on an already-Approved/Rejected row → 400.

## 7. Migration

A single `0001_initial` migration creating the `kaizen_kaizen` table with the indexes above. No data migration needed (new table).

## 8. Tests

`core/kaizen/tests.py` covers, at minimum:

1. Authenticated employee can `POST /kaizens/` — `raised_by` is set to the caller, `status` is `Pending`, `entry_date` is today.
2. Multi-org caller without an `org` in payload gets 400 (matches the rest of the codebase).
3. List endpoint shows entries from **other orgs** to a user (cross-org visibility). Rejected entries are hidden from non-admins.
4. Raiser can `PATCH` their own Pending row.
5. Raiser cannot `PATCH` their row once it's Approved (403).
6. Non-raiser non-admin gets 403 on `PATCH` / `DELETE` of someone else's row.
7. Admin (in any org) can `POST /approve/` — status flips, `reviewed_by` / `reviewed_at` set.
8. Non-admin gets 403 on `/approve/` and `/reject/`.
9. `/reject/` without a `reason` returns 400; with a reason it persists `rejection_reason` and the row disappears from the default list but returns under `?include_rejected=1` for admins.
10. `/approve/` or `/reject/` on a row that's already Approved/Rejected returns 400.

## 9. Files touched

**Created:**

- `core/kaizen/__init__.py`
- `core/kaizen/apps.py`
- `core/kaizen/models.py`
- `core/kaizen/serializers.py`
- `core/kaizen/views.py`
- `core/kaizen/urls.py`
- `core/kaizen/admin.py`
- `core/kaizen/tests.py`
- `core/kaizen/migrations/0001_initial.py`
- `frontend/task-tracker/src/pages/KaizenPage.tsx`
- `frontend/task-tracker/src/components/kaizen/EditRow.tsx`
- `frontend/task-tracker/src/components/kaizen/RejectModal.tsx`
- `frontend/task-tracker/src/utils/kaizen.ts`
- `frontend/task-tracker/src/types/kaizen.ts`
- `frontend/task-tracker/src/hooks/useKaizenPendingBadge.ts`

**Edited:**

- `config/settings.py` — add `"core.kaizen"` to `INSTALLED_APPS`.
- `config/urls.py` — add `path("api/", include("core.kaizen.urls"))`.
- `frontend/task-tracker/src/App.tsx` — lazy import, `VIEW_MAP` entry, badge wiring.
- `frontend/task-tracker/src/types/index.ts` — add `"kaizen"` to `View`.
- `frontend/task-tracker/src/types/api.ts` — `KaizenDto` / `KaizenCreate` / `KaizenUpdate`.
- `frontend/task-tracker/src/components/header/NavMenu.tsx` — new tab entry + badge.
- `frontend/task-tracker/src/components/layout/Header.tsx` — pass `kaizenBadgeCount` + icon through.
