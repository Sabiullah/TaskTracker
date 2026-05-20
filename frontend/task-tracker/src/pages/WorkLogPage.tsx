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
import { PRIORITIES, getPr } from "@/utils/worklog";
import { checkBackdate as checkBackdateFn } from "@/utils/backdate";
import { validTime, toMins } from "@/utils/time";
import { hoursToDecimal } from "@/utils/hours";
import { getDayName, localDateStr } from "@/utils/date";
import WorkLogDashboard from "@/components/worklog/WorkLogDashboard";
import WorkPlanTab from "@/components/worklog/WorkPlanTab";
import WorkLogTable from "@/components/worklog/WorkLogTable";
import type {
  NewRowDraft,
  NewRowSlot,
} from "@/components/worklog/NewWorkLogRow";
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

export default function WorkLogPage({
  profile,
  profiles = [],
  selectedOrg = "",
}: WorkLogPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>("log");
  const {
    logs,
    loading,
    reload,
    setLogs,
    moveRow: moveRowOnServer,
  } = useWorkLogs();
  const { clients: clientMasters } = useMasters();
  const { orgs } = useOrgs();

  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [editRows, setEditRows] = useState<Record<string, WorkLog>>({});
  /** Unsaved-row slots — IDs + initial defaults. The per-row draft state
   *  (what the user is typing) lives inside each NewWorkLogRow so typing
   *  doesn't bubble back up and re-render the whole page. */
  const [newRowSlots, setNewRowSlots] = useState<NewRowSlot[]>([]);
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

  // Hydrate backdate setting from /app_settings/. When the caller belongs
  // to multiple orgs the list is scoped by ``?org=`` so we fetch the value
  // tied to the currently selected org header.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = selectedOrg
          ? `?org=${encodeURIComponent(selectedOrg)}`
          : "";
        const row = await apiGet<AppSettingDto>(
          `/app_settings/${BACKDATE_SETTING_KEY}/${qs}`,
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
  }, [selectedOrg]);

  const saveBackdateSetting = useCallback(
    async (n: number): Promise<void> => {
      // Backdate is stored per-org. When the user has multiple orgs the
      // backend needs an explicit ``org`` to disambiguate; ``selectedOrg``
      // comes from the header picker.
      if (!selectedOrg && orgs.length > 1) {
        alert(
          "Pick an organisation from the header before changing the backdate setting.",
        );
        return;
      }
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
          ...(selectedOrg ? { org: selectedOrg } : {}),
        };
        await apiPost<AppSettingDto>("/app_settings/upsert/", body);
      } catch (err) {
        setBackdateDays(prev);
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Failed to save: ${msg}`);
      }
    },
    [backdateDays, selectedOrg, orgs.length],
  );

  // Resolve name → uid
  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    clientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [clientMasters]);

  // Map full_name → preferred org uid for a team member. Falls back from
  // the legacy ``Master(type="team")`` list to the User's ``orgs`` array —
  // we take the first membership uid as their home org, which matches the
  // old behaviour where each team-master row named exactly one org.
  const teamOrgUidByName = useMemo(() => {
    const map: Record<string, string | null> = {};
    profiles.forEach((p) => {
      if (!p.full_name) return;
      const firstOrg = p.orgs[0]?.uid ?? null;
      map[p.full_name] = firstOrg;
    });
    return map;
  }, [profiles]);

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
      // Prefer the M2M list; fall back to the legacy FK so rows served
      // by an older backend still produce a non-empty org list.
      map[c.name] =
        c.orgs && c.orgs.length ? [...c.orgs] : c.org ? [c.org] : [];
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
        orgs: c.orgs && c.orgs.length ? [...c.orgs] : c.org ? [c.org] : [],
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

  // Memoized so per-keystroke re-renders (typing in a new/edit row) don't
  // iterate over the full ``logs`` array four times. With 1000+ rows this
  // was the visible cause of input lag.
  const totalMins = useMemo(
    () => filtered.reduce((s, r) => s + toMins(r.hours_worked), 0),
    [filtered],
  );

  const logClientsAll = useMemo(
    () => [...new Set(logs.map((r) => r.client).filter(Boolean))].sort(),
    [logs],
  );
  const logClients = useMemo(
    () =>
      selectedOrg
        ? logClientsAll.filter((c) =>
            (clientOrgMap[c] || []).includes(selectedOrg),
          )
        : logClientsAll,
    [logClientsAll, clientOrgMap, selectedOrg],
  );
  const logMembers = useMemo(
    () =>
      isAdmin || isManager
        ? [...new Set(logs.map((r) => r.name).filter(Boolean))].sort()
        : [myName],
    [logs, isAdmin, isManager, myName],
  );
  const logMonths = useMemo(
    () =>
      [
        ...new Set(
          logs.map((r) => (r.date || "").slice(0, 7)).filter(Boolean),
        ),
      ]
        .sort()
        .reverse(),
    [logs],
  );

  const minBackdate = useMemo(() => {
    if (backdateDays < 0) return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - backdateDays);
    return localDateStr(d);
  }, [backdateDays]);

  const checkBackdate = useCallback(
    (dateStr: string | null | undefined): string | null =>
      checkBackdateFn(dateStr, backdateDays, isAdmin),
    [backdateDays, isAdmin],
  );

  // ── Inline edit helpers ──────────────────────────────────────────────────
  // Stable callbacks so the memoized row component (``WorkLogRow``) sees
  // the same prop references across renders and bails out of re-render via
  // ``React.memo`` when nothing about that row actually changed.
  const startEdit = useCallback((row: unknown): void => {
    const r = row as WorkLog;
    setEditRows((e) => ({ ...e, [r.id]: { ...r } }));
  }, []);
  const cancelEdit = useCallback(
    (id: string): void =>
      setEditRows((e) => {
        const n = { ...e };
        delete n[id];
        return n;
      }),
    [],
  );
  const setEdit = useCallback(
    (id: string, k: string, v: unknown): void =>
      setEditRows((e) => ({ ...e, [id]: { ...e[id], [k]: v } as WorkLog })),
    [],
  );

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
    if (!d.date) {
      alert("Date is required");
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
      // Only include keys the user actually set. Django's ``DateField`` and
      // the ``priority`` choice reject ``""`` with a 400; a PATCH shouldn't
      // need to re-send unchanged fields anyway. ``undefined`` values are
      // dropped during JSON serialisation.
      const body: Record<string, unknown> = {
        task_description: coreFields.task_description,
      };
      if (coreFields.date) body.date = coreFields.date;
      if (coreFields.hours_worked) {
        body.hours_worked = hoursToDecimal(coreFields.hours_worked);
      }
      if (coreFields.priority) {
        body.priority = coreFields.priority as WorkLogPriorityValue;
      }
      if (refs.client) body.client = refs.client;
      if (refs.org) body.org = refs.org;
      // Use the PATCH response to patch just this row locally. The WS
      // event will arrive shortly and re-apply; a full ``reload()`` here
      // would refetch every worklog on every keystroke-save — 135+ rows
      // is noticeably laggy on the server.
      const dto = await apiPatch<WorkLogDto>(`/work_logs/${id}/`, body);
      const next = dtoToWorkLog(dto);
      setLogs((prev) => prev.map((r) => (r.id === id ? next : r)));
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

  const deleteRow = useCallback(
    async (id: string): Promise<void> => {
      if (!window.confirm("Delete this entry?")) return;
      try {
        await apiDelete(`/work_logs/${id}/`);
        setSelected((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        setLogs((prev) => prev.filter((r) => r.id !== id));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Delete failed: ${msg}`);
      }
    },
    [setLogs],
  );

  // ── Selection helpers ────────────────────────────────────────────────────
  const toggleSelect = useCallback(
    (id: string): void =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
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
    // Drop the deleted rows locally. One reload only when something failed
    // (so the UI reflects which ones actually persisted).
    if (failed.length) {
      await reload();
    } else {
      const idSet = new Set(ids);
      setLogs((prev) => prev.filter((r) => !idSet.has(r.id)));
    }
  };

  // ── New rows ─────────────────────────────────────────────────────────────
  // ``selectedOrg`` is a uid; the team master also stores the employee's
  // org as a uid — keep both in uid-space so the dropdown's ``value``
  // (also a uid) matches the option list. Defaults are captured at add-time
  // and live with the slot; the row component owns its draft from there.
  const addNewRow = useCallback((): void => {
    const empOrgUid = teamOrgUidByName[myName] ?? null;
    const defaultOrg = selectedOrg || empOrgUid || "";
    const defaultName = isAdmin ? "" : myName;
    setNewRowSlots((s) => [
      ...s,
      { id: Date.now(), defaultName, defaultOrg },
    ]);
  }, [teamOrgUidByName, myName, selectedOrg, isAdmin]);

  const cancelNew = useCallback(
    (id: number): void =>
      setNewRowSlots((s) => s.filter((slot) => slot.id !== id)),
    [],
  );

  const saveNew = useCallback(
    async (id: number, draft: NewRowDraft): Promise<void> => {
      const targetName = isAdmin && draft.name ? draft.name : myName;
      if (isAdmin && !targetName) {
        alert("Name is required — please select an employee");
        return;
      }
      const orgUid = selectedOrg || draft.organization || "";
      if (!orgUid) {
        alert("Org is required — please select an organization");
        return;
      }
      if (!draft.client) {
        alert("Client is required — please select a client");
        return;
      }
      if (!draft.task_description?.trim()) {
        alert("Task is required");
        return;
      }
      if (!validTime(draft.hours_worked)) {
        alert("Hours must be H:MM format (e.g. 1:30)");
        return;
      }
      const backdateErr = checkBackdate(draft.date);
      if (backdateErr) {
        alert(backdateErr);
        return;
      }
      const key = "new" + id;
      setSaving((s) => ({ ...s, [key]: true }));
      try {
        const refs = resolveRefs({ ...draft, organization: orgUid });
        const body: WorkLogCreate = {
          date: draft.date,
          task_description: draft.task_description.trim(),
          hours_worked: draft.hours_worked
            ? hoursToDecimal(draft.hours_worked)
            : "0.00",
          priority: (draft.priority as WorkLogPriorityValue) || "Normal",
          client: refs.client,
          org: refs.org,
        };
        const dto = await apiPost<WorkLogDto>("/work_logs/", body);
        const next = dtoToWorkLog(dto);
        setLogs((prev) =>
          prev.some((r) => r.id === next.id) ? prev : [...prev, next],
        );
        setNewRowSlots((s) => s.filter((slot) => slot.id !== id));
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
      } finally {
        setSaving((s) => ({ ...s, [key]: false }));
      }
    },
    [
      isAdmin,
      myName,
      selectedOrg,
      checkBackdate,
      resolveRefs,
      setLogs,
    ],
  );

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

  const moveRow = useCallback(
    async (id: string, direction: "up" | "down"): Promise<void> => {
      const ids = filtered.map((r) => r.id);
      setMoving(id);
      try {
        await moveRowOnServer(id, direction, ids);
      } finally {
        setMoving(null);
      }
    },
    [filtered, moveRowOnServer],
  );

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
            newRowSlots={newRowSlots}
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
            onCancelNew={cancelNew}
            onSaveNew={(id, draft) => {
              void saveNew(id, draft);
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
          selectedOrg={selectedOrg}
        />
      )}

      {subTab === "dashboard" && (
        <WorkLogDashboard
          logs={logs}
          isAdmin={isAdmin}
          isManager={isManager}
          myName={myName}
          selectedOrg={selectedOrg}
          allOrgs={orgOptions}
        />
      )}
    </div>
  );
}
