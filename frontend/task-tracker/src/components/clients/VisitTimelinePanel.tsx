import type { VisitReportAuditEventDto } from "@/types/api/internalReports";

interface Props {
  events: readonly VisitReportAuditEventDto[];
}

const LABELS: Record<VisitReportAuditEventDto["event_type"], string> = {
  created: "Visit created",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  resubmitted: "Resubmitted",
  sent_to_client: "Sent to client",
  voice_note_marked: "Voice note marked sent",
};

export default function VisitTimelinePanel({ events }: Props) {
  if (!events.length) return <div style={{ color: "#64748b" }}>No events yet.</div>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13 }}>
      {events.map((e) => (
        <li key={e.uid} style={{ padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
          <span style={{ color: "#64748b" }}>{new Date(e.created_at).toLocaleString()}</span>
          {" — "}
          <strong>{LABELS[e.event_type] ?? e.event_type}</strong>
          {e.actor_detail ? <> by {e.actor_detail.full_name}</> : null}
          {e.comment ? <> — &ldquo;{e.comment}&rdquo;</> : null}
        </li>
      ))}
    </ul>
  );
}
