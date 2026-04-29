# Visit Report Multi-Attachment — Design

**Date:** 2026-04-29
**Branch:** `ClientReport_Attachment`

## Problem

The Internal Report "New visit" / "Edit draft" / "Resubmit" dialog accepts only one
observation attachment. Users need to attach multiple files per visit report.

## Current state

- `core/masters/models.py:359` — `VisitReport` has a single `observation_attachment`
  FileField plus `attachment_filename` and `attachment_size_bytes`.
- `core/masters/views.py:578,718,870` — create / edit-draft / resubmit endpoints all
  read a single `observation_attachment` from `request.FILES` and write the three
  fields above.
- `core/masters/serializers.py:362,379,393` — `VisitReportSerializer` exposes the
  three legacy fields and a derived attachment URL.
- `frontend/.../components/clients/VisitSubmitModal.tsx:197` — single
  `<input type="file">`, state shape `File | null`.
- `frontend/.../components/clients/ClientVisitRow.tsx:77` — renders a single
  `📎 {attachment_filename}` link.
- Existing data is test-only — no migration of legacy rows is required.

## Decisions (from brainstorm)

1. **Append + per-file remove.** New uploads add to the existing list; each
   existing/newly-picked file has an × button.
2. **Drop the legacy fields.** Existing rows are test data, so no data copy.
3. **Match the existing attachment pattern** — `ClientMeetingAttachment` /
   `ClientActionPointAttachment` already use a child model + dedicated REST
   endpoints. Use the same shape for consistency.
4. **No size / count / MIME limits.** Mirrors the existing patterns; can be added
   later if abuse becomes a concern.

## Architecture

### Backend

**New model** — `VisitReportAttachment` in `core/masters/models.py`:

| field          | type                                                  |
|----------------|-------------------------------------------------------|
| `uid`          | UUIDField, unique, indexed                            |
| `report`       | FK → `VisitReport`, `related_name="attachments"`, CASCADE |
| `file`         | FileField, `upload_to="client_visits/%Y/%m/"`        |
| `filename`     | CharField(255)                                        |
| `size_bytes`   | PositiveBigIntegerField                               |
| `uploaded_by`  | FK → User, SET_NULL, related_name=`uploaded_visit_report_attachments` |
| `uploaded_at`  | DateTimeField, auto_now_add                           |

`Meta.ordering = ["-uploaded_at"]`. Verbose names "visit report attachment(s)".

**Removed from `VisitReport`** (single migration, with the new model):
- `observation_attachment`
- `attachment_filename`
- `attachment_size_bytes`

**API** — new ViewSet routed at `/api/visit-reports/<report_uid>/attachments/`:

| method  | path                                | action                                |
|---------|-------------------------------------|---------------------------------------|
| GET     | `/`                                 | list attachments for report           |
| POST    | `/`                                 | upload one (multipart `file` field)   |
| DELETE  | `/<att_uid>/`                       | remove one                            |
| GET     | `/<att_uid>/download/`              | stream via `_stream_attachment` helper |

- Permissions: reuse `IsVisitParticipant` (the visit's prepared_by, assigned_manager, or org admin).
- Mutations (POST / DELETE) require the parent report's `status == "Draft"`. Pending /
  Approved / Rejected reports are frozen — same rule as today's edit-draft endpoint.
- POST sets `uploaded_by = request.user`, `filename = upload.name`,
  `size_bytes = upload.size or 0`.

**Existing endpoints simplified**:
- `VisitReportViewSet` create / edit-draft / resubmit no longer read
  `observation_attachment` from `request.FILES`. They handle metadata only.
- The resubmit flow currently clones a Draft revision when a Rejected report is
  resubmitted; that clone must also copy `VisitReportAttachment` rows over (each
  row's `file` is reassigned via `ContentFile`/`FileField.save` so the new
  revision owns its own files on disk; or rows can share the underlying storage
  by copying the `file.name` reference — choose the simpler approach during
  implementation, defaulting to a fresh copy so deleting the old revision can't
  break the new one).
- The download endpoint at `views.py:913` is removed (replaced by the per-attachment
  download route above).

**Serializer** — `VisitReportSerializer`:
- Drops `attachment_filename`, `attachment_size_bytes`, and the derived
  attachment URL field.
- Adds nested `attachments: VisitReportAttachmentSerializer(many=True, read_only=True)`.
- New `VisitReportAttachmentSerializer` exposes `uid`, `filename`, `size_bytes`,
  `uploaded_at`, `uploaded_by`, and a `download_url` derived from the attachment's
  `uid`.

### Frontend

**`VisitSubmitModal.tsx`**:
- Payload type changes — `observation_attachment: File | null` becomes
  `newFiles: File[]` (files picked this session that need uploading on Save).
- Local state: `const [newFiles, setNewFiles] = useState<File[]>([])`.
- Edit / resubmit modes also receive `existingAttachments: VisitReportAttachment[]`
  via props so the chip list can render them.
- File input gets `multiple`; `onChange` appends `Array.from(e.target.files)` to
  `newFiles` and resets the input value (so the same file can be re-picked after
  removal).
- Below the input, render two chip rows:
  - Existing attachments — `📎 filename × ` — × calls
    `DELETE /api/visit-reports/<reportUid>/attachments/<att_uid>/` and removes
    the chip on success.
  - Newly-picked files — `📎 filename ×` — × splices from `newFiles`.
- On Save: for each file in `newFiles`, POST to
  `/api/visit-reports/<reportUid>/attachments/` (sequentially or in parallel,
  pick the simpler).
- The `createNew` / `editDraft` / `resubmit` API calls inside
  `ClientInternalReportTab.tsx` stop sending `observation_attachment`. For
  *create*, the report uid isn't known until the create call returns — the
  modal POSTs each file after `createNew` resolves, before closing.

**`ClientVisitRow.tsx:77`** — replace the single `📎 {attachment_filename}`
anchor with a horizontal list of one anchor per `report.attachments[i]`, linking
to each attachment's `download_url`.

**Types** (`types/api/internalReports.ts`):
- Drop `attachment_filename`, `attachment_size_bytes` from `VisitReport`.
- Add `attachments: VisitReportAttachment[]` to `VisitReport`.
- New `VisitReportAttachment` type:
  ```ts
  readonly uid: string;
  readonly filename: string;
  readonly size_bytes: number;
  readonly uploaded_at: string;
  readonly uploaded_by: string | null;
  readonly download_url: string;
  ```
- Drop `observation_attachment?: File | null` from `CreateVisitForm` /
  `EditDraftForm` / `ResubmitForm` (uploads now go through a dedicated client
  function).

**API client** (`lib/api/internalReports.ts`):
- Stop appending `observation_attachment` in the three form-builders.
- New helpers: `uploadVisitReportAttachment(reportUid, file)` (POST multipart)
  and `deleteVisitReportAttachment(reportUid, attUid)` (DELETE).

## Data flow — create with attachments

1. User picks files → `newFiles` array.
2. Click Save → `createNew(...)` → server returns the new `VisitReport`.
3. Modal POSTs each `newFiles[i]` to that report's attachments endpoint.
4. **Only if every upload succeeded AND** `submitImmediately` is set, modal calls
   `submit(reportUid)`. If any upload failed, the report stays Draft regardless
   of the checkbox; the modal stays open with the failed file(s) still in
   `newFiles` so the user can retry.
5. On full success, modal closes; tab refreshes the visit list.

## Error handling

- Backend mutation on a non-Draft report: 400 with `{detail: "Report is not editable in status '<X>'."}` (DRF `ValidationError`, matches sibling attachment endpoints).
- Backend non-participant: 403 (existing `IsVisitParticipant` behaviour).
- Frontend file upload failure: surface via `reportApiError` (already used in
  `ClientInternalReportTab.tsx:110`); the chip stays in `newFiles` so the user
  can retry on next Save.
- Frontend delete failure: chip stays visible, error toasted.

## Testing

**Backend** (in `core/masters/tests.py`, mirroring lines 264-330):
- POST attachment to a Draft report — row created, file streamed back.
- POST two attachments — both visible in `report.attachments`, ordered by
  `-uploaded_at`.
- POST to a Pending / Approved report — 409.
- DELETE an attachment — row gone, others remain.
- DELETE on Pending — 409.
- Non-participant POST / GET / DELETE — 403.
- Resubmit clones attachments to the new revision (existing test extended).

**Frontend**:
- `VisitSubmitModal` — picking 2 files renders 2 chips; × removes one; save
  POSTs each remaining file.
- Edit mode — existing attachments render as chips; × calls DELETE; new picks
  add to the new-files chip row.
- `ClientVisitRow` — renders one `📎` per attachment; zero attachments shows
  no link area.

## Out of scope

- Per-file size or count caps (matches existing patterns).
- MIME-type allowlist.
- Drag-and-drop upload UI.
- Inline image previews.
- Reordering attachments.
