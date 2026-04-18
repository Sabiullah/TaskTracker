import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  dtoToWorkLog,
} from "@/lib/api";
import type { Profile, WorkLog } from "@/types";
import type {
  AppSettingDto,
  AppSettingUpsertRequest,
  WorkLogCreate,
  WorkLogDto,
  WorkLogPriorityValue,
} from "@/types/api";
import { useWorkLogs } from "@/hooks/useWorkLogs";
import { useMasters } from "@/hooks/useMasters";
import { useOrgs } from "@/hooks/useOrgs";
import {
  buildCoreFields as buildCoreFieldsAction,
  saveAllEdits as saveAllEditsAction,
  handleImport as handleImportAction,
} from "@/hooks/useWorkLogActions";
import {
  BLANK_ROW,
  PRIORITIES,
  getPr,
} from "@/utils/worklog";
import { checkBackdate as checkBackdateFn } from "@/utils/backdate";
import { validTime, toMins } from "@/utils/time";
import { hoursToDecimal } from "@/utils/hours";
import { getDayName, localDateStr } from "@/utils/date";
import WorkLogDashboard from "@/components/worklog/WorkLogDashboard";
import WorkPlanTab from "@/components/worklog/WorkPlanTab";
import WorkLogTable from "@/components/worklog/WorkLogTable";
import WorkLogFilterBar from "@/components/worklog/WorkLogFilterBar";

import { useAuth } from "@/hooks/useAuth";

interface WorkLogPageProps {
  profile: Profile | null;
  profiles?: Profile[];
  selectedOrg?: string;
}

type SubTab = "log" | "plan" | "dashboard";

const PR_ORDER: Readonly<Record<string, number>> = {
  "Top Priority": 0,
  Priority: 1,
  Normal: 2,
  "Not Urgent": 3,
};

const BACKDATE_CACHE_KEY = "tt_worklog_backdate_days";
const BACKDATE_SETTING_KEY = "worklog_backdate_days";

interface NewRowDraft extends Omit<WorkLog, "id"> {
  _id: number;
}

export default function WorkLogPage({
  profile,
  profiles = [],
  selectedOrg = "",
}: WorkLogPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>("log");
  const { logs, loading, reload, moveRow: moveRowOnServer } = useWorkLogs();
  const { clients: clientMasters, team: teamMasters } = useMasters();
  const { orgs } = useOrgs();

  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [editRows, setEditRows] = useState<Record<string, WorkLog>>({});
  const [newRows, setNewRows] = useState<NewRowDraft[]>([]);
  const [fMember, setFMember] = useState("");
  const [fClient, setFClient] = useState("");
  const [fDate, setFDate] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [backdateDays, setBackdateDays] = useState<number>(() => {
    const cached = parseInt(localStorage.getItem(BACKDATE_CACHE_KEY) ?? "", 10);
    return Number.isFinite(cached) ? cached : 7;
  });
  const [backdateLoaded, setBackdateLoaded] = useState(false);

  const isAdmin = isAdminInAny();
  const isManager = (isManagerInAny() && !isAdminInAny());
  const myName = profile?.full_name || "";

  // Hydrate backdate setting from /app_settings/
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await apiGet<AppSettingDto>(
          `/app_settings/${BACKDATE_SETTING_KEY}/`,
        );
        if (cancelled) return;
        const n = parseInt(row.value, 10);
        if (Number.isFinite(n)) {
          setBackdateDays(n);
          try {
            localStorage.setItem(BACKDATE_CACHE_KEY, String(n));
          } catch {
            /* storage disabled */
          }
        }
      } catch {
        /* keep cached value */
      } finally {
        if (!cancelled) setBackdateLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveBackdateSetting = useCallback(
    async (n: number): Promise<void> => {
      const prev = backdateDays;
      setBackdateDays(n);
      try {
        localStorage.setItem(BACKDATE_CACHE_KEY, String(n));
      } catch {
        /* storage disabled */
      }
      try {
        const body: AppSettingUpsertRequest = {
          key: BACKDATE_SETTING_KEY,
          value: String(n),
        };
        await apiPost<AppSettingDto>("/app_settings/upsert/", body);
      } catch (err) {
        setBackdateDays(prev);
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Failed to save: ${msg}`);
      }
    },
    [backdateDays],
  );

  // Resolve name → uid
  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [clientMasters]);

  const teamOrgUidByName = useMemo(() => {
    const map: Record<string, string | null> = {};
    teamMasters.forEach((t) => {
      map[t.name] = t.org ?? null;
    });
    return map;
  }, [teamMasters]);

  const orgNameByUid = useMemo(() => {
    const map: Record<string, string> = {};
    orgs.forEach((o) => {
      map[o.id] = o.name;
    });
    return map;
  }, [orgs]);

  // Client → list of org UIDs the client belongs to. ``selectedOrg`` is a
  // uid, so keeping this map uid-based avoids translating between name and
  // uid every time we filter the dropdown.
  const clientOrgMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.org ? [c.org] : [];
    });
    return map;
  }, [clientMasters]);

  // ``orgs`` here is a list of org UIDs, matching the uid stored on each
  // worklog row's ``organization`` field. The table dropdown filters
  // clients with ``c.orgs.includes(selectedOrgUid)`` — keep both sides in
  // uid-space so we never see uid leaks in the UI.
  const clientObjects = useMemo(
    () =>
      clientMasters.map((c) => ({
        name: c.name,
        orgs: c.org ? [c.org] : [],
      })),
    [clientMasters],
  );

  const clients = useMemo(
    () => clientMasters.map((c) => c.name).sort(),
    [clientMasters],
  );

  // Org options for the table dropdown — uid is the option value, name is
  // the visible label. Sorting by name keeps the menu order stable.
  const orgOptions = useMemo(
    () =>
      orgs
        .map((o) => ({ uid: o.id, name: o.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [orgs],
  );

  const availableClients = useMemo(() => {
    if (!selectedOrg) return clients;
    const filtered = clientObjects
      .filter((c) => c.orgs.includes(selectedOrg))
      .map((c) => c.name);
    return filtered.length ? filtered : clients;
  }, [clients, clientObjects, selectedOrg]);

  const memberNames = useMemo(() => {
    if (isAdmin)
      return [
        ...new Set(profiles.map((p) => p.full_name).filter(Boolean)),
      ].sort();
    if (isManager && profile) {
      const team = profiles
        .filter((p) => (p.manager_ids ?? []).includes(profile.id))
        .map((p) => p.full_name)
        .filter(Boolean);
      return [myName, ...team].filter(Boolean);
    }
    return [myName];
  }, [profiles, profile, isAdmin, isManager, myName]);

  // ``row.organization`` is now an org uid (the dropdown value). Fall back
  // to ``selectedOrg`` (also a uid) when the row didn't carry one — happens
  // for new rows created while a header org filter is active.
  const resolveRefs = useCallback(
    (
      row: Record<string, unknown>,
    ): { client: string | undefined; org: string | undefined } => {
      const clientName = (row.client as string | undefined) ?? "";
      const orgRaw = (row.organization as string | undefined) ?? "";
      return {
        client: clientName ? clientUidByName[clientName] : undefined,
        org: orgRaw || selectedOrg || undefined,
      };
    },
    [clientUidByName, selectedOrg],
  );

  // ── Filtered + sorted logs ───────────────────────────────────────────────
  // ``selectedOrg`` is a uid; ``r.organization`` from the API is also a
  // uid — compare them directly. The previous code looked the uid up in
  // ``orgUidByName`` (a name→uid map) which always returned undefined and
  // silently filtered every row out.
  const filtered = useMemo<WorkLog[]>(() => {
    const base = logs.filter(
      (r) =>
        (!fMember || r.name === fMember) &&
        (!fClient || r.client === fClient) &&
        (!fDate || r.date === fDate) &&
        (!fMonth || (r.date || "").startsWith(fMonth)) &&
        (!selectedOrg || (r.organization || "") === selectedOrg),
    );
    if (!sortBy) return base;
    return [...base].sort((a, b) => {
      if (sortBy === "priority") {
        const av = PR_ORDER[a.priority] ?? 2;
        const bv = PR_ORDER[b.priority] ?? 2;
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
  }, [logs, fMember, fClient, fDate, fMonth, sortBy, sortDir, selectedOrg]);

  const totalMins = filtered.reduce((s, r) => s + toMins(r.hours_worked), 0);

  const logClientsAll = [
    ...new Set(logs.map((r) => r.client).filter(Boolean)),
  ].sort();
  const logClients = selectedOrg
    ? logClientsAll.filter((c) => (clientOrgMap[c] || []).includes(selectedOrg))
    : logClientsAll;
  const logMembers =
    isAdmin || isManager
      ? [...new Set(logs.map((r) => r.name).filter(Boolean))].sort()
      : [myName];
  const logMonths = [
    ...new Set(logs.map((r) => (r.date || "").slice(0, 7)).filter(Boolean)),
  ]
    .sort()
    .reverse();

  const minBackdate = useMemo(() => {
    if (backdateDays < 0) return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - backdateDays);
    return localDateStr(d);
  }, [backdateDays]);

  const checkBackdate = (dateStr: string | null | undefined): string | null =>
    checkBackdateFn(dateStr, backdateDays, isAdmin);

  // ── Inline edit helpers ──────────────────────────────────────────────────
  const startEdit = (row: unknown): void => {
    const r = row as WorkLog;
    setEditRows((e) => ({ ...e, [r.id]: { ...r } }));
  };
  const cancelEdit = (id: string): void =>
    setEditRows((e) => {
      const n = { ...e };
      delete n[id];
      return n;
    });
  const setEdit = (id: string, k: string, v: unknown): void =>
    setEditRows((e) => ({ ...e, [id]: { ...e[id], [k]: v } as WorkLog }));

  const buildCoreFields = (d: Record<string, unknown>) =>
    buildCoreFieldsAction(d, isAdmin);

  const saveEdit = async (id: string): Promise<void> => {
    const d = editRows[id];
    if (!d) return;
    if (isAdmin && !d.name) {
      alert("Name is required — please select an employee");
      return;
    }
    const orgUid = selectedOrg || d.organization || "";
    if (!orgUid) {
      alert("Org is required — please select an organization");
      return;
    }
    if (!d.task_description?.trim()) {
      alert("Task is required");
      return;
    }
    if (!validTime(d.hours_worked)) {
      alert("Hours must be H:MM format (e.g. 1:30)");
      return;
    }
    const backdateErr = checkBackdate(d.date);
    if (backdateErr) {
      alert(backdateErr);
      return;
    }
    setSaving((s) => ({ ...s, [id]: true }));
    const refs = resolveRefs({
      ...(d as unknown as Record<string, unknown>),
      organization: orgUid,
    });
    try {
      const coreFields = buildCoreFields(d as unknown as Record<string, unknown>);
      const body = {
        date: coreFields.date,
        task_description: coreFields.task_description,
        hours_worked: coreFields.hours_worked
          ? hoursToDecimal(coreFields.hours_worked)
          : undefined,
        priority: coreFields.priority as WorkLogPriorityValue,
        client: refs.client,
        org: refs.org,
      };
      const dto = await apiPatch<WorkLogDto>(`/work_logs/${id}/`, body);
      // realtime WS will refresh state; also poke reload for instant feedback
      await reload();
      void dto;
      cancelEdit(id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving((s) => ({ ...s, [id]: false }));
    }
  };

  const saveAllEdits = (): Promise<void> =>
    saveAllEditsAction({
      editRows: editRows as unknown as Record<string, Record<string, unknown>>,
      isAdmin,
      selectedOrg,
      backdateDays,
      resolveRefs,
      setSaving,
      setLogs: () => {
        /* state owned by useWorkLogs; rely on reload */
      },
      setEditRows: setEditRows as unknown as (
        fn: (e: Record<string, unknown>) => Record<string, unknown>,
      ) => void,
      load: () => {
        void reload();
      },
    });

  const deleteRow = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await apiDelete(`/work_logs/${id}/`);
      setSelected((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await reload();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  };

  // ── Selection helpers ────────────────────────────────────────────────────
  const toggleSelect = (id: string): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const isAllSelected = (rows: WorkLog[]): boolean =>
    rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleSelectAll = (rows: WorkLog[]): void => {
    if (isAllSelected(rows)) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const handleBulkDelete = async (): Promise<void> => {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selected.size} selected entr${selected.size === 1 ? "y" : "ies"}? This cannot be undone.`,
      )
    )
      return;
    const ids = [...selected];
    const results = await Promise.allSettled(
      ids.map((id) => apiDelete(`/work_logs/${id}/`)),
    );
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      alert(`${failed.length} delete(s) failed.`);
    }
    setSelected(new Set());
    await reload();
  };

  // ── New rows ─────────────────────────────────────────────────────────────
  // ``selectedOrg`` is a uid; the team master also stores the employee's
  // org as a uid — keep both in uid-space so the dropdown's ``value``
  // (also a uid) matches the option list.
  const addNewRow = (): void => {
    const empOrgUid = teamOrgUidByName[myName] ?? null;
    const defaultOrg = selectedOrg || empOrgUid || "";
    const defaultName = isAdmin ? "" : myName;
    setNewRows((r) => [
      ...r,
      {
        ...BLANK_ROW,
        _id: Date.now(),
        name: defaultName,
        organization: defaultOrg,
      } as NewRowDraft,
    ]);
  };

  const setNew = (idx: number, k: string, v: unknown): void =>
    setNewRows((r) =>
      r.map((row, i) => (i === idx ? ({ ...row, [k]: v } as NewRowDraft) : row)),
    );
  const cancelNew = (idx: number): void =>
    setNewRows((r) => r.filter((_, i) => i !== idx));

  const saveNew = async (idx: number): Promise<void> => {
    const d = newRows[idx];
    if (!d) return;
    const targetName = isAdmin && d.name ? d.name : myName;
    if (isAdmin && !targetName) {
      alert("Name is required — please select an employee");
      return;
    }
    const orgUid = selectedOrg || d.organization || "";
    if (!orgUid) {
      alert("Org is required — please select an organization");
      return;
    }
    if (!d.client) {
      alert("Client is required — please select a client");
      return;
    }
    if (!d.task_description?.trim()) {
      alert("Task is required");
      return;
    }
    if (!validTime(d.hours_worked)) {
      alert("Hours must be H:MM format (e.g. 1:30)");
      return;
    }
    const backdateErr = checkBackdate(d.date);
    if (backdateErr) {
      alert(backdateErr);
      return;
    }
    const key = "new" + idx;
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const refs = resolveRefs({ ...d, organization: orgUid });
      const body: WorkLogCreate = {
        date: d.date,
        task_description: d.task_description.trim(),
        hours_worked: d.hours_worked ? hoursToDecimal(d.hours_worked) : "0.00",
        priority: (d.priority as WorkLogPriorityValue) || "Normal",
        client: refs.client,
        org: refs.org,
      };
      const dto = await apiPost<WorkLogDto>("/work_logs/", body);
      void dtoToWorkLog(dto);
      cancelNew(idx);
      await reload();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const resolveImportRefs = useCallback(
    (row: { name: string; client: string }) => ({
      client: row.client ? clientUidByName[row.client] : undefined,
      org: selectedOrg || teamOrgUidByName[row.name] || undefined,
    }),
    [clientUidByName, selectedOrg, teamOrgUidByName],
  );

  const handleImport = (e: ChangeEvent<HTMLInputElement>): void =>
    handleImportAction(e, {
      myName,
      isAdmin,
      selectedOrg,
      backdateDays,
      resolveImportRefs,
      load: () => {
        void reload();
      },
    });

  const moveRow = async (
    id: string,
    direction: "up" | "down",
  ): Promise<void> => {
    const ids = filtered.map((r) => r.id);
    setMoving(id);
    try {
      await moveRowOnServer(id, direction, ids);
    } finally {
      setMoving(null);
    }
  };

  return (
    <div style={{ padding: "16px 20px" }}>
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
        <div className="page-title">📝 Daily Work Log</div>
        <div
          className="wl-subtab-bar"
          style={{
            display: "flex",
            gap: 6,
            background: "#f1f5f9",
            padding: 4,
            borderRadius: 8,
          }}
        >
          {(
            [
              ["log", "📋 Log Table"],
              ["plan", "📅 Work Plan"],
              ["dashboard", "📊 Dashboard"],
            ] as const
          ).map(([id, lbl]) => (
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

      {subTab === "log" && (
        <>
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

          <WorkLogFilterBar
            selectedOrg={selectedOrg}
            isAdmin={isAdmin}
            isManager={isManager}
            logMembers={logMembers}
            logClients={logClients}
            logMonths={logMonths}
            fMember={fMember}
            fClient={fClient}
            fDate={fDate}
            fMonth={fMonth}
            sortBy={sortBy}
            sortDir={sortDir}
            totalMins={totalMins}
            filteredCount={filtered.length}
            filtered={filtered}
            editRowsCount={Object.keys(editRows).length}
            selectedCount={selected.size}
            backdateDays={backdateDays}
            backdateLoaded={backdateLoaded}
            fileRef={fileRef}
            onMemberChange={setFMember}
            onClientChange={setFClient}
            onDateChange={setFDate}
            onMonthChange={setFMonth}
            onClearFilters={() => {
              setFMember("");
              setFClient("");
              setFDate("");
              setFMonth("");
            }}
            onClearSort={() => {
              setSortBy("");
              setSortDir("asc");
            }}
            onSaveAll={() => {
              void saveAllEdits();
            }}
            onBulkDelete={() => {
              void handleBulkDelete();
            }}
            onImport={handleImport}
            onAddRow={addNewRow}
            onSaveBackdate={saveBackdateSetting}
          />

          <WorkLogTable
            logs={filtered}
            newRows={newRows}
            editRows={editRows}
            saving={saving}
            moving={moving}
            selected={selected}
            isAdmin={isAdmin}
            isManager={isManager}
            myName={myName}
            memberNames={memberNames}
            orgs={orgOptions}
            selectedOrg={selectedOrg}
            orgNameByUid={orgNameByUid}
            clientObjects={clientObjects}
            availableClients={availableClients}
            minBackdate={minBackdate}
            validTime={validTime}
            getDayName={getDayName}
            getPr={getPr}
            PRIORITIES={PRIORITIES}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onSetEdit={setEdit}
            onSaveEdit={(id) => {
              void saveEdit(id);
            }}
            onDeleteRow={(id) => {
              void deleteRow(id);
            }}
            onMoveRow={(id, direction) => {
              void moveRow(id, direction);
            }}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={() => toggleSelectAll(filtered)}
            isAllSelected={isAllSelected(filtered)}
            onSetNew={setNew}
            onCancelNew={cancelNew}
            onSaveNew={(idx) => {
              void saveNew(idx);
            }}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={(key) => {
              if (sortBy === key)
                setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              else {
                setSortBy(key);
                setSortDir("asc");
              }
            }}
            loading={loading}
          />
        </>
      )}

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

      {subTab === "dashboard" && (
        <WorkLogDashboard
          logs={logs}
          isAdmin={isAdmin}
          isManager={isManager}
          myName={myName}
          selectedOrg={selectedOrg}
          allOrgs={orgOptions.map((o) => o.name)}
        />
      )}
    </div>
  );
}
