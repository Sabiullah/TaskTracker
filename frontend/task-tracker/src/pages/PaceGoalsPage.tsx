import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { SEED_GOALS } from "@/data/seedGoals";
import { thS, tdS } from "@/utils/tableStyles";
import type { Profile } from "@/types";
import type {
  PaceGoalCreate,
  PaceGoalDto,
  PaceGoalReviewCreate,
  PaceGoalTypeValue,
} from "@/types/api";
import {
  GOAL_TYPES,
  STATUS_CLR,
  TYPE_CFG,
  inpS,
} from "@/utils/paceGoals";
import type { GoalForm, GoalRow, ReviewForm } from "@/types/paceGoals";
import { RatingBar } from "@/components/pace/RatingBar";
import { GoalModal } from "@/components/pace/GoalModal";
import { GoalReviewModal } from "@/components/pace/GoalReviewModal";

interface PaceGoalsPageProps {
  profile: Profile | null;
  profiles?: Profile[];
}

export default function PaceGoalsPage({
  profile,
  profiles = [],
}: PaceGoalsPageProps) {
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [reviewModal, setReviewModal] = useState<GoalRow | null>(null);
  const [form, setForm] = useState<GoalForm | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [subTab, setSubTab] = useState<"my" | "team" | "individual">("my");
  const [selectedEmp, setSelectedEmp] = useState("");

  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";
  const myName = profile?.full_name || "";

  const managedNames = useMemo<string[]>(() => {
    if (!isManager) return [];
    return profiles
      .filter((p) => (p.manager_ids ?? []).includes(profile?.id ?? ""))
      .map((p) => p.full_name || "")
      .filter(Boolean);
  }, [profiles, profile, isManager]);

  const visibleNames = useMemo<string[]>(() => {
    if (isAdmin)
      return profiles
        .map((p) => p.full_name)
        .filter((n): n is string => Boolean(n))
        .sort();
    if (isManager) return [myName, ...managedNames].sort();
    return [myName];
  }, [isAdmin, isManager, myName, managedNames, profiles]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const dtos = await apiGet<PaceGoalDto[]>("/pace_goals/");
      // Django applies role-based visibility server-side; derive display name.
      const rows: GoalRow[] = dtos.map((g) => ({
        ...g,
        employee_name: g.profile_detail?.full_name ?? "",
      }));
      rows.sort((a, b) => {
        if (a.goal_type !== b.goal_type)
          return a.goal_type.localeCompare(b.goal_type);
        return a.created_at < b.created_at ? -1 : 1;
      });
      setGoals(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<PaceGoalDto>("pace-goals", () => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const viewName = subTab === "my" ? myName : selectedEmp;
  const myGoals = useMemo<GoalRow[]>(
    () => goals.filter((g) => g.employee_name === viewName),
    [goals, viewName],
  );
  const byType = (type: PaceGoalTypeValue): GoalRow[] =>
    myGoals.filter((g) => g.goal_type === type);

  const teamSummary = useMemo(() => {
    const names = [...new Set(goals.map((g) => g.employee_name))].sort();
    return names.map((name) => {
      const eg = goals.filter((g) => g.employee_name === name);
      const skillGaps = eg.filter(
        (g) => g.goal_type === "Skill" && (g.current_rating || 0) < 3,
      ).length;
      const attGaps = eg.filter(
        (g) => g.goal_type === "Attitude" && (g.current_rating || 0) < 3,
      ).length;
      const achieved = eg.filter((g) => g.status === "Achieved").length;
      return {
        name,
        total: eg.length,
        achieved,
        skillGaps,
        attGaps,
        pct: eg.length ? Math.round((achieved / eg.length) * 100) : 0,
      };
    });
  }, [goals]);

  const openAdd = (goalType: PaceGoalTypeValue): void => {
    setForm({
      employee_name: viewName || myName,
      goal_type: goalType,
      status: "Not Started",
      priority: "Critical",
      current_rating: 1,
      target_rating: 3,
    });
    setModal("add");
  };
  const openEdit = (g: GoalRow): void => {
    setForm({
      id: g.uid,
      employee_name: g.employee_name,
      goal_type: g.goal_type,
      status: g.status,
      priority: g.priority,
      current_rating: g.current_rating,
      target_rating: g.target_rating,
      title: g.title,
      description: g.description,
      success_criteria: g.success_criteria,
      frequency: g.frequency,
      target: g.target,
      tracking_method: g.tracking_method,
      learning_action: g.learning_action,
      completion_by: g.completion_by ?? "",
      iceberg_level: g.iceberg_level,
      focus_area: g.focus_area,
      daily_practice: g.daily_practice,
    });
    setModal("edit");
  };
  const openReview = (g: GoalRow): void => {
    setReviewForm({
      goal_id: g.uid,
      review_date: new Date().toISOString().slice(0, 10),
      previous_rating: g.current_rating || 0,
      new_rating: g.current_rating || 0,
      reviewer_name: myName,
      comments: "",
    });
    setReviewModal(g);
  };

  const resolveProfileUid = (name: string): string | undefined =>
    profiles.find((p) => p.full_name === name)?.id;

  const setFormNonNull = (updater: (prev: GoalForm) => GoalForm): void =>
    setForm((f) => (f ? updater(f) : f));

  const setReviewFormNonNull = (
    updater: (prev: ReviewForm) => ReviewForm,
  ): void => setReviewForm((f) => (f ? updater(f) : f));

  const buildGoalBody = (f: GoalForm): PaceGoalCreate => ({
    profile: resolveProfileUid(f.employee_name),
    goal_type: f.goal_type,
    title: (f.title ?? "").trim(),
    description: f.description,
    status: f.status,
    priority: f.priority,
    current_rating: Number(f.current_rating) || 0,
    target_rating: Number(f.target_rating) || 0,
    success_criteria: f.success_criteria,
    frequency: f.frequency || undefined,
    target: f.target,
    tracking_method: f.tracking_method,
    learning_action: f.learning_action,
    completion_by: f.completion_by || undefined,
    iceberg_level: f.iceberg_level || undefined,
    focus_area: f.focus_area || undefined,
    daily_practice: f.daily_practice,
  });

  const handleSave = async (): Promise<void> => {
    if (!form) return;
    if (!form.title?.trim()) return alert("Goal title is required");
    setSaving(true);
    try {
      const body = buildGoalBody(form);
      if (modal === "edit" && form.id) {
        await apiPatch<PaceGoalDto>(`/pace_goals/${form.id}/`, body);
      } else {
        await apiPost<PaceGoalDto>("/pace_goals/", body);
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

  const handleReviewSave = async (): Promise<void> => {
    if (!reviewForm) return;
    setSaving(true);
    try {
      const body: PaceGoalReviewCreate = {
        goal: reviewForm.goal_id,
        review_date: reviewForm.review_date,
        previous_rating: Number(reviewForm.previous_rating) || 0,
        new_rating: Number(reviewForm.new_rating) || 0,
        reviewer_name: reviewForm.reviewer_name,
        comments: reviewForm.comments,
      };
      // Server-side trigger updates the parent goal's current_rating in the
      // same transaction — no second API call needed.
      await apiPost<unknown>("/pace_goal_reviews/", body);
      setReviewModal(null);
      void load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (uid: string): Promise<void> => {
    if (!window.confirm("Delete this goal?")) return;
    try {
      await apiDelete(`/pace_goals/${uid}/`);
      void load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  };

  const canEdit = isAdmin || isManager;

  const renderSection = (type: PaceGoalTypeValue) => {
    const tc = TYPE_CFG[type];
    const items = byType(type);
    const isRatable = type !== "Result";
    return (
      <div key={type} style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: tc.color }}>
            {tc.icon}{" "}
            {type === "Result"
              ? "RESULT GOALS — What will I achieve?"
              : type === "Skill"
                ? "SKILL & KNOWLEDGE GOALS — What will I learn?"
                : "ATTITUDE FITNESS GOALS — Who will I become?"}
          </div>
          {(canEdit || viewName === myName) && (
            <button
              onClick={() => openAdd(type)}
              style={{
                padding: "4px 12px",
                background: tc.color,
                color: "#fff",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              + Add
            </button>
          )}
        </div>
        <div
          className="sticky-table-wrap dm-box"
          style={{
            background: "#fff",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 30 }}>#</th>
                <th style={thS}>
                  {type === "Attitude" ? "Attribute" : "Goal"}
                </th>
                {type === "Result" && (
                  <>
                    <th style={thS}>Success Criteria</th>
                    <th style={{ ...thS, width: 80 }}>Frequency</th>
                    <th style={thS}>Target</th>
                  </>
                )}
                {type === "Skill" && (
                  <>
                    <th style={{ ...thS, width: 70 }}>Rating</th>
                    <th style={{ ...thS, width: 70 }}>Target</th>
                    <th style={thS}>Learning Plan</th>
                  </>
                )}
                {type === "Attitude" && (
                  <>
                    <th style={{ ...thS, width: 80 }}>Iceberg</th>
                    <th style={{ ...thS, width: 70 }}>Rating</th>
                    <th style={{ ...thS, width: 80 }}>Focus</th>
                    <th style={thS}>Daily Practice</th>
                  </>
                )}
                <th style={{ ...thS, width: 90 }}>Status</th>
                <th style={{ ...thS, width: 60 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      ...tdS,
                      textAlign: "center",
                      padding: 20,
                      color: "#94a3b8",
                    }}
                  >
                    No {type.toLowerCase()} goals yet.
                  </td>
                </tr>
              )}
              {items.map((g, i) => (
                <tr
                  key={g.id}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f8fafc")
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  <td style={{ ...tdS, color: "#94a3b8", fontSize: 11 }}>
                    {i + 1}
                  </td>
                  <td style={{ ...tdS, fontWeight: 600, color: "#1e293b" }}>
                    {g.title}
                    <br />
                    <span
                      style={{
                        fontSize: 11,
                        color: "#94a3b8",
                        fontWeight: 400,
                      }}
                    >
                      {g.description || ""}
                    </span>
                  </td>
                  {type === "Result" && (
                    <>
                      <td style={{ ...tdS, fontSize: 11 }}>
                        {g.success_criteria || "—"}
                      </td>
                      <td style={tdS}>{g.frequency || "—"}</td>
                      <td style={{ ...tdS, fontSize: 11 }}>
                        {g.target || "—"}
                      </td>
                    </>
                  )}
                  {type === "Skill" && (
                    <>
                      <td style={tdS}>
                        <RatingBar value={g.current_rating} />
                      </td>
                      <td style={tdS}>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>
                          {g.target_rating || "—"}
                        </span>
                      </td>
                      <td style={{ ...tdS, fontSize: 11 }}>
                        {g.learning_action || "—"}
                      </td>
                    </>
                  )}
                  {type === "Attitude" && (
                    <>
                      <td style={{ ...tdS, fontSize: 10 }}>
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 8,
                            background: "#f1f5f9",
                          }}
                        >
                          {g.iceberg_level || "—"}
                        </span>
                      </td>
                      <td style={tdS}>
                        <RatingBar value={g.current_rating} />
                      </td>
                      <td style={{ ...tdS, fontSize: 10 }}>
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 8,
                            background: "#f1f5f9",
                          }}
                        >
                          {g.focus_area || "—"}
                        </span>
                      </td>
                      <td style={{ ...tdS, fontSize: 11 }}>
                        {g.daily_practice || "—"}
                      </td>
                    </>
                  )}
                  <td style={tdS}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 10,
                        fontSize: 10,
                        fontWeight: 700,
                        background: STATUS_CLR[g.status] + "18",
                        color: STATUS_CLR[g.status],
                      }}
                    >
                      {g.status}
                    </span>
                  </td>
                  <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                    {isRatable && canEdit && (
                      <button
                        onClick={() => openReview(g)}
                        title="Review"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 12,
                          padding: "2px",
                        }}
                      >
                        ⭐
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(g)}
                      title="Edit"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: "2px",
                      }}
                    >
                      ✏️
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => handleDelete(g.uid)}
                        title="Delete"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 12,
                          padding: "2px",
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

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
        <div className="page-title">🎯 Individual Goal Clarity</div>
        {isAdmin && goals.length === 0 && (
          <button
            onClick={async () => {
              const seed = SEED_GOALS as Array<
                Record<string, unknown> & {
                  current_rating?: number;
                  target_rating?: number;
                  employee_name?: string;
                }
              >;
              if (
                !window.confirm(
                  `Import ${seed.length} goals for 6 employees from PACE Excel? This is a one-time seed.`,
                )
              )
                return;
              const rows = seed.map((g) => ({
                ...g,
                profile: resolveProfileUid(g.employee_name ?? ""),
                current_rating: g.current_rating || 0,
                target_rating: g.target_rating || 0,
              }));
              try {
                await apiPost<unknown>("/pace_goals/bulk_create/", { rows });
                alert(`✅ Successfully imported ${rows.length} goals!`);
              } catch (err) {
                const msg =
                  err instanceof ApiError ? err.message : String(err);
                alert(`Import failed: ${msg}`);
                return;
              }
              load();
            }}
            style={{
              padding: "8px 18px",
              background: "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            📥 Import PACE Goals from Excel ({SEED_GOALS.length} goals)
          </button>
        )}
      </div>

      {/* Sub-tabs */}
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
          <button
            onClick={() => setSubTab("my")}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: subTab === "my" ? "#fff" : "transparent",
              color: subTab === "my" ? "#1e293b" : "#64748b",
              boxShadow: subTab === "my" ? "0 1px 3px rgba(0,0,0,.1)" : "none",
            }}
          >
            👤 My Goals
          </button>
          {(isAdmin || isManager) && (
            <button
              onClick={() => setSubTab("team")}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                background: subTab === "team" ? "#fff" : "transparent",
                color: subTab === "team" ? "#1e293b" : "#64748b",
                boxShadow:
                  subTab === "team" ? "0 1px 3px rgba(0,0,0,.1)" : "none",
              }}
            >
              👥 Team Summary
            </button>
          )}
          {(isAdmin || isManager) && (
            <button
              onClick={() => setSubTab("individual")}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                background: subTab === "individual" ? "#fff" : "transparent",
                color: subTab === "individual" ? "#1e293b" : "#64748b",
                boxShadow:
                  subTab === "individual" ? "0 1px 3px rgba(0,0,0,.1)" : "none",
              }}
            >
              🔍 View Employee
            </button>
          )}
        </div>
        {subTab === "individual" && (
          <select
            style={{ ...inpS, maxWidth: 200 }}
            value={selectedEmp}
            onChange={(e) => setSelectedEmp(e.target.value)}
          >
            <option value="">— Select Employee —</option>
            {visibleNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          Loading…
        </div>
      ) : (
        <>
          {/* My Goals / Individual View */}
          {(subTab === "my" || (subTab === "individual" && selectedEmp)) && (
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#475569",
                  marginBottom: 12,
                  padding: "8px 14px",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              >
                👤 Goals for:{" "}
                <span style={{ color: "#1e293b" }}>{viewName || "—"}</span>
                <span
                  style={{ marginLeft: 12, fontSize: 12, color: "#94a3b8" }}
                >
                  {myGoals.length} goals total
                </span>
              </div>
              {GOAL_TYPES.map((t) => renderSection(t))}
              {/* Declaration */}
              {myGoals.length > 0 && (
                <div
                  style={{
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: 10,
                    padding: "16px 20px",
                    marginTop: 16,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#1e40af",
                      marginBottom: 6,
                    }}
                  >
                    📜 MY DECLARATION
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#1e40af",
                      lineHeight: 1.6,
                      fontStyle: "italic",
                    }}
                  >
                    I, {viewName}, commit to achieving my Result Goals,
                    developing my Skills & Knowledge, and growing my Attitude to
                    become the best version of myself in my role. I will review
                    this document every fortnight and take consistent action.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Team Summary */}
          {subTab === "team" && (
            <div
              className="sticky-table-wrap dm-box"
              style={{
                background: "#fff",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr>
                    <th style={{ ...thS, width: 30 }}>#</th>
                    <th style={thS}>Employee</th>
                    <th style={{ ...thS, width: 60 }}>Total</th>
                    <th style={{ ...thS, width: 70 }}>Achieved</th>
                    <th style={{ ...thS, width: 80 }}>Skill Gaps</th>
                    <th style={{ ...thS, width: 90 }}>Attitude Gaps</th>
                    <th style={{ ...thS, width: 100 }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {teamSummary.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          ...tdS,
                          textAlign: "center",
                          padding: 30,
                          color: "#94a3b8",
                        }}
                      >
                        No goals set yet.
                      </td>
                    </tr>
                  )}
                  {teamSummary.map((r, i) => {
                    const barClr =
                      r.pct >= 75
                        ? "#16a34a"
                        : r.pct >= 50
                          ? "#d97706"
                          : "#dc2626";
                    return (
                      <tr
                        key={r.name}
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          setSelectedEmp(r.name);
                          setSubTab("individual");
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "#f8fafc")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "")
                        }
                      >
                        <td style={{ ...tdS, color: "#94a3b8", fontSize: 11 }}>
                          {i + 1}
                        </td>
                        <td
                          style={{ ...tdS, fontWeight: 600, color: "#2563eb" }}
                        >
                          {r.name}
                        </td>
                        <td
                          style={{
                            ...tdS,
                            textAlign: "center",
                            fontWeight: 700,
                          }}
                        >
                          {r.total}
                        </td>
                        <td
                          style={{
                            ...tdS,
                            textAlign: "center",
                            color: "#16a34a",
                            fontWeight: 600,
                          }}
                        >
                          {r.achieved}
                        </td>
                        <td style={{ ...tdS, textAlign: "center" }}>
                          {r.skillGaps > 0 ? (
                            <span style={{ color: "#dc2626", fontWeight: 700 }}>
                              ⚠ {r.skillGaps}
                            </span>
                          ) : (
                            "✅"
                          )}
                        </td>
                        <td style={{ ...tdS, textAlign: "center" }}>
                          {r.attGaps > 0 ? (
                            <span style={{ color: "#dc2626", fontWeight: 700 }}>
                              ⚠ {r.attGaps}
                            </span>
                          ) : (
                            "✅"
                          )}
                        </td>
                        <td style={tdS}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                flex: 1,
                                height: 6,
                                background: "#e5e7eb",
                                borderRadius: 3,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${r.pct}%`,
                                  height: "100%",
                                  background: barClr,
                                  borderRadius: 3,
                                }}
                              />
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: barClr,
                                minWidth: 30,
                              }}
                            >
                              {r.pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modal && form && (
        <GoalModal
          mode={modal}
          form={form}
          setForm={setFormNonNull}
          saving={saving}
          canEdit={canEdit}
          visibleNames={visibleNames}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {reviewModal && reviewForm && (
        <GoalReviewModal
          goal={reviewModal}
          form={reviewForm}
          setForm={setReviewFormNonNull}
          saving={saving}
          onSave={handleReviewSave}
          onClose={() => setReviewModal(null)}
        />
      )}
    </div>
  );
}
