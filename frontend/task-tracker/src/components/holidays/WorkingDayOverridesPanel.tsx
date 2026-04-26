import { useState, type CSSProperties } from "react";

import { useWorkingDayOverrides } from "@/hooks/useWorkingDayOverrides";
import { fmtDate, TODAY } from "@/utils/date";
import { ApiError } from "@/lib/api";
import type { Profile } from "@/types";

interface Props {
  profile: Profile | null;
  selectedOrg?: string;
  isAdmin: boolean;
}

const cell: CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
};
const head: CSSProperties = {
  ...cell,
  fontWeight: 700,
  color: "#475569",
  background: "#f8fafc",
  textAlign: "left",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
};
const inp: CSSProperties = {
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
};

function formatErr(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export default function WorkingDayOverridesPanel({ profile, selectedOrg, isAdmin }: Props) {
  const { items, loading, create, remove } = useWorkingDayOverrides();
  const [date, setDate] = useState(TODAY);
  const [note, setNote] = useState("");
  const [org, setOrg] = useState<string>(
    selectedOrg ?? profile?.orgs?.[0]?.uid ?? "",
  );
  const [busy, setBusy] = useState(false);

  const orgs = profile?.orgs ?? [];

  const handleAdd = async (): Promise<void> => {
    if (!isAdmin) {
      window.alert("Only admins can add working-day overrides.");
      return;
    }
    if (!date) {
      window.alert("Date is required");
      return;
    }
    if (orgs.length > 1 && !org) {
      window.alert("Pick an organisation");
      return;
    }
    const targetOrg = org || orgs[0]?.uid;
    if (!targetOrg) {
      window.alert("You are not a member of any organisation");
      return;
    }

    // Warn on past date — flipping a past Sunday could change historic codes.
    const today = new Date(TODAY + "T00:00:00");
    const picked = new Date(date + "T00:00:00");
    if (picked < today) {
      const ok = window.confirm(
        `${fmtDate(date)} is in the past. Flipping it may change historical attendance codes (Sundays will recompute as workdays). Continue?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      await create({
        date,
        is_working: true,
        note: note.trim(),
        org: targetOrg,
      });
      setNote("");
    } catch (err) {
      window.alert(`Add failed: ${formatErr(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (uid: string): Promise<void> => {
    if (!isAdmin) {
      window.alert("Only admins can delete overrides.");
      return;
    }
    if (!window.confirm("Delete this override? Sundays will revert to HD in the matrix.")) {
      return;
    }
    try {
      await remove(uid);
    } catch (err) {
      window.alert(`Delete failed: ${formatErr(err)}`);
    }
  };

  return (
    <div style={{ padding: "10px 16px" }}>
      <div
        style={{
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 12,
          color: "#1e40af",
          marginBottom: 12,
        }}
      >
        💡 <strong>Working-day override:</strong> mark a Sunday as a working day
        (e.g. release weekends). Holiday rows in the Holidays tab still take
        precedence over overrides. Only admins can add or delete.
      </div>

      {isAdmin && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 12,
            alignItems: "center",
            flexWrap: "wrap",
            background: "#fff",
            padding: 12,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inp}
          />
          <input
            placeholder="Note (e.g. team release)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ ...inp, width: 280 }}
          />
          {orgs.length > 1 && (
            <select
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              style={inp}
            >
              <option value="">— pick org —</option>
              {orgs.map((o) => (
                <option key={o.uid} value={o.uid}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          <button
            disabled={busy || !date}
            onClick={() => {
              void handleAdd();
            }}
            style={{
              padding: "8px 14px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {busy ? "Adding…" : "+ Add as working day"}
          </button>
        </div>
      )}

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {loading && <div style={{ padding: 14, color: "#64748b", fontSize: 13 }}>Loading…</div>}
        {!loading && items.length === 0 && (
          <div style={{ padding: 14, color: "#64748b", fontSize: 13 }}>
            No overrides yet. {isAdmin && "Add the first one above."}
          </div>
        )}
        {items.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={head}>Date</th>
                <th style={head}>Note</th>
                <th style={{ ...head, width: 80, textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.uid}>
                  <td style={{ ...cell, fontWeight: 600 }}>{fmtDate(r.date)}</td>
                  <td style={{ ...cell, color: "#475569" }}>{r.note || "—"}</td>
                  <td style={{ ...cell, textAlign: "center" }}>
                    {isAdmin && (
                      <button
                        onClick={() => {
                          void handleRemove(r.uid);
                        }}
                        style={{
                          padding: "4px 10px",
                          background: "#fee2e2",
                          color: "#dc2626",
                          border: "none",
                          borderRadius: 5,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
