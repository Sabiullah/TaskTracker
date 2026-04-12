import { useState, useRef, type ChangeEvent } from "react";
import {
  CLIENTS as DEFAULT_CLIENTS,
  CATEGORIES as DEFAULT_CATEGORIES,
  TEAM_MEMBERS,
  COLUMNS,
  AVATAR_COLORS,
} from "@/constants";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import type {
  HeaderProps,
  HeaderFilters,
  HeaderImportTask,
  BackupFile,
  RestoreLogEntry,
  ImportMode,
  RestoreMode,
  ViewId,
} from "@/types/header";

// Always read live from localStorage (same source as Masters page)
function loadCategories(): string[] {
  try {
    const stored = localStorage.getItem("tt_cats");
    if (stored) {
      const parsed = JSON.parse(stored) as ({ name?: string } | string)[];
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed
          .map((c) => (typeof c === "string" ? c : c.name || ""))
          .filter(Boolean)
          .sort();
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_CATEGORIES].sort();
}

function loadClients(): string[] {
  try {
    const stored = localStorage.getItem("tt_clients");
    if (stored) {
      const parsed = JSON.parse(stored) as ({ name?: string } | string)[];
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed
          .map((c) => (typeof c === "string" ? c : c.name || ""))
          .filter(Boolean)
          .sort();
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_CLIENTS].sort();
}

/** Convert various date formats to YYYY-MM-DD, or '' if invalid/empty */
const MONTH_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};
function parseDate(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY (numeric month)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy)
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  // DD-MMM-YY or DD-MMM-YYYY e.g. 09-Apr-26, 09-Apr-2026, 9 Apr 2026
  const dmyText = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{2,4})$/);
  if (dmyText) {
    const day = dmyText[1].padStart(2, "0");
    const mon = MONTH_MAP[dmyText[2].toLowerCase()];
    let yr = dmyText[3];
    if (yr.length === 2) yr = (parseInt(yr) >= 50 ? "19" : "20") + yr;
    if (mon) return `${yr}-${mon}-${day}`;
  }

  // Fallback: native Date parse
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1970)
    return d.toISOString().slice(0, 10);
  return "";
}

/** Split a single CSV line correctly — handles quoted fields with commas inside */
function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "",
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } // escaped quote
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseCSV(text: string): HeaderImportTask[] | null {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return null;
  const headers = splitCSVLine(lines[0]).map((h) =>
    h.replace(/"/g, "").trim().toLowerCase(),
  );
  const tasks: HeaderImportTask[] = [];
  const col = (arr: string[], ...names: string[]) =>
    arr.findIndex((h) => names.some((n) => h.includes(n)));
  const iSNo = col(headers, "s no", "sno", "#");
  const iCli = col(headers, "client");
  const iCat = col(headers, "category");
  const iDesc = col(headers, "description", "desc");
  const iStat = col(headers, "status");
  const iTgt = col(headers, "target");
  const iExp = col(headers, "expected");
  const iComp = col(headers, "comp");
  const iResp = col(headers, "responsible");
  const iRem = col(headers, "remark");
  const iRec = col(headers, "recurrence", "recur");

  const VALID_RECURRENCE = [
    "Onetime",
    "Monthly",
    "Quarterly",
    "Halfyearly",
    "Yearly",
  ];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i]).map((c) =>
      c.replace(/^"|"$/g, "").trim(),
    );
    if (cells.every((c) => !c)) continue;
    const rawStatus = iStat >= 0 ? cells[iStat] || "Pending" : "Pending";
    const matchedStatus =
      COLUMNS.find(
        (c: (typeof COLUMNS)[0]) =>
          c.id.toLowerCase() === rawStatus.toLowerCase(),
      )?.id || "Pending";
    const rawRec = iRec >= 0 ? cells[iRec] || "Onetime" : "Onetime";
    const matchedRec =
      VALID_RECURRENCE.find((r) => r.toLowerCase() === rawRec.toLowerCase()) ||
      "Onetime";
    tasks.push({
      id: `task-${Date.now()}-${i}`,
      s_no: iSNo >= 0 ? parseInt(cells[iSNo]) || i : i,
      client: iCli >= 0 ? cells[iCli] || "" : "",
      category: iCat >= 0 ? cells[iCat] || "" : "",
      description: iDesc >= 0 ? cells[iDesc] || "" : "",
      status: matchedStatus,
      target_date: iTgt >= 0 ? parseDate(cells[iTgt]) : "",
      expected_date: iExp >= 0 ? parseDate(cells[iExp]) : "",
      comp_date: iComp >= 0 ? parseDate(cells[iComp]) : "",
      responsible: iResp >= 0 ? cells[iResp] || "" : "",
      remarks: iRem >= 0 ? cells[iRem] || "" : "",
      recurrence: matchedRec,
    });
  }
  return tasks.length ? tasks : null;
}

export default function Header({
  view,
  onViewChange,
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  onAddTask,
  onImport,
  profile,
  onSignOut,
  onOpenAdmin,
  adminEmployee,
  onClearAdminFilter,
  theme,
  onToggleTheme,
  memberOptions,
  hasInvoiceAccess,
  hasNoticeAccess,
}: HeaderProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importErr, setImportErr] = useState("");
  const [importMode, setImportMode] = useState<ImportMode>("update");
  // const [backingUp, setBackingUp] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("upsert");
  const [restoreData, setRestoreData] = useState<BackupFile | null>(null);
  const [restoreFileName, setRestoreFileName] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreLog, setRestoreLog] = useState<RestoreLogEntry[]>([]);
  const [restoreDone, setRestoreDone] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const restoreRef = useRef<HTMLInputElement | null>(null);

  /* ── One-click full backup ── */
  // const handleBackup = async () => {
  //   setBackingUp(true);
  //   try {
  //     const TABLES = [
  //       "tasks",
  //       "profiles",
  //       "work_logs",
  //       "leads",
  //       "lead_statuses",
  //       "invoice_plans",
  //       "invoice_entries",
  //       "invoice_access",
  //       "notices",
  //       "notice_access",
  //       "chat_rooms",
  //       "chat_members",
  //       "chat_messages",
  //     ];
  //     const backup: BackupFile = {
  //       exported_at: new Date().toISOString(),
  //       tables: {},
  //     };
  //     await Promise.all(
  //       TABLES.map(async (t) => {
  //         try {
  //           backup.tables[t] = await apiGet<Record<string, unknown>[]>(
  //             `/${t}/`,
  //           );
  //         } catch {
  //           backup.tables[t] = [];
  //         }
  //       }),
  //     );
  //     const blob = new Blob([JSON.stringify(backup, null, 2)], {
  //       type: "application/json",
  //     });
  //     const url = URL.createObjectURL(blob);
  //     const a = document.createElement("a");
  //     a.href = url;
  //     a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
  //     a.click();
  //     URL.revokeObjectURL(url);
  //   } catch (error) {
  //     alert(
  //       "Backup failed: " +
  //         (error instanceof Error ? error.message : String(error)),
  //     );
  //   }
  //   setBackingUp(false);
  // };

  /* ── Restore: read JSON file ── */
  const handleRestoreFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result;
        if (typeof text !== "string") {
          alert("Could not read backup file.");
          return;
        }
        const parsed = JSON.parse(text) as BackupFile;
        if (!parsed.tables) {
          alert('Invalid backup file — missing "tables" key.');
          return;
        }
        setRestoreData(parsed);
        setRestoreLog([]);
        setRestoreDone(false);
      } catch {
        alert("Could not parse JSON. Please select a valid backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  /* ── Restore: upsert or replace all tables ── */
  const handleRestore = async () => {
    if (!restoreData) return;
    const TABLES = [
      "tasks",
      "profiles",
      "work_logs",
      "leads",
      "lead_statuses",
      "invoice_plans",
      "invoice_entries",
      "invoice_access",
      "notices",
      "notice_access",
      "chat_rooms",
      "chat_members",
      "chat_messages",
    ];

    setRestoring(true);
    setRestoreLog([]);
    setRestoreDone(false);

    const log: RestoreLogEntry[] = [];
    for (const t of TABLES) {
      const rows = restoreData.tables[t];
      if (!rows || !Array.isArray(rows)) {
        log.push({ table: t, status: "skipped", msg: "Not in backup file" });
        setRestoreLog([...log]);
        continue;
      }
      if (rows.length === 0) {
        log.push({ table: t, status: "skipped", msg: "0 rows in backup" });
        setRestoreLog([...log]);
        continue;
      }
      try {
        if (restoreMode === "replace") {
          const existing = await apiGet<Record<string, unknown>[]>(`/${t}/`);
          await Promise.all(existing.map((r) => apiDelete(`/${t}/${r.id}/`)));
          for (const row of rows) await apiPost(`/${t}/`, row);
        } else {
          for (const row of rows) {
            try {
              await apiPost(`/${t}/`, row);
            } catch {
              await apiPost(`/${t}/${row.id}/`, row);
            }
          }
        }
        log.push({
          table: t,
          status: "ok",
          msg: `${rows.length} rows restored`,
        });
      } catch (err) {
        log.push({
          table: t,
          status: "error",
          msg: err instanceof Error ? err.message : String(err),
        });
      }
      setRestoreLog([...log]);
    }
    setRestoring(false);
    setRestoreDone(true);
  };

  const closeRestoreModal = () => {
    if (restoring) return;
    setRestoreOpen(false);
    setRestoreData(null);
    setRestoreFileName("");
    setRestoreLog([]);
    setRestoreDone(false);
    setRestoreMode("upsert");
  };

  const setFilter = (key: keyof HeaderFilters, val: string) =>
    onFiltersChange((prev) => ({ ...prev, [key]: val }));
  const clearFilters = () => {
    onFiltersChange({ client: "", category: "", responsible: "" });
    onSearchChange("");
    if (onClearAdminFilter) onClearAdminFilter();
  };
  const hasFilter =
    filters.client ||
    filters.category ||
    filters.responsible ||
    search ||
    adminEmployee;

  const handleImportSubmit = () => {
    const parsed = parseCSV(csvText);
    if (!parsed) {
      setImportErr("Could not parse CSV. Make sure it has headers.");
      return;
    }
    onImport(parsed, importMode);
    setImportOpen(false);
    setCsvText("");
    setImportErr("");
    setImportMode("update");
  };

  const handleFileRead = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") setCsvText(text);
    };
    reader.readAsText(file);
  };

  const myName = profile?.full_name || profile?.name || "";
  const avatarColor = profile ? AVATAR_COLORS[myName] || "#0052cc" : "#0052cc";
  const initials = myName
    ? myName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const isAdmin = profile?.role === "admin";

  const NAV_TABS: { id: ViewId; label: string }[] = [
    { id: "board", label: "📋 Board" },
    { id: "dashboard", label: "📊 Dashboard" },
    { id: "calendar", label: "📅 Calendar" },
    { id: "worklog", label: "📝 Work Log" },
    { id: "leads", label: "🎯 Leads" },
    ...(hasNoticeAccess
      ? [{ id: "notice" as ViewId, label: "📋 Notice" }]
      : []),
    ...(hasInvoiceAccess
      ? [{ id: "invoice" as ViewId, label: "🧾 Invoice" }]
      : []),
    ...(isAdmin
      ? [
          { id: "masters" as ViewId, label: "⚙️ Masters" },
          { id: "users" as ViewId, label: "👥 Users" },
        ]
      : []),
  ];

  return (
    <>
      <header className="header">
        {/* Logo */}
        <div className="header-logo">
          <div className="header-logo-icon">📋</div>
          Task Tracker
        </div>

        {/* Search — only on board */}
        {view === "board" && (
          <div className="header-search">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        )}

        {/* Filters — only on board */}
        {view === "board" && (
          <div className="header-filters">
            <select
              value={filters.client}
              onChange={(e) => setFilter("client", e.target.value)}
            >
              <option value="">All Clients</option>
              {loadClients().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filters.category}
              onChange={(e) => setFilter("category", e.target.value)}
            >
              <option value="">All Categories</option>
              {loadCategories().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={adminEmployee || filters.responsible}
              onChange={(e) => {
                if (onClearAdminFilter) onClearAdminFilter();
                setFilter("responsible", e.target.value);
              }}
            >
              <option value="">All Members</option>
              {(memberOptions || TEAM_MEMBERS).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {hasFilter && (
              <button
                className="btn-header"
                onClick={clearFilters}
                title="Clear all filters"
              >
                ✕ Clear
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="header-actions">
          {isAdmin && (
            <>
              {/* <button
                className="btn-header"
                onClick={handleBackup}
                disabled={backingUp}
                title="Download full backup of all data (JSON)"
                style={{
                  background: "rgba(22,163,74,.85)",
                  fontWeight: 700,
                  opacity: backingUp ? 0.7 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                {backingUp ? "⏳ Backing up…" : "💾 Backup"}
              </button> */}
              <button
                className="btn-header"
                onClick={() => setRestoreOpen(true)}
                title="Restore data from a backup JSON file"
                style={{
                  background: "rgba(37,99,235,.85)",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                📥 Restore
              </button>
            </>
          )}
          {isAdmin && view === "board" && (
            <button
              className="btn-header"
              onClick={onOpenAdmin}
              style={{ background: "rgba(255,255,255,.28)", fontWeight: 600 }}
            >
              👑 Admin
            </button>
          )}
          {view === "board" && (
            <>
              <button
                className="btn-header"
                onClick={() => setImportOpen(true)}
              >
                ⬆ Import
              </button>
              <button className="btn-header primary" onClick={onAddTask}>
                + Add Task
              </button>
            </>
          )}
          {/* Dark / Light toggle */}
          <button
            className="btn-header"
            onClick={onToggleTheme}
            title={
              theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"
            }
            style={{ fontSize: 16, padding: "5px 10px", letterSpacing: 0 }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {profile && (
            <div className="user-info" title={`${myName} (${profile.role})`}>
              <div
                className="avatar"
                style={{
                  background: avatarColor,
                  width: 28,
                  height: 28,
                  fontSize: 12,
                }}
              >
                {initials}
              </div>
              <span className="user-name">{myName}</span>
              {isAdmin && <span className="user-role-badge">Admin</span>}
              <button
                className="btn-header"
                onClick={onSignOut}
                style={{ padding: "4px 10px", fontSize: 12 }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Tab Navigation */}
      <nav
        style={{
          background: "#005a8e",
          borderBottom: "1px solid rgba(255,255,255,.15)",
          display: "flex",
          gap: 2,
          padding: "0 16px",
        }}
      >
        {NAV_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onViewChange(tab.id)}
            style={{
              padding: "8px 16px",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background:
                view === tab.id ? "rgba(255,255,255,.2)" : "transparent",
              color: view === tab.id ? "#fff" : "rgba(255,255,255,.75)",
              borderBottom:
                view === tab.id ? "2px solid #fff" : "2px solid transparent",
              borderRadius: 0,
              transition: "all .15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {adminEmployee && view === "board" && (
        <div className="admin-filter-banner">
          Showing tasks for <strong>{adminEmployee}</strong>
          <button
            className="login-link"
            style={{ marginLeft: 10 }}
            onClick={onClearAdminFilter}
          >
            ✕ Show all
          </button>
        </div>
      )}

      {/* ── Restore Backup Modal ── */}
      {restoreOpen && (
        <div className="overlay" onClick={closeRestoreModal}>
          <div
            className="modal"
            style={{ width: 580 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <span className="modal-title">📥 Restore from Backup</span>
              <button
                className="modal-close"
                onClick={closeRestoreModal}
                disabled={restoring}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {/* Step 1: File upload */}
              {!restoreDone && (
                <>
                  <div
                    style={{
                      background: "#fef3c7",
                      border: "1px solid #fbbf24",
                      borderRadius: 8,
                      padding: "10px 14px",
                      marginBottom: 14,
                      fontSize: 12,
                      color: "#92400e",
                    }}
                  >
                    ⚠️ <strong>Important:</strong> Only restore from a backup
                    file generated by this tool. Incorrect files may corrupt
                    data.
                  </div>

                  {/* Mode selection */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                      marginBottom: 14,
                    }}
                  >
                    {[
                      {
                        value: "upsert",
                        icon: "✅",
                        title: "UPSERT (Safe)",
                        sub: "Adds new rows & updates existing ones by ID.\nNo data is deleted — safest option.",
                      },
                      {
                        value: "replace",
                        icon: "⚠️",
                        title: "REPLACE (Full Reset)",
                        sub: "Deletes ALL current data in each table first,\nthen inserts from backup. Cannot be undone.",
                      },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          padding: "12px 14px",
                          borderRadius: 8,
                          cursor: "pointer",
                          border: `2px solid ${restoreMode === opt.value ? "#2563eb" : "#e2e8f0"}`,
                          background:
                            restoreMode === opt.value ? "#eff6ff" : "#fff",
                          transition: "all .15s",
                        }}
                      >
                        <input
                          type="radio"
                          name="restoreMode"
                          value={opt.value}
                          checked={restoreMode === opt.value}
                          onChange={() =>
                            setRestoreMode(opt.value as RestoreMode)
                          }
                          style={{ marginTop: 3, accentColor: "#2563eb" }}
                        />
                        <div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color:
                                restoreMode === opt.value
                                  ? "#2563eb"
                                  : "#1e293b",
                            }}
                          >
                            {opt.icon} {opt.title}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#64748b",
                              marginTop: 2,
                              lineHeight: 1.5,
                              whiteSpace: "pre-line",
                            }}
                          >
                            {opt.sub}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  {/* File picker */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 14,
                    }}
                  >
                    <button
                      className="btn btn-secondary"
                      onClick={() => restoreRef.current?.click()}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      📂 Choose backup file
                    </button>
                    <input
                      ref={restoreRef}
                      type="file"
                      accept=".json"
                      style={{ display: "none" }}
                      onChange={handleRestoreFile}
                    />
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      {restoreFileName
                        ? `✅ ${restoreFileName}`
                        : "Select a .json backup file"}
                    </span>
                  </div>

                  {/* Backup info */}
                  {restoreData && (
                    <div
                      style={{
                        background: "#f0fdf4",
                        border: "1px solid #86efac",
                        borderRadius: 8,
                        padding: "10px 14px",
                        marginBottom: 14,
                        fontSize: 12,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          color: "#15803d",
                          marginBottom: 6,
                        }}
                      >
                        📋 Backup File Info
                      </div>
                      <div style={{ color: "#166534" }}>
                        📅 Exported:{" "}
                        <strong>
                          {new Date(restoreData.exported_at).toLocaleString()}
                        </strong>
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "4px 12px",
                        }}
                      >
                        {Object.entries(restoreData.tables).map(([t, rows]) => (
                          <span
                            key={t}
                            style={{ fontSize: 11, color: "#475569" }}
                          >
                            <strong>{t}</strong>: {rows.length} rows
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Progress log while restoring */}
                  {restoreLog.length > 0 && (
                    <div
                      style={{
                        maxHeight: 180,
                        overflowY: "auto",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        padding: "10px 14px",
                        fontSize: 12,
                      }}
                    >
                      {restoreLog.map((entry, i) => (
                        <div
                          key={i}
                          style={{ display: "flex", gap: 8, marginBottom: 3 }}
                        >
                          <span>
                            {entry.status === "ok"
                              ? "✅"
                              : entry.status === "error"
                                ? "❌"
                                : "⏭️"}
                          </span>
                          <span style={{ fontWeight: 700, minWidth: 160 }}>
                            {entry.table}
                          </span>
                          <span
                            style={{
                              color:
                                entry.status === "error"
                                  ? "#dc2626"
                                  : "#475569",
                            }}
                          >
                            {entry.msg}
                          </span>
                        </div>
                      ))}
                      {restoring && (
                        <div style={{ color: "#2563eb", marginTop: 4 }}>
                          ⏳ Restoring, please wait…
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Done state */}
              {restoreDone && (
                <div>
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 32,
                      marginBottom: 8,
                    }}
                  >
                    🎉
                  </div>
                  <div
                    style={{
                      textAlign: "center",
                      fontWeight: 700,
                      color: "#15803d",
                      marginBottom: 14,
                      fontSize: 15,
                    }}
                  >
                    Restore Complete!
                  </div>
                  <div
                    style={{
                      maxHeight: 220,
                      overflowY: "auto",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "10px 14px",
                      fontSize: 12,
                    }}
                  >
                    {restoreLog.map((entry, i) => (
                      <div
                        key={i}
                        style={{ display: "flex", gap: 8, marginBottom: 3 }}
                      >
                        <span>
                          {entry.status === "ok"
                            ? "✅"
                            : entry.status === "error"
                              ? "❌"
                              : "⏭️"}
                        </span>
                        <span style={{ fontWeight: 700, minWidth: 160 }}>
                          {entry.table}
                        </span>
                        <span
                          style={{
                            color:
                              entry.status === "error" ? "#dc2626" : "#475569",
                          }}
                        >
                          {entry.msg}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 12,
                      color: "#64748b",
                      textAlign: "center",
                    }}
                  >
                    Please refresh the page to see the restored data.
                  </div>
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button
                className="btn btn-secondary"
                onClick={closeRestoreModal}
                disabled={restoring}
              >
                {restoreDone ? "Close" : "Cancel"}
              </button>
              {!restoreDone && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (restoreMode === "replace") {
                      if (
                        !window.confirm(
                          `⚠️ REPLACE mode will permanently delete ALL current data in every table and replace it with the backup.\n\nAre you absolutely sure?`,
                        )
                      )
                        return;
                    }
                    handleRestore();
                  }}
                  disabled={!restoreData || restoring}
                  style={{
                    background:
                      restoreMode === "replace" ? "#dc2626" : "#2563eb",
                  }}
                >
                  {restoring
                    ? "⏳ Restoring…"
                    : restoreMode === "replace"
                      ? "⚠️ Replace & Restore"
                      : "📥 Restore Backup"}
                </button>
              )}
              {restoreDone && (
                <button
                  className="btn btn-primary"
                  onClick={() => window.location.reload()}
                  style={{ background: "#16a34a" }}
                >
                  🔄 Refresh Page
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importOpen && (
        <div
          className="overlay"
          onClick={() => {
            setImportOpen(false);
            setCsvText("");
            setImportErr("");
            setImportMode("update");
          }}
        >
          <div
            className="modal"
            style={{ width: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <span className="modal-title">Import from CSV</span>
              <button
                className="modal-close"
                onClick={() => {
                  setImportOpen(false);
                  setCsvText("");
                  setImportErr("");
                  setImportMode("update");
                }}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {/* Replace / Update toggle */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                {[
                  {
                    value: "update",
                    icon: "✅",
                    title: "UPDATE (Recommended)",
                    sub: "Matches by Client + Description.\nUpdates existing, inserts new — no duplicates",
                  },
                  {
                    value: "replace",
                    icon: "⚠️",
                    title: "REPLACE (Danger)",
                    sub: "Deletes ALL existing tasks first,\nthen imports only the CSV data",
                  },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "12px 14px",
                      borderRadius: 8,
                      cursor: "pointer",
                      border: `2px solid ${importMode === opt.value ? "#2563eb" : "#e2e8f0"}`,
                      background: importMode === opt.value ? "#eff6ff" : "#fff",
                      transition: "all .15s",
                    }}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value={opt.value}
                      checked={importMode === opt.value}
                      onChange={() => setImportMode(opt.value as ImportMode)}
                      style={{ marginTop: 3, accentColor: "#2563eb" }}
                    />
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color:
                            importMode === opt.value ? "#2563eb" : "#1e293b",
                        }}
                      >
                        {opt.icon} {opt.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#64748b",
                          marginTop: 2,
                          lineHeight: 1.4,
                          whiteSpace: "pre-line",
                        }}
                      >
                        {opt.sub}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Column info */}
              <div className="import-note" style={{ marginBottom: 12 }}>
                Export Google Sheet as <strong>CSV</strong>. Columns:{" "}
                <code>S No</code>, <code>Clients</code>, <code>Category</code>,{" "}
                <code>Description</code>, <code>Target Date</code>,{" "}
                <code>Expected Date</code>, <code>Comp Date</code>,{" "}
                <code>Responsible</code>, <code>Recurrence</code>,{" "}
                <code>Remarks</code>
                <br />
                <span style={{ color: "#2563eb", fontSize: 11 }}>
                  ℹ Status is auto-computed from dates. UPDATE mode matches by
                  Client + Description — safe to import multiple months without
                  duplicates.
                </span>
              </div>

              {/* Textarea */}
              <div className="form-group full" style={{ marginBottom: 10 }}>
                <label>PASTE CSV</label>
                <textarea
                  rows={7}
                  placeholder="S No,Clients,Category,..."
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    setImportErr("");
                  }}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
              </div>

              {/* File upload */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => fileRef.current?.click()}
                >
                  📂 Choose file
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  style={{ display: "none" }}
                  onChange={handleFileRead}
                />
                <span style={{ fontSize: 12, color: "var(--txt3)" }}>
                  or upload a .csv file
                </span>
              </div>
              {importErr && (
                <p style={{ color: "var(--red)", fontSize: 12, marginTop: 8 }}>
                  {importErr}
                </p>
              )}
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setImportOpen(false);
                  setCsvText("");
                  setImportErr("");
                  setImportMode("update");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleImportSubmit}
                disabled={!csvText.trim()}
              >
                Import Tasks
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
