import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  ApiError,
  apiDelete,
  apiPatch,
  apiPost,
} from "@/lib/api";
import { exportCSV } from "@/utils/csv";
import StatusMasterModal from "@/components/leads/StatusMasterModal";
import LeadModal from "@/components/leads/LeadModal";
import HistoryModal from "@/components/leads/HistoryModal";
import PipelineView from "@/components/leads/PipelineView";
import LeadsTable from "@/components/leads/LeadsTable";
import type { Lead, Profile } from "@/types";
import type {
  LeadCreate,
  LeadDto,
  LeadPriorityValue,
  LeadUpdate,
  Pk,
} from "@/types/api";
import { fmtMoney } from "@/utils/money";
import { hexBg, isOverdue, LEAD_SOURCES } from "@/utils/leads";
import { PRIORITIES } from "@/utils/worklog";
import { useLeads } from "@/hooks/useLeads";
import { useMasters } from "@/hooks/useMasters";

interface LeadsPageProps {
  profile: Profile | null;
  profiles?: Profile[];
}

type ViewMode = "table" | "pipeline";

export default function LeadsPage({ profile, profiles = [] }: LeadsPageProps) {
  const { leads, statuses, loading, reload, reloadStatuses } = useLeads();
  const { clients: clientMasters } = useMasters();

  const [modal, setModal] = useState<Partial<Lead> | null>(null);
  const [histLead, setHistLead] = useState<Lead | null>(null);
  const [statusMgr, setStatusMgr] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  const [fStatus, setFStatus] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fMember, setFMember] = useState("");
  const [fSource, setFSource] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [search, setSearch] = useState("");

  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";

  const memberOptions = useMemo(
    () =>
      profiles
        .filter((p) => p.role === "admin" || p.role === "manager")
        .map((p) => p.full_name)
        .filter(Boolean)
        .sort(),
    [profiles],
  );

  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [clientMasters]);

  const assigneeUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach((p) => {
      if (p.full_name) map[p.full_name] = p.id;
    });
    return map;
  }, [profiles]);

  const statusIdByName = useMemo(() => {
    const map: Record<string, Pk> = {};
    statuses.forEach((s) => {
      const n = Number(s.id);
      if (Number.isFinite(n)) map[s.name] = n;
    });
    return map;
  }, [statuses]);

  const statusBadge = useCallback(
    (name: string): CSSProperties => {
      const s = statuses.find((x) => x.name === name);
      const color = s?.color || "#64748b";
      return {
        background: hexBg(color),
        color,
        padding: "2px 9px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      };
    },
    [statuses],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads.filter(
      (l) =>
        (!fStatus || l.status === fStatus) &&
        (!fPriority || l.priority === fPriority) &&
        (!fMember || l.assigned_to === fMember) &&
        (!fSource || l.lead_source === fSource) &&
        (!fMonth ||
          (l.next_step_date || "").startsWith(fMonth) ||
          (l.created_at || "").startsWith(fMonth)) &&
        (!search ||
          [
            l.client,
            l.contact_person,
            l.reference_from,
            l.action_taken,
            l.next_step,
            l.remarks,
          ].some((v) => (v || "").toLowerCase().includes(q))),
    );
  }, [leads, fStatus, fPriority, fMember, fSource, fMonth, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const byStatus = Object.fromEntries(
      statuses.map((s) => [
        s.name,
        filtered.filter((l) => l.status === s.name).length,
      ]),
    );
    const confirmed = filtered.filter(
      (l) => l.status?.toLowerCase() === "confirmed",
    ).length;
    const convRate = total ? Math.round((confirmed / total) * 100) : 0;
    const totalVal = filtered.reduce(
      (s, l) => s + (Number(l.estimated_value) || 0),
      0,
    );
    const confVal = filtered
      .filter((l) => l.status?.toLowerCase() === "confirmed")
      .reduce((s, l) => s + (Number(l.estimated_value) || 0), 0);
    const overdueFollowups = filtered.filter(
      (l) =>
        isOverdue(l.next_step_date) &&
        l.status?.toLowerCase() !== "cancelled" &&
        l.status?.toLowerCase() !== "confirmed",
    ).length;
    return { total, byStatus, convRate, totalVal, confVal, overdueFollowups };
  }, [filtered, statuses]);

  const buildLeadBody = useCallback(
    (form: Partial<Lead>): LeadCreate | LeadUpdate => {
      const statusName = form.status || statuses[0]?.name || "";
      const statusPk = statusIdByName[statusName];
      const clientUid = form.client ? clientUidByName[form.client] : undefined;
      const assigneeUid = form.assigned_to
        ? assigneeUidByName[form.assigned_to]
        : undefined;
      const body: LeadCreate = {
        client: clientUid,
        contact_person: form.contact_person?.trim() || undefined,
        contact_email: form.contact_email?.trim() || undefined,
        contact_phone: form.contact_phone?.trim() || undefined,
        lead_source: form.lead_source || undefined,
        reference_from: form.reference_from?.trim() || undefined,
        status: statusPk,
        priority: (form.priority as LeadPriorityValue) || "Medium",
        assigned_to: assigneeUid,
        estimated_value: form.estimated_value
          ? Number(form.estimated_value).toFixed(2)
          : "0.00",
        action_taken: form.action_taken?.trim() || undefined,
        next_step: form.next_step?.trim() || undefined,
        next_step_date: form.next_step_date || undefined,
        remarks: form.remarks?.trim() || undefined,
      };
      return body;
    },
    [assigneeUidByName, clientUidByName, statuses, statusIdByName],
  );

  const handleSave = useCallback(
    async (form: Partial<Lead>): Promise<void> => {
      const body = buildLeadBody(form);
      try {
        if (form.id) {
          await apiPatch<LeadDto>(`/leads/${form.id}/`, body);
        } else {
          await apiPost<LeadDto>("/leads/", body);
        }
        setModal(null);
        await reload();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
      }
    },
    [buildLeadBody, reload],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!window.confirm("Delete this lead? This cannot be undone.")) return;
      try {
        await apiDelete(`/leads/${id}/`);
        await reload();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Delete failed: ${msg}`);
      }
    },
    [reload],
  );

  const handleStatusChange = useCallback(
    async (id: string, statusName: string): Promise<void> => {
      const statusPk = statusIdByName[statusName];
      if (statusPk === undefined) return;
      try {
        await apiPatch<LeadDto>(`/leads/${id}/`, { status: statusPk });
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Update failed: ${msg}`);
      }
    },
    [statusIdByName],
  );

  const months = useMemo(() => {
    const keys = new Set<string>();
    leads.forEach((l) => {
      if (l.next_step_date) keys.add(l.next_step_date.slice(0, 7));
      if (l.created_at) keys.add(l.created_at.slice(0, 7));
    });
    return [...keys].sort().reverse();
  }, [leads]);

  const cardStyle = (c: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 14px",
    borderTop: `3px solid ${c}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    minWidth: 90,
  });
  const boxStyle: CSSProperties = {
    background: "#fff",
    borderRadius: 10,
    padding: 14,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 10,
  };
  const fs: CSSProperties = {
    padding: "4px 6px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 5,
    fontSize: 11,
    width: "100%",
    boxSizing: "border-box",
  };
  const lbl = (w: number | string): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: w,
    flexShrink: 0,
  });
  const cap: CSSProperties = {
    fontSize: 10,
    color: "#94a3b8",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  };

  return (
    <div style={{ padding: "10px 16px" }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div className="page-title">🎯 Lead Management</div>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {isAdmin && (
            <button
              onClick={() => setStatusMgr(true)}
              style={{
                padding: "7px 14px",
                background: "#f8fafc",
                border: "1.5px solid #e2e8f0",
                borderRadius: 7,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 12,
                color: "#475569",
              }}
            >
              ⚙️ Manage Statuses
            </button>
          )}
          <div
            style={{
              display: "flex",
              border: "1.5px solid #e2e8f0",
              borderRadius: 7,
              overflow: "hidden",
            }}
          >
            {(
              [
                ["table", "📋 Table"],
                ["pipeline", "🗂 Pipeline"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                style={{
                  padding: "6px 14px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  background: viewMode === v ? "#2563eb" : "#fff",
                  color: viewMode === v ? "#fff" : "#64748b",
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={() =>
              exportCSV(
                filtered.map((l, i) => ({
                  "#": l.serialNo || i + 1,
                  Client: l.client || "",
                  "Contact Person": l.contact_person || "",
                  Email: l.contact_email || "",
                  Phone: l.contact_phone || "",
                  "Lead Source": l.lead_source || "",
                  "Reference From": l.reference_from || "",
                  Status: l.status || "",
                  Priority: l.priority || "",
                  "Assigned To": l.assigned_to || "",
                  "Est. Value": l.estimated_value || "",
                  "Action Taken": l.action_taken || "",
                  "Next Step": l.next_step || "",
                  "Next Step Date": l.next_step_date || "",
                  Remarks: l.remarks || "",
                  Created: (l.created_at || "").slice(0, 10),
                })),
                "leads.csv",
              )
            }
            style={{
              padding: "7px 14px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            ⬇ Export
          </button>
          <button
            onClick={() =>
              setModal({ status: statuses[0]?.name || "" })
            }
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
            + New Lead
          </button>
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
        <div style={cardStyle("#2563eb")}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{stats.total}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
            Total
          </div>
        </div>
        {statuses.map((s) => (
          <div key={s.id || s.name} style={cardStyle(s.color)}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>
              {stats.byStatus[s.name] || 0}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
              {s.name}
            </div>
          </div>
        ))}
        <div style={cardStyle("#7c3aed")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#7c3aed" }}>
            {stats.convRate}%
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
            Conversion
          </div>
        </div>
        {stats.overdueFollowups > 0 && (
          <div style={cardStyle("#dc2626")}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>
              {stats.overdueFollowups}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
              Overdue
            </div>
          </div>
        )}
        {stats.totalVal > 0 && (
          <div style={cardStyle("#059669")}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#059669" }}>
              {fmtMoney(stats.totalVal)}
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
              Pipeline
            </div>
            {stats.confVal > 0 && (
              <div style={{ fontSize: 10, color: "#16a34a" }}>
                {fmtMoney(stats.confVal)} confirmed
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "7px 12px",
          boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          marginBottom: 10,
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        <div style={lbl(150)}>
          <span style={cap}>Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Client, step, ref…"
            style={{ ...fs, padding: "4px 8px" }}
          />
        </div>
        <div style={lbl(120)}>
          <span style={cap}>Status</span>
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            style={fs}
          >
            <option value="">All</option>
            {statuses.map((s) => (
              <option key={s.id || s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div style={lbl(100)}>
          <span style={cap}>Priority</span>
          <select
            value={fPriority}
            onChange={(e) => setFPriority(e.target.value)}
            style={fs}
          >
            <option value="">All</option>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.value}
              </option>
            ))}
          </select>
        </div>
        {(isAdmin || isManager) && (
          <div style={lbl(110)}>
            <span style={cap}>Assigned To</span>
            <select
              value={fMember}
              onChange={(e) => setFMember(e.target.value)}
              style={fs}
            >
              <option value="">All</option>
              {memberOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={lbl(130)}>
          <span style={cap}>Source</span>
          <select
            value={fSource}
            onChange={(e) => setFSource(e.target.value)}
            style={fs}
          >
            <option value="">All</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={lbl(110)}>
          <span style={cap}>Month</span>
          <select
            value={fMonth}
            onChange={(e) => setFMonth(e.target.value)}
            style={fs}
          >
            <option value="">All</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {(fStatus ||
          fPriority ||
          fMember ||
          fSource ||
          fMonth ||
          search) && (
          <button
            onClick={() => {
              setFStatus("");
              setFPriority("");
              setFMember("");
              setFSource("");
              setFMonth("");
              setSearch("");
            }}
            style={{
              padding: "4px 10px",
              border: "1px solid #fecaca",
              borderRadius: 5,
              background: "#fff1f2",
              cursor: "pointer",
              fontSize: 11,
              color: "#dc2626",
              fontWeight: 700,
              flexShrink: 0,
              alignSelf: "flex-end",
            }}
          >
            ✕ Clear
          </button>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#94a3b8",
            whiteSpace: "nowrap",
            flexShrink: 0,
            alignSelf: "flex-end",
            paddingBottom: 2,
          }}
        >
          {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Pipeline view */}
      {viewMode === "pipeline" && (
        <div style={boxStyle}>
          {loading ? (
            <div style={{ color: "#94a3b8" }}>Loading…</div>
          ) : (
            <PipelineView
              leads={filtered}
              statuses={statuses}
              onEdit={(l) => setModal({ ...l })}
            />
          )}
        </div>
      )}

      {/* Table view */}
      {viewMode === "table" && (
        <div style={boxStyle}>
          <LeadsTable
            leads={filtered}
            statuses={statuses}
            loading={loading}
            canDelete={isAdmin || isManager}
            statusBadge={statusBadge}
            onEdit={(l) => setModal({ ...l })}
            onHistory={(l) => setHistLead(l)}
            onDelete={(id) => {
              void handleDelete(id);
            }}
            onStatusChange={(id, s) => {
              void handleStatusChange(id, s);
            }}
          />
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <LeadModal
          lead={modal}
          statuses={statuses}
          memberOptions={memberOptions}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Follow-up History */}
      {histLead && (
        <HistoryModal lead={histLead} onClose={() => setHistLead(null)} />
      )}

      {/* Status Master (admin only) */}
      {statusMgr && isAdmin && (
        <StatusMasterModal
          statuses={statuses}
          onClose={() => setStatusMgr(false)}
          onRefresh={() => {
            void reloadStatuses();
            setStatusMgr(false);
          }}
        />
      )}
    </div>
  );
}
