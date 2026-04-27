import { useMemo, useState } from "react";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useMasters } from "@/hooks/useMasters";
import MultiSelect from "@/components/ui/MultiSelect";
import ClientMeetingModal from "./ClientMeetingModal";
import ClientActionPointsTable from "./ClientActionPointsTable";
import ClientMeetingAttachments from "./ClientMeetingAttachments";
import { reportApiError } from "./errors";
import { orgUidForClient } from "./momOrgResolver";
import { actionPointMatches, isFilterActive } from "./actionPointFilter";
import type { Profile } from "@/types/auth";
import type {
  ActionPointStatus,
  ClientActionPointWrite,
  ClientMeetingDto,
  Priority,
} from "@/types/api/clients";

const AP_STATUSES: ActionPointStatus[] = ["Open", "In Progress", "Completed", "Cancelled"];
const AP_PRIORITIES: Priority[] = ["High", "Medium", "Low"];

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

  const [selectedUid, setSelectedUid] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [targetMonth, setTargetMonth] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientMeetingDto | null>(null);

  const filters = useMemo(
    () => ({
      status: statusFilter,
      priority: priorityFilter,
      owner: ownerFilter,
      targetMonth,
    }),
    [statusFilter, priorityFilter, ownerFilter, targetMonth],
  );

  const filteredMeetings = useMemo(() => {
    if (!isFilterActive(filters)) return meetings;
    return meetings.filter((m) =>
      m.action_points.length === 0 ||
      m.action_points.some((ap) => actionPointMatches(ap, filters)),
    );
  }, [meetings, filters]);

  // Centralised error-surfacing wrappers so none of the child components
  // can silently swallow a rejected promise.
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

  const selected =
    filteredMeetings.find((m) => m.uid === selectedUid) ?? filteredMeetings[0];

  const visibleAPs = selected
    ? isFilterActive(filters)
      ? selected.action_points.filter((ap) => actionPointMatches(ap, filters))
      : selected.action_points
    : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <MultiSelect
          label="Status"
          options={AP_STATUSES as string[]}
          selected={statusFilter}
          onChange={setStatusFilter}
          allLabel="All statuses"
        />
        <MultiSelect
          label="Priority"
          options={AP_PRIORITIES as string[]}
          selected={priorityFilter}
          onChange={setPriorityFilter}
          allLabel="All priorities"
        />
        <MultiSelect
          label="Owner"
          options={profiles.map((p) => p.id)}
          selected={ownerFilter}
          onChange={setOwnerFilter}
          allLabel="All owners"
          labels={Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))}
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#475569" }}>
          AP TARGET MONTH
          <input
            type="month"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
          />
        </label>
      </div>
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
            {filteredMeetings.length === 0 && <li style={{ color: "#64748b" }}>No meetings yet.</li>}
            {filteredMeetings.map((m) => {
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
                actionPoints={visibleAPs}
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
          defaultClientUid={clientUid}
          selectedOrg={null}
          clients={clients}
          existing={editing}
          profiles={profiles}
          onClose={() => setModalOpen(false)}
          onSubmit={async (body) => {
            try {
              const org = orgUidForClient(clients, body.client);
              if (editing) {
                // PATCH can omit `org` when the client hasn't changed, but we
                // pass it anyway so a client-change on edit also updates the
                // owning org. The backend validator accepts a matching org.
                await updateMeeting(editing.uid, { ...body, org });
              } else {
                const created = await createMeeting({ ...body, org });
                setTargetMonth("");
                setSelectedUid(created.uid);
              }
            } catch (err) {
              reportApiError("Save failed", err);
              // Rethrow so the modal stays open for the user to retry.
              throw err;
            }
          }}
        />
      </div>
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
