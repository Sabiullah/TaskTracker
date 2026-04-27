import { Fragment, useMemo, useState } from "react";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useMasters } from "@/hooks/useMasters";
import MultiSelect from "@/components/ui/MultiSelect";
import ClientMeetingModal from "./ClientMeetingModal";
import ClientActionPointsTable from "./ClientActionPointsTable";
import ClientMeetingAttachments from "./ClientMeetingAttachments";
import { reportApiError } from "./errors";
import { groupMeetingsByClient } from "./momGrouping";
import { orgUidForClient } from "./momOrgResolver";
import { actionPointMatches, isFilterActive } from "./actionPointFilter";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
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
    uploadActionPointAttachment,
    deleteActionPointAttachment,
  } = useClientMeetings();
  const { items: roadmapItems } = useClientRoadmap();
  const { clients } = useMasters();

  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [expandedMeetings, setExpandedMeetings] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientMeetingDto | null>(null);
  const [modalClientUid, setModalClientUid] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [targetMonth, setTargetMonth] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { overdue } = useOverdueActionPoints();
  const overdueUids = useMemo(
    () => new Set(overdue.map((ap) => ap.uid)),
    [overdue],
  );

  const filters = useMemo(
    () => ({
      status: statusFilter,
      priority: priorityFilter,
      owner: ownerFilter,
      targetMonth,
      overdueUids: overdueOnly ? overdueUids : undefined,
    }),
    [statusFilter, priorityFilter, ownerFilter, targetMonth, overdueOnly, overdueUids],
  );

  const groups = useMemo(
    () => groupMeetingsByClient(meetings, selectedOrg),
    [meetings, selectedOrg],
  );

  const filteredGroups = useMemo(() => {
    if (!isFilterActive(filters)) return groups;
    return groups
      .map((g) => ({
        ...g,
        meetings: g.meetings.filter((m) =>
          m.action_points.length === 0 ||
          m.action_points.some((ap) => actionPointMatches(ap, filters)),
        ),
      }))
      .filter((g) => g.meetings.length > 0);
  }, [groups, filters]);

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
  const safeUploadAPAttachment = async (apUid: string, file: File) => {
    try { await uploadActionPointAttachment(apUid, file); } catch (err) { reportApiError("Upload failed", err); }
  };
  const safeDeleteAPAttachment = async (apUid: string, attachmentUid: string) => {
    try { await deleteActionPointAttachment(apUid, attachmentUid); } catch (err) { reportApiError("Delete failed", err); }
  };

  if (loading) return <div>Loading…</div>;

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
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
      </div>
      {filteredGroups.length === 0 ? (
        <div style={{ color: "#64748b" }}>No meetings yet.</div>
      ) : (
      filteredGroups.map((g) => {
        const clientOpen = expandedClients.has(g.clientUid);
        const isUnassigned = g.clientUid === "unassigned";
        return (
          <div
            key={g.clientUid}
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
                    const visibleAPs = isFilterActive(filters)
                      ? m.action_points.filter((ap) => actionPointMatches(ap, filters))
                      : m.action_points;
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
                          <td style={tdStyle}>
                            {isFilterActive(filters)
                              ? `${visibleAPs.length} of ${m.action_points.length}`
                              : m.action_points.length}
                          </td>
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
                                  actionPoints={visibleAPs}
                                  profiles={profiles}
                                  roadmapItems={roadmapItems}
                                  canWrite={canWrite}
                                  onAdd={(mu, body) => safeAddActionPoint(mu, body)}
                                  onUpdate={(apUid, body) => safeUpdateActionPoint(apUid, body)}
                                  onDelete={(apUid) => safeDeleteActionPoint(apUid)}
                                  onUploadAttachment={(apUid, f) => safeUploadAPAttachment(apUid, f)}
                                  onDeleteAttachment={(apUid, attUid) => safeDeleteAPAttachment(apUid, attUid)}
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
      })
      )}

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
            const org = orgUidForClient(clients, targetClientUid);
            if (editing) {
              await updateMeeting(editing.uid, { ...body, org });
            } else {
              await createMeeting({ ...body, org });
              setTargetMonth("");
              setExpandedClients((prev) => new Set(prev).add(targetClientUid));
            }
          } catch (err) {
            reportApiError("Save failed", err);
            // Rethrow so the modal stays open for the user to retry.
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
