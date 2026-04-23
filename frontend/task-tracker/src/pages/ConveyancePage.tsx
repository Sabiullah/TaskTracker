import { useState } from "react";

import type { Profile } from "@/types";

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

  return (
    <div className="p-4">
      <div role="tablist" className="flex gap-2 border-b mb-4">
        <button
          role="tab"
          aria-selected={tab === "transactions"}
          onClick={() => setTab("transactions")}
          className={tab === "transactions" ? "tab-active" : ""}
        >
          Transactions
        </button>
        {isManagerOrAdminAnywhere && (
          <>
            <button
              role="tab"
              aria-selected={tab === "employeeTotals"}
              onClick={() => setTab("employeeTotals")}
              className={tab === "employeeTotals" ? "tab-active" : ""}
            >
              Employee Totals
            </button>
            <button
              role="tab"
              aria-selected={tab === "clientTotals"}
              onClick={() => setTab("clientTotals")}
              className={tab === "clientTotals" ? "tab-active" : ""}
            >
              Client Totals
            </button>
          </>
        )}
      </div>
      <div>
        {tab === "transactions" && (
          <div className="text-sm text-gray-500">
            Transactions tab — coming in Task 25.
          </div>
        )}
        {tab === "employeeTotals" && (
          <div className="text-sm text-gray-500">
            Employee Totals — coming in Task 30.
          </div>
        )}
        {tab === "clientTotals" && (
          <div className="text-sm text-gray-500">
            Client Totals — coming in Task 30.
          </div>
        )}
      </div>
    </div>
  );
}
