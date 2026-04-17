import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ApiError,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import type { Profile } from "@/types";
import type {
  PaceChecklistCreate,
  PaceChecklistDto,
} from "@/types/api";

interface PaceChecklistPageProps {
  profile: Profile | null;
}

const COLORS = [
  "#000000",
  "#dc2626",
  "#16a34a",
  "#2563eb",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#475569",
];

function FormatToolbar() {
  const [showColors, setShowColors] = useState(false);
  const execCmd = (cmd: string, val?: string): void => {
    document.execCommand(cmd, false, val);
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: "6px 14px",
        background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0",
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "#94a3b8",
          fontWeight: 600,
          marginRight: 6,
        }}
      >
        Format:
      </span>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          execCmd("bold");
        }}
        title="Bold (Ctrl+B)"
        style={{
          background: "none",
          border: "1px solid #e2e8f0",
          cursor: "pointer",
          fontWeight: 900,
          fontSize: 13,
          padding: "3px 8px",
          borderRadius: 4,
          color: "#374151",
        }}
      >
        B
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          execCmd("italic");
        }}
        title="Italic (Ctrl+I)"
        style={{
          background: "none",
          border: "1px solid #e2e8f0",
          cursor: "pointer",
          fontStyle: "italic",
          fontSize: 13,
          padding: "3px 8px",
          borderRadius: 4,
          color: "#374151",
        }}
      >
        I
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          execCmd("underline");
        }}
        title="Underline (Ctrl+U)"
        style={{
          background: "none",
          border: "1px solid #e2e8f0",
          cursor: "pointer",
          textDecoration: "underline",
          fontSize: 13,
          padding: "3px 8px",
          borderRadius: 4,
          color: "#374151",
        }}
      >
        U
      </button>
      <span
        style={{ width: 1, height: 18, background: "#d1d5db", margin: "0 4px" }}
      />
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setShowColors(!showColors);
          }}
          title="Font Color"
          style={{
            background: "none",
            border: "1px solid #e2e8f0",
            cursor: "pointer",
            fontSize: 13,
            padding: "3px 8px",
            borderRadius: 4,
            color: "#374151",
          }}
        >
          A
          <span
            style={{
              display: "block",
              height: 3,
              background: "linear-gradient(90deg,#dc2626,#2563eb,#16a34a)",
              borderRadius: 1,
              marginTop: 1,
            }}
          />
        </button>
        {showColors && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 20,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: 5,
              display: "flex",
              gap: 4,
              boxShadow: "0 4px 12px rgba(0,0,0,.12)",
              marginTop: 2,
            }}
          >
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execCmd("foreColor", c);
                  setShowColors(false);
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: c,
                  border: "2px solid #fff",
                  cursor: "pointer",
                  boxShadow: "0 0 0 1px #d1d5db",
                }}
              />
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          execCmd("fontSize", "5");
        }}
        title="Large Text"
        style={{
          background: "none",
          border: "1px solid #e2e8f0",
          cursor: "pointer",
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 4,
          color: "#374151",
          fontWeight: 700,
        }}
      >
        A+
      </button>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          execCmd("removeFormat");
        }}
        title="Clear Formatting"
        style={{
          background: "none",
          border: "1px solid #e2e8f0",
          cursor: "pointer",
          fontSize: 11,
          padding: "3px 8px",
          borderRadius: 4,
          color: "#94a3b8",
        }}
      >
        ✕ Clear
      </button>
      <span style={{ marginLeft: 8, fontSize: 10, color: "#94a3b8" }}>
        Select text in any note, then click a format button
      </span>
    </div>
  );
}

interface RichNoteCellProps {
  defaultValue?: string;
  onSave?: (html: string) => void;
  placeholder?: string;
}

function RichNoteCell({ defaultValue, onSave, placeholder }: RichNoteCellProps) {
  return (
    <div
      contentEditable
      suppressContentEditableWarning
      dangerouslySetInnerHTML={{ __html: defaultValue || "" }}
      onBlur={(e) => {
        if (onSave) {
          const html = e.currentTarget.innerHTML;
          if (html !== (defaultValue || "")) onSave(html);
        }
      }}
      data-placeholder={placeholder || "Notes…"}
      style={{
        minHeight: 28,
        padding: "6px 8px",
        fontSize: 12,
        lineHeight: 1.6,
        color: "#374151",
        fontFamily: "inherit",
        outline: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        border: "1px solid #e5e7eb",
        borderRadius: 6,
        background: "#fafafa",
        flex: 1,
        maxWidth: 600,
      }}
    />
  );
}

const WEEKS = [
  {
    week: 1,
    title: "Business Goals Creation",
    items: [
      "Define your win-win-win business philosophy and write it down",
      "Set Vision Goal (no timeline): What revenue makes it worthy to give your life to this business?",
      "Set Aspiration Goal (1-year): Challenging yet inspiring revenue target",
      "Define Business Profitability target (gross margin %)",
      "Where you want to go is more important than where you are or where you came from",
      "Document all 3 types of goals: Financial, Functional, Learning",
      "Name your Business Goal / Project",
      "Design, print, and post the Business Goal name in the office",
    ],
  },
  {
    week: 2,
    title: "Business Model Creation",
    items: [
      "Identify which industries/domains/segments you can offer products/services to",
      "Map Customer Focus Expansion: B2B, B2C, B2Ch",
      "Classify customers into A (Amazing), B (Breadwinning), C (Convenience), D (Dangerous)",
      "Describe characteristics of each customer type",
      "Define Easy-to-Buy product (low cost, no-brainer, cash flow generator)",
      "Define Primary product/service (known in market, moderate cost, impact offering)",
      "Define High Value product (premium, customized, profit maximizer)",
      "List Hygienic Marketing strategies: Content, Email, SEO, Referral, Exhibitions, Tele-marketing",
      "Choose 1-2 Magnetic Marketing strategies: Podcast, Content, Community marketing",
      "Document the Lead Generation Formula: REACH + RESPECT = RESULTS",
    ],
  },
  {
    week: 3,
    title: "Role Clarity Creation",
    items: [
      "Prepare Role Clarity Template with sample",
      "Each individual creates Version 1.0 of their Role Document",
      "Present Version 1.0 in group setting for feedback",
      'Collect feedback: "What is missing that needs to be added?"',
      'Collect feedback: "What is extra that needs to be removed?"',
      "Create Version 2.0 Role Document",
      "Present Version 2.0 to reporting manager for feedback",
      "Finalize Version 3.0 Role Document",
    ],
  },
  {
    week: 4,
    title: "Competence Clarity",
    items: [
      "Educate team on Competency Iceberg Model elements",
      "Explain Skills: ability to do critical job tasks",
      "Explain Knowledge: information and data required for the job",
      "Explain Self-Image: how a person sees themselves in the job role",
      "Explain Traits: behavioral characteristics that add/diminish skill value",
      "Explain Motives: what drives a person's behaviours and actions (deeper purpose)",
      "Share sample Competency Attributes List",
      "Create Version 1.0 Competency List individually",
      "Group feedback → Version 2.0",
      "Manager feedback → Finalize Version 3.0",
    ],
  },
  {
    week: 5,
    title: "Individual Goal Clarity",
    items: [
      "Schedule 1-to-1 meetings with every team member + their reporting manager",
      "Educate on salary appraisal system and stages",
      "Explain review clarity, calculation method, and communication process",
      "Create individual goal document: Results targets",
      "Create individual goal document: Skill & Knowledge growth areas",
      "Create individual goal document: Attitude & Self-Image benchmarks",
      "Align individual goals with overall business goals",
    ],
  },
  {
    week: 6,
    title: "Functional Assessment",
    items: [
      "Rate Marketing function: Owner Dependency / Action Consistency / Results Efficiency",
      "Rate Sales function: Owner Dependency / Action Consistency / Results Efficiency",
      "Rate Operations function: Owner Dependency / Action Consistency / Results Efficiency",
      "Rate Legal function: Owner Dependency / Action Consistency / Results Efficiency",
      "Rate Accounts function: Owner Dependency / Action Consistency / Results Efficiency",
      "Rate HR function: Owner Dependency / Action Consistency / Results Efficiency",
      "Rate Management function: Owner Dependency / Action Consistency / Results Efficiency",
      "Choose 2-3 priority functions to focus on based on business stage",
      "Map current phase for each (Skill Building / System Building / Team Building)",
      "Define next steps and roadmap for chosen functions",
      'Declaration: "I reduce owner dependency, build dependency action"',
    ],
  },
  {
    week: 7,
    title: "Strategic Review Meeting",
    items: [
      "Schedule full-day (6 hours) Strategic Review Meeting",
      "Prepare: Review data from last 45 days",
      "Completion segment: Share key achievements of last 45 days (20 min)",
      "Completion segment: Share key breakdowns of last 45 days",
      "Competence Development: Feedback session for each individual (120 min)",
      "Feedback format: Context 15min → Writing Exercise 45min → Reading 60min",
      "Celebration: Acknowledge team and highlight key contributors (10 min)",
      "Creation: Set goals for coming 45 days — Financial, Functional, Learning (90 min)",
      "Action Plan: Break 45-day goals into weekly milestones (120 min)",
      "Include Competence Development Plan (P.R.E Activity)",
      "Include Functional Enhancement plan",
      "Include Target Achievement Plan — Sales, Operations, Finances",
      "Closure: Key lessons and takeaways sharing (10 min)",
    ],
  },
  {
    week: 8,
    title: "Operational Meeting Launch",
    items: [
      "Set a fixed daily time for 15-min standup",
      "Completion: Each person says one word — BREAKDOWN or BREAKTHROUGH (3 min)",
      "Clarity: Each person shares top 2-3 outcomes for the day (10 min)",
      "Ensure focus is on key accomplishment, NOT full day schedule",
      "Collaboration: Anyone with specific requests addresses the right person (1 min)",
      "Closure: Inspiring quote/thought for the day (1 min)",
      "Wall clock shows the time, take photo and update in group",
    ],
  },
  {
    week: 9,
    title: "Tactical Meeting Launch",
    items: [
      "Schedule fortnightly 2-hour tactical review meeting",
      "Coaching: Review individual goals for the previous fortnight (85 min)",
      "Acknowledge BREAKTHROUGHS",
      "Exercise ACCOUNTABILITY on BREAKDOWNS with Respect",
      "Review Questions: What was the Goal? What is done? What is not done?",
      "Reflection Questions: What was missing from your end? What did you learn?",
      "Results Questions: What will be different? What will you get done and by when?",
      "Format: Context 5min → Writing Exercise 15min → Reading 65min",
      "Creation: Re-align goals for coming fortnight (20 min)",
      "Problem sharing: Facilitate sharing of Doubts, Fears, Obstacles (10 min)",
      "Closure: Sharing to inspire (5 min)",
    ],
  },
];

export default function PaceChecklistPage({
  profile: _profile,
}: PaceChecklistPageProps) {
  void _profile;
  const [checklist, setChecklist] = useState<PaceChecklistDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeWeek, setActiveWeek] = useState(1);

  // FY filter — e.g. "2026-27" means Apr 2026 to Mar 2027
  const getCurrentFY = (): string => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-based
    return m >= 3
      ? `${y}-${String(y + 1).slice(2)}`
      : `${y - 1}-${String(y).slice(2)}`;
  };
  const [selectedFY, setSelectedFY] = useState(getCurrentFY);

  // Generate FY options: 3 years back + 3 forward
  const fyOptions = useMemo<string[]>(() => {
    const now = new Date().getFullYear();
    const opts: string[] = [];
    for (let y = now - 2; y <= now + 3; y++)
      opts.push(`${y}-${String(y + 1).slice(2)}`);
    return opts;
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await apiGet<PaceChecklistDto[]>("/pace_checklist/", {
        fy: selectedFY,
      });
      setChecklist(rows);
    } finally {
      setLoading(false);
    }
  }, [selectedFY]);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<PaceChecklistDto>(
      "pace-checklist",
      () => {
        void load();
      },
    );
    return unsubscribe;
  }, [load]);

  const getItem = useCallback(
    (week: number, itemIdx: number): PaceChecklistDto | undefined =>
      checklist.find(
        (c) => c.week_number === week && c.item_number === itemIdx,
      ),
    [checklist],
  );

  const updateNotes = async (
    week: number,
    itemIdx: number,
    actionText: string,
    notes: string,
  ): Promise<void> => {
    const existing = getItem(week, itemIdx);
    try {
      if (existing) {
        await apiPatch<PaceChecklistDto>(
          `/pace_checklist/${existing.uid}/`,
          { notes },
        );
      } else {
        const body: PaceChecklistCreate = {
          week_number: week,
          item_number: itemIdx,
          action_item: actionText,
          done: false,
          notes,
          fy: selectedFY,
        };
        await apiPost<PaceChecklistDto>("/pace_checklist/", body);
      }
      void load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    }
  };

  const weekHasNotes = useMemo<Record<number, number>>(() => {
    const map: Record<number, number> = {};
    WEEKS.forEach((w) => {
      const count = w.items.filter((_, i) => {
        const item = getItem(w.week, i);
        return item?.notes && item.notes.trim();
      }).length;
      map[w.week] = count;
    });
    return map;
  }, [getItem]);

  return (
    <div style={{ padding: "10px 16px" }}>
      <style>{`[contenteditable]:empty:before { content: attr(data-placeholder); color: #94a3b8; pointer-events: none; } [contenteditable]:focus { border-color: #2563eb !important; box-shadow: 0 0 0 2px rgba(37,99,235,.1); }`}</style>
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
        <div className="page-title">✅ PACE Implementation Checklist</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
            Financial Year:
          </span>
          <select
            value={selectedFY}
            onChange={(e) => setSelectedFY(e.target.value)}
            style={{
              padding: "6px 12px",
              border: "2px solid #e2e8f0",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              color: "#1e293b",
              cursor: "pointer",
              background: "#fff",
              fontFamily: "inherit",
            }}
          >
            {fyOptions.map((fy) => (
              <option key={fy} value={fy}>
                FY {fy}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Week tabs */}
      <div
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}
      >
        {WEEKS.map((w) => {
          const notes = weekHasNotes[w.week] || 0;
          const isActive = activeWeek === w.week;
          return (
            <button
              key={w.week}
              onClick={() => setActiveWeek(w.week)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: `2px solid ${isActive ? "#2563eb" : "#e2e8f0"}`,
                background: isActive ? "#eff6ff" : "#fff",
                cursor: "pointer",
                textAlign: "left",
                minWidth: 120,
                transition: "all .15s",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: isActive ? "#2563eb" : "#475569",
                }}
              >
                Week {w.week}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>{w.title}</div>
              {notes > 0 && (
                <div
                  style={{
                    fontSize: 9,
                    color: "#16a34a",
                    fontWeight: 600,
                    marginTop: 2,
                  }}
                >
                  📝 {notes} notes
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Active week content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          Loading…
        </div>
      ) : (
        <div
          className="dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            overflow: "hidden",
          }}
        >
          <FormatToolbar />
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid #e2e8f0",
              background: "#f8fafc",
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                color: "#1e293b",
                fontFamily: "var(--font-heading)",
              }}
            >
              Week {activeWeek} — {WEEKS[activeWeek - 1]?.title}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              {WEEKS[activeWeek - 1]?.items.length} items — FY {selectedFY}
            </div>
          </div>
          <div style={{ padding: "12px 20px" }}>
            {WEEKS[activeWeek - 1]?.items.map((item, idx) => {
              const saved = getItem(activeWeek, idx);
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom:
                      idx < WEEKS[activeWeek - 1].items.length - 1
                        ? "1px solid #f1f5f9"
                        : "none",
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#2563eb",
                      minWidth: 24,
                      marginTop: 2,
                    }}
                  >
                    {idx + 1}.
                  </span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#1e293b",
                        fontWeight: 600,
                        lineHeight: 1.5,
                        marginBottom: 6,
                      }}
                    >
                      {item}
                    </div>
                    <RichNoteCell
                      key={`w${activeWeek}-i${idx}-${selectedFY}`}
                      defaultValue={saved?.notes || ""}
                      onSave={(val) => updateNotes(activeWeek, idx, item, val)}
                      placeholder="Enter your notes here…"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Key principles */}
      <div
        style={{
          marginTop: 20,
          padding: "16px 20px",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: "#92400e",
            marginBottom: 10,
            fontFamily: "var(--font-heading)",
          }}
        >
          🏛 KEY MANAGEMENT PRINCIPLES
        </div>
        {[
          "1. I am a CATALYST, not CATTLE.",
          "2. PERFECTION is a myth. PROGRESS is the key! I DEVELOP and DELEGATE!",
          "3. I DO, they WATCH → WE DO TOGETHER (Shadowing) → THEY DO, I WATCH.",
          "4. Silent leadership → Handhold mediocre mindset.",
          "5. Development should reach the tipping point.",
          "6. Feedback is a dialogue, not justification. No diplomacy, no flattery.",
          "7. People leave managers, people may leave leaders, people rarely leave mentors.",
        ].map((p, i) => (
          <div
            key={i}
            style={{
              fontSize: 12,
              color: "#78350f",
              marginBottom: 4,
              lineHeight: 1.6,
            }}
          >
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}
