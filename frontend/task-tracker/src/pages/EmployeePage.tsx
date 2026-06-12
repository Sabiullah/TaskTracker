import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  STATUS_LIST,
  STATUS_CFG,
  thS,
  tdS,
  inpS,
  BLANK_EMP,
  BLANK_SAL,
} from "@/utils/employee";
import { fmtDate } from "@/utils/date";
import { fmtMoney } from "@/utils/money";
import EmpModal from "@/components/employee/EmpModal";
import SalaryModal from "@/components/employee/SalaryModal";
import type { Employee, SalaryRecord } from "@/types";
import { useEmployees } from "@/hooks/useEmployees";
import { openAuthenticatedFile, ApiError } from "@/lib/api";
import EmployeeApprovalsTab from "@/components/employee/EmployeeApprovalsTab";
import EmployeeLeaveTab from "@/components/employee/EmployeeLeaveTab";
import { useApprovalsBadge } from "@/hooks/useApprovalsBadge";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import AttendanceMatrixView from "@/components/attendance/AttendanceMatrixView";
import AttendancePage from "@/pages/AttendancePage";
import type { Profile } from "@/types";

type SubTab = "personal" | "salary" | "leave" | "matrix" | "attendance" | "approvals";

interface EmployeePageProps {
  profile?: Profile | null;
  profiles?: Profile[];
  selectedOrg?: string;
}

export default function EmployeePage({
  profile: profileProp,
  profiles = [],
  selectedOrg,
}: EmployeePageProps = {}) {
  const {
    employees,
    salaries,
    loading,
    saveEmployee,
    deleteEmployee,
    saveSalary,
    deleteSalary,
  } = useEmployees();

  const [subTab, setSubTab] = useState<SubTab>("personal");

  // Maps each sub-tab to its permission-catalog code. A tab only renders when
  // canView(code) is true (admins always pass).
  const TAB_CODES: Record<SubTab, string> = {
    personal: "employee.personal",
    salary: "employee.salary",
    leave: "employee.leave",
    matrix: "employee.matrix",
    attendance: "employee.attendance_log",
    approvals: "employee.approvals",
  };

  const { isManagerInAny, isAdminInAny, hasAccessInAny, profile: authProfile, orgs } =
    useAuth();
  const { canView } = usePermissions(selectedOrg);
  const profile = profileProp ?? authProfile ?? null;
  // Approvals stays admin/manager-only — the employee_access flag deliberately
  // does NOT grant Leave/WFH approval.
  const showApprovalsTab = isManagerInAny();
  const approvalsCount = useApprovalsBadge();

  // Sub-tabs the current user may see: base tabs gated by their view
  // permission, plus Approvals which additionally requires manager/admin.
  const viewableTabs = useMemo<SubTab[]>(() => {
    const base: SubTab[] = ["personal", "salary", "leave", "matrix", "attendance"];
    const tabs = base.filter((t) => canView(TAB_CODES[t]));
    if (showApprovalsTab && canView(TAB_CODES.approvals)) tabs.push("approvals");
    return tabs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, showApprovalsTab]);

  // If the active sub-tab is no longer viewable, fall back to the first allowed.
  useEffect(() => {
    if (viewableTabs.length > 0 && !viewableTabs.includes(subTab)) {
      setSubTab(viewableTabs[0]);
    }
  }, [viewableTabs, subTab]);

  const [empModal, setEmpModal] = useState<"add" | "edit" | null>(null);
  const [salModal, setSalModal] = useState<"add" | "edit" | null>(null);
  const [empForm, setEmpForm] = useState<Record<string, unknown>>({
    ...BLANK_EMP,
  });
  const [salForm, setSalForm] = useState<Record<string, unknown>>({
    ...BLANK_SAL,
  });
  const [addressProof, setAddressProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [fStatus, setFStatus] = useState("");
  const [fSearch, setFSearch] = useState("");

  // Org picked in the create modal. Seeded from the header filter when the
  // modal opens; empty means "let the backend decide" (only works when the
  // caller has exactly one org membership). Without this, multi-org admins
  // hit ``resolve_create_org`` 400 — "you belong to multiple organisations".
  const [createOrgUid, setCreateOrgUid] = useState<string>(selectedOrg ?? "");
  const orgOptions = useMemo(
    () => orgs.map((o) => ({ uid: o.uid, name: o.name })),
    [orgs],
  );

  // canEdit gates Add/Edit/Delete employee buttons. Admins always qualify;
  // so do users granted the per-org employee_access flag, which makes them
  // admin-equivalent inside the Employee Management module.
  const isEmployeeAdmin = isAdminInAny() || hasAccessInAny("employee_access");
  const canEdit = isEmployeeAdmin;

  // Role-based row scoping for Personal Info + Salary tables:
  //   admin / employee_access → every employee (no filter)
  //   manager                 → self + direct reports (via Profile.manager_ids)
  //   employee                → only self
  // Backend enforces the same scoping; this is the UI mirror.
  const myName = profile?.full_name ?? "";
  const allowedNames = useMemo<Set<string> | null>(() => {
    if (isAdminInAny() || hasAccessInAny("employee_access")) return null;
    const names = new Set<string>();
    if (myName) names.add(myName);
    if (isManagerInAny() && profile) {
      for (const p of profiles) {
        if ((p.manager_ids ?? []).includes(profile.id) && p.full_name) {
          names.add(p.full_name);
        }
      }
    }
    return names;
  }, [isAdminInAny, hasAccessInAny, isManagerInAny, profile, profiles, myName]);

  const scopedEmployees = useMemo(
    () =>
      allowedNames === null
        ? employees
        : employees.filter((e) => allowedNames.has(e.employee_name)),
    [employees, allowedNames],
  );
  const scopedSalaries = useMemo(
    () =>
      allowedNames === null
        ? salaries
        : salaries.filter((s) => allowedNames.has(s.employee_name)),
    [salaries, allowedNames],
  );

  const filtered = useMemo(
    () =>
      scopedEmployees
        .filter((e) => !fStatus || e.status === fStatus)
        .filter((e) => {
          if (!fSearch) return true;
          const q = fSearch.toLowerCase();
          return (
            (e.employee_name || "").toLowerCase().includes(q) ||
            (e.phone || "").includes(q) ||
            (e.email || "").toLowerCase().includes(q)
          );
        }),
    [scopedEmployees, fStatus, fSearch],
  );

  const stats = useMemo(
    () => ({
      total: scopedEmployees.length,
      active: scopedEmployees.filter((e) => e.status === "Active").length,
      inactive: scopedEmployees.filter((e) => e.status === "Inactive").length,
      resigned: scopedEmployees.filter((e) => e.status === "Resigned").length,
    }),
    [scopedEmployees],
  );

  const openAddEmp = (): void => {
    setEmpForm({ ...BLANK_EMP });
    setAddressProof(null);
    // Re-seed the org picker from the header so toggling orgs in the
    // header is reflected in fresh create modals.
    setCreateOrgUid(selectedOrg ?? "");
    setEmpModal("add");
  };
  const openEditEmp = (emp: Employee): void => {
    setEmpForm({ ...emp } as Record<string, unknown>);
    setAddressProof(null);
    setEmpModal("edit");
  };

  const saveEmp = async (): Promise<void> => {
    // Creating in a multi-org account requires an explicit org. Edits don't
    // (the row already belongs to an org) — only gate the create path.
    if (empModal === "add" && orgs.length > 1 && !createOrgUid) {
      alert(
        "Pick an organisation for this employee (either from the header filter or the Org dropdown in the form).",
      );
      return;
    }
    setSaving(true);
    const ok = await saveEmployee(
      empForm as Partial<Employee>,
      empModal === "edit" ? "edit" : "add",
      addressProof,
      createOrgUid,
    );
    setSaving(false);
    if (ok) {
      setEmpModal(null);
      setAddressProof(null);
    }
  };

  const deleteEmp = async (id: string): Promise<void> => {
    await deleteEmployee(id);
  };

  const openAddSal = (): void => {
    setSalForm({ ...BLANK_SAL });
    setSalModal("add");
  };
  const openEditSal = (sal: SalaryRecord): void => {
    setSalForm({ ...sal } as Record<string, unknown>);
    setSalModal("edit");
  };

  const saveSal = async (): Promise<void> => {
    setSaving(true);
    const ok = await saveSalary(
      salForm as Partial<SalaryRecord>,
      salModal === "edit" ? "edit" : "add",
      employees,
    );
    setSaving(false);
    if (ok) setSalModal(null);
  };

  const deleteSal = async (id: string): Promise<void> => {
    await deleteSalary(id);
  };

  const cardS = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 16px",
    borderTop: `3px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.07)",
    minWidth: 90,
    textAlign: "center",
  });

  return (
    <div style={{ padding: "10px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div className="page-title">👥 Employee Management</div>
        <div style={{ display: "flex", gap: 8 }}>
          {subTab === "personal" && canEdit && (
            <button
              onClick={openAddEmp}
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
              + Add Employee
            </button>
          )}
          {subTab === "salary" && canEdit && (
            <button
              onClick={openAddSal}
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
              + Add Salary
            </button>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div
        className="wl-subtab-bar"
        style={{
          display: "flex",
          gap: 6,
          background: "#f1f5f9",
          padding: 4,
          borderRadius: 8,
          marginBottom: 12,
          width: "fit-content",
        }}
      >
        {(() => {
          const allTabs: ReadonlyArray<readonly [SubTab, string]> = [
            ["personal", "👤 Personal Info"],
            ["salary", "💰 Salary"],
            ["leave", "🏖️ Leave"],
            ["matrix", "📊 Matrix"],
            ["attendance", "🕐 Attendance Log"],
            ...(showApprovalsTab
              ? ([["approvals", `✅ Approvals${approvalsCount > 0 ? ` (${approvalsCount})` : ""}`]] as const)
              : []),
          ];
          // Only show tabs the user has "view" permission on (admins pass).
          const tabs = allTabs.filter(([id]) => canView(TAB_CODES[id]));
          return tabs.map(([id, lbl]) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                background: subTab === id ? "#fff" : "transparent",
                color: subTab === id ? "#1e293b" : "#64748b",
                boxShadow: subTab === id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
              }}
            >
              {lbl}
            </button>
          ));
        })()}
      </div>

      {/* Stats + Filters: admin-only management header strip.
          Managers and Employees still see the page (sub-tabs, My Attendance,
          Leave, Matrix), but the company-wide employee counts and
          search/filter row are management surfaces and stay hidden. */}
      {canEdit && (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {[
              { l: "Total", v: stats.total, c: "#2563eb" },
              { l: "Active", v: stats.active, c: "#16a34a" },
              { l: "Inactive", v: stats.inactive, c: "#d97706" },
              { l: "Resigned", v: stats.resigned, c: "#dc2626" },
            ].map((s) => (
              <div key={s.l} className="dm-stat-card" style={cardS(s.c)}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>
                  {s.v}
                </div>
                <div
                  style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}
                >
                  {s.l}
                </div>
              </div>
            ))}
          </div>

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
              flexWrap: "wrap",
            }}
          >
            <input
              type="text"
              placeholder="Search name, phone, email…"
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              style={{ ...inpS, maxWidth: 220 }}
            />
            <select
              style={{ ...inpS, maxWidth: 130 }}
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
            >
              <option value="">All Status</option>
              {STATUS_LIST.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span
              style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}
            >
              {filtered.length} employees
            </span>
          </div>
        </>
      )}

      {/* Personal Info tab */}
      {subTab === "personal" &&
        (loading ? (
          <div
            style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}
          >
            Loading…
          </div>
        ) : (
          <div
            className="sticky-table-wrap dm-box"
            style={{
              background: "#fff",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  <th style={{ ...thS, width: 36 }}>#</th>
                  <th style={thS}>Name</th>
                  <th style={{ ...thS, width: 100 }}>Phone</th>
                  <th style={{ ...thS, width: 160 }}>Email</th>
                  <th style={{ ...thS, width: 80 }}>Gender</th>
                  <th style={{ ...thS, width: 80 }}>DOB</th>
                  <th style={{ ...thS, width: 80 }}>Blood</th>
                  <th style={{ ...thS, width: 200 }}>Address</th>
                  <th style={{ ...thS, width: 60 }}>ID Proof</th>
                  <th style={{ ...thS, width: 130 }}>Emergency Contact</th>
                  <th style={{ ...thS, width: 130 }}>Reference</th>
                  <th style={{ ...thS, width: 80 }}>Status</th>
                  {canEdit && <th style={{ ...thS, width: 70 }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={canEdit ? 13 : 12}
                      style={{
                        ...tdS,
                        textAlign: "center",
                        padding: 30,
                        color: "#94a3b8",
                      }}
                    >
                      No employees found.
                    </td>
                  </tr>
                )}
                {filtered.map((e, i) => {
                  const sc = STATUS_CFG[e.status] || STATUS_CFG.Active;
                  return (
                    <tr
                      key={e.id}
                      onMouseEnter={(ev) =>
                        (ev.currentTarget.style.background = "#f8fafc")
                      }
                      onMouseLeave={(ev) =>
                        (ev.currentTarget.style.background = "")
                      }
                    >
                      <td
                        style={{ ...tdS, color: "#94a3b8", fontSize: 11 }}
                      >
                        {i + 1}
                      </td>
                      <td
                        style={{
                          ...tdS,
                          fontWeight: 600,
                          color: "#1e293b",
                        }}
                      >
                        {e.employee_name}
                      </td>
                      <td style={{ ...tdS, fontSize: 12 }}>
                        {e.phone || "—"}
                      </td>
                      <td style={{ ...tdS, fontSize: 12 }}>
                        {e.email || "—"}
                      </td>
                      <td style={{ ...tdS, fontSize: 12 }}>
                        {e.gender || "—"}
                      </td>
                      <td style={{ ...tdS, fontSize: 12 }}>
                        {fmtDate(e.date_of_birth)}
                      </td>
                      <td style={{ ...tdS, fontSize: 12 }}>
                        {e.blood_group || "—"}
                      </td>
                      <td
                        style={{
                          ...tdS,
                          fontSize: 11,
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={e.permanent_address ?? undefined}
                      >
                        {e.permanent_address || "—"}
                      </td>
                      <td style={{ ...tdS, textAlign: "center" }}>
                        {e.address_proof_url ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await openAuthenticatedFile(
                                  e.address_proof_url!,
                                );
                              } catch (err) {
                                const msg =
                                  err instanceof ApiError
                                    ? err.message
                                    : String(err);
                                alert(`Could not open file: ${msg}`);
                              }
                            }}
                            style={{
                              fontSize: 11,
                              color: "#2563eb",
                              fontWeight: 600,
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              textDecoration: "underline",
                              padding: 0,
                            }}
                          >
                            📎 View
                          </button>
                        ) : (
                          <span
                            style={{ fontSize: 10, color: "#94a3b8" }}
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td style={{ ...tdS, fontSize: 11 }}>
                        {e.emergency_contact_name
                          ? `${e.emergency_contact_name} (${e.emergency_contact_phone || ""})`
                          : "—"}
                      </td>
                      <td style={{ ...tdS, fontSize: 11 }}>
                        {e.reference_name
                          ? `${e.reference_name} (${e.reference_contact || ""})`
                          : "—"}
                      </td>
                      <td style={tdS}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 10,
                            fontWeight: 700,
                            background: sc.bg,
                            color: sc.color,
                          }}
                        >
                          {e.status}
                        </span>
                      </td>
                      {canEdit && (
                        <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => openEditEmp(e)}
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
                              void deleteEmp(e.id);
                            }}
                            title="Delete"
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: 14,
                              padding: "2px 4px",
                            }}
                          >
                            🗑️
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {/* Salary tab */}
      {subTab === "salary" && (
        <div
          className="sticky-table-wrap dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 4px rgba(0,0,0,.06)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 36 }}>#</th>
                <th style={thS}>Employee</th>
                <th style={{ ...thS, width: 100 }}>DOJ</th>
                <th style={{ ...thS, width: 130 }}>Designation</th>
                <th style={{ ...thS, width: 100 }}>Department</th>
                <th style={{ ...thS, width: 100 }}>Fixed Salary</th>
                <th style={{ ...thS, width: 90 }}>Basic</th>
                <th style={{ ...thS, width: 80 }}>HRA</th>
                <th style={{ ...thS, width: 80 }}>DA</th>
                <th style={{ ...thS, width: 90 }}>Allowances</th>
                <th style={{ ...thS, width: 100 }}>PF No.</th>
                <th style={{ ...thS, width: 100 }}>Effective</th>
                {canEdit && <th style={{ ...thS, width: 70 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {scopedSalaries.length === 0 && (
                <tr>
                  <td
                    colSpan={canEdit ? 13 : 12}
                    style={{
                      ...tdS,
                      textAlign: "center",
                      padding: 30,
                      color: "#94a3b8",
                    }}
                  >
                    No salary records. Click &quot;+ Add Salary&quot; to create one.
                  </td>
                </tr>
              )}
              {scopedSalaries.map((s, i) => (
                <tr
                  key={s.id}
                  onMouseEnter={(ev) =>
                    (ev.currentTarget.style.background = "#f8fafc")
                  }
                  onMouseLeave={(ev) =>
                    (ev.currentTarget.style.background = "")
                  }
                >
                  <td style={{ ...tdS, color: "#94a3b8", fontSize: 11 }}>
                    {i + 1}
                  </td>
                  <td
                    style={{
                      ...tdS,
                      fontWeight: 600,
                      color: "#1e293b",
                    }}
                  >
                    {s.employee_name}
                  </td>
                  <td style={{ ...tdS, fontSize: 12 }}>
                    {fmtDate(s.date_of_joining)}
                  </td>
                  <td style={{ ...tdS, fontSize: 12 }}>
                    {s.designation || "—"}
                  </td>
                  <td style={{ ...tdS, fontSize: 12 }}>
                    {s.department || "—"}
                  </td>
                  <td
                    style={{
                      ...tdS,
                      fontWeight: 700,
                      color: "#16a34a",
                    }}
                  >
                    {fmtMoney(s.fixed_salary)}
                  </td>
                  <td style={{ ...tdS, fontSize: 12 }}>
                    {fmtMoney(s.basic_salary)}
                  </td>
                  <td style={{ ...tdS, fontSize: 12 }}>{fmtMoney(s.hra)}</td>
                  <td style={{ ...tdS, fontSize: 12 }}>{fmtMoney(s.da)}</td>
                  <td style={{ ...tdS, fontSize: 12 }}>
                    {fmtMoney(s.other_allowances)}
                  </td>
                  <td style={{ ...tdS, fontSize: 11 }}>
                    {s.pf_number || "—"}
                  </td>
                  <td style={{ ...tdS, fontSize: 12 }}>
                    {fmtDate(s.effective_from)}
                  </td>
                  {canEdit && (
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => openEditSal(s)}
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
                          void deleteSal(s.id);
                        }}
                        title="Delete"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 4px",
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === "leave" && <EmployeeLeaveTab />}

      {subTab === "matrix" && (
        <div style={{ padding: "10px 16px" }}>
          <AttendanceMatrixView />
        </div>
      )}

      {subTab === "attendance" && (
        <AttendancePage
          profile={profile}
          profiles={profiles}
          selectedOrg={selectedOrg}
        />
      )}

      {subTab === "approvals" && <EmployeeApprovalsTab />}

      {empModal && (
        <EmpModal
          form={empForm}
          setForm={setEmpForm}
          onSave={() => {
            void saveEmp();
          }}
          onFileSelect={setAddressProof}
          onClose={() => {
            setEmpModal(null);
            setAddressProof(null);
          }}
          saving={saving}
          title={empModal === "edit" ? "✏️ Edit Employee" : "➕ Add Employee"}
          orgOptions={empModal === "add" ? orgOptions : undefined}
          orgUid={createOrgUid}
          setOrgUid={empModal === "add" ? setCreateOrgUid : undefined}
        />
      )}
      {salModal && (
        <SalaryModal
          form={salForm}
          setForm={setSalForm}
          onSave={() => {
            void saveSal();
          }}
          onClose={() => setSalModal(null)}
          saving={saving}
          employees={employees}
        />
      )}
    </div>
  );
}
