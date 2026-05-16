import { useMemo, useState, useEffect } from "react";
import {
  COLUMNS,
  computeStatus,
  getProjectedDate,
  hasRecurringInstance,
} from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";
import {
  loadLayers,
  saveLayers,
  loadSubtasksOnly,
  saveSubtasksOnly,
  tasksVisible,
  plansVisible,
  type CalendarLayers,
} from "@/utils/calendarLayers";
import { useAuth } from "@/hooks/useAuth";
import { useWorkPlans } from "@/hooks/useWorkPlans";
import CalendarToolbar from "@/components/calendar/CalendarToolbar";
import CalendarLegend from "@/components/calendar/CalendarLegend";
import UnifiedDayCell from "@/components/calendar/UnifiedDayCell";
import UnifiedDayModal from "@/components/calendar/UnifiedDayModal";
import type { Profile, Task, TaskStatus, WorkPlan } from "@/types";
import type { ID } from "@/types/common";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarPageProps {
  tasks: Task[];
  profile: Profile | null;
  profiles?: Profile[];
  mainsById: Map<
    ID,
    { category: string; responsible: string; description: string }
  >;
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  Overdue: 0,
  TodayTask: 1,
  Tomorrow: 2,
  Pending: 3,
  TBC: 4,
  Ontime: 5,
  "Completed Delay": 6,
  Completed: 7,
  "Future Task/Goals": 8,
};

export default function CalendarPage({
  tasks,
  profile,
  profiles = [],
  mainsById,
}: CalendarPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const { plans: allPlans } = useWorkPlans();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [expandDay, setExpandDay] = useState<number | null>(null);
  const [fClient, setFClient] = useState("");
  const [fMember, setFMember] = useState("");
  const [fMainCategory, setFMainCategory] = useState("");
  const [layers, setLayers] = useState<CalendarLayers>(() => loadLayers());
  const [subtasksOnly, setSubtasksOnly] = useState<boolean>(() =>
    loadSubtasksOnly(),
  );

  useEffect(() => {
    saveLayers(layers);
  }, [layers]);

  useEffect(() => {
    saveSubtasksOnly(subtasksOnly);
  }, [subtasksOnly]);

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isAdmin = isAdminInAny();
  const isManager = isManagerInAny() && !isAdmin;
  const myName = profile?.full_name || "";

  // --- Role-based visibility (parallels existing tasks logic, applied to plans). ---
  const managedNames = useMemo(() => {
    if (!isManager || !profile) return [] as string[];
    return profiles
      .filter((p) => (p.manager_ids ?? []).includes(profile.id))
      .map((p) => p.full_name || "");
  }, [isManager, profile, profiles]);

  const roleScopedTasks = useMemo(() => {
    if (isAdmin) return tasks;
    if (isManager)
      return tasks.filter(
        (t) => t.responsible === myName || managedNames.includes(t.responsible),
      );
    return tasks.filter((t) => t.responsible === myName);
  }, [tasks, isAdmin, isManager, myName, managedNames]);

  const visibleTasks = useMemo(
    () =>
      subtasksOnly
        ? roleScopedTasks.filter((t) => t.parentId != null)
        : roleScopedTasks,
    [roleScopedTasks, subtasksOnly],
  );

  const mainsByIdSlim = useMemo(() => {
    const m = new Map<ID, { description: string }>();
    mainsById.forEach((v, k) => m.set(k, { description: v.description }));
    return m;
  }, [mainsById]);

  const visiblePlans = useMemo(() => {
    if (isAdmin) return allPlans;
    if (isManager)
      return allPlans.filter(
        (p) => p.name === myName || managedNames.includes(p.name),
      );
    return allPlans.filter((p) => p.name === myName);
  }, [allPlans, isAdmin, isManager, myName, managedNames]);

  // --- Tasks projection for the visible month, including recurring instances. ---
  const monthTasks = useMemo(() => {
    const out: Task[] = [];
    visibleTasks.forEach((t) => {
      const r = t.recurrence || "Onetime";
      if (!t.targetDate) return;
      if (r === "Onetime") {
        const taskMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
        if (t.targetDate.startsWith(taskMonth)) out.push(t);
      } else if (hasRecurringInstance(t, year, month)) {
        const projectedDate = getProjectedDate(t, year, month);
        const origMonth = (t.targetDate || "").slice(0, 7);
        const calMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
        const isDiffCycle = origMonth !== calMonth;
        const projectedTask: Task = {
          ...t,
          targetDate: projectedDate,
          ...(isDiffCycle
            ? { expectedDate: "", completedDate: "", remarks: "" }
            : {}),
        };
        const taskStatus = computeStatus(projectedTask);
        out.push({ ...projectedTask, status: taskStatus });
      }
    });
    return out;
  }, [visibleTasks, year, month]);

  const unscheduledTasks = useMemo(
    () => visibleTasks.filter((t) => !t.targetDate),
    [visibleTasks],
  );

  // --- Plans projection for the visible month. ---
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthPlans = useMemo(
    () => visiblePlans.filter((p) => (p.date || "").startsWith(monthPrefix)),
    [visiblePlans, monthPrefix],
  );

  // --- Filter option lists are union of tasks + plans (pre-filter). ---
  const clientOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...visibleTasks.map((t) => t.client || ""),
            ...visiblePlans.map((p) => p.client || ""),
          ].filter(Boolean),
        ),
      ].sort(),
    [visibleTasks, visiblePlans],
  );
  const memberOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...visibleTasks.map((t) => t.responsible || ""),
            ...visiblePlans.map((p) => p.name || ""),
          ].filter(Boolean),
        ),
      ].sort(),
    [visibleTasks, visiblePlans],
  );

  const getMainCategory = (t: Task): string => {
    if (!t.parentId) return t.category || "";
    return mainsById.get(t.parentId)?.category || "";
  };

  const mainCategoryOptions = useMemo(
    () =>
      [
        ...new Set(visibleTasks.map((t) => getMainCategory(t)).filter(Boolean)),
      ].sort(),
    // getMainCategory closes over `mainsById`; include it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTasks, mainsById],
  );

  // --- Apply filters. ---
  const filteredMonthTasks = useMemo(
    () =>
      monthTasks.filter(
        (t) =>
          (!fClient || t.client === fClient) &&
          (!fMember || t.responsible === fMember) &&
          (!fMainCategory || getMainCategory(t) === fMainCategory),
      ),
    // getMainCategory closes over `mainsById`; include it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthTasks, fClient, fMember, fMainCategory, mainsById],
  );
  const filteredMonthPlans = useMemo(
    () =>
      monthPlans.filter(
        (p) =>
          (!fClient || p.client === fClient) &&
          (!fMember || p.name === fMember),
      ),
    [monthPlans, fClient, fMember],
  );

  // --- Group by day. ---
  const tasksByDay = useMemo(() => {
    const m: Record<number, Task[]> = {};
    filteredMonthTasks.forEach((t) => {
      const d = parseInt(t.targetDate.split("-")[2], 10);
      if (!m[d]) m[d] = [];
      m[d].push(t);
    });
    Object.values(m).forEach((arr) =>
      arr.sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
      ),
    );
    return m;
  }, [filteredMonthTasks]);
  const plansByDay = useMemo(() => {
    const m: Record<number, WorkPlan[]> = {};
    filteredMonthPlans.forEach((p) => {
      const d = parseInt((p.date || "").split("-")[2], 10);
      if (!d) return;
      if (!m[d]) m[d] = [];
      m[d].push(p);
    });
    return m;
  }, [filteredMonthPlans]);

  // --- Employee colour map (stable across all visible plan members). ---
  const empColorMap = useMemo<Record<string, MemberPalette>>(() => {
    const names = [
      ...new Set(visiblePlans.map((p) => p.name).filter(Boolean)),
    ].sort();
    const out: Record<string, MemberPalette> = {};
    names.forEach((n, i) => {
      out[n] = EMP_COLORS[i % EMP_COLORS.length];
    });
    return out;
  }, [visiblePlans]);

  const activeMembers = useMemo(
    () => [...new Set(filteredMonthPlans.map((p) => p.name).filter(Boolean))].sort(),
    [filteredMonthPlans],
  );

  // --- Calendar grid setup. ---
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOff = firstDay.getDay();

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };
  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  };

  const showT = tasksVisible(layers);
  const showP = plansVisible(layers);

  // --- Day modal data. ---
  const expandTasks =
    expandDay !== null ? tasksByDay[expandDay] || [] : [];
  const expandPlans =
    expandDay !== null ? plansByDay[expandDay] || [] : [];
  const expandDateLabel =
    expandDay !== null
      ? `${expandDay} ${MONTHS[month]} ${year}`
      : "";

  return (
    <div style={{ padding: "16px 20px" }}>
      <CalendarToolbar
        monthLabel={`${MONTHS[month]} ${year}`}
        onPrev={prevMonth}
        onNext={nextMonth}
        onToday={goToday}
        layers={layers}
        onLayersChange={(v) => {
          setLayers(v);
          setExpandDay(null);
        }}
        subtasksOnly={subtasksOnly}
        onSubtasksOnlyChange={(v) => {
          setSubtasksOnly(v);
          setExpandDay(null);
        }}
        clientOptions={clientOptions}
        memberOptions={memberOptions}
        mainCategoryOptions={mainCategoryOptions}
        fClient={fClient}
        fMember={fMember}
        fMainCategory={fMainCategory}
        onClientChange={(v) => {
          setFClient(v);
          setExpandDay(null);
        }}
        onMemberChange={(v) => {
          setFMember(v);
          setExpandDay(null);
        }}
        onMainCategoryChange={(v) => {
          setFMainCategory(v);
          setExpandDay(null);
        }}
        onClear={() => {
          setFClient("");
          setFMember("");
          setFMainCategory("");
          setExpandDay(null);
        }}
      />

      <CalendarLegend
        showTasks={showT}
        showPlans={showP}
        empColorMap={empColorMap}
        activeMembers={activeMembers}
      />

      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            background: "#f8fafc",
          }}
        >
          {DAYS.map((d) => (
            <div
              key={d}
              style={{
                padding: "8px 4px",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {Array.from({ length: startOff }).map((_, i) => (
            <div
              key={`e${i}`}
              style={{
                minHeight: showP ? 130 : 90,
                borderRight: "1px solid #f1f5f9",
                borderBottom: "1px solid #f1f5f9",
                background: "#fafafa",
              }}
            />
          ))}

          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const isToday = ds === todayStr;
            const dow = new Date(year, month, d).getDay();
            const isWeekend = dow === 0 || dow === 6;
            return (
              <UnifiedDayCell
                key={d}
                dayNumber={d}
                isToday={isToday}
                isWeekend={isWeekend}
                tasks={tasksByDay[d] || []}
                plans={plansByDay[d] || []}
                showTasks={showT}
                showPlans={showP}
                empColorMap={empColorMap}
                mainsById={mainsByIdSlim}
                onClick={() => setExpandDay(d)}
              />
            );
          })}
        </div>
      </div>

      {/* Unscheduled tasks panel — only when Tasks layer is visible and the
          Subtasks-only filter is off. Subtasks always carry a target_date via
          materialization, so the panel is empty under the filter and hidden
          to reduce noise. */}
      {!subtasksOnly && showT && unscheduledTasks.length > 0 && (
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 14,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
            marginTop: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            📋 Unscheduled Tasks ({unscheduledTasks.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unscheduledTasks.map((t) => {
              const col = COLUMNS.find((c) => c.id === t.status);
              return (
                <span
                  key={t.id}
                  title={t.responsible}
                  style={{
                    background: col?.color || "#888",
                    color: "#fff",
                    borderRadius: 4,
                    fontSize: 11,
                    padding: "2px 8px",
                  }}
                >
                  {(t.description || "").slice(0, 28)}
                  {isAdmin || isManager ? ` (${t.responsible || ""})` : ""}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {expandDay !== null && (
        <UnifiedDayModal
          dateLabel={expandDateLabel}
          tasks={expandTasks}
          plans={expandPlans}
          showTasks={showT}
          showPlans={showP}
          empColorMap={empColorMap}
          mainsById={mainsByIdSlim}
          onClose={() => setExpandDay(null)}
        />
      )}
    </div>
  );
}
