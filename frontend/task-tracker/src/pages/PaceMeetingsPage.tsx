import { useState, useEffect, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { fmtClockTime as fmtTime } from "@/utils/time";
import { fmtDate } from "@/utils/date";
import type { Profile } from "@/types";
import type {
  PaceActionItem,
  PaceMeetingCreate,
  PaceMeetingDto,
  PaceMeetingTypeValue,
} from "@/types/api";
import {
  AGENDA_TEMPLATES,
  MEETING_TYPES,
  STATUS_CLR,
  TYPE_CFG,
  inpS,
} from "@/utils/paceMeetings";
import type { MeetingForm } from "@/types/paceMeetings";
import { MeetingDetailModal } from "@/components/pace/MeetingDetailModal";
import { MeetingEditModal } from "@/components/pace/MeetingEditModal";

import { useAuth } from "@/hooks/useAuth";

interface PaceMeetingsPageProps {
  profile: Profile | null;
  profiles?: Profile[];
  /** Header-selected org uid (seeds the modal's default). Empty string = "All". */
  selectedOrg?: string;
}

export default function PaceMeetingsPage({
  profile,
  profiles = [],
  selectedOrg = "",
}: PaceMeetingsPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const [meetings, setMeetings] = useState<PaceMeetingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [detailModal, setDetailModal] = useState<PaceMeetingDto | null>(null);
  const [form, setForm] = useState<MeetingForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [subTab, setSubTab] = useState<"upcoming" | "past">("upcoming");
  const [fType, setFType] = useState<PaceMeetingTypeValue | "">("");

  const isAdmin = isAdminInAny();
  const isManager = (isManagerInAny() && !isAdminInAny());
  const canEdit = isAdmin || isManager;
  const myName = profile?.full_name || "";
  const memberNames = useMemo<string[]>(
    () =>
      (profiles || [])
        .map((p) => p.full_name)
        .filter((n): n is string => Boolean(n))
        .sort(),
    [profiles],
  );

  // Orgs the user belongs to, default-first. The modal renders a selector
  // when there's >1; backend `resolve_create_org` requires `org` in that case.
  const orgOptions = useMemo(() => {
    const orgs = profile?.orgs ?? [];
    return [...orgs]
      .sort((a, b) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return 0;
      })
      .map((o) => ({ uid: o.uid, name: o.name }));
  }, [profile]);

  const defaultOrgUid = useMemo(() => {
    if (selectedOrg && orgOptions.some((o) => o.uid === selectedOrg)) {
      return selectedOrg;
    }
    return orgOptions[0]?.uid ?? "";
  }, [selectedOrg, orgOptions]);

  const TODAY = useMemo<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await apiGet<PaceMeetingDto[]>("/pace_meetings/");
      rows.sort((a, b) => (a.scheduled_date < b.scheduled_date ? 1 : -1));
      setMeetings(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<PaceMeetingDto>("pace-meetings", () => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const upcoming = useMemo(
    () =>
      meetings.filter(
        (m) => m.scheduled_date >= TODAY && m.status !== "Cancelled",
      ),
    [meetings, TODAY],
  );
  const past = useMemo(
    () =>
      meetings.filter(
        (m) => m.scheduled_date < TODAY || m.status === "Completed",
      ),
    [meetings, TODAY],
  );
  const filtered = useMemo(() => {
    const list = subTab === "upcoming" ? upcoming : past;
    return fType ? list.filter((m) => m.meeting_type === fType) : list;
  }, [subTab, upcoming, past, fType]);

  const stats = useMemo(
    () => ({
      total: meetings.length,
      scheduled: meetings.filter((m) => m.status === "Scheduled").length,
      completed: meetings.filter((m) => m.status === "Completed").length,
      actionsPending: meetings.reduce(
        (s, m) =>
          s + (m.action_items || []).filter((a) => a.status !== "Done").length,
        0,
      ),
    }),
    [meetings],
  );

  const openSchedule = (type: PaceMeetingTypeValue): void => {
    const tc = TYPE_CFG[type];
    setForm({
      org: defaultOrgUid,
      meeting_type: type,
      title: `${type} Review — ${new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`,
      scheduled_date: TODAY,
      scheduled_time: type === "Operational" ? "09:00" : "10:00",
      duration_minutes: tc.duration,
      status: "Scheduled",
      agenda: AGENDA_TEMPLATES[type],
      minutes: "",
      attendees: memberNames,
      action_items: [],
      conducted_by: myName,
    });
    setModal("add");
  };

  const openEdit = (m: PaceMeetingDto): void => {
    setForm({
      id: m.uid,
      org: m.org_uid ?? "",
      title: m.title,
      meeting_type: m.meeting_type,
      scheduled_date: m.scheduled_date,
      scheduled_time: m.scheduled_time ?? "",
      duration_minutes: m.duration_minutes,
      status: m.status,
      agenda: m.agenda,
      minutes: m.minutes,
      attendees: [...m.attendees],
      action_items: [...(m.action_items ?? [])],
      conducted_by: m.conducted_by,
    });
    setModal("edit");
  };

  const handleSave = async (): Promise<void> => {
    if (!form) return;
    if (!form.title?.trim()) return alert("Title is required");
    if (!form.scheduled_date) return alert("Date is required");
    const isCreate = !(modal === "edit" && form.id);
    if (isCreate && orgOptions.length > 1 && !form.org) {
      return alert("Organisation is required");
    }
    setSaving(true);
    const body: PaceMeetingCreate = {
      title: form.title.trim(),
      meeting_type: form.meeting_type,
      scheduled_date: form.scheduled_date,
      scheduled_time: form.scheduled_time || undefined,
      duration_minutes: form.duration_minutes,
      status: form.status,
      agenda: form.agenda,
      minutes: form.minutes,
      attendees: form.attendees,
      action_items: form.action_items,
      conducted_by: form.conducted_by,
    };
    try {
      if (!isCreate && form.id) {
        await apiPatch<PaceMeetingDto>(`/pace_meetings/${form.id}/`, body);
      } else {
        // org is immutable post-create, so we only send it on create.
        await apiPost<PaceMeetingDto>("/pace_meetings/", {
          ...body,
          ...(form.org ? { org: form.org } : {}),
        } as PaceMeetingCreate & { org?: string });
      }
      setModal(null);
      void load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (uid: string): Promise<void> => {
    if (!window.confirm("Delete this meeting?")) return;
    try {
      await apiDelete(`/pace_meetings/${uid}/`);
      setModal(null);
      void load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  };

  const updateForm = (patch: Partial<MeetingForm>): void =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const addActionItem = (): void =>
    setForm((f) =>
      f
        ? {
            ...f,
            action_items: [
              ...(f.action_items || []),
              { task: "", assignee: "", due_date: "", status: "Open" },
            ],
          }
        : f,
    );
  const updateAction = (
    idx: number,
    k: keyof PaceActionItem,
    v: string,
  ): void =>
    setForm((f) =>
      f
        ? {
            ...f,
            action_items: f.action_items.map((a, i) =>
              i === idx ? ({ ...a, [k]: v } as PaceActionItem) : a,
            ),
          }
        : f,
    );
  const removeAction = (idx: number): void =>
    setForm((f) =>
      f
        ? { ...f, action_items: f.action_items.filter((_, i) => i !== idx) }
        : f,
    );

  const cardS = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 16px",
    borderTop: `3px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.07)",
    minWidth: 90,
    textAlign: "center",
  });

  return (
    <div style={{ padding: "10px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div className="page-title">📋 PACE Meetings</div>
        {canEdit && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {MEETING_TYPES.filter((t) => t !== "Operational").map((t) => {
              const tc = TYPE_CFG[t];
              return (
                <button
                  key={t}
                  onClick={() => openSchedule(t)}
                  style={{
                    padding: "7px 14px",
                    background: tc.color,
                    color: "#fff",
                    border: "none",
                    borderRadius: 7,
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {tc.icon} Schedule {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats */}
      <div
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      >
        {[
          { l: "Total", v: stats.total, c: "#2563eb" },
          { l: "Scheduled", v: stats.scheduled, c: "#d97706" },
          { l: "Completed", v: stats.completed, c: "#16a34a" },
          { l: "Pending Actions", v: stats.actionsPending, c: "#dc2626" },
        ].map((s) => (
          <div key={s.l} className="dm-stat-card" style={cardS(s.c)}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>
              {s.v}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
              {s.l}
            </div>
          </div>
        ))}
      </div>

      {/* Sub-tabs + Filter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
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
              ["upcoming", "📅 Upcoming"],
              ["past", "📋 Past"],
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
        <select
          style={{ ...inpS, maxWidth: 150 }}
          value={fType}
          onChange={(e) =>
            setFType(e.target.value as PaceMeetingTypeValue | "")
          }
        >
          <option value="">All Types</option>
          {MEETING_TYPES.filter((t) => t !== "Operational").map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {filtered.length} meetings
        </span>
      </div>

      {/* Meeting List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          Loading…
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 12,
          }}
        >
          {filtered.length === 0 && (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#94a3b8",
                gridColumn: "1/-1",
              }}
            >
              No meetings found.
            </div>
          )}
          {filtered.map((m) => {
            const tc = TYPE_CFG[m.meeting_type] || TYPE_CFG.Operational;
            const pendingActions = (m.action_items || []).filter(
              (a) => a.status !== "Done",
            ).length;
            return (
              <div
                key={m.id}
                className="dm-box"
                style={{
                  background: "#fff",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  borderLeft: `4px solid ${tc.color}`,
                  padding: 16,
                  cursor: "pointer",
                  transition: "box-shadow .15s",
                }}
                onClick={() => setDetailModal(m)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.boxShadow =
                    "0 4px 12px rgba(0,0,0,.1)")
                }
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: tc.bg,
                      color: tc.color,
                    }}
                  >
                    {tc.icon} {m.meeting_type}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 10,
                      background: STATUS_CLR[m.status] + "18",
                      color: STATUS_CLR[m.status],
                    }}
                  >
                    {m.status}
                  </span>
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: "#1e293b",
                    marginBottom: 6,
                  }}
                >
                  {m.title}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    fontSize: 12,
                    color: "#64748b",
                    flexWrap: "wrap",
                  }}
                >
                  <span>📅 {fmtDate(m.scheduled_date)}</span>
                  {m.scheduled_time && (
                    <span>🕐 {fmtTime(m.scheduled_time)}</span>
                  )}
                  <span>⏱ {m.duration_minutes} min</span>
                  <span>👥 {(m.attendees || []).length}</span>
                  {pendingActions > 0 && (
                    <span style={{ color: "#dc2626", fontWeight: 700 }}>
                      ⚠ {pendingActions} actions
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailModal && (
        <MeetingDetailModal
          meeting={detailModal}
          canEdit={canEdit}
          onEdit={() => {
            openEdit(detailModal);
            setDetailModal(null);
          }}
          onClose={() => setDetailModal(null)}
        />
      )}

      {modal && form && (
        <MeetingEditModal
          mode={modal}
          form={form}
          memberNames={memberNames}
          orgOptions={orgOptions}
          saving={saving}
          updateForm={updateForm}
          addActionItem={addActionItem}
          updateAction={updateAction}
          removeAction={removeAction}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
