import { useState, useEffect, useCallback, useMemo } from "react";
import Header from "@/components/Header";
import StatsBar from "@/components/StatsBar";
import Board from "@/components/Board";
import TaskModal from "@/components/TaskModal";
import LoginPage from "@/components/LoginPage";
import AdminDashboard from "@/components/AdminDashboard";
import DashboardPage from "@/components/DashboardPage";
import CalendarPage from "@/components/CalendarPage";
import MastersPage from "@/components/MastersPage";
import UsersPage from "@/components/UsersPage";
import WorkLogPage from "@/components/WorkLogPage";
import LeadsPage from "@/components/LeadsPage";
import InvoicePage from "@/components/InvoicePage";
import NoticePage from "@/components/NoticePage";
import StickyNotes from "@/components/StickyNotes";
import {
  computeStatus,
  isRecurrenceVisible,
  getMonthKey,
  hasRecurringInstance,
  getProjectedDate,
} from "@/lib/taskUtils";
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  dbToTask,
  taskToDb,
} from "@/lib/api";
import { useAuth } from "@/contexts/useContext";
import type { Task, DbTaskRow } from "@/types/task";
import type { Profile } from "@/types/auth";
import type { ViewId, HeaderImportTask, ImportMode } from "@/types/header";
import type { UserProfile } from "@/types/users";
import "@/index.css";
import FloatingChat from "@/components/FloatingChat";

function TaskApp() {
  const { user, profile, signOut } = useAuth();

  const myName = profile?.full_name || profile?.name || "";
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invoiceAccess, setInvoiceAccess] = useState<
    { user_id: string; enabled?: boolean }[]
  >([]);
  const [noticeAccess, setNoticeAccess] = useState<
    { user_id: string; enabled?: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewId>("board");

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    client: "",
    category: "",
    responsible: "",
  });
  const [modal, setModal] = useState({
    open: false,
    task: null as Task | null,
    defaultStatus: "",
  });
  const [selectedMonth, setSelectedMonth] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("tt-theme") || "light",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tt-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "light" ? "dark" : "light")),
    [],
  );

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminEmployee, setAdminEmployee] = useState("");

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadProfiles = useCallback(async () => {
    const data = await apiGet<Profile[]>("/profiles/");
    setProfiles(data);
  }, []);

  const loadInvoiceAccess = useCallback(async () => {
    try {
      const data =
        await apiGet<{ user_id: string; enabled?: boolean }[]>(
          "/invoice_access/",
        );
      setInvoiceAccess(data);
    } catch {
      /* ignore if endpoint doesn't exist */
    }
  }, []);

  const loadNoticeAccess = useCallback(async () => {
    try {
      const data =
        await apiGet<{ user_id: string; enabled?: boolean }[]>(
          "/notice_access/",
        );
      setNoticeAccess(data);
    } catch {
      /* ignore if endpoint doesn't exist */
    }
  }, []);

  const hasInvoiceAccess = useMemo(
    () =>
      isAdmin ||
      invoiceAccess.some((a) => a.user_id === user?.id && a.enabled !== false),
    [isAdmin, invoiceAccess, user],
  );

  const hasNoticeAccess = useMemo(
    () =>
      isAdmin ||
      noticeAccess.some((a) => a.user_id === user?.id && a.enabled !== false),
    [isAdmin, noticeAccess, user],
  );

  const loadTasks = useCallback(async () => {
    try {
      const data = await apiGet<DbTaskRow[]>("/tasks/");
      setTasks(
        data.map((r) => ({
          ...dbToTask(r),
          status: computeStatus(dbToTask(r)),
        })),
      );
    } catch (e) {
      console.error("loadTasks:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      loadTasks(),
      loadProfiles(),
      loadInvoiceAccess(),
      loadNoticeAccess(),
    ]).then(() => {
      if (mounted) setLoading(false);
    });

    // Polling every 30s + refresh on window focus
    const interval = setInterval(loadTasks, 30_000);
    const onFocus = () => loadTasks();
    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadTasks, loadProfiles, loadInvoiceAccess, loadNoticeAccess]);

  // ── Role-scoped member list ────────────────────────────────────────────────
  const managedNames = useMemo(() => {
    if (!isManager) return [];
    return profiles
      .filter((p) =>
        (p.manager_ids?.length
          ? p.manager_ids
          : p.manager_id
            ? [p.manager_id]
            : []
        ).includes(profile?.id),
      )
      .map((p) => p.full_name || "")
      .filter(Boolean);
  }, [profiles, profile, isManager]);

  const allowedNames = useMemo(() => {
    if (isAdmin) return null;
    if (isManager) return new Set([myName, ...managedNames]);
    return new Set([myName]);
  }, [isAdmin, isManager, myName, managedNames]);

  const memberOptions = useMemo(() => {
    if (isAdmin)
      return profiles
        .map((p) => p.full_name)
        .filter(Boolean)
        .sort() as string[];
    if (isManager) return [myName, ...managedNames].sort();
    return [myName];
  }, [isAdmin, isManager, myName, managedNames, profiles]);

  const inScope = useCallback(
    (t: Task) => {
      if (allowedNames === null) return true;
      return allowedNames.has(t.responsible);
    },
    [allowedNames],
  );

  // ── Filtering ──────────────────────────────────────────────────────────────
  const baseTasks = useMemo(
    () =>
      tasks.filter((t: Task) => {
        if (!inScope(t)) return false;
        if (filters.client && t.client !== filters.client) return false;
        if (filters.category && t.category !== filters.category) return false;
        const resp = adminEmployee || filters.responsible;
        if (resp && t.responsible !== resp) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          t.description.toLowerCase().includes(q) ||
          t.client.toLowerCase().includes(q) ||
          t.responsible.toLowerCase().includes(q) ||
          t.remarks.toLowerCase().includes(q)
        );
      }),
    [tasks, filters, adminEmployee, search, inScope],
  );

  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    const today = new Date();
    baseTasks.forEach((t: Task) => {
      const r = t.recurrence || "Onetime";
      if (r === "Onetime") {
        const mk = getMonthKey(t.target_date);
        if (mk) keys.add(mk);
      } else {
        for (let offset = -1; offset <= 18; offset++) {
          const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
          const y = d.getFullYear(),
            mo = d.getMonth();
          if (hasRecurringInstance(t, y, mo))
            keys.add(`${y}-${String(mo + 1).padStart(2, "0")}`);
        }
      }
    });
    return [...keys].sort();
  }, [baseTasks]);

  const boardTasks = useMemo(() => {
    if (!selectedMonth)
      return baseTasks.filter((t: Task) => isRecurrenceVisible(t));
    const [y, m] = selectedMonth.split("-");
    const selYear = Number(y),
      selMonth = Number(m) - 1;
    return baseTasks
      .filter((t: Task) => {
        const r = t.recurrence || "Onetime";
        if (r === "Onetime")
          return getMonthKey(t.target_date) === selectedMonth;
        return hasRecurringInstance(t, selYear, selMonth);
      })
      .map((t: Task) => {
        if ((t.recurrence || "Onetime") === "Onetime") return t;
        const projectedDate = getProjectedDate(t, selYear, selMonth);
        const isDiffCycle = (t.target_date || "").slice(0, 7) !== selectedMonth;
        const projectedTask = {
          ...t,
          target_date: projectedDate,
          ...(isDiffCycle
            ? { expected_date: "", comp_date: "", remarks: "" }
            : {}),
        };
        return { ...projectedTask, status: computeStatus(projectedTask) };
      });
  }, [baseTasks, selectedMonth]);

  // ── Task CRUD ──────────────────────────────────────────────────────────────
  const handleSaveTask = useCallback(
    async (taskData: Task) => {
      const withStatus = { ...taskData, status: computeStatus(taskData) };
      const dbRow = { ...taskToDb(withStatus), created_by: user!.id };
      try {
        if (taskData.id) {
          const updated = await apiPatch<DbTaskRow>(
            `/tasks/${taskData.id}/`,
            dbRow,
          );
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskData.id
                ? {
                    ...dbToTask(updated),
                    status: computeStatus(dbToTask(updated)),
                  }
                : t,
            ),
          );
        } else {
          const maxSNo = tasks.reduce(
            (m: number, t: Task) => Math.max(m, t.s_no || 0),
            0,
          );
          const created = await apiPost<DbTaskRow>("/tasks/", {
            ...dbRow,
            s_no: maxSNo + 1,
          });
          setTasks((prev) => [
            ...prev,
            { ...dbToTask(created), status: computeStatus(dbToTask(created)) },
          ]);
        }
      } catch (e) {
        alert("Save failed: " + (e as Error).message);
        return;
      }
      setModal({ open: false, task: null, defaultStatus: "" });
    },
    [tasks, user],
  );

  const handleDeleteTask = useCallback(async (taskId: string) => {
    if (!window.confirm("Delete this task?")) return;
    try {
      await apiDelete(`/tasks/${taskId}/`);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (e) {
      alert("Delete failed: " + (e as Error).message);
    }
  }, []);

  const handleMoveTask = useCallback(
    async (taskId: string, newStatus: string) => {
      try {
        await apiPatch(`/tasks/${taskId}/`, { status: newStatus });
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
        );
      } catch (e) {
        alert("Move failed: " + (e as Error).message);
      }
    },
    [],
  );

  const handleImport = useCallback(
    async (importedTasks: HeaderImportTask[], mode: ImportMode = "replace") => {
      const withStatus = importedTasks.map((t) => ({
        ...t,
        created_by: null,
        created_at: null,
        status: computeStatus(t),
      }));
      try {
        if (mode === "replace") {
          await Promise.all(tasks.map((t) => apiDelete(`/tasks/${t.id}/`)));
          const rows = withStatus.map((t, i) => ({
            ...taskToDb(t as Task),
            s_no: t.s_no || i + 1,
            created_by: user!.id,
          }));
          const created = await Promise.all(
            rows.map((r) => apiPost<DbTaskRow>("/tasks/", r)),
          );
          setTasks(
            created.map((r) => ({
              ...dbToTask(r),
              status: computeStatus(dbToTask(r)),
            })),
          );
          alert(`✅ Replaced all tasks — ${rows.length} tasks imported.`);
        } else {
          const norm = (s: string) =>
            (s || "").toLowerCase().replace(/\s+/g, " ").trim();
          const key = (t: { client: string; description: string }) =>
            `${norm(t.client)}||${norm(t.description)}`;
          const existingMap = new Map(tasks.map((t: Task) => [key(t), t]));
          const toUpdate = withStatus.filter((t) => existingMap.has(key(t)));
          const toInsert = withStatus.filter((t) => !existingMap.has(key(t)));
          let updated = 0,
            inserted = 0;
          for (const t of toUpdate) {
            const existing = existingMap.get(key(t))!;
            const r = await apiPatch<DbTaskRow>(`/tasks/${existing.id}/`, {
              ...taskToDb(t as Task),
              s_no: existing.s_no,
              status: t.status,
            });
            setTasks((prev) =>
              prev.map((x) =>
                x.id === existing.id
                  ? { ...dbToTask(r), status: computeStatus(dbToTask(r)) }
                  : x,
              ),
            );
            updated++;
          }
          const maxSNo = Math.max(...tasks.map((t: Task) => t.s_no || 0), 0);
          for (const [i, t] of toInsert.entries()) {
            const r = await apiPost<DbTaskRow>("/tasks/", {
              ...taskToDb(t as Task),
              s_no: t.s_no || maxSNo + i + 1,
              status: t.status,
              created_by: user!.id,
            });
            setTasks((prev) => [
              ...prev,
              { ...dbToTask(r), status: computeStatus(dbToTask(r)) },
            ]);
            inserted++;
          }
          alert(
            `✅ Import complete!\n• ${updated} updated\n• ${inserted} added`,
          );
        }
      } catch (e) {
        alert("Import failed: " + (e as Error).message);
      }
    },
    [tasks, user],
  );

  const openAddModal = useCallback(
    (defaultStatus = "Pending") =>
      setModal({ open: true, task: null, defaultStatus }),
    [],
  );
  const openEditModal = useCallback(
    (task: Task) => setModal({ open: true, task, defaultStatus: task.status }),
    [],
  );
  const closeModal = useCallback(
    () => setModal({ open: false, task: null, defaultStatus: "" }),
    [],
  );

  const handleAdminFilter = useCallback((name: string) => {
    setAdminEmployee(name);
    if (name) setFilters((f) => ({ ...f, responsible: "" }));
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#fff",
          fontSize: 18,
        }}
      >
        Loading tasks…
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        onFiltersChange={setFilters}
        onAddTask={() => openAddModal("Pending")}
        onImport={handleImport}
        profile={profile}
        onSignOut={signOut}
        onOpenAdmin={() => setAdminOpen(true)}
        adminEmployee={adminEmployee}
        onClearAdminFilter={() => setAdminEmployee("")}
        theme={theme}
        onToggleTheme={toggleTheme}
        memberOptions={memberOptions}
        hasInvoiceAccess={hasInvoiceAccess}
        hasNoticeAccess={hasNoticeAccess}
      />

      {view === "board" && (
        <>
          <StatsBar tasks={boardTasks} />
          <Board
            tasks={boardTasks}
            onEditTask={openEditModal}
            onDeleteTask={handleDeleteTask}
            onMoveTask={handleMoveTask}
            onAddTask={openAddModal}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            availableMonths={availableMonths}
          />
        </>
      )}

      {view !== "board" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {view === "dashboard" && (
            <DashboardPage
              tasks={tasks}
              profile={profile ?? undefined}
              profiles={profiles}
            />
          )}
          {view === "calendar" && (
            <CalendarPage tasks={tasks} profile={profile} profiles={profiles} />
          )}
          {view === "masters" && profile?.role === "admin" && <MastersPage />}
          {view === "users" && profile?.role === "admin" && (
            <UsersPage
              profiles={profiles as UserProfile[]}
              onRefresh={loadProfiles}
            />
          )}
          {view === "worklog" && (
            <WorkLogPage profile={profile!} profiles={profiles} />
          )}
          {view === "leads" && (
            <LeadsPage profile={profile} profiles={profiles} />
          )}
          {view === "invoice" && hasInvoiceAccess && (
            <InvoicePage profile={profile} />
          )}
          {view === "notice" && hasNoticeAccess && (
            <NoticePage profile={profile} />
          )}
        </div>
      )}

      {modal.open && (
        <TaskModal
          task={modal.task}
          defaultStatus={modal.defaultStatus}
          onSave={handleSaveTask}
          onClose={closeModal}
        />
      )}

      {adminOpen && profile?.role === "admin" && (
        <AdminDashboard
          tasks={tasks}
          profiles={profiles}
          onFilterEmployee={handleAdminFilter}
          activeEmployee={adminEmployee}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {user && <FloatingChat profile={profile} profiles={profiles} />}
      {user && <StickyNotes userId={user.id} />}
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0079bf",
          color: "#fff",
          fontSize: 18,
        }}
      >
        Loading…
      </div>
    );
  }
  return user ? <TaskApp /> : <LoginPage />;
}
