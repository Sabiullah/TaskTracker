import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useOperationalStandups } from "@/hooks/useOperationalStandups";
import type { Profile } from "@/types/auth";
import type {
  OperationalStandupCreate,
  OperationalStandupRosterRow,
} from "@/types/api";
import { DailyStandupDateSection } from "@/components/pace/DailyStandupDateSection";
import { DailyStandupAddModal } from "@/components/pace/DailyStandupAddModal";

interface DailyStandupPageProps {
  profile: Profile | null;
  profiles?: Profile[];
  // Header ORG selector is ignored on this page (managers always see across
  // all their orgs). Prop kept for API parity with sibling pages.
  selectedOrg?: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function DailyStandupPage({ profile, profiles = [] }: DailyStandupPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const isManager = isManagerInAny();
  const canAdd = isAdmin || isManager;

  const [month, setMonth] = useState(currentMonth());
  const [showAdd, setShowAdd] = useState(false);

  const { standups, roster, refresh } = useOperationalStandups({
    month,
    rosterDate: todayISO(),
  });

  const today = todayISO();

  // Older-date rows come from `standups`. One row per (profile, date) — no dedupe.
  const dateGroups = useMemo(() => {
    const byDate = new Map<string, OperationalStandupRosterRow[]>();
    byDate.set(today, roster);

    const olderByDate = new Map<string, OperationalStandupRosterRow[]>();
    for (const s of standups) {
      if (s.standup_date === today) continue;
      const row: OperationalStandupRosterRow = {
        profile: s.profile_detail,
        entry: s,
        approvals: s.approvals.map((a) => ({
          uid: a.uid,
          org_uid: a.org_uid,
          org_name: a.org_name,
          status: a.status,
          approved_by: a.approved_by_detail
            ? { uid: a.approved_by_detail.uid, full_name: a.approved_by_detail.full_name }
            : null,
          approved_at: a.approved_at,
          reviewed_by: a.reviewed_by_detail
            ? { uid: a.reviewed_by_detail.uid, full_name: a.reviewed_by_detail.full_name }
            : null,
          reviewed_at: a.reviewed_at,
          can_act: isManager,
        })),
        can_edit: isManager || s.profile_detail.uid === profile?.id,
      };
      const arr = olderByDate.get(s.standup_date) ?? [];
      arr.push(row);
      olderByDate.set(s.standup_date, arr);
    }
    for (const [date, rows] of olderByDate) byDate.set(date, rows);
    return Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [standups, roster, today, isManager, profile]);

  const handleSave = useCallback(
    async (payload: Partial<OperationalStandupCreate>, rowUid: string | null) => {
      try {
        if (rowUid) {
          await apiPatch(`/operational_standups/${rowUid}/`, payload);
        } else {
          await apiPost(`/operational_standups/`, payload);
        }
        await refresh();
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
      }
    },
    [refresh],
  );

  const handleApprove = useCallback(
    async (uid: string, orgUid: string) => {
      await apiPost(`/operational_standups/${uid}/approve/`, { org: orgUid });
      await refresh();
    },
    [refresh],
  );

  const handleReview = useCallback(
    async (uid: string, orgUid: string) => {
      await apiPost(`/operational_standups/${uid}/review/`, { org: orgUid });
      await refresh();
    },
    [refresh],
  );

  const handleFinalReview = useCallback(
    async (date: string, orgUid: string) => {
      if (!window.confirm(`Run Final Review for ${date}?`)) return;
      await apiPost(`/operational_standups/bulk_review/`, { date, org: orgUid });
      await refresh();
    },
    [refresh],
  );

  const adminOrgs = useMemo(
    () =>
      (profile?.orgs ?? [])
        .filter((o) => o.role === "admin")
        .map((o) => ({ uid: o.uid, name: o.name })),
    [profile],
  );

  const profileChoices = useMemo(
    () =>
      (profiles ?? [])
        .map((p) => ({ uid: p.id, full_name: p.full_name ?? p.username ?? "" }))
        .filter((p) => p.uid),
    [profiles],
  );

  const stats = useMemo(() => {
    const total = standups.length;
    const allApprovals = standups.flatMap((s) => [...s.approvals]);
    const approved = allApprovals.filter((a) => a.status === "Approved").length;
    const pending = allApprovals.filter((a) => a.status === "Pending").length;
    const submitted = roster.filter((r) => r.entry !== null).length;
    return {
      total,
      approved,
      pending,
      notSubmittedToday: Math.max(0, roster.length - submitted),
    };
  }, [standups, roster]);

  useEffect(() => {
    void refresh();
  }, [refresh, month]);

  return (
    <div style={{ padding: "10px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="page-title">📋 Daily Standup</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: "6px 10px", fontSize: 13 }}
          />
          {canAdd && (
            <button
              onClick={() => setShowAdd(true)}
              style={{
                padding: "7px 14px", background: "#2563eb", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12,
              }}
            >
              + Add Entry
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[
          { l: "Total", v: stats.total, c: "#2563eb" },
          { l: "Approved", v: stats.approved, c: "#16a34a" },
          { l: "Pending", v: stats.pending, c: "#d97706" },
          { l: "Not submitted today", v: stats.notSubmittedToday, c: "#dc2626" },
        ].map((s) => (
          <div
            key={s.l}
            style={{
              background: "#fff", borderRadius: 8, padding: "8px 14px",
              borderTop: `3px solid ${s.c}`, minWidth: 110, textAlign: "center",
              boxShadow: "0 1px 4px rgba(0,0,0,.07)",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {dateGroups.map(([date, rows]) => {
        const pendingCount = rows.reduce(
          (acc, r) => acc + r.approvals.filter((a) => a.status === "Pending").length,
          0,
        );
        return (
          <DailyStandupDateSection
            key={date}
            date={date}
            rows={rows}
            defaultExpanded={date === today}
            adminOrgs={adminOrgs}
            pendingCount={pendingCount}
            isAdmin={isAdmin}
            onSave={handleSave}
            onApprove={handleApprove}
            onReview={handleReview}
            onFinalReview={handleFinalReview}
          />
        );
      })}

      {showAdd && (
        <DailyStandupAddModal
          date={today}
          profiles={profileChoices}
          isAdmin={isAdmin}
          onSubmit={async (payload) => {
            await apiPost("/operational_standups/", payload);
            await refresh();
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}
