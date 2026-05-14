import type { CSSProperties, ReactNode } from "react";

export type EditScope = "this" | "following";

interface ChangedField {
  label: string;
  before: ReactNode;
  after: ReactNode;
}

interface PlanEditScopeModalProps {
  /** Friendly description of the source row, e.g. "Weekly · 2026-05-14 (Thu)" */
  rowSummary: string;
  /** Fields the user changed, with before/after snippets. */
  changes: readonly ChangedField[];
  saving: boolean;
  onChoose: (scope: EditScope) => void;
  onCancel: () => void;
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 4100,
};

const card: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  width: "min(480px,94vw)",
  boxShadow: "0 24px 80px rgba(0,0,0,.32)",
  padding: 0,
  overflow: "hidden",
};

export default function PlanEditScopeModal({
  rowSummary,
  changes,
  saving,
  onChoose,
  onCancel,
}: PlanEditScopeModalProps) {
  return (
    <div style={overlay} onClick={saving ? undefined : onCancel}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #e2e8f0",
            fontWeight: 800,
            fontSize: 15,
            color: "#1e293b",
          }}
        >
          🔁 This entry is part of a series
        </div>
        <div style={{ padding: "14px 18px", color: "#475569", fontSize: 13 }}>
          <div style={{ marginBottom: 10 }}>
            <strong>{rowSummary}</strong>
          </div>
          {changes.length > 0 && (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 12px",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                Changes
              </div>
              {changes.map((c) => (
                <div
                  key={c.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr",
                    columnGap: 10,
                    fontSize: 12,
                    padding: "3px 0",
                  }}
                >
                  <span style={{ color: "#64748b" }}>{c.label}</span>
                  <span>
                    <span style={{ color: "#94a3b8" }}>{c.before}</span>
                    <span style={{ margin: "0 6px", color: "#94a3b8" }}>→</span>
                    <span style={{ color: "#0f172a", fontWeight: 600 }}>
                      {c.after}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            Apply this edit to…
          </div>
        </div>
        <div
          style={{
            padding: "0 18px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <button
            disabled={saving}
            onClick={() => onChoose("this")}
            style={{
              padding: "10px 14px",
              border: "1.5px solid #2563eb",
              background: "#eff6ff",
              color: "#1e40af",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
              textAlign: "left",
            }}
          >
            This entry only
            <div
              style={{
                fontWeight: 400,
                fontSize: 11,
                color: "#64748b",
                marginTop: 2,
              }}
            >
              Other entries in the series stay as they are.
            </div>
          </button>
          <button
            disabled={saving}
            onClick={() => onChoose("following")}
            style={{
              padding: "10px 14px",
              border: "1.5px solid #7c3aed",
              background: "#f5f3ff",
              color: "#5b21b6",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: saving ? "not-allowed" : "pointer",
              textAlign: "left",
            }}
          >
            This and following entries
            <div
              style={{
                fontWeight: 400,
                fontSize: 11,
                color: "#64748b",
                marginTop: 2,
              }}
            >
              Apply to this row and every later row in the series.
            </div>
          </button>
          <button
            disabled={saving}
            onClick={onCancel}
            style={{
              padding: "8px 14px",
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#475569",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
