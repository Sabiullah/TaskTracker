import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ApiError,
  apiDelete,
  apiPatch,
  apiPost,
} from "@/lib/api";
import ScheduleTab from "@/components/invoice/ScheduleTab";
import SummaryTab from "@/components/invoice/SummaryTab";
import InvoicesTab from "@/components/invoice/InvoicesTab";
import PlanModal from "@/components/invoice/PlanModal";
import AmountEditModal from "@/components/invoice/AmountEditModal";
import InvoiceActionModal from "@/components/invoice/InvoiceActionModal";
import type {
  AmtModalState,
  InvModalState,
  InvoiceEntry,
  InvoicePlan,
  PlanForm,
  Profile,
} from "@/types";
import type {
  InvoiceEntryDto,
  InvoiceGenerateRequest,
  InvoiceGenerateResponse,
  InvoicePeriodicityValue,
  InvoicePlanCreate,
  InvoicePlanDto,
  InvoicePlanUpdate,
} from "@/types/api";
import {
  getCurrentFY,
  getFYMonths,
  getFYOptions,
  isOverdue,
} from "@/utils/invoice";
import { fmtMoney } from "@/utils/money";
import { useInvoices } from "@/hooks/useInvoices";
import { useMasters } from "@/hooks/useMasters";

import { useAuth } from "@/hooks/useAuth";

interface InvoicePageProps {
  profile: Profile | null;
  /** Header-org filter. Passed through to new-plan POSTs so the backend's
   *  ``resolve_create_org`` doesn't 400 with "you belong to multiple orgs"
   *  on users with 2+ memberships. */
  selectedOrg?: string;
}

type TabId = "schedule" | "summary" | "invoices";

const STATUS_PRIORITY: Readonly<Record<string, number>> = {
  Pending: 0,
  Rejected: 1,
  Uploaded: 2,
  Approved: 3,
};

export default function InvoicePage({
  profile,
  selectedOrg = "",
}: InvoicePageProps) {
  const { isAdminInAny } = useAuth();
  const [fy, setFy] = useState(getCurrentFY);
  const [tab, setTab] = useState<TabId>("schedule");
  const [planModal, setPlanModal] = useState<Partial<InvoicePlan> | null>(null);
  const [amtModal, setAmtModal] = useState<AmtModalState | null>(null);
  const [invModal, setInvModal] = useState<InvModalState | null>(null);

  const { plans, entries, loading, reload } = useInvoices();
  const { clients: clientMasters } = useMasters();

  const isAdmin = isAdminInAny();
  const fyMonths = useMemo(() => getFYMonths(fy), [fy]);

  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [clientMasters]);

  const handleSavePlan = useCallback(
    async (form: PlanForm): Promise<void> => {
      const clientUid = clientUidByName[form.client_name.trim()];
      if (!clientUid) {
        alert(
          `Client "${form.client_name}" not found in masters. Add it from the Masters page first.`,
        );
        return;
      }
      // The schedule form's month inputs (and our normalised dto fields)
      // both work in ``YYYY-MM``, but Django's DateField needs a full
      // ``YYYY-MM-DD`` — append day-1 before sending so the PATCH/POST
      // doesn't 400.
      const monthToDate = (m: string): string =>
        m && m.length === 7 ? `${m}-01` : m;
      // Plans live in one org. Prefer the header-selected org (that's
      // the user's active context), fall back to the client's primary
      // org for "All Orgs" views. Multi-org users MUST have at least
      // one of the two set — otherwise the backend returns
      // "org is required (you belong to multiple organisations)".
      // Using header-first also means a client shared across two orgs
      // doesn't randomly force the plan into whichever org happened to
      // win the single-FK race (a prior bug where plans were created in
      // the wrong org and generate later 403'd with "Not an admin of
      // the plan's organisation").
      const client = clientMasters.find((c) => c.id === clientUid);
      const clientOrgUid =
        client?.orgs && client.orgs.length ? client.orgs[0] : client?.org ?? null;
      const orgUid = selectedOrg || clientOrgUid || undefined;
      const base: InvoicePlanCreate = {
        client: clientUid,
        job_description: form.job_description.trim(),
        periodicity: form.periodicity as InvoicePeriodicityValue,
        start_month: monthToDate(form.start_month),
        end_month: form.end_month ? monthToDate(form.end_month) : undefined,
        invoice_day: Number(form.invoice_day),
        base_amount: Number(form.base_amount).toFixed(2),
        ...(orgUid ? { org: orgUid } : {}),
      };
      try {
        let saved: InvoicePlanDto;
        if (form.id) {
          const body: InvoicePlanUpdate = base;
          saved = await apiPatch<InvoicePlanDto>(
            `/invoice_plans/${form.id}/`,
            body,
          );
        } else {
          saved = await apiPost<InvoicePlanDto>("/invoice_plans/", base);
        }
        // Generate monthly entries server-side for the plan's range.
        const genReq: InvoiceGenerateRequest = { plan_uid: saved.uid };
        await apiPost<InvoiceGenerateResponse>(
          "/invoice_entries/generate/",
          genReq,
        );
        setPlanModal(null);
        await reload();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
      }
    },
    [clientUidByName, clientMasters, selectedOrg, reload],
  );

  const handleDeletePlan = useCallback(
    async (id: string): Promise<void> => {
      if (!window.confirm("Delete this invoice plan and all its entries?"))
        return;
      try {
        // Server cascades deletion of the entries tied to this plan.
        await apiDelete(`/invoice_plans/${id}/`);
        await reload();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Delete failed: ${msg}`);
      }
    },
    [reload],
  );

  const handleAmountSave = useCallback(
    async ({
      amount,
      scope,
      month,
    }: {
      amount: number;
      scope: string;
      month: string;
    }): Promise<void> => {
      if (!amtModal) return;
      const plan = amtModal.plan;
      if (!plan) return;
      const amountStr = amount.toFixed(2);
      const targets = entries.filter(
        (e) =>
          e.plan_id === plan.id &&
          (scope === "onwards"
            ? e.status === "Pending" && e.invoice_month >= month
            : e.invoice_month === month),
      );
      try {
        await Promise.all(
          targets.map((e) =>
            apiPatch<InvoiceEntryDto>(`/invoice_entries/${e.id}/`, {
              amount: amountStr,
            }),
          ),
        );
        setAmtModal(null);
        await reload();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Update failed: ${msg}`);
      }
    },
    [amtModal, entries, reload],
  );

  const fyEntries = useMemo(
    () => entries.filter((e) => fyMonths.includes(e.invoice_month)),
    [entries, fyMonths],
  );

  const stats = useMemo(() => {
    interface Group {
      primaryEntry: InvoiceEntry;
      totalAmt: number;
      grp: InvoiceEntry[];
    }
    const groupMap: Record<string, InvoiceEntry[]> = {};
    fyEntries.forEach((e) => {
      const key = `${e.client_name}|${e.invoice_month}`;
      if (!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(e);
    });
    const groups: Group[] = Object.values(groupMap).map((grp) => {
      const primaryEntry = grp.reduce(
        (w, e) =>
          (STATUS_PRIORITY[e.status] ?? 99) <=
          (STATUS_PRIORITY[w.status] ?? 99)
            ? e
            : w,
        grp[0],
      );
      const totalAmt = grp.reduce((s, e) => s + Number(e.amount || 0), 0);
      return { primaryEntry, totalAmt, grp };
    });
    const total = groups.length;
    const approved = groups.filter((g) => g.primaryEntry.status === "Approved");
    const pending = groups.filter((g) => g.primaryEntry.status === "Pending");
    const rejected = groups.filter((g) => g.primaryEntry.status === "Rejected");
    const overdue = groups.filter((g) => g.grp.some((e) => isOverdue(e)));
    const totalVal = groups.reduce((s, g) => s + g.totalAmt, 0);
    const approvedVal = approved.reduce((s, g) => s + g.totalAmt, 0);
    const rejectedVal = rejected.reduce((s, g) => s + g.totalAmt, 0);
    return {
      total,
      approved: approved.length,
      pending: pending.length,
      rejected: rejected.length,
      overdue: overdue.length,
      totalVal,
      approvedVal,
      rejectedVal,
    };
  }, [fyEntries]);

  const boxStyle: CSSProperties = {
    background: "#fff",
    borderRadius: 10,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 10,
  };

  const card = (
    color: string,
    n: ReactNode,
    label: string,
    sub?: string | null,
  ): ReactNode => (
    <div
      className="dm-stat-card"
      style={{
        background: "#fff",
        borderRadius: 8,
        padding: "8px 14px",
        borderTop: `3px solid ${color}`,
        boxShadow: "0 1px 4px rgba(0,0,0,.07)",
        minWidth: 100,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{n}</div>
      <div
        className="dm-stat-lbl"
        style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}
      >
        {label}
      </div>
      {sub && <div style={{ fontSize: 10, color, marginTop: 1 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ padding: "10px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div className="page-title">🧾 Invoice Tracker</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
            Financial Year:
          </label>
          <select
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            style={{
              padding: "5px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              color: "#2563eb",
            }}
          >
            {getFYOptions().map((f) => (
              <option key={f} value={f}>
                FY {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        {card("#2563eb", stats.total, "Total Invoices")}
        {card(
          "#16a34a",
          stats.approved,
          "Approved",
          stats.approvedVal ? fmtMoney(stats.approvedVal) : null,
        )}
        {card("#d97706", stats.pending, "Pending Upload")}
        {card("#dc2626", stats.overdue, "Overdue ⚠️")}
        {card(
          "#e11d48",
          stats.rejected,
          "Rejected ❌",
          stats.rejectedVal ? fmtMoney(stats.rejectedVal) : null,
        )}
        {stats.totalVal > 0 &&
          card("#7c3aed", fmtMoney(stats.totalVal), "Total Value FY")}
      </div>

      {/* Tabs */}
      <div
        className="dm-inv-tabbar"
        style={{
          display: "flex",
          gap: 0,
          marginBottom: 0,
          borderBottom: "2px solid #e2e8f0",
          background: "#fff",
          borderRadius: "10px 10px 0 0",
          padding: "0 4px",
        }}
      >
        {(
          [
            ["schedule", "📋 Schedule"],
            ["summary", "📊 Summary"],
            ["invoices", "🧾 Invoices"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: "9px 22px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              color: tab === id ? "#2563eb" : "#374151",
              borderBottom:
                tab === id ? "3px solid #2563eb" : "3px solid transparent",
              marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="dm-box"
        style={{
          ...boxStyle,
          marginTop: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
        }}
      >
        {tab === "schedule" && (
          <ScheduleTab
            plans={plans}
            entries={entries}
            fyMonths={fyMonths}
            loading={loading}
            isAdmin={isAdmin}
            onSavePlan={handleSavePlan}
            onDeletePlan={(id) => {
              void handleDeletePlan(id);
            }}
            onInvoiceClick={(entry, plan, month) => {
              if (entry) setInvModal({ entry, plan });
              else setAmtModal({ entry: null, plan, month });
            }}
          />
        )}
        {tab === "summary" && (
          <SummaryTab
            entries={entries}
            fyMonths={fyMonths}
            loading={loading}
          />
        )}
        {tab === "invoices" && (
          <InvoicesTab
            entries={entries}
            plans={plans}
            fyMonths={fyMonths}
            isAdmin={isAdmin}
            profile={profile}
            onRefresh={() => {
              void reload();
            }}
            onAmountEdit={(entry, plan, month) =>
              setAmtModal({ entry, plan, month })
            }
          />
        )}
      </div>

      {planModal !== null && (
        <PlanModal
          plan={planModal}
          onSave={(form) => handleSavePlan(form as PlanForm)}
          onClose={() => setPlanModal(null)}
        />
      )}
      {amtModal && (
        <AmountEditModal
          entry={amtModal.entry}
          baseAmount={amtModal.plan?.base_amount ?? null}
          month={amtModal.month}
          onSave={handleAmountSave}
          onClose={() => setAmtModal(null)}
        />
      )}
      {invModal && (
        <InvoiceActionModal
          entry={invModal.entry}
          plan={invModal.plan}
          group={null}
          planMap={null}
          isAdmin={isAdmin}
          profile={profile}
          onClose={() => setInvModal(null)}
          onRefresh={() => {
            setInvModal(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
