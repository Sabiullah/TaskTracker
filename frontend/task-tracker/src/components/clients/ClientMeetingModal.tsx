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

const TYPES: MeetingType[] = ["Review", "Kickoff", "Escalation", "Strategic", "Ad-hoc"];
const MODES: MeetingMode[] = ["In-person", "Video", "Phone"];

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

  useEffect(() => {
    if (!open) return;
    setClient(existing?.client ?? defaultClientUid);
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

  const clientOptions = useMemo(
    () => momClientOptions(clients, selectedOrg, client),
    [clients, selectedOrg, client],
  );

  if (!open) return null;

  const parseClientAttendees = () =>
    clientAttendeesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, designation, email] = line.split("·").map((s) => s.trim());
        return { name, designation: designation || "", email: email || "" };
      });

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

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, .4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: 20,
          borderRadius: 8,
          width: 640,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
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
          <div>
            <label style={labelStyle}>Date*</label>
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} required style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Time</label>
            <input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={meetingType} onChange={(e) => setMeetingType(e.target.value as MeetingType)} style={inputStyle}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as MeetingMode)} style={inputStyle}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Venue / link</label>
            <input value={venue} onChange={(e) => setVenue(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Conducted by</label>
            <select value={conductedBy} onChange={(e) => setConductedBy(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Our attendees (Ctrl/Cmd-click to multi-select)</label>
        <select
          multiple
          value={ourAttendees}
          onChange={(e) =>
            setOurAttendees(Array.from(e.target.selectedOptions, (o) => o.value))
          }
          style={{ ...inputStyle, minHeight: 90 }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>

        <label style={labelStyle}>Client attendees — one per line, format: Name · Designation · email</label>
        <textarea
          value={clientAttendeesText}
          onChange={(e) => setClientAttendeesText(e.target.value)}
          rows={3}
          style={inputStyle}
          placeholder="Rajesh Kumar · CFO · rajesh@client.com"
        />

        <label style={labelStyle}>Agenda</label>
        <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} style={inputStyle} />

        <label style={labelStyle}>Minutes</label>
        <textarea value={minutes} onChange={(e) => setMinutes(e.target.value)} rows={5} style={inputStyle} />

        <label style={labelStyle}>Next meeting date</label>
        <input
          type="date"
          value={nextMeetingDate}
          onChange={(e) => setNextMeetingDate(e.target.value)}
          style={inputStyle}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving || !meetingDate || !client} style={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#475569" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  color: "#1e293b",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  cursor: "pointer",
};
