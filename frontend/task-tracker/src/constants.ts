// ── Board columns ─────────────────────────────────────────────────────────────
export const COLUMNS = [
  {
    id: "Future Task/Goals",
    title: "Future Goals",
    color: "#0052cc",
    bg: "#dbeafe",
  },
  { id: "TBC", title: "TBC", color: "#6b7280", bg: "#f3f4f6" },
  { id: "Pending", title: "Pending", color: "#d97706", bg: "#fef3c7" },
  { id: "Tomorrow", title: "Tomorrow", color: "#0891b2", bg: "#e0f2fe" },
  { id: "TodayTask", title: "Today", color: "#ea580c", bg: "#ffedd5" },
  { id: "Overdue", title: "Overdue", color: "#dc2626", bg: "#fee2e2" },
  { id: "Ontime", title: "On Time", color: "#16a34a", bg: "#dcfce7" },
  { id: "Completed", title: "Completed", color: "#15803d", bg: "#d1fae5" },
  {
    id: "Completed Delay",
    title: "Done (Delayed)",
    color: "#7c3aed",
    bg: "#ede9fe",
  },
];

export const STATUSES = COLUMNS.map((c) => c.id);

// ── Master data ───────────────────────────────────────────────────────────────
export const CLIENTS = [
  "Focus",
  "Ayyan",
  "ER",
  "Naturefull",
  "Apparel",
  "Zara School",
  "JMS",
  "Mizaj",
  "TAW",
  "Lily Aura",
  "London Stores",
  "Kaaba Grand",
  "Insnap",
  "Al Ameen",
  "The Independent Tobacco FZE",
  "AL-Noor",
  "SS Footwear",
  "Moon Mart",
  "Allied",
  "KSM",
];

export const CATEGORIES = [
  "Accounting",
  "Audit",
  "Tax",
  "Book Review",
  "Health Check",
  "Database",
  "GST",
  "Payroll",
  "Reconciliation",
  "Other",
];

export const TEAM_MEMBERS = [
  "Tamil",
  "Musthafa",
  "Akilan",
  "Aravind",
  "Safy",
  "Kasturi",
  "Alavudeen",
  "Surya",
];

// ── UI constants ──────────────────────────────────────────────────────────────
export const RECURRENCE_OPTIONS = [
  { value: "Onetime", label: "One-time", color: "#64748b" },
  { value: "Monthly", label: "Monthly", color: "#2563eb" },
  { value: "Quarterly", label: "Quarterly", color: "#7c3aed" },
  { value: "Halfyearly", label: "Half-yearly", color: "#0891b2" },
  { value: "Yearly", label: "Yearly", color: "#16a34a" },
];

export const AVATAR_COLORS: Record<string, string> = {
  Tamil: "#2563eb",
  Musthafa: "#7c3aed",
  Akilan: "#16a34a",
  Aravind: "#d97706",
  Safy: "#0891b2",
  Kasturi: "#db2777",
  Alavudeen: "#dc2626",
  Surya: "#4f46e5",
};
