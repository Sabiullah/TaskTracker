import { useState, useMemo } from "react";
import {
  isOverdue,
  STATUS_CFG,
  thS,
  tdS,
  MONTH_SHORT,
} from "@/utils/invoice";
import { fmtDate, formatMonthLabel as fmtMonth } from "@/utils/date";
import { fmtMoney } from "@/utils/money";
import InvoiceActionModal from "./InvoiceActionModal";
import type {
  InvoiceEntry,
  InvoicePlan,
  InvoiceStatus,
  Profile,
} from "@/types";

interface InvoicesTabProps {
  entries: InvoiceEntry[];
  plans: InvoicePlan[];
  fyMonths: string[];
  isAdmin: boolean;
  profile: Profile | null;
  onRefresh: () => void;
  onAmountEdit: (
    entry: InvoiceEntry,
    plan: InvoicePlan,
    month: string,
  ) => void;
}

interface ActiveInvoice {
  entry: InvoiceEntry;
  plan: InvoicePlan;
  group: InvoiceEntry[];
}

/* Status priority: Pending(0) is worst, Approved(3) is best */
const ST_PRIORITY: Record<InvoiceStatus, number> = {
  Pending: 0,
  Rejected: 1,
  Uploaded: 2,
  Approved: 3,
};

export default function InvoicesTab({
  entries,
  plans,
  fyMonths,
  isAdmin,
  profile,
  onRefresh,
  onAmountEdit,
}: InvoicesTabProps) {
  const [fStatus, setFStatus] = useState("");
  const [fClient, setFClient] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [active, setActive] = useState<ActiveInvoice | null>(null);
  const planMap = useMemo<Record<string, InvoicePlan>>(
    () => Object.fromEntries(plans.map((p) => [p.id, p])),
    [plans],
  );
  const clients = useMemo(
    () => [...new Set(entries.map((e) => e.client_name))].sort(),
    [entries],
  );
  const fyEntries = useMemo(
    () => entries.filter((e) => fyMonths.includes(e.invoice_month)),
    [entries, fyMonths],
  );
  const overdueCnt = fyEntries.filter(isOverdue).length;

  const filtered = useMemo(
    () =>
      fyEntries
        .filter((e) => !fClient || e.client_name === fClient)
        .filter((e) => !fMonth || e.invoice_month === fMonth)
        .filter(
          (e) =>
            !fStatus ||
            (fStatus === "Overdue" ? isOverdue(e) : e.status === fStatus),
        )
        .sort((a, b) =>
          (a.invoice_date ?? "") < (b.invoice_date ?? "") ? -1 : 1,
        ),
    [fyEntries, fClient, fMonth, fStatus],
  );

  /* Group filtered entries by client+month — one row per group (one invoice per client per month) */
  const groupedFiltered = useMemo(() => {
    const map: Record<string, InvoiceEntry[]> = {};
    const order: string[] = [];
    filtered.forEach((e) => {
      const key = `${e.client_name}|${e.invoice_month}`;
      if (!map[key]) {
        map[key] = [];
        order.push(key);
      }
      map[key].push(e);
    });
    return order.map((key) => {
      const group = map[key];
      const [clientName, invoiceMonth] = key.split("|");
      /* Combined unique job descriptions joined with + */
      const jobDesc = group
        .map((e) => planMap[e.plan_id]?.job_description)
        .filter((v): v is string => Boolean(v))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" + ");
      /* Summed amount */
      const totalAmt = group.reduce(
        (s, e) => s + Number(e.amount || 0),
        0,
      );
      /* Worst-status entry is the primary action target */
      const primaryEntry = group.reduce(
        (w, e) => (ST_PRIORITY[e.status] <= ST_PRIORITY[w.status] ? e : w),
        group[0],
      );
      /* Earliest invoice date */
      const invoiceDate =
        group.map((e) => e.invoice_date ?? "").sort()[0] ?? "";
      /* Unique invoice numbers */
      const invNums = [
        ...new Set(
          group
            .map((e) => e.invoice_number)
            .filter((v): v is string => Boolean(v)),
        ),
      ].join(", ");
      /* Any uploaded file */
      const withFile = group.find((e) => e.file_name);
      const hasOverdueGroup = group.some((e) => isOverdue(e));
      return {
        key,
        clientName,
        invoiceMonth,
        jobDesc,
        totalAmt,
        primaryEntry,
        invoiceDate,
        invNums,
        withFile,
        hasOverdueGroup,
        group,
      };
    });
  }, [filtered, planMap]);

  const clearAll = () => {
    setFStatus("");
    setFClient("");
    setFMonth("");
  };
  const hasFilter = fStatus || fClient || fMonth;
  const fs = {
    padding: "4px 8px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 5,
    fontSize: 12,
    background: "#fff",
    color: "#374151",
  };

  /* Totals derived from grouped rows */
  const filteredTotal = groupedFiltered.reduce((s, g) => s + g.totalAmt, 0);
  const filteredApproved = groupedFiltered
    .filter((g) => g.primaryEntry.status === "Approved")
    .reduce((s, g) => s + g.totalAmt, 0);
  const filteredPending = groupedFiltered
    .filter((g) => ["Pending", "Uploaded"].includes(g.primaryEntry.status))
    .reduce((s, g) => s + g.totalAmt, 0);
  const filteredRejected = groupedFiltered
    .filter((g) => g.primaryEntry.status === "Rejected")
    .reduce((s, g) => s + g.totalAmt, 0);

  return (
    <div>
      {/* Filter bar — single row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "nowrap",
        }}
      >
        {overdueCnt > 0 && (
          <span
            onClick={() => {
              setFStatus("Overdue");
              setFMonth("");
            }}
            style={{
              background: "#fef2f2",
              color: "#dc2626",
              padding: "3px 10px",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 700,
              border: "1px solid #fecaca",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ⚠️ {overdueCnt} Overdue
          </span>
        )}
        <select
          value={fMonth}
          onChange={(e) => setFMonth(e.target.value)}
          style={{ ...fs, flex: "1 1 130px", minWidth: 0 }}
        >
          <option value="">All Months</option>
          {fyMonths.map((m, i) => (
            <option key={m} value={m}>
              {MONTH_SHORT[i]} {m.slice(0, 4)}
            </option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          style={{ ...fs, flex: "1 1 130px", minWidth: 0 }}
        >
          <option value="">All Statuses</option>
          <option value="Overdue">⚠️ Overdue</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.icon} {k}
            </option>
          ))}
        </select>
        <select
          value={fClient}
          onChange={(e) => setFClient(e.target.value)}
          style={{ ...fs, flex: "1 1 150px", minWidth: 0 }}
        >
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            onClick={clearAll}
            style={{
              padding: "4px 10px",
              border: "1px solid #fecaca",
              borderRadius: 5,
              background: "#fff1f2",
              cursor: "pointer",
              fontSize: 11,
              color: "#dc2626",
              fontWeight: 700,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ✕ Clear
          </button>
        )}
        <span
          style={{
            fontSize: 11,
            color: "#94a3b8",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {groupedFiltered.length} invoice
          {groupedFiltered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Summary strip when filtered */}
      {hasFilter && groupedFiltered.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 10,
            padding: "8px 14px",
            background: "#f8fafc",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "#64748b" }}>Filtered Total:</span>
          <span style={{ fontWeight: 800, color: "#2563eb" }}>
            {fmtMoney(filteredTotal)}
          </span>
          <span style={{ color: "#16a34a", fontWeight: 700 }}>
            ✅ Approved: {fmtMoney(filteredApproved)}
          </span>
          <span style={{ color: "#d97706", fontWeight: 700 }}>
            ⏳ Pending: {fmtMoney(filteredPending)}
          </span>
          {filteredRejected > 0 && (
            <span style={{ color: "#dc2626", fontWeight: 700 }}>
              ❌ Rejected: {fmtMoney(filteredRejected)}
            </span>
          )}
        </div>
      )}

      {groupedFiltered.length === 0 ? (
        <div style={{ color: "#94a3b8", textAlign: "center", padding: 30 }}>
          No invoices found.
        </div>
      ) : (
        <div className="sticky-table-wrap">
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr>
                {[
                  "#",
                  "Client",
                  "Job Description",
                  "Month",
                  "Invoice Date",
                  "Inv. No.",
                  "Amount",
                  "Status",
                  "File",
                  "Actions",
                ].map((h) => (
                  <th key={h} style={thS}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedFiltered.map(
                (
                  {
                    key,
                    clientName,
                    invoiceMonth,
                    jobDesc,
                    totalAmt,
                    primaryEntry,
                    invoiceDate,
                    invNums,
                    withFile,
                    hasOverdueGroup,
                    group,
                  },
                  idx,
                ) => {
                  /* Synthetic plan carries combined job description for the action modal */
                  const syntheticPlan = {
                    ...planMap[primaryEntry.plan_id],
                    client_name: clientName,
                    job_description: jobDesc,
                  };
                  const od = hasOverdueGroup;
                  const st =
                    STATUS_CFG[primaryEntry.status] || STATUS_CFG.Pending;
                  return (
                    <tr
                      key={key}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: od ? "#fff7ed" : "white",
                      }}
                    >
                      <td style={{ ...tdS, color: "#94a3b8" }}>{idx + 1}</td>
                      <td style={{ ...tdS, fontWeight: 700 }}>{clientName}</td>
                      <td style={{ ...tdS, maxWidth: 200, color: "#475569" }}>
                        {jobDesc || "—"}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        {fmtMonth(invoiceMonth)}
                      </td>
                      <td
                        style={{
                          ...tdS,
                          whiteSpace: "nowrap",
                          color: od ? "#dc2626" : "#374151",
                          fontWeight: od ? 700 : 400,
                        }}
                      >
                        {fmtDate(invoiceDate)} {od ? "⚠️" : ""}
                      </td>
                      <td style={{ ...tdS, color: "#64748b" }}>
                        {invNums || "—"}
                      </td>
                      {/* Amount cell with inline edit button */}
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 700, color: "#16a34a" }}>
                          {fmtMoney(totalAmt)}
                        </span>
                        {isAdmin && (
                          <button
                            onClick={() =>
                              onAmountEdit(
                                primaryEntry,
                                syntheticPlan,
                                invoiceMonth,
                              )
                            }
                            title="Edit amount"
                            style={{
                              marginLeft: 6,
                              padding: "1px 5px",
                              border: "1px solid #e2e8f0",
                              borderRadius: 4,
                              background: "#f8fafc",
                              cursor: "pointer",
                              fontSize: 10,
                              color: "#64748b",
                              verticalAlign: "middle",
                            }}
                          >
                            ✏️
                          </button>
                        )}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            background: st.bg,
                            color: st.color,
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {st.icon} {primaryEntry.status}
                        </span>
                      </td>
                      <td style={tdS}>
                        {withFile ? (
                          <span style={{ fontSize: 11, color: "#2563eb" }}>
                            📎 {withFile.file_name}
                          </span>
                        ) : (
                          <span style={{ color: "#cbd5e1", fontSize: 11 }}>
                            —
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() =>
                            setActive({
                              entry: { ...primaryEntry, amount: totalAmt },
                              plan: syntheticPlan,
                              group,
                            })
                          }
                          style={{
                            padding: "4px 10px",
                            border: "1px solid #bfdbfe",
                            background: "#eff6ff",
                            borderRadius: 5,
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#2563eb",
                          }}
                        >
                          {primaryEntry.status === "Pending" ||
                          primaryEntry.status === "Rejected"
                            ? "📤 Upload"
                            : isAdmin && primaryEntry.status === "Uploaded"
                              ? "✅ Review"
                              : "👁 View"}
                        </button>
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
            {/* Total footer row */}
            {groupedFiltered.length > 1 && (
              <tfoot>
                <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                  <td colSpan={6} style={{ ...tdS, color: "#374151" }}>
                    Total ({groupedFiltered.length} invoices)
                  </td>
                  <td
                    style={{ ...tdS, color: "#16a34a", whiteSpace: "nowrap" }}
                  >
                    {fmtMoney(filteredTotal)}
                  </td>
                  <td
                    colSpan={3}
                    style={{ ...tdS, fontSize: 11, color: "#64748b" }}
                  >
                    ✅ {fmtMoney(filteredApproved)}
                    &nbsp; ⏳ {fmtMoney(filteredPending)}
                    {filteredRejected > 0 && (
                      <>&nbsp; ❌ {fmtMoney(filteredRejected)}</>
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {active && (
        <InvoiceActionModal
          entry={active.entry}
          plan={active.plan}
          group={active.group}
          planMap={planMap}
          isAdmin={isAdmin}
          profile={profile}
          onClose={() => setActive(null)}
          onRefresh={() => {
            setActive(null);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

// ── Main InvoicePage ───────────────────────────────────────────────────────────
