import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  attendanceToCreate,
  dtoToAttendance,
  ws,
} from "@/lib/api";
import type { AttendanceRecord, ID, Profile } from "@/types";
import type {
  AppSettingDto,
  AppSettingUpsertRequest,
  AttendanceDto,
  AttendanceUpdate,
} from "@/types/api";

const BACKDATE_CACHE_KEY = "tt_attendance_backdate_days";
const BACKDATE_SETTING_KEY = "attendance_backdate_days";

export interface UseAttendanceReturn {
  records: AttendanceRecord[];
  loading: boolean;
  reload: () => Promise<void>;
  saveRecord: (
    form: Partial<AttendanceRecord>,
    id: ID | null,
    userUid?: ID,
  ) => Promise<void>;
  deleteRecord: (id: ID) => Promise<void>;
  quickPunch: () => Promise<void>;
  backdateDays: number;
  backdateLoaded: boolean;
  saveBackdateSetting: (n: number) => Promise<void>;
  managedNames: string[];
}

export function useAttendance(
  profile: Profile | null,
  profiles: Profile[],
  selectedOrg?: string,
): UseAttendanceReturn {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [backdateDays, setBackdateDays] = useState<number>(() => {
    try {
      const cached = localStorage.getItem(BACKDATE_CACHE_KEY);
      const n = parseInt(cached ?? "", 10);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  });
  const [backdateLoaded, setBackdateLoaded] = useState(false);

  const myName = profile?.full_name || "";

  const managedNames = useMemo(
    () =>
      profiles
        .filter((p) =>
          (p.manager_ids?.length ? p.manager_ids : []).includes(
            profile?.id || "",
          ),
        )
        .map((p) => p.full_name)
        .filter(Boolean),
    [profiles, profile?.id],
  );

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<AttendanceDto[]>("/attendance/");
    // Django already applies admin/manager/employee visibility filtering
    // server-side, so we just convert.
    //
    // Dedupe by id — a multi-org admin (e.g. admin in both 4D and YBV) can
    // receive the same attendance row twice from the backend when the
    // visibility OR-clauses overlap on the row's org. Without this, the Log
    // tab renders ghost duplicates (same employee + date + login twice) and
    // the Total/Present stat cards double-count those days. Keep the latest
    // copy seen so a fresh row from a websocket race doesn't get clobbered.
    const byId = new Map<string, AttendanceRecord>();
    for (const dto of dtos) {
      const rec = dtoToAttendance(dto);
      byId.set(rec.id, rec);
    }
    const mapped = Array.from(byId.values());
    mapped.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.employee_name.localeCompare(b.employee_name);
    });
    setRecords(mapped);
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

    const unsubscribe = ws.subscribe<AttendanceDto>("attendance", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToAttendance(evt.record);
        setRecords((prev) =>
          prev.some((r) => r.id === next.id) ? prev : [next, ...prev],
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToAttendance(evt.record);
        setRecords((prev) => prev.map((r) => (r.id === next.id ? next : r)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (deletedId)
          setRecords((prev) => prev.filter((r) => r.id !== deletedId));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload]);

  // Hydrate the backdate setting from /app_settings/
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
            /* storage unavailable */
          }
        }
      } catch {
        /* network/auth — fall back to localStorage cache */
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
        /* storage unavailable */
      }
      try {
        // ``selectedOrg`` is the org currently chosen in the header pill.
        // The backend's ``resolve_admin_org`` requires an explicit ``org``
        // whenever the caller is admin in 2+ orgs — without this the upsert
        // 400s with ``org is required (you belong to multiple organisations)``.
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
    [backdateDays, selectedOrg],
  );

  const saveRecord = useCallback(
    async (
      form: Partial<AttendanceRecord>,
      id: ID | null,
      userUid?: ID,
    ): Promise<void> => {
      const record: AttendanceRecord = {
        id: id ?? "",
        user_id: userUid ?? profile?.id ?? "",
        employee_name: form.employee_name || myName,
        date: form.date || "",
        login_time: form.login_time || null,
        logout_time: form.logout_time || null,
        work_location: form.work_location || "Office",
        status: form.status || "Present",
        remarks: form.remarks?.trim() || null,
      };
      const payload = attendanceToCreate(record);

      if (id) {
        const body: AttendanceUpdate = payload;
        await apiPatch<AttendanceDto>(`/attendance/${id}/`, body);
      } else {
        const targetProfile = profiles.find(
          (p) => p.full_name === record.employee_name,
        );
        await apiPost<AttendanceDto>("/attendance/", {
          ...payload,
          user: targetProfile?.id ?? userUid ?? profile?.id ?? undefined,
          // Multi-org callers must pin which org the new row lands in;
          // without this the backend 400s with "`org` is required".
          ...(selectedOrg ? { org: selectedOrg } : {}),
        });
      }
    },
    [myName, profile?.id, profiles, selectedOrg],
  );

  const deleteRecord = useCallback(async (id: ID): Promise<void> => {
    if (!window.confirm("Delete this attendance record?")) return;
    await apiDelete(`/attendance/${id}/`);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const quickPunch = useCallback(async (): Promise<void> => {
    try {
      const dto = await apiPost<AttendanceDto>(
        "/attendance/quick_punch/",
        {},
      );
      const next = dtoToAttendance(dto);
      setRecords((prev) => {
        const existing = prev.find((r) => r.id === next.id);
        return existing
          ? prev.map((r) => (r.id === next.id ? next : r))
          : [next, ...prev];
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(msg);
    }
  }, []);

  return {
    records,
    loading,
    reload,
    saveRecord,
    deleteRecord,
    quickPunch,
    backdateDays,
    backdateLoaded,
    saveBackdateSetting,
    managedNames,
  };
}
