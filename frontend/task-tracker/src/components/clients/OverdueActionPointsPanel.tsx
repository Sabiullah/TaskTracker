import { useMemo } from "react";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import type { ClientMeetingDto } from "@/types/api/clients";
import { filterOverdue } from "./overdueFilters";

interface Props {
  selectedOrg: string | null;
  selectedClientUid: string;
  // Lifted from the page to avoid double-fetching `/client-meetings/`
  // (the page-header overdue counter needs the same meeting data).
  meetings: ClientMeetingDto[];
  onSelectMeeting: (meetingUid: string) => void;
}

export default function OverdueActionPointsPanel({
  selectedOrg,
  selectedClientUid,
  meetings,
  onSelectMeeting,
}: Props) {
  const { overdue, loading } = useOverdueActionPoints();

  const scoped = useMemo(
    () => filterOverdue(overdue, meetings, selectedOrg, selectedClientUid),
    [overdue, meetings, selectedOrg, selectedClientUid],
  );
  const isFiltered = Boolean(selectedOrg) || Boolean(selectedClientUid);

  const byClient = useMemo(() => {
    const map = new Map<
      string,
      { clientName: string; rows: Array<{ apUid: string; desc: string; target: string; meetingUid: string; meetingDate: string }> }
    >();
    for (const ap of scoped) {
      const meeting = meetings.find((m) => m.id === ap.meeting);
      const clientName = meeting?.client_detail?.name ?? "Unknown client";
      const key = meeting?.client ?? `unknown-${ap.meeting}`;
      const bucket = map.get(key) ?? { clientName, rows: [] };
      bucket.rows.push({
        apUid: ap.uid,
        desc: ap.description,
        target: ap.target_date ?? "",
        meetingUid: meeting?.uid ?? "",
        meetingDate: meeting?.meeting_date ?? "",
      });
      map.set(key, bucket);
    }
    return Array.from(map.values()).sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [scoped, meetings]);

  if (loading) return <div>Loading…</div>;
  if (scoped.length === 0) {
    return (
      <div style={{ color: "#64748b" }}>
        {isFiltered ? "No overdue action points for the current filter 🎉" : "No overdue action points 🎉"}
      </div>
    );
  }

  return (
    <div>
      {byClient.map((group) => (
        <div key={group.clientName} style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>{group.clientName}</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fef2f2", textAlign: "left" }}>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Meeting</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r) => (
                <tr key={r.apUid} style={{ borderBottom: "1px solid #fecaca" }}>
                  <td style={tdStyle}>{r.desc}</td>
                  <td style={tdStyle}>{r.target}</td>
                  <td style={tdStyle}>
                    {r.meetingUid ? (
                      <button
                        type="button"
                        onClick={() => onSelectMeeting(r.meetingUid)}
                        style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
                      >
                        {r.meetingDate || "Open"}
                      </button>
                    ) : (
                      r.meetingDate
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "6px 8px", fontWeight: 600, borderBottom: "1px solid #fecaca" };
const tdStyle: React.CSSProperties = { padding: "6px 8px", verticalAlign: "top" };
