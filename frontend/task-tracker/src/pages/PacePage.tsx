import { useEffect, useState } from "react";
import PaceMeetingsPage from "@/pages/PaceMeetingsPage";
import PaceGoalsPage from "@/pages/PaceGoalsPage";
import PaceChecklistPage from "@/pages/PaceChecklistPage";
import PaceClientClassPage from "@/pages/PaceClientClassPage";
import DailyStandupPage from "@/pages/DailyStandupPage";
import type { Profile } from "@/types/auth";

import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";

interface PacePageProps {
  profile: Profile | null;
  profiles: Profile[];
  /** Header-selected org uid. Empty string = "All". */
  selectedOrg: string;
}

export default function PacePage({
  profile,
  profiles,
  selectedOrg,
}: PacePageProps) {
  const { isAdminInAny } = useAuth();
  const { canView } = usePermissions(selectedOrg || undefined);
  const [subTab, setSubTab] = useState("meetings");
  const isAdmin = isAdminInAny();

  const tabs = [
    ...(canView("pace.meetings")
      ? [{ id: "meetings", label: "📋 Meetings" }]
      : []),
    ...(canView("pace.standup")
      ? [{ id: "daily-standup", label: "📋 Daily Standup" }]
      : []),
    ...(canView("pace.goals") ? [{ id: "goals", label: "🎯 Goals" }] : []),
    ...(canView("pace.classification")
      ? [{ id: "clients", label: "🏢 Client Classification" }]
      : []),
    ...(isAdmin && canView("pace.checklist")
      ? [{ id: "checklist", label: "✅ Checklist" }]
      : []),
  ];

  const tabIds = tabs.map((t) => t.id).join(",");
  useEffect(() => {
    const ids = tabIds ? tabIds.split(",") : [];
    if (ids.length > 0 && !ids.includes(subTab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded one-shot fallback when the active tab loses visibility
      setSubTab(ids[0]);
    }
  }, [tabIds, subTab]);

  return (
    <div>
      {/* Sub-tab bar */}
      <div
        className="wl-subtab-bar"
        style={{
          display: "flex",
          gap: 6,
          background: "#f1f5f9",
          padding: 4,
          borderRadius: 8,
          margin: "10px 16px 0",
          width: "fit-content",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: "7px 18px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: subTab === t.id ? "#fff" : "transparent",
              color: subTab === t.id ? "#1e293b" : "#64748b",
              boxShadow: subTab === t.id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "meetings" && (
        <PaceMeetingsPage
          profile={profile}
          profiles={profiles}
          selectedOrg={selectedOrg}
        />
      )}
      {subTab === "daily-standup" && (
        <DailyStandupPage
          profile={profile}
          profiles={profiles}
          selectedOrg={selectedOrg}
        />
      )}
      {subTab === "goals" && (
        <PaceGoalsPage profile={profile} profiles={profiles} />
      )}
      {subTab === "clients" && <PaceClientClassPage profile={profile} />}
      {subTab === "checklist" && isAdmin && (
        <PaceChecklistPage profile={profile} />
      )}
    </div>
  );
}
