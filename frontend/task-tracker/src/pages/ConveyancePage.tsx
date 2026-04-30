import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { Profile } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useProfiles } from "@/hooks/useProfiles";
import type { ListFilters } from "@/utils/conveyanceApi";

import ConveyanceSummary from "../components/conveyance/ConveyanceSummary";
import ConveyanceTransactions from "../components/conveyance/ConveyanceTransactions";

type ConveyanceTab = "transactions" | "employeeTotals" | "clientTotals";

interface ConveyancePageProps {
  profile: Profile | null;
  /** True when the caller can see every employee's conveyance — admin or
   *  manager in any org, or has the per-org `conveyance_access` flag. */
  canViewAllConveyance: boolean;
  /** Header-selected org uid. Empty string = "All". */
  selectedOrg: string;
}

export default function ConveyancePage({
  profile: _profile,
  canViewAllConveyance,
  selectedOrg,
}: ConveyancePageProps) {
  const { profile, isAdminInAny, isManagerInAny } = useAuth();
  const [tab, setTab] = useState<ConveyanceTab>("transactions");
  const [filters, setFilters] = useState<ListFilters>({});

  const { clients } = useMasters();
  const { profiles } = useProfiles();

  // MasterItem uses `id` (a UID string) and `name`. We carry `orgs` through
  // so the create dialog can filter clients by the selected org.
  const clientOptions = useMemo(
    () =>
      clients.map((c) => ({
        uid: c.id,
        label: c.name,
        orgs: c.orgs,
      })),
    [clients],
  );

  // Sort is_default first so the dialog's fallback (orgOptions[0]) matches
  // the `pickDefaultOrg` behaviour the spec calls for, without exposing the
  // is_default flag itself to child components.
  const orgOptions = useMemo(() => {
    const orgs = profile?.orgs ?? [];
    const sorted = [...orgs].sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return 0;
    });
    return sorted.map((o) => ({ uid: o.uid, name: o.name }));
  }, [profile?.orgs]);

  // Profile uses `id` (a UID string), `full_name`, and `username`
  const employeeOptions = useMemo(
    () =>
      profiles.map((p) => ({
        uid: p.id,
        label: p.full_name || p.username,
      })),
    [profiles],
  );

  const tabPalette = {
    transactions: { active: "#2563eb", idle: "#dbeafe", text: "#1e3a8a" },
    employeeTotals: { active: "#059669", idle: "#d1fae5", text: "#064e3b" },
    clientTotals: { active: "#7c3aed", idle: "#ede9fe", text: "#4c1d95" },
  } as const;

  function tabStyle(key: ConveyanceTab): CSSProperties {
    const palette = tabPalette[key];
    const isActive = tab === key;
    return {
      padding: "6px 14px",
      border: "1px solid transparent",
      borderRadius: 6,
      cursor: "pointer",
      fontSize: 14,
      fontWeight: isActive ? 600 : 500,
      background: isActive ? palette.active : palette.idle,
      color: isActive ? "#fff" : palette.text,
      transition: "background 0.15s, color 0.15s",
    };
  }

  return (
    <div className="p-4">
      <div role="tablist" className="flex gap-2 border-b mb-4" style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #e5e7eb", paddingBottom: 8 }}>
        <button
          role="tab"
          aria-selected={tab === "transactions"}
          onClick={() => setTab("transactions")}
          style={tabStyle("transactions")}
        >
          Transactions
        </button>
        {canViewAllConveyance && (
          <>
            <button
              role="tab"
              aria-selected={tab === "employeeTotals"}
              onClick={() => setTab("employeeTotals")}
              style={tabStyle("employeeTotals")}
            >
              Employee Totals
            </button>
            <button
              role="tab"
              aria-selected={tab === "clientTotals"}
              onClick={() => setTab("clientTotals")}
              style={tabStyle("clientTotals")}
            >
              Client Totals
            </button>
          </>
        )}
      </div>
      {tab === "transactions" && (
        <ConveyanceTransactions
          filters={filters}
          onFiltersChange={setFilters}
          canFilterByEmployee={canViewAllConveyance}
          employeeOptions={employeeOptions}
          clientOptions={clientOptions}
          orgOptions={orgOptions}
          selectedOrg={selectedOrg}
          currentUserUid={profile?.id ?? ""}
          currentUserIsAdminInAny={isAdminInAny()}
          currentUserCanApprove={isManagerInAny()}
        />
      )}
      {tab === "employeeTotals" && (
        <ConveyanceSummary
          groupBy="employee"
          onDrillDown={(f) => {
            // Employee totals roll up every approved entry — claimable or
            // not — because the company reimburses the employee for all of
            // them. Drill-down should match.
            setFilters({ ...f, status: "approved" });
            setTab("transactions");
          }}
        />
      )}
      {tab === "clientTotals" && (
        <ConveyanceSummary
          groupBy="client"
          onDrillDown={(f) => {
            // Client totals only count claimable entries because those are
            // the ones invoiced back to the client.
            setFilters({ ...f, status: "approved", claimable: "true" });
            setTab("transactions");
          }}
        />
      )}
    </div>
  );
}
