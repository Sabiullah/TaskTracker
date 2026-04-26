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
