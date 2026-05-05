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
  const canFinalReview = isAdmin;
  const canAdd = isAdmin || isManager;

  const [month, setMonth] = useState(currentMonth());
  const [showAdd, setShowAdd] = useState(false);

  const { standups, roster, refresh } = useOperationalStandups({
    month,
    rosterDate: todayISO(),
  });

  // Group standups by date for the older-dates sections.
  const dateGroups = useMemo(() => {
    const today = todayISO();
    const byDate = new Map<string, OperationalStandupRosterRow[]>();
    // Today gets the full roster (placeholders + entries).
    byDate.set(today, roster);
    // Earlier dates: only show submitted entries grouped.
    for (const s of standups) {
      if (s.standup_date === today) continue;
      const existing = byDate.get(s.standup_date) ?? [];
      existing.push({
        profile: s.profile_detail,
        org_uid: s.org_uid ?? "",
        org_name: "",
        entry: s,
        can_edit: isAdmin || isManager || s.profile_detail.uid === profile?.id,
        can_approve: isAdmin || isManager,
      });
      byDate.set(s.standup_date, existing);
    }
    return Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [standups, roster, isAdmin, isManager, profile]);

  const today = todayISO();

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
    async (uid: string) => {
      await apiPost(`/operational_standups/${uid}/approve/`, {});
      await refresh();
    },
    [refresh],
  );

  const handleReview = useCallback(
    async (uid: string) => {
      await apiPost(`/operational_standups/${uid}/review/`, {});
      await refresh();
    },
    [refresh],
  );

  const handleFinalReview = useCallback(
    async (date: string) => {
      if (!window.confirm(`Run Final Review for ${date}?`)) return;
      const orgUid = roster[0]?.org_uid ?? profile?.orgs?.[0]?.uid;
      if (!orgUid) {
        alert("Could not determine org for Final Review.");
        return;
      }
      await apiPost(`/operational_standups/bulk_review/`, { date, org: orgUid });
      await refresh();
    },
    [roster, profile, refresh],
  );

  const orgUid = roster[0]?.org_uid ?? profile?.orgs?.[0]?.uid ?? "";
  const profileChoices = useMemo(
    () => (profiles ?? [])
      .map((p) => ({ uid: p.id, full_name: p.full_name ?? p.username ?? "" }))
      .filter((p) => p.uid),
    [profiles],
  );

  // Stats
  const stats = useMemo(() => {
    const total = standups.length;
    const approved = standups.filter((s) => s.status === "Approved").length;
    const pending = standups.filter((s) => s.status === "Pending").length;
    const todayRoster = roster.length;
    const todaySubmitted = roster.filter((r) => r.entry !== null).length;
    return {
      total, approved, pending,
      notSubmittedToday: Math.max(0, todayRoster - todaySubmitted),
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
        // Admin attention = Pending OR (entry exists with reviewed_at === null).
        const pendingCount = rows.reduce((acc, r) => {
          if (r.entry === null) return acc;
          return r.entry.status === "Pending" || r.entry.reviewed_at === null
            ? acc + 1
            : acc;
        }, 0);
        return (
          <DailyStandupDateSection
            key={date}
            date={date}
            rows={rows}
            defaultExpanded={date === today}
            canFinalReview={canFinalReview}
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
          orgUid={orgUid}
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
