import { useState, useRef } from "react";
import type React from "react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import {
  avatarColor as getAvatarColor,
  initials as getInitials,
} from "@/utils/avatar";
import { parseCSV } from "@/utils/header";
import { useMasters } from "@/hooks/useMasters";
import NavMenu from "@/components/header/NavMenu";
import OrgFilter from "@/components/header/OrgFilter";
import RestoreModal from "@/components/header/RestoreModal";
import ImportModal from "@/components/header/ImportModal";
import { useAuth } from "@/hooks/useAuth";

import type {
  Task,
  Profile,
  HeaderFilters,
  RestoreLogEntry,
} from "@/types";
import type {
  BackupPayload,
  BackupRestoreMode,
  BackupRestoreRequest,
  BackupRestoreResponse,
} from "@/types/api";

interface HeaderProps {
  view: string;
  onViewChange: (view: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  filters: HeaderFilters;
  onFiltersChange: (updater: (prev: HeaderFilters) => HeaderFilters) => void;
  onAddTask: () => void;
  onImport: (rows: unknown[], mode: string) => void;
  tasks: Task[];
  profile: Profile | null;
  onSignOut: () => void;
  onOpenAdmin: () => void;
  adminEmployee: string;
  onClearAdminFilter: () => void;
  theme: string;
  onToggleTheme: () => void;
  memberOptions: string[];
  /** Per-menu visibility keyed by catalog code; drives which nav tabs show. */
  navVisible: Record<string, boolean>;
  hasAttendanceAccess: boolean;
  hasEmployeeAccess: boolean;
  clientsBadgeCount?: number;
  leadsBadgeCount?: number;
  kaizenBadgeCount?: number;
  paceBadgeCount?: number;
  invoiceBadgeCount?: number;
  conveyanceBadgeCount?: number;
  selectedOrg: string;
  onOrgChange: (org: string) => void;
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
  tasks,
  profile,
  onSignOut,
  onOpenAdmin,
  adminEmployee,
  onClearAdminFilter,
  theme,
  onToggleTheme,
  memberOptions,
  navVisible,
  hasAttendanceAccess: _hasAttendanceAccess,
  hasEmployeeAccess: _hasEmployeeAccess,
  clientsBadgeCount,
  leadsBadgeCount,
  kaizenBadgeCount,
  paceBadgeCount,
  invoiceBadgeCount,
  conveyanceBadgeCount,
  selectedOrg,
  onOrgChange,
}: HeaderProps) {
  const { isAdminInAny } = useAuth();
  const { clients: clientMasters, cats: catMasters } = useMasters();
  const clientOptions = clientMasters
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b));
  const categoryOptions = [...new Set(catMasters.map((c) => c.name))].sort(
    (a, b) => a.localeCompare(b),
  );
  // Reporting Manager options come from the live task list rather than
  // every employee — only people who actually appear as a reporting
  // manager on at least one task land in the dropdown, so the picker
  // doesn't fill with non-managers.
  const reportingManagerOptions = [
    ...new Set(
      (tasks ?? [])
        .map((t) => t.reportingManager)
        .filter((n): n is string => Boolean(n && n.trim())),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  // Mobile-only: the header collapses to one row; this reveals the actions.
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importErr, setImportErr] = useState("");
  const [importMode, setImportMode] = useState("update"); // 'replace' | 'update'
  const [backingUp, setBackingUp] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreMode, setRestoreMode] =
    useState<BackupRestoreMode>("upsert");
  const [restoreData, setRestoreData] = useState<BackupPayload | null>(null);
  const [restoreFileName, setRestoreFileName] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreLog, setRestoreLog] = useState<RestoreLogEntry[]>([]);
  const [restoreDone, setRestoreDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  /* ── One-click full backup via Django endpoint ── */
  const handleBackup = async (): Promise<void> => {
    setBackingUp(true);
    try {
      const payload = await apiGet<BackupPayload>("/backup/");
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Backup failed: ${msg}`);
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestoreFile = (
    e: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as BackupPayload;
        if (!parsed.resources) {
          alert('Invalid backup file — missing "resources" key.');
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

  /* ── Restore via Django endpoint ── */
  const handleRestore = async (): Promise<void> => {
    if (!restoreData) return;
    setRestoring(true);
    setRestoreLog([]);
    setRestoreDone(false);

    try {
      const body: BackupRestoreRequest = {
        confirm: true,
        mode: restoreMode,
        schema_version: restoreData.schema_version,
        resources: restoreData.resources,
      };
      const report = await apiPost<BackupRestoreResponse>(
        "/backup/restore/",
        body,
      );
      // Build per-resource status log from the server's 207 report.
      const log: RestoreLogEntry[] = Object.entries(report.per_resource).map(
        ([resource, summary]) => ({
          table: resource,
          status: summary.failed > 0 ? "error" : "ok",
          msg:
            summary.failed > 0
              ? `${summary.inserted} inserted, ${summary.updated} updated, ${summary.failed} failed`
              : `${summary.inserted} inserted, ${summary.updated} updated`,
        }),
      );
      setRestoreLog(log);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setRestoreLog([
        { table: "restore", status: "error", msg },
      ]);
    } finally {
      setRestoring(false);
      setRestoreDone(true);
    }
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

  const setFilter = (key: keyof HeaderFilters, val: string): void =>
    onFiltersChange((prev) => ({ ...prev, [key]: val }));
  const clearFilters = (): void => {
    onFiltersChange(() => ({
      client: "",
      category: "",
      responsible: "",
      reportingManager: "",
    }));
    onSearchChange("");
    if (onClearAdminFilter) onClearAdminFilter();
  };
  const hasFilter =
    filters.client ||
    filters.category ||
    filters.responsible ||
    filters.reportingManager ||
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

  const handleFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  const myName = profile?.full_name || "";
  const avatarColor = profile ? getAvatarColor(myName) : "#0052cc";
  const initials = myName ? getInitials(myName) : "?";

  const isAdmin = isAdminInAny();

  /* SVG icons — passed to NavMenu */
  const icons = {
    board: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
    dashboard: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <rect x="3" y="12" width="4" height="9" />
        <rect x="10" y="6" width="4" height="15" />
        <rect x="17" y="3" width="4" height="18" />
      </svg>
    ),
    calendar: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    settings: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
    worklog: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    leads: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    clients: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M3 21v-2a4 4 0 014-4h3" />
        <circle cx="9" cy="7" r="4" />
        <path d="M16 3.13a4 4 0 010 7.75" />
        <path d="M14 14l4 4 6-6" />
      </svg>
    ),
    notice: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    invoice: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="16" y2="11" />
        <line x1="8" y1="15" x2="12" y2="15" />
      </svg>
    ),
    conveyance: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6h16M4 12h16M4 18h10" />
        <circle cx="18" cy="18" r="3" />
      </svg>
    ),
    masters: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
    costing: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
    users: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
    growthplan: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    kaizen: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 00-4 12.74V17h8v-2.26A7 7 0 0012 2z" />
      </svg>
    ),
    attendance: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    holidays: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
    employee: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    ),
    pacemeet: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
    pacegoal: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    pacecheck: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
  };

  return (
    <>
      {/* ── Top Header Bar ── */}
      <header className="header-top">
        <div className="header-logo">
          <div className="header-logo-icon" style={{ background: "#fff" }}>
            <img
              src="/logo.png"
              alt=""
              style={{ width: 24, height: 24, objectFit: "contain" }}
            />
          </div>
          Task Tracker
        </div>

        {/* Org filter — inline in header */}
        <OrgFilter selectedOrg={selectedOrg} onOrgChange={onOrgChange} />

        {/* Mobile-only chevron: expands the action row below (CSS hides it
            on desktop, where the actions are always visible). */}
        <button
          className={`header-more-toggle${mobileActionsOpen ? " open" : ""}`}
          aria-label={mobileActionsOpen ? "Hide actions" : "Show actions"}
          aria-expanded={mobileActionsOpen}
          onClick={() => setMobileActionsOpen((o) => !o)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div
          className={`header-actions${mobileActionsOpen ? " open" : ""}`}
        >
          {/* Admin dropdown for admin-only actions */}
          {isAdmin && (
            <div className="admin-dropdown">
              <button
                className="btn-header"
                onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                title="Admin actions"
                style={{ padding: "7px 10px" }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                  <circle cx="5" cy="12" r="1" />
                </svg>
              </button>
              {adminMenuOpen && (
                <>
                  <div
                    style={{ position: "fixed", inset: 0, zIndex: 199 }}
                    onClick={() => setAdminMenuOpen(false)}
                  />
                  <div className="admin-dropdown-menu">
                    <button
                      className="admin-dropdown-item"
                      onClick={() => {
                        handleBackup();
                        setAdminMenuOpen(false);
                      }}
                      disabled={backingUp}
                    >
                      💾 {backingUp ? "Backing up…" : "Backup Data"}
                    </button>
                    <button
                      className="admin-dropdown-item"
                      onClick={() => {
                        setRestoreOpen(true);
                        setAdminMenuOpen(false);
                      }}
                    >
                      📥 Restore Data
                    </button>
                    {view === "board" && (
                      <button
                        className="admin-dropdown-item"
                        onClick={() => {
                          setImportOpen(true);
                          setAdminMenuOpen(false);
                        }}
                      >
                        ⬆ Import CSV
                      </button>
                    )}
                    <div className="admin-dropdown-sep" />
                    {view === "board" && (
                      <button
                        className="admin-dropdown-item"
                        onClick={() => {
                          onOpenAdmin();
                          setAdminMenuOpen(false);
                        }}
                      >
                        👑 Admin Dashboard
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Add Task — prominent on board */}
          {view === "board" && (
            <button className="btn-header primary" onClick={onAddTask}>
              + Add Task
            </button>
          )}

          {/* Theme toggle */}
          <button
            className="btn-header"
            onClick={onToggleTheme}
            title={
              theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"
            }
            style={{ padding: "7px 10px" }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {profile && (
            <div className="user-info" title={`${myName} (${profile.highest_role})`}>
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
                style={{ padding: "5px 12px", fontSize: 12 }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Nav Tabs (draggable) ── */}
      <NavMenu
        view={view}
        onViewChange={onViewChange}
        navVisible={navVisible}
        icons={icons}
        clientsBadgeCount={clientsBadgeCount}
        leadsBadgeCount={leadsBadgeCount}
        kaizenBadgeCount={kaizenBadgeCount}
        paceBadgeCount={paceBadgeCount}
        invoiceBadgeCount={invoiceBadgeCount}
        conveyanceBadgeCount={conveyanceBadgeCount}
      />

      {/* ── Board Toolbar (search + filters) ── */}
      {view === "board" && (
        <div className="header-toolbar">
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

          <div className="header-filters">
            <select
              value={filters.client}
              onChange={(e) => setFilter("client", e.target.value)}
            >
              <option value="">All Clients</option>
              {clientOptions.map((c) => (
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
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={filters.reportingManager}
              onChange={(e) =>
                setFilter("reportingManager", e.target.value)
              }
            >
              <option value="">All Reporting Managers</option>
              {reportingManagerOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
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
              {(memberOptions ?? []).map((m) => (
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
        </div>
      )}

      {/* Org filter moved to header-top */}

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
      <RestoreModal
        restoreOpen={restoreOpen}
        restoreMode={restoreMode}
        restoreData={restoreData}
        restoreFileName={restoreFileName}
        restoring={restoring}
        restoreLog={restoreLog}
        restoreDone={restoreDone}
        restoreRef={restoreRef}
        onRestoreFile={handleRestoreFile}
        onRestore={handleRestore}
        onClose={closeRestoreModal}
        onModeChange={setRestoreMode}
      />

      {/* Import Modal */}
      <ImportModal
        importOpen={importOpen}
        csvText={csvText}
        importErr={importErr}
        importMode={importMode}
        fileRef={fileRef}
        onCsvChange={(text) => {
          setCsvText(text);
          setImportErr("");
        }}
        onModeChange={setImportMode}
        onFileRead={handleFileRead}
        onSubmit={handleImportSubmit}
        onClose={() => {
          setImportOpen(false);
          setCsvText("");
          setImportErr("");
          setImportMode("update");
        }}
      />
    </>
  );
}
