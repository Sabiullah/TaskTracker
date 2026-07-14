import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Profile } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { useCosting } from "@/hooks/useCosting";
import { useMasters } from "@/hooks/useMasters";
import { useEmployees } from "@/hooks/useEmployees";
import { useSeatCostSetting } from "@/hooks/useSeatCostSetting";
import { useEmployeeSeatCosts } from "@/hooks/useEmployeeSeatCosts";
import { listCostingEntries } from "@/lib/api/costing";
import {
  computeProfitability,
  computeProfitabilityGrandTotal,
} from "@/utils/profitability";
import type { CostingEntryDto } from "@/types/api/costing";
import type { EmployeeSeatCostDto } from "@/types/api/seatCost";

interface CostingPageProps {
  profile: Profile | null;
  /** Header-org filter, threaded into new-entry POSTs the same way
   *  InvoicePage does — otherwise ``resolve_create_org`` 400s with
   *  "you belong to multiple orgs" for multi-org admins. */
  selectedOrg?: string;
}

interface RowFormState {
  designation: string;
  employee: string;
  hr_day: string;
  days_working: string;
}

const EMPTY_ROW: RowFormState = { designation: "", employee: "", hr_day: "", days_working: "" };

/** Mirrors the backend's `CostingEntry.save()` total computation
 *  (`core/costing/models.py`): total = hr_day * days_working. Kept in sync
 *  here purely for a live preview — the server always recomputes on save. */
function computeTotal(hrDay: string, daysWorking: string): string {
  const a = Number.parseFloat(hrDay) || 0;
  const b = Number.parseFloat(daysWorking) || 0;
  return (a * b).toFixed(2);
}

const thS: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};
const tdS: CSSProperties = {
  padding: "8px 12px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
};
const inpS: CSSProperties = {
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};
const labelS: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: ".5px",
};

export default function CostingPage({ profile, selectedOrg }: CostingPageProps) {
  const isAdmin = profile?.highest_role === "admin";
  const [activeTab, setActiveTab] = useState<
    "costing" | "seatCost" | "employeeSeatCost" | "profitability"
  >("costing");
  const { clients, designations } = useMasters();
  const { employees } = useEmployees();
  const [selectedClient, setSelectedClient] = useState<string>("");
  const { entries, loading, saving, createEntry, editEntry, removeEntry } = useCosting(
    selectedClient || null,
  );

  const [modal, setModal] = useState<{ row?: CostingEntryDto } | null>(null);
  const [form, setForm] = useState<RowFormState>(EMPTY_ROW);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  const designationName = useMemo(
    () => new Map(designations.map((d) => [d.id, d.name])),
    [designations],
  );

  // Same org resolution used when creating an entry (see handleSave) —
  // shared here so the "Name" dropdown only offers employees who belong to
  // the org this row will actually be saved under, matching the backend's
  // employee/org validation (CostingEntrySerializer.validate_employee).
  const activeOrgUid = useMemo(() => {
    if (modal?.row) return modal.row.org;
    const client = clients.find((c) => c.id === selectedClient);
    const clientOrgUid =
      client?.orgs && client.orgs.length ? client.orgs[0] : (client?.org ?? null);
    return selectedOrg || clientOrgUid || null;
  }, [modal, clients, selectedClient, selectedOrg]);

  const employeesInOrg = useMemo(
    () => (activeOrgUid ? employees.filter((e) => e.org === activeOrgUid) : employees),
    [employees, activeOrgUid],
  );

  const openAdd = (): void => {
    setForm(EMPTY_ROW);
    setModal({});
  };

  const openEdit = (row: CostingEntryDto): void => {
    setForm({
      designation: row.designation,
      employee: row.employee ?? "",
      hr_day: row.hr_day,
      days_working: row.days_working,
    });
    setModal({ row });
  };

  const closeModal = (): void => setModal(null);

  // Synchronous re-entrancy guard: `saving` (from useCosting) only becomes
  // true after this async function has already started, so a fast
  // double-click on "Add Row"/"Update" (or a double Enter keypress) could
  // fire handleSave twice before React re-renders the disabled button,
  // creating two identical rows. A ref check is immediate, unlike state.
  const isSavingRef = useRef(false);

  const handleSave = async (): Promise<void> => {
    if (isSavingRef.current) return;
    if (!selectedClient) {
      alert("Select a client first");
      return;
    }
    if (!form.designation) {
      alert("Designation is required");
      return;
    }
    isSavingRef.current = true;
    try {
      if (modal?.row) {
        await editEntry(modal.row.uid, {
          designation: form.designation,
          employee: form.employee || null,
          hr_day: form.hr_day || 0,
          days_working: form.days_working || 0,
        });
      } else {
        await createEntry({
          ...(activeOrgUid ? { org: activeOrgUid } : {}),
          client: selectedClient,
          designation: form.designation,
          employee: form.employee || null,
          hr_day: form.hr_day || 0,
          days_working: form.days_working || 0,
        });
      }
      closeModal();
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleDelete = async (row: CostingEntryDto): Promise<void> => {
    if (!window.confirm("Delete this costing row?")) return;
    setDeletingUid(row.uid);
    try {
      await removeEntry(row.uid);
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingUid(null);
    }
  };

  return (
    <div style={{ padding: "10px 16px", maxWidth: 1000, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div className="page-title">💰 Costing</div>
        {activeTab === "costing" && selectedClient && (
          <button
            onClick={openAdd}
            style={{
              padding: "7px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            + Add Row
          </button>
        )}
      </div>

      {isAdmin && (
        <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "2px solid #e2e8f0" }}>
          {(
            [
              ["costing", "Costing"],
              ["seatCost", "Seat Cost"],
              ["employeeSeatCost", "Employee Seat Cost"],
              ["profitability", "Profitability"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                padding: "8px 16px",
                background: "none",
                border: "none",
                borderBottom: activeTab === id ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: -2,
                color: activeTab === id ? "#2563eb" : "#64748b",
                fontWeight: activeTab === id ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "costing" && (
        <>
      <div
        className="dm-filter-bar"
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          border: "1px solid #e2e8f0",
        }}
      >
        <label style={{ ...labelS, marginBottom: 0 }}>Client</label>
        <select
          style={{ ...inpS, maxWidth: 260 }}
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
        >
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {!selectedClient && (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          Select a client to view costing.
        </div>
      )}

      {selectedClient && (
        <div
          className="sticky-table-wrap dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 4px rgba(0,0,0,.06)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...thS, width: 130 }}>Organization</th>
                <th style={{ ...thS, width: 140 }}>Name</th>
                <th style={thS}>Designation</th>
                <th style={{ ...thS, width: 110 }}>Hr/Day</th>
                <th style={{ ...thS, width: 140 }}>No. of Days Working</th>
                <th style={{ ...thS, width: 110 }}>Total</th>
                <th style={{ ...thS, width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                    No costing rows yet for this client.
                  </td>
                </tr>
              )}
              {!loading &&
                entries.map((row) => (
                  <tr key={row.uid}>
                    <td style={tdS}>{row.org_name ?? "—"}</td>
                    <td style={tdS}>{row.employee_detail?.employee_name ?? "—"}</td>
                    <td style={{ ...tdS, fontWeight: 600, color: "#1e293b" }}>
                      {row.designation_detail?.name ?? designationName.get(row.designation) ?? "—"}
                    </td>
                    <td style={tdS}>{row.hr_day}</td>
                    <td style={tdS}>{row.days_working}</td>
                    <td style={{ ...tdS, fontWeight: 700 }}>{row.total}</td>
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => openEdit(row)}
                        title="Edit"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 4px",
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => {
                          void handleDelete(row);
                        }}
                        title="Delete"
                        disabled={deletingUid === row.uid || saving}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 4px",
                          opacity: deletingUid === row.uid ? 0.5 : 1,
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            className="dm-modal-card"
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 28,
              minWidth: 380,
              maxWidth: 460,
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 18,
                  fontFamily: "var(--font-heading)",
                  color: "var(--txt)",
                }}
              >
                {modal.row ? "✏️ Edit Costing Row" : "➕ Add Costing Row"}
              </span>
              <button
                onClick={closeModal}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelS}>Designation *</label>
              <select
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
                style={inpS}
                autoFocus
              >
                <option value="">Select…</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelS}>Name</label>
              <select
                value={form.employee}
                onChange={(e) => setForm({ ...form, employee: e.target.value })}
                style={inpS}
              >
                <option value="">— None —</option>
                {employeesInOrg.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_name}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                marginBottom: 16,
              }}
            >
              <div>
                <label style={labelS}>Hr/Day</label>
                <input
                  type="number"
                  value={form.hr_day}
                  onChange={(e) => setForm({ ...form, hr_day: e.target.value })}
                  style={inpS}
                />
              </div>
              <div>
                <label style={labelS}>No. of Days Working</label>
                <input
                  type="number"
                  value={form.days_working}
                  onChange={(e) => setForm({ ...form, days_working: e.target.value })}
                  style={inpS}
                />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelS}>Total (auto-computed)</label>
              <input
                readOnly
                value={computeTotal(form.hr_day, form.days_working)}
                style={{ ...inpS, background: "#f8fafc", color: "#64748b" }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={closeModal}
                style={{
                  padding: "8px 18px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={saving}
                style={{
                  padding: "8px 18px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : modal.row ? "Update" : "Add Row"}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {isAdmin && activeTab === "seatCost" && <SeatCostTab orgUid={selectedOrg} />}
      {isAdmin && activeTab === "employeeSeatCost" && <EmployeeSeatCostTab />}
      {isAdmin && activeTab === "profitability" && <ProfitabilityTab />}
    </div>
  );
}

function SeatCostTab({ orgUid: headerOrgUid }: { orgUid?: string }) {
  const { orgs } = useAuth();
  // The header org filter ("All / OrgA / OrgB") only pins a single org when
  // the admin has clicked a specific chip. When it's "All" (empty string)
  // and the admin is multi-org, seat cost editing is inherently
  // per-org — fall back to a picker scoped to this tab so every org's
  // setting stays independently viewable/editable, never just the first.
  const [localOrgUid, setLocalOrgUid] = useState<string>("");
  const needsPicker = !headerOrgUid && orgs.length > 1;
  const effectiveOrgUid = headerOrgUid || localOrgUid || orgs[0]?.uid || "";

  const { setting, loading, saving, save } = useSeatCostSetting(effectiveOrgUid || null);
  const [amount, setAmount] = useState<string>("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local input from freshly-fetched (or org-switched) setting
    setAmount(setting ? setting.monthly_amount : "");
  }, [setting]);

  const handleSave = async (): Promise<void> => {
    try {
      await save(amount || 0);
      alert("Seat cost saved.");
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (loading) return <div style={{ padding: 30, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: 24, maxWidth: 360 }}>
      {needsPicker && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelS}>Organization</label>
          <select
            value={effectiveOrgUid}
            onChange={(e) => setLocalOrgUid(e.target.value)}
            style={inpS}
          >
            {orgs.map((org) => (
              <option key={org.uid} value={org.uid}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <label style={labelS}>Monthly Seat Cost</label>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={inpS}
      />
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: "8px 18px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function EmployeeSeatCostTab() {
  const { employees } = useEmployees();
  const { entries, loading, saving, createEntry, editEntry, removeEntry } = useEmployeeSeatCosts();
  const [modal, setModal] = useState<{ row?: EmployeeSeatCostDto } | null>(null);
  const [form, setForm] = useState<{ employee: string; amount: string }>({ employee: "", amount: "" });
  const isSavingRef = useRef(false);

  const openAdd = (): void => {
    setForm({ employee: "", amount: "" });
    setModal({});
  };

  const openEdit = (row: EmployeeSeatCostDto): void => {
    setForm({ employee: row.employee, amount: row.monthly_amount });
    setModal({ row });
  };

  const handleSave = async (): Promise<void> => {
    if (isSavingRef.current) return;
    if (!form.employee) {
      alert("Select an employee");
      return;
    }
    isSavingRef.current = true;
    try {
      if (modal?.row) {
        await editEntry(modal.row.uid, { monthly_amount: form.amount || 0 });
      } else {
        await createEntry({ employee: form.employee, monthly_amount: form.amount || 0 });
      }
      setModal(null);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleDelete = async (row: EmployeeSeatCostDto): Promise<void> => {
    if (!window.confirm("Delete this seat cost override?")) return;
    await removeEntry(row.uid);
  };

  return (
    <div>
      <div style={{ marginBottom: 12, textAlign: "right" }}>
        <button
          onClick={openAdd}
          style={{
            padding: "7px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          + Add Override
        </button>
      </div>
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thS}>Employee</th>
              <th style={{ ...thS, width: 140 }}>Seat Cost</th>
              <th style={{ ...thS, width: 90 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={3} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={3} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                  No overrides yet.
                </td>
              </tr>
            )}
            {!loading &&
              entries.map((row) => (
                <tr key={row.uid}>
                  <td style={tdS}>{row.employee_detail?.employee_name ?? "—"}</td>
                  <td style={tdS}>{row.monthly_amount}</td>
                  <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => openEdit(row)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => void handleDelete(row)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setModal(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 14, padding: 28, minWidth: 340 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 16 }}>
              <label style={labelS}>Employee *</label>
              <select
                value={form.employee}
                onChange={(e) => setForm({ ...form, employee: e.target.value })}
                style={inpS}
                disabled={!!modal.row}
              >
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelS}>Monthly Seat Cost *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                style={inpS}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setModal(null)} style={{ padding: "8px 18px", cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                style={{
                  padding: "8px 18px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {saving ? "Saving…" : modal.row ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfitabilityTab() {
  const { employees, salaries, loading: employeesLoading } = useEmployees();
  // Every org the admin can see, unfiltered — a multi-org admin's employee
  // list spans several orgs, so each employee's own org default must be
  // looked up individually (see computeProfitability) rather than
  // collapsing to a single setting.
  const { settings: seatCostSettings, loading: seatCostLoading } = useSeatCostSetting(null);
  const { entries: seatCostOverrides, loading: overridesLoading } = useEmployeeSeatCosts();
  const [allCostingEntries, setAllCostingEntries] = useState<CostingEntryDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off the fetch's loading state on mount
    setLoading(true);
    listCostingEntries()
      .then((rows) => {
        if (!cancelled) setAllCostingEntries(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => computeProfitability(allCostingEntries, employees, salaries, seatCostSettings, seatCostOverrides),
    [allCostingEntries, employees, salaries, seatCostSettings, seatCostOverrides],
  );
  const grandTotal = useMemo(() => computeProfitabilityGrandTotal(rows), [rows]);

  const isLoading = loading || employeesLoading || seatCostLoading || overridesLoading;
  if (isLoading) return <div style={{ padding: 30, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thS}>Employee</th>
            <th style={{ ...thS, width: 110 }}>Client Value</th>
            <th style={{ ...thS, width: 100 }}>Salary</th>
            <th style={{ ...thS, width: 100 }}>Seat Cost</th>
            <th style={{ ...thS, width: 100 }}>Total Cost</th>
            <th style={{ ...thS, width: 100 }}>Profit</th>
            <th style={{ ...thS, width: 90 }}>Margin %</th>
            <th style={{ ...thS, width: 110 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                No employees with Costing entries or seat cost overrides yet.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.employeeId}>
              <td style={{ ...tdS, fontWeight: 600 }}>
                {row.employeeName}
                {!row.hasSalary && (
                  <span style={{ color: "#dc2626", fontSize: 11, marginLeft: 6 }}>(No salary on file)</span>
                )}
              </td>
              <td style={tdS}>{row.clientValue.toFixed(2)}</td>
              <td style={tdS}>{row.salary.toFixed(2)}</td>
              <td style={tdS}>{row.seatCost.toFixed(2)}</td>
              <td style={tdS}>{row.cost.toFixed(2)}</td>
              <td style={tdS}>{row.profit.toFixed(2)}</td>
              <td style={tdS}>{row.marginPct.toFixed(1)}%</td>
              <td style={tdS}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    background:
                      row.status === "Profitable" ? "#16a34a" : row.status === "Loss" ? "#dc2626" : "#d97706",
                  }}
                >
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
              <td style={tdS}>Grand Total</td>
              <td style={tdS}>{grandTotal.clientValue.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.salary.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.seatCost.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.cost.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.profit.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.marginPct.toFixed(1)}%</td>
              <td style={tdS}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
