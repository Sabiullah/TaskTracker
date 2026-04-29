# Visit Report Multi-Attachment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `observation_attachment` field on `VisitReport` with a child `VisitReportAttachment` model so users can upload, list, remove, and download multiple files per visit report.

**Architecture:** Mirror the existing `ClientActionPointAttachment` / `ClientMeetingAttachment` pattern — child model + dedicated `attachments` action on the parent viewset for list/upload, plus a top-level viewset for delete/download. Drop the three legacy fields (`observation_attachment`, `attachment_filename`, `attachment_size_bytes`) — existing rows are test data, no migration of data needed. Frontend modal switches from a single `<input type="file">` to a `multiple` input plus a chip list with × buttons.

**Tech Stack:** Django 6 + DRF, Channels (broadcast), SQLite dev / Postgres prod. React 19 + TypeScript + Vite + Vitest.

**Spec:** [`docs/superpowers/specs/2026-04-29-visit-report-multi-attachment-design.md`](../specs/2026-04-29-visit-report-multi-attachment-design.md)

---

## File map

**Backend** (`core/masters/`):
- Modify: `models.py` — add `VisitReportAttachment`; drop `observation_attachment`, `attachment_filename`, `attachment_size_bytes` from `VisitReport`.
- Create: `migrations/0011_visit_report_multi_attachment.py` — single migration for both changes.
- Modify: `serializers.py` — new `VisitReportAttachmentSerializer`; update `VisitReportSerializer` to drop the 3 legacy fields and `download_url`, add nested `attachments`.
- Modify: `views.py` — `ClientVisitViewSet.perform_create` and `VisitReportViewSet.update` / `resubmit` no longer handle `observation_attachment`; new `attachments` action on `VisitReportViewSet` (list + upload); new top-level `VisitReportAttachmentViewSet` for delete + download; resubmit clones attachments to the new revision; remove the old `attachment_download` action.
- Modify: `urls.py` — register the new viewset at `visit-report-attachments`.
- Modify: `admin.py` — register `VisitReportAttachment`.
- Modify: `tests.py` — extend `AttachmentUploadTests` with visit-report-attachment cases; extend `VisitReportLifecycleTests` for the resubmit-clones-attachments case.

**Frontend** (`frontend/task-tracker/src/`):
- Modify: `types/api/internalReports.ts` — drop 3 legacy fields from `VisitReportDto`; add `attachments: VisitReportAttachmentDto[]`; new `VisitReportAttachmentDto`; drop `observation_attachment` from `ClientVisitCreateForm` and `VisitReportEditForm`.
- Modify: `lib/api/internalReports.ts` — drop `observation_attachment` appends from `createVisit` / `editReport` / `resubmitReport`; switch all three back to JSON (`apiPost` / `apiPatch`); add `uploadVisitReportAttachment` and `deleteVisitReportAttachment`.
- Modify: `lib/api/index.ts` — export the two new helpers.
- Modify: `hooks/useClientVisits.ts` — `editDraft` / `resubmit` no longer take `observation_attachment`; types follow.
- Modify: `components/clients/VisitSubmitModal.tsx` — multi-file input + chip list; payload shapes change.
- Modify: `components/clients/ClientInternalReportTab.tsx` — call-site updates for the new payload shape.
- Modify: `components/clients/ClientVisitRow.tsx` — render attachment chip list instead of single-file link.

---

## Conventions used in this plan

- Backend test runner: `uv run python manage.py test core.masters.tests.<ClassName>.<test_name>` from repo root.
- Frontend test runner: from `frontend/task-tracker/`, `npm test -- <pattern>`.
- Type-check: backend `uv run mypy core/masters` (lax baseline); frontend `npm run build` (full `tsc -b`).
- Every task ends with a commit. Commit messages follow the existing convention: `feat(masters): …`, `feat(clients): …`, `test(masters): …`.

---

## Task 1: Add `VisitReportAttachment` model and migration

**Files:**
- Modify: `core/masters/models.py:359-410`
- Create: `core/masters/migrations/0011_visit_report_multi_attachment.py`
- Test: `core/masters/tests.py` (new test method on a new test class)

- [ ] **Step 1: Write failing model test for `VisitReportAttachment`**

Append to `core/masters/tests.py` (after `class AttachmentUploadTests` ends at ~line 335):

```python
class VisitReportAttachmentModelTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("vra_model", role="employee")
        self.client_master = _make_client(self.org)
        self.visit = ClientVisit.objects.create(
            org=self.org,
            client=self.client_master,
            visit_date=datetime.date(2026, 4, 25),
            prepared_by=self.user,
            assigned_manager=self.user,
        )
        self.report = VisitReport.objects.create(
            visit=self.visit, revision_number=1, status="Draft", created_by=self.user,
        )

    def test_attachment_can_be_created_and_cascades(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.create(
            report=self.report,
            file=SimpleUploadedFile("a.txt", b"abc", content_type="text/plain"),
            filename="a.txt",
            size_bytes=3,
            uploaded_by=self.user,
        )
        self.assertEqual(VisitReportAttachment.objects.count(), 1)
        self.assertEqual(att.report_id, self.report.id)
        # CASCADE: deleting the report removes its attachments.
        self.report.delete()
        self.assertEqual(VisitReportAttachment.objects.count(), 0)

    def test_visit_report_no_longer_has_legacy_fields(self):
        # The three fields are dropped in this change. accessing them must AttributeError.
        for fname in ("observation_attachment", "attachment_filename", "attachment_size_bytes"):
            with self.assertRaises(AttributeError):
                getattr(self.report, fname)
```

You'll also need to add `VisitReportAttachment` to the import block at the top of the test class — leave that for the next step.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.masters.tests.VisitReportAttachmentModelTests -v 2`
Expected: FAIL with `ImportError: cannot import name 'VisitReportAttachment'` (or NameError on the `from core.masters.models import VisitReportAttachment` line).

- [ ] **Step 3: Add the model**

Modify `core/masters/models.py`. After the `VisitReport` class definition (right before `class VisitReportAuditEvent` at ~line 412), insert:

```python
class VisitReportAttachment(models.Model):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    report = models.ForeignKey(
        VisitReport,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to="client_visits/%Y/%m/")
    filename = models.CharField(max_length=255)
    size_bytes = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_visit_report_attachments",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "visit report attachment"
        verbose_name_plural = "visit report attachments"

    def __str__(self):
        return self.filename or f"vr-attachment #{self.pk}"
```

Also remove these three lines from the `VisitReport` model body (currently at `models.py:371-373`):

```python
    observation_attachment = models.FileField(upload_to="client_visits/%Y/%m/", blank=True, null=True)
    attachment_filename = models.CharField(max_length=255, blank=True, default="")
    attachment_size_bytes = models.PositiveBigIntegerField(default=0)
```

- [ ] **Step 4: Generate the migration**

Run: `uv run python manage.py makemigrations masters --name visit_report_multi_attachment`
Expected: creates `core/masters/migrations/0011_visit_report_multi_attachment.py`. Inspect it — it should contain one `CreateModel` for `VisitReportAttachment` and three `RemoveField` operations against `VisitReport`.

If the file is named differently (Django sometimes picks a different name), rename it to `0011_visit_report_multi_attachment.py`.

- [ ] **Step 5: Apply the migration locally and re-run the test**

Run: `uv run python manage.py migrate masters` then `uv run python manage.py test core.masters.tests.VisitReportAttachmentModelTests -v 2`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add core/masters/models.py core/masters/migrations/0011_visit_report_multi_attachment.py core/masters/tests.py
git commit -m "feat(masters): add VisitReportAttachment model, drop legacy single-file fields"
```

---

## Task 2: Add `VisitReportAttachmentSerializer` and update `VisitReportSerializer`

**Files:**
- Modify: `core/masters/serializers.py:329-397`

- [ ] **Step 1: Add the new serializer**

Modify `core/masters/serializers.py`. Add to the model imports at the top (currently importing from `.models`):

```python
from .models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    ClientVisit,
    Master,
    VisitReport,
    VisitReportAttachment,
    VisitReportAuditEvent,
    is_visit_overdue,
)
```

Insert this serializer right before `class VisitReportAuditEventSerializer` (around line 329):

```python
class VisitReportAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = VisitReportAttachment
        fields = [
            "id",
            "uid",
            "report",
            "filename",
            "size_bytes",
            "uploaded_by_detail",
            "uploaded_at",
            "download_url",
        ]
        read_only_fields = fields

    def get_download_url(self, obj):
        if not obj.file:
            return ""
        path = reverse("visit-report-attachment-download", kwargs={"uid": str(obj.uid)})
        request = (self.context or {}).get("request")
        return request.build_absolute_uri(path) if request else path
```

- [ ] **Step 2: Update `VisitReportSerializer`**

Replace the `VisitReportSerializer` class body (currently `serializers.py:349-397`) with:

```python
class VisitReportSerializer(serializers.ModelSerializer):
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    attachments = VisitReportAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = VisitReport
        fields = [
            "id",
            "uid",
            "visit",
            "revision_number",
            "key_points",
            "status",
            "submitted_at",
            "reviewed_at",
            "reviewed_by_detail",
            "manager_comment",
            "created_by_detail",
            "created_at",
            "updated_at",
            "attachments",
        ]
        read_only_fields = [
            "id",
            "uid",
            "visit",
            "revision_number",
            "status",
            "submitted_at",
            "reviewed_at",
            "reviewed_by_detail",
            "manager_comment",
            "created_by_detail",
            "created_at",
            "updated_at",
            "attachments",
        ]
```

(The `download_url` `SerializerMethodField` and the `get_download_url` method are gone — replaced by per-attachment download URLs on `VisitReportAttachmentSerializer`.)

- [ ] **Step 3: Run existing serializer-impacting tests**

Run: `uv run python manage.py test core.masters.tests.VisitReportLifecycleTests -v 2`
Expected: PASS — the tests don't assert on the dropped fields. If any fails because of `attachment_filename` etc. in test bodies, it's a real referent — fix the test in this commit.

- [ ] **Step 4: Commit**

```bash
git add core/masters/serializers.py
git commit -m "feat(masters): add VisitReportAttachmentSerializer, slim VisitReportSerializer"
```

---

## Task 3: New attachments endpoint on `VisitReportViewSet` (list + upload)

**Files:**
- Modify: `core/masters/views.py:672-915`
- Test: `core/masters/tests.py`

- [ ] **Step 1: Write the failing upload test**

Append to `core/masters/tests.py`:

```python
class VisitReportAttachmentApiTests(TestCase):
    def setUp(self):
        self.org, self.junior = _make_org_user("vra_jr", role="employee")
        self.manager = User.objects.create_user(username="vra_mgr", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.outsider = User.objects.create_user(username="vra_out", password="pw", full_name="Out")
        OrgMembership.objects.create(
            user=self.outsider, org=Org.objects.create(name="Other"), role="employee",
        )
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        self.api.force_authenticate(self.junior)
        res = self.api.post(
            "/api/client-visits/",
            {
                "client": str(self.client_master.uid),
                "visit_date": "2026-04-25",
                "assigned_manager": str(self.manager.uid),
                "key_points": "ok",
            },
            format="multipart",
        )
        assert res.status_code == 201, res.data
        self.report_uid = res.data["reports"][0]["uid"]

    def _upload(self, name="a.txt", body=b"hello"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile(name, body, content_type="text/plain")
        return self.api.post(
            f"/api/visit-reports/{self.report_uid}/attachments/",
            {"file": upload},
            format="multipart",
        )

    def test_upload_to_draft_creates_attachment(self):
        from core.masters.models import VisitReportAttachment

        res = self._upload(name="notes.txt", body=b"hello world")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(VisitReportAttachment.objects.count(), 1)
        att = VisitReportAttachment.objects.get()
        self.assertEqual(att.filename, "notes.txt")
        self.assertEqual(att.size_bytes, len(b"hello world"))
        assert att.uploaded_by is not None
        self.assertEqual(att.uploaded_by.id, self.junior.id)
        self.assertIn("/visit-report-attachments/", res.data["download_url"])
        self.assertIn("/download/", res.data["download_url"])

    def test_list_attachments_for_report(self):
        self._upload(name="a.txt")
        self._upload(name="b.txt")
        res = self.api.get(f"/api/visit-reports/{self.report_uid}/attachments/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.masters.tests.VisitReportAttachmentApiTests.test_upload_to_draft_creates_attachment -v 2`
Expected: FAIL — 404 because the route doesn't exist yet.

- [ ] **Step 3: Add the `attachments` action on `VisitReportViewSet`**

Modify `core/masters/views.py`. First, add `VisitReportAttachment` to the model import block at the top (around line 21):

```python
from .models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    ClientVisit,
    Master,
    VisitReport,
    VisitReportAttachment,
    VisitReportAuditEvent,
)
```

And add `VisitReportAttachmentSerializer` to the serializer import block:

```python
from .serializers import (
    ClientActionPointAttachmentSerializer,
    ClientActionPointSerializer,
    ClientMeetingAttachmentSerializer,
    ClientMeetingSerializer,
    ClientRoadmapSerializer,
    ClientVisitSerializer,
    MasterSerializer,
    VisitReportAttachmentSerializer,
    VisitReportAuditEventSerializer,
    VisitReportSerializer,
)
```

Then, inside `VisitReportViewSet`, replace the existing `attachment_download` action (currently at `views.py:907-915`) with a new combined `attachments` action. The action handles `GET` (list) and `POST` (upload):

```python
    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, uid=None):
        report = self.get_object()
        if request.method == "GET":
            qs = report.attachments.all()
            return Response(
                VisitReportAttachmentSerializer(qs, many=True, context={"request": request}).data
            )
        # POST: only the report author can upload, and only while Draft.
        user = cast(User, request.user)
        if report.created_by_id != user.id:
            raise PermissionDenied("Only the report author may upload attachments.")
        if report.status != "Draft":
            raise ValidationError({"detail": f"Report is not editable in status {report.status!r}."})
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "File is required."})
        obj = VisitReportAttachment.objects.create(
            report=report,
            file=upload,
            filename=upload.name,
            size_bytes=upload.size or 0,
            uploaded_by=user,
        )
        broadcast(
            "visit-reports",
            "UPDATE",
            VisitReportSerializer(report, context={"request": request}).data,
        )
        return Response(
            VisitReportAttachmentSerializer(obj, context={"request": request}).data,
            status=201,
        )
```

(Don't worry about the `visit-report-attachment-download` URL not existing yet — that's added in Task 4. The test for `download_url` reads the rendered URL from the serializer, but we'll need the named URL to exist before the serializer can call `reverse(...)` without error — see Step 5.)

- [ ] **Step 4: Update prefetch on the queryset so `attachments` doesn't N+1**

Inside `VisitReportViewSet.get_queryset` (currently `views.py:686-697`), append `.prefetch_related("attachments", "attachments__uploaded_by")` after the existing `select_related`:

Replace:
```python
        qs = VisitReport.objects.select_related(
            "visit", "visit__client", "visit__org", "reviewed_by", "created_by"
        ).filter(visit__org_id__in=org_ids)
```

with:

```python
        qs = (
            VisitReport.objects.select_related(
                "visit", "visit__client", "visit__org", "reviewed_by", "created_by"
            )
            .prefetch_related("attachments", "attachments__uploaded_by")
            .filter(visit__org_id__in=org_ids)
        )
```

Do the same on `ClientVisitViewSet.get_queryset` (currently `views.py:520-524`) by extending its existing `prefetch_related` chain to include `"reports__attachments"` and `"reports__attachments__uploaded_by"`:

Replace:
```python
        qs = (
            ClientVisit.objects.select_related("client", "prepared_by", "assigned_manager", "org", "created_by")
            .prefetch_related("reports__reviewed_by", "reports__created_by", "audit_events__actor")
            .filter(org_id__in=org_ids)
        )
```

with:

```python
        qs = (
            ClientVisit.objects.select_related("client", "prepared_by", "assigned_manager", "org", "created_by")
            .prefetch_related(
                "reports__reviewed_by",
                "reports__created_by",
                "reports__attachments",
                "reports__attachments__uploaded_by",
                "audit_events__actor",
            )
            .filter(org_id__in=org_ids)
        )
```

- [ ] **Step 5: Run tests — they will still fail**

Run: `uv run python manage.py test core.masters.tests.VisitReportAttachmentApiTests -v 2`
Expected: FAIL on the serializer's `download_url` call because `reverse("visit-report-attachment-download", ...)` has no URL named that yet. That's resolved in Task 4. Move on.

- [ ] **Step 6: Commit (WIP — Task 4 closes the loop)**

```bash
git add core/masters/views.py core/masters/tests.py
git commit -m "feat(masters): add visit-report attachments list+upload action"
```

---

## Task 4: Top-level `VisitReportAttachmentViewSet` (delete + download), URL routing

**Files:**
- Modify: `core/masters/views.py` (append after `VisitReportAuditEventViewSet`)
- Modify: `core/masters/urls.py:4-33`

- [ ] **Step 1: Write failing tests for delete + download**

Append to `core/masters/tests.py` inside `VisitReportAttachmentApiTests`:

```python
    def test_download_attachment(self):
        self._upload(name="notes.txt", body=b"hello world")
        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.get()
        res = self.api.get(f"/api/visit-report-attachments/{att.uid}/download/")
        self.assertEqual(res.status_code, 200)
        body = b"".join(getattr(res, "streaming_content"))  # noqa: B009
        self.assertEqual(body, b"hello world")
        self.assertIn("notes.txt", res["Content-Disposition"])

    def test_delete_attachment_while_draft(self):
        self._upload(name="a.txt")
        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.get()
        res = self.api.delete(f"/api/visit-report-attachments/{att.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(VisitReportAttachment.objects.count(), 0)

    def test_outsider_cannot_upload_or_list(self):
        self.api.force_authenticate(self.outsider)
        upload_res = self._upload()
        self.assertIn(upload_res.status_code, (403, 404))
        list_res = self.api.get(f"/api/visit-reports/{self.report_uid}/attachments/")
        self.assertIn(list_res.status_code, (403, 404))

    def test_cannot_upload_after_submit(self):
        # Submit the draft -> Pending. Upload must now 400.
        self.api.post(f"/api/visit-reports/{self.report_uid}/submit/", {}, format="json")
        res = self._upload()
        self.assertEqual(res.status_code, 400, res.data)

    def test_cannot_delete_after_submit(self):
        self._upload(name="a.txt")
        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.get()
        self.api.post(f"/api/visit-reports/{self.report_uid}/submit/", {}, format="json")
        res = self.api.delete(f"/api/visit-report-attachments/{att.uid}/")
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(VisitReportAttachment.objects.count(), 1)
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `uv run python manage.py test core.masters.tests.VisitReportAttachmentApiTests -v 2`
Expected: FAIL with 404 on `/api/visit-report-attachments/...` since the route doesn't exist.

- [ ] **Step 3: Add the new viewset**

Append to `core/masters/views.py` (right after `class VisitReportAuditEventViewSet`):

```python
class VisitReportAttachmentViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = VisitReportAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsVisitParticipant]
    http_method_names = ["get", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        org_ids = list(user.org_ids())
        admin_org_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
        qs = VisitReportAttachment.objects.select_related(
            "report", "report__visit", "report__visit__org", "uploaded_by"
        ).filter(report__visit__org_id__in=org_ids)
        return qs.filter(
            Q(report__visit__org_id__in=admin_org_ids)
            | Q(report__visit__prepared_by_id=user.id)
            | Q(report__visit__assigned_manager_id=user.id)
        ).distinct()

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_destroy(self, instance):
        report = instance.report
        user = cast(User, self.request.user)
        if report.created_by_id != user.id:
            raise PermissionDenied("Only the report author may delete attachments.")
        if report.status != "Draft":
            raise ValidationError(
                {"detail": f"Report is not editable in status {report.status!r}."}
            )
        instance.file.delete(save=False)
        instance.delete()
        broadcast(
            "visit-reports",
            "UPDATE",
            VisitReportSerializer(report, context={"request": self.request}).data,
        )

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        att = self.get_object()
        if not att.file:
            raise Http404("No file attached")
        return _stream_attachment(att.file, att.filename, request)
```

- [ ] **Step 4: Register the URL**

Modify `core/masters/urls.py`. Add `VisitReportAttachmentViewSet` to the imports:

```python
from .views import (
    ClientActionPointAttachmentViewSet,
    ClientActionPointViewSet,
    ClientMeetingAttachmentViewSet,
    ClientMeetingViewSet,
    ClientRoadmapViewSet,
    ClientVisitViewSet,
    MasterViewSet,
    VisitReportAttachmentViewSet,
    VisitReportAuditEventViewSet,
    VisitReportViewSet,
)
```

And append the new `router.register` (after `visit-audit-events`):

```python
router.register(
    "visit-report-attachments",
    VisitReportAttachmentViewSet,
    basename="visit-report-attachment",
)
```

The DRF router auto-creates names of form `<basename>-<actionname>`, so the `download` action becomes `visit-report-attachment-download` — which is what `VisitReportAttachmentSerializer.get_download_url` calls `reverse(...)` with. No further URL config needed.

- [ ] **Step 5: Run all the new attachment tests**

Run: `uv run python manage.py test core.masters.tests.VisitReportAttachmentApiTests -v 2`
Expected: PASS for all 7 tests in the class.

- [ ] **Step 6: Commit**

```bash
git add core/masters/views.py core/masters/urls.py core/masters/tests.py
git commit -m "feat(masters): add VisitReportAttachmentViewSet for delete/download"
```

---

## Task 5: Strip legacy single-file handling from create / edit-draft / resubmit

**Files:**
- Modify: `core/masters/views.py` — `ClientVisitViewSet.perform_create` (~564-607), `VisitReportViewSet.update` (~705-729), `VisitReportViewSet.resubmit` (~855-905)

The single-file uploads on the create / edit / resubmit endpoints are now dead code — the frontend will upload to the new endpoint. Removing them keeps the API surface clean.

- [ ] **Step 1: Replace `ClientVisitViewSet.perform_create`**

Replace the body (currently `views.py:564-607`) with:

```python
    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)

        user = cast(User, self.request.user)
        # Multipart payloads put non-file fields on request.data; pull
        # ``key_points`` directly because it isn't a ClientVisitSerializer field.
        key_points = self.request.data.get("key_points", "")

        with transaction.atomic():
            visit = serializer.save(
                created_by=user,
                prepared_by=user,
                org=org,
                current_status="Draft",
            )
            report = VisitReport.objects.create(
                visit=visit,
                revision_number=1,
                key_points=key_points,
                status="Draft",
                created_by=user,
            )
            VisitReportAuditEvent.objects.create(
                visit=visit,
                report=report,
                event_type="created",
                actor=user,
            )
        broadcast(
            "client-visits",
            "INSERT",
            ClientVisitSerializer(visit, context={"request": self.request}).data,
        )
```

- [ ] **Step 2: Replace `VisitReportViewSet.update`**

Replace the body (currently `views.py:705-729`) with:

```python
    def update(self, request, *args, **kwargs):
        # Allow PATCH only on Draft / Pending and only by the author of the report.
        report = self.get_object()
        user = cast(User, request.user)
        if report.created_by_id != user.id:
            raise PermissionDenied("Only the report author may edit.")
        if report.status not in ("Draft", "Pending"):
            raise PermissionDenied("Report is frozen — only Draft / Pending reports can be edited.")

        if "key_points" in request.data:
            report.key_points = request.data.get("key_points", "")
        report.save()
        broadcast(
            "visit-reports",
            "UPDATE",
            VisitReportSerializer(report, context={"request": request}).data,
        )
        return Response(VisitReportSerializer(report, context={"request": request}).data)
```

- [ ] **Step 3: Replace the file-handling part of `VisitReportViewSet.resubmit`**

Inside `resubmit` (currently `views.py:855-905`), replace the local-variable extraction:

```python
        key_points = request.data.get("key_points", "")
        upload = request.FILES.get("observation_attachment")
```

with:

```python
        key_points = request.data.get("key_points", "")
```

And replace the `VisitReport.objects.create(...)` call inside the atomic block:

```python
            new_rev = VisitReport.objects.create(
                visit=visit,
                revision_number=locked_latest.revision_number + 1,
                key_points=key_points,
                observation_attachment=upload,
                attachment_filename=upload.name if upload else "",
                attachment_size_bytes=upload.size if upload else 0,
                status="Draft",
                created_by=user,
            )
```

with:

```python
            new_rev = VisitReport.objects.create(
                visit=visit,
                revision_number=locked_latest.revision_number + 1,
                key_points=key_points,
                status="Draft",
                created_by=user,
            )
```

(Attachment cloning is added in Task 6 — leave the code without cloning for now so the test in that task can fail meaningfully.)

- [ ] **Step 4: Run the existing lifecycle tests**

Run: `uv run python manage.py test core.masters.tests.VisitReportLifecycleTests core.masters.tests.VisitReportPermissionTests -v 2`
Expected: PASS — these tests don't depend on the removed fields.

- [ ] **Step 5: Commit**

```bash
git add core/masters/views.py
git commit -m "refactor(masters): drop legacy single-file handling from visit-report endpoints"
```

---

## Task 6: Resubmit clones attachments to the new revision

**Files:**
- Modify: `core/masters/views.py` — inside `VisitReportViewSet.resubmit`
- Test: `core/masters/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/masters/tests.py` inside `VisitReportLifecycleTests`:

```python
    def test_resubmit_clones_attachments_to_new_revision(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from core.masters.models import VisitReportAttachment

        res = self._create_visit_as_junior()
        first_uid = res.data["reports"][0]["uid"]
        self.api.post(
            f"/api/visit-reports/{first_uid}/attachments/",
            {"file": SimpleUploadedFile("a.txt", b"AAA", content_type="text/plain")},
            format="multipart",
        )
        self.api.post(
            f"/api/visit-reports/{first_uid}/attachments/",
            {"file": SimpleUploadedFile("b.txt", b"BB", content_type="text/plain")},
            format="multipart",
        )
        self.api.post(f"/api/visit-reports/{first_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        self.api.post(
            f"/api/visit-reports/{first_uid}/reject/",
            {"manager_comment": "redo"},
            format="json",
        )
        self.api.force_authenticate(self.junior)
        r = self.api.post(
            f"/api/visit-reports/{first_uid}/resubmit/",
            {"key_points": "redone"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        new_uid = r.data["uid"]
        # Each revision keeps its own attachment rows — we duplicate them.
        self.assertEqual(VisitReportAttachment.objects.filter(report__uid=first_uid).count(), 2)
        self.assertEqual(VisitReportAttachment.objects.filter(report__uid=new_uid).count(), 2)
        new_filenames = sorted(
            VisitReportAttachment.objects.filter(report__uid=new_uid).values_list("filename", flat=True)
        )
        self.assertEqual(new_filenames, ["a.txt", "b.txt"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.masters.tests.VisitReportLifecycleTests.test_resubmit_clones_attachments_to_new_revision -v 2`
Expected: FAIL — only the 2 attachments on the first revision exist; new revision has 0.

- [ ] **Step 3: Add the cloning step inside `resubmit`**

Inside `VisitReportViewSet.resubmit` in `core/masters/views.py`, after the `VisitReport.objects.create(...)` that creates `new_rev` (and before `visit.current_status = "Draft"`), add:

```python
            # Carry the previous revision's attachments forward. Each row gets
            # its own file copy on disk so the user can later delete the old
            # revision's files (or we can prune Rejected revisions in batch)
            # without breaking the new revision's downloads.
            from django.core.files.base import ContentFile

            for prev in locked_latest.attachments.all():
                with prev.file.open("rb") as src:
                    contents = src.read()
                clone = VisitReportAttachment(
                    report=new_rev,
                    filename=prev.filename,
                    size_bytes=prev.size_bytes,
                    uploaded_by=prev.uploaded_by,
                )
                clone.file.save(prev.filename, ContentFile(contents), save=False)
                clone.save()
```

The full `resubmit` body should now read (showing the surrounding context for clarity):

```python
        with transaction.atomic():
            locked_latest = visit.reports.select_for_update().order_by("-revision_number").first()
            if locked_latest is None or locked_latest.id != latest.id:
                raise ValidationError({"detail": "Resubmit only from the latest revision."})
            if locked_latest.status != "Rejected":
                raise ValidationError({"detail": "Only Rejected reports can be resubmitted."})
            new_rev = VisitReport.objects.create(
                visit=visit,
                revision_number=locked_latest.revision_number + 1,
                key_points=key_points,
                status="Draft",
                created_by=user,
            )

            from django.core.files.base import ContentFile

            for prev in locked_latest.attachments.all():
                with prev.file.open("rb") as src:
                    contents = src.read()
                clone = VisitReportAttachment(
                    report=new_rev,
                    filename=prev.filename,
                    size_bytes=prev.size_bytes,
                    uploaded_by=prev.uploaded_by,
                )
                clone.file.save(prev.filename, ContentFile(contents), save=False)
                clone.save()

            visit.current_status = "Draft"
            visit.save(update_fields=["current_status", "updated_at"])
            VisitReportAuditEvent.objects.create(visit=visit, report=new_rev, event_type="resubmitted", actor=user)
```

- [ ] **Step 4: Run the test**

Run: `uv run python manage.py test core.masters.tests.VisitReportLifecycleTests.test_resubmit_clones_attachments_to_new_revision -v 2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/masters/views.py core/masters/tests.py
git commit -m "feat(masters): clone attachments to new revision on visit-report resubmit"
```

---

## Task 7: Register `VisitReportAttachment` in admin

**Files:**
- Modify: `core/masters/admin.py:1-76`

- [ ] **Step 1: Add admin registration**

Modify `core/masters/admin.py`. Update the import to include `VisitReportAttachment`:

```python
from .models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
    VisitReportAttachment,
)
```

Append at the end of the file:

```python
@admin.register(VisitReportAttachment)
class VisitReportAttachmentAdmin(admin.ModelAdmin):
    list_display = ["filename", "report", "uploaded_by", "size_bytes", "uploaded_at"]
    readonly_fields = ["uid", "uploaded_at", "size_bytes"]
    autocomplete_fields = ["report", "uploaded_by"]
```

(`VisitReport` itself isn't registered — keeping with the existing pattern that doesn't expose it in admin.)

- [ ] **Step 2: Sanity check**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit**

```bash
git add core/masters/admin.py
git commit -m "feat(masters): register VisitReportAttachment in admin"
```

---

## Task 8: Frontend types — drop legacy fields, add `VisitReportAttachmentDto`

**Files:**
- Modify: `frontend/task-tracker/src/types/api/internalReports.ts`

- [ ] **Step 1: Update DTO and form types**

Replace the contents of `frontend/task-tracker/src/types/api/internalReports.ts` with:

```ts
import type { MasterDto } from "./master";

export interface UserMinDto {
  readonly id: number;
  readonly uid: string;
  readonly full_name: string;
  readonly username: string;
  readonly avatar_color?: string;
}

export type VisitStatus = "Draft" | "Pending" | "Approved" | "Rejected";

export type VisitAuditEventType =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "resubmitted"
  | "sent_to_client"
  | "voice_note_marked";

export interface VisitReportAuditEventDto {
  readonly id: number;
  readonly uid: string;
  readonly visit_uid: string;
  readonly report_uid: string | null;
  readonly event_type: VisitAuditEventType;
  readonly actor_detail: UserMinDto | null;
  readonly comment: string;
  readonly created_at: string;
}

export interface VisitReportAttachmentDto {
  readonly id: number;
  readonly uid: string;
  readonly report: number;
  readonly filename: string;
  readonly size_bytes: number;
  readonly uploaded_by_detail: UserMinDto | null;
  readonly uploaded_at: string;
  readonly download_url: string;
}

export interface VisitReportDto {
  readonly id: number;
  readonly uid: string;
  readonly visit: number;
  readonly revision_number: number;
  readonly key_points: string;
  readonly status: VisitStatus;
  readonly submitted_at: string | null;
  readonly reviewed_at: string | null;
  readonly reviewed_by_detail: UserMinDto | null;
  readonly manager_comment: string;
  readonly created_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly attachments: readonly VisitReportAttachmentDto[];
}

export interface ClientVisitDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string | null;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly visit_date: string;
  readonly prepared_by: string | null;
  readonly prepared_by_detail: UserMinDto | null;
  readonly assigned_manager: string | null;
  readonly assigned_manager_detail: UserMinDto | null;
  readonly current_status: VisitStatus;
  readonly report_sent_date: string | null;
  readonly voice_note_sent: boolean;
  readonly voice_note_summary: string;
  readonly created_by_detail: UserMinDto | null;
  readonly reports: readonly VisitReportDto[];
  readonly audit_events: readonly VisitReportAuditEventDto[];
  readonly is_overdue: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientVisitCreateForm {
  readonly client: string;
  readonly visit_date: string;
  readonly assigned_manager: string;
  readonly key_points: string;
  readonly org?: string;
}

export interface VisitReportEditForm {
  readonly key_points?: string;
}

export interface VisitSentInfoForm {
  readonly report_sent_date?: string | null;
  readonly voice_note_sent?: boolean;
  readonly voice_note_summary?: string;
}

export interface DirectedNotificationPayload {
  readonly to_user_uid: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly link?: { tab?: string; visit_uid?: string };
}
```

(Compared with the original: `attachment_filename`, `attachment_size_bytes`, `download_url` dropped from `VisitReportDto`; `attachments` added; `observation_attachment` dropped from both forms; new `VisitReportAttachmentDto`.)

- [ ] **Step 2: Type-check**

From `frontend/task-tracker/`, run: `npm run build`
Expected: FAIL. Multiple errors in `lib/api/internalReports.ts`, `hooks/useClientVisits.ts`, `components/clients/VisitSubmitModal.tsx`, `components/clients/ClientInternalReportTab.tsx`, `components/clients/ClientVisitRow.tsx`. They reference fields we just removed. They get fixed in Tasks 9-13.

- [ ] **Step 3: Commit (WIP — finishes after Task 13)**

```bash
git add frontend/task-tracker/src/types/api/internalReports.ts
git commit -m "feat(internal-report-types): switch to multi-attachment shape"
```

---

## Task 9: Frontend API helpers

**Files:**
- Modify: `frontend/task-tracker/src/lib/api/internalReports.ts`
- Modify: `frontend/task-tracker/src/lib/api/index.ts`

- [ ] **Step 1: Replace `internalReports.ts` body**

Replace `frontend/task-tracker/src/lib/api/internalReports.ts` entirely with:

```ts
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  type RequestQuery,
} from "./client";
import type {
  ClientVisitDto,
  ClientVisitCreateForm,
  VisitReportAttachmentDto,
  VisitReportDto,
  VisitReportAuditEventDto,
  VisitReportEditForm,
  VisitSentInfoForm,
} from "@/types/api/internalReports";

export interface ListVisitsQuery extends RequestQuery {
  client_uid?: string;
  prepared_by_uid?: string | readonly string[];
  assigned_manager_uid?: string | readonly string[];
  status?: string | readonly string[];
  visit_month?: string;
  date_from?: string;
  date_to?: string;
  overdue?: "true";
}

export const listVisits = (query?: ListVisitsQuery) =>
  apiGet<ClientVisitDto[]>("/client-visits/", query);

export const getVisit = (uid: string) =>
  apiGet<ClientVisitDto>(`/client-visits/${uid}/`);

export const createVisit = (form: ClientVisitCreateForm) =>
  apiPost<ClientVisitDto>("/client-visits/", form);

export const deleteVisit = (uid: string) => apiDelete(`/client-visits/${uid}/`);

export const updateSentInfo = (uid: string, form: VisitSentInfoForm) =>
  apiPatch<ClientVisitDto>(`/client-visits/${uid}/sent-info/`, form);

export const editReport = (uid: string, form: VisitReportEditForm) =>
  apiPatch<VisitReportDto>(`/visit-reports/${uid}/`, form);

export const submitReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/submit/`, {});

export const approveReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/approve/`, {});

export const rejectReport = (uid: string, manager_comment: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/reject/`, { manager_comment });

export const resubmitReport = (uid: string, form: VisitReportEditForm) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/resubmit/`, form);

export const listAuditEvents = (visit_uid: string) =>
  apiGet<VisitReportAuditEventDto[]>("/visit-audit-events/", { visit_uid });

export function uploadVisitReportAttachment(
  reportUid: string,
  file: File,
): Promise<VisitReportAttachmentDto> {
  const fd = new FormData();
  fd.append("file", file);
  return apiPostForm<VisitReportAttachmentDto>(
    `/visit-reports/${reportUid}/attachments/`,
    fd,
  );
}

export const deleteVisitReportAttachment = (attachmentUid: string) =>
  apiDelete(`/visit-report-attachments/${attachmentUid}/`);
```

(Notable changes: `createVisit`, `editReport`, `resubmitReport` are now JSON-bodied — no `FormData` — because the file fields are gone. `apiPatchForm` import dropped. New `uploadVisitReportAttachment` and `deleteVisitReportAttachment` helpers.)

- [ ] **Step 2: Update `lib/api/index.ts` exports**

In `frontend/task-tracker/src/lib/api/index.ts`, replace the `internalReports` re-export block (lines 53-66) with:

```ts
export {
  approveReport,
  createVisit,
  deleteVisit,
  deleteVisitReportAttachment,
  editReport,
  getVisit,
  listAuditEvents,
  listVisits,
  rejectReport,
  resubmitReport,
  submitReport,
  updateSentInfo,
  uploadVisitReportAttachment,
  type ListVisitsQuery,
} from "./internalReports";
```

- [ ] **Step 3: Type-check**

From `frontend/task-tracker/`, run: `npm run build`
Expected: still failing — but the errors should now all be in `useClientVisits.ts`, `VisitSubmitModal.tsx`, `ClientInternalReportTab.tsx`, and `ClientVisitRow.tsx`. The `lib/api` files should type-check clean.

- [ ] **Step 4: Commit (WIP)**

```bash
git add frontend/task-tracker/src/lib/api/internalReports.ts frontend/task-tracker/src/lib/api/index.ts
git commit -m "feat(api): add upload/delete helpers for visit-report attachments"
```

---

## Task 10: Update `useClientVisits` hook

**Files:**
- Modify: `frontend/task-tracker/src/hooks/useClientVisits.ts`

The hook signatures get simpler — `editDraft` and `resubmit` no longer take an attachment file. Callers will use `uploadVisitReportAttachment` / `deleteVisitReportAttachment` directly when needed.

- [ ] **Step 1: Apply the diff**

The hook stays nearly identical — only the `VisitReportEditForm` shape changed (no longer carries a `File`), so existing call signatures remain valid. Verify by re-reading the file; no edits should be needed unless `tsc -b` flags one. Skip the file's commit if untouched.

- [ ] **Step 2: Type-check**

From `frontend/task-tracker/`, run: `npm run build`
Expected: still failing in `VisitSubmitModal.tsx`, `ClientInternalReportTab.tsx`, `ClientVisitRow.tsx`. The hook should be fine.

- [ ] **Step 3: Commit (skip if no changes)**

If anything *did* need editing in this file:

```bash
git add frontend/task-tracker/src/hooks/useClientVisits.ts
git commit -m "feat(hooks): align useClientVisits with multi-attachment payload shape"
```

Otherwise move on.

---

## Task 11: Update `VisitSubmitModal` to multi-file UI

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx`

The modal goes from one file picker → one chip list of newly-picked files plus (in edit/resubmit modes) a chip list of existing attachments with × buttons that call DELETE.

- [ ] **Step 1: Replace the file with the new implementation**

Replace `frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx` entirely with:

```tsx
import { useEffect, useState } from "react";
import { deleteVisitReportAttachment } from "@/lib/api";
import type { VisitReportAttachmentDto } from "@/types/api/internalReports";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";

export interface SubmitModalCreatePayload {
  mode: "create";
  client: string;
  visit_date: string;
  assigned_manager: string;
  key_points: string;
  newFiles: File[];
  submitImmediately: boolean;
}

export interface SubmitModalEditPayload {
  mode: "edit";
  reportUid: string;
  key_points: string;
  newFiles: File[];
  submitImmediately: boolean;
}

export interface SubmitModalResubmitPayload {
  mode: "resubmit";
  reportUid: string;
  key_points: string;
  newFiles: File[];
}

export type SubmitModalPayload =
  | SubmitModalCreatePayload
  | SubmitModalEditPayload
  | SubmitModalResubmitPayload;

interface CreateProps {
  mode: "create";
  open: boolean;
  defaultClientUid: string;
  clients: MasterItem[];
  managers: Profile[];
  onClose: () => void;
  onSubmit: (p: SubmitModalCreatePayload) => Promise<void>;
}
interface EditProps {
  mode: "edit";
  open: boolean;
  reportUid: string;
  initialKeyPoints: string;
  existingAttachments: readonly VisitReportAttachmentDto[];
  onClose: () => void;
  onSubmit: (p: SubmitModalEditPayload) => Promise<void>;
  onAttachmentDeleted: (attachmentUid: string) => void;
}
interface ResubmitProps {
  mode: "resubmit";
  open: boolean;
  reportUid: string;
  priorKeyPoints: string;
  managerComment: string;
  existingAttachments: readonly VisitReportAttachmentDto[];
  onClose: () => void;
  onSubmit: (p: SubmitModalResubmitPayload) => Promise<void>;
  onAttachmentDeleted: (attachmentUid: string) => void;
}

type Props = CreateProps | EditProps | ResubmitProps;

export default function VisitSubmitModal(props: Props) {
  const [client, setClient] = useState<string>(
    props.mode === "create" ? props.defaultClientUid : "",
  );
  const [visitDate, setVisitDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [assignedManager, setAssignedManager] = useState<string>("");
  const [keyPoints, setKeyPoints] = useState<string>(
    props.mode === "edit"
      ? props.initialKeyPoints
      : props.mode === "resubmit"
        ? props.priorKeyPoints
        : "",
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [submitImmediately, setSubmitImmediately] = useState<boolean>(props.mode === "resubmit");
  const [busy, setBusy] = useState(false);

  const isCreate = props.mode === "create";
  const isEdit = props.mode === "edit";
  const isResubmit = props.mode === "resubmit";
  const defaultClientUid = isCreate ? props.defaultClientUid : "";
  const initialKeyPoints = isEdit ? props.initialKeyPoints : "";
  const priorKeyPoints = isResubmit ? props.priorKeyPoints : "";

  useEffect(() => {
    if (!props.open) return;
    if (isCreate) {
      setClient(defaultClientUid);
      setVisitDate(new Date().toISOString().slice(0, 10));
      setAssignedManager("");
      setKeyPoints("");
      setNewFiles([]);
      setSubmitImmediately(false);
    }
    if (isEdit) {
      setKeyPoints(initialKeyPoints);
      setNewFiles([]);
      setSubmitImmediately(false);
    }
    if (isResubmit) {
      setKeyPoints(priorKeyPoints);
      setNewFiles([]);
      setSubmitImmediately(true);
    }
  }, [
    props.open,
    isCreate,
    isEdit,
    isResubmit,
    defaultClientUid,
    initialKeyPoints,
    priorKeyPoints,
  ]);

  if (!props.open) return null;

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (picked.length) setNewFiles((prev) => [...prev, ...picked]);
    // Reset the input value so re-picking the same file after × removal works.
    e.target.value = "";
  };

  const removeNewFileAt = (idx: number) =>
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));

  const removeExisting = async (attUid: string) => {
    if (props.mode !== "edit" && props.mode !== "resubmit") return;
    await deleteVisitReportAttachment(attUid);
    props.onAttachmentDeleted(attUid);
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (props.mode === "create") {
        await props.onSubmit({
          mode: "create",
          client,
          visit_date: visitDate,
          assigned_manager: assignedManager,
          key_points: keyPoints,
          newFiles,
          submitImmediately,
        });
      } else if (props.mode === "edit") {
        await props.onSubmit({
          mode: "edit",
          reportUid: props.reportUid,
          key_points: keyPoints,
          newFiles,
          submitImmediately,
        });
      } else {
        await props.onSubmit({
          mode: "resubmit",
          reportUid: props.reportUid,
          key_points: keyPoints,
          newFiles,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const existing =
    props.mode === "edit" || props.mode === "resubmit" ? props.existingAttachments : [];

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ margin: "0 0 12px" }}>
          {props.mode === "create" ? "New visit" : props.mode === "edit" ? "Edit draft" : "Resubmit visit report"}
        </h3>
        {props.mode === "resubmit" && (
          <div style={{ background: "#fef3c7", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            <strong>Manager rejected the previous report:</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{props.managerComment}</div>
          </div>
        )}

        {props.mode === "create" && (
          <>
            <Field label="Client">
              <select value={client} onChange={(e) => setClient(e.target.value)} style={input}>
                <option value="">Select…</option>
                {props.clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </Field>
            <Field label="Visit date">
              <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} style={input} />
            </Field>
            <Field label="Assigned manager">
              <select value={assignedManager} onChange={(e) => setAssignedManager(e.target.value)} style={input}>
                <option value="">Select…</option>
                {props.managers.map((p) => (<option key={p.id} value={p.id}>{p.full_name}</option>))}
              </select>
            </Field>
          </>
        )}

        <Field label="Key points">
          <textarea rows={5} value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} style={input} />
        </Field>

        <Field label="Observation report">
          <input type="file" multiple onChange={onPickFiles} />
          {(existing.length > 0 || newFiles.length > 0) && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {existing.map((att) => (
                <span key={att.uid} style={chip}>
                  📎 {att.filename}
                  <button
                    type="button"
                    aria-label={`Remove ${att.filename}`}
                    onClick={() => void removeExisting(att.uid)}
                    style={chipX}
                  >
                    ×
                  </button>
                </span>
              ))}
              {newFiles.map((f, i) => (
                <span key={`${f.name}-${i}`} style={chip}>
                  📎 {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => removeNewFileAt(i)}
                    style={chipX}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Field>

        {props.mode !== "resubmit" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={submitImmediately}
              onChange={(e) => setSubmitImmediately(e.target.checked)}
            />
            Submit for approval immediately (otherwise saved as Draft)
          </label>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={props.onClose} style={btn}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} style={primaryBtn}>
            {busy ? "Saving…" : (props.mode === "resubmit" || submitImmediately) ? "Save & Submit" : "Save Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modal: React.CSSProperties = {
  width: 520, maxWidth: "90vw", background: "#fff", padding: 20,
  borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.2)",
};
const input: React.CSSProperties = { width: "100%", padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 };
const btn: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 6 };
const primaryBtn: React.CSSProperties = { ...btn, background: "#2563eb", color: "#fff" };
const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "3px 6px 3px 8px", background: "#f1f5f9", borderRadius: 999,
  fontSize: 12, fontWeight: 600,
};
const chipX: React.CSSProperties = {
  background: "transparent", border: "none", padding: "0 4px",
  cursor: "pointer", fontSize: 14, lineHeight: 1, color: "#475569",
};
```

- [ ] **Step 2: Type-check**

From `frontend/task-tracker/`, run: `npm run build`
Expected: errors should now only be in `ClientInternalReportTab.tsx` and `ClientVisitRow.tsx`. The modal compiles.

- [ ] **Step 3: Commit (WIP)**

```bash
git add frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx
git commit -m "feat(clients): multi-file UI in VisitSubmitModal"
```

---

## Task 12: Update `ClientInternalReportTab` call sites

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientInternalReportTab.tsx`

The tab now needs to:
1. After `createNew(...)` resolves, upload each new file via `uploadVisitReportAttachment`. If everything succeeded *and* `submitImmediately`, call `submit(reportUid)` then close.
2. After `editDraft(...)` resolves, upload each new file. Same submit-only-if-success rule.
3. After `resubmit(...)` resolves, upload each new file (cloned attachments survived from the prior revision). Always submit at the end (matches existing resubmit semantics).
4. Pass `existingAttachments` and an `onAttachmentDeleted` callback to the modal in edit/resubmit modes. The callback updates the local `visits` state by reloading.

- [ ] **Step 1: Replace handlers**

In `ClientInternalReportTab.tsx`, update the import to also bring in `uploadVisitReportAttachment` and the DTO type:

```tsx
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useClientVisits } from "@/hooks/useClientVisits";
import { uploadVisitReportAttachment } from "@/lib/api";
import MultiSelect from "@/components/ui/MultiSelect";
import ClientVisitGroupedView from "./ClientVisitGroupedView";
import VisitSubmitModal, {
  type SubmitModalCreatePayload,
  type SubmitModalEditPayload,
  type SubmitModalResubmitPayload,
} from "./VisitSubmitModal";
import { groupVisitsByClient } from "./internalReportGrouping";
import {
  isInternalReportFilterActive,
  visitMatches,
  type InternalReportFilters,
} from "./internalReportFilters";
import { reportApiError } from "./errors";
import type { Profile } from "@/types/auth";
import type {
  VisitReportAttachmentDto,
  VisitStatus,
} from "@/types/api/internalReports";
```

Replace the three handlers (`handleCreate`, `handleEdit`, `handleResubmit`) with:

```tsx
  const uploadAll = async (reportUid: string, files: File[]) => {
    for (const f of files) {
      await uploadVisitReportAttachment(reportUid, f);
    }
  };

  const handleCreate = async (p: SubmitModalCreatePayload) => {
    try {
      const created = await createNew({
        client: p.client,
        visit_date: p.visit_date,
        assigned_manager: p.assigned_manager,
        key_points: p.key_points,
      });
      const reportUid = created.reports[0]?.uid;
      if (reportUid) await uploadAll(reportUid, p.newFiles);
      if (p.submitImmediately && reportUid) {
        await submit(reportUid);
      }
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const handleEdit = async (p: SubmitModalEditPayload) => {
    try {
      await editDraft(p.reportUid, { key_points: p.key_points });
      await uploadAll(p.reportUid, p.newFiles);
      if (p.submitImmediately) await submit(p.reportUid);
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const handleResubmit = async (p: SubmitModalResubmitPayload) => {
    try {
      const newReport = await resubmit(p.reportUid, { key_points: p.key_points });
      await uploadAll(newReport.uid, p.newFiles);
      // Mirror today's behaviour: resubmit always auto-submits the new revision.
      await submit(newReport.uid);
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };
```

- [ ] **Step 2: Look up `existingAttachments` for edit / resubmit modes**

Just before the JSX `return`, add a helper that reads the latest visits state for the report uid the modal is showing:

```tsx
  const existingAttachmentsFor = (reportUid: string): readonly VisitReportAttachmentDto[] => {
    for (const v of visits) {
      const r = v.reports.find((rep) => rep.uid === reportUid);
      if (r) return r.attachments;
    }
    return [];
  };
```

(Reads from the `visits` returned by the hook — already kept in sync via the websocket subscription.)

- [ ] **Step 3: Pass new props to the modal**

Replace the modal-rendering JSX block (currently around `ClientInternalReportTab.tsx:273-304`) with:

```tsx
      {modalState.mode === "create" && (
        <VisitSubmitModal
          mode="create"
          open
          defaultClientUid={modalState.defaultClientUid}
          clients={clients}
          managers={profiles}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleCreate}
        />
      )}
      {modalState.mode === "edit" && (
        <VisitSubmitModal
          mode="edit"
          open
          reportUid={modalState.reportUid}
          initialKeyPoints={modalState.initialKeyPoints}
          existingAttachments={existingAttachmentsFor(modalState.reportUid)}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleEdit}
          onAttachmentDeleted={() => {
            // The websocket UPDATE event re-syncs visits; nothing else to do.
          }}
        />
      )}
      {modalState.mode === "resubmit" && (
        <VisitSubmitModal
          mode="resubmit"
          open
          reportUid={modalState.reportUid}
          priorKeyPoints={modalState.priorKeyPoints}
          managerComment={modalState.managerComment}
          existingAttachments={existingAttachmentsFor(modalState.reportUid)}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleResubmit}
          onAttachmentDeleted={() => {
            // Same reasoning as edit mode.
          }}
        />
      )}
```

- [ ] **Step 4: Type-check**

From `frontend/task-tracker/`, run: `npm run build`
Expected: only one file should still error — `ClientVisitRow.tsx`.

- [ ] **Step 5: Commit (WIP)**

```bash
git add frontend/task-tracker/src/components/clients/ClientInternalReportTab.tsx
git commit -m "feat(clients): orchestrate per-file uploads from internal report tab"
```

---

## Task 13: Update `ClientVisitRow` to render the attachment chip list

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientVisitRow.tsx`

- [ ] **Step 1: Replace the file column rendering**

In `ClientVisitRow.tsx`, replace the `<td style={td}>` block that currently renders the single download link (lines ~70-80):

```tsx
                        <td style={td}>
                          {r.download_url ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void openAuthenticatedFile(r.download_url); }}
                              style={linkBtn}
                            >
                              📎 {r.attachment_filename || "Download"}
                            </button>
                          ) : "—"}
                        </td>
```

with:

```tsx
                        <td style={td}>
                          {r.attachments.length === 0 ? "—" : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {r.attachments.map((att) => (
                                <button
                                  key={att.uid}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void openAuthenticatedFile(att.download_url);
                                  }}
                                  style={linkBtn}
                                >
                                  📎 {att.filename}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
```

- [ ] **Step 2: Type-check**

From `frontend/task-tracker/`, run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Run frontend tests**

From `frontend/task-tracker/`, run: `npm test`
Expected: PASS — no test depends on the dropped fields. (The pure-logic tests in `__tests__/components/clients/internalReport*.test.ts` operate on the visit shape but only on filter / grouping fields, not the attachment fields.)

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientVisitRow.tsx
git commit -m "feat(clients): render multi-attachment chip list on visit row"
```

---

## Task 14: Full backend test sweep

- [ ] **Step 1: Run the full masters test module**

Run: `uv run python manage.py test core.masters -v 2`
Expected: PASS — every test in `core/masters/tests.py`. Pay special attention to:
- `AttachmentUploadTests` (existing, untouched)
- `VisitReportAttachmentModelTests` (Task 1)
- `VisitReportAttachmentApiTests` (Tasks 3 + 4)
- `VisitReportLifecycleTests` (extended in Task 6)
- `VisitReportPermissionTests` (existing, untouched)

If any of the three older test classes fail, look for references to the dropped fields (`attachment_filename`, `attachment_size_bytes`, `observation_attachment`) and remove them.

- [ ] **Step 2: Run the full project tests**

Run: `uv run python manage.py test`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `uv run ruff check core/masters` and `uv run ruff format --check core/masters`
Expected: clean — fix anything flagged.

- [ ] **Step 4: Commit any test fixups (if needed)**

If steps 1-3 surfaced fixes:

```bash
git add -A
git commit -m "fix(masters): clean up legacy-field references after multi-attachment rollout"
```

If everything was clean, skip this commit.

---

## Task 15: Manual smoke test in the browser

- [ ] **Step 1: Run dev servers**

Backend: `uv run python manage.py runserver`
Frontend (separate terminal, in `frontend/task-tracker/`): `npm run dev`

- [ ] **Step 2: Walk the happy path**

In the browser:
1. Open Clients → Internal Report → New visit. Pick **two** files. Verify both chips show. Click × on one — chip disappears. Save Draft.
2. Re-open the row. Verify the saved file appears in the row's File column as a chip.
3. Edit the draft. Verify the existing chip shows in the modal (with × on it). Add another file. Save & Submit.
4. As manager, reject the report.
5. As author, click Resubmit. Verify the previously-uploaded chips appear (cloned). Add one more, save.
6. Approve. Verify all attachments still download via the chips.

- [ ] **Step 3: Error path**

In the modal, pick a 100 MB file (or whatever your dev server rejects). Verify the toast surfaces and the chip remains in `newFiles` so a smaller file can be re-picked. Modal stays open. Close manually.

- [ ] **Step 4: Push branch**

```bash
git push
```

(Per the user's standing memory preference: commits + push happen without explicit prompting.)

---

## Self-review notes

- All spec sections are covered: model (T1), serializer (T2), upload+list (T3), delete+download (T4), legacy cleanup (T5), resubmit cloning (T6), admin (T7), types (T8), API helpers (T9), hook (T10), modal (T11), tab (T12), row (T13), tests (T14), smoke (T15).
- Method/property naming consistency:
  - Backend URL name `visit-report-attachment-download` (set by Task 4 router) is what `VisitReportAttachmentSerializer.get_download_url` (Task 2) calls `reverse(...)` on.
  - Frontend payload field `newFiles` (Task 11 modal) matches the consumer in Task 12 (`p.newFiles`).
  - `existingAttachments` prop on edit/resubmit (Task 11 modal) matches what Task 12 passes.
- Limits intentionally not enforced (matches spec's "match existing patterns").
- Frontend has no React component test traditions (only pure-logic tests in `__tests__/components/clients/`); the spec's frontend testing notes are honored by the type-check pass + manual smoke (T15) rather than by adding component tests.
