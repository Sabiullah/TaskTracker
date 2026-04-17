import { useEffect, useState } from "react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type {
  LeadHistoryCreate,
  LeadHistoryDto,
} from "@/types/api";
import type { Lead, LeadHistory } from "@/types";

export interface HistoryModalProps {
  lead: Pick<Lead, "id" | "client">;
  onClose: () => void;
}

export default function HistoryModal({ lead, onClose }: HistoryModalProps) {
  const [logs, setLogs] = useState<LeadHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const dtoToHistory = (dto: LeadHistoryDto): LeadHistory => ({
    id: dto.uid,
    lead_id: lead.id,
    note: dto.note,
    created_by: dto.created_by_detail?.uid ?? "",
    created_at: dto.created_at,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dtos = await apiGet<LeadHistoryDto[]>("/lead_history/", {
          lead_uid: lead.id,
        });
        if (cancelled) return;
        const sorted = [...dtos].sort((a, b) =>
          a.created_at > b.created_at ? -1 : 1,
        );
        setLogs(sorted.map(dtoToHistory));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const addNote = async (): Promise<void> => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      const body: LeadHistoryCreate = {
        lead_uid: lead.id,
        note: note.trim(),
      };
      const dto = await apiPost<LeadHistoryDto>("/lead_history/", body);
      setLogs((l) => [dtoToHistory(dto), ...l]);
      setNote("");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 560,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            📋 Follow-up Log — {lead.client}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a follow-up note…"
            style={{
              flex: 1,
              padding: "8px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 7,
              fontSize: 13,
              resize: "vertical",
              minHeight: 60,
            }}
          />
          <button
            onClick={addNote}
            disabled={saving}
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              alignSelf: "flex-end",
            }}
          >
            {saving ? "…" : "+ Add"}
          </button>
        </div>
        {loading ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</div>
        ) : logs.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            No follow-up notes yet.
          </div>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              style={{
                borderLeft: "3px solid #2563eb",
                paddingLeft: 12,
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 13 }}>{l.note}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                {new Date(l.created_at).toLocaleString("en-GB")}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
