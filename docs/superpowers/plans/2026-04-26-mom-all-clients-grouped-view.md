# MOM All-Clients Grouped View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Clients page → MOM & Action Points sub-tab is set to "All clients", render a per-client collapsible list of meetings (Road Map style) instead of the current placeholder.

**Architecture:** Split `ClientMOMTab` into a thin router that selects between two views: today's left-list/right-pane (`ClientMOMSingleView`, mechanically extracted) when a client is selected, and a new grouped/collapsible view (`ClientMOMAllView`) when "All clients" is chosen. Grouping/filtering is done client-side from a single `useClientMeetings()` fetch — same pattern as `ClientRoadmapTab`. A pure helper module owns the grouping math so it can be unit-tested with Vitest.

**Tech Stack:** React 19 + TypeScript (Vite), Vitest for unit tests. No backend / API / hook / type changes.

**Prerequisites:** `cd frontend/task-tracker && npm install` (already set up in this repo). Run all commands from `frontend/task-tracker/`.

**Spec:** `docs/superpowers/specs/2026-04-26-mom-all-clients-grouped-view-design.md`

---

## File Structure

| File | Responsibility | Change type |
|---|---|---|
| `frontend/task-tracker/src/components/clients/momGrouping.ts` | Pure helper: filter meetings by org, group by client, sort. Unit-tested. | **Create** |
| `frontend/task-tracker/src/__tests__/components/clients/momGrouping.test.ts` | Vitest unit tests for the helper. | **Create** |
| `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` | Single-client meetings view. Verbatim extraction of today's `ClientMOMTab` body. | **Create** |
| `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` | All-clients grouped collapsible view. New. | **Create** |
| `frontend/task-tracker/src/components/clients/ClientMOMTab.tsx` | Thin router between Single and All views; gains `selectedOrg` prop. | Modify |
| `frontend/task-tracker/src/pages/ClientsPage.tsx` | Pass `selectedOrg` prop to `<ClientMOMTab>`. | Modify |

Decomposition order: pure helper + tests first (Tasks 1–2), then mechanical extraction (Task 3), then the new view (Task 4), then router rewire (Task 5), then page wiring (Task 6), then verification (Task 7).

---

## Task 1: Create `momGrouping` helper with failing tests

**Files:**
- Create: `frontend/task-tracker/src/components/clients/momGrouping.ts`
- Create: `frontend/task-tracker/src/__tests__/components/clients/momGrouping.test.ts`

### - [ ] Step 1: Create the test file with failing tests

Create `frontend/task-tracker/src/__tests__/components/clients/momGrouping.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { groupMeetingsByClient } from "@/components/clients/momGrouping";
import type { ClientMeetingDto } from "@/types/api/clients";

function meeting(
  uid: string,
  client: string | null,
  clientName: string | null,
  org_uid: string | null,
  meeting_date: string,
): ClientMeetingDto {
  return {
    id: parseInt(uid.replace(/\D/g, ""), 10) || 1,
    uid,
    org_uid,
    client,
    client_detail: clientName
      ? { id: 1, uid: client ?? "", name: clientName, type: "Client", color: "#fff" }
      : null,
    meeting_date,
    meeting_time: null,
    meeting_type: "Review",
    mode: "Online",
    venue: "",
    conducted_by: null,
    conducted_by_detail: null,
    our_attendees: [],
    our_attendees_detail: [],
    client_attendees: [],
    agenda: "",
    minutes: "",
    next_meeting_date: null,
    action_points: [],
    attachments: [],
    created_by_detail: null,
    created_at: "",
    updated_at: "",
  } as ClientMeetingDto;
}

describe("groupMeetingsByClient", () => {
  it("returns empty array when no meetings", () => {
    expect(groupMeetingsByClient([], null)).toEqual([]);
  });

  it("groups meetings by client uid and labels with client_detail.name", () => {
    const meetings = [
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m2", "c-b", "Beta", "org1", "2026-04-21"),
      meeting("m3", "c-a", "Acme", "org1", "2026-04-22"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups).toHaveLength(2);
    const acme = groups.find((g) => g.clientUid === "c-a")!;
    expect(acme.clientName).toBe("Acme");
    expect(acme.meetings.map((m) => m.uid)).toEqual(["m3", "m1"]);
  });

  it("sorts groups alphabetically by client name", () => {
    const meetings = [
      meeting("m1", "c-z", "Zeta", "org1", "2026-04-20"),
      meeting("m2", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m3", "c-m", "Midco", "org1", "2026-04-20"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups.map((g) => g.clientName)).toEqual(["Acme", "Midco", "Zeta"]);
  });

  it("sorts meetings within a group by meeting_date descending", () => {
    const meetings = [
      meeting("old", "c-a", "Acme", "org1", "2026-01-10"),
      meeting("new", "c-a", "Acme", "org1", "2026-04-25"),
      meeting("mid", "c-a", "Acme", "org1", "2026-03-15"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups[0].meetings.map((m) => m.uid)).toEqual(["new", "mid", "old"]);
  });

  it("buckets meetings with null client into '(Unassigned)' last", () => {
    const meetings = [
      meeting("orphan", null, null, "org1", "2026-04-20"),
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups.map((g) => g.clientName)).toEqual(["Acme", "(Unassigned)"]);
    expect(groups[1].clientUid).toBe("");
  });

  it("filters by selectedOrg when provided", () => {
    const meetings = [
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m2", "c-b", "Beta", "org2", "2026-04-21"),
    ];
    const groups = groupMeetingsByClient(meetings, "org1");
    expect(groups).toHaveLength(1);
    expect(groups[0].clientName).toBe("Acme");
  });

  it("returns all meetings when selectedOrg is null", () => {
    const meetings = [
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m2", "c-b", "Beta", "org2", "2026-04-21"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups).toHaveLength(2);
  });
});
```

### - [ ] Step 2: Run tests to verify they fail

Run: `npm test -- src/__tests__/components/clients/momGrouping.test.ts`
Expected: FAIL — module `@/components/clients/momGrouping` not found.

### - [ ] Step 3: Implement `momGrouping.ts` to make tests pass

Create `frontend/task-tracker/src/components/clients/momGrouping.ts`:

```typescript
import type { ClientMeetingDto } from "@/types/api/clients";

export interface MeetingGroup {
  clientUid: string;
  clientName: string;
  meetings: ClientMeetingDto[];
}

const UNASSIGNED_LABEL = "(Unassigned)";

export function groupMeetingsByClient(
  meetings: readonly ClientMeetingDto[],
  selectedOrg: string | null,
): MeetingGroup[] {
  const filtered = selectedOrg
    ? meetings.filter((m) => m.org_uid === selectedOrg)
    : meetings;

  const byUid = new Map<string, MeetingGroup>();
  for (const m of filtered) {
    const uid = m.client ?? "";
    const name = m.client_detail?.name ?? UNASSIGNED_LABEL;
    const bucket = byUid.get(uid) ?? { clientUid: uid, clientName: name, meetings: [] };
    bucket.meetings.push(m);
    byUid.set(uid, bucket);
  }

  for (const g of byUid.values()) {
    g.meetings.sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : a.meeting_date > b.meeting_date ? -1 : 0));
  }

  return Array.from(byUid.values()).sort((a, b) => {
    if (a.clientName === UNASSIGNED_LABEL) return 1;
    if (b.clientName === UNASSIGNED_LABEL) return -1;
    return a.clientName.localeCompare(b.clientName);
  });
}
```

### - [ ] Step 4: Run tests to verify they pass

Run: `npm test -- src/__tests__/components/clients/momGrouping.test.ts`
Expected: PASS — all 7 tests green.

### - [ ] Step 5: Commit

```bash
git add frontend/task-tracker/src/components/clients/momGrouping.ts frontend/task-tracker/src/__tests__/components/clients/momGrouping.test.ts
git commit -m "feat(clients): add momGrouping helper for all-clients view"
```

---

## Task 2: Extract `ClientMOMSingleView` from current `ClientMOMTab`

**Files:**
- Create: `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx`
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMTab.tsx`

This is a pure rename/move — the body of today's `ClientMOMTab` becomes `ClientMOMSingleView`. The router rewire happens in Task 5; for now `ClientMOMTab` is unchanged.

### - [ ] Step 1: Create `ClientMOMSingleView.tsx`

Create `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` with the **exact** content of the existing `ClientMOMTab.tsx` (lines 1–274), with these two edits:

1. Rename the default-exported function from `ClientMOMTab` to `ClientMOMSingleView`.
2. Update the `Props` interface comment / name to reflect the role (optional rename of interface to `Props` is fine — keep it local).

The full source for the new file:

```tsx
import { useState } from "react";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useMasters } from "@/hooks/useMasters";
import ClientMeetingModal from "./ClientMeetingModal";
import ClientActionPointsTable from "./ClientActionPointsTable";
import ClientMeetingAttachments from "./ClientMeetingAttachments";
import { reportApiError } from "./errors";
import type { Profile } from "@/types/auth";
import type {
  ClientActionPointWrite,
  ClientMeetingDto,
} from "@/types/api/clients";

interface Props {
  clientUid: string;
  profile: Profile | null;
  profiles: Profile[];
  canWrite: boolean;
}

export default function ClientMOMSingleView({ clientUid, profile: _profile, profiles, canWrite }: Props) {
  const {
    meetings,
    loading,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    addActionPoint,
    updateActionPoint,
    deleteActionPoint,
    uploadAttachment,
    deleteAttachment,
  } = useClientMeetings(clientUid || undefined);
  const { items: roadmapItems } = useClientRoadmap(clientUid || undefined);
  const { clients } = useMasters();
  const selectedClient = clients.find((c) => c.id === clientUid);
  const clientOrgUid = selectedClient?.org ?? selectedClient?.orgs?.[0] ?? undefined;

  const [selectedUid, setSelectedUid] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientMeetingDto | null>(null);

  const safeAddActionPoint = async (
    meetingUid: string,
    body: ClientActionPointWrite,
  ): Promise<void> => {
    try {
      await addActionPoint(meetingUid, body);
    } catch (err) {
      reportApiError("Save failed", err);
    }
  };
  const safeUpdateActionPoint = async (
    apUid: string,
    body: Partial<ClientActionPointWrite>,
  ): Promise<void> => {
    try {
      await updateActionPoint(apUid, body);
    } catch (err) {
      reportApiError("Save failed", err);
    }
  };
  const safeDeleteActionPoint = async (apUid: string): Promise<void> => {
    try {
      await deleteActionPoint(apUid);
    } catch (err) {
      reportApiError("Delete failed", err);
    }
  };
  const safeUploadAttachment = async (
    meetingUid: string,
    file: File,
  ): Promise<void> => {
    try {
      await uploadAttachment(meetingUid, file);
    } catch (err) {
      reportApiError("Upload failed", err);
    }
  };
  const safeDeleteAttachment = async (attachmentUid: string): Promise<void> => {
    try {
      await deleteAttachment(attachmentUid);
    } catch (err) {
      reportApiError("Delete failed", err);
    }
  };

  if (loading) return <div>Loading…</div>;

  const selected = meetings.find((m) => m.uid === selectedUid) ?? meetings[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 12 }}>
      <div>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            style={btnPrimary}
          >
            + New meeting
          </button>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {meetings.length === 0 && <li style={{ color: "#64748b" }}>No meetings yet.</li>}
          {meetings.map((m) => {
            const active = selected?.uid === m.uid;
            return (
              <li
                key={m.uid}
                onClick={() => setSelectedUid(m.uid)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: active ? "#eff6ff" : "transparent",
                  border: `1px solid ${active ? "#bfdbfe" : "transparent"}`,
                  marginBottom: 4,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.meeting_date}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {m.meeting_type} · {m.mode}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        {!selected ? (
          <div style={{ color: "#64748b" }}>No meeting selected.</div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>
                {selected.meeting_date} · {selected.meeting_type} · {selected.mode}
              </h3>
              {canWrite && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(selected);
                      setModalOpen(true);
                    }}
                    style={btnLink}
                  >
                    Edit header
                  </button>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Delete this meeting and its action points?")) {
                        deleteMeeting(selected.uid)
                          .then(() => setSelectedUid(""))
                          .catch((err) => reportApiError("Delete failed", err));
                      }
                    }}
                    style={{ ...btnLink, color: "#b91c1c" }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
              <div><strong>Venue:</strong> {selected.venue || "—"}</div>
              <div><strong>Conducted by:</strong> {selected.conducted_by_detail?.full_name ?? "—"}</div>
              <div>
                <strong>Our attendees:</strong>{" "}
                {selected.our_attendees_detail.map((u) => u.full_name).join(", ") || "—"}
              </div>
              <div>
                <strong>Client attendees:</strong>{" "}
                {selected.client_attendees.map((a) => a.name).join(", ") || "—"}
              </div>
              <div><strong>Next meeting:</strong> {selected.next_meeting_date ?? "—"}</div>
            </div>

            <h4 style={sectionHeading}>Agenda</h4>
            <div style={paragraph}>{selected.agenda || <em>None</em>}</div>

            <h4 style={sectionHeading}>Minutes</h4>
            <div style={paragraph}>{selected.minutes || <em>None</em>}</div>

            <h4 style={sectionHeading}>Attachments</h4>
            <ClientMeetingAttachments
              attachments={selected.attachments}
              canWrite={canWrite}
              onUpload={(f) => safeUploadAttachment(selected.uid, f)}
              onDelete={(uid) => safeDeleteAttachment(uid)}
            />

            <h4 style={sectionHeading}>Action Points</h4>
            <ClientActionPointsTable
              meetingUid={selected.uid}
              actionPoints={selected.action_points}
              profiles={profiles}
              roadmapItems={roadmapItems}
              canWrite={canWrite}
              onAdd={(meetingUid, body) => safeAddActionPoint(meetingUid, body)}
              onUpdate={(apUid, body) => safeUpdateActionPoint(apUid, body)}
              onDelete={(apUid) => safeDeleteActionPoint(apUid)}
            />
          </div>
        )}
      </div>

      <ClientMeetingModal
        open={modalOpen}
        clientUid={clientUid}
        existing={editing}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          try {
            if (editing) {
              await updateMeeting(editing.uid, body);
            } else {
              const created = await createMeeting({ ...body, org: clientOrgUid });
              setSelectedUid(created.uid);
            }
          } catch (err) {
            reportApiError("Save failed", err);
            throw err;
          }
        }}
      />
    </div>
  );
}

const sectionHeading: React.CSSProperties = { margin: "16px 0 6px", fontSize: 14 };
const paragraph: React.CSSProperties = { whiteSpace: "pre-wrap", fontSize: 13, color: "#1e293b" };
const btnPrimary: React.CSSProperties = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  width: "100%",
};
const btnLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 13,
};
```

Note: the `if (!clientUid) return ...` guard from the old file is intentionally **removed** — this view is only mounted when `clientUid !== ""` (the router enforces it).

### - [ ] Step 2: Run typecheck to verify no errors

Run: `npx tsc -b`
Expected: Exit code 0, no errors. (`ClientMOMTab.tsx` is still the default and is still imported correctly.)

### - [ ] Step 3: Commit

```bash
git add frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx
git commit -m "refactor(clients): extract ClientMOMSingleView from ClientMOMTab"
```

---

## Task 3: Build `ClientMOMAllView` (grouped collapsible)

**Files:**
- Create: `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx`

### - [ ] Step 1: Create `ClientMOMAllView.tsx`

Create `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx`:

```tsx
import { Fragment, useMemo, useState } from "react";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useMasters } from "@/hooks/useMasters";
import ClientMeetingModal from "./ClientMeetingModal";
import ClientActionPointsTable from "./ClientActionPointsTable";
import ClientMeetingAttachments from "./ClientMeetingAttachments";
import { reportApiError } from "./errors";
import { groupMeetingsByClient } from "./momGrouping";
import type { Profile } from "@/types/auth";
import type {
  ClientActionPointWrite,
  ClientMeetingDto,
} from "@/types/api/clients";

interface Props {
  selectedOrg: string | null;
  profile: Profile | null;
  profiles: Profile[];
  canWrite: boolean;
}

export default function ClientMOMAllView({ selectedOrg, profile: _profile, profiles, canWrite }: Props) {
  const {
    meetings,
    loading,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    addActionPoint,
    updateActionPoint,
    deleteActionPoint,
    uploadAttachment,
    deleteAttachment,
  } = useClientMeetings();
  const { items: roadmapItems } = useClientRoadmap();
  const { clients } = useMasters();

  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [expandedMeetings, setExpandedMeetings] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientMeetingDto | null>(null);
  const [modalClientUid, setModalClientUid] = useState<string>("");

  const groups = useMemo(
    () => groupMeetingsByClient(meetings, selectedOrg),
    [meetings, selectedOrg],
  );

  const toggleClient = (uid: string) =>
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const toggleMeeting = (uid: string) =>
    setExpandedMeetings((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const orgUidForClient = (clientUid: string): string | undefined => {
    const c = clients.find((x) => x.id === clientUid);
    return c?.org ?? c?.orgs?.[0] ?? undefined;
  };

  const safeAddActionPoint = async (meetingUid: string, body: ClientActionPointWrite) => {
    try { await addActionPoint(meetingUid, body); } catch (err) { reportApiError("Save failed", err); }
  };
  const safeUpdateActionPoint = async (apUid: string, body: Partial<ClientActionPointWrite>) => {
    try { await updateActionPoint(apUid, body); } catch (err) { reportApiError("Save failed", err); }
  };
  const safeDeleteActionPoint = async (apUid: string) => {
    try { await deleteActionPoint(apUid); } catch (err) { reportApiError("Delete failed", err); }
  };
  const safeUploadAttachment = async (meetingUid: string, file: File) => {
    try { await uploadAttachment(meetingUid, file); } catch (err) { reportApiError("Upload failed", err); }
  };
  const safeDeleteAttachment = async (attachmentUid: string) => {
    try { await deleteAttachment(attachmentUid); } catch (err) { reportApiError("Delete failed", err); }
  };

  if (loading) return <div>Loading…</div>;
  if (groups.length === 0) {
    return <div style={{ color: "#64748b" }}>No meetings yet.</div>;
  }

  return (
    <div>
      {groups.map((g) => {
        const clientOpen = expandedClients.has(g.clientUid);
        const isUnassigned = g.clientUid === "";
        return (
          <div
            key={g.clientUid || "__unassigned"}
            style={{
              marginBottom: 8,
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: clientOpen ? "#eff6ff" : "#f8fafc",
                borderBottom: clientOpen ? "1px solid #e2e8f0" : "none",
              }}
            >
              <button
                type="button"
                onClick={() => toggleClient(g.clientUid)}
                style={{
                  flex: 1,
                  textAlign: "left",
                  padding: "10px 12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ width: 12 }}>{clientOpen ? "▾" : "▸"}</span>
                <span>{g.clientName}</span>
                <span style={{ color: "#64748b", fontWeight: 400 }}>
                  ({g.meetings.length} meeting{g.meetings.length === 1 ? "" : "s"})
                </span>
              </button>
              {canWrite && !isUnassigned && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setModalClientUid(g.clientUid);
                    setModalOpen(true);
                  }}
                  style={{
                    margin: "0 10px",
                    padding: "5px 10px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  + New meeting
                </button>
              )}
            </div>

            {clientOpen && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", textAlign: "left" }}>
                    <th style={thStyle}></th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Mode</th>
                    <th style={thStyle}>Conducted by</th>
                    <th style={thStyle}>Next meeting</th>
                    <th style={thStyle}># AP</th>
                  </tr>
                </thead>
                <tbody>
                  {g.meetings.map((m) => {
                    const meetingOpen = expandedMeetings.has(m.uid);
                    return (
                      <Fragment key={m.uid}>
                        <tr
                          onClick={() => toggleMeeting(m.uid)}
                          style={{
                            borderBottom: "1px solid #e2e8f0",
                            cursor: "pointer",
                            background: meetingOpen ? "#f8fafc" : "transparent",
                          }}
                        >
                          <td style={{ ...tdStyle, width: 24, color: "#64748b" }}>
                            {meetingOpen ? "▾" : "▸"}
                          </td>
                          <td style={tdStyle}>{m.meeting_date}</td>
                          <td style={tdStyle}>{m.meeting_type}</td>
                          <td style={tdStyle}>{m.mode}</td>
                          <td style={tdStyle}>{m.conducted_by_detail?.full_name ?? "—"}</td>
                          <td style={tdStyle}>{m.next_meeting_date ?? "—"}</td>
                          <td style={tdStyle}>{m.action_points.length}</td>
                        </tr>
                        {meetingOpen && (
                          <tr>
                            <td colSpan={7} style={{ padding: 0, borderBottom: "1px solid #e2e8f0" }}>
                              <div style={{ background: "#fff", padding: 14 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                  <h3 style={{ margin: 0, fontSize: 15 }}>
                                    {m.meeting_date} · {m.meeting_type} · {m.mode}
                                  </h3>
                                  {canWrite && (
                                    <div>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditing(m);
                                          setModalClientUid(g.clientUid);
                                          setModalOpen(true);
                                        }}
                                        style={btnLink}
                                      >
                                        Edit header
                                      </button>
                                      {" · "}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (window.confirm("Delete this meeting and its action points?")) {
                                            deleteMeeting(m.uid).catch((err) =>
                                              reportApiError("Delete failed", err),
                                            );
                                          }
                                        }}
                                        style={{ ...btnLink, color: "#b91c1c" }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                                  <div><strong>Venue:</strong> {m.venue || "—"}</div>
                                  <div><strong>Conducted by:</strong> {m.conducted_by_detail?.full_name ?? "—"}</div>
                                  <div>
                                    <strong>Our attendees:</strong>{" "}
                                    {m.our_attendees_detail.map((u) => u.full_name).join(", ") || "—"}
                                  </div>
                                  <div>
                                    <strong>Client attendees:</strong>{" "}
                                    {m.client_attendees.map((a) => a.name).join(", ") || "—"}
                                  </div>
                                  <div><strong>Next meeting:</strong> {m.next_meeting_date ?? "—"}</div>
                                </div>

                                <h4 style={sectionHeading}>Agenda</h4>
                                <div style={paragraph}>{m.agenda || <em>None</em>}</div>

                                <h4 style={sectionHeading}>Minutes</h4>
                                <div style={paragraph}>{m.minutes || <em>None</em>}</div>

                                <h4 style={sectionHeading}>Attachments</h4>
                                <ClientMeetingAttachments
                                  attachments={m.attachments}
                                  canWrite={canWrite}
                                  onUpload={(f) => safeUploadAttachment(m.uid, f)}
                                  onDelete={(uid) => safeDeleteAttachment(uid)}
                                />

                                <h4 style={sectionHeading}>Action Points</h4>
                                <ClientActionPointsTable
                                  meetingUid={m.uid}
                                  actionPoints={m.action_points}
                                  profiles={profiles}
                                  roadmapItems={roadmapItems}
                                  canWrite={canWrite}
                                  onAdd={(mu, body) => safeAddActionPoint(mu, body)}
                                  onUpdate={(apUid, body) => safeUpdateActionPoint(apUid, body)}
                                  onDelete={(apUid) => safeDeleteActionPoint(apUid)}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <ClientMeetingModal
        open={modalOpen}
        clientUid={modalClientUid}
        existing={editing}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          try {
            if (editing) {
              await updateMeeting(editing.uid, body);
            } else {
              await createMeeting({ ...body, org: orgUidForClient(modalClientUid) });
              setExpandedClients((prev) => new Set(prev).add(modalClientUid));
            }
          } catch (err) {
            reportApiError("Save failed", err);
            throw err;
          }
        }}
      />
    </div>
  );
}

const sectionHeading: React.CSSProperties = { margin: "16px 0 6px", fontSize: 14 };
const paragraph: React.CSSProperties = { whiteSpace: "pre-wrap", fontSize: 13, color: "#1e293b" };
const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontWeight: 600,
  borderBottom: "1px solid #e2e8f0",
};
const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const btnLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 13,
};
```

Notes:
- Each meeting row + its detail row is wrapped in `<Fragment key={m.uid}>` so React's iteration key is on the fragment, not the inner `<tr>`.
- `e.stopPropagation()` on Edit/Delete prevents the click from bubbling up and toggling the row collapse.
- After creating a new meeting, the group is force-expanded so the new row is visible.

### - [ ] Step 2: Run typecheck

Run: `npx tsc -b`
Expected: Exit code 0, no errors.

### - [ ] Step 3: Run lint

Run: `npm run lint`
Expected: No new errors. (Pre-existing warnings unrelated to these files are acceptable.)

### - [ ] Step 4: Commit

```bash
git add frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx
git commit -m "feat(clients): add ClientMOMAllView grouped collapsible meetings list"
```

---

## Task 4: Convert `ClientMOMTab` into a router

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMTab.tsx`

### - [ ] Step 1: Replace the file contents

Replace the entire contents of `frontend/task-tracker/src/components/clients/ClientMOMTab.tsx` with:

```tsx
import ClientMOMSingleView from "./ClientMOMSingleView";
import ClientMOMAllView from "./ClientMOMAllView";
import type { Profile } from "@/types/auth";

interface Props {
  clientUid: string;
  selectedOrg: string | null;
  profile: Profile | null;
  profiles: Profile[];
  canWrite: boolean;
}

export default function ClientMOMTab({ clientUid, selectedOrg, profile, profiles, canWrite }: Props) {
  if (clientUid) {
    return (
      <ClientMOMSingleView
        clientUid={clientUid}
        profile={profile}
        profiles={profiles}
        canWrite={canWrite}
      />
    );
  }
  return (
    <ClientMOMAllView
      selectedOrg={selectedOrg}
      profile={profile}
      profiles={profiles}
      canWrite={canWrite}
    />
  );
}
```

### - [ ] Step 2: Run typecheck — expect ONE error in `ClientsPage.tsx`

Run: `npx tsc -b`
Expected: Type error in `src/pages/ClientsPage.tsx` at the `<ClientMOMTab>` JSX — missing required prop `selectedOrg`.

This is intentional; Task 5 fixes it. Do **not** commit yet — committing now would leave the build broken.

---

## Task 5: Wire `selectedOrg` from `ClientsPage` into `ClientMOMTab`

**Files:**
- Modify: `frontend/task-tracker/src/pages/ClientsPage.tsx`

### - [ ] Step 1: Add `selectedOrg` to the JSX

In `frontend/task-tracker/src/pages/ClientsPage.tsx`, find the `<ClientMOMTab ...>` block (around line 138) and add the `selectedOrg` prop. The current block:

```tsx
      {subTab === "mom" && (
        <ClientMOMTab
          clientUid={effectiveClientUid}
          profile={profile}
          profiles={profiles}
          canWrite={canWrite}
        />
      )}
```

Becomes:

```tsx
      {subTab === "mom" && (
        <ClientMOMTab
          clientUid={effectiveClientUid}
          selectedOrg={selectedOrg}
          profile={profile}
          profiles={profiles}
          canWrite={canWrite}
        />
      )}
```

### - [ ] Step 2: Run typecheck

Run: `npx tsc -b`
Expected: Exit code 0, no errors.

### - [ ] Step 3: Run the existing test suite to confirm nothing else regressed

Run: `npm test`
Expected: All tests pass — including the new `momGrouping.test.ts` and all pre-existing tests.

### - [ ] Step 4: Commit Tasks 4 + 5 together

```bash
git add frontend/task-tracker/src/components/clients/ClientMOMTab.tsx frontend/task-tracker/src/pages/ClientsPage.tsx
git commit -m "feat(clients): route MOM tab to All view when no client selected"
```

---

## Task 6: Manual verification in the browser

**Files:** None (verification only)

### - [ ] Step 1: Start the dev server

Run: `npm run dev`
Expected: Vite prints a local URL (typically `http://localhost:5173`). Open it in a browser and log in as an admin or manager who has access to multiple clients across at least two orgs.

### - [ ] Step 2: Verify the All-clients grouped view

1. Navigate to **Clients** → **MOM & Action Points**.
2. With **Org = All** and **Client = All clients**: every client with at least one meeting renders as a collapsed `▸ Client Name (N meeting/s)` row, sorted alphabetically. `(Unassigned)` (if any) is at the bottom.
3. Click a client row → it expands to a table with columns Date / Type / Mode / Conducted by / Next meeting / # AP. Meetings are sorted most-recent first.
4. Click a meeting row → it expands inline beneath, showing Venue, attendees, agenda, minutes, attachments, and the Action Points table — all editable when `canWrite`.
5. Multiple meeting rows can be open simultaneously (try opening two in different groups).
6. Click `+ New meeting` in a client's header → modal opens with that client pre-selected; on save, the row appears at the top of that client's group and the group stays open.

### - [ ] Step 3: Verify org filtering

1. Switch the header **Org** picker from `All` to a specific org.
2. Only clients with meetings in that org should remain. Clients with no meetings in the selected org disappear.
3. Switch back to `All` — all groups return.

### - [ ] Step 4: Verify the Single-client view still works

1. Pick a specific client from the **Client** dropdown.
2. The view switches to the original left-list / right-pane layout.
3. Verify creating, editing, deleting meetings, action points, and attachments all still work for that client. (Regression check on the extraction.)
4. Switch back to **All clients** — the grouped view returns (collapsed).

### - [ ] Step 5: Verify the read-only role

1. Log in (or impersonate) a member-only user without admin/manager rights.
2. Open the All-clients view: no `+ New meeting` buttons, no Edit/Delete in the inline detail. Rows are still expandable; action-point cells are read-only.

### - [ ] Step 6: Stop the dev server

`Ctrl+C` in the terminal running `npm run dev`.

### - [ ] Step 7: Push the branch

Per the user's standing memory (auto-commit-and-push for feature branches):

```bash
git push -u origin MOM_AllClient
```

Expected: Push succeeds.

---

## Done

If all tasks above are checked, the feature is complete. The user can now select **All clients** on the MOM & Action Points sub-tab and see every client's meetings grouped, collapsible, and inline-expandable.
