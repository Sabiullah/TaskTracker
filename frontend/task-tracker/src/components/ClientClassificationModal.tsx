import { useState, type CSSProperties, type FormEvent } from "react";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import type { MasterItem } from "@/types";
import type { ClientClassificationDto } from "@/types/api";

type Mode = "add" | "edit";

interface Props {
  mode: Mode;
  org: string;
  orgId: string;
  existing?: ClientClassificationDto;
  availableClients: MasterItem[];
  onClose: () => void;
  onSaved: () => void;
}

const CLASSIFICATIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "A", label: "A - Amazing" },
  { value: "B", label: "B - Breadwinning" },
  { value: "C", label: "C - Convenience" },
  { value: "D", label: "D - Dangerous" },
];
const REVENUE_TIER = ["High", "Medium", "Low"] as const;
const STRATEGIC = ["Critical", "Important", "Moderate", "Low"] as const;
const RELATIONSHIP = ["Strong", "Good", "At Risk", "Declining"] as const;
const GROWTH = ["High", "Medium", "Low"] as const;
const RISK = ["High", "Medium", "Low"] as const;

const HINTS = {
  classification: [
    "A - Amazing: high value, easy to work with, strong fit",
    "B - Breadwinning: core revenue driver, reliable engagement",
    "C - Convenience: low effort, modest value, transactional",
    "D - Dangerous: high friction or risk, reconsider fit",
  ],
  revenueTier: [
    "High: top revenue contributor",
    "Medium: steady mid-tier revenue",
    "Low: minor revenue contribution",
  ],
  strategic: [
    "Critical: essential to business, reputation, or roadmap",
    "Important: meaningful strategic value",
    "Moderate: some long-term value",
    "Low: limited strategic relevance",
  ],
  relationship: [
    "Strong: deep trust, long-term partnership",
    "Good: healthy, reliable working relationship",
    "At Risk: signs of friction, needs attention",
    "Declining: deteriorating, intervention required",
  ],
  growth: [
    "High: strong potential to expand scope or spend",
    "Medium: some upsell or cross-sell opportunity",
    "Low: limited room to grow the account",
  ],
  risk: [
    "High: payment, compliance, or delivery concerns",
    "Medium: watch-list, some exposure",
    "Low: stable, minimal concern",
  ],
} as const;

const hintBoxS: CSSProperties = {
  marginTop: 6,
  padding: "6px 8px",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 11,
  color: "#64748b",
  lineHeight: 1.5,
};

function HintList({ items }: { items: ReadonlyArray<string> }) {
  return (
    <ul style={{ ...hintBoxS, margin: 0, paddingLeft: 22 }}>
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

const overlayS: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
};
const modalS: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  boxShadow: "0 20px 50px rgba(0,0,0,.25)",
  width: "min(520px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  padding: 24,
};
const labelS: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#475569",
  marginBottom: 4,
};
const inpS: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};
const rowS: CSSProperties = { marginBottom: 12 };

export default function ClientClassificationModal({
  mode,
  org,
  orgId,
  existing,
  availableClients,
  onClose,
  onSaved,
}: Props) {
  const [clientUid, setClientUid] = useState<string>(existing?.client ?? "");
  const [classification, setClassification] = useState<string>(
    existing?.classification ?? "",
  );
  const [revenueTier, setRevenueTier] = useState<string>(
    existing?.revenue_tier ?? "",
  );
  const [strategic, setStrategic] = useState<string>(
    existing?.strategic_importance ?? "",
  );
  const [relationship, setRelationship] = useState<string>(
    existing?.relationship_health ?? "",
  );
  const [growth, setGrowth] = useState<string>(
    existing?.growth_potential ?? "",
  );
  const [risk, setRisk] = useState<string>(existing?.risk_level ?? "");
  const [notes, setNotes] = useState<string>(existing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSave = mode === "edit" || clientUid !== "";

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSave) return;
    setError(null);
    setSaving(true);
    const payload = {
      classification,
      revenue_tier: revenueTier,
      strategic_importance: strategic,
      relationship_health: relationship,
      growth_potential: growth,
      risk_level: risk,
      notes,
    };
    try {
      if (mode === "add") {
        await apiPost("/client_classifications/", {
          client: clientUid,
          org: orgId,
          ...payload,
        });
      } else if (existing) {
        await apiPatch(`/client_classifications/${existing.uid}/`, payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.message === "string"
            ? err.message
            : JSON.stringify(err.message)
          : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlayS} onClick={onClose}>
      <form
        style={modalS}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>
            {mode === "add" ? "Add Classification" : "Edit Classification"}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 22,
              color: "#94a3b8",
              cursor: "pointer",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              borderRadius: 6,
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={rowS}>
          <label style={labelS}>
            Client <span style={{ color: "#dc2626" }}>*</span>
          </label>
          {mode === "edit" ? (
            <input
              style={{ ...inpS, background: "#f1f5f9", color: "#64748b" }}
              value={existing?.client_detail?.name ?? ""}
              disabled
            />
          ) : (
            <select
              style={inpS}
              value={clientUid}
              onChange={(e) => setClientUid(e.target.value)}
              required
            >
              <option value="">— Select a client —</option>
              {availableClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            Org: {org}
          </div>
        </div>

        <div style={rowS}>
          <label style={labelS}>Classification</label>
          <select
            style={inpS}
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
          >
            <option value="">—</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <HintList items={HINTS.classification} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={labelS}>Revenue Tier</label>
            <select
              style={inpS}
              value={revenueTier}
              onChange={(e) => setRevenueTier(e.target.value)}
            >
              <option value="">—</option>
              {REVENUE_TIER.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <HintList items={HINTS.revenueTier} />
          </div>
          <div>
            <label style={labelS}>Strategic Importance</label>
            <select
              style={inpS}
              value={strategic}
              onChange={(e) => setStrategic(e.target.value)}
            >
              <option value="">—</option>
              {STRATEGIC.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <HintList items={HINTS.strategic} />
          </div>
          <div>
            <label style={labelS}>Relationship Health</label>
            <select
              style={inpS}
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
            >
              <option value="">—</option>
              {RELATIONSHIP.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <HintList items={HINTS.relationship} />
          </div>
          <div>
            <label style={labelS}>Growth Potential</label>
            <select
              style={inpS}
              value={growth}
              onChange={(e) => setGrowth(e.target.value)}
            >
              <option value="">—</option>
              {GROWTH.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <HintList items={HINTS.growth} />
          </div>
          <div>
            <label style={labelS}>Risk Level</label>
            <select
              style={inpS}
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
            >
              <option value="">—</option>
              {RISK.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <HintList items={HINTS.risk} />
          </div>
        </div>

        <div style={rowS}>
          <label style={labelS}>Notes</label>
          <textarea
            style={{ ...inpS, minHeight: 80, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
          />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              background: "#f1f5f9",
              color: "#475569",
              border: "none",
              borderRadius: 7,
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave || saving}
            style={{
              padding: "8px 16px",
              background: canSave && !saving ? "#16a34a" : "#94a3b8",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              fontWeight: 700,
              cursor: canSave && !saving ? "pointer" : "not-allowed",
              fontSize: 13,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
