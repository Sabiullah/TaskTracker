import { useState } from "react";
import ModalWrap from "@/components/ui/ModalWrap";
import { useMasters } from "@/hooks/useMasters";
import { TODAY, fmtDate } from "@/utils/date";
import type { QuickPunchPayload } from "@/hooks/useAttendance";

export type PunchState = "in" | "out" | "done";

interface PunchConfirmModalProps {
  punchState: PunchState;
  punching: boolean;
  onConfirm: (payload?: QuickPunchPayload) => void;
  onClose: () => void;
}

/**
 * "Are you sure?" dialog for punch in/out, shared by the Attendance page
 * header button and the global mobile FAB. Punch-in additionally asks
 * where the user works from today: Office proceeds as-is, Client requires
 * picking a client (stored as work_location="Client Site" + a
 * "Client: <name>" remark).
 */
export default function PunchConfirmModal({
  punchState,
  punching,
  onConfirm,
  onClose,
}: PunchConfirmModalProps) {
  const { clients } = useMasters();
  const [loc, setLoc] = useState<"Office" | "Client Site">("Office");
  const [clientName, setClientName] = useState("");

  const isPunchIn = punchState === "in";
  const needsClient = isPunchIn && loc === "Client Site" && !clientName;

  const clientOptions = clients
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b));

  const handleYes = (): void => {
    if (!isPunchIn) {
      onConfirm();
      return;
    }
    onConfirm(
      loc === "Client Site"
        ? { work_location: "Client Site", remarks: `Client: ${clientName}` }
        : { work_location: "Office" },
    );
  };

  const segBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    minHeight: 40,
    border: active ? "2px solid #2563eb" : "1px solid #e2e8f0",
    borderRadius: 10,
    background: active ? "#eff6ff" : "#fff",
    color: active ? "#1d4ed8" : "#475569",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  });

  return (
    <ModalWrap
      onClose={() => !punching && onClose()}
      anchor="center"
      cardStyle={{
        width: 340,
        padding: "26px 22px 20px",
        borderRadius: 16,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 44, lineHeight: 1 }}>
        {punchState === "out" ? "🔴" : punchState === "done" ? "✅" : "🟢"}
      </div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 800,
          color: "#0f172a",
          margin: "12px 0 6px",
        }}
      >
        {punchState === "in" && "Are you sure you want to Punch In?"}
        {punchState === "out" && "Are you sure you want to Punch Out?"}
        {punchState === "done" &&
          "You already punched out. Update your punch-out time?"}
      </div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
        {fmtDate(TODAY)} ·{" "}
        {new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </div>

      {isPunchIn && (
        <div style={{ marginBottom: 16, textAlign: "left" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              marginBottom: 6,
            }}
          >
            Working from
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setLoc("Office")}
              style={segBtn(loc === "Office")}
            >
              🏢 Office
            </button>
            <button
              onClick={() => setLoc("Client Site")}
              style={segBtn(loc === "Client Site")}
            >
              🤝 Client
            </button>
          </div>
          {loc === "Client Site" && (
            <select
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              style={{
                marginTop: 8,
                width: "100%",
                minHeight: 40,
                padding: "6px 10px",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                fontSize: 13,
                background: "#fff",
                boxSizing: "border-box",
              }}
            >
              <option value="">Select a client…</option>
              {clientOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onClose}
          disabled={punching}
          style={{
            flex: 1,
            minHeight: 44,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            background: "#f8fafc",
            color: "#475569",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          No
        </button>
        <button
          onClick={handleYes}
          disabled={punching || needsClient}
          title={needsClient ? "Select a client first" : undefined}
          style={{
            flex: 1,
            minHeight: 44,
            border: "none",
            borderRadius: 10,
            background: punchState === "out" ? "#dc2626" : "#16a34a",
            color: "#fff",
            fontWeight: 800,
            fontSize: 14,
            cursor: "pointer",
            opacity: punching || needsClient ? 0.6 : 1,
          }}
        >
          {punching
            ? "Please wait…"
            : punchState === "out"
              ? "Yes, Punch Out"
              : punchState === "done"
                ? "Yes, Update"
                : "Yes, Punch In"}
        </button>
      </div>
    </ModalWrap>
  );
}
