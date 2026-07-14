import { useState } from "react";
import ModalWrap from "@/components/ui/ModalWrap";
import WhatsAppIcon from "@/components/ui/WhatsAppIcon";
import { useAttendance } from "@/hooks/useAttendance";
import {
  buildAttendanceShareText,
  openWhatsAppShare,
} from "@/utils/attendanceShare";
import { TODAY, fmtDate } from "@/utils/date";
import type { Profile } from "@/types";

interface PunchShareFabProps {
  profile: Profile | null;
  profiles?: Profile[];
  selectedOrg?: string;
}

/**
 * Mobile-only floating pill fixed at the bottom-right of every page:
 * left half punches in/out (with an "Are you sure?" confirm), right half
 * shares today's attendance to WhatsApp. Hidden on desktop via CSS.
 */
export default function PunchShareFab({
  profile,
  profiles = [],
  selectedOrg,
}: PunchShareFabProps) {
  const { records, quickPunch } = useAttendance(profile, profiles, selectedOrg);
  const [confirmPunch, setConfirmPunch] = useState(false);
  const [punching, setPunching] = useState(false);

  const myName = profile?.full_name ?? "";
  const todayRecord = records.find(
    (r) => r.employee_name === myName && r.date === TODAY,
  );

  const punchState: "in" | "out" | "done" = !todayRecord
    ? "in"
    : !todayRecord.logout_time
      ? "out"
      : "done";
  const punchLabel =
    punchState === "in"
      ? "Punch In"
      : punchState === "out"
        ? "Punch Out"
        : "Done ✓";

  const doPunch = async (): Promise<void> => {
    setPunching(true);
    try {
      await quickPunch();
      setConfirmPunch(false);
    } finally {
      setPunching(false);
    }
  };

  if (!profile) return null;

  return (
    <>
      <div className="att-punch-fab att-fab-split">
        <button
          className={`att-fab-half att-fab-punch att-punch-fab--${punchState}`}
          onClick={() => setConfirmPunch(true)}
          aria-label={punchLabel}
        >
          {punchLabel}
        </button>
        <button
          className="att-fab-half att-fab-share"
          onClick={() =>
            openWhatsAppShare(buildAttendanceShareText(records, TODAY, myName))
          }
          aria-label="Share today's attendance on WhatsApp"
          title="Share today's attendance on WhatsApp"
        >
          <WhatsAppIcon size={17} />
        </button>
      </div>

      {confirmPunch && (
        <ModalWrap
          onClose={() => !punching && setConfirmPunch(false)}
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
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 18 }}>
            {fmtDate(TODAY)} ·{" "}
            {new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setConfirmPunch(false)}
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
              onClick={() => {
                void doPunch();
              }}
              disabled={punching}
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
                opacity: punching ? 0.6 : 1,
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
      )}
    </>
  );
}
