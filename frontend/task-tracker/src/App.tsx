import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import Header from "./components/layout/Header";
import StatsBar from "./components/layout/StatsBar";
import Board from "./components/board/Board";
import TaskModal from "./components/board/TaskModal";
import TaskLogModal from "./components/board/TaskLogModal";
import LoginPage from "./pages/LoginPage";

// Route-level code splitting. Only the pages the user actually navigates to
// get pulled off the main bundle — the board view (the default) and the
// always-mounted chat/notes widgets stay eager below.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const MastersPage = lazy(() => import("./pages/MastersPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const WorkLogPage = lazy(() => import("./pages/WorkLogPage"));
const LeadsPage = lazy(() => import("./pages/LeadsPage"));
const InvoicePage = lazy(() => import("./pages/InvoicePage"));
const NoticePage = lazy(() => import("./pages/NoticePage"));
const GrowthPlanPage = lazy(() => import("./pages/GrowthPlanPage"));
const AttendancePage = lazy(() => import("./pages/AttendancePage"));
const HolidayMasterPage = lazy(() => import("./pages/HolidayMasterPage"));
const EmployeePage = lazy(() => import("./pages/EmployeePage"));
const PacePage = lazy(() => import("./pages/PacePage"));
const FloatingChat = lazy(() => import("./pages/FloatingChat"));
const StickyNotes = lazy(() => import("./pages/StickyNotes"));
import { apiGet } from "./lib/api";
import type { TaskLogDto } from "./types/api";
import { useTasks } from "./hooks/useTasks";
import { useProfiles } from "./hooks/useProfiles";
import { useMasters } from "./hooks/useMasters";
import { useAccessRoles } from "./hooks/useAccessRoles";
import { useBoardTasks } from "./hooks/useBoardTasks";
import type { ID, Task, TaskLogEntry, View } from "./types";
import "./index.css";
import { useAuth } from "./hooks/useAuth";

function TaskApp() {
  const { user, profile, signOut, isAdminInAny, isManagerInAny } = useAuth();

  const myName = profile?.full_name || "";
  // List-level guards — "is this user admin/manager anywhere?" — because the
  // tasks view merges rows across every org they belong to.
  const isAdmin = isAdminInAny();
  const isManager = isManagerInAny() && !isAdminInAny();

  const {
    tasks,
    loading,
    saveTask,
    patchTask,
    deleteTask,
    moveTask,
    importTasks,
  } = useTasks();
  const { profiles, reload: reloadProfiles } = useProfiles();
  const { clients: clientMasters, cats: categoryMasters } = useMasters();
  const {
    hasInvoiceAccess,
    hasNoticeAccess,
    hasMastersAccess,
    hasAttendanceAccess,
    hasEmployeeAccess,
  } = useAccessRoles(user?.id, isAdmin);

  const [view, setView] = useState<View>("board");
  const [search, setSearch] = useState<string>("");
  const [filters, setFilters] = useState<{
    client: string;
    category: string;
    responsible: string;
  }>({ client: "", category: "", responsible: "" });
  const [modal, setModal] = useState<{
    open: boolean;
    task: Task | null;
    defaultStatus: string;
  }>({ open: false, task: null, defaultStatus: "" });
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedOrg, setSelectedOrg] = useState<string>("");
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem("tt-theme") || "light",
  );
  const [adminOpen, setAdminOpen] = useState<boolean>(false);
  const [adminEmployee, setAdminEmployee] = useState<string>("");
  const [logModal, setLogModal] = useState<{
    open: boolean;
    task: Task | null;
  }>({ open: false, task: null });
  const [logEntries, setLogEntries] = useState<TaskLogEntry[]>([]);

  useEffect(() => {
    void reloadProfiles();
  }, [reloadProfiles]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tt-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "light" ? "dark" : "light")),
    [],
  );

  const managedNames = useMemo(() => {
    if (!isManager || !profile) return [];
    return profiles
      .filter((p) => (p.manager_ids ?? []).includes(profile.id))
      .map((p) => p.full_name)
      .filter(Boolean);
  }, [profiles, profile, isManager]);

  const allowedNames = useMemo<Set<string> | null>(() => {
    if (isAdmin) return null;
    if (isManager) return new Set([myName, ...managedNames]);
    return new Set([myName]);
  }, [isAdmin, isManager, myName, managedNames]);

  const memberOptions = useMemo(() => {
    if (isAdmin)
      return profiles
        .map((p) => p.full_name)
        .filter(Boolean)
        .sort();
    if (isManager) return [myName, ...managedNames].sort();
    return [myName];
  }, [isAdmin, isManager, myName, managedNames, profiles]);

  // Org filter. ``selectedOrg`` is now the org's UID (from OrgFilter, which
  // reads the signed-in user's memberships from AuthContext). Every task's
  // ``organization`` field is the same-shaped uid — so the comparison is a
  // straight string match, no localStorage gymnastics.
  const inScope = useCallback(
    (t: Task) => {
      if (allowedNames === null) return true;
      return allowedNames.has(t.responsible);
    },
    [allowedNames],
  );

  const inOrg = useCallback(
    (t: Task) => !selectedOrg || t.organization === selectedOrg,
    [selectedOrg],
  );

  const applyFilters = useCallback(
    (t: Task) => {
      if (!inScope(t)) return false;
      if (!inOrg(t)) return false;
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
    },
    [inScope, inOrg, filters, adminEmployee, search],
  );

  const baseTasks = useMemo(
    () => tasks.filter(applyFilters),
    [tasks, applyFilters],
  );
  const { boardTasks, availableMonths } = useBoardTasks(
    baseTasks,
    selectedMonth,
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

  // Board/TaskModal carries display names on the domain object; the API
  // needs uids for FK writes. Resolve here rather than pushing lookup maps
  // into every page that mounts TaskModal.
  const responsibleUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach((p) => {
      if (p.full_name) map[p.full_name] = p.id;
    });
    return map;
  }, [profiles]);
  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((m) => {
      map[m.name] = m.id;
    });
    return map;
  }, [clientMasters]);
  const categoryUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    categoryMasters.forEach((m) => {
      map[m.name] = m.id;
    });
    return map;
  }, [categoryMasters]);

  const handleSaveTask = useCallback(
    async (taskData: Partial<Task> & { id?: ID }) => {
      if (!user) return;
      const refs = {
        responsible:
          taskData.responsible && responsibleUidByName[taskData.responsible]
            ? responsibleUidByName[taskData.responsible]
            : undefined,
        client:
          taskData.client && clientUidByName[taskData.client]
            ? clientUidByName[taskData.client]
            : undefined,
        category:
          taskData.category && categoryUidByName[taskData.category]
            ? categoryUidByName[taskData.category]
            : undefined,
        org: taskData.organization || selectedOrg || undefined,
      };
      await saveTask(taskData, myName, refs);
      closeModal();
    },
    [
      saveTask,
      user,
      myName,
      closeModal,
      responsibleUidByName,
      clientUidByName,
      categoryUidByName,
      selectedOrg,
    ],
  );

  const openLogModal = useCallback(async (task: Task) => {
    setLogModal({ open: true, task });
    setLogEntries([]);
    try {
      const dtos = await apiGet<TaskLogDto[]>("/task_logs/", {
        task_uid: task.id,
      });
      const entries: TaskLogEntry[] = dtos.map((dto) => ({
        id: String(dto.id),
        task_id: task.id,
        changed_by: dto.changed_by?.uid ?? null,
        changed_by_name:
          dto.changed_by_name || dto.changed_by?.full_name || "",
        changed_at: dto.changed_at,
        changes: dto.changes.map((c) => ({ ...c })),
      }));
      setLogEntries(entries);
    } catch {
      setLogEntries([]);
    }
  }, []);

  const handleAdminFilter = useCallback((name: string) => {
    setAdminEmployee(name);
    if (name) setFilters((f) => ({ ...f, responsible: "" }));
  }, []);

  const VIEW_MAP: Record<View, ReactElement | null> = {
    dashboard: (
      <DashboardPage
        tasks={tasks}
        profile={profile}
        profiles={profiles}
        onAddTask={() => openAddModal("Pending")}
        onPatchTask={patchTask}
      />
    ),
    calendar: (
      <CalendarPage tasks={tasks} profile={profile} profiles={profiles} />
    ),
    masters: hasMastersAccess ? (
      <MastersPage
        profile={profile}
        profiles={profiles}
        selectedOrg={selectedOrg}
        onRefreshProfiles={reloadProfiles}
      />
    ) : null,
    users: isAdmin ? (
      <UsersPage
        profiles={profiles}
        onRefresh={reloadProfiles}
        selectedOrg={selectedOrg}
      />
    ) : null,
    worklog: (
      <WorkLogPage
        profile={profile}
        profiles={profiles}
        selectedOrg={selectedOrg}
      />
    ),
    leads: <LeadsPage profile={profile} profiles={profiles} />,
    invoice: hasInvoiceAccess ? (
      <InvoicePage profile={profile} selectedOrg={selectedOrg} />
    ) : null,
    notice: hasNoticeAccess ? <NoticePage profile={profile} /> : null,
    attendance: hasAttendanceAccess ? (
      <AttendancePage
        profile={profile}
        profiles={profiles}
        selectedOrg={selectedOrg}
      />
    ) : null,
    growthplan: isAdmin ? (
      <GrowthPlanPage profile={profile} profiles={profiles} />
    ) : null,
    holidays: <HolidayMasterPage profile={profile} />,
    employee: hasEmployeeAccess ? <EmployeePage /> : null,
    pace: <PacePage profile={profile} profiles={profiles} />,
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <span>Loading tasks…</span>
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
        onImport={(rows, mode) => {
          if (!user) return;
          void importTasks(rows as Task[], mode as "replace" | "update", {});
        }}
        tasks={tasks}
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
        hasMastersAccess={hasMastersAccess}
        hasAttendanceAccess={hasAttendanceAccess}
        hasEmployeeAccess={hasEmployeeAccess}
        selectedOrg={selectedOrg}
        onOrgChange={setSelectedOrg}
      />

      {view === "board" ? (
        <>
          <StatsBar tasks={boardTasks} />
          <Board
            tasks={boardTasks}
            onEditTask={openEditModal}
            onDeleteTask={deleteTask}
            onMoveTask={moveTask}
            onAddTask={openAddModal}
            onViewLog={(task) => {
              void openLogModal(task);
            }}
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            availableMonths={availableMonths}
          />
        </>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <Suspense
            fallback={
              <div className="loading-screen">
                <div className="loading-spinner" />
              </div>
            }
          >
            {VIEW_MAP[view] ?? null}
          </Suspense>
        </div>
      )}

      {modal.open && (
        <TaskModal
          task={modal.task}
          defaultStatus={modal.defaultStatus}
          onSave={handleSaveTask}
          onClose={closeModal}
          onDelete={deleteTask}
        />
      )}

      {logModal.open && logModal.task && (
        <TaskLogModal
          task={logModal.task}
          entries={logEntries}
          onClose={() => setLogModal({ open: false, task: null })}
        />
      )}

      <Suspense fallback={null}>
        {adminOpen && isAdmin && (
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
      </Suspense>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <span>Loading…</span>
      </div>
    );
  }
  return user ? <TaskApp /> : <LoginPage />;
}
