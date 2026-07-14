import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useMasters } from "@/hooks/useMasters";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import { useClientsBadgeCounts } from "@/hooks/useClientsBadgeCounts";
import ClientRoadmapTab from "@/components/clients/ClientRoadmapTab";
import ClientMOMTab from "@/components/clients/ClientMOMTab";
import ClientInternalReportTab from "@/components/clients/ClientInternalReportTab";
import ClientMonthlyReportTab from "@/components/clients/ClientMonthlyReportTab";
import { filterOverdue } from "@/components/clients/overdueFilters";
import type { Profile } from "@/types/auth";

interface ClientsPageProps {
  profile: Profile | null;
  profiles: Profile[];
  selectedOrg: string | null;
}

type SubTab = "roadmap" | "mom" | "internal" | "monthly";

export default function ClientsPage({ profile, profiles, selectedOrg }: ClientsPageProps) {
  const { isAdminInAny, isManagerInAny, isAdminIn, isManagerIn } = useAuth();
  const { canView } = usePermissions(selectedOrg ?? undefined);
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

  // Approver check for observation reports: a manager or admin in the org.
  // Drives the "pending my approval" share of the Internal Report badge so any
  // org manager — not only the assigned one — sees pending reports.
  const canApproveVisitFor = useMemo(
    () => (orgUid: string | null) => (orgUid ? isManagerIn(orgUid) : isManagerInAny()),
    [isManagerIn, isManagerInAny],
  );

  // Mounts its own copies of useClientMeetings / useOverdueActionPoints
  // (the page already mounts them above for scopedOverdue). The duplicate
  // fetch is deliberate per the design; both sides stay in sync via WS.
  const subTabCounts = useClientsBadgeCounts({
    myUid: profile?.id ?? null,
    isAdminFor,
    canApproveVisitFor,
    selectedOrg,
    clientUid: effectiveClientUid || null,
  });

  const scopedOverdue = useMemo(
    () => filterOverdue(overdue, meetings, selectedOrg, effectiveClientUid),
    [overdue, meetings, selectedOrg, effectiveClientUid],
  );

  const viewableTabs = useMemo(
    () =>
      (
        [
          { id: "roadmap", label: "🗺️ Road Map", code: "clients.roadmap", count: subTabCounts.roadmapOverdue, ariaNoun: "overdue items" },
          { id: "mom", label: "📋 MOM & Action Points", code: "clients.mom", count: subTabCounts.momOverdue, ariaNoun: "overdue items" },
          { id: "internal", label: "📝 Observation Report", code: "clients.observation", count: subTabCounts.internalCombined, ariaNoun: "overdue or pending items" },
          { id: "monthly", label: "📅 Internal Audit Report", code: "clients.audit", count: 0, ariaNoun: "items" },
        ] as const
      ).filter((t) => canView(t.code)),
    [canView, subTabCounts.roadmapOverdue, subTabCounts.momOverdue, subTabCounts.internalCombined],
  );

  // Fall back to the first viewable tab when the active one is hidden by perms.
  useEffect(() => {
    if (viewableTabs.length && !viewableTabs.some((t) => t.id === subTab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded one-shot fallback when the active tab loses visibility
      setSubTab(viewableTabs[0].id);
    }
  }, [viewableTabs, subTab]);

  return (
    <div className="cl-page" style={{ padding: 16 }}>
      {/* Top strip: client selector + overdue card */}
      <div
        className="cl-topstrip"
        style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}
      >
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
        className="cl-subtabs"
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
        {viewableTabs.map((t) => (
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
                aria-label={`${t.count} ${t.ariaNoun}`}
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
      {subTab === "monthly" && (
        <ClientMonthlyReportTab
          clientUid={effectiveClientUid}
          selectedOrg={selectedOrg}
          profile={profile}
          profiles={profiles}
        />
      )}
    </div>
  );
}
