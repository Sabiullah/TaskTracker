import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { TODAY } from "@/utils/date";
import type {
  LeaveRequestTypeValue,
  LeaveSessionValue,
} from "@/types/api/leave";
import type { Profile } from "@/types";

interface Props {
  open: boolean;
  profile: Profile | null;
  selectedOrg?: string;
  onClose: () => void;
  onSubmit: (body: {
    user: string;
    org: string;
    from_date: string;
    to_date: string;
    from_session: LeaveSessionValue;
    to_session: LeaveSessionValue;
    reason: string;
    request_type: LeaveRequestTypeValue;
  }) => Promise<void>;
}

const SESSIONS: LeaveSessionValue[] = ["Full", "First Half", "Second Half"];
const REQUEST_TYPES: LeaveRequestTypeValue[] = ["Leave", "WFH"];

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const sheet: CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 18,
  width: 480,
  maxWidth: "92vw",
};

const inp: CSSProperties = {
  padding: "6px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

const btnPrimary: CSSProperties = {
  padding: "7px 16px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
};

const btnSecondary: CSSProperties = {
  padding: "7px 14px",
  background: "#fff",
  color: "#475569",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
      <label style={{ width: 100, fontSize: 13, color: "#475569" }}>{label}</label>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>{children}</div>
    </div>
  );
}

/** Approximate day count for the live preview. The server is the source of truth
 *  (it skips holidays + Sundays), so we only do a quick best-effort estimate
 *  that ignores those — the user sees a close-enough number while filling the
 *  form, then the actual `total_days` on the response from the server. */
function approxDays(
  from: string,
  to: string,
  fromS: LeaveSessionValue,
  toS: LeaveSessionValue,
): number {
  if (!from || !to || from > to) return 0;
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  const diff = Math.floor((t.getTime() - f.getTime()) / 86_400_000) + 1;
  if (diff <= 0) return 0;
  if (diff === 1) {
    if (fromS === "Full" || toS === "Full") return 1;
    if (fromS === toS) return 0.5;
    return 1; // 1st half + 2nd half on same date = full
  }
  let d = diff;
  if (fromS !== "Full") d -= 0.5;
  if (toS !== "Full") d -= 0.5;
  return d;
}

export default function ApplyLeaveModal({
  open,
  profile,
  selectedOrg,
  onClose,
  onSubmit,
}: Props) {
  const [requestType, setRequestType] = useState<LeaveRequestTypeValue>("Leave");
  const [from, setFrom] = useState(TODAY);
  const [to, setTo] = useState(TODAY);
  const [fromSession, setFromSession] = useState<LeaveSessionValue>("Full");
  const [toSession, setToSession] = useState<LeaveSessionValue>("Full");
  const [reason, setReason] = useState("");
  const [org, setOrg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const orgOptions = useMemo(() => profile?.orgs ?? [], [profile]);

  useEffect(() => {
    if (!open) return;
    setRequestType("Leave");
    setFrom(TODAY);
    setTo(TODAY);
    setFromSession("Full");
    setToSession("Full");
    setReason("");
    setErr(null);
    if (selectedOrg) setOrg(selectedOrg);
    else if (orgOptions.length === 1) setOrg(orgOptions[0].uid);
    else setOrg("");
  }, [open, orgOptions, selectedOrg]);

  if (!open) return null;

  const days = approxDays(from, to, fromSession, toSession);
  const canSubmit =
    !!from && !!to && from <= to && reason.trim().length > 0 && !!org && !busy;

  const submit = async (): Promise<void> => {
    if (!profile) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        user: profile.id,
        org,
        from_date: from,
        to_date: to,
        from_session: fromSession,
        to_session: toSession,
        reason: reason.trim(),
        request_type: requestType,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Apply Leave/WFH</h3>
        {err && (
          <div
            style={{
              background: "#fee2e2",
              color: "#dc2626",
              padding: 8,
              borderRadius: 6,
              marginBottom: 10,
              fontSize: 13,
            }}
          >
            {err}
          </div>
        )}
        <Row label="Type">
          <div style={{ display: "flex", gap: 6 }}>
            {REQUEST_TYPES.map((t) => {
              const active = requestType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRequestType(t)}
                  disabled={busy}
                  style={{
                    padding: "6px 14px",
                    background: active ? "#2563eb" : "#fff",
                    color: active ? "#fff" : "#475569",
                    border: `1px solid ${active ? "#2563eb" : "#cbd5e1"}`,
                    borderRadius: 6,
                    cursor: busy ? "not-allowed" : "pointer",
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </Row>
        {orgOptions.length > 1 && (
          <Row label="Organisation">
            <select
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              style={inp}
              disabled={busy}
            >
              <option value="">— pick one —</option>
              {orgOptions.map((o) => (
                <option key={o.uid} value={o.uid}>
                  {o.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={inp}
            disabled={busy}
          />
          <select
            value={fromSession}
            onChange={(e) => setFromSession(e.target.value as LeaveSessionValue)}
            style={{ ...inp, width: 130 }}
            disabled={busy}
          >
            {SESSIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
        <Row label="To">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={inp}
            disabled={busy}
          />
          <select
            value={toSession}
            onChange={(e) => setToSession(e.target.value as LeaveSessionValue)}
            style={{ ...inp, width: 130 }}
            disabled={busy}
          >
            {SESSIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Reason">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            style={{ ...inp, fontFamily: "inherit", resize: "vertical" }}
            disabled={busy}
            autoFocus
          />
        </Row>
        <div style={{ fontSize: 12, color: "#475569", margin: "6px 0 14px" }}>
          ~ <strong>{days}</strong> {requestType === "WFH" ? "WFH" : "leave"} day(s)
          {" "}(server skips holidays + Sundays in the final count).
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={btnSecondary}>
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => {
              void submit();
            }}
            style={btnPrimary}
          >
            {busy ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
