import { useMemo, useState } from "react";

import type { Profile } from "@/types";
import { useMasters } from "@/hooks/useMasters";
import { useProfiles } from "@/hooks/useProfiles";
import type { ListFilters } from "@/utils/conveyanceApi";

import ConveyanceTransactions from "../components/conveyance/ConveyanceTransactions";

type ConveyanceTab = "transactions" | "employeeTotals" | "clientTotals";

interface ConveyancePageProps {
  profile: Profile | null;
  isManagerOrAdminAnywhere: boolean;
}

export default function ConveyancePage({
  profile: _profile,
  isManagerOrAdminAnywhere,
}: ConveyancePageProps) {
  const [tab, setTab] = useState<ConveyanceTab>("transactions");
  const [filters, setFilters] = useState<ListFilters>({});

  const { clients } = useMasters();
  const { profiles } = useProfiles();

  // MasterItem uses `id` (a UID string) and `name`
  const clientOptions = useMemo(
    () =>
      clients.map((c) => ({
        uid: c.id,
        label: c.name,
      })),
    [clients],
  );

  // Profile uses `id` (a UID string), `full_name`, and `username`
  const employeeOptions = useMemo(
    () =>
      profiles.map((p) => ({
        uid: p.id,
        label: p.full_name || p.username,
      })),
    [profiles],
  );

  return (
    <div className="p-4">
      <div role="tablist" className="flex gap-2 border-b mb-4" style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        <button
          role="tab"
          aria-selected={tab === "transactions"}
          onClick={() => setTab("transactions")}
        >
          Transactions
        </button>
        {isManagerOrAdminAnywhere && (
          <>
            <button
              role="tab"
              aria-selected={tab === "employeeTotals"}
              onClick={() => setTab("employeeTotals")}
            >
              Employee Totals
            </button>
            <button
              role="tab"
              aria-selected={tab === "clientTotals"}
              onClick={() => setTab("clientTotals")}
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
          canFilterByEmployee={isManagerOrAdminAnywhere}
          employeeOptions={employeeOptions}
          clientOptions={clientOptions}
        />
      )}
      {tab === "employeeTotals" && (
        <div className="text-sm text-gray-500">Employee Totals — coming in Task 30.</div>
      )}
      {tab === "clientTotals" && (
        <div className="text-sm text-gray-500">Client Totals — coming in Task 30.</div>
      )}
    </div>
  );
}
