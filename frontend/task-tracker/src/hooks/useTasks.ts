import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  dtoToTask,
  taskToCreate,
  taskWithSubtasksToCreate,
  ws,
  type SubtaskWriteRefs,
  type TaskWriteRefs,
} from "@/lib/api";
import type { ID, SubtaskItem, Task, TaskStatus } from "@/types";
import type {
  TaskBulkCreateRow,
  TaskDto,
  TaskLogCreate,
  TaskStatusValue,
  TaskUpdate,
  TaskWithPlansCreate,
} from "@/types/api";
import { computeStatus } from "@/utils/task";

export interface TaskPatch {
  targetDate?: string | null;
  expectedDate?: string | null;
  completedDate?: string | null;
  remarks?: string;
  description?: string;
  // FK refs sent as UIDs. `null` clears the field on the server.
  client?: string | null;
  responsible?: string | null;
  reportingManager?: string | null;
}

export interface UseTasksReturn {
  tasks: Task[];
  loading: boolean;
  reload: () => Promise<void>;
  saveTask: (
    taskData: Partial<Task> & { id?: ID },
    myName: string,
    refs: TaskWriteRefs,
  ) => Promise<void>;
  saveGoalTree: (
    taskData: Partial<Task> & { id?: ID },
    subs: SubtaskItem[],
    myName: string,
    refs: TaskWriteRefs,
    subRefs: SubtaskWriteRefs,
    plansPayload?: Array<{ subcategory_uid: string; default_owner_uid: string | null }>,
  ) => Promise<boolean>;
  patchTask: (taskId: ID, patch: TaskPatch) => Promise<void>;
  deleteTask: (taskId: ID) => Promise<void>;
  moveTask: (taskId: ID, newStatus: TaskStatus) => Promise<void>;
  importTasks: (
    importedTasks: Task[],
    mode: "replace" | "update",
    refs: TaskWriteRefs,
  ) => Promise<void>;
}

const STATUS_DOMAIN_TO_DTO: Readonly<Record<TaskStatus, TaskStatusValue>> = {
  "Future Task/Goals": "future_goal",
  TBC: "tbc",
  Pending: "pending",
  Tomorrow: "tomorrow",
  TodayTask: "today_task",
  Overdue: "overdue",
  Ontime: "completed",
  Completed: "completed",
  "Completed Delay": "completed_delay",
};

function dtoToDomainWithStatus(dto: TaskDto): Task {
  const t = dtoToTask(dto);
  return { ...t, status: computeStatus(t) };
}

export function useTasks(): UseTasksReturn {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<TaskDto[]>("/tasks/");
    setTasks(dtos.map(dtoToDomainWithStatus));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubscribe = ws.subscribe<TaskDto>("tasks", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToDomainWithStatus(evt.record);
        setTasks((prev) =>
          prev.some((t) => t.id === next.id) ? prev : [...prev, next],
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToDomainWithStatus(evt.record);
        // Upsert: the backend re-broadcasts the whole goal tree on a PATCH
        // using the parent's event, so newly-created subtasks arrive here
        // as UPDATE rather than INSERT. Append unknown rows instead of
        // dropping them — that's why new subs needed a page refresh before.
        setTasks((prev) =>
          prev.some((t) => t.id === next.id)
            ? prev.map((t) => (t.id === next.id ? next : t))
            : [...prev, next],
        );
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (deletedId) setTasks((prev) => prev.filter((t) => t.id !== deletedId));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload]);

  const saveTask = useCallback(
    async (
      taskData: Partial<Task> & { id?: ID },
      myName: string,
      refs: TaskWriteRefs,
    ): Promise<void> => {
      const withStatus: Task = {
        ...(taskData as Task),
        status: computeStatus(taskData as Task),
      };
      const payload = taskToCreate(withStatus, refs);

      try {
        if (taskData.id) {
          const existing = tasks.find((t) => t.id === taskData.id);
          await apiPatch<TaskDto>(`/tasks/${taskData.id}/`, payload);

          if (existing) {
            const FIELDS = [
              { key: "description", label: "Description" },
              { key: "client", label: "Client" },
              { key: "category", label: "Category" },
              { key: "responsible", label: "Responsible" },
              { key: "reportingManager", label: "Reporting Manager" },
              { key: "targetDate", label: "Target Date" },
              { key: "recurrence", label: "Recurrence" },
            ] as const;
            const changes = FIELDS.filter(
              (f) => (existing[f.key] || "") !== (withStatus[f.key] || ""),
            ).map((f) => ({
              field: f.label,
              from: String(existing[f.key] ?? ""),
              to: String(withStatus[f.key] ?? ""),
            }));
            if (changes.length > 0) {
              const logBody: TaskLogCreate = {
                task_uid: String(taskData.id),
                changes,
              };
              await apiPost<unknown>("/task_logs/", logBody);
              // `myName` is recorded server-side from the authenticated user;
              // passed in for symmetry with pre-migration signature only.
              void myName;
            }
          }
        } else {
          await apiPost<TaskDto>("/tasks/", payload);
        }
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
      }
    },
    [tasks],
  );

  const saveGoalTree = useCallback(
    async (
      taskData: Partial<Task> & { id?: ID },
      subs: SubtaskItem[],
      _myName: string,
      refs: TaskWriteRefs,
      subRefs: SubtaskWriteRefs,
      plansPayload?: Array<{ subcategory_uid: string; default_owner_uid: string | null }>,
    ): Promise<boolean> => {
      const withStatus: Task = {
        ...(taskData as Task),
        status: computeStatus(taskData as Task),
      };
      try {
        if (taskData.id) {
          const payload = taskWithSubtasksToCreate(withStatus, subs, refs, subRefs);
          await apiPatch<TaskDto>(`/tasks/${taskData.id}/`, payload);
        } else if (plansPayload && plansPayload.length > 0) {
          const body: TaskWithPlansCreate = {
            ...taskToCreate(withStatus, refs),
            engagement_start: taskData.engagement_start ?? undefined,
            engagement_end: taskData.engagement_end ?? undefined,
            plans: plansPayload.map((p) => ({
              subcategory: p.subcategory_uid,
              default_owner: p.default_owner_uid ?? undefined,
            })),
          };
          await apiPost<TaskDto>("/tasks/", body);
        } else {
          const payload = taskWithSubtasksToCreate(withStatus, subs, refs, subRefs);
          await apiPost<TaskDto>("/tasks/", payload);
        }
        return true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
        return false;
      }
    },
    [],
  );

  const patchTask = useCallback(
    async (taskId: ID, patch: TaskPatch): Promise<void> => {
      // Distinguish "field omitted" from "field cleared to null". A `null`
      // in `patch` means the user explicitly cleared the date — it must
      // reach the server as `null`, not be collapsed to `undefined` and
      // dropped from the JSON body.
      const body: TaskUpdate = {
        ...("targetDate" in patch ? { target_date: patch.targetDate } : {}),
        ...("expectedDate" in patch ? { expected_date: patch.expectedDate } : {}),
        ...("completedDate" in patch ? { completed_date: patch.completedDate } : {}),
        ...("remarks" in patch ? { remarks: patch.remarks } : {}),
        ...("description" in patch ? { description: patch.description } : {}),
        ...("client" in patch ? { client: patch.client ?? undefined } : {}),
        ...("responsible" in patch ? { responsible: patch.responsible ?? undefined } : {}),
        ...("reportingManager" in patch ? { reporting_manager: patch.reportingManager ?? undefined } : {}),
      };
      await apiPatch<TaskDto>(`/tasks/${taskId}/`, body);
    },
    [],
  );

  const deleteTask = useCallback(async (taskId: ID): Promise<void> => {
    if (!window.confirm("Delete this task?")) return;
    try {
      await apiDelete(`/tasks/${taskId}/`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  }, []);

  const moveTask = useCallback(
    async (taskId: ID, newStatus: TaskStatus): Promise<void> => {
      const body: TaskUpdate = { status: STATUS_DOMAIN_TO_DTO[newStatus] };
      try {
        await apiPatch<TaskDto>(`/tasks/${taskId}/`, body);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Move failed: ${msg}`);
      }
    },
    [],
  );

  const importTasks = useCallback(
    async (
      importedTasks: Task[],
      mode: "replace" | "update",
      refs: TaskWriteRefs,
    ): Promise<void> => {
      const withStatus = importedTasks.map((t) => ({
        ...t,
        status: computeStatus(t),
      }));

      if (mode === "replace") {
        try {
          // Backend route declares ``methods=["delete"]`` — POSTing here
          // was 405-ing. Use the DELETE helper; ``resolve_admin_org`` picks
          // the caller's sole admin org, or reads ``?org=<uid>`` if needed.
          await apiDelete("/tasks/delete_all/");
          const rows: TaskBulkCreateRow[] = withStatus.map((t) =>
            taskToCreate(t, refs),
          );
          await apiPost<unknown>("/tasks/bulk_create/", { rows });
          alert(`✅ Replaced all tasks — ${rows.length} tasks imported.`);
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : String(err);
          alert(`Import failed: ${msg}`);
        }
        return;
      }

      // mode === "update"
      const norm = (s: string): string =>
        (s || "").toLowerCase().replace(/\s+/g, " ").trim();
      const key = (t: Task): string => `${norm(t.client)}||${norm(t.description)}`;

      const existingMap = new Map(tasks.map((t) => [key(t), t]));
      const toUpdate = withStatus.filter((t) => existingMap.has(key(t)));
      const toInsert = withStatus.filter((t) => !existingMap.has(key(t)));

      let updated = 0;
      let inserted = 0;
      const failed: string[] = [];

      for (const t of toUpdate) {
        const existing = existingMap.get(key(t));
        if (!existing) continue;
        try {
          await apiPatch<TaskDto>(
            `/tasks/${existing.id}/`,
            taskToCreate(t, refs),
          );
          updated++;
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : String(err);
          failed.push(`Update "${t.description}": ${msg}`);
        }
      }

      if (toInsert.length) {
        try {
          const rows: TaskBulkCreateRow[] = toInsert.map((t) =>
            taskToCreate(t, refs),
          );
          await apiPost<unknown>("/tasks/bulk_create/", { rows });
          inserted = rows.length;
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : String(err);
          failed.push(`Insert batch: ${msg}`);
        }
      }

      const lines = [
        `✅ Import complete!`,
        `• ${updated} tasks updated (matched by Client + Description)`,
        `• ${inserted} new tasks added`,
        failed.length
          ? `• ⚠️ ${failed.length} errors:\n  ${failed.join("\n  ")}`
          : "",
        toInsert.length > 0
          ? `\n📋 New tasks (not in DB before):\n  ${toInsert
              .map((t) => `${t.client} — ${t.description}`)
              .join("\n  ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      alert(lines);
    },
    [tasks],
  );

  return {
    tasks,
    loading,
    reload,
    saveTask,
    saveGoalTree,
    patchTask,
    deleteTask,
    moveTask,
    importTasks,
  };
}
