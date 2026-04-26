# MOM — Client selector inside meeting popup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Client dropdown inside `ClientMeetingModal` so users on the All-clients view can pick (and change) which client a MOM belongs to, on both create and edit, without changing the existing entry-point buttons.

**Architecture:** Add the Client `<select>` to `ClientMeetingModal` and have the modal own the client choice in its own state, initialised from a new `defaultClientUid` prop. Move org-from-client resolution from the parent views into the `onSubmit` callbacks (so it always uses the *actually-saved* client). Extract the dropdown-options computation (org-filter + always-include-current) into a small pure function with unit tests; component logic itself follows the codebase pattern of no per-component tests.

**Tech Stack:** React 19, TypeScript, Vite, Vitest. UI is plain native form elements styled inline (matches existing modal). No new libraries.

**Spec:** [docs/superpowers/specs/2026-04-26-mom-client-selector-in-modal-design.md](../specs/2026-04-26-mom-client-selector-in-modal-design.md)

---

## File map

- **Create** `frontend/task-tracker/src/components/clients/momClientOptions.ts` — pure helper that returns the clients to show in the modal's dropdown, given (a) all clients, (b) `selectedOrg`, (c) the currently-selected client uid.
- **Create** `frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts` — unit tests for the helper.
- **Modify** `frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx` — change props (`clientUid` → `defaultClientUid`, add `selectedOrg`, `clients`), add Client field, own client in state, validate on save.
- **Modify** `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` — pass new props to modal; move org resolution inside `onSubmit`; expand the group keyed by the *saved* client.
- **Modify** `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` — pass new props to modal; move org resolution inside `onSubmit`.

No backend / serializer / hook changes.

---

## Task 1: Pure helper for dropdown options + tests

**Files:**
- Create: `frontend/task-tracker/src/components/clients/momClientOptions.ts`
- Test: `frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts`

The helper takes the full `clients` list, the currently-active `selectedOrg` filter, and the currently-selected `clientUid`. It returns the alphabetised list of clients to show in the dropdown. Rules:

1. If `selectedOrg` is `null`, include all clients.
2. If `selectedOrg` is set, include only clients whose `orgs` array includes `selectedOrg`, OR whose legacy `org` field equals `selectedOrg`.
3. Always include the client whose id equals `clientUid` (even if it would otherwise be filtered out), so the `<select value={clientUid}>` always has a matching option. Skip this if `clientUid` is empty or doesn't match any known client.
4. Final list is sorted by `name` alphabetically.

- [ ] **Step 1.1: Write the failing test file**

Create `frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { momClientOptions } from "@/components/clients/momClientOptions";
import type { MasterItem } from "@/types";

function client(id: string, name: string, orgs: string[], legacyOrg: string | null = null): MasterItem {
  return { id, name, type: "client", org: legacyOrg, orgs, color: null };
}

describe("momClientOptions", () => {
  it("returns all clients when selectedOrg is null", () => {
    const clients = [client("a", "Acme", ["org1"]), client("b", "Beta", ["org2"])];
    expect(momClientOptions(clients, null, "").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("filters by selectedOrg via the orgs array", () => {
    const clients = [client("a", "Acme", ["org1"]), client("b", "Beta", ["org2"])];
    expect(momClientOptions(clients, "org1", "").map((c) => c.id)).toEqual(["a"]);
  });

  it("filters by selectedOrg via the legacy org field as fallback", () => {
    const clients = [client("a", "Acme", [], "org1"), client("b", "Beta", [], "org2")];
    expect(momClientOptions(clients, "org1", "").map((c) => c.id)).toEqual(["a"]);
  });

  it("always includes the currently-selected client even if filtered out by org", () => {
    const clients = [client("a", "Acme", ["org1"]), client("b", "Beta", ["org2"])];
    const out = momClientOptions(clients, "org1", "b").map((c) => c.id);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("does not duplicate the selected client when it already passes the filter", () => {
    const clients = [client("a", "Acme", ["org1"])];
    const out = momClientOptions(clients, "org1", "a").map((c) => c.id);
    expect(out).toEqual(["a"]);
  });

  it("ignores an empty or unknown selected client uid", () => {
    const clients = [client("a", "Acme", ["org1"])];
    expect(momClientOptions(clients, "org2", "").map((c) => c.id)).toEqual([]);
    expect(momClientOptions(clients, "org2", "ghost").map((c) => c.id)).toEqual([]);
  });

  it("sorts results alphabetically by name", () => {
    const clients = [client("z", "Zeta", []), client("a", "Acme", []), client("m", "Midco", [])];
    expect(momClientOptions(clients, null, "").map((c) => c.name)).toEqual(["Acme", "Midco", "Zeta"]);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd frontend/task-tracker && npm test -- momClientOptions`
Expected: FAIL with module-not-found / `momClientOptions is not exported` for `@/components/clients/momClientOptions`.

- [ ] **Step 1.3: Implement the helper**

Create `frontend/task-tracker/src/components/clients/momClientOptions.ts`:

```ts
import type { MasterItem } from "@/types";

/**
 * Compute the option list for the meeting modal's Client dropdown.
 *
 * - When `selectedOrg` is null, all clients are included.
 * - When `selectedOrg` is set, only clients whose `orgs` array contains it
 *   (or whose legacy `org` matches it as a fallback) are included.
 * - The currently-selected `clientUid` is always included if it matches a
 *   known client, even when the org filter would otherwise exclude it —
 *   this prevents React's "value not in <select> options" warning when the
 *   modal is opened with a default client outside the filter.
 * - The result is sorted by name (ascending).
 */
export function momClientOptions(
  clients: readonly MasterItem[],
  selectedOrg: string | null,
  clientUid: string,
): MasterItem[] {
  const matchesOrg = (c: MasterItem): boolean => {
    if (!selectedOrg) return true;
    if (c.orgs.includes(selectedOrg)) return true;
    return c.org === selectedOrg;
  };

  const filtered = clients.filter(matchesOrg);

  if (clientUid && !filtered.some((c) => c.id === clientUid)) {
    const current = clients.find((c) => c.id === clientUid);
    if (current) filtered.push(current);
  }

  return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd frontend/task-tracker && npm test -- momClientOptions`
Expected: PASS — all 7 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/momClientOptions.ts frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts
git commit -m "feat(clients): add momClientOptions helper for meeting modal dropdown"
```

---

## Task 2: Add Client field to `ClientMeetingModal`

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx`

Change the modal's prop API and add the Client `<select>` as the first field. The modal owns the selected client in its own state.

- [ ] **Step 2.1: Update imports and Props interface**

In `frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx`, replace lines 1–17 with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { momClientOptions } from "./momClientOptions";
import type { Profile } from "@/types/auth";
import type { MasterItem } from "@/types";
import type {
  ClientMeetingDto,
  ClientMeetingWrite,
  MeetingMode,
  MeetingType,
} from "@/types/api/clients";

interface Props {
  open: boolean;
  defaultClientUid: string;
  selectedOrg: string | null;
  clients: MasterItem[];
  existing: ClientMeetingDto | null;
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (body: ClientMeetingWrite) => Promise<void>;
}
```

- [ ] **Step 2.2: Update component signature and add `client` state**

Replace the function declaration (currently lines 22–29) and the existing `useState` block (currently lines 30–41) with:

```tsx
export default function ClientMeetingModal({
  open,
  defaultClientUid,
  selectedOrg,
  clients,
  existing,
  profiles,
  onClose,
  onSubmit,
}: Props) {
  const [client, setClient] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType>("Review");
  const [mode, setMode] = useState<MeetingMode>("Video");
  const [venue, setVenue] = useState("");
  const [conductedBy, setConductedBy] = useState("");
  const [ourAttendees, setOurAttendees] = useState<string[]>([]);
  const [clientAttendeesText, setClientAttendeesText] = useState("");
  const [agenda, setAgenda] = useState("");
  const [minutes, setMinutes] = useState("");
  const [nextMeetingDate, setNextMeetingDate] = useState("");
  const [saving, setSaving] = useState(false);
```

- [ ] **Step 2.3: Initialise `client` in the open-effect**

In the existing `useEffect(() => { if (!open) return; ... }, [open, existing])` block (currently around line 43), add a `setClient` call as the first state assignment. The block becomes:

```tsx
  useEffect(() => {
    if (!open) return;
    setClient(existing?.client ?? defaultClientUid ?? "");
    setMeetingDate(existing?.meeting_date ?? new Date().toISOString().slice(0, 10));
    setMeetingTime(existing?.meeting_time ?? "");
    setMeetingType(existing?.meeting_type ?? "Review");
    setMode(existing?.mode ?? "Video");
    setVenue(existing?.venue ?? "");
    setConductedBy(existing?.conducted_by ?? "");
    setOurAttendees([...(existing?.our_attendees ?? [])]);
    setClientAttendeesText(
      (existing?.client_attendees ?? [])
        .map((a) => [a.name, a.designation, a.email].filter(Boolean).join(" · "))
        .join("\n"),
    );
    setAgenda(existing?.agenda ?? "");
    setMinutes(existing?.minutes ?? "");
    setNextMeetingDate(existing?.next_meeting_date ?? "");
  }, [open, existing, defaultClientUid]);
```

(Note the `defaultClientUid` added to the dep array — needed because we now read it inside the effect.)

- [ ] **Step 2.4: Add memoised options + update `handleSubmit` validation and body**

Just after the `useEffect` block, add:

```tsx
  const clientOptions = useMemo(
    () => momClientOptions(clients, selectedOrg, client),
    [clients, selectedOrg, client],
  );
```

Then replace the existing `handleSubmit` (currently lines 74–97). It currently reads `clientUid` from props; now it reads `client` from state and validates it:

```tsx
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !meetingDate) return;
    setSaving(true);
    try {
      await onSubmit({
        client,
        meeting_date: meetingDate,
        meeting_time: meetingTime || null,
        meeting_type: meetingType,
        mode,
        venue,
        conducted_by: conductedBy || null,
        our_attendees: ourAttendees,
        client_attendees: parseClientAttendees(),
        agenda,
        minutes,
        next_meeting_date: nextMeetingDate || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 2.5: Insert the Client field at the top of the form, above the Date/Time grid**

Inside the `<form>` (currently around line 128), immediately after the `<h3>` heading, insert a full-width Client field (above the existing `<div style={grid2}>` block):

```tsx
        <h3 style={{ margin: 0 }}>{existing ? "Edit meeting" : "New meeting"}</h3>

        <div>
          <label style={labelStyle}>Client*</label>
          <select
            value={client}
            onChange={(e) => setClient(e.target.value)}
            required
            style={inputStyle}
          >
            <option value="" disabled>
              — Select client —
            </option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div style={grid2}>
          {/* ...existing Date / Time / Type / Mode / Venue / Conducted by fields unchanged... */}
```

- [ ] **Step 2.6: Update the Save button's disabled condition**

In the footer (currently around line 217), change `disabled={saving || !meetingDate || !clientUid}` to:

```tsx
          <button type="submit" disabled={saving || !meetingDate || !client} style={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
```

- [ ] **Step 2.7: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: errors point to the two callers (`ClientMOMAllView.tsx` and `ClientMOMSingleView.tsx`) still passing the old `clientUid` prop. That's expected — they're fixed in Tasks 3 and 4. No errors should originate from `ClientMeetingModal.tsx` itself.

- [ ] **Step 2.8: Do NOT commit yet**

Hold the commit until Tasks 3 and 4 land — the codebase is in a non-compiling state otherwise.

---

## Task 3: Wire the new modal API in `ClientMOMAllView`

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx`

Pass `defaultClientUid` / `selectedOrg` / `clients` to the modal. Resolve `org` from `body.client` inside `onSubmit` (so a user-changed client in the popup is honoured). Expand the group keyed by the *saved* client after create.

- [ ] **Step 3.1: Inline the org-resolution helper into the closure scope**

The existing `orgUidForClient` helper (currently around lines 66–69) reads `clients.find((x) => x.id === clientUid)`. Keep the helper as-is — we'll just call it with `body.client` instead of `modalClientUid` inside `onSubmit`.

- [ ] **Step 3.2: Update the `<ClientMeetingModal>` usage**

Replace the existing modal usage block (currently lines 293–312) with:

```tsx
      <ClientMeetingModal
        open={modalOpen}
        defaultClientUid={modalClientUid}
        selectedOrg={selectedOrg}
        clients={clients}
        existing={editing}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          try {
            const targetClientUid = body.client;
            const org = orgUidForClient(targetClientUid);
            if (editing) {
              await updateMeeting(editing.uid, { ...body, org });
            } else {
              await createMeeting({ ...body, org });
              setExpandedClients((prev) => new Set(prev).add(targetClientUid));
            }
          } catch (err) {
            reportApiError("Save failed", err);
            throw err;
          }
        }}
      />
```

Two behavioural changes here vs. the previous version:
1. `org` is now derived from `body.client` (the user's actual choice in the popup), not from `modalClientUid` (the entry-point default).
2. After create, the group expanded is keyed by `targetClientUid`, so if the user changed the client inside the popup, the new meeting's group expands.
3. `updateMeeting` now also receives `org`, since edit can change the client too.

- [ ] **Step 3.3: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: only the `ClientMOMSingleView.tsx` error remains (fixed in Task 4).

---

## Task 4: Wire the new modal API in `ClientMOMSingleView`

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx`

Pass the new props. Resolve `org` from `body.client` inside `onSubmit`. Pass `selectedOrg={null}` (Single-view has no org filter context per the spec — all clients are listable).

- [ ] **Step 4.1: Replace the existing modal usage block**

Replace the existing block (currently lines 224–246) with:

```tsx
      <ClientMeetingModal
        open={modalOpen}
        defaultClientUid={clientUid}
        selectedOrg={null}
        clients={clients}
        existing={editing}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          try {
            const targetClient = clients.find((c) => c.id === body.client);
            const org = targetClient?.org ?? targetClient?.orgs?.[0] ?? undefined;
            if (editing) {
              // PATCH can omit `org` when the client hasn't changed, but we
              // pass it anyway so a client-change on edit also updates the
              // owning org. The backend validator accepts a matching org.
              await updateMeeting(editing.uid, { ...body, org });
            } else {
              const created = await createMeeting({ ...body, org });
              setSelectedUid(created.uid);
            }
          } catch (err) {
            reportApiError("Save failed", err);
            throw err;
          }
        }}
      />
```

Note: the previous code computed `clientOrgUid` once at render time from `clientUid` (the route's client). That's now obsolete because the user can pick a different client. The pre-computed `clientOrgUid` and `selectedClient` constants on lines 42–43 can stay — they aren't read elsewhere — but you should remove them to avoid an "unused variable" lint failure.

- [ ] **Step 4.2: Remove the now-unused `selectedClient` / `clientOrgUid` constants**

Delete lines 37–43 (the comment block plus the two `const` declarations). The `clients` destructure stays (line 36) because it's now used inside `onSubmit`.

After deletion, the area around line 36 should look like:

```tsx
  const { clients } = useMasters();

  const [selectedUid, setSelectedUid] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientMeetingDto | null>(null);
```

- [ ] **Step 4.3: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: PASS — no errors anywhere.

- [ ] **Step 4.4: Lint**

Run: `cd frontend/task-tracker && npm run lint`
Expected: PASS — no new warnings or errors.

- [ ] **Step 4.5: Run the full test suite**

Run: `cd frontend/task-tracker && npm test`
Expected: PASS — all tests green, including the new `momClientOptions` tests.

- [ ] **Step 4.6: Commit Tasks 2–4 together**

```bash
git add frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx
git commit -m "feat(clients): add Client selector to meeting popup"
```

---

## Task 5: Manual verification + push

The codebase has no Playwright/component-test coverage for these views, so the spec's verification steps are run manually.

- [ ] **Step 5.1: Start the dev server**

Run: `cd frontend/task-tracker && npm run dev`
Open the printed URL in a browser, sign in, and navigate to **Clients → MOM & Action Points** with `CLIENT = All clients` selected at the top.

- [ ] **Step 5.2: Walk through the verification checklist from the spec**

For each step, note pass/fail in your scratch notes. Halt if any fails.

1. From All-view, click a per-group `+ New meeting`. The Client dropdown is pre-filled with that group's client and is changeable.
2. Change the client to a different one and save. The new meeting appears under the chosen client's group, and that group auto-expands.
3. Open `Edit header` on an existing meeting. Change the client. Save. The meeting moves groups; its action points and attachments are still attached.
4. From Single-view (`CLIENT = a specific client`), open `+ New meeting`. The route's client is pre-filled. Save without change. Meeting appears in the side list.
5. Set `ORG = 4D` (or any non-`All` org) at the top, then open the popup from a 4D group. Only 4D clients appear in the dropdown, plus the currently-selected one if it's outside that org.
6. With the dropdown set to `— Select client —` (using the browser inspector to clear `value` if needed), confirm the Save button is disabled.

- [ ] **Step 5.3: Stop the dev server, push the branch**

Run:

```bash
git push
```

(Branch `Adding_ClientName_MOM` is already tracking `origin/Adding_ClientName_MOM`.)

---

## Self-review notes (for the implementer)

- **Spec coverage**: §1 Client field → Task 2.5. §2 Org-scoped options → Task 1 + Task 2.4. §3 Modal API change → Task 2.1–2.4. §4 Org handling on save → Tasks 3.2 and 4.1. §5 Edit-time editable → Task 4.1 sends `org` on PATCH too. §6 Validation → Task 2.4 (early-return) + Task 2.6 (disabled button). §7 Per-entry-point behaviour → covered by the four call-sites in Tasks 3 and 4. §8 Post-save UI → Task 3.2 expands by `targetClientUid`. §9 No-change items: untouched by this plan.
- **Frequent commits**: Task 1 commits the helper independently. Tasks 2–4 are one logical commit because the callers and the modal are mutually dependent (a half-applied change won't compile).
- **TDD**: Applied where the code is testable in isolation (the pure helper). The modal/view changes are wired UI; the codebase pattern is to verify these manually.
