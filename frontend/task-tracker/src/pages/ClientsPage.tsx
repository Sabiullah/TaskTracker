import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import { useClientsBadgeCounts } from "@/hooks/useClientsBadgeCounts";
import ClientRoadmapTab from "@/components/clients/ClientRoadmapTab";
import ClientMOMTab from "@/components/clients/ClientMOMTab";
import ClientInternalReportTab from "@/components/clients/ClientInternalReportTab";
import { filterOverdue } from "@/components/clients/overdueFilters";
import type { Profile } from "@/types/auth";

interface ClientsPageProps {
  profile: Profile | null;
  profiles: Profile[];
  selectedOrg: string | null;
}

type SubTab = "roadmap" | "mom" | "internal";

export default function ClientsPage({ profile, profiles, selectedOrg }: ClientsPageProps) {
  const { isAdminInAny, isManagerInAny, isAdminIn } = useAuth();
  const canWrite = isAdminInAny() || isManagerInAny();
  const { clients } = useMasters();
  const { overdue } = useOverdueActionPoints();
  // Needed by filterOverdue to scope the page-header overdue counter to the
  // selected org/client. MOM views fetch their own meeting lists separately.
  const { meetings } = useClientMeetings();
  const [subTab, setSubTab] = useState<SubTab>("roadmap");
  const [selectedClientUid, setSelectedClientUid] = useState<string>("");

  const scopedClients = useMemo(
    () =>
      selectedOrg
        ? clients.filter((c) => c.orgs.includes(selectedOrg))
        : clients,
    [clients, selectedOrg],
  );

  // If the user switches org and the previously selected client isn't in the
  // new org's client list, fall back to "All clients" — but keep the original
  // state so switching back restores the prior selection. Derive instead of
  // sync (avoids the cascading-render anti-pattern).
  const effectiveClientUid = useMemo(
    () => (scopedClients.some((c) => c.id === selectedClientUid) ? selectedClientUid : ""),
    [scopedClients, selectedClientUid],
  );

  const isAdminFor = useMemo(
    () => (orgUid: string | null) => (orgUid ? isAdminIn(orgUid) : isAdminInAny()),
    [isAdminIn, isAdminInAny],
  );

  const subTabCounts = useClientsBadgeCounts({
    myUid: profile?.id ?? null,
    isAdminFor,
    selectedOrg,
    clientUid: effectiveClientUid || null,
  });

  const scopedOverdue = useMemo(
    () => filterOverdue(overdue, meetings, selectedOrg, effectiveClientUid),
    [overdue, meetings, selectedOrg, effectiveClientUid],
  );

  return (
    <div style={{ padding: 16 }}>
      {/* Top strip: client selector + overdue card */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Client</label>
        <select
          value={effectiveClientUid}
          onChange={(e) => setSelectedClientUid(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 240 }}
        >
          <option value="">All clients</option>
          {scopedClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setSubTab("mom")}
          style={{
            marginLeft: "auto",
            padding: "8px 14px",
            background: scopedOverdue.length ? "#fee2e2" : "#f1f5f9",
            color: scopedOverdue.length ? "#b91c1c" : "#475569",
            border: `1px solid ${scopedOverdue.length ? "#fecaca" : "#e2e8f0"}`,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ⚠ {scopedOverdue.length} overdue action point{scopedOverdue.length === 1 ? "" : "s"}
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
            { id: "roadmap", label: "🗺️ Road Map", count: subTabCounts.roadmapOverdue },
            { id: "mom", label: "📋 MOM & Action Points", count: subTabCounts.momOverdue },
            { id: "internal", label: "📝 Internal Report", count: subTabCounts.internalCombined },
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
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{t.label}</span>
            {t.count > 0 && (
              <span
                aria-label={`${t.count} overdue or pending items`}
                style={{
                  padding: "1px 6px",
                  background: "#dc2626",
                  color: "#fff",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1.4,
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {subTab === "roadmap" && (
        <ClientRoadmapTab
          clientUid={effectiveClientUid}
          selectedOrg={selectedOrg}
          profiles={profiles}
          canWrite={canWrite}
        />
      )}
      {subTab === "mom" && (
        <ClientMOMTab
          clientUid={effectiveClientUid}
          selectedOrg={selectedOrg}
          profile={profile}
          profiles={profiles}
          canWrite={canWrite}
        />
      )}
      {subTab === "internal" && (
        <ClientInternalReportTab
          clientUid={effectiveClientUid}
          selectedOrg={selectedOrg}
          profile={profile}
          profiles={profiles}
        />
      )}
    </div>
  );
}
