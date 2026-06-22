# Inline roadmap-item entry row

**Date:** 2026-06-22
**Status:** Approved (design)

## Problem

Adding a client roadmap item currently opens a modal popup
(`ClientRoadmapModal`). The user wants to add items "row-wise" directly in the
table — the same way Action Points are entered via a "New action point…" row
(the MOM minutes pattern) — with each modal field shown as a cell in the entry
row.

## Current state

- `ClientRoadmapTab.tsx` already renders **existing** roadmap items as editable
  inline rows (the `Row` sub-component). Only **creation** uses the modal.
- The "+ Add roadmap item" button opens `ClientRoadmapModal`, which collects:
  Client*, Title*, Description, Owner, Category, Start/Target/Expected/Completion
  dates, Priority, Progress notes — then calls `create()`.
- The table is **grouped by client** (one collapsible sub-table per client).
- Multi-org admins must send the owning `org` with create; the tab already
  derives it from the chosen client via `clientOrgUidFor()`.
- Status is **derived** from the date fields — it is not a user-set field.

## Decision

Replace the modal with a single persistent inline **entry row** at the top of
the Roadmap tab (shown only when `canWrite`), with a client dropdown as the
first cell so any client can be chosen — including clients that have no rows
yet. Styled like the Action Points "New action point…" draft row: a
light-background mini-table with a header row and one input row.

### Entry-row columns (left → right)

| Client\* | Title\* | Owner | Category | Description | Start | Target | Expected | Completion | Priority | Progress | _(Add)_ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| select | text | select | text | text | date | date | date | date | select | text | button |

- Column order matches the existing per-client rows below (Title, Owner,
  Category, Description, dates, Priority, Progress), with **Client** prepended.
- **Status** is omitted — it is derived from the dates, never user-entered.
- Description and Progress are plain text inputs in the entry row (the modal
  used textareas; the ⤢ expand-to-focus-modal affordance remains available for
  editing already-saved rows, unchanged).

### Behavior

- Draft state: one `useState<ClientRoadmapWrite>` with defaults
  `{ priority: "Medium", client: <page-level clientUid or ""> }`.
- **Client** and **Title** are required. The **Add** button is disabled until
  both are non-empty (mirrors the modal guard `!title.trim() || !clientUid`).
- On **Add**: call the existing
  `create({ ...draft, org: clientOrgUidFor(draft.client) })` — identical to what
  the modal's `onSubmit` did. On success, reset the draft but keep the `client`
  prefill so the user can keep adding rows quickly.
- The existing WebSocket INSERT subscription refreshes the list automatically;
  no manual list mutation needed.
- Errors surface through the existing `reportApiError("Save failed", err)`.

### Cleanup

- Remove the "+ Add roadmap item" button, the `modalOpen` state, the
  `<ClientRoadmapModal>` usage, and the import from `ClientRoadmapTab.tsx`.
- Delete `ClientRoadmapModal.tsx` (no other references — to be verified during
  implementation).

## Out of scope (untouched)

- Existing-row inline editing, the ⤢ focus modal, filters, grouping, sorting,
  CSV export.
- Backend model / serializer / view / API — the create endpoint and payload are
  unchanged.

## Testing

- Type-check + lint + build must pass (`uv run pre-commit run --all-files`
  covers eslint / tsc / build).
- Add/extend a frontend component test if the project has a React test harness
  (verified during planning): assert the entry row renders, Add is disabled
  until Client + Title are set, and submitting calls `create` with the expected
  payload incl. derived `org`.
