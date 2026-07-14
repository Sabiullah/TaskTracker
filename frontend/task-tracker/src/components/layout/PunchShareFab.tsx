import { useState } from "react";
import WhatsAppIcon from "@/components/ui/WhatsAppIcon";
import PunchConfirmModal from "@/components/attendance/PunchConfirmModal";
import { useAttendance, type QuickPunchPayload } from "@/hooks/useAttendance";
import {
  buildAttendanceShareText,
  openWhatsAppShare,
} from "@/utils/attendanceShare";
import { TODAY } from "@/utils/date";
import type { Profile } from "@/types";

interface PunchShareFabProps {
  profile: Profile | null;
  profiles?: Profile[];
  selectedOrg?: string;
}

/**
 * Mobile-only floating pill fixed at the bottom-right of every page:
 * left half punches in/out (with an "Are you sure?" confirm that also asks
 * Office vs Client), right half shares today's attendance to WhatsApp.
 * Hidden on desktop via CSS.
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

  const doPunch = async (payload?: QuickPunchPayload): Promise<void> => {
    setPunching(true);
    try {
      await quickPunch(payload);
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
        <PunchConfirmModal
          punchState={punchState}
          punching={punching}
          onConfirm={(payload) => {
            void doPunch(payload);
          }}
          onClose={() => setConfirmPunch(false)}
        />
      )}
    </>
  );
}
