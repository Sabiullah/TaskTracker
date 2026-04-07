import { useState, useEffect, useMemo, useRef } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { CLIENTS as DEFAULT_CLIENTS } from "@/constants";
import type { Profile } from "@/types/auth";
import type {
  WorkLog,
  WorkPlan,
  NewWorkLog,
  NewWorkPlan,
  ManagedMember,
  DrillState,
} from "@/types/worklog";

// ── Employee color palette for calendar ───────────────────────────────────
const EMP_COLORS = [
  { bg: "#dbeafe", text: "#1d4ed8", dot: "#2563eb" },
  { bg: "#ede9fe", text: "#6d28d9", dot: "#7c3aed" },
  { bg: "#fce7f3", text: "#be185d", dot: "#db2777" },
  { bg: "#fee2e2", text: "#b91c1c", dot: "#dc2626" },
  { bg: "#ffedd5", text: "#c2410c", dot: "#ea580c" },
  { bg: "#dcfce7", text: "#15803d", dot: "#16a34a" },
  { bg: "#cffafe", text: "#0e7490", dot: "#0891b2" },
  { bg: "#f3e8ff", text: "#7e22ce", dot: "#9333ea" },
  { bg: "#fef3c7", text: "#92400e", dot: "#d97706" },
  { bg: "#d1fae5", text: "#065f46", dot: "#059669" },
  { bg: "#e0f2fe", text: "#075985", dot: "#0284c7" },
  { bg: "#fdf4ff", text: "#86198f", dot: "#c026d3" },
];

// ── Priority config ────────────────────────────────────────────────────────
const PRIORITIES = [
  {
    value: "Top Priority",
    label: "🔴 Top Priority",
    rowBg: "#fff1f2",
    border: "#fecaca",
    badge: "#dc2626",
    badgeBg: "#fee2e2",
  },
  {
    value: "Priority",
    label: "🟠 Priority",
    rowBg: "#fff7ed",
    border: "#fed7aa",
    badge: "#ea580c",
    badgeBg: "#ffedd5",
  },
  {
    value: "Normal",
    label: "🟢 Normal",
    rowBg: "#ffffff",
    border: "#e2e8f0",
    badge: "#16a34a",
    badgeBg: "#dcfce7",
  },
  {
    value: "Not Urgent",
    label: "⚪ Not Urgent",
    rowBg: "#f8fafc",
    border: "#e2e8f0",
    badge: "#64748b",
    badgeBg: "#f1f5f9",
  },
];
const getPr = (v: string) =>
  PRIORITIES.find((p) => p.value === v) || PRIORITIES[2];

// ── Time validation HH:MM ──────────────────────────────────────────────────
const TIME_RE = /^(\d+):([0-5]\d)$/;
const validTime = (v: string) => !v || TIME_RE.test(v.trim());

// ── Clients from Masters (localStorage) + initialData fallback ─────────────
function loadClients(): string[] {
  try {
    const s = localStorage.getItem("tt_clients");
    if (s) {
      const p = JSON.parse(s) as { name?: string }[];
      if (Array.isArray(p) && p.length)
        return p
          .map((c) => (typeof c === "string" ? c : c.name || ""))
          .filter(Boolean)
          .sort((a: string, b: string) => a.localeCompare(b));
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_CLIENTS].sort((a, b) => a.localeCompare(b));
}

function getDayName(ds: string) {
  if (!ds) return "";
  return new Date(ds + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
  });
}

function toMins(t: string) {
  if (!t) return 0;
  const m = t.match(TIME_RE);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function fromMins(m: number) {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function exportCSV(rows: WorkLog[]) {
  const esc = (v: unknown) => `"${String(v || "").replace(/"/g, '""')}"`;
  const hdr = ["Name", "Day", "Date", "Client", "Task", "Hours", "Priority"];
  const csv = [
    hdr.join(","),
    ...rows.map((r) =>
      [
        esc(r.name),
        esc(r.day),
        r.date || "",
        esc(r.client || ""),
        esc(r.task_description || ""),
        r.hours_worked || "",
        esc(r.priority || "Normal"),
      ].join(","),
    ),
  ].join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: "work-log.csv",
  });
  a.click();
}

const TODAY = new Date().toISOString().slice(0, 10);
const PR_ORDER: Record<string, number> = {
  "Top Priority": 0,
  Priority: 1,
  Normal: 2,
  "Not Urgent": 3,
};
const BLANK_ROW = {
  _new: true,
  date: TODAY,
  client: "",
  task_description: "",
  hours_worked: "",
  priority: "Normal",
};

// ══════════════════════════════════════════════════════════════════════════════
export default function WorkLogPage({
  profile,
  profiles = [],
}: {
  profile: Profile;
  profiles: Profile[];
}) {
  const [subTab, setSubTab] = useState("log"); // 'log' | 'dashboard'
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [editRows, setEditRows] = useState<Record<string, WorkLog>>({});
  const [newRows, setNewRows] = useState<NewWorkLog[]>([]);
  const [fMember, setFMember] = useState("");
  const [fClient, setFClient] = useState("");
  const [fDate, setFDate] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [sortBy, setSortBy] = useState(""); // 'date'|'client'|'name'|'priority'
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState(new Set()); // selected row IDs
  const [moving, setMoving] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const clients = useMemo(() => loadClients(), []);
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const myName = profile?.full_name || profile?.name || "";

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    const data = await apiGet<WorkLog[]>("/work_logs/");
    // Client-side role scoping as safety net (backend should also enforce this)
    const scoped = (data || []).filter((r) => {
      if (isAdmin) return true;
      if (isManager) {
        const teamNames = profiles
          .filter((p) =>
            (p.manager_ids?.length
              ? p.manager_ids
              : p.manager_id
                ? [p.manager_id]
                : []
            ).includes(profile?.id),
          )
          .map((p) => p.full_name)
          .filter(Boolean);
        return r.name === myName || teamNames.includes(r.name ?? "");
      }
      return r.name === myName;
    });
    setLogs(scoped);
    setLoading(false);
  };
  useEffect(() => {
    const init = async () => {
      await load();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Filtered + sorted logs ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const base = logs.filter(
      (r) =>
        (!fMember || r.name === fMember) &&
        (!fClient || r.client === fClient) &&
        (!fDate || r.date === fDate) &&
        (!fMonth || (r.date || "").startsWith(fMonth)),
    );
    if (!sortBy) return base;
    return [...base].sort((a, b) => {
      if (sortBy === "priority") {
        const av = PR_ORDER[a.priority ?? ""] ?? 2;
        const bv = PR_ORDER[b.priority ?? ""] ?? 2;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const av =
        (sortBy === "date"
          ? a.date
          : sortBy === "client"
            ? a.client
            : a.name) || "";
      const bv =
        (sortBy === "date"
          ? b.date
          : sortBy === "client"
            ? b.client
            : b.name) || "";
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [logs, fMember, fClient, fDate, fMonth, sortBy, sortDir]);

  const totalMins = filtered.reduce(
    (s, r) => s + toMins(r.hours_worked ?? ""),
    0,
  );

  const logClients = [
    ...new Set(logs.map((r) => r.client).filter(Boolean)),
  ].sort();
  const logMembers =
    isAdmin || isManager
      ? [...new Set(logs.map((r) => r.name).filter(Boolean))].sort()
      : [myName];
  const logMonths = [
    ...new Set(logs.map((r) => (r.date || "").slice(0, 7)).filter(Boolean)),
  ]
    .sort()
    .reverse();

  // ── Inline edit helpers ───────────────────────────────────────────────────
  const startEdit = (row: WorkLog) =>
    setEditRows((e) => ({ ...e, [row.id]: { ...row } }));
  const cancelEdit = (id: string) =>
    setEditRows((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  const setEdit = (id: string, k: string, v: string) =>
    setEditRows((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));

  const saveEdit = async (id: string) => {
    const d = editRows[id];
    if (!d.task_description?.trim()) return alert("Task is required");
    if (!validTime(d.hours_worked ?? ""))
      return alert("Hours must be H:MM format (e.g. 1:30)");
    setSaving((s) => ({ ...s, [id]: true }));
    await apiPatch(`/work_logs/${id}/`, {
      date: d.date,
      day: getDayName(d.date ?? ""),
      client: d.client || "",
      task_description: d.task_description?.trim(),
      hours_worked: d.hours_worked || null,
      priority: d.priority || "Normal",
    });
    setSaving((s) => ({ ...s, [id]: false }));
    cancelEdit(id);
    load();
  };

  const deleteRow = async (id: string) => {
    if (!window.confirm("Delete this entry?")) return;
    await apiDelete(`/work_logs/${id}/`);
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    load();
  };

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const isAllSelected = (rows: WorkLog[]) =>
    rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleSelectAll = (rows: WorkLog[]) => {
    if (isAllSelected(rows)) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  // ── Bulk delete selected rows ─────────────────────────────────────────────
  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selected.size} selected entr${selected.size === 1 ? "y" : "ies"}? This cannot be undone.`,
      )
    )
      return;
    const ids = [...selected] as string[];
    await Promise.all(ids.map((id) => apiDelete(`/work_logs/${id}/`)));
    setSelected(new Set());
    load();
  };

  // ── New rows ──────────────────────────────────────────────────────────────
  const addNewRow = () =>
    setNewRows((r) => [...r, { ...BLANK_ROW, _id: Date.now() }]);
  const setNew = (idx: number, k: string, v: string) =>
    setNewRows((r) =>
      r.map((row, i) => (i === idx ? { ...row, [k]: v } : row)),
    );
  const cancelNew = (idx: number) =>
    setNewRows((r) => r.filter((_, i) => i !== idx));

  const saveNew = async (idx: number) => {
    const d = newRows[idx];
    if (!d.task_description?.trim()) return alert("Task is required");
    if (!validTime(d.hours_worked ?? ""))
      return alert("Hours must be H:MM format (e.g. 1:30)");
    setSaving((s) => ({ ...s, ["new" + idx]: true }));
    await apiPost("/work_logs/", {
      name: myName,
      day: getDayName(d.date ?? ""),
      date: d.date,
      client: d.client || "",
      task_description: d.task_description?.trim(),
      hours_worked: d.hours_worked || null,
      priority: d.priority || "Normal",
    });
    setSaving((s) => ({ ...s, ["new" + idx]: false }));
    cancelNew(idx);
    load();
  };

  // ── CSV Import ────────────────────────────────────────────────────────────
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const lines = (ev.target?.result as string)
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean);
      const header = lines[0].toLowerCase().split(",");
      const idx = (k: string) => header.findIndex((h: string) => h.includes(k));
      const iName = idx("name"),
        iDate = idx("date"),
        iClient = idx("client"),
        iTask = idx("task"),
        iHours = idx("hour"),
        iPrio = idx("prior");

      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]
          .split(",")
          .map((c) => c.replace(/^"|"$/g, "").trim());
        const name = (iName >= 0 ? cols[iName] : myName) || myName;
        const date = iDate >= 0 ? cols[iDate] : TODAY;
        const task = iTask >= 0 ? cols[iTask] : "";
        if (!task) continue;
        rows.push({
          name,
          day: getDayName(date),
          date,
          client: iClient >= 0 ? cols[iClient] : "",
          task_description: task,
          hours_worked:
            iHours >= 0 && validTime(cols[iHours]) ? cols[iHours] : null,
          priority:
            iPrio >= 0 && PRIORITIES.find((p) => p.value === cols[iPrio])
              ? cols[iPrio]
              : "Normal",
          user_id: profile?.id,
        });
      }
      if (!rows.length) {
        alert("No valid rows found in file.");
        return;
      }
      if (!window.confirm(`Import ${rows.length} entries?`)) return;
      await Promise.all(rows.map((r) => apiPost("/work_logs/", r)));
      alert(`✅ Imported ${rows.length} entries!`);
      load();
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Move row up / down ────────────────────────────────────────────────────
  const moveRow = async (id: string, direction: string) => {
    const ids = filtered.map((r) => r.id);
    const idx = ids.indexOf(id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= ids.length) return; // already at top/bottom

    // Swap in the ids array
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];

    setMoving(id);

    // Update logs state immediately (instant visual feedback)
    setLogs((prev) => {
      const filteredSet = new Set(ids);
      const nonFiltered = prev.filter((r) => !filteredSet.has(r.id));
      const reordered = ids.flatMap((rid, i) => {
        const row = prev.find((r) => r.id === rid);
        return row ? [{ ...row, sort_order: i + 1 }] : [];
      });
      return [...reordered, ...nonFiltered];
    });

    await Promise.all([
      apiPatch(`/work_logs/${ids[idx]}/`, { sort_order: idx + 1 }),
      apiPatch(`/work_logs/${ids[swapIdx]}/`, { sort_order: swapIdx + 1 }),
    ]);
    setMoving(null);
  };

  // ── Reusable inline cell ──────────────────────────────────────────────────
  const cell = {
    padding: "6px 8px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    verticalAlign: "middle",
  };
  const inInput: React.CSSProperties = {
    padding: "4px 6px",
    border: "1.5px solid #2563eb",
    borderRadius: 4,
    fontSize: 12,
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const selStyle = {
    padding: "6px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    background: "#fff",
    cursor: "pointer",
  };

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1300, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
          📝 Daily Work Log
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            background: "#f1f5f9",
            padding: 4,
            borderRadius: 8,
          }}
        >
          {[
            ["log", "📋 Log Table"],
            ["plan", "📅 Work Plan"],
            ["dashboard", "📊 Dashboard"],
          ].map(([id, lbl]) => (
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
          ))}
        </div>
      </div>

      {/* ═══════════════════ LOG TABLE TAB ═══════════════════════════════════ */}
      {subTab === "log" && (
        <>
          {/* Priority legend */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            {PRIORITIES.map((p) => (
              <span
                key={p.value}
                style={{
                  background: p.badgeBg,
                  color: p.badge,
                  padding: "3px 10px",
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${p.border}`,
                }}
              >
                {p.label}
              </span>
            ))}
          </div>

          {/* Filters + actions */}
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
              padding: "10px 12px",
              background: "#f8fafc",
              borderRadius: 8,
              alignItems: "flex-end",
            }}
          >
            {(isAdmin || isManager) && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    marginBottom: 3,
                  }}
                >
                  MEMBER
                </div>
                <select
                  value={fMember}
                  onChange={(e) => setFMember(e.target.value)}
                  style={selStyle}
                >
                  <option value="">All Members</option>
                  {logMembers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: 3,
                }}
              >
                CLIENT
              </div>
              <select
                value={fClient}
                onChange={(e) => setFClient(e.target.value)}
                style={selStyle}
              >
                <option value="">All Clients</option>
                {logClients.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: 3,
                }}
              >
                MONTH
              </div>
              <select
                value={fMonth}
                onChange={(e) => setFMonth(e.target.value)}
                style={selStyle}
              >
                <option value="">All Months</option>
                {logMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#64748b",
                  marginBottom: 3,
                }}
              >
                DATE
              </div>
              <input
                type="date"
                value={fDate}
                onChange={(e) => setFDate(e.target.value)}
                style={{ ...selStyle, minWidth: 140 }}
              />
            </div>
            {(fMember || fClient || fDate || fMonth) && (
              <button
                onClick={() => {
                  setFMember("");
                  setFClient("");
                  setFDate("");
                  setFMonth("");
                }}
                style={{
                  padding: "6px 10px",
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ✕ Clear Filters
              </button>
            )}
            {sortBy && (
              <button
                onClick={() => {
                  setSortBy("");
                  setSortDir("asc");
                }}
                style={{
                  padding: "6px 10px",
                  border: "1px solid #bfdbfe",
                  background: "#eff6ff",
                  color: "#2563eb",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ✕ Clear Sort ({sortBy} {sortDir === "asc" ? "▲" : "▼"})
              </button>
            )}
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 6,
                alignItems: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  color: "#475569",
                  fontWeight: 600,
                  paddingBottom: 6,
                }}
              >
                {filtered.length} entries ·{" "}
                <span style={{ color: "#2563eb" }}>
                  {fromMins(totalMins)} hrs
                </span>
              </div>
              {selected.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  style={{
                    padding: "6px 12px",
                    background: "#dc2626",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  🗑 Delete Selected ({selected.size})
                </button>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  padding: "6px 12px",
                  background: "#7c3aed",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                ⬆ Import CSV
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleImport}
                style={{ display: "none" }}
              />
              <button
                onClick={() => exportCSV(filtered)}
                style={{
                  padding: "6px 12px",
                  background: "#16a34a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                ⬇ Export CSV
              </button>
              <button
                onClick={addNewRow}
                style={{
                  padding: "6px 14px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                + Add Row
              </button>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: 30 }}>
              Loading…
            </p>
          ) : (
            <div
              style={{
                overflowX: "auto",
                borderRadius: 10,
                boxShadow: "0 1px 4px rgba(0,0,0,.08)",
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
                  <tr style={{ background: "#f8fafc" }}>
                    <th
                      style={{
                        padding: "9px 8px",
                        borderBottom: "2px solid #e2e8f0",
                        width: 56,
                        textAlign: "center",
                        color: "#94a3b8",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      ORDER
                    </th>
                    <th
                      style={{
                        padding: "9px 10px",
                        borderBottom: "2px solid #e2e8f0",
                        width: 36,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isAllSelected(filtered)}
                        onChange={() => toggleSelectAll(filtered)}
                        title="Select all visible rows"
                        style={{ cursor: "pointer", width: 15, height: 15 }}
                      />
                    </th>
                    {[
                      { label: "#", key: null },
                      { label: "Name", key: "name" },
                      { label: "Day", key: null },
                      { label: "Date", key: "date" },
                      { label: "Client", key: "client" },
                      { label: "Task Description", key: null },
                      { label: "Hours", key: null },
                      { label: "Priority", key: "priority" },
                      { label: "Actions", key: null },
                    ].map(({ label, key }) => {
                      const active = sortBy === key;
                      const arrow = active
                        ? sortDir === "asc"
                          ? " ▲"
                          : " ▼"
                        : key
                          ? " ⇅"
                          : "";
                      return (
                        <th
                          key={label}
                          onClick={() => {
                            if (!key) return;
                            if (sortBy === key)
                              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                            else {
                              setSortBy(key);
                              setSortDir("asc");
                            }
                          }}
                          style={{
                            padding: "9px 10px",
                            textAlign: "left",
                            fontWeight: 700,
                            color: active ? "#2563eb" : "#475569",
                            fontSize: 12,
                            borderBottom: "2px solid #e2e8f0",
                            whiteSpace: "nowrap",
                            cursor: key ? "pointer" : "default",
                            userSelect: "none",
                          }}
                        >
                          {label}
                          <span
                            style={{ fontSize: 10, opacity: active ? 1 : 0.35 }}
                          >
                            {arrow}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {/* New unsaved rows at top */}
                  {newRows.map((row, idx) => (
                    <tr
                      key={row._id}
                      style={{
                        background: "#eff6ff",
                        borderBottom: "2px solid #2563eb",
                      }}
                    >
                      <td style={cell}></td>
                      {/* no move buttons for new rows */}
                      <td style={cell}></td>
                      <td style={cell}>
                        <span
                          style={{
                            fontSize: 11,
                            color: "#2563eb",
                            fontWeight: 700,
                          }}
                        >
                          NEW
                        </span>
                      </td>
                      <td style={cell}>
                        <span style={{ fontWeight: 600, color: "#2563eb" }}>
                          {myName}
                        </span>
                      </td>
                      <td style={cell}>
                        <span style={{ color: "#64748b", fontSize: 12 }}>
                          {getDayName(row.date)}
                        </span>
                      </td>
                      <td style={{ ...cell, minWidth: 130 }}>
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) => setNew(idx, "date", e.target.value)}
                          style={inInput}
                        />
                      </td>
                      <td style={{ ...cell, minWidth: 130 }}>
                        <select
                          value={row.client}
                          onChange={(e) =>
                            setNew(idx, "client", e.target.value)
                          }
                          style={{ ...inInput, cursor: "pointer" }}
                        >
                          <option value="">— Client —</option>
                          {clients.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ ...cell, minWidth: 260 }}>
                        <input
                          type="text"
                          value={row.task_description}
                          onChange={(e) =>
                            setNew(idx, "task_description", e.target.value)
                          }
                          placeholder="Task description…"
                          style={inInput}
                        />
                      </td>
                      <td style={{ ...cell, minWidth: 90 }}>
                        <input
                          type="text"
                          value={row.hours_worked}
                          onChange={(e) =>
                            setNew(idx, "hours_worked", e.target.value)
                          }
                          placeholder="H:MM"
                          maxLength={6}
                          style={{
                            ...inInput,
                            borderColor:
                              row.hours_worked && !validTime(row.hours_worked)
                                ? "#dc2626"
                                : "#2563eb",
                          }}
                        />
                        {row.hours_worked && !validTime(row.hours_worked) && (
                          <div style={{ fontSize: 10, color: "#dc2626" }}>
                            Use H:MM
                          </div>
                        )}
                      </td>
                      <td style={{ ...cell, minWidth: 130 }}>
                        <select
                          value={row.priority}
                          onChange={(e) =>
                            setNew(idx, "priority", e.target.value)
                          }
                          style={{
                            ...inInput,
                            cursor: "pointer",
                            background: getPr(row.priority ?? "Normal").badgeBg,
                            color: getPr(row.priority ?? "Normal").badge,
                            fontWeight: 700,
                          }}
                        >
                          {PRIORITIES.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ ...cell, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => saveNew(idx)}
                          disabled={saving["new" + idx]}
                          style={{
                            padding: "3px 10px",
                            background: "#2563eb",
                            color: "#fff",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: 12,
                            marginRight: 4,
                          }}
                        >
                          {saving["new" + idx] ? "…" : "✓ Save"}
                        </button>
                        <button
                          onClick={() => cancelNew(idx)}
                          style={{
                            padding: "3px 8px",
                            background: "#f1f5f9",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}

                  {/* Existing rows */}
                  {filtered.length === 0 && newRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={11}
                        style={{
                          padding: "30px",
                          textAlign: "center",
                          color: "#94a3b8",
                        }}
                      >
                        No entries. Click + Add Row to start.
                      </td>
                    </tr>
                  )}
                  {filtered.map((row, i) => {
                    const pr = getPr(row.priority ?? "Normal");
                    const ed = editRows[row.id];
                    const isEditing = !!ed;
                    const canEdit = isAdmin || row.name === myName;
                    const isSel = selected.has(row.id);
                    const isMoving = moving === row.id;
                    return (
                      <tr
                        key={row.id}
                        style={{
                          background: isSel
                            ? "#dbeafe"
                            : isEditing
                              ? "#fffbeb"
                              : pr.rowBg,
                          borderBottom: `1px solid ${isSel ? "#93c5fd" : pr.border}`,
                          transition: "background .15s",
                          opacity: isMoving ? 0.6 : 1,
                        }}
                      >
                        {/* ↑ ↓ move buttons */}
                        <td
                          style={{
                            ...cell,
                            width: 56,
                            textAlign: "center",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <button
                            onClick={() => moveRow(row.id, "up")}
                            disabled={i === 0 || isMoving}
                            title="Move up"
                            style={{
                              padding: "1px 6px",
                              marginRight: 2,
                              border: "1px solid #e2e8f0",
                              borderRadius: 4,
                              background: i === 0 ? "#f8fafc" : "#fff",
                              cursor: i === 0 ? "default" : "pointer",
                              fontSize: 13,
                              color: i === 0 ? "#cbd5e1" : "#475569",
                              fontWeight: 700,
                              lineHeight: 1.4,
                            }}
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveRow(row.id, "down")}
                            disabled={i === filtered.length - 1 || isMoving}
                            title="Move down"
                            style={{
                              padding: "1px 6px",
                              border: "1px solid #e2e8f0",
                              borderRadius: 4,
                              background:
                                i === filtered.length - 1 ? "#f8fafc" : "#fff",
                              cursor:
                                i === filtered.length - 1
                                  ? "default"
                                  : "pointer",
                              fontSize: 13,
                              color:
                                i === filtered.length - 1
                                  ? "#cbd5e1"
                                  : "#475569",
                              fontWeight: 700,
                              lineHeight: 1.4,
                            }}
                          >
                            ▼
                          </button>
                        </td>
                        <td style={{ ...cell, width: 36 }}>
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleSelect(row.id)}
                            style={{ cursor: "pointer", width: 15, height: 15 }}
                          />
                        </td>
                        <td style={{ ...cell, color: "#94a3b8", fontSize: 12 }}>
                          {i + 1}
                        </td>
                        <td style={{ ...cell, fontWeight: 600 }}>{row.name}</td>
                        <td style={{ ...cell, color: "#64748b" }}>
                          {isEditing ? getDayName(ed.date ?? "") : row.day}
                        </td>

                        {/* Date */}
                        <td style={{ ...cell, minWidth: 130 }}>
                          {isEditing ? (
                            <input
                              type="date"
                              value={ed.date}
                              onChange={(e) =>
                                setEdit(row.id, "date", e.target.value)
                              }
                              style={inInput}
                            />
                          ) : (
                            <span style={{ color: "#475569" }}>{row.date}</span>
                          )}
                        </td>

                        {/* Client */}
                        <td style={{ ...cell, minWidth: 130 }}>
                          {isEditing ? (
                            <select
                              value={ed.client || ""}
                              onChange={(e) =>
                                setEdit(row.id, "client", e.target.value)
                              }
                              style={{ ...inInput, cursor: "pointer" }}
                            >
                              <option value="">— Client —</option>
                              {clients.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : row.client ? (
                            <span
                              style={{
                                background: "#eff6ff",
                                color: "#2563eb",
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              {row.client}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </td>

                        {/* Task */}
                        <td style={{ ...cell, minWidth: 260 }}>
                          {isEditing ? (
                            <input
                              type="text"
                              value={ed.task_description || ""}
                              onChange={(e) =>
                                setEdit(
                                  row.id,
                                  "task_description",
                                  e.target.value,
                                )
                              }
                              style={inInput}
                            />
                          ) : (
                            row.task_description
                          )}
                        </td>

                        {/* Hours */}
                        <td style={{ ...cell, minWidth: 90 }}>
                          {isEditing ? (
                            <>
                              <input
                                type="text"
                                value={ed.hours_worked || ""}
                                onChange={(e) =>
                                  setEdit(
                                    row.id,
                                    "hours_worked",
                                    e.target.value,
                                  )
                                }
                                placeholder="H:MM"
                                maxLength={6}
                                style={{
                                  ...inInput,
                                  borderColor:
                                    ed.hours_worked &&
                                    !validTime(ed.hours_worked ?? "")
                                      ? "#dc2626"
                                      : "#2563eb",
                                }}
                              />
                              {ed.hours_worked &&
                                !validTime(ed.hours_worked ?? "") && (
                                  <div
                                    style={{ fontSize: 10, color: "#dc2626" }}
                                  >
                                    Use H:MM
                                  </div>
                                )}
                            </>
                          ) : (
                            <span style={{ fontWeight: 700 }}>
                              {row.hours_worked || "—"}
                            </span>
                          )}
                        </td>

                        {/* Priority */}
                        <td style={{ ...cell, minWidth: 130 }}>
                          {isEditing ? (
                            <select
                              value={ed.priority || "Normal"}
                              onChange={(e) =>
                                setEdit(row.id, "priority", e.target.value)
                              }
                              style={{
                                ...inInput,
                                cursor: "pointer",
                                background: getPr(ed.priority ?? "Normal")
                                  .badgeBg,
                                color: getPr(ed.priority ?? "Normal").badge,
                                fontWeight: 700,
                              }}
                            >
                              {PRIORITIES.map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              style={{
                                background: pr.badgeBg,
                                color: pr.badge,
                                padding: "2px 9px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                border: `1px solid ${pr.border}`,
                              }}
                            >
                              {row.priority}
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td style={{ ...cell, whiteSpace: "nowrap" }}>
                          {canEdit &&
                            (isEditing ? (
                              <>
                                <button
                                  onClick={() => saveEdit(row.id)}
                                  disabled={saving[row.id]}
                                  style={{
                                    padding: "3px 10px",
                                    background: "#16a34a",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    fontSize: 12,
                                    marginRight: 4,
                                  }}
                                >
                                  {saving[row.id] ? "…" : "✓ Save"}
                                </button>
                                <button
                                  onClick={() => cancelEdit(row.id)}
                                  style={{
                                    padding: "3px 8px",
                                    background: "#f1f5f9",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontSize: 12,
                                  }}
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(row)}
                                  style={{
                                    padding: "3px 10px",
                                    border: "1px solid #e2e8f0",
                                    background: "#f8fafc",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    marginRight: 4,
                                  }}
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  onClick={() => deleteRow(row.id)}
                                  style={{
                                    padding: "3px 8px",
                                    border: "1px solid #fecaca",
                                    background: "#fff1f2",
                                    color: "#dc2626",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 600,
                                  }}
                                >
                                  🗑
                                </button>
                              </>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Import template note */}
          <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
            📌 Import CSV columns:{" "}
            <code>Name, Day, Date, Client, Task, Hours (H:MM), Priority</code>
          </div>
        </>
      )}

      {/* ═══════════════════ WORK PLAN TAB ═══════════════════════════════════ */}
      {subTab === "plan" && (
        <WorkPlanTab
          profile={profile}
          profiles={profiles}
          clients={clients}
          isAdmin={isAdmin}
          isManager={isManager}
          myName={myName}
        />
      )}

      {/* ═══════════════════ DASHBOARD TAB ══════════════════════════════════ */}
      {subTab === "dashboard" && (
        <WorkLogDashboard
          logs={logs}
          isAdmin={isAdmin}
          isManager={isManager}
          myName={myName}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Work Plan Calendar View ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function WorkPlanCalendar({
  plans,
  calMonth,
  setCalMonth,
  allMemberNames,
}: {
  plans: WorkPlan[];
  calMonth: string;
  setCalMonth: (m: string) => void;
  allMemberNames: string[];
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [year, month] = calMonth.split("-").map(Number);

  const prevMonth = () => {
    const d = new Date(year, month - 2, 1);
    setCalMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  };
  const nextMonth = () => {
    const d = new Date(year, month, 1);
    setCalMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  };
  const goToday = () => setCalMonth(new Date().toISOString().slice(0, 7));

  const empColorMap = useMemo(() => {
    const names = [
      ...new Set([
        ...allMemberNames,
        ...plans.map((p) => p.assigned_to).filter(Boolean),
      ]),
    ].sort();
    const m: Record<string, (typeof EMP_COLORS)[0]> = {};
    names.forEach((n, i) => {
      m[n] = EMP_COLORS[i % EMP_COLORS.length];
    });
    return m;
  }, [allMemberNames, plans]);

  const activeEmployees = useMemo(
    () => [...new Set(plans.map((p) => p.assigned_to).filter(Boolean))].sort(),
    [plans],
  );

  const plansByDate = useMemo(() => {
    const m: Record<string, WorkPlan[]> = {};
    plans.forEach((p) => {
      if (!p.date) return;
      if (!m[p.date]) m[p.date] = [];
      m[p.date].push(p);
    });
    return m;
  }, [plans]);

  const calDays = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startDow = firstDay.getDay();
    const offset = startDow === 0 ? 6 : startDow - 1;
    const start = new Date(firstDay);
    start.setDate(start.getDate() - offset);
    const days: Date[] = [];
    const cur = new Date(start);
    while (cur.getMonth() !== month || cur.getDate() <= lastDay.getDate()) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
      if (days.length > 42) break;
    }
    while (days.length % 7 !== 0) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [year, month]);

  const toStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date().toISOString().slice(0, 10);
  const dayPlans = selectedDay ? plansByDate[selectedDay] || [] : [];
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Month navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <button
          onClick={prevMonth}
          style={{
            padding: "5px 14px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
            background: "#fff",
            fontWeight: 700,
          }}
        >
          ‹
        </button>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            fontWeight: 800,
            fontSize: 17,
            color: "#1e293b",
          }}
        >
          {monthLabel}
        </div>
        <button
          onClick={goToday}
          style={{
            padding: "5px 12px",
            border: "1.5px solid #2563eb",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            background: "#eff6ff",
            color: "#2563eb",
            fontWeight: 700,
          }}
        >
          Today
        </button>
        <button
          onClick={nextMonth}
          style={{
            padding: "5px 14px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 16,
            background: "#fff",
            fontWeight: 700,
          }}
        >
          ›
        </button>
      </div>

      {/* Employee colour legend */}
      {activeEmployees.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
            padding: "8px 12px",
            background: "#f8fafc",
            borderRadius: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              alignSelf: "center",
              marginRight: 4,
            }}
          >
            LEGEND:
          </span>
          {activeEmployees.map((n) => {
            const c = empColorMap[n] || EMP_COLORS[0];
            return (
              <span
                key={n}
                style={{
                  background: c.bg,
                  color: c.text,
                  border: `1.5px solid ${c.dot}`,
                  padding: "3px 10px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c.dot,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                {n}
              </span>
            );
          })}
        </div>
      )}

      {/* Calendar grid */}
      <div
        style={{
          border: "1.5px solid #e2e8f0",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,.06)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            background: "#f1f5f9",
            borderBottom: "2px solid #e2e8f0",
          }}
        >
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div
              key={d}
              style={{
                padding: "8px 6px",
                textAlign: "center",
                fontWeight: 700,
                fontSize: 12,
                color: d === "Sat" || d === "Sun" ? "#ef4444" : "#475569",
              }}
            >
              {d}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {calDays.map((day, i) => {
            const ds = toStr(day);
            const inMonth = day.getMonth() === month - 1;
            const isToday = ds === today;
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            const entries = plansByDate[ds] || [];
            const isSelected = ds === selectedDay;
            const isLastInRow = (i + 1) % 7 === 0;
            const isLastRow = i >= calDays.length - 7;
            return (
              <div
                key={ds}
                onClick={() => setSelectedDay(isSelected ? null : ds)}
                style={{
                  minHeight: 96,
                  padding: "6px 5px 5px",
                  borderRight: !isLastInRow ? "1px solid #f1f5f9" : "none",
                  borderBottom: !isLastRow ? "1px solid #f1f5f9" : "none",
                  background: isSelected
                    ? "#eff6ff"
                    : isToday
                      ? "#fefce8"
                      : isWeekend
                        ? "#fafafa"
                        : "#fff",
                  cursor: entries.length > 0 ? "pointer" : "default",
                  opacity: inMonth ? 1 : 0.3,
                  transition: "background .12s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      fontSize: 12,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: isToday ? "#2563eb" : "transparent",
                      color: isToday
                        ? "#fff"
                        : isWeekend
                          ? "#ef4444"
                          : "#374151",
                    }}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                  {entries.slice(0, 3).map((entry, ei) => {
                    const c = empColorMap[entry.assigned_to] || EMP_COLORS[0];
                    const initials = (entry.assigned_to || "?")
                      .split(" ")
                      .map((w: string) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();
                    const label =
                      entry.client ||
                      entry.task_description ||
                      entry.assigned_to;
                    return (
                      <div
                        key={entry.id || ei}
                        title={`${entry.assigned_to}${entry.client ? " → " + entry.client : ""}\n${entry.task_description || ""}${entry.planned_hours ? " (" + entry.planned_hours + "hrs)" : ""}`}
                        style={{
                          background: c.bg,
                          color: c.text,
                          border: `1px solid ${c.dot}`,
                          borderRadius: 4,
                          padding: "2px 5px",
                          fontSize: 10,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          overflow: "hidden",
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            background: c.dot,
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 8,
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {initials}
                        </span>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                          }}
                        >
                          {label}
                        </span>
                      </div>
                    );
                  })}
                  {entries.length > 3 && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "#64748b",
                        fontWeight: 600,
                        paddingLeft: 2,
                      }}
                    >
                      +{entries.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day detail panel */}
      {selectedDay && (
        <div
          style={{
            marginTop: 14,
            background: "#fff",
            border: "1.5px solid #bfdbfe",
            borderRadius: 10,
            boxShadow: "0 4px 20px rgba(37,99,235,.12)",
            padding: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <div>
              <span style={{ fontWeight: 800, fontSize: 15, color: "#1e293b" }}>
                📅{" "}
                {new Date(selectedDay + "T00:00:00").toLocaleDateString(
                  "en-IN",
                  {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  },
                )}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  fontWeight: 400,
                  marginLeft: 10,
                }}
              >
                {dayPlans.length} plan{dayPlans.length !== 1 ? "s" : ""}
                {dayPlans.length > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span style={{ color: "#2563eb", fontWeight: 700 }}>
                      {fromMins(
                        dayPlans.reduce(
                          (s, p) => s + toMins(p.planned_hours ?? ""),
                          0,
                        ),
                      )}{" "}
                      planned hrs
                    </span>
                  </>
                )}
              </span>
            </div>
            <button
              onClick={() => setSelectedDay(null)}
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                color: "#94a3b8",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          {dayPlans.length === 0 ? (
            <p
              style={{
                color: "#94a3b8",
                fontSize: 13,
                textAlign: "center",
                padding: "12px 0",
              }}
            >
              No plans on this day.
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                gap: 10,
              }}
            >
              {dayPlans.map((entry, i) => {
                const c = empColorMap[entry.assigned_to] || EMP_COLORS[0];
                const initials = (entry.assigned_to || "?")
                  .split(" ")
                  .map((w: string) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <div
                    key={entry.id || i}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: c.bg,
                      border: `1.5px solid ${c.dot}`,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: c.dot,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ fontWeight: 700, color: c.text, fontSize: 13 }}
                      >
                        {entry.assigned_to}
                      </div>
                      {entry.client && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#475569",
                            marginTop: 3,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span>🏢</span>
                          <span
                            style={{
                              background: "#fff",
                              padding: "1px 7px",
                              borderRadius: 4,
                              border: `1px solid ${c.dot}`,
                              fontWeight: 600,
                            }}
                          >
                            {entry.client}
                          </span>
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: 12,
                          color: "#374151",
                          marginTop: 4,
                          lineHeight: 1.4,
                        }}
                      >
                        📋 {entry.task_description}
                      </div>
                      {entry.planned_hours && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#2563eb",
                            marginTop: 4,
                            fontWeight: 700,
                          }}
                        >
                          ⏱ {entry.planned_hours} hrs
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Work Plan Tab ─────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function WorkPlanTab({
  profile,
  profiles,
  clients,
  isAdmin,
  isManager,
  myName,
}: {
  profile: Profile;
  profiles: Profile[];
  clients: string[];
  isAdmin: boolean;
  isManager: boolean;
  myName: string;
}) {
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [planView, setPlanView] = useState<"list" | "calendar">("list");
  const [calMonth, setCalMonth] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [selMember, setSelMember] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fClient, setFClient] = useState("");
  const [newRows, setNewRows] = useState<NewWorkPlan[]>([]);
  const [editRows, setEditRows] = useState<Record<string, WorkPlan>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const canManage = isAdmin || isManager;
  const inStyle: React.CSSProperties = {
    padding: "4px 6px",
    border: "1.5px solid #2563eb",
    borderRadius: 4,
    fontSize: 12,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
  const cell = {
    padding: "7px 10px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 13,
    verticalAlign: "middle",
  };

  // All employees that this manager manages (for assignment dropdown)
  const managedMembers = useMemo(() => {
    if (isAdmin)
      return profiles
        .map((p) => ({
          id: p.id,
          name:
            p.full_name || ((p as Record<string, unknown>)["email"] as string),
        }))
        .filter((p) => p.name)
        .sort((a: ManagedMember, b: ManagedMember) =>
          (a.name ?? "").localeCompare(b.name ?? ""),
        );
    if (isManager) {
      return profiles
        .filter((p) =>
          (p.manager_ids?.length
            ? p.manager_ids
            : p.manager_id
              ? [p.manager_id]
              : []
          ).includes(profile?.id),
        )
        .map((p) => ({
          id: p.id,
          name:
            p.full_name || ((p as Record<string, unknown>)["email"] as string),
        }))
        .filter((p) => p.name)
        .sort((a: ManagedMember, b: ManagedMember) =>
          (a.name ?? "").localeCompare(b.name ?? ""),
        );
    }
    return [] as ManagedMember[];
  }, [profiles, profile, isAdmin, isManager]);

  // Load plans
  const load = async () => {
    setLoading(true);
    const data = await apiGet<WorkPlan[]>("/work_plans/");
    setPlans(data || []);
    setLoading(false);
  };
  useEffect(() => {
    const init = async () => {
      await load();
    };
    init();
  }, []);

  // Filtered plans
  const filtered = useMemo(
    () =>
      plans.filter(
        (p) =>
          (!selMember || p.assigned_to === selMember) &&
          (!fMonth || (p.date || "").startsWith(fMonth)) &&
          (!fClient || (p.client || "") === fClient),
      ),
    [plans, selMember, fMonth, fClient],
  );

  const allMonths = [
    ...new Set(plans.map((p) => (p.date || "").slice(0, 7)).filter(Boolean)),
  ]
    .sort()
    .reverse();

  const allClients = useMemo(
    () =>
      [
        ...new Set(plans.map((p) => p.client).filter(Boolean)),
      ].sort() as string[],
    [plans],
  );

  // Group by member for employee view
  const byMember = useMemo(() => {
    const map: Record<string, WorkPlan[]> = {};
    filtered.forEach((p) => {
      if (!map[p.assigned_to]) map[p.assigned_to] = [];
      map[p.assigned_to].push(p);
    });
    return map;
  }, [filtered]);

  // ── New row helpers ──
  const BLANK_PLAN = {
    date: TODAY,
    client: "",
    task_description: "",
    planned_hours: "",
  };
  const addNewRow = () =>
    setNewRows((r) => [
      ...r,
      {
        ...BLANK_PLAN,
        _id: Date.now(),
        assigned_to: selMember || managedMembers[0]?.name || "",
      },
    ]);
  const setNew = (idx: number, k: string, v: string) =>
    setNewRows((r) =>
      r.map((row, i) => (i === idx ? { ...row, [k]: v } : row)),
    );
  const cancelNew = (idx: number) =>
    setNewRows((r) => r.filter((_, i) => i !== idx));

  const saveNew = async (idx: number) => {
    const d = newRows[idx];
    if (!d.assigned_to) return alert("Select an employee to assign.");
    if (!d.task_description?.trim()) return alert("Task is required.");
    if (!validTime(d.planned_hours ?? ""))
      return alert("Hours must be H:MM (e.g. 2:30)");
    const emp = profiles.find(
      (p) => (p.full_name || p.email) === d.assigned_to,
    );
    setSaving((s) => ({ ...s, ["n" + idx]: true }));
    await apiPost("/work_plans/", {
      assigned_to: d.assigned_to,
      assigned_to_user: emp?.id || null,
      created_by: myName,
      created_by_user: profile?.id,
      day: getDayName(d.date ?? ""),
      date: d.date,
      client: d.client || "",
      task_description: d.task_description?.trim(),
      planned_hours: d.planned_hours || null,
    });
    setSaving((s) => ({ ...s, ["n" + idx]: false }));
    cancelNew(idx);
    load();
  };

  // ── Edit helpers ──
  const startEdit = (row: WorkPlan) =>
    setEditRows((e) => ({ ...e, [row.id]: { ...row } }));
  const cancelEdit = (id: string) =>
    setEditRows((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  const setEdit = (id: string, k: string, v: string) =>
    setEditRows((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));

  const saveEdit = async (id: string) => {
    const d = editRows[id];
    if (!d.task_description?.trim()) return alert("Task is required.");
    if (!validTime(d.planned_hours ?? ""))
      return alert("Hours must be H:MM (e.g. 2:30)");
    setSaving((s) => ({ ...s, [id]: true }));
    await apiPatch(`/work_plans/${id}/`, {
      date: d.date,
      day: getDayName(d.date ?? ""),
      client: d.client || "",
      task_description: d.task_description?.trim(),
      planned_hours: d.planned_hours || null,
    });
    setSaving((s) => ({ ...s, [id]: false }));
    cancelEdit(id);
    load();
  };

  const deletePlan = async (id: string) => {
    if (!window.confirm("Delete this plan entry?")) return;
    await apiDelete(`/work_plans/${id}/`);
    load();
  };

  // ── Render table ──────────────────────────────────────────────────────────
  const renderTable = (rows: WorkPlan[], showMember = false) => (
    <div
      style={{
        overflowX: "auto",
        borderRadius: 10,
        boxShadow: "0 1px 4px rgba(0,0,0,.08)",
      }}
    >
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {[
              "#",
              ...(showMember ? ["Employee"] : []),
              "Day",
              "Date",
              "Client",
              "Planned Task",
              "Planned Hours",
              ...(canManage ? ["Actions"] : []),
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: "9px 10px",
                  textAlign: "left",
                  fontWeight: 700,
                  color: "#475569",
                  fontSize: 12,
                  borderBottom: "2px solid #e2e8f0",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Unsaved new rows */}
          {newRows.map((row, idx) => (
            <tr
              key={row._id}
              style={{
                background: "#eff6ff",
                borderBottom: "2px solid #2563eb",
              }}
            >
              <td style={cell}>
                <span
                  style={{ fontSize: 11, color: "#2563eb", fontWeight: 700 }}
                >
                  NEW
                </span>
              </td>
              {showMember && (
                <td style={{ ...cell, minWidth: 140 }}>
                  <select
                    value={row.assigned_to}
                    onChange={(e) => setNew(idx, "assigned_to", e.target.value)}
                    style={{ ...inStyle, cursor: "pointer" }}
                  >
                    <option value="">— Select —</option>
                    {managedMembers.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </td>
              )}
              <td style={cell}>
                <span style={{ color: "#64748b", fontSize: 12 }}>
                  {getDayName(row.date)}
                </span>
              </td>
              <td style={{ ...cell, minWidth: 130 }}>
                <input
                  type="date"
                  value={row.date}
                  onChange={(e) => setNew(idx, "date", e.target.value)}
                  style={inStyle}
                />
              </td>
              <td style={{ ...cell, minWidth: 130 }}>
                <select
                  value={row.client}
                  onChange={(e) => setNew(idx, "client", e.target.value)}
                  style={{ ...inStyle, cursor: "pointer" }}
                >
                  <option value="">— Client —</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ ...cell, minWidth: 250 }}>
                <input
                  type="text"
                  value={row.task_description}
                  onChange={(e) =>
                    setNew(idx, "task_description", e.target.value)
                  }
                  placeholder="Task description…"
                  style={inStyle}
                />
              </td>
              <td style={{ ...cell, minWidth: 100 }}>
                <input
                  type="text"
                  value={row.planned_hours}
                  onChange={(e) => setNew(idx, "planned_hours", e.target.value)}
                  placeholder="H:MM"
                  maxLength={6}
                  style={{
                    ...inStyle,
                    borderColor:
                      row.planned_hours && !validTime(row.planned_hours)
                        ? "#dc2626"
                        : "#2563eb",
                  }}
                />
              </td>
              <td style={{ ...cell, whiteSpace: "nowrap" }}>
                <button
                  onClick={() => saveNew(idx)}
                  disabled={saving["n" + idx]}
                  style={{
                    padding: "3px 10px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 12,
                    marginRight: 4,
                  }}
                >
                  {saving["n" + idx] ? "…" : "✓ Save"}
                </button>
                <button
                  onClick={() => cancelNew(idx)}
                  style={{
                    padding: "3px 8px",
                    background: "#f1f5f9",
                    border: "1px solid #e2e8f0",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}

          {/* Existing rows */}
          {rows.length === 0 && newRows.length === 0 && (
            <tr>
              <td
                colSpan={10}
                style={{ padding: 28, textAlign: "center", color: "#94a3b8" }}
              >
                {canManage
                  ? "No plans yet. Click + Add Plan Row to create."
                  : "No work plan assigned to you yet."}
              </td>
            </tr>
          )}
          {rows.map((row, i) => {
            const ed = editRows[row.id];
            const isEditing = !!ed;
            const isDayOff = ["Sat", "Sun"].includes(row.day ?? "");
            return (
              <tr
                key={row.id}
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  background: isEditing
                    ? "#fffbeb"
                    : isDayOff
                      ? "#fafafa"
                      : "#fff",
                  opacity: isDayOff ? 0.7 : 1,
                }}
              >
                <td style={{ ...cell, color: "#94a3b8", fontSize: 12 }}>
                  {i + 1}
                </td>
                {showMember && (
                  <td style={{ ...cell, fontWeight: 600, color: "#7c3aed" }}>
                    {row.assigned_to}
                  </td>
                )}
                <td
                  style={{
                    ...cell,
                    color: isDayOff ? "#ef4444" : "#64748b",
                    fontWeight: isDayOff ? 700 : 400,
                  }}
                >
                  {isEditing ? getDayName(ed.date ?? "") : row.day}
                </td>
                <td style={{ ...cell, minWidth: 120 }}>
                  {isEditing ? (
                    <input
                      type="date"
                      value={ed.date}
                      onChange={(e) => setEdit(row.id, "date", e.target.value)}
                      style={inStyle}
                    />
                  ) : (
                    <span style={{ color: "#475569" }}>{row.date}</span>
                  )}
                </td>
                <td style={{ ...cell, minWidth: 120 }}>
                  {isEditing ? (
                    <select
                      value={ed.client || ""}
                      onChange={(e) =>
                        setEdit(row.id, "client", e.target.value)
                      }
                      style={{ ...inStyle, cursor: "pointer" }}
                    >
                      <option value="">— Client —</option>
                      {clients.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : row.client ? (
                    <span
                      style={{
                        background: "#eff6ff",
                        color: "#2563eb",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {row.client}
                    </span>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>—</span>
                  )}
                </td>
                <td style={{ ...cell, minWidth: 250 }}>
                  {isEditing ? (
                    <input
                      type="text"
                      value={ed.task_description || ""}
                      onChange={(e) =>
                        setEdit(row.id, "task_description", e.target.value)
                      }
                      style={inStyle}
                    />
                  ) : (
                    row.task_description
                  )}
                </td>
                <td style={{ ...cell, minWidth: 100 }}>
                  {isEditing ? (
                    <input
                      type="text"
                      value={ed.planned_hours || ""}
                      onChange={(e) =>
                        setEdit(row.id, "planned_hours", e.target.value)
                      }
                      placeholder="H:MM"
                      maxLength={6}
                      style={{
                        ...inStyle,
                        borderColor:
                          ed.planned_hours && !validTime(ed.planned_hours ?? "")
                            ? "#dc2626"
                            : "#2563eb",
                      }}
                    />
                  ) : (
                    <span style={{ fontWeight: 700, color: "#2563eb" }}>
                      {row.planned_hours || "—"}
                    </span>
                  )}
                </td>
                {canManage && (
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => saveEdit(row.id)}
                          disabled={saving[row.id]}
                          style={{
                            padding: "3px 10px",
                            background: "#16a34a",
                            color: "#fff",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: 12,
                            marginRight: 4,
                          }}
                        >
                          {saving[row.id] ? "…" : "✓ Save"}
                        </button>
                        <button
                          onClick={() => cancelEdit(row.id)}
                          style={{
                            padding: "3px 8px",
                            background: "#f1f5f9",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(row)}
                          style={{
                            padding: "3px 10px",
                            border: "1px solid #e2e8f0",
                            background: "#f8fafc",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                            marginRight: 4,
                          }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => deletePlan(row.id)}
                          style={{
                            padding: "3px 8px",
                            border: "1px solid #fecaca",
                            background: "#fff1f2",
                            color: "#dc2626",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const totalPlannedMins = filtered.reduce(
    (s, p) => s + toMins(p.planned_hours ?? ""),
    0,
  );

  return (
    <div>
      {/* Info banner */}
      <div
        style={{
          background: canManage ? "#eff6ff" : "#f0fdf4",
          border: `1px solid ${canManage ? "#bfdbfe" : "#bbf7d0"}`,
          borderRadius: 8,
          padding: "10px 16px",
          marginBottom: 14,
          fontSize: 13,
          color: canManage ? "#1e40af" : "#166534",
        }}
      >
        {canManage
          ? "📅 Create work plans for your team. Employees will see their assigned plan in this tab."
          : "📅 This is your work plan assigned by your manager. It shows your scheduled tasks by date."}
      </div>

      {/* Filters + actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
          padding: "10px 12px",
          background: "#f8fafc",
          borderRadius: 8,
          alignItems: "flex-end",
        }}
      >
        {canManage && (
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                marginBottom: 3,
              }}
            >
              EMPLOYEE
            </div>
            <select
              value={selMember}
              onChange={(e) => setSelMember(e.target.value)}
              style={{
                padding: "6px 10px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              <option value="">All Members</option>
              {managedMembers.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              marginBottom: 3,
            }}
          >
            MONTH
          </div>
          <select
            value={fMonth}
            onChange={(e) => setFMonth(e.target.value)}
            style={{
              padding: "6px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <option value="">All Months</option>
            {allMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              marginBottom: 3,
            }}
          >
            CLIENT
          </div>
          <select
            value={fClient}
            onChange={(e) => setFClient(e.target.value)}
            style={{
              padding: "6px 10px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 13,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <option value="">All Clients</option>
            {allClients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {(selMember || fMonth || fClient) && (
          <button
            onClick={() => {
              setSelMember("");
              setFMonth("");
              setFClient("");
            }}
            style={{
              padding: "6px 10px",
              border: "1px solid #e2e8f0",
              background: "#fff",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ✕ Clear
          </button>
        )}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "#475569",
              fontWeight: 600,
              paddingBottom: 6,
            }}
          >
            {filtered.length} plans ·{" "}
            <span style={{ color: "#2563eb" }}>
              {fromMins(totalPlannedMins)} planned hrs
            </span>
          </div>
          {/* View toggle */}
          <div
            style={{
              display: "flex",
              border: "1.5px solid #e2e8f0",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {(
              [
                ["list", "☰ List"],
                ["calendar", "📅 Calendar"],
              ] as [string, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setPlanView(v as "list" | "calendar")}
                style={{
                  padding: "5px 12px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                  background: planView === v ? "#2563eb" : "#fff",
                  color: planView === v ? "#fff" : "#475569",
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {canManage && planView === "list" && (
            <button
              onClick={addNewRow}
              style={{
                padding: "6px 14px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              + Add Plan Row
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ textAlign: "center", color: "#94a3b8", padding: 30 }}>
          Loading…
        </p>
      ) : planView === "calendar" ? (
        <WorkPlanCalendar
          plans={filtered}
          calMonth={calMonth}
          setCalMonth={setCalMonth}
          allMemberNames={managedMembers.map((m) => m.name)}
        />
      ) : canManage && !selMember ? (
        // Admin/Manager — All employees grouped
        Object.keys(byMember).length === 0 && newRows.length === 0 ? (
          renderTable([], true)
        ) : (
          <>
            {/* New rows always on top */}
            {newRows.length > 0 && renderTable([], true)}
            {Object.entries(byMember).map(([name, rows]) => (
              <div key={name} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#7c3aed",
                    padding: "8px 4px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "#7c3aed",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {name.slice(0, 2).toUpperCase()}
                  </span>
                  {name}
                  <span
                    style={{ fontSize: 12, color: "#94a3b8", fontWeight: 400 }}
                  >
                    — {(rows as WorkPlan[]).length} tasks ·{" "}
                    {fromMins(
                      (rows as WorkPlan[]).reduce(
                        (s, r) => s + toMins(r.planned_hours ?? ""),
                        0,
                      ),
                    )}{" "}
                    hrs
                  </span>
                </div>
                {renderTable(rows as WorkPlan[], false)}
              </div>
            ))}
          </>
        )
      ) : (
        // Single member selected or employee view
        renderTable(filtered, canManage && !selMember)
      )}
    </div>
  );
}

// ── Drill-down Modal ───────────────────────────────────────────────────────
function DrillModal({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: WorkLog[];
  onClose: () => void;
}) {
  const totalMins = rows.reduce((s, r) => s + toMins(r.hours_worked ?? ""), 0);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          width: "90vw",
          maxWidth: 860,
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
            <span style={{ fontSize: 13, color: "#64748b", marginLeft: 8 }}>
              {rows.length} entries ·{" "}
              <span style={{ color: "#2563eb", fontWeight: 700 }}>
                {fromMins(totalMins)} hrs
              </span>
            </span>
          </div>
          <button
            onClick={onClose}
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
        {/* Table */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {rows.length === 0 ? (
            <p style={{ textAlign: "center", color: "#94a3b8", padding: 32 }}>
              No entries.
            </p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  background: "#f8fafc",
                  zIndex: 1,
                }}
              >
                <tr>
                  {[
                    "#",
                    "Name",
                    "Date",
                    "Client",
                    "Task Description",
                    "Hours",
                    "Priority",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 12px",
                        textAlign: "left",
                        fontWeight: 700,
                        color: "#475569",
                        fontSize: 12,
                        borderBottom: "2px solid #e2e8f0",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const pr = getPr(r.priority ?? "Normal");
                  return (
                    <tr
                      key={r.id || i}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        background: i % 2 === 0 ? "#fff" : "#fafafa",
                      }}
                    >
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#94a3b8",
                          fontSize: 12,
                        }}
                      >
                        {i + 1}
                      </td>
                      <td style={{ padding: "7px 12px", fontWeight: 600 }}>
                        {r.name}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#64748b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.date}{" "}
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          ({r.day})
                        </span>
                      </td>
                      <td style={{ padding: "7px 12px" }}>
                        {r.client ? (
                          <span
                            style={{
                              background: "#eff6ff",
                              color: "#2563eb",
                              padding: "2px 8px",
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {r.client}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "7px 12px", minWidth: 200 }}>
                        {r.task_description}
                      </td>
                      <td
                        style={{
                          padding: "7px 12px",
                          fontWeight: 700,
                          color: "#2563eb",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.hours_worked || "—"}
                      </td>
                      <td style={{ padding: "7px 12px" }}>
                        <span
                          style={{
                            background: pr.badgeBg,
                            color: pr.badge,
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {r.priority || "Normal"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Work Log Dashboard ─────────────────────────────────────────────────────
function WorkLogDashboard({
  logs,
  isAdmin,
  isManager,
  myName,
}: {
  logs: WorkLog[];
  isAdmin: boolean;
  isManager: boolean;
  myName: string;
}) {
  const [dMonth, setDMonth] = useState("");
  const [drill, setDrill] = useState<DrillState | null>(null);

  const visible = useMemo(() => {
    let l = logs;
    if (!isAdmin && !isManager) l = l.filter((r) => r.name === myName);
    if (dMonth) l = l.filter((r) => (r.date || "").startsWith(dMonth));
    return l;
  }, [logs, isAdmin, isManager, myName, dMonth]);

  const allMonths = [
    ...new Set(logs.map((r) => (r.date || "").slice(0, 7)).filter(Boolean)),
  ]
    .sort()
    .reverse();
  const totalMins = visible.reduce(
    (s, r) => s + toMins(r.hours_worked ?? ""),
    0,
  );

  // Member stats
  const memberStats = useMemo(() => {
    const map: Record<
      string,
      {
        name: string;
        mins: number;
        count: number;
        days: Set<string>;
        clients: Set<string>;
      }
    > = {};
    visible.forEach((r) => {
      if (!r.name) return;
      if (!map[r.name])
        map[r.name] = {
          name: r.name,
          mins: 0,
          count: 0,
          days: new Set(),
          clients: new Set(),
        };
      map[r.name].mins += toMins(r.hours_worked ?? "");
      map[r.name].count += 1;
      map[r.name].days.add(r.date ?? "");
      if (r.client) map[r.name].clients.add(r.client);
    });
    return Object.values(map).sort((a, b) => b.mins - a.mins);
  }, [visible]);

  // Client stats
  const clientStats = useMemo(() => {
    const map: Record<
      string,
      { client: string; mins: number; count: number; members: Set<string> }
    > = {};
    visible.forEach((r) => {
      const c = r.client || "No Client";
      if (!map[c])
        map[c] = { client: c, mins: 0, count: 0, members: new Set() };
      map[c].mins += toMins(r.hours_worked ?? "");
      map[c].count += 1;
      map[c].members.add(r.name);
    });
    return Object.values(map).sort((a, b) => b.mins - a.mins);
  }, [visible]);

  // Priority stats
  const prioStats = useMemo(
    () =>
      PRIORITIES.map((p) => ({
        ...p,
        count: visible.filter((r) => r.priority === p.value).length,
      })),
    [visible],
  );

  // Daily trend (last 14 days)
  const dailyStats = useMemo(() => {
    const map: Record<string, { date: string; mins: number; count: number }> =
      {};
    visible.forEach((r) => {
      if (!r.date) return;
      if (!map[r.date]) map[r.date] = { date: r.date, mins: 0, count: 0 };
      map[r.date].mins += toMins(r.hours_worked ?? "");
      map[r.date].count += 1;
    });
    return Object.values(map)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);
  }, [visible]);

  const maxDayMins = Math.max(...dailyStats.map((d) => d.mins), 1);
  const card = (c: string) => ({
    background: "#fff",
    borderRadius: 10,
    padding: "16px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    borderTop: `4px solid ${c}`,
  });

  return (
    <div>
      {/* Month filter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>
          Month:
        </span>
        {["", ...allMonths].map((m) => (
          <button
            key={m || "all"}
            onClick={() => setDMonth(m)}
            style={{
              padding: "4px 12px",
              borderRadius: 16,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              background: dMonth === m ? "#2563eb" : "#f1f5f9",
              color: dMonth === m ? "#fff" : "#64748b",
            }}
          >
            {m || "All Time"}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={card("#2563eb")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#2563eb" }}>
            {fromMins(totalMins)}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Total Hours
          </div>
        </div>
        <div style={card("#16a34a")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#16a34a" }}>
            {visible.length}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Total Entries
          </div>
        </div>
        <div style={card("#7c3aed")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#7c3aed" }}>
            {memberStats.length}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Active Members
          </div>
        </div>
        <div style={card("#d97706")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#d97706" }}>
            {clientStats.filter((c) => c.client !== "No Client").length}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Clients Served
          </div>
        </div>
        {prioStats
          .filter((p) => p.count > 0)
          .map((p) => (
            <div key={p.value} style={card(p.badge)}>
              <div style={{ fontSize: 28, fontWeight: 800, color: p.badge }}>
                {p.count}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {p.value}
              </div>
            </div>
          ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        {/* Member performance */}
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            👤 Member Performance
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            Click member name or any value to view entries
          </div>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Member", "Entries", "Hours", "Days", "Clients"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "7px 10px",
                      textAlign: "left",
                      fontWeight: 700,
                      color: "#475569",
                      fontSize: 12,
                      borderBottom: "2px solid #e2e8f0",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {memberStats.map((m, i) => {
                const memberRows = visible.filter((r) => r.name === m.name);
                const openMember = () =>
                  setDrill({
                    title: `👤 ${m.name} — Work Log`,
                    rows: memberRows,
                  });
                return (
                  <tr
                    key={m.name}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: i % 2 === 0 ? "#fff" : "#fafafa",
                      cursor: "pointer",
                    }}
                    onClick={openMember}
                    title="Click to view all entries"
                  >
                    <td
                      style={{
                        padding: "7px 10px",
                        fontWeight: 700,
                        color: "#2563eb",
                        textDecoration: "underline",
                      }}
                    >
                      {m.name}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#2563eb",
                        fontWeight: 600,
                        textDecoration: "underline",
                      }}
                    >
                      {m.count}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontWeight: 700,
                        color: "#2563eb",
                        textDecoration: "underline",
                      }}
                    >
                      {fromMins(m.mins)}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#64748b" }}>
                      {m.days.size}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#64748b" }}>
                      {m.clients.size}
                    </td>
                  </tr>
                );
              })}
              {memberStats.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: 16,
                      textAlign: "center",
                      color: "#94a3b8",
                    }}
                  >
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Client performance */}
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            🏢 Client-wise Hours
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            Click client name to view entries
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {clientStats.map((c) => {
              const pct = Math.round((c.mins / Math.max(totalMins, 1)) * 100);
              const clientRows = visible.filter(
                (r) => (r.client || "No Client") === c.client,
              );
              return (
                <div
                  key={c.client}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <button
                    onClick={() =>
                      setDrill({
                        title: `🏢 ${c.client} — Work Log`,
                        rows: clientRows,
                      })
                    }
                    style={{
                      width: 110,
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#2563eb",
                      background: "none",
                      border: "none",
                      padding: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      textDecoration: "underline",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                    title={`Click to view ${c.client} entries`}
                  >
                    {c.client}
                  </button>
                  <div
                    style={{
                      flex: 1,
                      height: 10,
                      background: "#e5e7eb",
                      borderRadius: 5,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: "#2563eb",
                        borderRadius: 5,
                        minWidth: 4,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#2563eb",
                      minWidth: 42,
                      textAlign: "right",
                    }}
                  >
                    {fromMins(c.mins)}
                  </span>
                  <span
                    style={{ fontSize: 11, color: "#94a3b8", minWidth: 28 }}
                  >
                    {pct}%
                  </span>
                </div>
              );
            })}
            {clientStats.length === 0 && (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No data</p>
            )}
          </div>
        </div>
      </div>

      {/* Drill-down modal */}
      {drill && (
        <DrillModal
          title={drill.title}
          rows={drill.rows}
          onClose={() => setDrill(null)}
        />
      )}

      {/* Daily trend */}
      {dailyStats.length > 0 && (
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
            📅 Daily Hours Trend (last {dailyStats.length} days)
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              height: 100,
            }}
          >
            {dailyStats.map((d) => {
              const h = Math.max(Math.round((d.mins / maxDayMins) * 90), 4);
              return (
                <div
                  key={d.date}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                  }}
                  title={`${d.date}: ${fromMins(d.mins)} hrs (${d.count} entries)`}
                >
                  <span
                    style={{ fontSize: 10, color: "#2563eb", fontWeight: 700 }}
                  >
                    {fromMins(d.mins)}
                  </span>
                  <div
                    style={{
                      width: "100%",
                      height: h,
                      background: "#2563eb",
                      borderRadius: "4px 4px 0 0",
                      minHeight: 4,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 9,
                      color: "#94a3b8",
                      transform: "rotate(-35deg)",
                      transformOrigin: "top center",
                      whiteSpace: "nowrap",
                      marginTop: 4,
                    }}
                  >
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
