import { useState } from "react";
import type { ClientVisitDto, VisitSentInfoForm } from "@/types/api/internalReports";

interface Props {
  visit: ClientVisitDto;
  canEdit: boolean;
  onSave: (form: VisitSentInfoForm) => Promise<void>;
}

export default function VisitSentInfoPanel({ visit, canEdit, onSave }: Props) {
  const [sentDate, setSentDate] = useState<string>(visit.report_sent_date ?? "");
  const [voice, setVoice] = useState<boolean>(visit.voice_note_sent);
  const [summary, setSummary] = useState<string>(visit.voice_note_summary);
  const [saving, setSaving] = useState(false);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Report sent date
        <input
          type="date"
          disabled={!canEdit}
          value={sentDate}
          onChange={(e) => setSentDate(e.target.value)}
          style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "end" }}>
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={voice}
          onChange={(e) => setVoice(e.target.checked)}
        />
        Voice note sent
      </label>
      <label style={{ gridColumn: "1 / span 2", display: "flex", flexDirection: "column", gap: 4 }}>
        Voice note summary
        <textarea
          disabled={!canEdit}
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
        />
      </label>
      {canEdit && (
        <div style={{ gridColumn: "1 / span 2" }}>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  report_sent_date: sentDate || null,
                  voice_note_sent: voice,
                  voice_note_summary: summary,
                });
              } finally {
                setSaving(false);
              }
            }}
            style={{
              padding: "6px 12px",
              background: saving ? "#94a3b8" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save sent info"}
          </button>
        </div>
      )}
    </div>
  );
}
