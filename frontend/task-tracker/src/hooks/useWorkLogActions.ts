/**
 * Extracted action helpers for WorkLogPage.
 * Pure async functions that receive state / setters / refs as parameters.
 */
import React from "react";
import {
  ApiError,
  apiPatch,
  apiPost,
  dtoToWorkLog,
  type WorkLogWriteRefs,
} from "@/lib/api";
import type {
  WorkLogBulkImportRequest,
  WorkLogBulkImportRow,
  WorkLogDto,
  WorkLogPriorityValue,
  WorkLogUpdate,
} from "@/types/api";
import type { WorkLog } from "@/types";
import { checkBackdate } from "@/utils/backdate";
import { TODAY, getDayName } from "@/utils/date";
import { hoursToDecimal } from "@/utils/hours";
import { validTime } from "@/utils/time";
import { PRIORITIES } from "@/utils/worklog";

interface CoreFields {
  name?: string;
  date: string;
  day: string;
  client: string;
  task_description: string;
  hours_worked: string | null;
  priority: string;
}

export function buildCoreFields(
  d: Record<string, unknown>,
  isAdmin: boolean,
): CoreFields {
  return {
    ...(isAdmin && d.name ? { name: d.name as string } : {}),
    date: d.date as string,
    day: getDayName(d.date as string),
    client: (d.client as string) || "",
    task_description: (d.task_description as string).trim(),
    hours_worked: (d.hours_worked as string) || null,
    priority: (d.priority as string) || "Normal",
  };
}

/** Resolver callback used by the save/import flows to turn display names into uids. */
export interface WorkLogRefResolver {
  (row: Record<string, unknown>): WorkLogWriteRefs;
}

interface SaveAllEditsParams {
  editRows: Record<string, Record<string, unknown>>;
  isAdmin: boolean;
  selectedOrg: string;
  backdateDays: number;
  resolveRefs: WorkLogRefResolver;
  setSaving: (
    fn: (s: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  setLogs: React.Dispatch<React.SetStateAction<WorkLog[]>>;
  setEditRows: (
    fn: (e: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  load: () => void;
}

export async function saveAllEdits({
  editRows,
  isAdmin,
  selectedOrg,
  backdateDays,
  resolveRefs,
  setSaving,
  setLogs,
  setEditRows,
  load,
}: SaveAllEditsParams): Promise<void> {
  const ids = Object.keys(editRows);
  if (!ids.length) return;

  for (const id of ids) {
    const d = editRows[id];
    if (isAdmin && !d.name) {
      alert("Name is required for one of the rows — please select an employee");
      return;
    }
    const orgVal = selectedOrg || (d.organization as string) || "";
    if (!orgVal) {
      alert("Org is required for one of the rows — please select an organization");
      return;
    }
    if (!(d.task_description as string)?.trim()) {
      alert("Task description is required for one of the rows");
      return;
    }
    if (!validTime(d.hours_worked as string)) {
      alert("Hours must be H:MM format (e.g. 1:30) for one of the rows");
      return;
    }
    const err = checkBackdate(d.date as string, backdateDays, isAdmin);
    if (err) {
      alert(err);
      return;
    }
  }

  const bulkSaving: Record<string, boolean> = {};
  ids.forEach((id) => {
    bulkSaving[id] = true;
  });
  setSaving((s) => ({ ...s, ...bulkSaving }));

  const saveOne = async (
    id: string,
  ): Promise<{ id: string; dto?: WorkLogDto; error?: string }> => {
    const d = editRows[id];
    const coreFields = buildCoreFields(d, isAdmin);
    const refs = resolveRefs(d);
    const body: WorkLogUpdate = {
      date: coreFields.date,
      task_description: coreFields.task_description,
      hours_worked: coreFields.hours_worked
        ? hoursToDecimal(coreFields.hours_worked)
        : undefined,
      priority: coreFields.priority as WorkLogPriorityValue,
      client: refs.client ?? undefined,
      org: refs.org ?? undefined,
    };
    try {
      const dto = await apiPatch<WorkLogDto>(`/work_logs/${id}/`, body);
      return { id, dto };
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      return { id, error: msg };
    }
  };

  const results = await Promise.all(ids.map(saveOne));
  const failed = results.filter((r) => r.error);
  const succeeded = results.filter(
    (r): r is { id: string; dto: WorkLogDto } => r.dto !== undefined,
  );

  if (failed.length) {
    alert(
      `${failed.length} row(s) failed to save:\n${failed
        .map((r) => r.error)
        .join("\n")}`,
    );
  }
  if (succeeded.length) {
    setLogs((prev) =>
      prev.map((r) => {
        const s = succeeded.find((x) => x.id === r.id);
        return s ? dtoToWorkLog(s.dto) : r;
      }),
    );
    setEditRows((e) => {
      const n = { ...e };
      succeeded.forEach(({ id }) => {
        delete n[id];
      });
      return n;
    });
    load();
  }

  const done: Record<string, boolean> = {};
  ids.forEach((id) => {
    done[id] = false;
  });
  setSaving((s) => ({ ...s, ...done }));
}

interface HandleImportParams {
  myName: string;
  isAdmin: boolean;
  selectedOrg?: string;
  backdateDays: number;
  resolveImportRefs: (row: { name: string; client: string }) => WorkLogWriteRefs;
  load: () => void;
}

export function handleImport(
  e: React.ChangeEvent<HTMLInputElement>,
  {
    myName,
    isAdmin,
    backdateDays,
    resolveImportRefs,
    load,
  }: HandleImportParams,
): void {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const lines = (ev.target!.result as string)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const header = lines[0].toLowerCase().split(",");
    const idx = (k: string): number => header.findIndex((h) => h.includes(k));
    const iName = idx("name");
    const iDate = idx("date");
    const iClient = idx("client");
    const iTask = idx("task");
    const iHours = idx("hour");
    const iPrio = idx("prior");

    const rows: WorkLogBulkImportRow[] = [];
    const backdateViolations: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]
        .split(",")
        .map((c) => c.replace(/^"|"$/g, "").trim());
      const name = (iName >= 0 ? cols[iName] : myName) || myName;
      const date = iDate >= 0 ? cols[iDate] : TODAY;
      const task = iTask >= 0 ? cols[iTask] : "";
      if (!task) continue;

      const bdErr = checkBackdate(date, backdateDays, isAdmin);
      if (bdErr) {
        backdateViolations.push(`Row ${i + 1} (${date})`);
        continue;
      }

      const clientName = iClient >= 0 ? cols[iClient] : "";
      const refs = resolveImportRefs({ name, client: clientName });
      const hoursRaw = iHours >= 0 ? cols[iHours] : "";
      const priorityRaw = iPrio >= 0 ? cols[iPrio] : "Normal";
      const priority = PRIORITIES.find((p) => p.value === priorityRaw)
        ? (priorityRaw as WorkLogPriorityValue)
        : ("Normal" satisfies WorkLogPriorityValue);

      rows.push({
        date,
        task_description: task,
        hours_worked:
          hoursRaw && validTime(hoursRaw) ? hoursToDecimal(hoursRaw) : "0.00",
        priority,
        client: refs.client,
        org: refs.org,
      });
    }

    if (backdateViolations.length) {
      const limitLabel =
        backdateDays === 0 ? "today only" : `${backdateDays} day(s)`;
      const ok = window.confirm(
        `${backdateViolations.length} row(s) exceed the backdate limit of ${limitLabel} and will be skipped:\n\n` +
          backdateViolations.slice(0, 10).join("\n") +
          (backdateViolations.length > 10
            ? `\n…and ${backdateViolations.length - 10} more`
            : "") +
          `\n\nContinue importing the remaining ${rows.length} row(s)?`,
      );
      if (!ok) return;
    }
    if (!rows.length) {
      alert("No valid rows found in file.");
      return;
    }
    if (!window.confirm(`Import ${rows.length} entries?`)) return;

    try {
      const body: WorkLogBulkImportRequest = { rows };
      await apiPost<unknown>("/work_logs/bulk_import/", body);
      alert(`✅ Imported ${rows.length} entries!`);
      load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Import failed: ${msg}`);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}
