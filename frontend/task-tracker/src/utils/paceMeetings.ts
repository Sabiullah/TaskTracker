import type { CSSProperties } from "react";
import type {
  PaceMeetingStatusValue,
  PaceMeetingTypeValue,
} from "@/types/api";

export interface MeetingTypeConfig {
  color: string;
  bg: string;
  icon: string;
  duration: number;
  freq: string;
}

export const MEETING_TYPES: readonly PaceMeetingTypeValue[] = [
  "Strategic",
  "Tactical",
  "Operational",
];

export const TYPE_CFG: Record<PaceMeetingTypeValue, MeetingTypeConfig> = {
  Strategic: {
    color: "#7c3aed",
    bg: "#f5f3ff",
    icon: "🎯",
    duration: 360,
    freq: "Every 45 days",
  },
  Tactical: {
    color: "#2563eb",
    bg: "#eff6ff",
    icon: "🔄",
    duration: 120,
    freq: "Fortnightly",
  },
  Operational: {
    color: "#16a34a",
    bg: "#f0fdf4",
    icon: "⚡",
    duration: 15,
    freq: "Daily",
  },
};

export const MEETING_STATUSES: readonly PaceMeetingStatusValue[] = [
  "Scheduled",
  "In Progress",
  "Completed",
  "Cancelled",
];

export const STATUS_CLR: Record<PaceMeetingStatusValue, string> = {
  Scheduled: "#d97706",
  "In Progress": "#2563eb",
  Completed: "#16a34a",
  Cancelled: "#6b7280",
};

export const AGENDA_TEMPLATES: Record<PaceMeetingTypeValue, string> = {
  Strategic: `STRATEGIC PERFORMANCE REVIEW (6 hours)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. COMPLETION (20 min)
   • Review last 45 days achievements
   • Review key breakdowns

2. COMPETENCE DEVELOPMENT (120 min)
   • Individual feedback sessions
   • Format: Context 15min → Writing 45min → Reading 60min

3. CELEBRATION (10 min)
   • Acknowledge key contributors
   • Highlight breakthroughs

4. CREATION (90 min)
   • Set goals for next 45 days
   • Financial, Functional, Learning goals

5. ACTION PLAN (120 min)
   • Break 45-day goals into weekly milestones
   • Competence Development Plan (P.R.E Activity)
   • Functional Enhancement plan
   • Target Achievement Plan — Sales, Operations, Finances

6. CLOSURE (10 min)
   • Key lessons and takeaways`,

  Tactical: `TACTICAL REVIEW MEETING (2 hours)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. COACHING (85 min)
   • Review individual goals for the previous fortnight
   • Acknowledge BREAKTHROUGHS
   • Exercise ACCOUNTABILITY on BREAKDOWNS with Respect
   • Questions: What was the Goal? What is done? What is not done?
   • Reflection: What was missing? What did you learn?
   • Results: What will be different? What will you get done and by when?
   • Format: Context 5min → Writing 15min → Reading 65min

2. CREATION (20 min)
   • Re-align goals for coming fortnight

3. PROBLEM SHARING (10 min)
   • Doubts, Fears, Obstacles

4. CLOSURE (5 min)
   • Sharing to inspire
   • "Fail, it's okay, but FAIL DIFFERENTLY"`,

  Operational: `DAILY STANDUP (15 minutes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. COMPLETION (3 min)
   • Each person: One word — BREAKDOWN or BREAKTHROUGH

2. CLARITY (10 min)
   • Top 2-3 priorities for the day
   • Focus on key accomplishment, NOT full schedule

3. COLLABORATION (1 min)
   • Specific support requests

4. CLOSURE (1 min)
   • Inspiring thought for the day`,
};

// Local md-size table / form styles (legacy padding, kept local by design —
// the shared tableStyles dense variant is 1–2px smaller).
export const thS: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};
export const tdS: CSSProperties = {
  padding: "8px 12px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
};
export const inpS: CSSProperties = {
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};
export const lblS: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: ".5px",
};
