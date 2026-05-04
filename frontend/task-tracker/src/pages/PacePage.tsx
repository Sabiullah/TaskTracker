import { useState } from "react";
import PaceMeetingsPage from "@/pages/PaceMeetingsPage";
import PaceGoalsPage from "@/pages/PaceGoalsPage";
import PaceChecklistPage from "@/pages/PaceChecklistPage";
import PaceClientClassPage from "@/pages/PaceClientClassPage";
import type { Profile } from "@/types/auth";

import { useAuth } from "@/hooks/useAuth";

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
  const [subTab, setSubTab] = useState("meetings");
  const isAdmin = isAdminInAny();

  const tabs = [
    { id: "meetings", label: "📋 Meetings" },
    { id: "goals", label: "🎯 Goals" },
    { id: "clients", label: "🏢 Client Classification" },
    ...(isAdmin ? [{ id: "checklist", label: "✅ Checklist" }] : []),
  ];

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
