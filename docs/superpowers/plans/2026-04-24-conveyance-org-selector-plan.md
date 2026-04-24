# Conveyance Org Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let multi-org users pick which organisation a new conveyance entry belongs to, so creates no longer 400 with "`org` is required (you belong to multiple organisations)".

**Architecture:** Add an Organisation `<select>` to `ConveyanceFormDialog` in create mode, hidden for single-org users. Thread `selectedOrg` from App header through `ConveyancePage` and `ConveyanceTransactions` so the header picker can seed the default. Extend `clientOptions` with each client's `orgs[]` so the dialog can filter clients by the chosen org locally. Send the org uid in the create payload; backend `resolve_create_org` already accepts `org=<uid>`.

**Tech Stack:** React + TypeScript (Vite), Vitest for unit tests. No backend changes.

**Prerequisites:** Run `cd frontend/task-tracker && npm install` once (already set up in this repo). Tests run from `frontend/task-tracker/`.

---

## File Structure

| File | Responsibility | Change type |
|---|---|---|
| `frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts` | Pure helpers: validation + form-data builder. Gains `org` field. | Modify |
| `frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts` | Unit tests for the helpers. Adds `org` assertions. | Modify |
| `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx` | Dialog UI. Adds org `<select>`, defaults, client filtering. | Modify |
| `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx` | Parent that owns the dialog. Passes `orgOptions`, `selectedOrg`, new `clientOptions` shape. | Modify |
| `frontend/task-tracker/src/pages/ConveyancePage.tsx` | Page-level props + data wiring. Derives `orgOptions` from `profile.orgs`; passes `selectedOrg` down. | Modify |
| `frontend/task-tracker/src/App.tsx` | Top-level composition. Passes `selectedOrg` to `<ConveyancePage>`. | Modify |

Each file has one clear responsibility; changes ripple outward from the pure helpers (Task 1) to the page root (Task 6).

---

## Task 1: Extend `conveyanceFormHelpers` to require and emit `org`

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts`
- Test: `frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts`

### - [ ] Step 1: Write failing tests for `validateFormInputs` org requirement

Append to `frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts` inside the existing `describe("validateFormInputs", ...)` block (before the final `});` of that block):

```typescript
  it("returns ok:false when org is empty string", () => {
    const result = validateFormInputs({ ...base, org: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /organisation/i.test(e))).toBe(true);
  });

  it("returns ok:true when org is provided alongside a valid payload", () => {
    const result = validateFormInputs({ ...base, org: "org-uid-123" });
    expect(result.ok).toBe(true);
  });
```

Also update the shared `base` literal at the top of that describe block so every existing test continues to pass (it must now include an org):

Find:
```typescript
  const base = {
    reason: "fuel for client visit",
    amount: "150",
    client: "client-uid-abc",
    files: [],
  };
```

Replace with:
```typescript
  const base = {
    reason: "fuel for client visit",
    amount: "150",
    client: "client-uid-abc",
    org: "org-uid-abc",
    files: [],
  };
```

### - [ ] Step 2: Write failing test for `buildCreateFormData` emitting `org`

Append inside the `describe("buildCreateFormData", ...)` block (before its closing `});`):

```typescript
  it("appends org when provided", () => {
    const fd = buildCreateFormData({ ...baseInput, org: "org-uid-777" });
    expect(fd.get("org")).toBe("org-uid-777");
  });

  it("omits org from the form data when not provided", () => {
    const fd = buildCreateFormData(baseInput);
    expect(fd.has("org")).toBe(false);
  });
```

And update the shared `baseInput` at the top of that describe block:

Find:
```typescript
  const baseInput = {
    date: "2026-04-23",
    client: "client-uid-xyz",
    reason: "  fuel expenses  ",
    amount: "250.50",
    claimable: true,
    files: [] as { file: File; label: string }[],
  };
```

Replace with:
```typescript
  const baseInput = {
    date: "2026-04-23",
    client: "client-uid-xyz",
    reason: "  fuel expenses  ",
    amount: "250.50",
    claimable: true,
    files: [] as { file: File; label: string }[],
  };
```

(Unchanged — `org` stays optional in `baseInput` so the "omits org" test can assert it's absent. The validator tests already added a separate `base` with `org`.)

### - [ ] Step 3: Run tests to verify failures

From `frontend/task-tracker/`:

```bash
npm test -- conveyanceFormDialog
```

Expected: 4 new-test failures (or compile errors — the `org` key is not in the input type yet). Existing tests should still pass.

### - [ ] Step 4: Implement org in the helpers

Replace the full contents of `frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts` with:

```typescript
/**
 * Pure helper functions for ConveyanceFormDialog.
 *
 * Kept in a separate file so the dialog component file exports only the
 * component (required by react-refresh/only-export-components).
 */

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
}): FormData {
  const form = new FormData();
  form.append("date", input.date);
  form.append("client", input.client);
  form.append("reason", input.reason.trim());
  form.append("amount", input.amount);
  form.append("claimable", input.claimable ? "true" : "false");
  if (input.org) form.append("org", input.org);
  for (const { file, label } of input.files) {
    form.append("attachments", file);
    form.append("attachment_labels", label);
  }
  return form;
}
```

Key decisions locked in by this code (for later tasks):
- `validateFormInputs` requires `org: string` (non-optional in the input type).
- `buildCreateFormData` accepts `org?: string` (optional — only appends when truthy). This matches the spec: single-org users' dialog will still pass the org in, but callers that don't need it won't break.

### - [ ] Step 5: Run tests to verify they pass

```bash
npm test -- conveyanceFormDialog
```

Expected: all tests green (pre-existing + 4 new).

### - [ ] Step 6: Commit

```bash
git add frontend/task-tracker/src/components/conveyance/conveyanceFormHelpers.ts \
        frontend/task-tracker/src/__tests__/components/conveyanceFormDialog.test.ts
git commit -m "feat(conveyance): require org in form validation and create payload"
```

---

## Task 2: Update `ConveyanceFormDialog` to render and submit org

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`

This task has no unit test — the dialog was shipped with manual verification originally (see `conveyanceFormDialog.test.ts`: only pure helpers are covered). We keep that convention. Manual verification lives in Task 7.

### - [ ] Step 1: Extend props

In `ConveyanceFormDialog.tsx`, find the `ConveyanceFormDialogProps` interface (lines ~23-32) and replace the `clients` line and add two new prop lines:

Find:
```typescript
export interface ConveyanceFormDialogProps {
  open: boolean;
  onClose: () => void;
  entry: ConveyanceEntry | null;
  clients: { uid: string; label: string }[];
  currentUserIsOrgAdminForEntry: boolean;
  onSaved: (entry: ConveyanceEntry) => void;
  onDeletedAttachment?: (entryUid: string, attachmentUid: string) => void;
  onAddedAttachment?: (entryUid: string, attachment: ConveyanceAttachment) => void;
}
```

Replace with:
```typescript
export interface ConveyanceFormDialogProps {
  open: boolean;
  onClose: () => void;
  entry: ConveyanceEntry | null;
  /** Clients with their org memberships, used for filtering in create mode. */
  clients: { uid: string; label: string; orgs: string[] }[];
  /** Orgs the current user is a member of. Dialog shows a selector when length > 1. */
  orgOptions: { uid: string; name: string }[];
  /** Header-selected org uid (seeds the default). Empty string = "All". */
  selectedOrg: string;
  currentUserIsOrgAdminForEntry: boolean;
  onSaved: (entry: ConveyanceEntry) => void;
  onDeletedAttachment?: (entryUid: string, attachmentUid: string) => void;
  onAddedAttachment?: (entryUid: string, attachment: ConveyanceAttachment) => void;
}
```

### - [ ] Step 2: Destructure new props in the function signature

Find:
```typescript
export default function ConveyanceFormDialog({
  open,
  onClose,
  entry,
  clients,
  currentUserIsOrgAdminForEntry,
  onSaved,
  onDeletedAttachment,
  onAddedAttachment,
}: ConveyanceFormDialogProps) {
```

Replace with:
```typescript
export default function ConveyanceFormDialog({
  open,
  onClose,
  entry,
  clients,
  orgOptions,
  selectedOrg,
  currentUserIsOrgAdminForEntry,
  onSaved,
  onDeletedAttachment,
  onAddedAttachment,
}: ConveyanceFormDialogProps) {
```

### - [ ] Step 3: Add org state with sensible default

Find the state block (lines ~105-110):
```typescript
  // ----- Core form fields -----
  const [date, setDate] = useState(entry?.date ?? today);
  const [client, setClient] = useState(entry?.client_detail.uid ?? "");
  const [reason, setReason] = useState(entry?.reason ?? "");
  const [amount, setAmount] = useState(entry?.amount ?? "");
  const [claimable, setClaimable] = useState(entry?.claimable ?? true);
```

Add immediately below, and before the `useEffect` that resyncs on reopen:

```typescript
  // Org: create mode only. Default order matches the spec:
  //   1. header selectedOrg (if it's one of the user's memberships)
  //   2. orgOptions[0] (the Page sorts is_default-first, so this is the
  //      user's primary org)
  //   3. "" (force a manual pick — only when orgOptions is empty)
  const defaultOrg =
    (selectedOrg && orgOptions.some((o) => o.uid === selectedOrg)
      ? selectedOrg
      : orgOptions[0]?.uid) ?? "";
  const [org, setOrg] = useState(defaultOrg);
```

Then update the existing resync `useEffect` (lines ~113-123) to reset org on reopen. Find:

```typescript
  // Re-sync when entry changes (e.g. dialog re-opens with a different entry)
  useEffect(() => {
    if (!open) return;
    setDate(entry?.date ?? today);
    setClient(entry?.client_detail.uid ?? "");
    setReason(entry?.reason ?? "");
    setAmount(entry?.amount ?? "");
    setClaimable(entry?.claimable ?? true);
    setNewFiles([]);
    setUploadErrors({});
    setSubmitError(null);
  }, [open, entry]);
```

Replace with:
```typescript
  // Re-sync when entry changes (e.g. dialog re-opens with a different entry)
  useEffect(() => {
    if (!open) return;
    setDate(entry?.date ?? today);
    setClient(entry?.client_detail.uid ?? "");
    setReason(entry?.reason ?? "");
    setAmount(entry?.amount ?? "");
    setClaimable(entry?.claimable ?? true);
    setOrg(defaultOrg);
    setNewFiles([]);
    setUploadErrors({});
    setSubmitError(null);
  }, [open, entry, defaultOrg]);
```

### - [ ] Step 4: Filter client options by selected org in create mode

In the same file, directly below the org state declaration, add a derived list:

```typescript
  // In create mode, only show clients that belong to the selected org. In
  // edit mode we leave the full list alone — org is immutable on edit and
  // filtering could hide the entry's own client if membership changed.
  const isCreate = entry === null;
  const visibleClients =
    isCreate && org
      ? clients.filter((c) => c.orgs.includes(org))
      : clients;
```

Then DELETE the existing `const isCreate = entry === null;` line a few lines below (it's now declared above). Specifically, find:

```typescript
  const isCreate = entry === null;
  const canEdit =
    isCreate ||
    entry.status === "pending" ||
    currentUserIsOrgAdminForEntry;
```

Replace with (only the `isCreate` line removed; `canEdit` unchanged):

```typescript
  const canEdit =
    isCreate ||
    entry.status === "pending" ||
    currentUserIsOrgAdminForEntry;
```

### - [ ] Step 5: Reset client when org changes in create mode

Add a new effect just below the visibleClients derivation:

```typescript
  // If the user switches org and the current client isn't in the new org's
  // list, clear it so the backend doesn't reject the submit.
  useEffect(() => {
    if (!isCreate || !client) return;
    if (!visibleClients.some((c) => c.uid === client)) {
      setClient("");
    }
  }, [isCreate, client, visibleClients]);
```

### - [ ] Step 6: Wire org into validation

Find:
```typescript
  const { ok: formValid, errors: validationErrors } = validateFormInputs({
    reason,
    amount,
    client,
    files: newFiles,
  });
```

Replace with:
```typescript
  const { ok: formValid, errors: validationErrors } = validateFormInputs({
    reason,
    amount,
    client,
    // Edit mode: `ConveyanceEntry` doesn't expose org_detail and the org
    // is immutable server-side, so skip the check with a sentinel. This
    // value is never sent — updateEntry only posts the editable fields.
    org: isCreate ? org : "edit-mode",
    files: newFiles,
  });
```

### - [ ] Step 7: Pass org to the create payload

Find:
```typescript
      if (isCreate) {
        const form = buildCreateFormData({ date, client, reason, amount, claimable, files: newFiles });
        const saved = await createEntry(form);
        onSaved(saved);
        onClose();
      } else {
```

Replace with:
```typescript
      if (isCreate) {
        const form = buildCreateFormData({ date, client, reason, amount, claimable, org, files: newFiles });
        const saved = await createEntry(form);
        onSaved(saved);
        onClose();
      } else {
```

### - [ ] Step 8: Render the Organisation field in create mode

Find the Date field block (lines ~274-287):

```typescript
          {/* Date */}
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="cf-date">Date</label>
            <input
              id="cf-date"
              type="date"
              style={inputStyle}
              value={date}
              max={today}
              disabled={!canEdit}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
```

Insert the new Organisation block immediately BEFORE it:

```typescript
          {/* Organisation — create mode only, hidden for single-org users */}
          {isCreate && orgOptions.length > 1 && (
            <div style={fieldStyle}>
              <label style={labelStyle} htmlFor="cf-org">Organisation</label>
              <select
                id="cf-org"
                style={inputStyle}
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                required
              >
                <option value="">— select organisation —</option>
                {orgOptions.map((o) => (
                  <option key={o.uid} value={o.uid}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
```

### - [ ] Step 9: Swap `clients` → `visibleClients` in the Client select

Find:
```typescript
              <option value="">— select client —</option>
              {clients.map((c) => (
                <option key={c.uid} value={c.uid}>{c.label}</option>
              ))}
```

Replace with:
```typescript
              <option value="">— select client —</option>
              {visibleClients.map((c) => (
                <option key={c.uid} value={c.uid}>{c.label}</option>
              ))}
```

### - [ ] Step 10: Type-check

From `frontend/task-tracker/`:

```bash
npx tsc --noEmit
```

Expected: no errors. If `entry.org_detail` caused a type error in Step 6, switch to the fallback (`org: isCreate ? org : "edit-mode"`).

### - [ ] Step 11: Commit

```bash
git add frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx
git commit -m "feat(conveyance): add organisation selector to create form"
```

---

## Task 3: Thread props through `ConveyanceTransactions`

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx`

### - [ ] Step 1: Extend `Props` interface

Find the `Props` interface (lines ~17-29):

```typescript
interface Props {
  filters: ListFilters;
  onFiltersChange: (next: ListFilters) => void;
  canFilterByEmployee: boolean;
  employeeOptions: { uid: string; label: string }[];
  clientOptions: { uid: string; label: string }[];
  /** UUID of the authenticated user, from profile.id */
  currentUserUid: string;
  /** True when the current user is admin in at least one org */
  currentUserIsAdminInAny: boolean;
  /** True when the current user is manager or admin in at least one org */
  currentUserCanApprove: boolean;
}
```

Replace with:
```typescript
interface Props {
  filters: ListFilters;
  onFiltersChange: (next: ListFilters) => void;
  canFilterByEmployee: boolean;
  employeeOptions: { uid: string; label: string }[];
  clientOptions: { uid: string; label: string; orgs: string[] }[];
  orgOptions: { uid: string; name: string }[];
  /** Header-selected org uid (empty string = "All"). */
  selectedOrg: string;
  /** UUID of the authenticated user, from profile.id */
  currentUserUid: string;
  /** True when the current user is admin in at least one org */
  currentUserIsAdminInAny: boolean;
  /** True when the current user is manager or admin in at least one org */
  currentUserCanApprove: boolean;
}
```

### - [ ] Step 2: Destructure new props

Find:
```typescript
export default function ConveyanceTransactions({
  filters,
  onFiltersChange,
  canFilterByEmployee,
  employeeOptions,
  clientOptions,
  currentUserUid,
  currentUserIsAdminInAny,
  currentUserCanApprove,
}: Props) {
```

Replace with:
```typescript
export default function ConveyanceTransactions({
  filters,
  onFiltersChange,
  canFilterByEmployee,
  employeeOptions,
  clientOptions,
  orgOptions,
  selectedOrg,
  currentUserUid,
  currentUserIsAdminInAny,
  currentUserCanApprove,
}: Props) {
```

### - [ ] Step 3: Build a filter-compatible client list for `ConveyanceFilters`

The filter bar's `clientOptions` prop doesn't need `orgs`. To avoid changing its typing and keep the filter logic unaffected (per spec: filters aren't filtered by org), derive a stripped copy above the JSX. Add above the `return (` line (around line 167):

```typescript
  // ConveyanceFilters doesn't care about orgs — strip the field to match its
  // narrower prop type.
  const filterClientOptions = clientOptions.map(({ uid, label }) => ({ uid, label }));
```

### - [ ] Step 4: Pass the stripped list into `<ConveyanceFilters>`

Find:
```typescript
      <ConveyanceFilters
        value={filters}
        onChange={onFiltersChange}
        canFilterByEmployee={canFilterByEmployee}
        employeeOptions={employeeOptions}
        clientOptions={clientOptions}
      />
```

Replace with:
```typescript
      <ConveyanceFilters
        value={filters}
        onChange={onFiltersChange}
        canFilterByEmployee={canFilterByEmployee}
        employeeOptions={employeeOptions}
        clientOptions={filterClientOptions}
      />
```

### - [ ] Step 5: Pass the new props into both dialog renders

Find the Create dialog block:
```typescript
      {/* Create dialog */}
      <ConveyanceFormDialog
        open={dialogState.type === "create"}
        onClose={() => setDialogState({ type: null })}
        entry={null}
        clients={clientOptions}
        currentUserIsOrgAdminForEntry={currentUserIsAdminInAny}
        onSaved={(entry) => {
          appendEntry(entry);
          setDialogState({ type: null });
        }}
      />
```

Replace with:
```typescript
      {/* Create dialog */}
      <ConveyanceFormDialog
        open={dialogState.type === "create"}
        onClose={() => setDialogState({ type: null })}
        entry={null}
        clients={clientOptions}
        orgOptions={orgOptions}
        selectedOrg={selectedOrg}
        currentUserIsOrgAdminForEntry={currentUserIsAdminInAny}
        onSaved={(entry) => {
          appendEntry(entry);
          setDialogState({ type: null });
        }}
      />
```

Find the Edit dialog block:
```typescript
      {/* Edit dialog */}
      {dialogState.type === "edit" && (
        <ConveyanceFormDialog
          open
          onClose={() => setDialogState({ type: null })}
          entry={dialogState.entry}
          clients={clientOptions}
          currentUserIsOrgAdminForEntry={currentUserIsAdminInAny}
          onSaved={(updated) => {
            replaceEntry(updated);
            setDialogState({ type: null });
          }}
```

Replace with:
```typescript
      {/* Edit dialog */}
      {dialogState.type === "edit" && (
        <ConveyanceFormDialog
          open
          onClose={() => setDialogState({ type: null })}
          entry={dialogState.entry}
          clients={clientOptions}
          orgOptions={orgOptions}
          selectedOrg={selectedOrg}
          currentUserIsOrgAdminForEntry={currentUserIsAdminInAny}
          onSaved={(updated) => {
            replaceEntry(updated);
            setDialogState({ type: null });
          }}
```

(The rest of the block — the `onDeletedAttachment`, `onAddedAttachment` props and the closing tags — stays the same.)

### - [ ] Step 6: Type-check

```bash
npx tsc --noEmit
```

Expected: no errors.

### - [ ] Step 7: Commit

```bash
git add frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx
git commit -m "feat(conveyance): thread orgOptions and selectedOrg through transactions"
```

---

## Task 4: Update `ConveyancePage` to derive and pass org data

**Files:**
- Modify: `frontend/task-tracker/src/pages/ConveyancePage.tsx`

### - [ ] Step 1: Add `selectedOrg` to props

Find:
```typescript
interface ConveyancePageProps {
  profile: Profile | null;
  isManagerOrAdminAnywhere: boolean;
}
```

Replace with:
```typescript
interface ConveyancePageProps {
  profile: Profile | null;
  isManagerOrAdminAnywhere: boolean;
  /** Header-selected org uid. Empty string = "All". */
  selectedOrg: string;
}
```

### - [ ] Step 2: Destructure new prop

Find:
```typescript
export default function ConveyancePage({
  profile: _profile,
  isManagerOrAdminAnywhere,
}: ConveyancePageProps) {
```

Replace with:
```typescript
export default function ConveyancePage({
  profile: _profile,
  isManagerOrAdminAnywhere,
  selectedOrg,
}: ConveyancePageProps) {
```

### - [ ] Step 3: Change `clientOptions` to include `orgs`

Find:
```typescript
  // MasterItem uses `id` (a UID string) and `name`
  const clientOptions = useMemo(
    () =>
      clients.map((c) => ({
        uid: c.id,
        label: c.name,
      })),
    [clients],
  );
```

Replace with:
```typescript
  // MasterItem uses `id` (a UID string) and `name`. We carry `orgs` through
  // so the create dialog can filter clients by the selected org.
  const clientOptions = useMemo(
    () =>
      clients.map((c) => ({
        uid: c.id,
        label: c.name,
        orgs: c.orgs,
      })),
    [clients],
  );
```

### - [ ] Step 4: Derive `orgOptions` from `profile.orgs` (default-first)

Add below the existing `employeeOptions` useMemo (around line 48):

```typescript
  // Sort is_default first so the dialog's fallback (orgOptions[0]) matches
  // the `pickDefaultOrg` behaviour the spec calls for, without exposing the
  // is_default flag itself to child components.
  const orgOptions = useMemo(() => {
    const orgs = profile?.orgs ?? [];
    const sorted = [...orgs].sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return 0;
    });
    return sorted.map((o) => ({ uid: o.uid, name: o.name }));
  }, [profile]);
```

### - [ ] Step 5: Pass `orgOptions` and `selectedOrg` into `<ConveyanceTransactions>`

Find:
```typescript
        <ConveyanceTransactions
          filters={filters}
          onFiltersChange={setFilters}
          canFilterByEmployee={isManagerOrAdminAnywhere}
          employeeOptions={employeeOptions}
          clientOptions={clientOptions}
          currentUserUid={profile?.id ?? ""}
          currentUserIsAdminInAny={isAdminInAny()}
          currentUserCanApprove={isManagerInAny()}
        />
```

Replace with:
```typescript
        <ConveyanceTransactions
          filters={filters}
          onFiltersChange={setFilters}
          canFilterByEmployee={isManagerOrAdminAnywhere}
          employeeOptions={employeeOptions}
          clientOptions={clientOptions}
          orgOptions={orgOptions}
          selectedOrg={selectedOrg}
          currentUserUid={profile?.id ?? ""}
          currentUserIsAdminInAny={isAdminInAny()}
          currentUserCanApprove={isManagerInAny()}
        />
```

### - [ ] Step 6: Type-check

```bash
npx tsc --noEmit
```

Expected: one new error at `App.tsx` — `ConveyancePage` is missing the `selectedOrg` prop. That's fixed in Task 5.

### - [ ] Step 7: Commit

```bash
git add frontend/task-tracker/src/pages/ConveyancePage.tsx
git commit -m "feat(conveyance): derive orgOptions and pass selectedOrg down"
```

---

## Task 5: Wire `selectedOrg` into `ConveyancePage` from `App.tsx`

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`

### - [ ] Step 1: Pass `selectedOrg`

Find (around line 338-343):
```typescript
    conveyance: (
      <ConveyancePage
        profile={profile}
        isManagerOrAdminAnywhere={isManagerInAny()}
      />
    ),
```

Replace with:
```typescript
    conveyance: (
      <ConveyancePage
        profile={profile}
        isManagerOrAdminAnywhere={isManagerInAny()}
        selectedOrg={selectedOrg}
      />
    ),
```

### - [ ] Step 2: Type-check

```bash
npx tsc --noEmit
```

Expected: zero errors across the project.

### - [ ] Step 3: Commit

```bash
git add frontend/task-tracker/src/App.tsx
git commit -m "feat(conveyance): pass selectedOrg from App into ConveyancePage"
```

---

## Task 6: Run the full test suite

**Files:** (none modified — verification only)

### - [ ] Step 1: Run Vitest suite

From `frontend/task-tracker/`:

```bash
npm test -- --run
```

Expected: all tests pass. The 4 new helper tests from Task 1 should appear in the count. If anything fails, fix it before proceeding.

### - [ ] Step 2: Run the build

```bash
npm run build
```

Expected: build succeeds.

### - [ ] Step 3: Commit (only if anything was fixed)

If Steps 1 or 2 exposed an issue that required an edit, commit it. Otherwise skip.

```bash
git add -A
git commit -m "fix(conveyance): <what you fixed>"
```

---

## Task 7: Manual verification (required before claiming completion)

**Files:** (none modified — behaviour verification)

This is the real acceptance gate. Unit tests only cover the pure helpers; the dialog wiring is verified by using it.

### - [ ] Step 1: Start the dev stack

Run the project's normal dev command. If a local stack is running on `49.12.190.43:8000`, open the Conveyance tab there; otherwise spin up the frontend locally against your usual backend.

### - [ ] Step 2: Verify multi-org user flow

Sign in as a user with >1 orgs (the screenshot user belongs to `4D` and `YBV`).

- [ ] Open **Conveyance → + Add Entry**.
- [ ] Confirm the **Organisation** field appears above Date and defaults to whichever org the header picker currently shows (e.g. `4D`).
- [ ] Fill in reason + amount, pick a client, click **Create**. Entry should save and appear in the list with no "`org` is required" error.
- [ ] Reopen the dialog, change Organisation to `YBV`. Confirm the Client dropdown now only shows YBV clients. If a client was pre-selected and it doesn't belong to YBV, it should reset to "— select client —".
- [ ] Create a second entry in YBV and confirm it saves.

### - [ ] Step 3: Verify single-org user flow

Sign in as a single-org user (or impersonate one). Open + Add Entry. The Organisation field should be hidden. Creating an entry should still work.

### - [ ] Step 4: Verify edit mode unchanged

Open an existing entry for edit. Confirm:
- [ ] No Organisation field is shown.
- [ ] Client dropdown shows the full client list (not filtered).
- [ ] Saving an edit still works for both pending and approved entries (where admin).

### - [ ] Step 5: Push to the feature branch

Per the project's auto-push memory:

```bash
git push
```

---

## Notes for the executor

- **Backend:** no changes. `resolve_create_org` (core/org_utils.py:141) already accepts a UID in the `org` field — verified before this plan was written.
- **Why `org?: string` on `buildCreateFormData`:** keeps the helper usable from any future caller that doesn't care about org (e.g. a single-org smoke test). The dialog always passes one.
- **Why not filter the filters bar by org:** out of scope; filters are a read concern and the spec is explicit about this.
- **Spec reference:** [docs/superpowers/specs/2026-04-24-conveyance-org-selector-design.md](../specs/2026-04-24-conveyance-org-selector-design.md)
