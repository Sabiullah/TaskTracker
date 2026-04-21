import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import ClientRoadmapTab from "@/components/clients/ClientRoadmapTab";
import ClientMOMTab from "@/components/clients/ClientMOMTab";
import OverdueActionPointsPanel from "@/components/clients/OverdueActionPointsPanel";
import type { Profile } from "@/types/auth";

interface ClientsPageProps {
  profile: Profile | null;
  profiles: Profile[];
  selectedOrg: string | null;
}

type SubTab = "roadmap" | "mom" | "overdue";

export default function ClientsPage({ profile, profiles, selectedOrg }: ClientsPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const canWrite = isAdminInAny() || isManagerInAny();
  const { clients } = useMasters();
  const { overdue } = useOverdueActionPoints();
  const [subTab, setSubTab] = useState<SubTab>("roadmap");
  const [selectedClientUid, setSelectedClientUid] = useState<string>("");

  const scopedClients = useMemo(
    () =>
      selectedOrg
        ? clients.filter((c) => c.orgs.includes(selectedOrg))
        : clients,
    [clients, selectedOrg],
  );

  return (
    <div style={{ padding: 16 }}>
      {/* Top strip: client selector + overdue card */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Client</label>
        <select
          value={selectedClientUid}
          onChange={(e) => setSelectedClientUid(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 240 }}
        >
          <option value="">— Select a client —</option>
          {scopedClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setSubTab("overdue")}
          style={{
            marginLeft: "auto",
            padding: "8px 14px",
            background: overdue.length ? "#fee2e2" : "#f1f5f9",
            color: overdue.length ? "#b91c1c" : "#475569",
            border: `1px solid ${overdue.length ? "#fecaca" : "#e2e8f0"}`,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ⚠ {overdue.length} overdue action point{overdue.length === 1 ? "" : "s"}
        </button>
      </div>

      {/* Sub-tab bar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          background: "#f1f5f9",
          padding: 4,
          borderRadius: 8,
          width: "fit-content",
          marginBottom: 12,
        }}
      >
        {(
          [
            { id: "roadmap", label: "🗺️ Road Map" },
            { id: "mom", label: "📋 MOM & Action Points" },
            { id: "overdue", label: "⚠ Overdue" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
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

      {subTab === "roadmap" && (
        <ClientRoadmapTab
          clientUid={selectedClientUid}
          profiles={profiles}
          canWrite={canWrite}
        />
      )}
      {subTab === "mom" && (
        <ClientMOMTab
          clientUid={selectedClientUid}
          profile={profile}
          profiles={profiles}
          canWrite={canWrite}
        />
      )}
      {subTab === "overdue" && (
        <OverdueActionPointsPanel
          onSelectMeeting={(meetingUid) => {
            // Clicking a meeting row: stay in Overdue tab. Deep-linking to the
            // MOM tab for a specific meeting could be added later.
            void meetingUid;
          }}
        />
      )}
    </div>
  );
}
