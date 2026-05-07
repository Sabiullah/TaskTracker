# Leads Attachments — Design

**Date:** 2026-05-07
**Branch:** `Leads_Attachment`

## Problem

The Leads screen has no way to attach supporting files (proposals, quotes, photos,
emails, etc.) to a lead. Users want to attach multiple files per lead and give
each file a human-friendly display name before uploading.

## Current state

- `core/leads/models.py` — `Lead` has no attachment field. `LeadHistory` is the
  only child model.
- `core/leads/views.py` — `LeadViewSet` exposes the standard CRUD actions only.
- `core/leads/serializers.py:32` — nests `LeadHistorySerializer` read-only on
  `LeadSerializer`.
- `frontend/.../components/leads/LeadsTable.tsx` — each row already has 📋 / ✏️ / 🗑
  action buttons. No attachment UI yet.
- `frontend/.../components/leads/LeadModal.tsx` — create/edit modal; no file inputs.
- The codebase already has a clean attachment pattern in
  `ClientActionPointAttachment` and `VisitReportAttachment`: child model + nested
  POST action on the parent ViewSet + dedicated viewset for delete/download.
  `ConveyanceAttachmentList.tsx` shows the corresponding frontend pattern.

## Decisions (from brainstorm)

1. **Mirror the existing attachment pattern** — child model, nested POST, separate
   delete viewset. Consistency with `VisitReportAttachment` etc.
2. **Per-file display name (label).** When the user picks files, each file appears
   in a queue with an editable "Display Name" input (defaults to filename without
   extension). Upload is blocked until every queued file has a non-empty label.
   The OS filename is still kept for download fidelity.
3. **Attachment UI lives in its own modal**, opened from a 📎 button on each leads
   row (next to 📋/✏️/🗑). Keeps `LeadModal` focused on lead fields.
4. **Multi-file picker.** Uploads happen sequentially (one POST per file) so each
   carries its own label.
5. **Permissions.** Match Lead edit perms — anyone who can `PATCH` the lead can
   upload/delete its attachments. Read mirrors lead read.
6. **No size / count / MIME limits.** Same as the other attachment patterns.

## Architecture

### Backend

**New model** — `LeadAttachment` in `core/leads/models.py`:

| field         | type                                                                |
|---------------|---------------------------------------------------------------------|
| `uid`         | UUIDField, unique, indexed                                          |
| `lead`        | FK → `Lead`, `related_name="attachments"`, CASCADE                  |
| `file`        | FileField, `upload_to="leads/%Y/%m/"`                               |
| `filename`    | CharField(255) — original OS filename                               |
| `label`       | CharField(255) — user-entered display name; required, non-empty     |
| `size_bytes`  | PositiveBigIntegerField                                             |
| `uploaded_by` | FK → User, SET_NULL, related_name=`uploaded_lead_attachments`       |
| `uploaded_at` | DateTimeField, auto_now_add                                         |

`Meta.ordering = ["-uploaded_at"]`. Verbose names "lead attachment(s)".

**Migration** — `0005_leadattachment.py`. New model only; no `Lead` schema change.

**API** — extend `LeadViewSet` with a nested action (mirrors `ClientActionPointViewSet.attachments`):

| method | path                                       | action                                            |
|--------|--------------------------------------------|---------------------------------------------------|
| GET    | `/api/leads/<lead_uid>/attachments/`       | list attachments for lead                         |
| POST   | `/api/leads/<lead_uid>/attachments/`       | upload one — multipart `file` + `label`           |

Plus a dedicated `LeadAttachmentViewSet` (mirrors `ClientActionPointAttachmentViewSet`):

| method | path                                              | action              |
|--------|---------------------------------------------------|---------------------|
| GET    | `/api/lead-attachments/<att_uid>/`                | retrieve            |
| DELETE | `/api/lead-attachments/<att_uid>/`                | delete              |
| GET    | `/api/lead-attachments/<att_uid>/download/`       | stream the file     |

- Permissions: `IsAuthenticated` + visibility check via `visibility_q` against
  the parent lead. Mutations require the same rule as `LeadViewSet.perform_update`
  allows today (created_by, assigned_to, or org admin/manager). We'll lean on the
  existing `LeadViewSet` permission shape.
- POST validation: `file` and `label` both required; `label` must be non-blank
  after strip. Returns 400 otherwise.
- POST sets `uploaded_by = request.user`, `filename = upload.name`,
  `size_bytes = upload.size or 0`, `label = request.data["label"].strip()`.
- POST broadcasts `("leads", "UPDATE", LeadSerializer(lead).data)` so connected
  clients refresh the lead and pick up the new attachment list.
- DELETE deletes the file from disk (`instance.file.delete(save=False)`) then
  the row, then broadcasts the parent lead update.
- Download reuses `_stream_attachment` (already in `core/masters/views.py`) — we
  import it from there to avoid duplicating the streaming helper.

**Serializer** — `LeadAttachmentSerializer`:
- Fields: `uid`, `label`, `filename`, `file_url` (absolute, via `request.build_absolute_uri`),
  `size_bytes`, `uploaded_at`, `uploaded_by_detail` (UserMin).
- `LeadSerializer.attachments = LeadAttachmentSerializer(many=True, read_only=True)`,
  added to `Meta.fields` and `read_only_fields`.

**URL routing** — `core/leads/urls.py` registers `LeadAttachmentViewSet` at
`lead-attachments`.

### Frontend

**New types** in `src/types/leads.ts`:

```ts
export interface LeadAttachment {
  uid: ID;
  label: string;
  filename: string;
  file_url: string | null;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by_detail: { uid: ID; name: string } | null;
}
```

`Lead.attachments?: LeadAttachment[]` added.

**API helper** in `src/lib/api/leads.ts` (new file, small):

```ts
listLeadAttachments(leadUid)            // GET
uploadLeadAttachment(leadUid, file, label)  // POST multipart
deleteLeadAttachment(attUid)            // DELETE
```

Use the existing fetch helper / token plumbing already used by other API
modules (`src/lib/api/client.ts`).

**New component** — `src/components/leads/LeadAttachmentsModal.tsx`:

Layout:
1. Header: "Attachments — {client name}".
2. **Upload queue** section:
   - `<input type="file" multiple>`. Selected files are appended to a local
     `queue: { file: File; label: string }[]` (default `label = stripExt(file.name)`).
   - Each queued row: filename (read-only) · "Display Name" text input · "✕" remove.
   - "Upload all" button — disabled if queue empty or any `label.trim() === ""`.
     On click, POSTs each queued item sequentially; clears the queue when done.
   - Error messages per file if upload fails (kept in queue for retry).
3. **Existing attachments** section:
   - List from `Lead.attachments` (or refetched after upload).
   - Each row: 📎 {label} ({filename}) · download link · 🗑 (if user can mutate).
   - Download uses `openAuthenticatedFile(file_url)` (same pattern as
     `ConveyanceAttachmentList`).
4. Close button (×).

**`LeadsTable.tsx`** — add a 📎 button to the actions cell (between 📋 and ✏️). Click
calls `onAttachments(lead)` exposed in props.

**`LeadsPage.tsx`** — owns modal state: `attachmentsLead | null`, opens modal,
passes lead + statuses, handles refresh after upload/delete.

### Tests

**Backend** — extend `core/leads/tests.py`:
- Model: create + str.
- Upload: POST multipart `file` + `label` returns 201, persists row with
  correct label/filename/size/uploaded_by; broadcasts.
- Upload validation: missing file → 400; missing/blank label → 400.
- List: GET returns own org's lead's attachments only.
- Delete: removes row + file; non-permitted user → 403.
- Download: streams correct content-disposition.

**Frontend** — `src/__tests__/components/leads/`:
- `leadAttachmentsModal.upload-validation.test.ts` — queue with blank label
  disables upload button.
- `leadAttachmentsModal.label-default.test.ts` — selecting "foo.pdf" defaults
  label to "foo".

## Out of scope

- Image preview thumbnails.
- Drag-and-drop upload.
- Virus scan or MIME whitelist.
- Attachments inside the LeadModal (deferred — the row button is enough).
- Bulk download / zip export.

## Rollout

1. Land migration + backend code together.
2. Land frontend in same PR (single feature branch).
3. No data backfill needed (new feature).
